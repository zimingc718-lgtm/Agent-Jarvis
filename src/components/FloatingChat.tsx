"use client";

import { ChangeEvent, DragEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { DISPLAY_CHANGED_EVENT, KNOWLEDGE_CHANGED_EVENT, SKILLS_CHANGED_EVENT, USAGE_CHANGED_EVENT } from "@/lib/ui-events";
import type { ChatDelta, Source } from "@/lib/types";
import {
  ChevronDown,
  FileArchive,
  FolderUp,
  BookmarkPlus,
  MessageSquarePlus,
  SendHorizontal,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Markdown } from "@/lib/markdown";

export type FloatingMessage = {
  id: string;
  /**
   * `step` rows are the tool step stream (REQ-F-035 ①); `summary` rows mark a
   * compaction boundary (REQ-F-043). Neither is conversation content.
   */
  role: "user" | "assistant" | "system" | "step" | "summary";
  content: string;
  status?: string;
  /** Step rows only. */
  callId?: string;
  toolName?: string;
  argsSummary?: string;
  stepState?: "running" | "ok" | "failed";
  /** Assistant rows that cited web sources (REQ-F-039). */
  sources?: Source[];
};

/**
 * The wire events, imported from the server's own union rather than re-declared here.
 * The previous local copy plus an allow-list in the parser meant any event the client
 * had not been taught about was dropped in silence — CP-40.
 */
export type ChatStreamEvent = ChatDelta;

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

const STEP_STATE_MARK: Record<NonNullable<FloatingMessage["stepState"]>, string> = {
  running: "…",
  ok: "✓",
  failed: "✕",
};

/**
 * Place a compaction marker where a refresh would rebuild it (REQ-F-043, DEC-030 ①):
 * right after the last row the summary covers. Rows restored from the database carry
 * their database ids, so `afterMessageId` usually matches; rows streamed in this
 * session carry client ids, so the fallback counts user turns from the end — the
 * boundary sits ahead of the `keptTurns` most recent user turns (the current one
 * included). Exported for the unit test.
 */
export function insertCompactionMarker(
  rows: FloatingMessage[],
  event: { summary: string; afterMessageId: string | null; keptTurns: number }
): FloatingMessage[] {
  const marker: FloatingMessage = { id: `summary-${crypto.randomUUID()}`, role: "summary", content: event.summary };
  let insertAt = -1;
  if (event.afterMessageId) {
    const anchor = rows.findIndex((row) => row.id === event.afterMessageId);
    if (anchor >= 0) {
      insertAt = anchor + 1;
    }
  }
  if (insertAt < 0) {
    let remaining = Math.max(1, event.keptTurns);
    insertAt = 0;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index].role === "user") {
        remaining -= 1;
        if (remaining === 0) {
          insertAt = index;
          break;
        }
      }
    }
  }
  return [...rows.slice(0, insertAt), marker, ...rows.slice(insertAt)];
}

/**
 * The compaction boundary (REQ-F-043).
 *
 * Deliberately NOT a message bubble: the user asked for compaction to be silent, and a
 * system message in the flow is not silent. A thin divider with a small label keeps
 * reading uninterrupted while leaving the summary reachable — because "don't interrupt"
 * is not the same as "leave no trace", and a model that suddenly forgets things the user
 * cannot inspect is worse than a one-line divider.
 */
function CompactionMarker({ row }: { row: FloatingMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="floating-chat__compaction my-1 w-full" data-role="summary">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "收起早前对话的摘要" : "展开早前对话的摘要"}
          className="floating-chat__compaction-toggle rounded px-1 text-[11px] text-muted-foreground underline underline-offset-2"
          onClick={() => setOpen((current) => !current)}
        >
          早前对话已压缩为摘要
        </button>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      {open ? (
        <p className="floating-chat__compaction-body mt-1 whitespace-pre-wrap rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          {row.content}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One row of the step stream (REQ-F-035 ①②). Compact by default — the detail is behind
 * a real `<button>` with `aria-expanded`, because a 10-step turn would otherwise bury
 * the answer. A tool error shows up here, not as a request-level red line and not as a
 * "generation failed" bubble: it is a tool result (REQ-F-016 clarification).
 */
function ToolStepRow({ step }: { step: FloatingMessage }) {
  const [open, setOpen] = useState(false);
  const state = step.stepState ?? "running";
  const detail = step.content.trim();
  return (
    <div
      className={cn(
        "floating-chat__step self-start rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs",
        `floating-chat__step--${state}`
      )}
      data-tool={step.toolName}
      data-state={state}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{STEP_STATE_MARK[state]}</span>
        <span className="font-medium">{step.toolName}</span>
        <span className="truncate text-muted-foreground">{step.argsSummary}</span>
        {detail ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? `收起 ${step.toolName} 的结果` : `展开 ${step.toolName} 的结果`}
            className="floating-chat__step-toggle ml-auto rounded px-1 underline underline-offset-2"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? "收起" : "详情"}
          </button>
        ) : null}
      </div>
      {open && detail ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

/**
 * Five identifiable states (REQ-F-036 ①). `tool` is the one this CR adds, and adding it
 * deliberately breaks the "four states, no more" line CR-20260909-collapsible-panel drew
 * — a multi-step turn can run for half a minute, and when the panel is collapsed the
 * light is the only thing telling the user what is happening (user ruling 1, 2026-09-10).
 */
type LightState = "checking" | "off" | "ready" | "busy" | "tool" | "done";

const LIGHT_LABEL: Record<LightState, string> = {
  checking: "正在检测模型连接",
  off: "没有可用的模型",
  ready: "模型就绪",
  busy: "正在生成回复",
  tool: "正在执行工具",
  done: "回复已就绪",
};

/**
 * Hue AND shape differ per state. `busy` and `tool` must stay apart under
 * `prefers-reduced-motion`, where the animation is gone — so `tool` also carries a ring
 * (REQ-F-036 ③).
 */
const LIGHT_TONE: Record<LightState, string> = {
  checking: "bg-muted-foreground/50 motion-safe:animate-pulse",
  off: "bg-muted-foreground/40",
  ready: "bg-primary",
  busy: "bg-primary motion-safe:animate-pulse",
  tool: "bg-amber-500 ring-2 ring-amber-500/40 ring-offset-1 ring-offset-background motion-safe:animate-pulse",
  done: "bg-emerald-500",
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
      // Single source of truth (CP-40): anything the server declared in `ChatDelta`
      // reaches the consumer. No per-type allow-list to forget to update.
      yield parsed as unknown as ChatStreamEvent;
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
  /** True between a `tool_call` and its `tool_result` — drives the fifth light state. */
  const [toolPhase, setToolPhase] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [probeState, setProbeState] = useState<Exclude<LightState, "busy" | "tool" | "done">>(
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
  /**
   * Drives the taller transcript cap (REQ-F-003 as rewritten): plain conversation keeps
   * half the viewport, a turn carrying a step stream gets 75% — otherwise a 10-step run
   * pushes the reply itself out of view (user ruling 5, 2026-09-10).
   */
  const hasSteps = messages.some((message) => message.role === "step");
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

  // While collapsed the transcript is out of the DOM, so the light carries the phase
  // distinction on its own (REQ-F-019 ④ as rewritten).
  const lightState: LightState = isStreaming
    ? toolPhase
      ? "tool"
      : "busy"
    : justFinished
      ? "done"
      : probeState;

  function endSession() {
    setConversationId(null);
    markSessionEnded(true);
  }

  const [savingKnowledgeId, setSavingKnowledgeId] = useState<string | null>(null);

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
    } else if (dropped.kind === "note") {
      void submitKnowledgeFile(dropped.file);
    } else {
      appendSystemMessage(`只能接收技能文件夹、zip 压缩包或文本笔记（.md / .txt），本次未处理：${dropped.reason}`);
    }
  }

  /**
   * REQ-F-046 ①: a dropped text file becomes a knowledge entry. Same shape as the skill
   * intake — a pending system row that is replaced by the receipt or the refusal, so the
   * outcome is never silent.
   */
  async function submitKnowledgeFile(file: File) {
    applyCollapsed(false);
    const pendingId = crypto.randomUUID();
    setMessages((current) => [...current, { id: pendingId, role: "system", content: `正在存入知识库「${file.name}」…` }]);
    const replace = (content: string) =>
      setMessages((current) => current.map((item) => (item.id === pendingId ? { ...item, content } : item)));
    try {
      const form = new FormData();
      form.set("file", file, file.name);
      const response = await fetch("/api/knowledge", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { entry?: { title: string }; message?: string };
      if (!response.ok || !data.entry) {
        replace(data.message ?? "存入知识库失败。");
        return;
      }
      replace(`已存入知识库：${data.entry.title}`);
      window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));
    } catch {
      replace("存入知识库失败。");
    }
  }

  /** REQ-F-046 ②: one click keeps a reply — the user's own act, so it enters the base directly. */
  async function saveReplyToKnowledge(message: FloatingMessage) {
    const content = message.content.trim();
    if (!content) {
      return;
    }
    setSavingKnowledgeId(message.id);
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, source: "conversation" }),
      });
      const data = (await response.json().catch(() => ({}))) as { entry?: { title: string }; message?: string };
      appendSystemMessage(response.ok && data.entry ? `已存入知识库：${data.entry.title}` : (data.message ?? "存入知识库失败。"));
      if (response.ok) {
        window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));
      }
    } catch {
      appendSystemMessage("存入知识库失败。");
    } finally {
      setSavingKnowledgeId(null);
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
        } else if (chunk.type === "tool_call") {
          // REQ-F-035 ①: a step row opens here and is closed by its `tool_result`.
          // Inserted BEFORE the assistant bubble so the reply stays last.
          setToolPhase(true);
          setMessages((current) => {
            const row: FloatingMessage = {
              id: `step-${chunk.callId}`,
              role: "step",
              content: "",
              callId: chunk.callId,
              toolName: chunk.name,
              argsSummary: chunk.argsSummary,
              stepState: "running",
            };
            const at = current.findIndex((item) => item.id === assistantId);
            return at < 0 ? [...current, row] : [...current.slice(0, at), row, ...current.slice(at)];
          });
        } else if (chunk.type === "tool_result") {
          setToolPhase(false);
          setMessages((current) =>
            current.map((item) =>
              item.callId === chunk.callId
                ? { ...item, stepState: chunk.ok ? "ok" : "failed", content: chunk.summary }
                : item
            )
          );
          // A tool that changed the display screen takes effect mid-loop (DEC-017 ⑤).
          window.dispatchEvent(new Event(DISPLAY_CHANGED_EVENT));
        } else if (chunk.type === "sources") {
          setMessages((current) =>
            current.map((item) => (item.id === assistantId ? { ...item, sources: chunk.sources } : item))
          );
        } else if (chunk.type === "usage") {
          window.dispatchEvent(new CustomEvent(USAGE_CHANGED_EVENT, { detail: chunk.usage }));
        } else if (chunk.type === "truncated") {
          appendSystemMessage(`已达 ${chunk.steps} 步上限，已停止。已完成的部分保留，可继续追问。`);
        } else if (chunk.type === "tools-unavailable") {
          appendSystemMessage(chunk.reason);
        } else if (chunk.type === "notice") {
          appendSystemMessage(chunk.text);
        } else if (chunk.type === "knowledge_pending") {
          // REQ-F-046 ③: a proposal is news the user must act on, so it is said in the
          // transcript AND the ☰ list refreshes to show the 采纳 / 忽略 controls.
          appendSystemMessage(`模型提议了知识条目「${chunk.title}」，已放入待采纳区——在 ☰ 菜单「知识库」中采纳或忽略。`);
          window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));
        } else if (chunk.type === "compacted") {
          // REQ-F-043: the boundary shows up in the live transcript at the same place a
          // refresh would rebuild it — silent (no bubble), but not traceless.
          setMessages((current) => insertCompactionMarker(current, chunk));
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
      className={cn(
        // pb clears the iOS home indicator (env(safe-area-inset-bottom)).
        "floating-chat fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-3xl flex-col gap-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:p-4 sm:pb-[calc(1rem+env(safe-area-inset-bottom,0px))]",
        showTranscript && "floating-chat--expanded",
        dragActive && "floating-chat--drag"
      )}
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
      <div
        className={cn(
          "flex flex-col gap-2 rounded-xl border border-border bg-card/95 p-2 text-card-foreground shadow-lg backdrop-blur",
          dragActive && "border-primary ring-2 ring-ring"
        )}
      >
        <div className="floating-chat__status flex flex-wrap items-center gap-2 px-1">
          <span
            className={cn(
              "floating-chat__light size-2.5 shrink-0 rounded-full",
              `floating-chat__light--${lightState}`,
              LIGHT_TONE[lightState]
            )}
            aria-hidden="true"
          />
          <span className="floating-chat__sr sr-only" role="status">
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="floating-chat__upload gap-1.5"
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderUp aria-hidden="true" className="size-4" />
            上传文件夹
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="floating-chat__upload gap-1.5"
            onClick={() => archiveInputRef.current?.click()}
          >
            <FileArchive aria-hidden="true" className="size-4" />
            上传 zip
          </Button>

          {hasTranscript ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="floating-chat__toggle ml-auto"
              aria-expanded={showTranscript}
              aria-label={showTranscript ? "收起对话" : "展开对话"}
              onClick={() => applyCollapsed(showTranscript)}
            >
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "floating-chat__toggle-icon size-4 transition-transform",
                  !showTranscript && "rotate-180"
                )}
              />
            </Button>
          ) : null}
        </div>

        {showTranscript ? (
          <div
            className={cn(
              "floating-chat__messages flex flex-col gap-3 overflow-y-auto overscroll-contain px-1 py-1",
              hasSteps ? "max-h-[75vh]" : "max-h-[50vh]"
            )}
            ref={transcriptRef}
            aria-live="polite"
          >
            {messages.map((message) =>
              message.role === "summary" ? (
                <CompactionMarker key={message.id} row={message} />
              ) : message.role === "step" ? (
                <ToolStepRow key={message.id} step={message} />
              ) : (
                <article
                  className={cn(
                    "floating-chat__message max-w-[85%] break-words rounded-lg px-3 py-2 text-sm",
                    `floating-chat__message--${message.role}`,
                    message.role === "user"
                      ? "self-end bg-primary text-primary-foreground"
                      : "self-start bg-muted text-foreground"
                  )}
                  key={message.id}
                >
                  {message.role === "assistant" ? (
                    message.content ? (
                      <Markdown text={message.content} />
                    ) : (
                      "..."
                    )
                  ) : (
                    message.content
                  )}
                  {message.role === "assistant" && message.content && message.status !== "error" && !isStreaming ? (
                    <button
                      type="button"
                      className="floating-chat__save-knowledge mt-1 inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                      aria-label="把这条回复存入知识库"
                      disabled={savingKnowledgeId === message.id}
                      onClick={() => void saveReplyToKnowledge(message)}
                    >
                      <BookmarkPlus aria-hidden="true" className="size-3" />
                      存入知识库
                    </button>
                  ) : null}
                  {message.status === "error" ? (
                    <span className="floating-chat__flag text-xs opacity-80"> （生成失败）</span>
                  ) : null}
                  {message.status === "stopped" ? (
                    <span className="floating-chat__flag text-xs opacity-80"> （已停止）</span>
                  ) : null}
                  {message.sources?.length ? (
                    <ul className="floating-chat__sources mt-2 space-y-1 border-t border-border/60 pt-2 text-xs">
                      {message.sources.map((source) => (
                        <li key={source.url}>
                          <a
                            className="underline underline-offset-2 hover:no-underline"
                            href={source.url}
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            {source.title || source.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              )
            )}
          </div>
        ) : null}

        {errorLine ? (
          <p className="floating-chat__error px-1 text-sm text-destructive" role="alert">
            {errorLine}
          </p>
        ) : null}

        <form className="floating-chat__form flex items-end gap-2" ref={formRef} onSubmit={handleSubmit}>
          <Textarea
            aria-label="Message"
            placeholder="Ask Agent-Jarvis"
            rows={1}
            className="max-h-40 min-h-11 flex-1 resize-y"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          {isStreaming ? (
            <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={handleStop}>
              <Square aria-hidden="true" className="size-4" />
              停止
            </Button>
          ) : hasInput ? (
            <Button type="submit" className="min-h-11 gap-1.5">
              <SendHorizontal aria-hidden="true" className="size-4" />
              发送
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 gap-1.5"
              onClick={handleNewConversation}
            >
              <MessageSquarePlus aria-hidden="true" className="size-4" />
              新对话
            </Button>
          )}
        </form>
      </div>
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
  /** A single .md / .txt file: a knowledge note, not a skill (REQ-F-046 ①). */
  | { kind: "note"; file: File }
  | { kind: "none"; reason: string };

const NOTE_EXTENSIONS = /\.(md|markdown|txt)$/i;

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
  if (directories.length === 0 && files.length === 1 && NOTE_EXTENSIONS.test(files[0].name)) {
    return { kind: "note", file: files[0] };
  }
  if (directories.length > 1) {
    return { kind: "none", reason: "一次只能拖入一个技能文件夹" };
  }
  if (files.length > 1) {
    return { kind: "none", reason: "一次只能拖入一个 zip 压缩包或一个文本笔记" };
  }
  if (files.length === 1) {
    return { kind: "none", reason: `「${files[0].name}」不是 zip 压缩包，也不是 .md / .txt 文本笔记` };
  }
  return { kind: "none", reason: "没有识别到文件夹、zip 压缩包或文本笔记" };
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
