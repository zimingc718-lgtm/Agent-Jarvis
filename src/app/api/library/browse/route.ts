import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { listBrowseCards } from "@/lib/library";

/**
 * 统一浏览：资料库已采纳原件 + 知识库真实条目，分页（CR-20260915-knowledge-library-merge CP-2）。
 *
 * 与 `/api/library` 分开一条路由，不是同一条加个参数：那条路由的不分页是审批场景的既有
 * 设计（见其文件注释——「本目录全选」需要看到全貌），浏览场景反过来正需要分页，两条路由
 * 各自成立，谁也不用迁就谁。
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const params = new URL(request.url).searchParams;
  const offsetParam = Number.parseInt(params.get("offset") ?? "0", 10);
  const limitParam = Number.parseInt(params.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const offset = Number.isFinite(offsetParam) ? Math.max(0, offsetParam) : 0;
  const limit = Number.isFinite(limitParam) ? Math.min(MAX_LIMIT, Math.max(1, limitParam)) : DEFAULT_LIMIT;

  const { cards, byType } = await listBrowseCards();
  const page = cards.slice(offset, offset + limit);

  return NextResponse.json({ cards: page, total: cards.length, byType, offset, limit });
}
