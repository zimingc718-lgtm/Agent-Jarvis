import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { ingestUrl } from "@/lib/ingest";
import {
  isKnowledgeTextPath,
  KnowledgeError,
  listKnowledge,
  listPending,
  MAX_ENTRY_BYTES,
  saveKnowledge,
} from "@/lib/knowledge";
import { resolveUserDataRoots } from "@/lib/user-data-paths";
import { messageFor } from "@/lib/coded-error";
import { requestTranslator } from "@/lib/i18n-request";
import { logRouteFailure } from "@/lib/log";

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
  const { knowledgeRoot } = await resolveUserDataRoots(auth.userId);
  const [entries, pending] = await Promise.all([listKnowledge(knowledgeRoot), listPending(knowledgeRoot)]);
  return NextResponse.json({ entries, pending });
}

export async function POST(request: Request) {
  const t = requestTranslator();
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }
  const { entitiesRoot, knowledgeRoot } = await resolveUserDataRoots(auth.userId);

  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ message: t("api.missingFile") }, { status: 400 });
      }
      if (!isKnowledgeTextPath(file.name)) {
        return NextResponse.json({ message: t("api.notTextNote", { name: file.name }) }, { status: 400 });
      }
      if (file.size > MAX_ENTRY_BYTES) {
        return NextResponse.json({ message: t("api.fileTooLarge", { name: file.name, kb: Math.floor(MAX_ENTRY_BYTES / 1024) }) }, { status: 413 });
      }
      const stem = file.name.replace(/\.[^.]+$/, "");
      const entry = await saveKnowledge(
        { content: await file.text(), source: "file", preferredName: stem, title: undefined },
        knowledgeRoot
      );
      return NextResponse.json({ ok: true, entry }, { status: 201 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      content?: unknown;
      source?: unknown;
      url?: unknown;
      entity?: unknown;
      docType?: unknown;
    };

    // A link is the third intake path, next to a dropped file and a kept reply. The
    // user asking for it is their own action, so it goes straight in.
    if (typeof body.url === "string" && body.url.trim()) {
      const outcome = await ingestUrl(body.url, {
        entity: typeof body.entity === "string" ? body.entity : "",
        docType: typeof body.docType === "string" ? body.docType : "",
        title: typeof body.title === "string" ? body.title : undefined,
        trustCaller: true,
        entitiesRoot,
        knowledgeRoot,
      });
      return outcome.ok
        ? NextResponse.json({ ok: true, entry: outcome.entry, pending: outcome.pending, reason: outcome.reason }, { status: 201 })
        : NextResponse.json({ message: outcome.reason }, { status: 400 });
    }

    const content = typeof body.content === "string" ? body.content : "";
    const title = typeof body.title === "string" ? body.title : undefined;
    const source = body.source === "conversation" || body.source === "manual" ? body.source : "manual";
    const entry = await saveKnowledge({ title, content, source }, knowledgeRoot);
    return NextResponse.json({ ok: true, entry }, { status: 201 });
  } catch (error) {
    if (error instanceof KnowledgeError) {
      return NextResponse.json({ message: messageFor(t, error) }, { status: error.status });
    }
    const requestId = logRouteFailure("/api/knowledge", error);
    return NextResponse.json({ message: t("api.knowledgeSaveFailed"), requestId }, { status: 500 });
  }
}
