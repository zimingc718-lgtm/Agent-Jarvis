import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { requireUserId } from "@/lib/auth-guard";
import { countByStatus, decideLibrary, LibraryError, listLibrary, type AdoptionStatus } from "@/lib/library";

/**
 * 逐文件裁定（REQ-F-220，CR-20260915-library-adoption CP-3）。
 *
 * 一次调用可以带多个 id——界面上的「本目录全选」就是这么落下来的——但登记里留下的仍是
 * **逐条**的判断：谁在什么时候被采纳，可以一条条回溯。这是用户 2026-09-15 裁定的粒度。
 */
export async function POST(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "请求体不是合法的 JSON。" }, { status: 400 });
  }

  const body = (payload ?? {}) as { ids?: unknown; status?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
  const status = body.status;
  if (status !== "adopted" && status !== "rejected" && status !== "pending") {
    return NextResponse.json({ message: "status 只能是 adopted / rejected / pending。" }, { status: 400 });
  }

  try {
    const result = await decideLibrary(ids, status as AdoptionStatus);
    const counts = countByStatus(await listLibrary());
    return NextResponse.json({
      changed: result.changed.map((item) => item.id),
      unchanged: result.unchanged,
      counts,
    });
  } catch (error) {
    if (error instanceof LibraryError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
