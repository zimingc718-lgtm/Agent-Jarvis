import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import {
  isKnowledgeTextPath,
  KNOWLEDGE_ROOT,
  KnowledgeError,
  listKnowledge,
  listPending,
  MAX_ENTRY_BYTES,
  saveKnowledge,
} from "@/lib/knowledge";

/**
 * Knowledge base listing and the two user-initiated consolidation entries
 * (REQ-F-044, REQ-F-046 ①②; TASK-084): a dropped text file (multipart `file`) or a
 * JSON body from the 「存入知识库」 button. Both are the user's own action, so they enter
 * the searchable set directly — only model proposals go through `pending/`.
 */

export async function GET() {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }
  const [entries, pending] = await Promise.all([listKnowledge(KNOWLEDGE_ROOT), listPending(KNOWLEDGE_ROOT)]);
  return NextResponse.json({ entries, pending });
}

export async function POST(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ message: "缺少文件。" }, { status: 400 });
      }
      if (!isKnowledgeTextPath(file.name)) {
        return NextResponse.json({ message: `「${file.name}」不是文本笔记（支持 .md / .txt）。` }, { status: 400 });
      }
      if (file.size > MAX_ENTRY_BYTES) {
        return NextResponse.json({ message: `「${file.name}」超过 ${Math.floor(MAX_ENTRY_BYTES / 1024)}KB。` }, { status: 413 });
      }
      const stem = file.name.replace(/\.[^.]+$/, "");
      const entry = await saveKnowledge(
        { content: await file.text(), source: "file", preferredName: stem, title: undefined },
        KNOWLEDGE_ROOT
      );
      return NextResponse.json({ ok: true, entry }, { status: 201 });
    }

    const body = (await request.json().catch(() => ({}))) as { title?: unknown; content?: unknown; source?: unknown };
    const content = typeof body.content === "string" ? body.content : "";
    const title = typeof body.title === "string" ? body.title : undefined;
    const source = body.source === "conversation" || body.source === "manual" ? body.source : "manual";
    const entry = await saveKnowledge({ title, content, source }, KNOWLEDGE_ROOT);
    return NextResponse.json({ ok: true, entry }, { status: 201 });
  } catch (error) {
    if (error instanceof KnowledgeError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return NextResponse.json({ message: "知识保存失败。" }, { status: 500 });
  }
}
