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
    render(<SkillList fetchSkills={async () => [{ id: "s1", name: "reporter", description: "d" }]} />);
    await waitFor(() => expect(screen.getByText("reporter")).toBeInTheDocument());
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
});
