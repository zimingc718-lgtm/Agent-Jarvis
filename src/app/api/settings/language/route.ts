import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { LanguageSettingError, readLanguage, writeLanguage } from "@/lib/language";
import { getStore } from "@/lib/store-singleton";

/**
 * The reply-language setting (REQ-F-330 ②; CR-20260927-reply-language). Read by the ☰
 * 「语言」 switch; `PUT { language: "zh" | "en" }` persists it for every later turn.
 */

async function guard() {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  return storageUnavailable();
}

export async function GET() {
  const blocked = await guard();
  if (blocked) {
    return blocked;
  }
  return NextResponse.json({ language: readLanguage(getStore()) });
}

export async function PUT(request: Request) {
  const blocked = await guard();
  if (blocked) {
    return blocked;
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const language = writeLanguage(getStore(), body.language);
    return NextResponse.json({ ok: true, language });
  } catch (error) {
    if (error instanceof LanguageSettingError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }
}
