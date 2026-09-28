import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { resolveUserDataRoots } from "@/lib/user-data-paths";
import { adoptProposal, discardProposal } from "@/lib/entity-proposals";
import { requestTranslator } from "@/lib/i18n-request";

/**
 * The approval step for model-proposed FIELD changes (CR-20260911-home-dashboard).
 * A change whose source was already registered on the entity never reaches here; it was
 * applied at the tool boundary. Everything else waits for a click.
 */

type Params = { params: Promise<{ id: string }> };

type Guarded = { ok: true; entitiesRoot: string } | { ok: false; response: NextResponse };

async function guard(): Promise<Guarded> {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ message: auth.message }, { status: auth.status }) };
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return { ok: false, response: unavailable };
  }
  const { entitiesRoot } = await resolveUserDataRoots(auth.userId);
  return { ok: true, entitiesRoot };
}

export async function POST(_request: Request, { params }: Params) {
  const t = requestTranslator();
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const { entitiesRoot } = guarded;
  const id = decodeURIComponent((await params).id ?? "").trim();
  const entity = await adoptProposal(id, entitiesRoot);
  if (!entity) {
    return NextResponse.json({ message: t("api.proposalNotFoundOrOrphan", { id }) }, { status: 404 });
  }
  return NextResponse.json({ ok: true, entity });
}

export async function DELETE(_request: Request, { params }: Params) {
  const t = requestTranslator();
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const { entitiesRoot } = guarded;
  const id = decodeURIComponent((await params).id ?? "").trim();
  const removed = await discardProposal(id, entitiesRoot);
  if (!removed) {
    return NextResponse.json({ message: t("api.proposalNotFound", { id }) }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}
