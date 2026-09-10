"use client";

import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { DISPLAY_CHANGED_EVENT, SKILLS_CHANGED_EVENT } from "@/lib/ui-events";
import { Markdown } from "@/lib/markdown";

export type FloatingMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status?: string;
};

export type ChatStreamEvent =
  | { type: "start"; conversationId: string }
  | { type: "delta"; text: string }
  | { type: "stopped" }
  | { type: "error"; message: string }
  | { type: "done" }
  // CR-20260909: skill-turn / display tail events.
  | { type: "insight"; insightId: string }
  | { type: "insight-missing"; reason: "none" | "incomplete" }
  | { type: "display"; kind: "home" }
  // CR-20260910-skill-intake: which skill this turn used.
  | { type: "skill"; name: string };

export type ChatStreamRequest = {
  message: string;
  conversationId?: string;
  /** Optional override; the console never sends one (CR-20260909 — server resolves by priority). */
  providerId?: string;
  model?: string;
  signal?: AbortSignal;
};

/** Raised when the request fails before any reply text arrives (REQ-F-016 request-level error). */
export class PreStreamError extends Error {}

type LightState = "checking" | "off" | "ready" | "busy" | "done";

const LIGHT_LABEL: Record<LightState, string> = {
  checking: "正在检测模型连接",
  off: "没有可用的模型",
  ready: "模型就绪",
  busy: "正在生成回复",
  done: "回复已就绪",
};

type FloatingChatProps = {
  /** At least one provider is enabled — sets the light to「检测中」until the probe resolves. */
  hasEnabledProvider?: boolean;
  initialConversationId?: string | null;
  initialMessages?: FloatingMessage[];
  onStream?: (request: ChatStreamRequest) => AsyncIterable<ChatStreamEvent>;
  /** Test seam: resolves to whether any enabled provider answered the probe. */
  probeProviders?: () => Promise<boolean>;
};

const SESSION_ENDED_KEY = "jarvis:chat-session-ended";
const COLLAPSED_KEY = "jarvis:chat-collapsed";

function sessionEnded(): boolean {
  try {
    return sessionStorage.getItem(SESSION_ENDED_KEY) === "1";
  } catch {
    return false;
  }
}

function markSessionEnded(ended: boolean): void {
  try {
    if (ended) {
      sessionStorage.setItem(SESSION_ENDED_KEY, "1");
    } else {
      sessionStorage.removeItem(SESSION_ENDED_KEY);
    }
  } catch {
    /* private mode / disabled storage — the in-memory state still holds for this view */
  }
}

/** REQ-F-019 / DEC-013: the collapse preference persists per browser in localStorage. */
function chatCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeChatCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) {
      localStorage.setItem(COLLAPSED_KEY, "1");
    } else {
      localStorage.removeItem(COLLAPSED_KEY);
    }
  } catch {
    /* storage unavailable — the in-memory state still holds for this view */
  }
}

export async function* streamChatDeltas(request: ChatStreamRequest): AsyncIterable<ChatStreamEvent> {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: request.message,
      conversationId: request.conversationId,
      ...(request.providerId ? { providerId: request.providerId } : {}),
      ...(request.model ? { model: request.model } : {}),
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new PreStreamError(body?.message ?? "对话请求失败。");
  }
  if (!response.body) {
    throw new PreStreamError("服务端没有返回响应流。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      const payload = event
        .split(/\n/)
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!payload) {
        continue;
      }
      const parsed = safeJsonParse(payload);
      if (!parsed || typeof parsed.type !== "string") {
        continue;
      }
      if (parsed.type === "start" && typeof parsed.conversationId === "string") {
        yield { type: "start", conversationId: parsed.conversationId };
      } else if (parsed.type === "delta" && typeof parsed.text === "string") {
        yield { type: "delta", text: parsed.text };
      } else if (parsed.type === "stopped") {
        yield { type: "stopped" };
      } else if (parsed.type === "error" && typeof parsed.message === "string") {
        yield { type: "error", message: parsed.message };
      } else if (parsed.type === "done") {
        yield { type: "done" };
      } else if (parsed.type === "insight" && typeof parsed.insightId === "string") {
        yield { type: "insight", insightId: parsed.insightId };
      } else if (parsed.type === "insight-missing" && (parsed.reason === "none" || parsed.reason === "incomplete")) {
        yield { type: "insight-missing", reason: parsed.reason };
      } else if (parsed.type === "display" && parsed.kind === "home") {
        yield { type: "display", kind: "home" };
      } else if (parsed.type === "skill" && typeof parsed.name === "string") {
        yield { type: "skill", name: parsed.name };
      }
    }
  }
}

async function probeViaApi(): Promise<boolean> {
  try {
    const response = await fetch("/api/providers/probe", { headers: { accept: "application/json" } });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { anyConnected?: boolean };
    return Boolean(body.anyConnected);
  } catch {
    return false;
  }
}

export function FloatingChat({
  hasEnabledProvider = false,
  initialConversationId = null,
  initialMessages = [],
  onStream = streamChatDeltas,
  probeProviders = probeViaApi,
}: FloatingChatProps) {
  const restored = !sessionEnded() && initialMessages.length > 0;

  const [input, setInput] = useState("");
  const [userCollapsed, setUserCollapsed] = useState(() => chatCollapsed());
  const [isStreaming, setIsStreaming] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [probeState, setProbeState] = useState<Exclude<LightState, "busy" | "done">>(
    hasEnabledProvider ? "checking" : "off"
  );
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [messages, setMessages] = useState<FloatingMessage[]>(restored ? initialMessages : []);
  const [conversationId, setConversationId] = useState<string | null>(
    restored ? initialConversationId : null
  );

  const abortRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);

  // DEC-013: `expanded` is derived, not stored. The transcript shows when there is
  // one AND the user has not collapsed the panel.
  const hasTranscript = messages.length > 0;
  const showTranscript = hasTranscript && !userCollapsed;

  // Keep the in-memory flag and the persisted preference in lockstep; the ref lets
  // async stream handlers read the current value without a stale closure.
  const userCollapsedRef = useRef(userCollapsed);
  userCollapsedRef.current = userCollapsed;
  function applyCollapsed(collapsed: boolean) {
    setUserCollapsed(collapsed);
    writeChatCollapsed(collapsed);
  }

  useEffect(() => {
    return () => {
      if (finishTimerRef.current) {
        clearTimeout(finishTimerRef.current);
      }
    };
  }, []);

  // REQ-F-018 / DEC-012: probe on mount (off the first-paint path) and again
  // whenever the settings dialog reports a provider change or the tab regains
  // focus — the console must not stay stale after the user configures a provider.
  useEffect(() => {
    let cancelled = false;
    const runProbe = (recheck: boolean) => {
      if (recheck) {
        setProbeState("checking");
      }
      probeProviders().then((anyConnected) => {
        if (!cancelled) {
          setProbeState(anyConnected ? "ready" : "off");
        }
      });
    };

    runProbe(false);
    const onChange = () => runProbe(true);
    window.addEventListener("focus", onChange);
    window.addEventListener("jarvis:providers-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onChange);
      window.removeEventListener("jarvis:providers-changed", onChange);
    };
  }, [probeProviders]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages]);

  const lightState: LightState = isStreaming ? "busy" : justFinished ? "done" : probeState;

  function endSession() {
    setConversationId(null);
    markSessionEnded(true);
  }

  function appendSystemMessage(content: string) {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "system", content }]);
  }

  /**
   * CR-20260910-skill-intake CP-11: the ONE place a skill is submitted. The three
   * entry points (drop a folder, drop a zip, pick from disk) only shape their input
   * into a `SkillUploadInput`; submission, receipt rendering and error handling live
   * here once.
   */
  async function submitSkillUpload(input: SkillUploadInput) {
    applyCollapsed(false);
    const label = input.kind === "folder" ? input.folderName : input.archive.name;
    const pendingId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: pendingId, role: "system", content: `正在注册技能「${label}」…` },
    ]);
    const replace = (content: string) =>
      setMessages((current) => current.map((item) => (item.id === pendingId ? { ...item, content } : item)));

    try {
      const form = new FormData();
      if (input.kind === "folder") {
        if (input.files.length === 0) {
          replace("该文件夹没有可读取的文本文件，未注册。");
          return;
        }
        form.set("folderName", input.folderName);
        for (const file of input.files) {
          form.append("file", new File([file.content], file.path, { type: "text/plain" }));
        }
      } else {
        form.set("archive", input.archive, input.archive.name);
      }

      const response = await fetch("/api/skills", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as {
        name?: string;
        description?: string;
        docGenerated?: boolean;
        message?: string;
        excluded?: Array<{ path: string; reason: string }>;
      };
      if (!response.ok) {
        replace(data.message ?? "技能注册失败。");
        return;
      }
      const hint = data.docGenerated ? "" : "（未生成描述，可在对话中补充）";
      replace(`已注册技能：${data.name} — ${data.description}${hint}`);
      // REQ-F-020 ⑤: never drop content silently.
      if (data.excluded?.length) {
        appendSystemMessage(describeExcluded(data.excluded));
      }
      // REQ-F-028 ④: the ☰ menu's skill list picks this up without a reload.
      window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
    } catch {
      replace("技能注册失败。");
    }
  }

  /**
   * CR-20260910-skill-intake CP-1. The P6 root cause was calling `preventDefault()`
   * only AFTER deciding the drop was usable — a dropped zip fell through to the
   * browser, which navigated away, and nothing ever reached the server. Now the
   * default is stopped first and every outcome, including refusal, is spoken.
   */
  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }
    event.preventDefault();
    setDragActive(false);

    const dropped = classifyDrop(event.dataTransfer);
    if (dropped.kind === "folder") {
      void collectFolderFiles(dropped.entry).then((files) =>
        submitSkillUpload({ kind: "folder", folderName: dropped.name, files })
      );
    } else if (dropped.kind === "archive") {
      void submitSkillUpload({ kind: "archive", archive: dropped.file });
    } else {
      appendSystemMessage(`只能接收技能文件夹或 zip 压缩包，本次未处理：${dropped.reason}`);
    }
  }

  function handleFolderPicked(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) {
      return;
    }
    // webkitdirectory gives每个 File a `webkitRelativePath` of `<folder>/<rest…>`.
    const first = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? picked[0].name;
    const folderName = first.split("/")[0] || "skill";
    void Promise.all(
      picked.map(async (file) => {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
        return { path: relative.split("/").slice(1).join("/") || file.name, content: await file.text() };
      })
    ).then((files) => submitSkillUpload({ kind: "folder", folderName, files }));
  }

  function handleArchivePicked(event: ChangeEvent<HTMLInputElement>) {
    const [archive] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (archive) {
      void submitSkillUpload({ kind: "archive", archive });
    }
  }

  function handleNewConversation() {
    // Clearing the messages collapses the panel on its own (hasTranscript -> false).
    setMessages([]);
    setErrorLine(null);
    endSession();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || isStreaming) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    let receivedText = false;

    setErrorLine(null);
    // Sending is an implicit "show me the conversation" — expand and persist it (REQ-F-019 ⑤⑥).
    applyCollapsed(false);
    setJustFinished(false);
    setInput("");
    setIsStreaming(true);
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", content: message },
      { id: assistantId, role: "assistant", content: "" },
    ]);

    const rollbackOptimistic = () => {
      // showTranscript follows `messages`, so removing the optimistic turn collapses on its own.
      setMessages((current) => current.filter((item) => item.id !== userId && item.id !== assistantId));
    };

    try {
      for await (const chunk of onStream({
        message,
        conversationId: conversationId ?? undefined,
        signal: controller.signal,
      })) {
        if (chunk.type === "start") {
          setConversationId(chunk.conversationId);
          markSessionEnded(false);
        } else if (chunk.type === "delta") {
          receivedText = true;
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId ? { ...item, content: `${item.content}${chunk.text}` } : item
            )
          );
        } else if (chunk.type === "stopped") {
          setMessages((current) =>
            current.map((item) => (item.id === assistantId ? { ...item, status: "stopped" } : item))
          );
          endSession();
          break;
        } else if (chunk.type === "error") {
          // In-stream failure: the reply had already started, so it stays as a flagged bubble.
          setMessages((current) =>
            current.map((item) => (item.id === assistantId ? { ...item, status: "error" } : item))
          );
          break;
        } else if (chunk.type === "insight") {
          window.dispatchEvent(new Event(DISPLAY_CHANGED_EVENT));
          appendSystemMessage("已生成洞察，可在展示屏查看。");
        } else if (chunk.type === "insight-missing") {
          appendSystemMessage(chunk.reason === "incomplete" ? "本轮的 HTML 不完整。" : "本轮未产出 HTML。");
        } else if (chunk.type === "display") {
          window.dispatchEvent(new Event(DISPLAY_CHANGED_EVENT));
        } else if (chunk.type === "skill") {
          appendSystemMessage(`本轮使用技能：${chunk.name}`);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setMessages((current) =>
          current.map((item) => (item.id === assistantId ? { ...item, status: "stopped" } : item))
        );
        endSession();
      } else if (error instanceof PreStreamError || !receivedText) {
        // REQ-F-016: request-level error — nothing was persisted, so drop the optimistic
        // turn, show a red line above the input, and leave the session untouched.
        rollbackOptimistic();
        setErrorLine(error instanceof Error ? error.message : "对话请求失败。");
      } else {
        setMessages((current) =>
          current.map((item) => (item.id === assistantId ? { ...item, status: "error" } : item))
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      // REQ-F-019 ④: if the user collapsed the panel mid-reply, give a brief
      // light pulse when it finishes — they never saw the transcript.
      if (userCollapsedRef.current) {
        setJustFinished(true);
        if (finishTimerRef.current) {
          clearTimeout(finishTimerRef.current);
        }
        finishTimerRef.current = setTimeout(() => setJustFinished(false), 1200);
      }
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setMessages((current) =>
      current.map((item, index) =>
        index === current.length - 1 && item.role === "assistant" ? { ...item, status: "stopped" } : item
      )
    );
    endSession();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  const hasInput = input.trim().length > 0;

  return (
    <section
      className={`floating-chat ${showTranscript ? "floating-chat--expanded" : ""} ${
        dragActive ? "floating-chat--drag" : ""
      }`}
      aria-label="Agent-Jarvis chat"
      onDragOver={(event) => {
        if ([...(event.dataTransfer?.types ?? [])].includes("Files")) {
          event.preventDefault();
          setDragActive(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) {
          setDragActive(false);
        }
      }}
      onDrop={handleDrop}
    >
      <div className="floating-chat__status">
        <span className={`floating-chat__light floating-chat__light--${lightState}`} aria-hidden="true" />
        <span className="floating-chat__sr" role="status">
          {LIGHT_LABEL[lightState]}
        </span>

        {/* REQ-F-020 ①: an explicit intake path next to the drop target — drag-and-drop
            of directories is uneven across browsers, and a keyboard user has no drop. */}
        <input
          ref={folderInputRef}
          type="file"
          hidden
          aria-label="选择技能文件夹"
          onChange={handleFolderPicked}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />
        <input
          ref={archiveInputRef}
          type="file"
          hidden
          aria-label="选择技能 zip 压缩包"
          accept=".zip,application/zip"
          onChange={handleArchivePicked}
        />
        <button type="button" className="floating-chat__upload" onClick={() => folderInputRef.current?.click()}>
          上传文件夹
        </button>
        <button type="button" className="floating-chat__upload" onClick={() => archiveInputRef.current?.click()}>
          上传 zip
        </button>

        {hasTranscript ? (
          <button
            type="button"
            className="floating-chat__toggle"
            aria-expanded={showTranscript}
            aria-label={showTranscript ? "收起对话" : "展开对话"}
            onClick={() => applyCollapsed(showTranscript)}
          >
            <span aria-hidden="true" className="floating-chat__toggle-icon" />
          </button>
        ) : null}
      </div>

      {showTranscript ? (
        <div className="floating-chat__messages" ref={transcriptRef} aria-live="polite">
          {messages.map((message) => (
            <article className={`floating-chat__message floating-chat__message--${message.role}`} key={message.id}>
              {message.role === "assistant" ? (
                message.content ? (
                  <Markdown text={message.content} />
                ) : (
                  "..."
                )
              ) : (
                message.content
              )}
              {message.status === "error" ? <span className="floating-chat__flag"> （生成失败）</span> : null}
              {message.status === "stopped" ? <span className="floating-chat__flag"> （已停止）</span> : null}
            </article>
          ))}
        </div>
      ) : null}

      {errorLine ? (
        <p className="floating-chat__error" role="alert">
          {errorLine}
        </p>
      ) : null}

      <form className="floating-chat__form" ref={formRef} onSubmit={handleSubmit}>
        <textarea
          aria-label="Message"
          placeholder="Ask Agent-Jarvis"
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {isStreaming ? (
          <button type="button" onClick={handleStop}>
            停止
          </button>
        ) : hasInput ? (
          <button type="submit">发送</button>
        ) : (
          <button type="button" onClick={handleNewConversation}>
            新对话
          </button>
        )}
      </form>
    </section>
  );
}

function safeJsonParse(value: string): {
  type?: unknown;
  text?: unknown;
  message?: unknown;
  conversationId?: unknown;
  insightId?: unknown;
  reason?: unknown;
  kind?: unknown;
  name?: unknown;
} | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

type DroppedFile = { path: string; content: string };
const MAX_SKILL_FILE_BYTES = 512 * 1024;

/** The only two shapes `submitSkillUpload` accepts (CR-20260910-skill-intake CP-11). */
type SkillUploadInput =
  | { kind: "folder"; folderName: string; files: DroppedFile[] }
  | { kind: "archive"; archive: File };

type DropClassification =
  | { kind: "folder"; name: string; entry: FileSystemDirectoryEntry }
  | { kind: "archive"; file: File }
  | { kind: "none"; reason: string };

const EXCLUDED_REASON_TEXT: Record<string, string> = {
  binary: "二进制文件",
  "too-large": "文件过大",
  "not-injected": "扩展名不在白名单，已保存但不进入对话上下文",
  "unsupported-zip-method": "压缩包内不支持的压缩方式",
};

/** REQ-F-020 ⑤: say what was left out and why, instead of dropping it silently. */
export function describeExcluded(excluded: Array<{ path: string; reason: string }>): string {
  const shown = excluded
    .slice(0, 5)
    .map((item) => `${item.path}（${EXCLUDED_REASON_TEXT[item.reason] ?? item.reason}）`)
    .join("、");
  const rest = excluded.length > 5 ? ` 等 ${excluded.length} 个文件` : "";
  return `以下文件未纳入技能内容：${shown}${rest}`;
}

/**
 * Classify a drop **synchronously** — the DataTransfer item list is cleared once
 * the handler returns, so entries must be pulled out before any await.
 */
export function classifyDrop(dataTransfer: DataTransfer): DropClassification {
  const directories: FileSystemDirectoryEntry[] = [];
  const files: File[] = [];

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item.kind !== "file") {
      continue;
    }
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      directories.push(entry as FileSystemDirectoryEntry);
      continue;
    }
    const file = item.getAsFile?.();
    if (file) {
      files.push(file);
    }
  }

  if (directories.length === 1 && files.length === 0) {
    return { kind: "folder", name: directories[0].name, entry: directories[0] };
  }
  if (directories.length === 0 && files.length === 1 && /\.zip$/i.test(files[0].name)) {
    return { kind: "archive", file: files[0] };
  }
  if (directories.length > 1) {
    return { kind: "none", reason: "一次只能拖入一个技能文件夹" };
  }
  if (files.length > 1) {
    return { kind: "none", reason: "一次只能拖入一个 zip 压缩包" };
  }
  if (files.length === 1) {
    return { kind: "none", reason: `「${files[0].name}」不是 zip 压缩包` };
  }
  return { kind: "none", reason: "没有识别到文件夹或 zip 压缩包" };
}

async function collectFolderFiles(root: FileSystemDirectoryEntry): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];

  async function readDir(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    // readEntries returns in batches until it yields an empty array.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries((entries) => resolve(entries), reject)
      );
      if (batch.length === 0) {
        break;
      }
      all.push(...batch);
    }
    return all;
  }

  // `prefix` is the folder-relative directory path ("" at the root).
  async function walk(entry: FileSystemEntry, prefix: string): Promise<void> {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file((f) => resolve(f), reject)
      );
      if (file.size > MAX_SKILL_FILE_BYTES) {
        return;
      }
      const content = await file.text();
      if (content.includes("\u0000")) {
        return; // binary
      }
      out.push({ path: relPath, content });
      return;
    }
    if (entry.isDirectory) {
      for (const child of await readDir(entry as FileSystemDirectoryEntry)) {
        await walk(child, relPath);
      }
    }
  }

  for (const child of await readDir(root)) {
    await walk(child, "");
  }
  return out;
}
