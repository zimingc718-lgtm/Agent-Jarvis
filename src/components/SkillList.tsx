"use client";

import { useEffect, useState } from "react";
import { SKILLS_CHANGED_EVENT } from "@/lib/ui-events";

export type SkillListEntry = { id: string; name: string; description: string };

type SkillListProps = {
  /** SSR-resolved list so the menu is already correct on first open. */
  initialSkills?: SkillListEntry[];
  /** Test seam. */
  fetchSkills?: () => Promise<SkillListEntry[]>;
};

async function fetchSkillsFromApi(): Promise<SkillListEntry[]> {
  const response = await fetch("/api/skills", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`skills fetch failed (${response.status})`);
  }
  const body = (await response.json()) as { skills?: SkillListEntry[] };
  return body.skills ?? [];
}

/**
 * REQ-F-028 ①④: a **read-only** view of what the system currently knows how to do.
 * Registration failing silently was the P6 root cause — this is the "success is
 * visible" half of the fix (the other half is the drop-rejection notice).
 */
export function SkillList({ initialSkills = [], fetchSkills = fetchSkillsFromApi }: SkillListProps) {
  const [skills, setSkills] = useState<SkillListEntry[]>(initialSkills);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      fetchSkills()
        .then((next) => {
          if (!cancelled) {
            setSkills(next);
          }
        })
        .catch(() => {
          /* keep whatever is on screen */
        });
    };

    reload();
    window.addEventListener(SKILLS_CHANGED_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(SKILLS_CHANGED_EVENT, reload);
    };
  }, [fetchSkills]);

  return (
    <section className="skill-list" aria-label="已注册技能">
      <h3 className="skill-list__title">技能</h3>
      {skills.length === 0 ? (
        <p className="skill-list__empty">尚未注册技能</p>
      ) : (
        <ul className="skill-list__items">
          {skills.map((skill) => (
            <li key={skill.id} className="skill-list__item">
              <span className="skill-list__name">{skill.name}</span>
              <span className="skill-list__description">{skill.description}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
