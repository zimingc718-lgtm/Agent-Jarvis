// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrgChartBoard, type OrgChartBoardData, type OrgChartEntity } from "@/components/OrgChartBoard";

/**
 * TEST-480 — the org chart / R&D formation board (REQ-F-260, CR-20260918-org-chart-board).
 */

function company(overrides: Partial<OrgChartEntity> = {}): OrgChartEntity {
  return {
    name: "vertiv",
    title: "维谛",
    people: [
      { name: "张三", title: "CTO", team: "电源研发", avatarUrl: "", bio: "负责整体技术路线" },
      { name: "李四", title: "工程师", team: "电源研发", avatarUrl: "https://vertiv.example/li.jpg", bio: "" },
    ],
    ...overrides,
  };
}

describe("TEST-480 组织架构/研发阵型看板 (REQ-F-260)", () => {
  it("① 按公司分区，同公司内按团队分组，人员卡片显示姓名/岗位/简介", async () => {
    const data: OrgChartBoardData = { companies: [company()] };
    render(<OrgChartBoard load={async () => data} />);

    await waitFor(() => expect(screen.getByText("维谛")).toBeInTheDocument());
    expect(screen.getByText("电源研发")).toBeInTheDocument();
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("CTO")).toBeInTheDocument();
    expect(screen.getByText("负责整体技术路线")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
  });

  it("② 没有团队标注的人归入「其他」分组", async () => {
    const data: OrgChartBoardData = {
      companies: [company({ people: [{ name: "王五", title: "顾问", team: "", avatarUrl: "", bio: "" }] })],
    };
    render(<OrgChartBoard load={async () => data} />);
    await waitFor(() => expect(screen.getByText("其他")).toBeInTheDocument());
    expect(screen.getByText("王五")).toBeInTheDocument();
  });

  it("③ 没有任何公司登记组织架构时如实说明，不是空白", async () => {
    render(<OrgChartBoard load={async () => ({ companies: [] })} />);
    await waitFor(() => expect(screen.getByText(/还没有登记任何组织架构信息/)).toBeInTheDocument());
  });

  it("④ 没有头像链接时显示姓名首字兜底，不留破图标", async () => {
    const data: OrgChartBoardData = {
      companies: [company({ people: [{ name: "赵六", title: "经理", team: "", avatarUrl: "", bio: "" }] })],
    };
    const { container } = render(<OrgChartBoard load={async () => data} />);
    await waitFor(() => expect(screen.getByText("赵六")).toBeInTheDocument());
    expect(container.querySelector(".org-chart-board__avatar-fallback")).toHaveTextContent("赵");
    expect(container.querySelector(".org-chart-board__avatar")).toBeNull();
  });

  it("⑤ 有头像链接时渲染 img", async () => {
    const data: OrgChartBoardData = { companies: [company({ people: [company().people[1]] })] };
    const { container } = render(<OrgChartBoard load={async () => data} />);
    await waitFor(() => expect(container.querySelector(".org-chart-board__avatar")).toBeTruthy());
    expect(container.querySelector(".org-chart-board__avatar")).toHaveAttribute("src", "https://vertiv.example/li.jpg");
  });

  it("⑥ 读取失败给出提示", async () => {
    render(
      <OrgChartBoard
        load={async () => {
          throw new Error("network");
        }}
      />
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("读不到组织架构数据"));
  });
});
