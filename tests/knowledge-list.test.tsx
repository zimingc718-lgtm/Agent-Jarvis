// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeList, type KnowledgeListData } from "@/components/KnowledgeList";
import { KNOWLEDGE_CHANGED_EVENT } from "@/lib/ui-events";

/** TEST-088 ①②③ — the ☰ knowledge list with its adoption queue (REQ-F-044 ③④, REQ-F-046 ③; TASK-085). */

const entry = (name: string, title: string, source = "manual") => ({ name, title, source, createdAt: "2026-09-11T00:00:00Z", bytes: 10 });

describe("KnowledgeList", () => {
  it("① renders entries with title, source label and name; empty state says how to add", async () => {
    render(
      <KnowledgeList
        fetchKnowledge={async () => ({ entries: [entry("部署说明", "部署说明", "file"), entry("风格", "回答风格", "conversation")], pending: [] })}
      />
    );
    await waitFor(() => expect(screen.getByText("部署说明")).toBeInTheDocument());
    expect(screen.getByText("文件 · 部署说明")).toBeInTheDocument();
    expect(screen.getByText("对话 · 风格")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "待采纳的知识提议" })).not.toBeInTheDocument();
  });

  it("empty state", async () => {
    render(<KnowledgeList fetchKnowledge={async () => ({ entries: [], pending: [] })} />);
    await waitFor(() => expect(screen.getByText(/知识库为空/)).toBeInTheDocument());
  });

  it("② the pending queue renders first with a count, and 采纳 posts to the pending route then refetches", async () => {
    let data: KnowledgeListData = { entries: [], pending: [entry("用户偏好", "用户偏好", "model")] };
    const fetchKnowledge = vi.fn(async () => data);
    const request = vi.fn(async (_method: "POST" | "DELETE", _url: string) => {
      data = { entries: [entry("用户偏好", "用户偏好", "model")], pending: [] };
      return { ok: true };
    });

    render(<KnowledgeList fetchKnowledge={fetchKnowledge} request={request} />);
    await waitFor(() => expect(screen.getByRole("region", { name: "待采纳的知识提议" })).toBeInTheDocument());
    expect(screen.getByText(/待采纳（1）/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "采纳知识提议「用户偏好」" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", "/api/knowledge/pending/%E7%94%A8%E6%88%B7%E5%81%8F%E5%A5%BD"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已采纳「用户偏好」。"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "待采纳的知识提议" })).not.toBeInTheDocument());
    expect(screen.getByText("模型提议 · 用户偏好")).toBeInTheDocument();
  });

  it("忽略 deletes from the pending route; a failed request surfaces the server message", async () => {
    const request = vi.fn(async () => ({ ok: false, message: "待采纳区没有「x」。" }));
    render(
      <KnowledgeList
        fetchKnowledge={async () => ({ entries: [], pending: [entry("x", "临时", "model")] })}
        request={request}
      />
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "忽略知识提议「临时」" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "忽略知识提议「临时」" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("DELETE", "/api/knowledge/pending/x"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("待采纳区没有「x」。"));
  });

  it("③ refetches on jarvis:knowledge-changed; 删除 asks first and hits the entry route", async () => {
    let data: KnowledgeListData = { entries: [entry("a", "第一条")], pending: [] };
    const fetchKnowledge = vi.fn(async () => data);
    const request = vi.fn(async () => ({ ok: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<KnowledgeList fetchKnowledge={fetchKnowledge} request={request} />);
    await waitFor(() => expect(screen.getByText("第一条")).toBeInTheDocument());

    data = { entries: [entry("a", "第一条"), entry("b", "第二条")], pending: [] };
    window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));
    await waitFor(() => expect(screen.getByText("第二条")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "删除知识条目「第一条」" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("DELETE", "/api/knowledge/a"));
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });
});
