import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { isSkillTextPath, makeCompleter, registerSkill, SKILLS_ROOT, type UploadedFile } from "@/lib/skills";
import { SkillNameConflictError } from "@/lib/store";
import { getStore } from "@/lib/store-singleton";
import { deriveFolderName, readZipEntries, ZipError } from "@/lib/zip";

/** Files larger than this are almost certainly binary — skip them (they are stored, not injected). */
const MAX_UPLOAD_FILE_BYTES = 512 * 1024;

/**
 * Why a file did not make it into the skill (REQ-F-020 ⑤). Two different things:
 * `binary` / `too-large` / `unsupported-zip-method` were never written to disk;
 * `not-injected` WAS stored verbatim but its extension is outside the allowlist,
 * so it does not enter the per-turn context.
 */
type ExcludedReason = "binary" | "too-large" | "not-injected" | "unsupported-zip-method";
type Excluded = { path: string; reason: ExcludedReason };

export async function GET() {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }
  const skills = getStore()
    .listSkills(auth.userId)
    .map((skill) => ({ id: skill.id, name: skill.name, description: skill.description }));
  return NextResponse.json({ skills });
}

export async function POST(request: Request) {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }
  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ message: "Expected a multipart form upload." }, { status: 400 });
  }

  const excluded: Excluded[] = [];
  let folderName: string;
  let files: UploadedFile[];

  const archive = form.get("archive");
  if (archive instanceof File) {
    // CR-20260910-skill-intake: unzip server-side only (DEC-018 ⑦) — the archive
    // is untrusted, and the path guard already lives here.
    let unpacked;
    try {
      unpacked = readZipEntries(Buffer.from(await archive.arrayBuffer()));
    } catch (error) {
      if (error instanceof ZipError) {
        // Nothing has been written at this point — a rejected archive leaves no trace.
        return NextResponse.json({ message: error.message }, { status: 400 });
      }
      return NextResponse.json({ message: "压缩包解析失败。" }, { status: 400 });
    }
    excluded.push(...unpacked.skipped);
    const derived = deriveFolderName(unpacked.entries, archive.name);
    folderName = derived.folderName;
    files = [];
    for (const entry of derived.entries) {
      if (entry.content.includes(0)) {
        excluded.push({ path: entry.path, reason: "binary" });
        continue;
      }
      if (entry.content.length > MAX_UPLOAD_FILE_BYTES) {
        excluded.push({ path: entry.path, reason: "too-large" });
        continue;
      }
      files.push({ path: entry.path, content: entry.content.toString("utf8") });
    }
  } else {
    folderName = String(form.get("folderName") ?? "").trim();
    if (!folderName) {
      return NextResponse.json({ message: "A folder name is required." }, { status: 400 });
    }
    files = [];
    for (const entry of form.getAll("file")) {
      if (!(entry instanceof File)) {
        continue;
      }
      const relPath = (entry.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
      if (!relPath || relPath.split("/").some((segment) => segment === "" || segment === "..")) {
        continue;
      }
      if (entry.size > MAX_UPLOAD_FILE_BYTES) {
        excluded.push({ path: relPath, reason: "too-large" });
        continue;
      }
      const buffer = Buffer.from(await entry.arrayBuffer());
      if (buffer.includes(0)) {
        excluded.push({ path: relPath, reason: "binary" });
        continue;
      }
      files.push({ path: relPath, content: buffer.toString("utf8") });
    }
  }

  if (files.length === 0) {
    return NextResponse.json(
      { message: "没有可读取的文本文件，未注册。", excluded },
      { status: 400 }
    );
  }

  // Stored verbatim, but outside the allowlist — it will not enter the per-turn context.
  for (const file of files) {
    if (!isSkillTextPath(file.path)) {
      excluded.push({ path: file.path, reason: "not-injected" });
    }
  }

  let completer = null;
  try {
    const provider = getStore().resolveActiveProvider(auth.userId);
    completer = provider ? makeCompleter(provider) : null;
  } catch {
    completer = null;
  }

  try {
    const result = await registerSkill({
      store: getStore(),
      userId: auth.userId,
      folderName,
      files,
      skillsRoot: SKILLS_ROOT,
      complete: completer,
    });
    return NextResponse.json({ ...result, excluded }, { status: 201 });
  } catch (error) {
    if (error instanceof SkillNameConflictError) {
      return NextResponse.json(
        { message: `已存在同名技能「${error.skillName}」，请重命名后重试。` },
        { status: 409 }
      );
    }
    return NextResponse.json({ message: "技能注册失败。" }, { status: 500 });
  }
}
