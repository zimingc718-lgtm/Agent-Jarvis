import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof (body as Record<string, unknown>).enabled !== "boolean") {
    return NextResponse.json({ message: "`enabled` (boolean) is required." }, { status: 400 });
  }

  const updated = getStore().setProviderEnabled(auth.userId, id, (body as { enabled: boolean }).enabled);
  if (!updated) {
    return NextResponse.json({ message: "Provider not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, enabled: (body as { enabled: boolean }).enabled });
}

export async function DELETE(_request: Request, context: Context) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const { id } = await context.params;
  const deleted = getStore().deleteProvider(auth.userId, id);
  if (!deleted) {
    return NextResponse.json({ message: "Provider not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
