import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { fetchSource } from "@/lib/sources";
import { resolveUserDataRoots } from "@/lib/user-data-paths";
import {
  addSource,
  deleteEntity,
  isParamState,
  isReservedParamName,
  normalizeParamName,
  removeParam,
  setParam,
  EntityError,
  markSeen,
  readEntity,
  removeSource,
  summarize,
  UPDATABLE_FIELDS,
  updateEntity,
  type UpdatableField,
} from "@/lib/entities";
import { messageFor } from "@/lib/coded-error";
import { requestTranslator } from "@/lib/i18n-request";

/** One entity: read it, act on it, delete it (CR-20260911-home-dashboard). */

type Params = { params: Promise<{ name: string }> };

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

export async function GET(_request: Request, { params }: Params) {
  const t = requestTranslator();
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const { entitiesRoot } = guarded;
  const name = decodeURIComponent((await params).name ?? "").trim();
  const entity = await readEntity(name, entitiesRoot);
  if (!entity) {
    return NextResponse.json({ message: t("api.entityNotFound", { name }) }, { status: 404 });
  }
  return NextResponse.json({ entity, summary: summarize(entity) });
}

/**
 * Four actions on one verb, because they are all "change this entity a little":
 * `seen` is what the card's message list fires on open (opening IS the read receipt,
 * user ruling 2026-09-11); `field` is a direct user edit; `addSource` / `removeSource`
 * are the source management that lives inside the card.
 */
export async function PATCH(request: Request, { params }: Params) {
  const t = requestTranslator();
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const { entitiesRoot } = guarded;
  const name = decodeURIComponent((await params).name ?? "").trim();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "seen") {
      const entity = await markSeen(name, entitiesRoot);
      return entity
        ? NextResponse.json({ ok: true, entity })
        : NextResponse.json({ message: t("api.entityNotFound", { name }) }, { status: 404 });
    }

    if (action === "addSource" || action === "removeSource") {
      const url = typeof body.url === "string" ? body.url : "";
      if (!url.trim()) {
        return NextResponse.json({ message: t("api.missingUrl") }, { status: 400 });
      }
      const entity = action === "addSource" ? await addSource(name, url, entitiesRoot) : await removeSource(name, url, entitiesRoot);
      return entity
        ? NextResponse.json({ ok: true, entity })
        : NextResponse.json({ message: t("api.entityNotFound", { name }) }, { status: 404 });
    }

    // The board's spine: named technical parameters (CR-20260912-technical-spine).
    // `status` is only ever set here, from a person's click — never by a tool.
    if (action === "setParam" || action === "paramStatus" || action === "removeParam") {
      const paramName = normalizeParamName(typeof body.param === "string" ? body.param : "");
      if (!paramName) {
        return NextResponse.json({ message: t("api.missingParamName") }, { status: 400 });
      }
      if (isReservedParamName(paramName)) {
        return NextResponse.json({ message: t("api.reservedParam", { name: paramName }) }, { status: 400 });
      }
      if (action === "removeParam") {
        const entity = await removeParam(name, paramName, entitiesRoot);
        return entity
          ? NextResponse.json({ ok: true, entity })
          : NextResponse.json({ message: t("api.entityNotFound", { name }) }, { status: 404 });
      }
      const status = isParamState(body.status) ? body.status : undefined;
      if (action === "paramStatus" && !status) {
        return NextResponse.json({ message: t("api.paramStatusInvalid") }, { status: 400 });
      }
      const current = await readEntity(name, entitiesRoot);
      if (!current) {
        return NextResponse.json({ message: t("api.entityNotFound", { name }) }, { status: 404 });
      }
      // A status-only change keeps the value it already had; `setParam` carries a value.
      const existing = current.params.find((param) => param.name === paramName);
      const value = action === "paramStatus" ? (existing?.value ?? "") : typeof body.value === "string" ? body.value : "";
      if (action === "paramStatus" && !existing) {
        return NextResponse.json({ message: t("api.paramNotFound", { name: paramName }) }, { status: 404 });
      }
      const url = typeof body.url === "string" ? body.url.trim() : "";
      const entity = await setParam(
        name,
        {
          name: paramName,
          value,
          status,
          evidence: url ? { url, at: "", locator: typeof body.locator === "string" ? body.locator : "" } : undefined,
        },
        entitiesRoot
      );
      return entity
        ? NextResponse.json({ ok: true, entity })
        : NextResponse.json({ message: t("api.entityNotFound", { name }) }, { status: 404 });
    }

    if (action === "fetch") {
      const url = typeof body.url === "string" ? body.url.trim() : "";
      if (!url) {
        return NextResponse.json({ message: t("api.missingUrl") }, { status: 400 });
      }
      const outcome = await fetchSource(name, url, { root: entitiesRoot });
      const entity = await readEntity(name, entitiesRoot);
      return NextResponse.json({ ok: true, outcome, entity: entity ? summarize(entity) : null });
    }

    if (action === "field") {
      const field = typeof body.field === "string" ? body.field : "";
      if (!(UPDATABLE_FIELDS as readonly string[]).includes(field)) {
        return NextResponse.json({ message: t("api.fieldNotUpdatable", { field }) }, { status: 400 });
      }
      const value = typeof body.value === "string" ? body.value : "";
      const url = typeof body.url === "string" ? body.url.trim() : "";
      const locator = typeof body.locator === "string" ? body.locator.trim() : "";
      const entity = await updateEntity(
        name,
        { field: field as UpdatableField, value, ...(url ? { evidence: { url, at: "", locator } } : {}) },
        entitiesRoot
      );
      return entity
        ? NextResponse.json({ ok: true, entity })
        : NextResponse.json({ message: t("api.entityNotFound", { name }) }, { status: 404 });
    }

    return NextResponse.json({ message: t("api.unknownAction") }, { status: 400 });
  } catch (error) {
    if (error instanceof EntityError) {
      return NextResponse.json({ message: messageFor(t, error) }, { status: error.status });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const t = requestTranslator();
  const guarded = await guard();
  if (!guarded.ok) {
    return guarded.response;
  }
  const { entitiesRoot } = guarded;
  const name = decodeURIComponent((await params).name ?? "").trim();
  if (!name) {
    return NextResponse.json({ message: t("api.missingEntityName") }, { status: 400 });
  }
  const removed = await deleteEntity(name, entitiesRoot);
  if (!removed) {
    return NextResponse.json({ message: t("api.entityNotFound", { name }) }, { status: 404 });
  }
  return NextResponse.json({ ok: true, name });
}
