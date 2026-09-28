"use client";

import { useEffect, useState } from "react";
import { SKILLS_CHANGED_EVENT } from "@/lib/ui-events";
import { useT } from "@/components/LanguageProvider";

export type SkillListEntry = { id: string; name: string; description: string };

/** A skill the model proposed and the user has not decided on (REQ-F-320 ①, DEC-430 ②). */
export type SkillProposalEntry = { id: string; name: string; description: string; createdAt?: string };

type SkillListProps = {
  /** SSR-resolved list so the menu is already correct on first open. */
  initialSkills?: SkillListEntry[];
  /** Test seams. */
  fetchSkills?: () => Promise<SkillListEntry[]>;
  fetchProposals?: () => Promise<SkillProposalEntry[]>;
  decideProposal?: (method: "POST" | "DELETE", url: string) => Promise<{ ok: boolean; message?: string }>;
};

async function fetchSkillsFromApi(): Promise<SkillListEntry[]> {
  const response = await fetch("/api/skills", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`skills fetch failed (${response.status})`);
  }
  const body = (await response.json()) as { skills?: SkillListEntry[] };
  return body.skills ?? [];
}

async function fetchProposalsFromApi(): Promise<SkillProposalEntry[]> {
  const response = await fetch("/api/skills/proposals", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`skill proposals fetch failed (${response.status})`);
  }
  const body = (await response.json()) as { proposals?: SkillProposalEntry[] };
  return body.proposals ?? [];
}

async function decideViaApi(method: "POST" | "DELETE", url: string) {
  const response = await fetch(url, { method });
  const body = (await response.json().catch(() => ({}))) as { message?: string };
  return { ok: response.ok, message: body.message };
}

/**
 * What the system currently knows how to do, and how to change it.
 *
 * REQ-F-028 ① started read-only; CR-20260910-agent-tooling makes it manageable
 * (REQ-F-031) — a skill could previously be uploaded but never removed or corrected,
 * which is one of the two gaps that opened this CR. Editing the body, versioning and a
 * marketplace remain non-goals.
 *
 * CR-20260925-write-approval-action-log adds the 待确认 section: skills the model proposed
 * through `register_skill` wait here (and in the transcript card) until the user adopts or
 * discards them — the same approval shape the knowledge list has for pending entries.
 */
export function SkillList({
  initialSkills = [],
  fetchSkills = fetchSkillsFromApi,
  fetchProposals = fetchProposalsFromApi,
  decideProposal = decideViaApi,
}: SkillListProps) {
  const t = useT();
  const [skills, setSkills] = useState<SkillListEntry[]>(initialSkills);
  const [proposals, setProposals] = useState<SkillProposalEntry[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** REQ-F-053 ⑤: which row has its actions disclosed (one at a time keeps rows single-line). */
  const [openActions, setOpenActions] = useState<string | null>(null);

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
      fetchProposals()
        .then((next) => {
          if (!cancelled) {
            setProposals(next);
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
  }, [fetchSkills, fetchProposals]);

  const refresh = () => {
    window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
  };

  /** REQ-F-031 ②: deletion is irreversible, so it asks first. */
  const remove = async (name: string) => {
    if (!window.confirm(t("skills.deleteConfirm", { name }))) {
      return;
    }
    setPending(name);
    setNotice(null);
    try {
      const response = await fetch(`/api/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { message?: string; warning?: string };
      setNotice(response.ok ? (body.warning ?? t("skills.deleted", { name })) : (body.message ?? t("skills.deleteFailed")));
      if (response.ok) {
        refresh();
      }
    } catch {
      setNotice(t("skills.deleteFailedNetwork"));
    } finally {
      setPending(null);
    }
  };

  const rename = async (name: string) => {
    const next = window.prompt(t("skills.renamePrompt", { name }), name)?.trim();
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
      setNotice(response.ok ? t("skills.renamed", { name: next }) : (body.message ?? t("skills.renameFailed")));
      if (response.ok) {
        refresh();
      }
    } catch {
      setNotice(t("skills.renameFailedNetwork"));
    } finally {
      setPending(null);
    }
  };

  /** REQ-F-320 ①: the click that actually registers (or drops) a model-proposed skill. */
  const decide = async (proposal: SkillProposalEntry, decision: "adopted" | "discarded") => {
    setPending(proposal.id);
    setNotice(null);
    try {
      const result = await decideProposal(
        decision === "adopted" ? "POST" : "DELETE",
        `/api/skills/proposals/${encodeURIComponent(proposal.id)}`
      );
      if (result.ok) {
        setNotice(decision === "adopted" ? t("skills.proposalRegistered", { name: proposal.name }) : t("skills.proposalIgnored", { name: proposal.name }));
        refresh();
      } else {
        setNotice(result.message ?? (decision === "adopted" ? t("skills.adoptFailed") : t("skills.ignoreFailed")));
      }
    } catch {
      setNotice(t("common.actionFailedNetwork"));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="skill-list flex flex-col gap-1.5 rounded-md border border-border p-2" aria-label={t("skills.registeredAria")}>
      <h3 className="skill-list__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("skills.title")}</h3>
      {proposals.length > 0 ? (
        <div className="skill-list__proposals flex flex-col gap-0.5" aria-label={t("skills.pendingAria")}>
          <p className="skill-list__proposals-title text-xs text-muted-foreground">{t("skills.pendingHeading")}</p>
          <ul className="flex flex-col gap-0.5">
            {proposals.map((proposal) => (
              <li key={proposal.id} className="skill-list__proposal flex min-h-9 items-center gap-2">
                <span className="skill-list__proposal-name shrink-0 text-sm font-medium">{proposal.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={proposal.description}>
                  {proposal.description}
                </span>
                <button
                  type="button"
                  className="skill-list__adopt shrink-0 rounded px-1 text-xs underline underline-offset-2 disabled:opacity-50"
                  disabled={pending === proposal.id}
                  onClick={() => void decide(proposal, "adopted")}
                >
                  {t("common.adopt")}
                </button>
                <button
                  type="button"
                  className="skill-list__discard shrink-0 rounded px-1 text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                  disabled={pending === proposal.id}
                  onClick={() => void decide(proposal, "discarded")}
                >
                  {t("common.ignore")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {skills.length === 0 ? (
        <p className="skill-list__empty text-sm text-muted-foreground">{t("skills.empty")}</p>
      ) : (
        <ul className="skill-list__items flex flex-col gap-0.5">
          {skills.map((skill) => {
            const disclosed = openActions === skill.name;
            return (
              <li key={skill.id} className="skill-list__item flex flex-col">
                {/* One line per skill: name, a truncated description, and a 「更多」 toggle.
                    The full description stays in the DOM (title + text) — it is clipped, not dropped. */}
                <div className="flex min-h-9 items-center gap-2">
                  <span className="skill-list__name shrink-0 text-sm font-medium">{skill.name}</span>
                  <span
                    className="skill-list__description min-w-0 flex-1 truncate text-xs text-muted-foreground"
                    title={skill.description}
                  >
                    {skill.description}
                  </span>
                  <button
                    type="button"
                    className="skill-list__more shrink-0 rounded px-1 text-xs text-muted-foreground underline underline-offset-2"
                    aria-expanded={disclosed}
                    aria-label={disclosed ? t("skills.collapseActionsAria", { name: skill.name }) : t("skills.moreAria", { name: skill.name })}
                    onClick={() => setOpenActions(disclosed ? null : skill.name)}
                  >
                    {disclosed ? t("common.collapse") : t("common.more")}
                  </button>
                </div>
                {disclosed ? (
                  <span className="skill-list__actions flex gap-2 pb-1 pl-1">
                    <button
                      type="button"
                      className="skill-list__rename rounded px-1 text-xs underline underline-offset-2 disabled:opacity-50"
                      disabled={pending === skill.name}
                      onClick={() => void rename(skill.name)}
                    >
                      {t("skills.rename")}
                    </button>
                    <button
                      type="button"
                      className="skill-list__delete rounded px-1 text-xs text-destructive underline underline-offset-2 disabled:opacity-50"
                      disabled={pending === skill.name}
                      onClick={() => void remove(skill.name)}
                    >
                      {t("common.delete")}
                    </button>
                  </span>
                ) : null}
              </li>
            );
          })}
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
