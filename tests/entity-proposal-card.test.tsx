// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EntityProposalCard, type EntityProposalPayload } from "@/components/EntityProposalCard";
import { KNOWLEDGE_CHANGED_EVENT } from "@/lib/ui-events";

/**
 * TEST-447 — 对话内提议卡（INPUT-2026-09-15-029 第 2 条；CR-20260915-entity-proposal-card）。
 */

const entityPayload: EntityProposalPayload = { what: "entity", name: "友商-y", title: "友商 Y" };
const updatePayload: EntityProposalPayload = { what: "update", id: "p1", entity: "友商 Y", field: "change", value: "发布新固件" };

describe("EntityProposalCard", () => {
  it("① 新对象卡：采纳调用既有的 pending 路由（不是新写入口），成功后显示已采纳并刷新看板", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    const changed = vi.fn();
    window.addEventListener(KNOWLEDGE_CHANGED_EVENT, changed);
    render(<EntityProposalCard payload={entityPayload} act={act} />);

    expect(screen.getByText("模型提议跟踪对象「友商 Y」")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "采纳" }));
    expect(act).toHaveBeenCalledWith("POST", "/api/entities/pending/%E5%8F%8B%E5%95%86-y");
    await waitFor(() => expect(screen.getByText("已采纳。")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "采纳" })).not.toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
    window.removeEventListener(KNOWLEDGE_CHANGED_EVENT, changed);
  });

  it("② 修改提议卡：忽略调用既有的 proposals 路由，成功后显示已忽略", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    render(<EntityProposalCard payload={updatePayload} act={act} />);

    expect(screen.getByText("模型提议把「友商 Y」的 change 改为「发布新固件」")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "忽略" }));
    expect(act).toHaveBeenCalledWith("DELETE", "/api/entities/proposals/p1");
    await waitFor(() => expect(screen.getByText("已忽略。")).toBeInTheDocument());
  });

  it("③ 失败时原样显示错误原文，按钮收回但没有假装成功", async () => {
    const act = vi.fn(async () => ({ ok: false, message: "该提议已经被处理过了。" }));
    render(<EntityProposalCard payload={updatePayload} act={act} />);

    fireEvent.click(screen.getByRole("button", { name: "采纳" }));
    await waitFor(() => expect(screen.getByText("该提议已经被处理过了。")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "采纳" })).not.toBeInTheDocument();
  });

  it("④ 网络异常时显示网络错误，不吞掉、不假装成功", async () => {
    const act = vi.fn(async () => {
      throw new Error("network down");
    });
    render(<EntityProposalCard payload={entityPayload} act={act} />);

    fireEvent.click(screen.getByRole("button", { name: "忽略" }));
    await waitFor(() => expect(screen.getByText("操作失败：网络错误。")).toBeInTheDocument());
  });

  it("⑤ 处理中按钮禁用，不会连点发两次请求", async () => {
    let resolve!: (value: { ok: boolean }) => void;
    const act = vi.fn(() => new Promise<{ ok: boolean }>((r) => (resolve = r)));
    render(<EntityProposalCard payload={entityPayload} act={act} />);

    const adopt = screen.getByRole("button", { name: "采纳" });
    fireEvent.click(adopt);
    expect(adopt).toBeDisabled();
    fireEvent.click(adopt);
    expect(act).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
    await waitFor(() => expect(screen.getByText("已采纳。")).toBeInTheDocument());
  });
});
