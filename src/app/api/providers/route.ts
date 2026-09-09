import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getDefaultProviderTemplates } from "@/lib/providers";
import { getStore } from "@/lib/store-singleton";
import type { ProviderAuthMode, ProviderKind } from "@/lib/types";

const providerKinds: ProviderKind[] = ["openai", "deepseek", "local"];
// "oauth" is a recognised auth mode (REQ-F-008) but no OAuth flow ships in this version,
// so it cannot be saved as a working provider yet.
const saveableAuthModes: ProviderAuthMode[] = ["api_key", "local"];

export async function GET() {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  return NextResponse.json({
    providers: getStore().listProviders(auth.userId),
    templates: getDefaultProviderTemplates(),
  });
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

  const body = await request.json().catch(() => null);
  const parsed = parseProviderBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ message: parsed.message }, { status: 400 });
  }

  const result = getStore().saveProvider(auth.userId, parsed.value);
  return NextResponse.json({ id: result.id, created: result.created }, { status: result.created ? 201 : 200 });
}

function parseProviderBody(body: unknown):
  | {
      ok: true;
      value: {
        id?: string;
        name: string;
        kind: ProviderKind;
        authMode: ProviderAuthMode;
        baseUrl: string;
        defaultModel: string;
        enabled: boolean;
        secret: string | null;
      };
    }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Provider payload is required." };
  }

  const candidate = body as Record<string, unknown>;
  const id = stringValue(candidate.id) || undefined;
  const kind = candidate.kind;
  const authMode = candidate.authMode;
  const name = stringValue(candidate.name);
  const baseUrl = stringValue(candidate.baseUrl);
  const defaultModel = stringValue(candidate.defaultModel);
  const secret = stringValue(candidate.secret);

  if (!providerKinds.includes(kind as ProviderKind)) {
    return { ok: false, message: "Provider kind is invalid." };
  }
  if (authMode === "oauth" || authMode === "unsupported") {
    return { ok: false, message: "OAuth 与 Unsupported 认证模式在当前版本不可保存，请使用 API Key 或 Local。" };
  }
  if (!saveableAuthModes.includes(authMode as ProviderAuthMode)) {
    return { ok: false, message: "Provider auth mode is invalid." };
  }
  if (!name || !baseUrl || !defaultModel) {
    return { ok: false, message: "Provider name, base URL, and default model are required." };
  }
  // A new API-key provider needs a secret; an update may leave it blank to keep the stored one.
  if (authMode === "api_key" && !secret && !id) {
    return { ok: false, message: "API key is required for this provider." };
  }

  return {
    ok: true,
    value: {
      id,
      name,
      kind: kind as ProviderKind,
      authMode: authMode as ProviderAuthMode,
      baseUrl,
      defaultModel,
      enabled: Boolean(candidate.enabled),
      secret: secret || null,
    },
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
