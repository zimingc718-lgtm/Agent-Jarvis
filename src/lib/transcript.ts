import type { MessageRecord } from "./store";
import type { Source } from "./types";

/**
 * Rebuilds the visible transcript from persisted rows (REQ-F-035 ④, TASK-075 ③).
 *
 * A tool round is stored as an assistant row carrying `tool_calls` plus one `tool` row
 * per call. The user never saw those as bubbles — they saw step rows — so a refresh has
 * to reassemble the same shape, otherwise the history on screen differs from what was
 * there a moment ago. The assistant row supplies the tool name and arguments; the `tool`
 * row supplies the outcome.
 *
 * Pure function: no DOM, no React, no db. Shared by the server page and the tests.
 */

export type TranscriptRow = {
  id: string;
  role: "user" | "assistant" | "system" | "step";
  content: string;
  status?: string;
  callId?: string;
  toolName?: string;
  argsSummary?: string;
  stepState?: "running" | "ok" | "failed";
  sources?: Source[];
};

const MAX_ARGS_SUMMARY = 200;

function summarize(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim();
  return flat.length > MAX_ARGS_SUMMARY ? `${flat.slice(0, MAX_ARGS_SUMMARY)}…` : flat;
}

export function buildTranscript(records: MessageRecord[]): TranscriptRow[] {
  // Tool results are keyed by call id so a step row can be emitted where the *request*
  // was, keeping steps ahead of the reply they produced.
  const resultByCallId = new Map<string, MessageRecord>();
  for (const record of records) {
    if (record.role === "tool" && record.toolCallId) {
      resultByCallId.set(record.toolCallId, record);
    }
  }

  const rows: TranscriptRow[] = [];
  for (const record of records) {
    if (record.role === "tool") {
      continue; // surfaced as a step row alongside its request
    }
    if (record.role === "assistant" && record.toolCalls?.length) {
      if (record.content.trim()) {
        rows.push({ id: record.id, role: "assistant", content: record.content, status: record.status });
      }
      for (const call of record.toolCalls) {
        const result = resultByCallId.get(call.id);
        rows.push({
          id: `step-${call.id}`,
          role: "step",
          content: result?.content ?? "",
          callId: call.id,
          toolName: call.function.name,
          argsSummary: summarize(call.function.arguments),
          // A call with no stored result is one that never came back — the turn was
          // stopped or hit the ceiling. It reads as failed, not as still running.
          stepState: result ? (result.status === "error" ? "failed" : "ok") : "failed",
        });
      }
      continue;
    }
    rows.push({
      id: record.id,
      role: record.role === "assistant" ? "assistant" : "user",
      content: record.content,
      status: record.status,
      ...(record.sources ? { sources: record.sources } : {}),
    });
  }
  return rows;
}
