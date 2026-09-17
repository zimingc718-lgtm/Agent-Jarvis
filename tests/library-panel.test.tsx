// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryPanel, type BrowseCardView, type BrowsePageView, type LibraryItemView, type LibraryPanelValue } from "@/components/LibraryPanel";

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

function card(overrides: Partial<BrowseCardView> = {}): BrowseCardView {
  return {
    kind: "library",
    id: "AIDC/02_原文/P1_diablo.pdf",
    title: "Diablo 400 规范",
    docType: "一手",
    entity: "",
    bytes: 2 * 1024 * 1024,
    updatedAt: "2026-09-15T10:00:00.000Z",
    sourceUrl: "https://example.org/d",
    documentId: "资料库/AIDC/02_原文/P1_diablo.pdf",
    ...overrides,
  };
}

function browsePage(cards: BrowseCardView[], overrides: Partial<BrowsePageView> = {}): BrowsePageView {
  return { cards, total: cards.length, byType: {}, offset: 0, limit: 20, ...overrides };
}

describe("TEST-448 统一浏览视图 (CR-20260915-knowledge-library-merge CP-2)", () => {
  it("① 切到「浏览」显示统一列表与类型统计；资料库卡带「查看原文」，知识条目不带", async () => {
    const cards = [
      card(),
      card({ kind: "note", id: "现场记录", title: "现场记录", docType: "现场笔记", entity: "某某公司", documentId: "", sourceUrl: "" }),
    ];
    const loadBrowse = vi.fn(async () => browsePage(cards, { total: 2, byType: { 一手: 1, 现场笔记: 1 } }));
    render(<LibraryPanel load={async () => value([])} decide={async () => {}} loadBrowse={loadBrowse} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "浏览" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "浏览" }));

    await waitFor(() => expect(loadBrowse).toHaveBeenCalledWith(0));
    await waitFor(() => expect(screen.getByText("Diablo 400 规范")).toBeInTheDocument());
    expect(screen.getByText("现场记录")).toBeInTheDocument();
    expect(screen.getByText(/一手 1/)).toBeInTheDocument();
    expect(screen.getByText(/现场笔记 1/)).toBeInTheDocument();

    // 只有资料库那张卡带原文链接——`getByRole` 单数形式本身就要求唯一命中，知识条目那张
    // 没有对应的字节可查看，不会渲染出第二个同名链接。
    const rawLink = screen.getByRole("link", { name: "查看原文" });
    expect(rawLink).toHaveAttribute("href", `/api/documents/raw?id=${encodeURIComponent(card().documentId)}`);
  });

  it("② 翻页用新 offset 重新取数；到底时「下一页」禁用", async () => {
    const loadBrowse = vi.fn(async (offset: number) =>
      browsePage([card({ id: `p${offset}`, title: `第 ${offset} 页`, updatedAt: "2026-09-16T00:00:00.000Z" })], {
        total: 25,
        offset,
        limit: 20,
      })
    );
    render(<LibraryPanel load={async () => value([])} decide={async () => {}} loadBrowse={loadBrowse} />);

    fireEvent.click(await screen.findByRole("button", { name: "浏览" }));
    await waitFor(() => expect(screen.getByText("第 0 页")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(loadBrowse).toHaveBeenCalledWith(20));
    await waitFor(() => expect(screen.getByText("第 20 页")).toBeInTheDocument());
    // 25 条，offset 20 + limit 20 已经越过总数——到底了。
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  });

  it("③ 浏览列表读取失败给出提示", async () => {
    const loadBrowse = vi.fn(async () => {
      throw new Error("网络异常");
    });
    render(<LibraryPanel load={async () => value([])} decide={async () => {}} loadBrowse={loadBrowse} />);

    fireEvent.click(await screen.findByRole("button", { name: "浏览" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("读不到浏览列表"));
  });

  it("④ 浏览列表为空时如实说明，不是留白", async () => {
    const loadBrowse = vi.fn(async () => browsePage([]));
    render(<LibraryPanel load={async () => value([])} decide={async () => {}} loadBrowse={loadBrowse} />);

    fireEvent.click(await screen.findByRole("button", { name: "浏览" }));
    await waitFor(() => expect(screen.getByText(/还没有已采纳的资料或知识条目/)).toBeInTheDocument());
  });
});
