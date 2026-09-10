// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
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

  it("⑥ is read-only — no edit or delete controls (non-goal guard)", async () => {
    const { container } = render(
      <SkillList fetchSkills={async () => [{ id: "s1", name: "reporter", description: "d" }]} />
    );
    await waitFor(() => expect(screen.getByText("reporter")).toBeInTheDocument());
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
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
