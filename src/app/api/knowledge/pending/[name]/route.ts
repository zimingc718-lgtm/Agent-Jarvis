import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { adoptPending, discardPending } from "@/lib/knowledge";
import { resolveUserDataRoots } from "@/lib/user-data-paths";

/**
 * The approval step for model-proposed knowledge (REQ-F-046 ③; TASK-084).
 * POST adopts (moves the file into the searchable set), DELETE discards. Until one of
 * these happens the proposal is invisible to `search_knowledge`.
 */

type Params = { params: Promise<{ name: string }> };

type Guarded = { ok: true; knowledgeRoot: string } | { ok: false; response: NextResponse };

async function guard(): Promise<Guarded> {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ message: auth.message }, { status: auth.status }) };
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return { ok: false, response: unavailable };
  }
  const { knowledgeRoot } = await resolveUserDataRoots(auth.userId);
  return { ok: true, knowledgeRoot };
}

export async function POST(_request: Request, { params }: Params) {
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const name = decodeURIComponent((await params).name ?? "").trim();
  const entry = await adoptPending(name, guarded.knowledgeRoot);
  if (!entry) {
    return NextResponse.json({ message: `待采纳区没有「${name}」。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, entry });
}

export async function DELETE(_request: Request, { params }: Params) {
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const name = decodeURIComponent((await params).name ?? "").trim();
  const removed = await discardPending(name, guarded.knowledgeRoot);
  if (!removed) {
    return NextResponse.json({ message: `待采纳区没有「${name}」。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, name });
}
