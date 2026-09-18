// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DisplayScreen, OPENING_PLAYED_KEY } from "@/components/DisplayScreen";
import { createStore, type Store } from "@/lib/store";
import { createDisplayTools } from "@/lib/tools/display-tools";
import type { ToolContext } from "@/lib/tools/registry";
import { DISPLAY_STAGE_EVENT } from "@/lib/ui-events";

/**
 * TEST-163 — the display screen's two session stages are both reachable from the
 * conversation, and the opening survives a mouse that merely moves
 * (REQ-F-102; DEC-081; TASK-161). CR-20260912-stage-reach.
 *
 * The regression this locks: `stage` lives in the component and outranks the persisted
 * `display_state` when rendering. Once anything in the session had set it to `board`, the
 * title view was unreachable for the rest of that tab and `show_home` reported success
 * while the user went on seeing the board. Three e2e specs were red on `main` because of it.
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";
const home = { kind: "home", refId: null, html: null };

const toolContext: ToolContext = {
  userId: "u1",
  conversationId: "c1",
  skillCount: 0,
  webEnabled: false,
  searchConfigured: false,
  knowledgeCount: 0,
  contextWindow: 128_000,
};

function dispatchStage(stage: "opening" | "board" | "competitor-board" | "industry-spec-comparison") {
  window.dispatchEvent(new CustomEvent(DISPLAY_STAGE_EVENT, { detail: { stage } }));
}

describe("TEST-163 展示屏阶段可达性 (REQ-F-102)", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-stage-"));
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    window.sessionStorage.clear();
  });
  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("① show_home 带回开场事件，并清掉「已播过」标记", async () => {
    const tools = createDisplayTools(store);
    const showHome = tools.find((tool) => tool.name === "show_home");
    expect(showHome).toBeTruthy();

    const result = await showHome!.execute({}, toolContext);
    expect(result.ok).toBe(true);
    // Clearing the persisted state alone was the old behaviour, and it was not enough.
    expect(store.getDisplayState().kind).toBe("home");
    expect(result.events).toEqual([{ type: "display_stage", stage: "opening" }]);
  });

  it("② show_board 存在、切到看板，并先把持久态清回 home——否则残留的洞察会盖住看板", async () => {
    store.setDisplayState({ kind: "insight", refId: "some-insight" });
    const tools = createDisplayTools(store);
    const showBoard = tools.find((tool) => tool.name === "show_board");
    expect(showBoard).toBeTruthy();

    const result = await showBoard!.execute({}, toolContext);
    expect(result.ok).toBe(true);
    expect(store.getDisplayState().kind).toBe("home");
    expect(result.events).toEqual([{ type: "display_stage", stage: "board" }]);
  });

  it("③ 收到 board 事件切到看板，收到 opening 事件回到标题页——两个方向都通", async () => {
    const { container } = render(<DisplayScreen initial={home} fetchView={async () => home} />);
    expect(container.querySelector(".display-screen--home h1")?.textContent).toBe("Agent-Jarvis");

    await act(async () => dispatchStage("board"));
    await waitFor(() => expect(container.querySelector(".display-screen--board")).toBeTruthy());

    // The half that was missing: getting back. Before this CR the board was terminal.
    await act(async () => dispatchStage("opening"));
    await waitFor(() => expect(container.querySelector(".display-screen--home h1")).toBeTruthy());
    // And the flag must be gone, or the next render bounces straight back to the board.
    expect(window.sessionStorage.getItem(OPENING_PLAYED_KEY)).toBeNull();
  });

  it("③ 回到开场后仍能再切到看板——不是一次性的", async () => {
    const { container } = render(<DisplayScreen initial={home} fetchView={async () => home} />);
    await act(async () => dispatchStage("board"));
    await act(async () => dispatchStage("opening"));
    await act(async () => dispatchStage("board"));
    await waitFor(() => expect(container.querySelector(".display-screen--board")).toBeTruthy());
  });

  it("④ 指针移动不再跳过开场——标题页上没有 onPointerEnter 这类移动处理", async () => {
    const { container } = render(<DisplayScreen initial={home} fetchView={async () => home} />);
    const section = container.querySelector(".display-screen--home") as HTMLElement;
    expect(section).toBeTruthy();

    // pointermove / pointerover are what a mouse does on its own. They must not switch.
    await act(async () => {
      section.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
      section.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    });
    expect(container.querySelector(".display-screen--home h1")).toBeTruthy();
    expect(container.querySelector(".display-screen--board")).toBeNull();
  });

  it("④ 但明确的动作仍然立刻切走——点击算开始工作", async () => {
    const { container } = render(<DisplayScreen initial={home} fetchView={async () => home} />);
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    await waitFor(() => expect(container.querySelector(".display-screen--board")).toBeTruthy());
  });

  it("⑤ 洞察仍然压过两个阶段——持久态优先级不变（DEC-081 未推翻 CR-20260912-display-stage 的 CP-2）", async () => {
    const insight = { kind: "insight", refId: "i1", html: "<h1>报告</h1>" };
    const { container } = render(<DisplayScreen initial={insight} fetchView={async () => insight} />);
    await act(async () => dispatchStage("board"));
    // The board event arrived, but a persisted insight still wins.
    expect(container.querySelector(".display-screen--insight")).toBeTruthy();
    expect(container.querySelector(".display-screen--board")).toBeNull();
  });

  it("⑥ CR-20260918-competitor-board: 收到 competitor-board 事件切到友商看板，洞察仍压过它", async () => {
    const { container } = render(<DisplayScreen initial={home} fetchView={async () => home} />);
    await act(async () => dispatchStage("competitor-board"));
    await waitFor(() => expect(container.querySelector(".display-screen--competitor-board")).toBeTruthy());

    // 和 board 同一条规则：回到 opening 能出来，不是单程票。
    await act(async () => dispatchStage("opening"));
    await waitFor(() => expect(container.querySelector(".display-screen--home h1")).toBeTruthy());

    const insight = { kind: "insight", refId: "i1", html: "<h1>报告</h1>" };
    const rendered = render(<DisplayScreen initial={insight} fetchView={async () => insight} />);
    await act(async () => dispatchStage("competitor-board"));
    expect(rendered.container.querySelector(".display-screen--insight")).toBeTruthy();
    expect(rendered.container.querySelector(".display-screen--competitor-board")).toBeNull();
  });

  it("⑦ CR-20260918-industry-spec-comparison: 收到 industry-spec-comparison 事件切到对比页，洞察仍压过它", async () => {
    const { container } = render(<DisplayScreen initial={home} fetchView={async () => home} />);
    await act(async () => dispatchStage("industry-spec-comparison"));
    await waitFor(() => expect(container.querySelector(".display-screen--industry-spec-comparison")).toBeTruthy());

    // 和 board 同一条规则：回到 opening 能出来，不是单程票。
    await act(async () => dispatchStage("opening"));
    await waitFor(() => expect(container.querySelector(".display-screen--home h1")).toBeTruthy());

    const insight = { kind: "insight", refId: "i1", html: "<h1>报告</h1>" };
    const rendered = render(<DisplayScreen initial={insight} fetchView={async () => insight} />);
    await act(async () => dispatchStage("industry-spec-comparison"));
    expect(rendered.container.querySelector(".display-screen--insight")).toBeTruthy();
    expect(rendered.container.querySelector(".display-screen--industry-spec-comparison")).toBeNull();
  });
});
