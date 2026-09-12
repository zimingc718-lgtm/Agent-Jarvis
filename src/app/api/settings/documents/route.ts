import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import {
  labelFor,
  listDocuments,
  parseRoots,
  serializeRoots,
  SETTING_DOCUMENT_ROOTS,
  validateRoot,
  clearDocumentCache,
} from "@/lib/documents";

/**
 * Local document folders (REQ-F-110 ①, TASK-170 ④).
 *
 * Its own ☰ entry, next to 「搜索」, for the same reason that one is separate: the 「模型」
 * dialog is the provider priority surface and nothing else belongs in it (REQ-NF-006 ②).
 *
 * The folder is validated here, before it is stored — a root that does not resolve to a
 * real directory would otherwise sit in the database and fail at every read.
 */

async function payload() {
  const store = getStore();
  const roots = parseRoots(store.getSetting(SETTING_DOCUMENT_ROOTS));
  const documents = roots.length > 0 ? await listDocuments(roots) : [];
  return {
    roots,
    counts: { documents: documents.length },
  };
}

export async function GET() {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }
  return NextResponse.json(await payload());
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

  const body = (await request.json().catch(() => ({}))) as { path?: unknown };
  if (typeof body.path !== "string") {
    return NextResponse.json({ message: "缺少 path。" }, { status: 400 });
  }

  const checked = await validateRoot(body.path);
  if (!checked.ok) {
    return NextResponse.json({ message: checked.message }, { status: 400 });
  }

  const store = getStore();
  const roots = parseRoots(store.getSetting(SETTING_DOCUMENT_ROOTS));
  if (roots.some((root) => root.path === checked.path)) {
    return NextResponse.json({ message: "这个文件夹已经加过了。" }, { status: 400 });
  }
  const next = [...roots, { label: labelFor(checked.path, roots.map((root) => root.label)), path: checked.path }];
  store.setSetting(SETTING_DOCUMENT_ROOTS, serializeRoots(next));
  clearDocumentCache();
  return NextResponse.json({ ok: true, ...(await payload()) });
}

export async function DELETE(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const label = new URL(request.url).searchParams.get("label");
  if (!label) {
    return NextResponse.json({ message: "缺少 label。" }, { status: 400 });
  }
  const store = getStore();
  const roots = parseRoots(store.getSetting(SETTING_DOCUMENT_ROOTS));
  const next = roots.filter((root) => root.label !== label);
  if (next.length === roots.length) {
    return NextResponse.json({ message: `没有名为「${label}」的文档目录。` }, { status: 404 });
  }
  // Removing a root only forgets where to look. Nothing on disk is touched — this layer
  // has no writer at all (REQ-F-110 ⑤).
  store.setSetting(SETTING_DOCUMENT_ROOTS, next.length > 0 ? serializeRoots(next) : null);
  clearDocumentCache();
  return NextResponse.json({ ok: true, ...(await payload()) });
}
