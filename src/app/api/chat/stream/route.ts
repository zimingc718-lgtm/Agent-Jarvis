import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { ChatServiceError, runChatTurn } from "@/lib/chat";
import { showHome, showInsight } from "@/lib/display";
import { captureSkillHtml, makeCompleter, resolveSkillForTurn, routeTurn, type TurnRoute } from "@/lib/skills";
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

  // CR-20260909-skills / DEC-016: one independent minimal call decides the skill
  // and any "show the home screen" intent for this send. Fail-open throughout.
  let route: TurnRoute = { skill: null, display: null };
  let skillSegment: string | undefined;
  const skills = store.listSkills(auth.userId);
  if (skills.length > 0 && message.trim()) {
    let completer = null;
    try {
      const provider = store.resolveActiveProvider(auth.userId);
      completer = provider ? makeCompleter(provider) : null;
    } catch {
      completer = null;
    }
    route = await routeTurn(
      message,
      skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description })),
      completer
    );
    if (route.skill) {
      const hit = skills.find((skill) => skill.name === route.skill);
      if (hit) {
        skillSegment = await resolveSkillForTurn(hit.dirPath);
      }
    }
  }

  try {
    const stream = await runChatTurn({
      store,
      userId: auth.userId,
      providerId,
      conversationId,
      message,
      model,
      signal: request.signal,
      skill: skillSegment,
      onFinal: (finalText, status, activeConversationId) => {
        const tail: ChatDelta[] = [];
        // CR-20260909-display-screen: "show the home screen" is known up front.
        if (route.display === "home") {
          showHome();
          tail.push({ type: "display", kind: "home" });
        }
        // CR-20260909-skills CP-10: the insight write lives here, not in chat.ts.
        if (skillSegment && status === "complete") {
          const captured = captureSkillHtml(finalText);
          if ("html" in captured) {
            const insight = store.insertInsight({
              conversationId: activeConversationId,
              kind: "skill",
              html: captured.html,
            });
            showInsight(insight.id);
            tail.push({ type: "insight", insightId: insight.id });
          } else {
            tail.push({ type: "insight-missing", reason: captured.missing });
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
