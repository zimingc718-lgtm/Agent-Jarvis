"use client";

import type { ReactNode } from "react";
import { useT } from "@/components/LanguageProvider";
import type { MessageKey } from "@/lib/i18n";

/**
 * One group inside the ☰ drawer (REQ-F-053 ③, DEC-032 ⑤; TASK-091 ②).
 *
 * Same card shape the self-titled entries already use (`SkillList`, `KnowledgeList`,
 * `SearchSettings`, `WakeSettings`): a small uppercase heading over a bordered block.
 * Wrapping the untitled chrome (theme toggle, dialog launchers) in it is what makes the
 * drawer read as one list of groups instead of a pile of differently styled widgets.
 *
 * The title is a dictionary key, not a string (REQ-F-340): `page.tsx` is a server component,
 * and a title rendered there would stay in the first-paint language after the ☰ switch.
 */
export function MenuSection({ titleKey, children }: { titleKey: MessageKey; children: ReactNode }) {
  const t = useT();
  const title = t(titleKey);
  return (
    <section className="menu-section flex flex-col gap-1.5 rounded-md border border-border p-2" aria-label={title}>
      <h3 className="menu-section__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}
