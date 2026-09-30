import { rename, rm, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { SKILLS_ROOT, slugifySkillName } from "@/lib/skills";
import { SkillNameConflictError } from "@/lib/store";
import { getStore } from "@/lib/store-singleton";
import { requestTranslator } from "@/lib/i18n-request";
import { logRouteFailure } from "@/lib/log";

/**
 * Skill management (REQ-F-031, TASK-073).
 *
 * The ☰ list used to be read-only, which is exactly the gap the user reported: a skill
 * could be uploaded but never removed or corrected. Deleting and renaming now exist;
 * editing the body, versioning and a marketplace remain non-goals.
 */

/** Second line of defence, mirroring `registerSkill`: nothing may escape SKILLS_ROOT. */
function assertInsideSkillsRoot(dirPath: string): void {
  const root = resolve(SKILLS_ROOT);
  const target = resolve(dirPath);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error("skill directory escapes its root");
  }
}

type Params = { params: Promise<{ name: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  const t = requestTranslator();
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const name = decodeURIComponent((await params).name ?? "").trim();
  if (!name) {
    return NextResponse.json({ message: t("api.missingSkillName") }, { status: 400 });
  }

  // Row first, folder second (CP-3). A leftover folder is inert; a row whose folder is
  // gone breaks `read_skill` in a way the user can neither see nor fix.
  const removed = getStore().deleteSkillForUser(auth.userId, name);
  if (!removed) {
    return NextResponse.json({ message: t("api.skillNotFound", { name }) }, { status: 404 });
  }

  let orphanedDir: string | null = null;
  try {
    assertInsideSkillsRoot(removed.dirPath);
    await rm(removed.dirPath, { recursive: true, force: true });
  } catch {
    orphanedDir = removed.dirPath;
  }

  return NextResponse.json({
    ok: true,
    name: removed.name,
    // Surfaced rather than swallowed — the user should know a folder is still on disk.
    ...(orphanedDir ? { warning: t("api.skillDirOrphaned", { dir: orphanedDir }) } : {}),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const t = requestTranslator();
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const from = decodeURIComponent((await params).name ?? "").trim();
  const body = await request.json().catch(() => ({}));
  const to = typeof body.name === "string" ? body.name.trim() : "";
  if (!from || !to) {
    return NextResponse.json({ message: t("api.missingSkillName") }, { status: 400 });
  }
  const slug = slugifySkillName(to);
  if (!slug) {
    return NextResponse.json({ message: t("api.newNameInvalid") }, { status: 400 });
  }

  const store = getStore();
  let record;
  try {
    record = store.renameSkillForUser(auth.userId, from, to);
  } catch (error) {
    if (error instanceof SkillNameConflictError) {
      return NextResponse.json({ message: t("api.skillNameExists", { name: to }) }, { status: 409 });
    }
    throw error;
  }
  if (!record) {
    return NextResponse.json({ message: t("api.skillNotFound", { name: from }) }, { status: 404 });
  }

  const nextDir = join(SKILLS_ROOT, slug);
  try {
    assertInsideSkillsRoot(record.dirPath);
    assertInsideSkillsRoot(nextDir);
  } catch {
    return NextResponse.json({ message: t("api.skillDirEscape") }, { status: 400 });
  }

  if (nextDir !== record.dirPath) {
    try {
      await rename(record.dirPath, nextDir);
    } catch (error) {
      const requestId = logRouteFailure("/api/skills/[name]", error);
      return NextResponse.json({ message: t("api.skillRenameFailed"), requestId }, { status: 500 });
    }
  }

  // Keep the three places that carry the name in step: folder slug, DB row and the
  // `name:` line of SKILL.md (CP-42).
  const skillMdPath = join(nextDir, "SKILL.md");
  try {
    const raw = await readFile(skillMdPath, "utf8");
    await writeFile(skillMdPath, raw.replace(/^name:.*$/m, `name: ${to}`), "utf8");
  } catch {
    /* SKILL.md missing or unreadable — the row and folder are still consistent */
  }

  store.updateSkillNameAndPath(record.id, to, nextDir);
  return NextResponse.json({ ok: true, name: to, dirPath: nextDir });
}
