import { extname } from "node:path";
import { readFile } from "node:fs/promises";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import { DocumentPathError, READABLE_EXTENSIONS, resolveWithinRoots } from "@/lib/documents";
import { LIBRARY_LABEL, statusOf } from "@/lib/library";
import { rootsOf } from "@/lib/tools/document-tools";

/**
 * 原样字节（CR-20260915-document-display CP-1）。
 *
 * `show_document` 只改 `display_state`；真正把字节交给浏览器的是这一条路由——展示屏的
 * `<iframe>` 直接指向它，不经过 React state，大文件（资料库里最大 17 MB）因此不会被塞进
 * SSR 的 JSON 里。校验与 `read_document` 同一条路径：`resolveWithinRoots` 判存在性/越界/
 * 目录-vs-文件，资料库来源额外过一遍 `statusOf` 采纳闸——未采纳的文件通过工具调不出来，
 * 也不该能靠猜一个 id 直接从这条路由绕过去。
 */

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".markdown": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function GET(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ message: "缺少 id。" }, { status: 400 });
  }

  try {
    const roots = rootsOf(getStore());
    const { absPath, relPath, root } = await resolveWithinRoots(id, roots);
    const ext = extname(absPath).toLowerCase();
    if (!READABLE_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ message: "不支持的文件类型。" }, { status: 400 });
    }
    if (root.label === LIBRARY_LABEL && (await statusOf(relPath)) !== "adopted") {
      return NextResponse.json({ message: `「${relPath}」还没有被采纳，按约定审批通过后才能查看。` }, { status: 403 });
    }
    const bytes = await readFile(absPath);
    const filename = relPath.split("/").pop() ?? "document";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": MIME_BY_EXT[ext] ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
        // 这是用户自己机器上的私有文件，不该被任何中间层缓存。
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof DocumentPathError) {
      return NextResponse.json({ message: error.message }, { status: 404 });
    }
    return NextResponse.json({ message: "读取文档失败。" }, { status: 500 });
  }
}
