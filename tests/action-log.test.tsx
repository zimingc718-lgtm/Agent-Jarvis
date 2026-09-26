// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionLog, type ActionLogEntry } from "@/components/ActionLog";

/**
 * TEST-552 — the 操作记录 page (REQ-F-320 ②, DEC-430 ①; CR-20260925-write-approval-action-log):
 * an entry row in the drawer, the list in a dialog, writes + outbound by default, everything
 * behind 「显示全部」 (user ruling 2026-09-25).
 */

const rows: ActionLogEntry[] = [
  {
    id: "a1",
    conversationId: "c1",
    conversationTitle: "并网规则跟踪",
    tool: "save_knowledge",
    effect: "write",
    argsSummary: '{"title":"x"}',
    outcome: "ok",
    summary: "已存为知识条目",
    createdAt: "2026-09-25T10:00:00.000Z",
  },
  {
    id: "a2",
    conversationId: "c1",
    conversationTitle: "并网规则跟踪",
    tool: "read_url",
    effect: "network",
    argsSummary: '{"url":"https://a.example"}',
    outcome: "failed",
    summary: "失败：403",
    createdAt: "2026-09-25T09:00:00.000Z",
  },
];
const reads: ActionLogEntry[] = [
  { id: "a3", conversationId: "c2", tool: "list_skills", effect: "read", argsSummary: "{}", outcome: "ok", summary: "列出 8 个技能", createdAt: "2026-09-25T08:00:00.000Z" },
];

describe("TEST-552 ActionLog (REQ-F-320 ②)", () => {
  it("入口行在抽屉里、列表在对话框内；打开前不请求，默认只要写与出网，「显示全部」后再要全部", async () => {
    const load = vi.fn(async ({ effects }: { effects: ActionLogEntry["effect"][] | null; limit: number }) => (effects ? rows : [...rows, ...reads]));
    render(<ActionLog load={load} />);

    expect(screen.getByRole("button", { name: "查看操作记录" })).toBeInTheDocument();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "查看操作记录" }));
    expect(document.querySelector("dialog[open]")).not.toBeNull();
    await waitFor(() => expect(screen.getByText("save_knowledge")).toBeInTheDocument());
    expect(load).toHaveBeenCalledWith({ effects: ["write", "network"], limit: 100 });
    expect(screen.getByText("read_url")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.getByText("出网")).toBeInTheDocument();
    expect(screen.getAllByText(/会话：并网规则跟踪/)).toHaveLength(2);
    expect(screen.queryByText("list_skills")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "显示全部工具调用" }));
    await waitFor(() => expect(screen.getByText("list_skills")).toBeInTheDocument());
    expect(load).toHaveBeenLastCalledWith({ effects: null, limit: 100 });
    // A row whose conversation is gone still says which id it belonged to.
    expect(screen.getByText(/会话：c2/)).toBeInTheDocument();
  });

  it("空列表说明默认筛选的存在；读取失败有 alert", async () => {
    const empty = render(<ActionLog load={async () => []} />);
    fireEvent.click(screen.getByRole("button", { name: "查看操作记录" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/还没有写入或出网类的调用/));
    // `render()` queries are bound to document.body, so the first instance must go before a second one mounts.
    empty.unmount();

    const failing = render(
      <ActionLog
        load={async () => {
          throw new Error("offline");
        }}
      />
    );
    fireEvent.click(failing.getByRole("button", { name: "查看操作记录" }));
    await waitFor(() => expect(failing.getByRole("alert")).toHaveTextContent("操作记录读取失败。"));
  });
});
