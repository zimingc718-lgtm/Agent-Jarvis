import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { deleteKnowledge, KNOWLEDGE_ROOT, readKnowledge } from "@/lib/knowledge";

/** One entry: read back in full, or delete (REQ-F-044 ③④; TASK-084). */

type Params = { params: Promise<{ name: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }
  const name = decodeURIComponent((await params).name ?? "").trim();
  const entry = await readKnowledge(name, KNOWLEDGE_ROOT);
  if (!entry) {
    return NextResponse.json({ message: `没有名为「${name}」的知识条目。` }, { status: 404 });
  }
  return NextResponse.json({ entry });
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }
  const name = decodeURIComponent((await params).name ?? "").trim();
  if (!name) {
    return NextResponse.json({ message: "缺少条目名称。" }, { status: 400 });
  }
  const removed = await deleteKnowledge(name, KNOWLEDGE_ROOT);
  if (!removed) {
    return NextResponse.json({ message: `没有名为「${name}」的知识条目。` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, name });
}
