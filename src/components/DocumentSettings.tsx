"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/LanguageProvider";
import type { MessageKey } from "@/lib/i18n";

/**
 * Local document folders (REQ-F-110 ①, TASK-170 ⑤).
 *
 * One ☰ entry beside 「搜索设置」, same shape: a row that states the current state and
 * opens a dialog. The dialog is where paths are typed, because a path is long and typing
 * it inside the drawer would push everything else off screen.
 *
 * Deliberately **not** a file picker: the browser's directory picker hands back a sandboxed
 * handle, not a path the Node process can read, so it would look like it worked and then
 * find nothing. A typed absolute path is honest about what the server actually needs.
 */

export type DocumentRootView = { label: string; path: string };
export type DocumentSettingsValue = {
  roots: DocumentRootView[];
  counts: { documents: number };
  /** 归档目录的绝对路径，空串表示未设置（REQ-F-190 ③）。 */
  archive: string;
  /** 排版技能的 id，空串表示不用模型排版（REQ-F-290；CR-20260921-format-skill）。 */
  formatSkill?: string;
  formatSkillName?: string;
  /** 设置指向的技能已被删除——面板要说出来，而不是无声退回纯结构转换。 */
  formatSkillStale?: boolean;
};

export type SkillOption = { id: string; name: string };

/** `status` is the HTTP status of a failed call; the component turns it into words (REQ-F-340). */
type MutationResult = { ok: boolean; message?: string; status?: number; data?: DocumentSettingsValue };

type DocumentSettingsProps = {
  /** Test seams. */
  load?: () => Promise<DocumentSettingsValue>;
  add?: (path: string) => Promise<MutationResult>;
  remove?: (label: string) => Promise<MutationResult>;
  setArchive?: (path: string) => Promise<MutationResult>;
  setFormatSkill?: (skillId: string) => Promise<MutationResult>;
  loadSkills?: () => Promise<SkillOption[]>;
};

async function loadSkillsFromApi(): Promise<SkillOption[]> {
  const response = await fetch("/api/skills", { headers: { accept: "application/json" } });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json().catch(() => ({}))) as { skills?: SkillOption[] };
  return Array.isArray(body.skills) ? body.skills.map((skill) => ({ id: skill.id, name: skill.name })) : [];
}

async function setFormatSkillViaApi(skillId: string): Promise<MutationResult> {
  const response = await fetch("/api/settings/documents", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ formatSkill: skillId }),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string } & Partial<DocumentSettingsValue>;
  return response.ok
    ? { ok: true, data: body as DocumentSettingsValue }
    : { ok: false, message: body.message, status: response.status };
}

async function loadFromApi(): Promise<DocumentSettingsValue> {
  const response = await fetch("/api/settings/documents", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`document settings fetch failed (${response.status})`);
  }
  return (await response.json()) as DocumentSettingsValue;
}

async function addViaApi(path: string) {
  const response = await fetch("/api/settings/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string } & Partial<DocumentSettingsValue>;
  return response.ok
    ? { ok: true, data: body as DocumentSettingsValue }
    : { ok: false, message: body.message, status: response.status };
}

async function removeViaApi(label: string) {
  const response = await fetch(`/api/settings/documents?label=${encodeURIComponent(label)}`, { method: "DELETE" });
  const body = (await response.json().catch(() => ({}))) as { message?: string } & Partial<DocumentSettingsValue>;
  return response.ok
    ? { ok: true, data: body as DocumentSettingsValue }
    : { ok: false, message: body.message, status: response.status };
}

async function setArchiveViaApi(path: string) {
  const response = await fetch("/api/settings/documents", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ archive: path }),
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string } & Partial<DocumentSettingsValue>;
  return response.ok
    ? { ok: true, data: body as DocumentSettingsValue }
    : { ok: false, message: body.message, status: response.status };
}

export function DocumentSettings({
  load = loadFromApi,
  add = addViaApi,
  remove = removeViaApi,
  setArchive = setArchiveViaApi,
  setFormatSkill = setFormatSkillViaApi,
  loadSkills = loadSkillsFromApi,
}: DocumentSettingsProps) {
  const t = useT();
  // Server messages win; otherwise name the failed call and its status, as the panel always did.
  const failure = (result: MutationResult, withStatus: MessageKey, plain: MessageKey) =>
    result.message ?? (result.status ? t(withStatus, { status: result.status }) : t(plain));
  const [open, setOpen] = useState(false);
  const [roots, setRoots] = useState<DocumentRootView[]>([]);
  const [count, setCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archive, setArchiveState] = useState("");
  const [archiveDraft, setArchiveDraft] = useState("");
  const [formatSkill, setFormatSkillState] = useState("");
  const [formatSkillName, setFormatSkillName] = useState("");
  const [formatSkillStale, setFormatSkillStale] = useState(false);
  const [skills, setSkills] = useState<SkillOption[]>([]);

  const apply = useCallback((value: DocumentSettingsValue) => {
    setRoots(value.roots);
    setCount(value.counts.documents);
    setArchiveState(value.archive ?? "");
    setArchiveDraft(value.archive ?? "");
    setFormatSkillState(value.formatSkill ?? "");
    setFormatSkillName(value.formatSkillName ?? "");
    setFormatSkillStale(Boolean(value.formatSkillStale));
  }, []);

  // 技能列表只在弹窗打开时取：它是给下拉框用的，折叠态的一行摘要不需要它。
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    loadSkills()
      .then((list) => {
        if (!cancelled) {
          setSkills(list);
        }
      })
      .catch(() => {
        /* keep the last list */
      });
    return () => {
      cancelled = true;
    };
  }, [open, loadSkills]);

  const onFormatSkill = async (skillId: string) => {
    setBusy(true);
    const result = await setFormatSkill(skillId);
    setBusy(false);
    if (result.ok && result.data) {
      apply(result.data);
      setStatus(
        result.data.formatSkill
          ? t("docs.formatSkillOn", { name: result.data.formatSkillName ?? "" })
          : t("docs.formatSkillOff")
      );
    } else {
      setStatus(failure(result, "docs.setFailedStatus", "docs.setFailed"));
    }
  };

  useEffect(() => {
    let cancelled = false;
    load()
      .then((value) => {
        if (!cancelled) {
          apply(value);
        }
      })
      .catch(() => {
        /* keep empty state */
      });
    return () => {
      cancelled = true;
    };
  }, [load, apply]);

  const onAdd = async () => {
    const path = draft.trim();
    if (!path) {
      return;
    }
    setBusy(true);
    const result = await add(path);
    setBusy(false);
    if (result.ok && result.data) {
      apply(result.data);
      setDraft("");
      setStatus(t("docs.added", { count: result.data.counts.documents }));
    } else {
      setStatus(failure(result, "docs.addFailedStatus", "docs.addFailed"));
    }
  };

  const onRemove = async (label: string) => {
    setBusy(true);
    const result = await remove(label);
    setBusy(false);
    if (result.ok && result.data) {
      apply(result.data);
      setStatus(t("docs.removed"));
    } else {
      setStatus(failure(result, "docs.removeFailedStatus", "docs.removeFailed"));
    }
  };

  const onArchive = async () => {
    setBusy(true);
    const result = await setArchive(archiveDraft.trim());
    setBusy(false);
    if (result.ok && result.data) {
      apply(result.data);
      setStatus(result.data.archive ? t("docs.archiveSet", { path: result.data.archive }) : t("docs.archiveCleared"));
    } else {
      setStatus(failure(result, "docs.setFailedStatus", "docs.setFailed"));
    }
  };

  const summary =
    roots.length === 0
      ? t("docs.summaryNone")
      : t("docs.summary", { roots: roots.length, count }) +
        (archive ? t("docs.summaryArchive") : "") +
        (formatSkill ? t("docs.summaryFormat", { name: formatSkillName }) : "");

  return (
    <section className="document-settings flex flex-col gap-1.5 rounded-md border border-border p-2" aria-label={t("docs.title")}>
      <h3 className="document-settings__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("docs.title")}
      </h3>

      <Button type="button" variant="ghost" className="w-full justify-start gap-2" onClick={() => setOpen(true)}>
        <FolderOpen aria-hidden="true" className="size-4" />
        {t("docs.foldersHeading")}
      </Button>
      <p className="document-settings__summary px-3 text-xs text-muted-foreground" aria-live="polite">
        {summary}
      </p>

      <Dialog onClose={() => setOpen(false)} open={open} title={t("docs.foldersAria")}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t("docs.foldersHint")}
          </p>

          {roots.length > 0 ? (
            <ul className="document-settings__roots flex flex-col gap-1.5">
              {roots.map((root) => (
                <li
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  key={root.label}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{root.label}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={root.path}>
                      {root.path}
                    </span>
                  </span>
                  <Button
                    aria-label={t("docs.removeFolder", { label: root.label })}
                    disabled={busy}
                    onClick={() => onRemove(root.label)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              {t("docs.foldersEmpty")}
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" htmlFor="document-root-path">
              {t("docs.addFolderLabel")}
            </label>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                id="document-root-path"
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("docs.folderPlaceholder")}
                value={draft}
              />
              <Button disabled={busy || draft.trim().length === 0} onClick={onAdd} type="button">
                {t("common.add")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("docs.formatsHint")}
            </p>
          </div>

          <div className="document-settings__archive flex flex-col gap-1.5 border-t border-border pt-3">
            <label className="text-xs font-medium" htmlFor="document-archive-path">
              {t("docs.archiveLabel")}
            </label>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                id="document-archive-path"
                onChange={(event) => setArchiveDraft(event.target.value)}
                placeholder={t("docs.archivePlaceholder")}
                value={archiveDraft}
              />
              <Button disabled={busy || archiveDraft.trim() === archive.trim()} onClick={onArchive} type="button">
                {t("common.save")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {/* 写入是这一层唯一的写动作，边界写在明处（REQ-F-190 ③④）。 */}
              {t("docs.archiveHint")}
            </p>
          </div>

          <div className="document-settings__format flex flex-col gap-1.5 border-t border-border pt-3">
            <label className="text-xs font-medium" htmlFor="document-format-skill">
              {t("docs.formatSkillLabel")}
            </label>
            <select
              className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
              disabled={busy}
              id="document-format-skill"
              onChange={(event) => void onFormatSkill(event.target.value)}
              value={formatSkill}
            >
              <option value="">{t("docs.formatSkillNone")}</option>
              {formatSkillStale && formatSkill ? (
                <option value={formatSkill}>{t("docs.formatSkillDeleted", { id: formatSkill.slice(0, 8) })}</option>
              ) : null}
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {/* REQ-F-290 ①③：技能经常规上传注册；排版结果按文件内容缓存。 */}
              {t("docs.formatSkillHint")}
            </p>
            {formatSkillStale ? (
              <p className="text-xs text-destructive" role="alert">
                {t("docs.formatSkillMissing")}
              </p>
            ) : null}
          </div>

          {status ? (
            <p className="document-settings__status text-sm" aria-live="polite">
              {status}
            </p>
          ) : null}
        </div>
      </Dialog>
    </section>
  );
}
