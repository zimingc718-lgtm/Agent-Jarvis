// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SkillList } from "@/components/SkillList";
import { SKILLS_CHANGED_EVENT } from "@/lib/ui-events";

// CR-20260910-skill-intake — TEST-046 ①②③⑥.
// The P6 root cause was that a failed registration was invisible; this is the
// "success is visible" half of the fix.

describe("SkillList (REQ-F-028)", () => {
  it("① renders each registered skill as name — description", async () => {
    render(
      <SkillList
        fetchSkills={async () => [
          { id: "s1", name: "reporter", description: "写一份 HTML 报告" },
          { id: "s2", name: "翻译", description: "翻译文本" },
        ]}
      />
    );

    await waitFor(() => expect(screen.getByText("reporter")).toBeInTheDocument());
    expect(screen.getByText("写一份 HTML 报告")).toBeInTheDocument();
    expect(screen.getByText("翻译")).toBeInTheDocument();
  });

  it("② shows an empty state when nothing is registered", async () => {
    render(<SkillList fetchSkills={async () => []} />);
    await waitFor(() => expect(screen.getByText("尚未注册技能")).toBeInTheDocument());
  });

  it("③ refetches on jarvis:skills-changed, so a registration shows up without a reload", async () => {
    let current = [{ id: "s1", name: "first", description: "a" }];
    const fetchSkills = vi.fn(async () => current);

    render(<SkillList fetchSkills={fetchSkills} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());

    current = [...current, { id: "s2", name: "second", description: "b" }];
    window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));

    await waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());
    expect(fetchSkills).toHaveBeenCalledTimes(2);
  });

  // REVERSED by CR-20260910-agent-tooling (CP-3 / REQ-F-031): the list was read-only
  // through REQ-F-028 ⑥; being unable to remove or correct an uploaded skill is one of
  // the two gaps that opened this CR. Delete and rename now exist — editing the body,
  // versioning and a marketplace remain non-goals.
  it("REQ-F-031 ①:每个技能都有删除与重命名控件", async () => {
    const { container } = render(
      <SkillList fetchSkills={async () => [{ id: "s1", name: "reporter", description: "d" }]} />
    );
    await waitFor(() => expect(screen.getByText("reporter")).toBeInTheDocument());
    // REQ-F-053 ⑤ (CR-20260911-display-console-ux): rows are single-line; the actions sit
    // behind a per-row 「更多」 disclosure so a long description cannot grow the drawer.
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多：reporter" }));
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重命名" })).toBeInTheDocument();
    // Still no in-place editing surface — the remaining non-goal.
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("REQ-F-031 ②: 删除需二次确认，取消则不发请求", async () => {
    const calls: string[] = [];
    vi.stubGlobal("confirm", () => false);
    vi.stubGlobal("fetch", (async (url: string) => {
      calls.push(url);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);
    // `fetchProposals` is seamed too: the default would hit /api/skills/proposals and count as a call here.
    render(<SkillList fetchSkills={async () => [{ id: "s1", name: "reporter", description: "d" }]} fetchProposals={async () => []} />);
    await waitFor(() => expect(screen.getByText("reporter")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "更多：reporter" }));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(calls).toHaveLength(0));
  });

  it("keeps the last good list when a refetch fails", async () => {
    let fail = false;
    render(
      <SkillList
        fetchSkills={async () => {
          if (fail) {
            throw new Error("offline");
          }
          return [{ id: "s1", name: "kept", description: "d" }];
        }}
      />
    );
    await waitFor(() => expect(screen.getByText("kept")).toBeInTheDocument());

    fail = true;
    window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
    await waitFor(() => expect(screen.getByText("kept")).toBeInTheDocument());
  });

  /**
   * TEST-552 — the 待确认 section (REQ-F-320 ①, DEC-430 ②; CR-20260925-write-approval-action-log).
   * The click here is the same route the transcript card forwards to; the list is the second door.
   */
  it("CR-20260925-write-approval-action-log: 待确认的技能提议列在技能之上，采纳 / 忽略走 /api/skills/proposals/[id] 并刷新", async () => {
    const calls: Array<[string, string]> = [];
    const decideProposal = vi.fn(async (method: "POST" | "DELETE", url: string) => {
      calls.push([method, url]);
      return { ok: true };
    });
    const changed = vi.fn();
    window.addEventListener(SKILLS_CHANGED_EVENT, changed);
    render(
      <SkillList
        fetchSkills={async () => [{ id: "s1", name: "reporter", description: "d" }]}
        fetchProposals={async () => [{ id: "sp-1", name: "会议纪要整理", description: "把会议记录整理成纪要" }]}
        decideProposal={decideProposal}
      />
    );
    await waitFor(() => expect(screen.getByText("会议纪要整理")).toBeInTheDocument());
    expect(screen.getByText(/待确认（模型提议，采纳后才注册）/)).toBeInTheDocument();
    // The proposal is not a registered skill: no 「更多」 disclosure for it.
    expect(screen.queryByRole("button", { name: "更多：会议纪要整理" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "采纳" }));
    await waitFor(() => expect(calls).toEqual([["POST", "/api/skills/proposals/sp-1"]]));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已注册「会议纪要整理」。"));
    expect(changed).toHaveBeenCalled();
    window.removeEventListener(SKILLS_CHANGED_EVENT, changed);
  });

  it("CR-20260925-write-approval-action-log: 忽略走 DELETE，失败时把服务端说明原样显示", async () => {
    const decideProposal = vi.fn(async (method: "POST" | "DELETE") =>
      method === "DELETE" ? { ok: false, message: "没有编号为「sp-2」的待确认技能提议。" } : { ok: true }
    );
    render(
      <SkillList
        fetchSkills={async () => []}
        fetchProposals={async () => [{ id: "sp-2", name: "旧提议", description: "d" }]}
        decideProposal={decideProposal}
      />
    );
    await waitFor(() => expect(screen.getByText("旧提议")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "忽略" }));
    await waitFor(() => expect(decideProposal).toHaveBeenCalledWith("DELETE", "/api/skills/proposals/sp-2"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("没有编号为「sp-2」的待确认技能提议。"));
  });
});
