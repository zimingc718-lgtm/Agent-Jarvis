import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import { probeSearchBackend, readWebSettings, validateSearchBaseUrl } from "@/lib/tools/web-tools";

/**
 * "Test connection" for the search backend (REQ-F-038 ②).
 * Shares `probeSearchBackend` with `web_search`'s failure classifier so the two can
 * never disagree about what counts as a working endpoint (REQ-NF-011 ③).
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

  const body = await request.json().catch(() => ({}));
  const raw = typeof body.baseUrl === "string" && body.baseUrl.trim()
    ? body.baseUrl.trim()
    : (readWebSettings(getStore()).baseUrl ?? "");
  if (!raw) {
    return NextResponse.json({ ok: false, message: "尚未填写搜索服务地址。" });
  }

  const checked = validateSearchBaseUrl(raw);
  if (!checked.ok) {
    return NextResponse.json({ ok: false, message: checked.message });
  }

  return NextResponse.json(await probeSearchBackend(checked.url));
}
