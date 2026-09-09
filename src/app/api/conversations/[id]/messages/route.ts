import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const { id } = await context.params;
  const store = getStore();
  const conversation = store.getConversationForUser(auth.userId, id);
  if (!conversation) {
    return NextResponse.json({ message: "Conversation not found." }, { status: 404 });
  }

  return NextResponse.json({
    conversation,
    messages: store.listMessages(id).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
    })),
  });
}
