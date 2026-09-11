import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { probeToolSupport, testProviderConnection } from "@/lib/adapters";
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
    /** Present when the caller wants the tool-capability probe too (REQ-F-040 ②). */
    defaultModel?: unknown;
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

  // REQ-F-040 ②: while we have a working connection, find out whether this
  // (provider, model) actually calls tools. `/models` cannot answer that, and plenty of
  // local servers accept a `tools` array with a 200 and ignore it — so the probe is a
  // real completion. Only runs for a saved provider, and never fails the test action.
  let toolSupport: "yes" | "no" | null = null;
  const providerId = typeof body.id === "string" && body.id.trim() ? body.id.trim() : null;
  const model = typeof body.defaultModel === "string" && body.defaultModel.trim() ? body.defaultModel.trim() : null;
  if (result.ok && providerId && model) {
    try {
      toolSupport = await probeToolSupport({ baseUrl, secret }, model);
      getStore().setProviderToolSupport(auth.userId, providerId, model, toolSupport);
    } catch {
      toolSupport = null;
    }
  }

  return NextResponse.json({ ...result, toolSupport });
}
