// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompetitorBoard, type CompetitorBoardData, type CompetitorEntity } from "@/components/CompetitorBoard";

/**
 * TEST-456 — the competitor comparison board (REQ-F-243, CR-20260918-competitor-board).
 */

function competitor(overrides: Partial<CompetitorEntity> = {}): CompetitorEntity {
  return {
    name: "delta",
    title: "台达",
    params: [
      { name: "LVRT 持续时间", value: "150ms" },
      { name: "通信规约", value: "Modbus TCP" },
    ],
    ...overrides,
  };
}

describe("TEST-456 友商看板 (REQ-F-243)", () => {
  it("① 按维度并集排表，每家友商一列，缺的维度显示占位符", async () => {
    const data: CompetitorBoardData = {
      competitors: [
        competitor(),
        competitor({ name: "vertiv", title: "维谛", params: [{ name: "LVRT 持续时间", value: "200ms" }] }),
      ],
    };
    render(<CompetitorBoard load={async () => data} />);

    await waitFor(() => expect(screen.getByRole("columnheader", { name: "台达" })).toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "维谛" })).toBeInTheDocument();
    // 两个维度都出现：LVRT 持续时间（两家都有）、通信规约（只有台达有）。
    expect(screen.getByText("LVRT 持续时间")).toBeInTheDocument();
    expect(screen.getByText("通信规约")).toBeInTheDocument();
    expect(screen.getByText("150ms")).toBeInTheDocument();
    expect(screen.getByText("200ms")).toBeInTheDocument();
    // 维谛没有登记「通信规约」，缺值处显示占位符而不是留空或报错。
    const rows = screen.getAllByRole("row");
    const commsRow = rows.find((row) => row.textContent?.includes("通信规约"));
    expect(commsRow?.textContent).toContain("—");
  });

  it("② 没有友商时如实说明，不是空白", async () => {
    render(<CompetitorBoard load={async () => ({ competitors: [] })} />);
    await waitFor(() => expect(screen.getByText(/还没有登记友商/)).toBeInTheDocument());
  });

  it("③ 有友商但都没登记参数时，分别给出说明", async () => {
    render(<CompetitorBoard load={async () => ({ competitors: [competitor({ params: [] })] })} />);
    await waitFor(() => expect(screen.getByText(/还没有登记任何技术参数/)).toBeInTheDocument());
  });

  it("④ 读取失败给出提示", async () => {
    render(
      <CompetitorBoard
        load={async () => {
          throw new Error("network");
        }}
      />
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("读不到友商数据"));
  });
});
