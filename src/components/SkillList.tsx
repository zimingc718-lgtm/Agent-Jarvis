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
 * What the system currently knows how to do, and how to change it.
 *
 * REQ-F-028 ① started read-only; CR-20260910-agent-tooling makes it manageable
 * (REQ-F-031) — a skill could previously be uploaded but never removed or corrected,
 * which is one of the two gaps that opened this CR. Editing the body, versioning and a
 * marketplace remain non-goals.
 */
export function SkillList({ initialSkills = [], fetchSkills = fetchSkillsFromApi }: SkillListProps) {
  const [skills, setSkills] = useState<SkillListEntry[]>(initialSkills);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const refresh = () => {
    window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
  };

  /** REQ-F-031 ②: deletion is irreversible, so it asks first. */
  const remove = async (name: string) => {
    if (!window.confirm(`删除技能「${name}」？该操作不可撤销。`)) {
      return;
    }
    setPending(name);
    setNotice(null);
    try {
      const response = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { message?: string; warning?: string };
      setNotice(response.ok ? (body.warning ?? `已删除「${name}」。`) : (body.message ?? "删除失败。"));
      if (response.ok) {
        refresh();
      }
    } catch {
      setNotice("删除失败：网络错误。");
    } finally {
      setPending(null);
    }
  };

  const rename = async (name: string) => {
    const next = window.prompt(`把「${name}」重命名为：`, name)?.trim();
    if (!next || next === name) {
      return;
    }
    setPending(name);
    setNotice(null);
    try {
      const response = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      setNotice(response.ok ? `已重命名为「${next}」。` : (body.message ?? "重命名失败。"));
      if (response.ok) {
        refresh();
      }
    } catch {
      setNotice("重命名失败：网络错误。");
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="skill-list flex flex-col gap-1.5 rounded-md border border-border p-2" aria-label="已注册技能">
      <h3 className="skill-list__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">技能</h3>
      {skills.length === 0 ? (
        <p className="skill-list__empty text-sm text-muted-foreground">尚未注册技能</p>
      ) : (
        <ul className="skill-list__items flex flex-col gap-1">
          {skills.map((skill) => (
            <li key={skill.id} className="skill-list__item flex flex-col">
              <span className="skill-list__name text-sm font-medium">{skill.name}</span>
              <span className="skill-list__description text-xs text-muted-foreground">{skill.description}</span>
              <span className="skill-list__actions mt-1 flex gap-2">
                <button
                  type="button"
                  className="skill-list__rename rounded px-1 text-xs underline underline-offset-2 disabled:opacity-50"
                  disabled={pending === skill.name}
                  onClick={() => void rename(skill.name)}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="skill-list__delete rounded px-1 text-xs text-destructive underline underline-offset-2 disabled:opacity-50"
                  disabled={pending === skill.name}
                  onClick={() => void remove(skill.name)}
                >
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {notice ? (
        <p className="skill-list__notice text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
