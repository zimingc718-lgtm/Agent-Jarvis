// @vitest-environment jsdom
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, type Store } from "@/lib/store";
import { createDisplayTools } from "@/lib/tools/display-tools";
import { SETTING_DOCUMENT_ROOTS } from "@/lib/documents";
import { SETTING_ARCHIVE_DIR } from "@/lib/insight-export";
import { DisplayScreen } from "@/components/DisplayScreen";
import type { ToolContext, ToolDescriptor } from "@/lib/tools/registry";
import type { DisplayView } from "@/lib/ui-events";

/**
 * TEST-320 ⑦..⑫ — 归档的两条路径（REQ-F-190 ②⑦，DEC-230）。
 *
 * 模型一侧的 `archive_insight` 与看板一侧的「归档」按钮走同一个 `archiveInsight`。这里守的
 * 是两件容易漏的事：**没配目录时工具根本不该注册**（一个注册了却每次都失败的工具白费一轮），
 * 以及**别人的洞察归档不了**（insights 表没有 user_id，所有权来自它挂的会话）。
 */

const encryptionKey = "0123456789abcdef0123456789abcdef";

describe("archive_insight 工具 (REQ-F-190 ②)", () => {
  let dir: string;
  let docs: string;
  let archive: string;
  let store: Store;
  let userId: string;
  let conversationId: string;
  let context: ToolContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-jarvis-archive-"));
    docs = resolve(dir, "docs");
    archive = resolve(docs, "报告");
    mkdirSync(docs, { recursive: true });
    store = createStore(join(dir, "db.sqlite"), encryptionKey);
    userId = store.upsertUser({ email: "u@example.com", name: "U" }).id;
    conversationId = store.createConversation(userId, "chat").id;
    context = {
      userId,
      conversationId,
      skillCount: 0,
      webEnabled: false,
      searchConfigured: false,
      knowledgeCount: 0,
      contextWindow: 128_000,
    };
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function configure() {
    store.setSetting(SETTING_DOCUMENT_ROOTS, JSON.stringify([{ label: "资料", path: docs }]));
    store.setSetting(SETTING_ARCHIVE_DIR, archive);
  }

  function tool(): ToolDescriptor {
    return createDisplayTools(store).find((candidate) => candidate.name === "archive_insight")!;
  }

  it("⑦ 归档目录没配时不注册——注册了却每次都失败的工具比不注册更浪费一轮", () => {
    store.setSetting(SETTING_DOCUMENT_ROOTS, JSON.stringify([{ label: "资料", path: docs }]));
    expect(tool().available(context)).toBe(false);
    configure();
    expect(tool().available(context)).toBe(true);
  });

  it("⑧ 归档成功后文件真的落盘，且回话里给出可再读回的标识", async () => {
    configure();
    const insight = store.insertInsight({ conversationId: conversationId, kind: "skill", html: "<h1>母线试点</h1><p>结论</p>" });
    const result = await tool().execute({ insightId: insight.id }, context);

    expect(result.ok).toBe(true);
    expect(result.content).toContain("资料/报告/");
    expect(result.content).toContain("read_document");
    const written = readdirSync(archive);
    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith(".md")).toBe(true);
  });

  it("⑨ 别人的洞察归档不了——所有权来自它挂的会话，不是它的 id", async () => {
    configure();
    const otherUser = store.upsertUser({ email: "other@example.com", name: "O" }).id;
    const otherConversation = store.createConversation(otherUser, "chat").id;
    const insight = store.insertInsight({ conversationId: otherConversation, kind: "skill", html: "<p>别人的</p>" });

    const result = await tool().execute({ insightId: insight.id }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("不属于当前用户");
    expect(readdirSync(docs)).not.toContain("报告");
  });

  it("⑩ 归档目录越界时拒绝，并说清边界——不是「失败」两个字", async () => {
    const outside = resolve(dir, "outside");
    mkdirSync(outside, { recursive: true });
    store.setSetting(SETTING_DOCUMENT_ROOTS, JSON.stringify([{ label: "资料", path: docs }]));
    store.setSetting(SETTING_ARCHIVE_DIR, outside);
    const insight = store.insertInsight({ conversationId: conversationId, kind: "skill", html: "<p>正文</p>" });

    const result = await tool().execute({ insightId: insight.id }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("已拒绝");
    expect(readdirSync(outside)).toHaveLength(0);
  });
});

describe("展示屏上的归档按钮 (REQ-F-190 ⑦)", () => {
  const insight: DisplayView = { kind: "insight", refId: "ins-7", html: "<h1>报告</h1>" };

  it("⑪ 点「归档」调用归档并就地说出写到哪儿了", async () => {
    const calls: string[] = [];
    render(
      <DisplayScreen
        initial={insight}
        fetchView={async () => insight}
        archiveInsight={async (id) => {
          calls.push(id);
          return { ok: true, id: "资料/报告/2026-09-14-报告.md" };
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /归档/ }));
    await waitFor(() => expect(screen.getByText(/已归档为 资料\/报告/)).toBeInTheDocument());
    expect(calls).toEqual(["ins-7"]);
  });

  it("⑫ 失败时把原因照原样显示出来——那句话通常是「目录还没配好」", async () => {
    render(
      <DisplayScreen
        initial={insight}
        fetchView={async () => insight}
        archiveInsight={async () => ({ ok: false, message: "尚未设置归档目录。" })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /归档/ }));
    await waitFor(() => expect(screen.getByText("尚未设置归档目录。")).toBeInTheDocument());
  });
});
