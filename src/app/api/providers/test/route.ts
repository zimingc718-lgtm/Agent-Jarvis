import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { testProviderConnection } from "@/lib/adapters";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { ProviderSecretError } from "@/lib/store";
import { getStore } from "@/lib/store-singleton";

export async function POST(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    baseUrl?: unknown;
    secret?: unknown;
  };

  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  if (!baseUrl) {
    return NextResponse.json({ ok: false, message: "Base URL is required to test a provider." }, { status: 400 });
  }

  // Prefer the freshly typed secret; fall back to the stored one when editing an existing provider.
  let secret = typeof body.secret === "string" && body.secret.trim() ? body.secret.trim() : null;
  if (!secret && typeof body.id === "string" && body.id.trim()) {
    try {
      secret = getStore().revealProviderSecret(auth.userId, body.id.trim());
    } catch (error) {
      if (error instanceof ProviderSecretError) {
        return NextResponse.json(
          { ok: false, message: "已存凭据无法解密，请重新输入 API Key 后再测试。" },
          { status: 200 }
        );
      }
      throw error;
    }
  }

  const result = await testProviderConnection({ baseUrl, secret });
  return NextResponse.json(result);
}
