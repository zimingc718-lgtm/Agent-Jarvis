import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";

/**
 * CR-20260909-skills CP-5: the real read-back for captured skill HTML (principle 13).
 * The display screen (F2) consumes it; F1 ships it so `insights` writes have a consumer.
 */
export async function GET(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) {
    return NextResponse.json({ message: "conversationId is required." }, { status: 400 });
  }

  const store = getStore();
  if (!store.getConversationForUser(auth.userId, conversationId)) {
    return NextResponse.json({ message: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json({
    insights: store.listInsights(conversationId).map((insight) => ({
      id: insight.id,
      kind: insight.kind,
      html: insight.html,
      createdAt: insight.createdAt,
    })),
  });
}
