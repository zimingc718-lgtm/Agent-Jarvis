import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { ChatServiceError, runChatTurn } from "@/lib/chat";
import { getStore } from "@/lib/store-singleton";

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
  const providerId = typeof body.providerId === "string" ? body.providerId : "";
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : undefined;
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
  const message = typeof body.message === "string" ? body.message : "";

  try {
    const stream = await runChatTurn({
      store: getStore(),
      userId: auth.userId,
      providerId,
      conversationId,
      message,
      model,
      signal: request.signal,
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
