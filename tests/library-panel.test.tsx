// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryPanel, type LibraryItemView, type LibraryPanelValue } from "@/components/LibraryPanel";

/**
 * TEST-410 — 资料库审批面板（REQ-F-220 ③；CR-20260915-library-adoption CP-3）。
 *
 * 守四件事：默认只看待采纳、逐条能通过/拒绝、「本组全部通过」带的是一串**具体 id**
 * （不是「按目录一刀切」的另一种说法）、以及计数与筛选各自独立——计数始终是全量的，
 * 否则「还剩多少要审」就没地方看。
 */

function item(overrides: Partial<LibraryItemView> = {}): LibraryItemView {
  return {
    id: "AIDC/02_原文/P1_diablo.pdf",
    collection: "AIDC",
    group: "02_原文",
    name: "P1_diablo.pdf",
    ext: ".pdf",
    bytes: 2 * 1024 * 1024,
    status: "pending",
    decidedAt: "",
    no: "P1",
    title: "Diablo 400 规范",
    sourceUrl: "https://example.org/d",
    org: "OCP",
    level: "一手",
    retrieval: "直取",
    ...overrides,
  };
}

const counts = { total: 3, pending: 2, adopted: 1, rejected: 0 };

function value(items: LibraryItemView[]): LibraryPanelValue {
  return { items, counts };
}

describe("TEST-410 资料库审批面板 (REQ-F-220)", () => {
  it("① 默认只列待采纳，并把「已采纳才可查阅」说在明处", async () => {
    const load = vi.fn(async (filter: string) =>
      value(
        filter === "pending"
          ? [item(), item({ id: "AIDC/02_原文/G2.html", name: "G2.html", ext: ".html", no: "G2", title: "振荡分析" })]
          : []
      )
    );
    render(<LibraryPanel load={load} decide={async () => {}} />);

    await waitFor(() => expect(screen.getByText(/Diablo 400 规范/)).toBeInTheDocument());
    expect(load).toHaveBeenCalledWith("pending");
    expect(screen.getByText(/只有已采纳的资料能在对话里被检索和引用/)).toBeInTheDocument();
    expect(screen.getByText(/共 3 份/)).toBeInTheDocument();
    expect(screen.getByText(/振荡分析/)).toBeInTheDocument();
  });

  it("② 逐条通过：只带自己那一个 id", async () => {
    const decide = vi.fn(async () => {});
    render(<LibraryPanel load={async () => value([item()])} decide={decide} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith(["AIDC/02_原文/P1_diablo.pdf"], "adopted"));
  });

  it("③ 「本组全部通过」带的是这一组里每一条的 id——落到登记里仍是逐条判断", async () => {
    const decide = vi.fn(async () => {});
    const items = [item(), item({ id: "AIDC/02_原文/G2.html", name: "G2.html", no: "G2", title: "振荡分析" })];
    render(<LibraryPanel load={async () => value(items)} decide={decide} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "本组全部通过" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "本组全部通过" }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(["AIDC/02_原文/P1_diablo.pdf", "AIDC/02_原文/G2.html"], "adopted")
    );
  });

  it("④ 切到「已采纳」时重新取数，并给出撤回判断的入口", async () => {
    const load = vi.fn(async (filter: string) =>
      value(filter === "adopted" ? [item({ status: "adopted", decidedAt: "2026-09-15T10:00:00.000Z" })] : [])
    );
    render(<LibraryPanel load={load} decide={async () => {}} />);

    await waitFor(() => expect(screen.getByText(/待采纳区是空的/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "已采纳" }));

    await waitFor(() => expect(load).toHaveBeenCalledWith("adopted"));
    await waitFor(() => expect(screen.getByRole("button", { name: "撤回判断" })).toBeInTheDocument());
    expect(screen.getByText(/已采纳 · 2026-09-15/)).toBeInTheDocument();
    // 批量只在待采纳队列里给：已经审完的那一批再来一次「全部通过」没有意义。
    expect(screen.queryByRole("button", { name: "本组全部通过" })).not.toBeInTheDocument();
  });

  it("⑤ 裁定失败把服务端的原话说出来，不是一句「出错了」", async () => {
    const decide = vi.fn(async () => {
      throw new Error("资料库里没有这些条目：AIDC/没有.pdf。");
    });
    render(<LibraryPanel load={async () => value([item()])} decide={decide} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("资料库里没有这些条目"));
  });
});
