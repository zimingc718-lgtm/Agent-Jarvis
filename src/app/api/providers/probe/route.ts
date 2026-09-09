import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { testProviderConnection } from "@/lib/adapters";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { ProviderSecretError } from "@/lib/store";
import { getStore } from "@/lib/store-singleton";

/**
 * REQ-F-018 / DEC-012: a live connectivity probe of every enabled provider, called once
 * on floating-console mount. The console light shows「检测中」until this returns; the
 * home page never blocks on it.
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
  const enabled = store.listProviders(auth.userId).filter((provider) => provider.enabled);

  const results = await Promise.all(
    enabled.map(async (provider) => {
      let secret: string | null = null;
      try {
        secret = store.revealProviderSecret(auth.userId, provider.id);
      } catch (error) {
        if (error instanceof ProviderSecretError) {
          return { id: provider.id, ok: false };
        }
        throw error;
      }
      const result = await testProviderConnection({ baseUrl: provider.baseUrl ?? "", secret });
      return { id: provider.id, ok: result.ok };
    })
  );

  return NextResponse.json({
    anyConnected: results.some((result) => result.ok),
    providers: results,
  });
}
