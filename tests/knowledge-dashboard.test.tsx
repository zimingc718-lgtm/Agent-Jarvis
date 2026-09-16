// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KNOWLEDGE_CHANGED_EVENT } from "@/lib/ui-events";
import {
  KnowledgeDashboard,
  type DashboardData,
  type DashboardEntity,
  type OverviewData,
} from "@/components/KnowledgeDashboard";

/** TEST-123 — the board (CR-20260911-home-dashboard §2 §3 §4 §7). */

const entity = (over: Partial<DashboardEntity> & Pick<DashboardEntity, "name" | "kind" | "title">): DashboardEntity => ({
  summary: "",
  params: [],
  unmet: 0,
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
    await waitFor(() =>
      expect(screen.getByText("还没有友商。可以点 + 直接添加，也可以在对话里让 Jarvis 提议。")).toBeInTheDocument()
    );
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

  it("⑫ 三条泳道各自能直接新增对象，kind 由泳道决定，不需要用户选；新增卡片默认收拢成 +", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    render(
      <KnowledgeDashboard
        act={act}
        isVisible={() => false}
        loadBoard={async () => board}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
      />
    );
    const lane = await screen.findByRole("region", { name: "客户" });
    // Collapsed by default: no text input until the + tile is clicked.
    expect(within(lane).queryByRole("textbox", { name: "新增客户" })).not.toBeInTheDocument();
    fireEvent.click(within(lane).getByRole("button", { name: "新增客户" }));
    const input = within(lane).getByLabelText("新增客户");
    fireEvent.change(input, { target: { value: "客户 D" } });
    fireEvent.click(within(lane).getByRole("button", { name: "添加" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/entities", { kind: "customer", title: "客户 D" }));
    // Submitting collapses the tile back to +.
    await waitFor(() => expect(within(lane).queryByRole("textbox", { name: "新增客户" })).not.toBeInTheDocument());

    // The model's path still goes through the pending queue; this one is the user's own
    // action, so it lands directly — the same split the API already makes.
    const rules = screen.getByRole("region", { name: "规则与准入方" });
    fireEvent.click(within(rules).getByRole("button", { name: "新增规则与准入方" }));
    fireEvent.change(within(rules).getByLabelText("新增规则与准入方"), { target: { value: "TSO B" } });
    fireEvent.click(within(rules).getByRole("button", { name: "添加" }));
    await waitFor(() => expect(act).toHaveBeenLastCalledWith("POST", "/api/entities", { kind: "authority", title: "TSO B" }));
  });

  it("⑬ 空名不发请求；取消按钮收回卡片不留输入", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    render(
      <KnowledgeDashboard
        act={act}
        isVisible={() => false}
        loadBoard={async () => ({ entities: [], pending: [], proposals: [] })}
        loadOverview={async () => ({ total: 0, byEntity: {}, byType: {}, unowned: 0, misses: [] })}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
      />
    );
    const lane = await screen.findByRole("region", { name: "友商" });
    fireEvent.click(within(lane).getByRole("button", { name: "新增友商" }));
    fireEvent.click(within(lane).getByRole("button", { name: "添加" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "友商" })).toBeInTheDocument());
    expect(act).not.toHaveBeenCalled();

    fireEvent.change(within(lane).getByLabelText("新增友商"), { target: { value: "还没提交就反悔" } });
    fireEvent.click(within(lane).getByRole("button", { name: "取消新增友商" }));
    expect(within(lane).queryByRole("textbox", { name: "新增友商" })).not.toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();
  });

  it("⑭ 技术要求是主轴：汇总条先说未对上几条，卡片芯片也换成它", async () => {
    const withParams: DashboardData = {
      ...board,
      entities: [
        entity({
          name: "tso-p",
          kind: "authority",
          title: "TSO P",
          capacity: "可用 1.2 GW",
          params: [
            { name: "LVRT 持续时间", value: "150 ms", status: "unmet" },
            { name: "谐波", value: "3%", status: "meets" },
          ],
          unmet: 1,
        }),
      ],
      pending: [],
      proposals: [],
    };
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => false}
        loadBoard={async () => withParams}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
      />
    );
    await waitFor(() => expect(screen.getByText("1 条要求未对上 · 共 2 条")).toBeInTheDocument());
    // The chip slot belongs to requirements now; capacity moved inside the card.
    expect(screen.getByText("未对上 1/2")).toBeInTheDocument();
    expect(screen.queryByText("可用 1.2 GW")).not.toBeInTheDocument();
  });

  it("⑮ 展开后能看参数、切换我方状态、删除、写一条新的；状态只走 paramStatus", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    const withParams: DashboardData = {
      ...board,
      entities: [
        entity({
          name: "tso-p",
          kind: "authority",
          title: "TSO P",
          params: [{ name: "LVRT 持续时间", value: "150 ms", status: "unknown" }],
          unmet: 0,
        }),
      ],
      pending: [],
      proposals: [],
    };
    render(
      <KnowledgeDashboard
        act={act}
        isVisible={() => false}
        loadBoard={async () => withParams}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
      />
    );
    fireEvent.click(await screen.findByText("TSO P"));
    expect(await screen.findByText("LVRT 持续时间 = 150 ms")).toBeInTheDocument();

    // unknown → meets on the first click; a person decides this, never a tool.
    fireEvent.click(screen.getByRole("button", { name: /我方未判定，点击切换/ }));
    await waitFor(() =>
      expect(act).toHaveBeenCalledWith("PATCH", "/api/entities/tso-p", {
        action: "paramStatus",
        param: "LVRT 持续时间",
        status: "meets",
      })
    );

    fireEvent.change(screen.getByLabelText("为 TSO P 添加技术要求"), { target: { value: "谐波" } });
    fireEvent.change(screen.getByLabelText("TSO P 的要求取值"), { target: { value: "3%" } });
    fireEvent.click(screen.getByRole("button", { name: "写入" }));
    await waitFor(() =>
      expect(act).toHaveBeenLastCalledWith("PATCH", "/api/entities/tso-p", { action: "setParam", param: "谐波", value: "3%" })
    );

    fireEvent.click(screen.getByRole("button", { name: "删除 TSO P 的参数 LVRT 持续时间" }));
    await waitFor(() =>
      expect(act).toHaveBeenLastCalledWith("PATCH", "/api/entities/tso-p", { action: "removeParam", param: "LVRT 持续时间" })
    );
  });

  it("⑯ 推断项与有据可查项在卡片上不得长得一样（REQ-F-180 ⑥）", async () => {
    const withBasis: DashboardData = {
      ...board,
      entities: [
        entity({
          name: "tso-p",
          kind: "authority",
          title: "TSO P",
          params: [
            { name: "核对过的", value: "150 ms", status: "unknown" },
            { name: "没核对的", value: "整体领先", status: "unknown" },
          ],
          unmet: 0,
          quoted: ["核对过的"],
          cited: ["核对过的", "没核对的"],
        }),
      ],
      pending: [],
      proposals: [],
    };
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => false}
        loadBoard={async () => withBasis}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
      />
    );
    fireEvent.click(await screen.findByText("TSO P"));
    const checked = (await screen.findByText(/核对过的 =/)).closest("li");
    const unchecked = (await screen.findByText(/没核对的 =/)).closest("li");
    expect(unchecked?.textContent).toContain("推断");
    expect(checked?.textContent).not.toContain("推断");
  });

  it("⑰ 白名单字段同样要分辨：有出处没核对的标推断，用户自己填的不标", async () => {
    const withFields: DashboardData = {
      ...board,
      entities: [
        entity({
          name: "tso-q",
          kind: "authority",
          title: "TSO Q",
          change: "限值上调至 250kW",
          capacity: "可用 1.2 GW",
          quoted: [],
          // change 有出处但没核对过；capacity 根本没有出处，是用户自己填的。
          cited: ["change"],
        }),
      ],
      pending: [],
      proposals: [],
    };
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => false}
        loadBoard={async () => withFields}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
      />
    );
    const changeRow = (await screen.findByText("限值上调至 250kW")).closest("span");
    expect(changeRow?.parentElement?.textContent).toContain("推断");

    fireEvent.click(screen.getByText("TSO Q"));
    const capacityRow = (await screen.findByText(/容量：/)).closest("p");
    // 用户自己填的值没有出处，它不是推断——把它说成推断是另一种谎。
    expect(capacityRow?.textContent).not.toContain("推断");
  });

  it("⑱ `__通用__` 是具名分组，不并进「无归属」（REQ-F-170 ③）", async () => {
    const withGeneral: OverviewData = {
      ...overview,
      total: 12,
      unowned: 5,
      byEntity: { ...overview.byEntity, "__通用__": 3 },
    };
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => false}
        loadBoard={async () => board}
        loadOverview={async () => withGeneral}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
      />
    );
    // 两个数必须同时在，而且是两个数——合并了就看不出模型是不是在往通用桶里丢。
    await waitFor(() => expect(screen.getByText(/共 12 条 · 无归属 5 条 · 通用 3 条/)).toBeInTheDocument());
  });

  it("⑲ 通用桶为零时不显示——那不是信号，是噪声", async () => {
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => false}
        loadBoard={async () => board}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
      />
    );
    await waitFor(() => expect(screen.getByText(/共 12 条 · 无归属 5 条/)).toBeInTheDocument());
    expect(screen.queryByText(/通用/)).not.toBeInTheDocument();
  });

  it("⑳ 看板与工具用的是同一个字面量——两处各写一份，不许漂移", async () => {
    const { GENERAL_ENTITY } = await import("@/lib/tools/knowledge-tools");
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/components/KnowledgeDashboard.tsx", "utf8")
    );
    expect(source).toContain(`const GENERAL_ENTITY = "${GENERAL_ENTITY}"`);
  });

  it("重渲染不再发起额外的巡检——tick 跟时间走，不跟渲染走（CR-20260915-board-tick-burst）", async () => {
    // 故意不传 loadBoard / loadOverview / loadSweep / isVisible：要复现的正是这四个
    // **参数默认值**每次渲染都是新函数、于是 effect 每次渲染都重跑的毛病。传稳定的 mock
    // 进去就把缺陷绕开了。2026-09-15 用真浏览器打开看板，一挂载就连发十几个巡检请求。
    const posts: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/entities/sweep") && method === "POST") {
        posts.push(url);
        return new Response(JSON.stringify({ ran: false, reason: "本轮没有到期的采集源。", remaining: 0 }), { status: 200 });
      }
      if (url.endsWith("/api/entities/sweep")) {
        return new Response(JSON.stringify({ enabled: true, intervalMinutes: 180, maxPerRound: 6, lastRun: "" }), { status: 200 });
      }
      if (url.endsWith("/api/entities")) {
        return new Response(JSON.stringify(board), { status: 200 });
      }
      if (url.endsWith("/api/knowledge/overview")) {
        return new Response(JSON.stringify(overview), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    try {
      render(<KnowledgeDashboard act={noop} />);
      await screen.findByRole("region", { name: "定时巡检" });
      await waitFor(() => expect(posts).toHaveLength(1)); // 挂载那一次

      // 逼几次重渲染：每个事件都让 reload → setState → 再渲染一遍。
      for (let i = 0; i < 4; i += 1) {
        await act(async () => {
          window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));
        });
      }
      await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(6)); // 重渲染确实发生了

      // 改前：每次重渲染都新起一个 effect，立刻再 POST 一次；改后仍是挂载那一次。
      expect(posts).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("㉑ 巡检间隔：Enter 立即保存（不等防抖），保存成功有明确回执", async () => {
    const saveSweep = vi.fn(async (patch: Record<string, unknown>) => ({
      enabled: false,
      intervalMinutes: Number(patch.intervalMinutes),
      maxPerRound: 6,
      lastRun: "",
    }));
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => true}
        loadBoard={async () => board}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
        saveSweep={saveSweep}
      />
    );
    const bar = await screen.findByRole("region", { name: "定时巡检" });
    const input = within(bar).getByLabelText("巡检间隔（分钟）");

    fireEvent.change(input, { target: { value: "45" } });
    expect(saveSweep).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    // Enter must not wait for the debounce timer — the call lands synchronously,
    // with no `waitFor`/timer advance needed to observe it.
    expect(saveSweep).toHaveBeenCalledWith({ intervalMinutes: 45 });

    expect(await screen.findByText("巡检间隔已保存为 45 分钟。")).toBeInTheDocument();
  });

  it("㉒ 巡检间隔：不按 Enter 时，停顿约 500ms 后自动保存（防抖）", async () => {
    const saveSweep = vi.fn(async (patch: Record<string, unknown>) => ({
      enabled: false,
      intervalMinutes: Number(patch.intervalMinutes),
      maxPerRound: 6,
      lastRun: "",
    }));
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => true}
        loadBoard={async () => board}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
        saveSweep={saveSweep}
      />
    );
    const bar = await screen.findByRole("region", { name: "定时巡检" });
    const input = within(bar).getByLabelText("巡检间隔（分钟）");

    // Fake timers only around the debounce window itself — render and the initial
    // findByRole above already settled under real timers, and real timers come back
    // before this test ends (`finally`) so later tests in this file are unaffected.
    vi.useFakeTimers();
    try {
      fireEvent.change(input, { target: { value: "45" } });
      expect(saveSweep).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(499);
      });
      expect(saveSweep).not.toHaveBeenCalled();
      // The debounce fires here and `commitInterval` immediately calls the (async)
      // `saveSweep` — awaiting the async act() lets its `.then` (applySweep + setNotice)
      // flush too, instead of landing outside any act() boundary.
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(saveSweep).toHaveBeenCalledWith({ intervalMinutes: 45 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("㉓ 巡检间隔编辑中时，后台巡检刷新不覆盖输入框里还没提交的值", async () => {
    let loadSweepCalls = 0;
    const loadSweep = vi.fn(async () => {
      loadSweepCalls += 1;
      return loadSweepCalls === 1
        ? { enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" }
        : { enabled: true, intervalMinutes: 999, maxPerRound: 6, lastRun: "2026-09-15T00:00:00Z" };
    });
    const saveSweep = vi.fn(async (patch: Record<string, unknown>) => ({
      enabled: patch.enabled === true,
      intervalMinutes: 180,
      maxPerRound: 6,
      lastRun: "",
    }));
    const runSweepRound = vi.fn(async () => ({ ran: true, reason: "采集 1 个源，没有变化。", remaining: 0 }));
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => true}
        loadBoard={async () => board}
        loadOverview={async () => overview}
        loadSweep={loadSweep}
        runSweepRound={runSweepRound}
        saveSweep={saveSweep}
      />
    );
    const bar = await screen.findByRole("region", { name: "定时巡检" });
    const input = within(bar).getByLabelText("巡检间隔（分钟）") as HTMLInputElement;
    await waitFor(() => expect(loadSweep).toHaveBeenCalledTimes(1));

    // Start editing: focus + type a new value, but do not commit it.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "45" } });
    expect(input.value).toBe("45");

    // Turning the schedule on makes the tick effect fire once immediately — standing in
    // for "a background round landed while the user was mid-edit", without waiting on
    // the real 60s tick interval.
    fireEvent.click(within(bar).getByRole("checkbox"));
    await waitFor(() => expect(runSweepRound).toHaveBeenCalledWith(false));
    // `lastRun` is not guarded, so its update is proof the tick's refresh (which carries
    // intervalMinutes: 999) has actually landed in state — not just been requested.
    await waitFor(() => expect(within(bar).getByText(/上次巡检/)).toBeInTheDocument());

    expect(input.value).toBe("45");
  });

  it("㉔ 巡检间隔的取值范围常驻显示在输入框旁边，不必等报错才看到", async () => {
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => true}
        loadBoard={async () => board}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
      />
    );
    const bar = await screen.findByRole("region", { name: "定时巡检" });
    expect(within(bar).getByText(/30–1440/)).toBeInTheDocument();
  });

  it("㉕ 巡检间隔保存失败时，错误原文原样显示，不被吞掉", async () => {
    const saveSweep = vi.fn(async () => {
      throw new Error("巡检间隔需在 30–1440 分钟之间。");
    });
    render(
      <KnowledgeDashboard
        act={noop}
        isVisible={() => true}
        loadBoard={async () => board}
        loadOverview={async () => overview}
        loadSweep={async () => ({ enabled: false, intervalMinutes: 180, maxPerRound: 6, lastRun: "" })}
        saveSweep={saveSweep}
      />
    );
    const bar = await screen.findByRole("region", { name: "定时巡检" });
    const input = within(bar).getByLabelText("巡检间隔（分钟）");

    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("巡检间隔需在 30–1440 分钟之间。")).toBeInTheDocument();
  });

  it("㉖ 删除整张卡片要先确认，确认后走已有的 DELETE 路由（CR-20260915-board-card-lifecycle）", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={act} />);
    await waitFor(() => expect(screen.getByText("友商 A")).toBeInTheDocument());

    fireEvent.click(screen.getByText("友商 A").closest("button")!);
    const deleteButton = await screen.findByRole("button", { name: "删除跟踪对象「友商 A」" });
    fireEvent.click(deleteButton);
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(act).toHaveBeenCalledWith("DELETE", "/api/entities/%E5%8F%8B%E5%95%86-a", undefined));
    expect(await screen.findByText("已删除「友商 A」。")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("㉗ 取消确认框时不发请求，卡片原样留着", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<KnowledgeDashboard loadBoard={async () => board} loadOverview={async () => overview} act={act} />);
    await waitFor(() => expect(screen.getByText("友商 A")).toBeInTheDocument());

    fireEvent.click(screen.getByText("友商 A").closest("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "删除跟踪对象「友商 A」" }));
    expect(confirm).toHaveBeenCalled();
    expect(act).not.toHaveBeenCalledWith("DELETE", expect.anything(), expect.anything());
    expect(screen.getByText("友商 A")).toBeInTheDocument();
    confirm.mockRestore();
  });
});
