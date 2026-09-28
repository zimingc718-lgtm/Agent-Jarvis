import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { adoptSkillProposal, discardSkillProposal } from "@/lib/skill-proposals";
import { getStore } from "@/lib/store-singleton";
import { requestTranslator } from "@/lib/i18n-request";

/**
 * The approval click for a model-proposed skill (REQ-F-320 ①, DEC-430 ②;
 * CR-20260925-write-approval-action-log). `POST` adopts — running the same `registerSkill()`
 * the upload intake uses — and `DELETE` discards. Nothing the model does can reach this
 * route; it only forwards the user's decision, exactly like `/api/entities/proposals/[id]`.
 */

type Params = { params: Promise<{ id: string }> };

type Guarded = { ok: true; userId: string } | { ok: false; response: NextResponse };

async function guard(): Promise<Guarded> {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ message: auth.message }, { status: auth.status }) };
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return { ok: false, response: unavailable };
  }
  return { ok: true, userId: auth.userId };
}

export async function POST(_request: Request, { params }: Params) {
  const t = requestTranslator();
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const id = decodeURIComponent((await params).id ?? "").trim();
  const decision = await adoptSkillProposal(getStore(), guarded.userId, id);
  if (!decision.ok) {
    return NextResponse.json({ message: t(decision.code, decision.params) }, { status: decision.status });
  }
  return NextResponse.json({
    ok: true,
    skill: { id: decision.skill.id, name: decision.skill.name, description: decision.skill.description },
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const t = requestTranslator();
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const id = decodeURIComponent((await params).id ?? "").trim();
  const discarded = discardSkillProposal(getStore(), guarded.userId, id);
  if (!discarded) {
    return NextResponse.json({ message: t("api.skillProposalNotFound", { id }) }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}
