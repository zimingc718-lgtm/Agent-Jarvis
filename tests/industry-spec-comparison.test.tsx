// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IndustrySpecComparison, type IndustrySpecComparisonData, type SpecEntity } from "@/components/IndustrySpecComparison";

/**
 * TEST-470 — 行业技术指标对比 (REQ-F-250, CR-20260918-industry-spec-comparison)。
 *
 * 与 TEST-456（友商看板）的结构一致，区别在覆盖范围——这里跨三类实体，不止友商。
 */

function entity(overrides: Partial<SpecEntity> = {}): SpecEntity {
  return {
    name: "delta",
    title: "台达",
    kind: "competitor",
    params: [
      { name: "LVRT 持续时间", value: "150ms" },
      { name: "通信规约", value: "Modbus TCP" },
    ],
    ...overrides,
  };
}

describe("TEST-470 行业技术指标对比 (REQ-F-250)", () => {
  it("① 三类对象同表按维度并集对齐，缺的维度显示占位符", async () => {
    const data: IndustrySpecComparisonData = {
      entities: [
        entity(),
        entity({ name: "vertiv", title: "维谛", kind: "competitor", params: [{ name: "LVRT 持续时间", value: "200ms" }] }),
        entity({
          name: "csg-grid-code",
          title: "南方电网并网导则",
          kind: "authority",
          params: [{ name: "LVRT 持续时间", value: "≥150ms" }],
        }),
        entity({ name: "acme-corp", title: "Acme 集团", kind: "customer", params: [{ name: "通信规约", value: "IEC 61850" }] }),
      ],
    };
    render(<IndustrySpecComparison load={async () => data} />);

    await waitFor(() => expect(screen.getByRole("columnheader", { name: /台达/ })).toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: /维谛/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /南方电网并网导则/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Acme 集团/ })).toBeInTheDocument();
    // 每列都标了 kind，不是只有名字——用户能分清"这是友商规格"还是"这是门槛要求"。
    expect(screen.getAllByText("友商")).toHaveLength(2);
    expect(screen.getByText("规则与准入方")).toBeInTheDocument();
    expect(screen.getByText("客户")).toBeInTheDocument();

    expect(screen.getByText("LVRT 持续时间")).toBeInTheDocument();
    expect(screen.getByText("通信规约")).toBeInTheDocument();
    expect(screen.getByText("200ms")).toBeInTheDocument();
    expect(screen.getByText("≥150ms")).toBeInTheDocument();
    expect(screen.getByText("IEC 61850")).toBeInTheDocument();

    // 南方电网并网导则没有登记「通信规约」，缺值处显示占位符。
    const rows = screen.getAllByRole("row");
    const commsRow = rows.find((row) => row.textContent?.includes("通信规约"));
    expect(commsRow?.textContent).toContain("—");
  });

  it("② 没有任何跟踪对象时如实说明，不是空白", async () => {
    render(<IndustrySpecComparison load={async () => ({ entities: [] })} />);
    await waitFor(() => expect(screen.getByText(/还没有登记友商、规则与准入方或客户/)).toBeInTheDocument());
  });

  it("③ 有对象但都没登记参数时，分别给出说明", async () => {
    render(<IndustrySpecComparison load={async () => ({ entities: [entity({ params: [] })] })} />);
    await waitFor(() => expect(screen.getByText(/还没有登记任何技术参数/)).toBeInTheDocument());
  });

  it("④ 读取失败给出提示", async () => {
    render(
      <IndustrySpecComparison
        load={async () => {
          throw new Error("network");
        }}
      />
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("读不到行业指标数据"));
  });
});
