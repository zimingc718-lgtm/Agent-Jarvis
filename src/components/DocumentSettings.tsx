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
export type DocumentSettingsValue = { roots: DocumentRootView[]; counts: { documents: number } };

type DocumentSettingsProps = {
  /** Test seams. */
  load?: () => Promise<DocumentSettingsValue>;
  add?: (path: string) => Promise<{ ok: boolean; message?: string; data?: DocumentSettingsValue }>;
  remove?: (label: string) => Promise<{ ok: boolean; message?: string; data?: DocumentSettingsValue }>;
};

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

export function DocumentSettings({ load = loadFromApi, add = addViaApi, remove = removeViaApi }: DocumentSettingsProps) {
  const [open, setOpen] = useState(false);
  const [roots, setRoots] = useState<DocumentRootView[]>([]);
  const [count, setCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((value: DocumentSettingsValue) => {
    setRoots(value.roots);
    setCount(value.counts.documents);
  }, []);

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

  const summary =
    roots.length === 0
      ? "本地文档：未配置目录"
      : `本地文档：${roots.length} 个目录 · ${count} 份可读文件`;

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
