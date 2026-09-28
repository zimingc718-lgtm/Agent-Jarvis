import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import type { ActionEffect } from "@/lib/store";
import { getStore } from "@/lib/store-singleton";
import { requestTranslator } from "@/lib/i18n-request";

/**
 * The user's own audit trail (REQ-F-320 ②, DEC-430 ①; CR-20260925-write-approval-action-log):
 * every tool call the model made, across conversations, newest first.
 *
 * `?effects=write,network` narrows to the kinds shown by default; omit it for everything,
 * including reads. `?before=<createdAt>` pages, `?limit=` caps (server clamps to 500).
 */

const EFFECTS: ReadonlySet<string> = new Set<ActionEffect>(["read", "write", "network"]);

export async function GET(request: Request) {
  const t = requestTranslator();
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const url = new URL(request.url);
  const rawEffects = (url.searchParams.get("effects") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const unknown = rawEffects.filter((value) => !EFFECTS.has(value));
  if (unknown.length > 0) {
    return NextResponse.json({ message: t("api.effectsInvalid", { values: unknown.join(", ") }) }, { status: 400 });
  }
  const rawLimit = Number(url.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
  const before = url.searchParams.get("before")?.trim() || undefined;

  const actions = getStore().listActions(auth.userId, {
    effects: rawEffects as ActionEffect[],
    limit,
    before,
  });
  return NextResponse.json({ actions });
}
