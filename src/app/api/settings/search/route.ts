import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import {
  browserFallbackEnabled,
  readWebSettings,
  SETTING_BROWSER_FALLBACK,
  SETTING_SEARCH_BASE_URL,
  SETTING_WEB_ENABLED,
  validateSearchBaseUrl,
} from "@/lib/tools/web-tools";

/**
 * Search backend configuration (REQ-F-038, TASK-074).
 *
 * Its own ☰ entry rather than a section of the 「模型」 dialog: that dialog is the
 * provider priority surface (REQ-F-006) and REQ-NF-006 ② says nothing else goes in it.
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
  const store = getStore();
  const settings = readWebSettings(store);
  return NextResponse.json({
    enabled: settings.enabled,
    baseUrl: settings.baseUrl ?? "",
    browserFallback: browserFallbackEnabled(store),
  });
}

export async function PUT(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const body = await request.json().catch(() => ({}));
  const store = getStore();

  if (typeof body.enabled === "boolean") {
    store.setSetting(SETTING_WEB_ENABLED, String(body.enabled));
  }

  // REQ-F-057 ④: the browser channel is a switch of its own — it costs seconds and RAM
  // per blocked page, and it only helps on some of them.
  if (typeof body.browserFallback === "boolean") {
    store.setSetting(SETTING_BROWSER_FALLBACK, String(body.browserFallback));
  }

  if (typeof body.baseUrl === "string") {
    const raw = body.baseUrl.trim();
    if (!raw) {
      store.setSetting(SETTING_SEARCH_BASE_URL, null);
    } else {
      // Rejected before storage, not at use time: a URL carrying credentials would
      // otherwise sit in the database waiting to be sent somewhere (REQ-F-038 ③).
      const checked = validateSearchBaseUrl(raw);
      if (!checked.ok) {
        return NextResponse.json({ message: checked.message }, { status: 400 });
      }
      store.setSetting(SETTING_SEARCH_BASE_URL, checked.url);
    }
  }

  const settings = readWebSettings(store);
  return NextResponse.json({
    ok: true,
    enabled: settings.enabled,
    baseUrl: settings.baseUrl ?? "",
    browserFallback: browserFallbackEnabled(store),
  });
}
