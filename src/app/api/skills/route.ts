import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { makeCompleter, registerSkill, SKILLS_ROOT, type UploadedFile } from "@/lib/skills";
import { SkillNameConflictError } from "@/lib/store";
import { getStore } from "@/lib/store-singleton";

/** Files larger than this are almost certainly binary — skip them (they are stored, not injected). */
const MAX_UPLOAD_FILE_BYTES = 512 * 1024;

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

  const folderName = String(form.get("folderName") ?? "").trim();
  if (!folderName) {
    return NextResponse.json({ message: "A folder name is required." }, { status: 400 });
  }

  const files: UploadedFile[] = [];
  for (const entry of form.getAll("file")) {
    if (!(entry instanceof File)) {
      continue;
    }
    const relPath = (entry.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!relPath || relPath.split("/").some((segment) => segment === "" || segment === "..")) {
      continue;
    }
    if (entry.size > MAX_UPLOAD_FILE_BYTES) {
      continue;
    }
    const buffer = Buffer.from(await entry.arrayBuffer());
    if (buffer.includes(0)) {
      continue; // binary
    }
    files.push({ path: relPath, content: buffer.toString("utf8") });
  }

  if (files.length === 0) {
    return NextResponse.json({ message: "The dropped folder has no readable text files." }, { status: 400 });
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
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SkillNameConflictError) {
      return NextResponse.json(
        { message: `已存在同名技能「${error.skillName}」，请重命名文件夹后重试。` },
        { status: 409 }
      );
    }
    return NextResponse.json({ message: "技能注册失败。" }, { status: 500 });
  }
}
