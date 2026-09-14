import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import { DocumentPathError, SETTING_DOCUMENT_ROOTS } from "@/lib/documents";
import { archiveInsight, SETTING_ARCHIVE_DIR, type ArchiveFormat } from "@/lib/insight-export";

/**
 * 人的一侧的归档入口（REQ-F-190 ⑦）。
 *
 * 与模型的 `archive_insight` 工具走同一个 `archiveInsight`：两条路径、一份实现。写两份的
 * 结果一定是其中一份先漏掉某条边界——而这一层的边界是「写用户磁盘」。
 */
export async function POST(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const body = (await request.json().catch(() => ({}))) as { insightId?: unknown; format?: unknown };
  const insightId = typeof body.insightId === "string" ? body.insightId.trim() : "";
  if (!insightId) {
    return NextResponse.json({ message: "缺少 insightId。" }, { status: 400 });
  }
  const format: ArchiveFormat = body.format === "html" ? "html" : "md";

  const store = getStore();
  const record = store.getInsight(insightId);
  // `insights` 没有 user_id，所有权来自它挂的会话——与 show_insight 同一条判定。
  const owner = record ? store.getConversationForUser(auth.userId, record.conversationId) : null;
  if (!record || !owner) {
    return NextResponse.json({ message: "找不到这份报告，或它不属于当前用户。" }, { status: 404 });
  }

  try {
    const result = await archiveInsight({
      insightId: record.id,
      conversationId: record.conversationId,
      html: record.html,
      createdAt: record.createdAt,
      format,
      archiveSetting: store.getSetting(SETTING_ARCHIVE_DIR),
      rootsSetting: store.getSetting(SETTING_DOCUMENT_ROOTS),
    });
    return NextResponse.json({ ok: true, id: result.id, path: result.absPath, bytes: result.bytes, format: result.format });
  } catch (error) {
    // 400 而不是 500：归档失败几乎总是「目录还没配好」，那是调用方能修的事。
    const message = error instanceof DocumentPathError ? error.message : "归档失败。";
    return NextResponse.json({ message }, { status: 400 });
  }
}
