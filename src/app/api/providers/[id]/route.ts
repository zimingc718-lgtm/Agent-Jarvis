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
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  // CR-20260909: the same endpoint carries the priority reorder (up/down).
  if (body && (body.direction === "up" || body.direction === "down")) {
    const moved = getStore().reorderProvider(auth.userId, id, body.direction);
    if (!moved) {
      return NextResponse.json({ message: "Provider not found or already at the edge." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, direction: body.direction });
  }

  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ message: "`enabled` (boolean) or `direction` ('up'|'down') is required." }, { status: 400 });
  }

  const updated = getStore().setProviderEnabled(auth.userId, id, body.enabled);
  if (!updated) {
    return NextResponse.json({ message: "Provider not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, enabled: body.enabled });
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
