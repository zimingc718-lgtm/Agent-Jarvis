import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import {
  DocumentPathError,
  labelFor,
  listDocuments,
  parseRoots,
  serializeRoots,
  SETTING_DOCUMENT_ROOTS,
  validateRoot,
  clearDocumentCache,
} from "@/lib/documents";
import { resolveArchiveDir, SETTING_ARCHIVE_DIR } from "@/lib/insight-export";
import { resolveFormatterSkill, SETTING_FORMAT_SKILL } from "@/lib/document-format";

/**
 * Local document folders (REQ-F-110 ①, TASK-170 ④).
 *
 * Its own ☰ entry, next to 「搜索」, for the same reason that one is separate: the 「模型」
 * dialog is the provider priority surface and nothing else belongs in it (REQ-NF-006 ②).
 *
 * The folder is validated here, before it is stored — a root that does not resolve to a
 * real directory would otherwise sit in the database and fail at every read.
 */

async function payload(userId: string) {
  const store = getStore();
  const roots = parseRoots(store.getSetting(SETTING_DOCUMENT_ROOTS));
  const documents = roots.length > 0 ? await listDocuments(roots) : [];
  // 排版技能（REQ-F-290，CR-20260921-format-skill）：存的是技能 id；被删掉的技能回显为 stale，
  // 让设置面板能说出「这个技能已经不存在」，而不是无声地退回纯结构转换。
  const formatter = resolveFormatterSkill(store, userId);
  return {
    roots,
    counts: { documents: documents.length },
    // 归档目录（REQ-F-190 ③）。与文档目录同屏，因为它必须落在其中之一之内。
    archive: store.getSetting(SETTING_ARCHIVE_DIR) ?? "",
    // 回显的是存下来的 id（stale 时也回显，面板要靠它把「已删除的技能」这一项画出来）；名字只在技能仍存在时有。
    formatSkill: store.getSetting(SETTING_FORMAT_SKILL)?.trim() ?? "",
    formatSkillName: formatter.skill?.name ?? "",
    formatSkillStale: formatter.stale,
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
  return NextResponse.json(await payload(auth.userId));
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
  return NextResponse.json({ ok: true, ...(await payload(auth.userId)) });
}

/**
 * 设置归档目录（REQ-F-190 ③）。
 *
 * 校验在写入之前：一个不在任何文档目录之内的路径若被存下来，会在每次归档时失败，而错误
 * 出现的地方离设置它的地方很远。空串表示清除。
 */
export async function PATCH(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const body = (await request.json().catch(() => ({}))) as { archive?: unknown; formatSkill?: unknown };
  const hasArchive = typeof body.archive === "string";
  const hasFormatSkill = typeof body.formatSkill === "string";
  if (!hasArchive && !hasFormatSkill) {
    return NextResponse.json({ message: "缺少 archive 或 formatSkill。" }, { status: 400 });
  }
  const store = getStore();

  // 排版技能（REQ-F-290 ②）：只接受当前用户自己已注册的技能 id；空串清除。校验在写入之前，
  // 否则一个指向别人/不存在技能的 id 会在每次打开文档时才暴露，离设置它的地方很远。
  if (hasFormatSkill) {
    const wantedSkill = (body.formatSkill as string).trim();
    if (!wantedSkill) {
      store.setSetting(SETTING_FORMAT_SKILL, null);
    } else if (!store.listSkills(auth.userId).some((skill) => skill.id === wantedSkill)) {
      return NextResponse.json({ message: "没有这个技能，请先在「技能」里上传并注册。" }, { status: 400 });
    } else {
      store.setSetting(SETTING_FORMAT_SKILL, wantedSkill);
    }
  }

  if (hasArchive) {
    const wanted = (body.archive as string).trim();
    if (!wanted) {
      store.setSetting(SETTING_ARCHIVE_DIR, null);
    } else {
      try {
        const target = await resolveArchiveDir(wanted, store.getSetting(SETTING_DOCUMENT_ROOTS));
        store.setSetting(SETTING_ARCHIVE_DIR, target.dir);
      } catch (error) {
        const message = error instanceof DocumentPathError ? error.message : "归档目录无法使用。";
        return NextResponse.json({ message }, { status: 400 });
      }
    }
  }
  return NextResponse.json({ ok: true, ...(await payload(auth.userId)) });
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
  return NextResponse.json({ ok: true, ...(await payload(auth.userId)) });
}
