"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button } from "@/components/ui/button";

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

type MutationResult = { ok: boolean; message?: string; data?: DocumentSettingsValue };

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
    : { ok: false, message: body.message ?? `设置失败（${response.status}）。` };
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
    : { ok: false, message: body.message ?? `添加失败（${response.status}）。` };
}

async function removeViaApi(label: string) {
  const response = await fetch(`/api/settings/documents?label=${encodeURIComponent(label)}`, { method: "DELETE" });
  const body = (await response.json().catch(() => ({}))) as { message?: string } & Partial<DocumentSettingsValue>;
  return response.ok
    ? { ok: true, data: body as DocumentSettingsValue }
    : { ok: false, message: body.message ?? `移除失败（${response.status}）。` };
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
    : { ok: false, message: body.message ?? `设置失败（${response.status}）。` };
}

export function DocumentSettings({
  load = loadFromApi,
  add = addViaApi,
  remove = removeViaApi,
  setArchive = setArchiveViaApi,
  setFormatSkill = setFormatSkillViaApi,
  loadSkills = loadSkillsFromApi,
}: DocumentSettingsProps) {
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
          ? `打开 PDF/DOCX 时将按技能「${result.data.formatSkillName}」由模型重新排版；同一份文件只排一次，之后走缓存。`
          : "已停用模型排版，恢复为只做结构转换。"
      );
    } else {
      setStatus(result.message ?? "设置失败。");
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
      setStatus(`已添加，共 ${result.data.counts.documents} 份可读文档。`);
    } else {
      setStatus(result.message ?? "添加失败。");
    }
  };

  const onRemove = async (label: string) => {
    setBusy(true);
    const result = await remove(label);
    setBusy(false);
    if (result.ok && result.data) {
      apply(result.data);
      setStatus("已移除。磁盘上的文件没有任何改动。");
    } else {
      setStatus(result.message ?? "移除失败。");
    }
  };

  const onArchive = async () => {
    setBusy(true);
    const result = await setArchive(archiveDraft.trim());
    setBusy(false);
    if (result.ok && result.data) {
      apply(result.data);
      setStatus(result.data.archive ? `报告将归档到 ${result.data.archive}。` : "已清除归档目录，报告不再写入磁盘。");
    } else {
      setStatus(result.message ?? "设置失败。");
    }
  };

  const summary =
    roots.length === 0
      ? "本地文档：未配置目录"
      : `本地文档：${roots.length} 个目录 · ${count} 份可读文件${archive ? " · 已设归档目录" : ""}${
          formatSkill ? ` · 排版技能：${formatSkillName}` : ""
        }`;

  return (
    <section className="document-settings flex flex-col gap-1.5 rounded-md border border-border p-2" aria-label="本地文档">
      <h3 className="document-settings__title text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        本地文档
      </h3>

      <Button type="button" variant="ghost" className="w-full justify-start gap-2" onClick={() => setOpen(true)}>
        <FolderOpen aria-hidden="true" className="size-4" />
        文档目录
      </Button>
      <p className="document-settings__summary px-3 text-xs text-muted-foreground" aria-live="polite">
        {summary}
      </p>

      <Dialog onClose={() => setOpen(false)} open={open} title="本地文档目录">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            指向存放规格书、标准、论文等原件的文件夹。Jarvis
            只读取，不复制、不改写、不移动其中任何文件；移除目录也只是不再查找它。
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
                    aria-label={`移除 ${root.label}`}
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
              还没有添加目录。添加之后，对话里就可以直接检索和阅读这些原文档。
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium" htmlFor="document-root-path">
              添加文件夹（绝对路径）
            </label>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                id="document-root-path"
                onChange={(event) => setDraft(event.target.value)}
                placeholder="D:\\资料\\产品规格书"
                value={draft}
              />
              <Button disabled={busy || draft.trim().length === 0} onClick={onAdd} type="button">
                添加
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              支持 PDF、.docx、Markdown、纯文本、CSV、JSON。旧的 .doc 二进制格式与扫描件 PDF（无文字层）读不了，会如实说明。
            </p>
          </div>

          <div className="document-settings__archive flex flex-col gap-1.5 border-t border-border pt-3">
            <label className="text-xs font-medium" htmlFor="document-archive-path">
              报告归档目录（绝对路径，须位于上面某个目录之内）
            </label>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                id="document-archive-path"
                onChange={(event) => setArchiveDraft(event.target.value)}
                placeholder="D:\\资料\\Jarvis 报告"
                value={archiveDraft}
              />
              <Button disabled={busy || archiveDraft.trim() === archive.trim()} onClick={onArchive} type="button">
                保存
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {/* 写入是这一层唯一的写动作，边界写在明处（REQ-F-190 ③④）。 */}
              展示屏上的报告可归档为 Markdown 存到这里，随后能被检索和阅读。
              写入只发生在这个目录里、只新建文件，**永不覆盖**已有文件；留空即不写磁盘。
            </p>
          </div>

          <div className="document-settings__format flex flex-col gap-1.5 border-t border-border pt-3">
            <label className="text-xs font-medium" htmlFor="document-format-skill">
              排版技能（PDF/DOCX 打开时由模型按该技能的 SKILL.md 重新排版）
            </label>
            <select
              className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
              disabled={busy}
              id="document-format-skill"
              onChange={(event) => void onFormatSkill(event.target.value)}
              value={formatSkill}
            >
              <option value="">不使用（只做结构转换）</option>
              {formatSkillStale && formatSkill ? (
                <option value={formatSkill}>{`（已删除的技能 ${formatSkill.slice(0, 8)}…）`}</option>
              ) : null}
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {/* REQ-F-290 ①③：技能经常规上传注册；排版结果按文件内容缓存。 */}
              先在「技能」里上传一个技能，它的 SKILL.md 就是排版规则。选中后每份文件只排一次，之后走缓存；
              模型输出明显缩水的段落会保留原文并标注，不会静默丢内容。选「不使用」即刻停用。
            </p>
            {formatSkillStale ? (
              <p className="text-xs text-destructive" role="alert">
                当前设置指向的技能已不存在，打开文档时会退回结构转换。请重新选择或选「不使用」。
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
