// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  KnowledgeDashboard,
  type DashboardData,
  type DashboardEntity,
  type OverviewData,
} from "@/components/KnowledgeDashboard";

/** TEST-123 — the board (CR-20260911-home-dashboard §2 §3 §4 §7). */

const entity = (over: Partial<DashboardEntity> & Pick<DashboardEntity, "name" | "kind" | "title">): DashboardEntity => ({
  summary: "",
  capacity: "",
  nextLabel: "",
  nextDate: "",
  health: "unconfigured",
  checkedAt: "",
  change: "",
  changeAt: "",
  seenAt: "",
  sources: [],
  createdAt: "2026-09-11T00:00:00Z",
  unread: false,
  ...over,
});

const overview: OverviewData = {
  total: 12,
  byEntity: { "友商-a": 6 },
  byType: { 产品规格书: 7, 未分类: 5 },
  unowned: 5,
  misses: [
    { query: "液冷选型对比", count: 3, last: "2026-09-11T00:00:00Z" },
    { query: "并网队列位置", count: 1, last: "2026-09-10T00:00:00Z" },
  ],
};

const board: DashboardData = {
  entities: [
    entity({ name: "友商-a", kind: "competitor", title: "友商 A", summary: "边缘网关", change: "发布 v4.2 固件", unread: true, health: "fresh", sources: ["https://a.example"] }),
    entity({ name: "友商-b", kind: "competitor", title: "友商 B", change: "无新变更", health: "parse_failed", sources: ["https://b.example"] }),
    entity({ name: "tso-a", kind: "authority", title: "TSO A", capacity: "可用 1.2 GW", nextLabel: "意见截止", nextDate: "10-15", health: "stale", sources: ["https://tso.example"] }),
    entity({ name: "客户-c", kind: "customer", title: "客户 C", capacity: "需 200 MW", health: "unconfigured" }),
  ],
  pending: [entity({ name: "友商-x", kind: "competitor", title: "友商 X" })],
  proposals: [
    { id: "tso-a-capacity-2026", entity: "tso-a", field: "capacity", value: "可用 0.8 GW", url: "https://tso.example/cap", locator: "表 3", createdAt: "2026-09-11T00:00:00Z" },
  ],
};

const noop = async () => ({ ok: true });

describe("KnowledgeDashboard", () => {
  it("① 三条泳道各就各位，友商用网格，其余用列表", async () => {
    render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={noop} />);
    await waitFor(() => expect(screen.getByRole("region", { name: "知识看板" })).toBeInTheDocument());
    expect(within(screen.getByRole("region", { name: "友商" })).getByText("友商 A")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "规则与准入方" })).getByText("TSO A")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "客户" })).getByText("客户 C")).toBeInTheDocument();
    expect(screen.getByText("顺序固定，不按新鲜度重排")).toBeInTheDocument();
  });

  it("② 每张卡同时给出内容变化与采集健康度，两者分开", async () => {
    const { container } = render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={noop} />);
    await waitFor(() => expect(screen.getByText("友商 A")).toBeInTheDocument());

    // Unread change on A, collection fine.
    expect(screen.getByText("发布 v4.2 固件")).toBeInTheDocument();
    expect(screen.getAllByText("采集正常").length).toBeGreaterThan(0);
    // B has nothing new AND a broken parser: the second fact is the one that matters.
    expect(screen.getByText("解析失败")).toBeInTheDocument();
    // C has never been configured, which is not the same as quiet.
    expect(screen.getByText("未配置采集源")).toBeInTheDocument();
    expect(screen.getByText("信息陈旧")).toBeInTheDocument();
    expect(container.querySelectorAll(".knowledge-dashboard__card")).toHaveLength(4);
  });

  it("③ 汇总条数出未读、采集异常与待采纳", async () => {
    render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={noop} />);
    await waitFor(() => expect(screen.getByText("1 项未读变更")).toBeInTheDocument());
    expect(screen.getByText("1 个采集异常")).toBeInTheDocument();
    expect(screen.getByText("2 条待采纳")).toBeInTheDocument();
  });

  it("④ 点开卡片即算已读：展开的同时打了 seen", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={act} />);
    await waitFor(() => expect(screen.getByText("友商 A")).toBeInTheDocument());

    const toggle = screen.getByText("友商 A").closest("button")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"));
    expect(act).toHaveBeenCalledWith("PATCH", "/api/entities/%E5%8F%8B%E5%95%86-a", { action: "seen" });
  });

  it("⑤ 卡片点开是源管理，不是第二个应用；没有源时说清「安静不代表事实」", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={act} />);
    await waitFor(() => expect(screen.getByText("客户 C")).toBeInTheDocument());

    fireEvent.click(screen.getByText("客户 C").closest("button")!);
    await waitFor(() => expect(screen.getByText(/这张卡的安静不代表任何事实/)).toBeInTheDocument());

    const input = screen.getByLabelText("为 客户 C 添加采集源");
    fireEvent.change(input, { target: { value: "https://c.example/news" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(act).toHaveBeenCalledWith("PATCH", "/api/entities/%E5%AE%A2%E6%88%B7-c", { action: "addSource", url: "https://c.example/news" })
    );
  });

  it("⑥ 卡片把问题交给对话框，不在卡里执行", async () => {
    const onAsk = vi.fn();
    render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={noop} onAsk={onAsk} />);
    await waitFor(() => expect(screen.getByText("TSO A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("TSO A").closest("button")!);
    fireEvent.click(await screen.findByText("问 Jarvis 关于这个对象"));
    expect(onAsk).toHaveBeenCalledWith("关于「TSO A」，");
  });

  it("⑦ 待采纳区同时列出新对象与字段修改，采纳各走各的路由", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={act} />);
    const queue = await screen.findByRole("region", { name: "待采纳的提议" });
    expect(within(queue).getByText("新对象：友商 X")).toBeInTheDocument();
    expect(within(queue).getByText("tso-a · capacity → 可用 0.8 GW")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "采纳新对象「友商 X」" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/entities/pending/%E5%8F%8B%E5%95%86-x", undefined));

    fireEvent.click(screen.getByRole("button", { name: "采纳修改 tso-a 的 capacity" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/entities/proposals/tso-a-capacity-2026", undefined));
  });

  it("⑧ 知识库总览：缺口按次数排、无归属显式计数、库内篇数落到卡片上", async () => {
    render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={noop} />);
    await waitFor(() => expect(screen.getByText("液冷选型对比")).toBeInTheDocument());
    expect(screen.getByText("共 12 条 · 无归属 5 条")).toBeInTheDocument();
    expect(screen.getByText(/库内 6 篇/)).toBeInTheDocument();
    const misses = screen.getByText("液冷选型对比").closest("ul")!;
    expect(within(misses).getAllByRole("listitem")[0]).toHaveTextContent("液冷选型对比");
  });

  it("⑨ 空看板不假装有数据，并说明怎么添加", async () => {
    render(
      <KnowledgeDashboard
        loadBoard={async () => ({ entities: [], pending: [], proposals: [] })}
        loadOverview={async () => ({ total: 0, byEntity: {}, byType: {}, unowned: 0, misses: [] })}
        act={noop}
      />
    );
    await waitFor(() => expect(screen.getByText("还没有友商。在对话里说一句，让 Jarvis 提议一个。")).toBeInTheDocument());
    expect(screen.getByText(/还没有查不到的检索/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "待采纳的提议" })).not.toBeInTheDocument();
  });

  it("⑩ 巡检条：默认关、开关即保存、「立即巡检一轮」带 force，未采集过时明说", async () => {
    const saveSweep = vi.fn(async (patch: Record<string, unknown>) => ({
      enabled: patch.enabled === true,
      intervalMinutes: 180,
      maxPerRound: 6,
      lastRun: "",
    }));
    const runSweepRound = vi.fn(async () => ({ ran: true, reason: "采集 2 个源，没有变化。", remaining: 3 }));
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => true}
        loadBoard={async () => board}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
        runSweepRound={runSweepRound}
        saveSweep={saveSweep}
      />
    );
    const bar = await screen.findByRole("region", { name: "定时巡检" });
    // Off by default, and it says so rather than implying everything is current.
    expect(within(bar).getByRole("checkbox")).not.toBeChecked();
    expect(within(bar).getByText("还没有巡检过")).toBeInTheDocument();
    // Nothing runs on its own while the schedule is off.
    expect(runSweepRound).not.toHaveBeenCalled();

    fireEvent.click(within(bar).getByRole("checkbox"));
    await waitFor(() => expect(saveSweep).toHaveBeenCalledWith({ enabled: true }));

    fireEvent.click(within(bar).getByRole("button", { name: "立即巡检一轮" }));
    await waitFor(() => expect(runSweepRound).toHaveBeenCalledWith(true));
    expect(await screen.findByText("采集 2 个源，没有变化。还有 3 个源排队。")).toBeInTheDocument();
  });

  it("⑪ 看板不在屏幕上时，计划轮次不发起——不在后台替用户敲别人的服务器", async () => {
    const runSweepRound = vi.fn(async () => ({ ran: true, reason: "采集 1 个源，没有变化。", remaining: 0 }));
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => false}
        loadBoard={async () => board}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: true, intervalMinutes: 30, maxPerRound: 6, lastRun: "2026-09-11T00:00:00Z" })}
        runSweepRound={runSweepRound}
      />
    );
    await screen.findByRole("region", { name: "定时巡检" });
    await waitFor(() => expect(screen.getByRole("region", { name: "定时巡检" })).toBeInTheDocument());
    expect(runSweepRound).not.toHaveBeenCalled();
  });
});
