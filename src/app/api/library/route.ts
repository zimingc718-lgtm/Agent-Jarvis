import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireUserId } from "@/lib/auth-guard";
import { countByStatus, listLibrary, type AdoptionStatus } from "@/lib/library";

/**
 * 资料库的待采纳清单（REQ-F-220，CR-20260915-library-adoption CP-3）。
 *
 * 不做分页：一个合集 258 条，整份发过去约 50 KB，而「审批」这件事天然要一眼看到全貌——
 * 分页会让「本目录全选」变成「本页全选」，那是两件事。真到了几千条再说，`listLibrary`
 * 自带 5000 条的遍历上限。
 */
export async function GET(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const wanted = new URL(request.url).searchParams.get("status");
  const items = await listLibrary();
  const counts = countByStatus(items);
  const filtered =
    wanted === "pending" || wanted === "adopted" || wanted === "rejected"
      ? items.filter((item) => item.status === (wanted as AdoptionStatus))
      : items;

  return NextResponse.json({ items: filtered, counts });
}
