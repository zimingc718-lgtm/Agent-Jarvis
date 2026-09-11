import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { ChatServiceError, runChatTurn } from "@/lib/chat";
import { getStore } from "@/lib/store-singleton";
import type { ChatDelta } from "@/lib/types";

export async function POST(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const body = await request.json().catch(() => ({}));
  // CR-20260909: the floating console sends no provider — the server resolves the
  // highest-priority connected one. A providerId is still honoured as an override.
  const providerId = typeof body.providerId === "string" && body.providerId.trim() ? body.providerId.trim() : undefined;
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : undefined;
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
  const message = typeof body.message === "string" ? body.message : "";

  const store = getStore();

  // CR-20260910-agent-tooling: the pre-send routing call is gone (DEC-016 SUPERSEDED).
  // Skill selection, display control and insight capture are tools the model calls
  // inside the loop, so this handler only wires transport.
  const skillCount = store.listSkills(auth.userId).length;

  try {
    const stream = await runChatTurn({
      store,
      userId: auth.userId,
      providerId,
      conversationId,
      message,
      model,
      signal: request.signal,
      onFinal: (_finalText, status, activeConversationId) => {
        const tail: ChatDelta[] = [];
        // REQ-F-023 ③ (user ruling 1, keep it non-silent): when the model consulted a
        // skill but never called save_insight, say so rather than leaving the user to
        // wonder whether a report was produced.
        if (skillCount > 0 && status === "complete") {
          const produced = store
            .listInsights(activeConversationId)
            .some((insight) => Date.now() - Date.parse(insight.createdAt) < 60_000);
          if (!produced) {
            tail.push({ type: "notice", text: "本轮未产出洞察。" });
          }
        }
        return tail;
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  } catch (error) {
    if (error instanceof ChatServiceError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "Chat request failed." }, { status: 500 });
  }
}
