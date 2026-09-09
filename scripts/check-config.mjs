#!/usr/bin/env node
/**
 * Local configuration preflight.
 *
 * Loads .env.local exactly the way Next.js does and reports which required
 * variables are missing, so a misconfigured environment is diagnosed before the
 * app is started rather than surfacing as a blocked sign-in button or a 500.
 *
 *   node scripts/check-config.mjs          human report, exits 1 if incomplete
 *   node scripts/check-config.mjs --json   machine-readable
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();

const REQUIRED = [
  {
    name: "NEXTAUTH_URL",
    why: "Agent-Jarvis 登录回调地址；必须与实际运行端口一致，并与 Google 控制台的 redirect URI 匹配。",
  },
  { name: "NEXTAUTH_SECRET", why: "NextAuth 会话签名密钥。", secret: true },
  { name: "GOOGLE_CLIENT_ID", why: "Google OAuth client ID（Google Cloud > Credentials > Web application）。" },
  { name: "GOOGLE_CLIENT_SECRET", why: "Google OAuth client secret。", secret: true },
  {
    name: "JARVIS_SECRET_KEY",
    why: "加密保存 Provider 凭据；缺失时登录成功后仍无法打开本地存储。",
    secret: true,
  },
];

const OPTIONAL = [
  { name: "JARVIS_DB_PATH", why: "SQLite 存储路径，默认 .data/agent-jarvis.sqlite。" },
];

/** Same rule the app uses: empty/whitespace and `missing-` placeholders do not count. */
function isRealValue(value) {
  if (!value || !String(value).trim()) return false;
  return !String(value).startsWith("missing-");
}

function mask(value) {
  const s = String(value);
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

async function loadEnv() {
  const envFile = join(ROOT, ".env.local");
  const present = existsSync(envFile);
  let loaderError = null;
  try {
    // @next/env is CommonJS, so under ESM the named export lives on `default`.
    const mod = await import("@next/env");
    const loadEnvConfig = mod.loadEnvConfig ?? mod.default?.loadEnvConfig;
    if (typeof loadEnvConfig !== "function") {
      throw new TypeError("@next/env did not expose loadEnvConfig");
    }
    // Two @next/env behaviours would otherwise make this diagnostic lie:
    //   - it short-circuits when its own cache marker is already set;
    //   - it deliberately skips .env.local when NODE_ENV === "test".
    // Inspecting .env.local is this script's entire job, so neutralise both.
    delete process.env.__NEXT_PROCESSED_ENV;
    process.env.NODE_ENV = "development";
    loadEnvConfig(ROOT, true, { info: () => {}, error: () => {} }, true);
  } catch (error) {
    // Never fail silently here: without the loader this check would report
    // every variable as missing and send the reader chasing a phantom problem.
    loaderError = error instanceof Error ? error.message : String(error);
  }
  return { envFile, present, loaderError };
}

const { envFile, present, loaderError } = await loadEnv();

/**
 * dotenv never overrides a variable that is already present in the process
 * environment — and an exported-but-empty shell variable counts as present. So
 * a correct .env.local can be silently ignored; read the file separately to
 * tell "you did not set it" apart from "your shell is shadowing it".
 */
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || line.trim().startsWith("#")) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

const fileValues = parseEnvFile(envFile);

const results = [...REQUIRED.map((v) => ({ ...v, required: true })), ...OPTIONAL.map((v) => ({ ...v, required: false }))].map(
  (v) => {
    const raw = process.env[v.name];
    const ok = isRealValue(raw);
    const shadowed = !ok && isRealValue(fileValues[v.name]);
    return { ...v, ok, shadowed, shown: ok ? (v.secret ? mask(raw) : String(raw)) : null };
  }
);

const missingRequired = results.filter((r) => r.required && !r.ok);
const shadowed = results.filter((r) => r.shadowed);
const json = process.argv.includes("--json");

if (json) {
  process.stdout.write(
    JSON.stringify(
      {
        tool: "check-config",
        envFile,
        envFilePresent: present,
        loaderError,
        ok: missingRequired.length === 0,
        missing: missingRequired.map((r) => r.name),
        shadowedByEnvironment: shadowed.map((r) => r.name),
        variables: results.map(({ name, required, ok, shadowed: s }) => ({ name, required, ok, shadowed: s })),
      },
      null,
      2
    ) + "\n"
  );
  process.exit(missingRequired.length === 0 ? 0 : 1);
}

const G = "\x1b[32m";
const R = "\x1b[31m";
const Y = "\x1b[33m";
const D = "\x1b[90m";
const X = "\x1b[0m";

process.stdout.write(`\n  Agent-Jarvis 本地配置检查\n`);
process.stdout.write(`  ${D}${envFile}${X}  ${present ? `${G}存在${X}` : `${R}不存在${X}`}\n\n`);

if (!present) {
  process.stdout.write(`  ${R}.env.local 不存在${X} —— Next.js 只自动加载该文件。\n`);
  process.stdout.write(`  ${D}cp .env.local.example .env.local${X} 后填入各项值。\n\n`);
}

if (loaderError) {
  process.stdout.write(`  ${R}无法加载 .env.local${X}：${loaderError}\n`);
  process.stdout.write(`  ${D}下面的结果只反映当前进程环境变量，不代表文件内容。${X}\n\n`);
}

for (const r of results) {
  const tag = r.ok ? `${G}OK  ${X}` : r.shadowed ? `${Y}遮蔽${X}` : r.required ? `${R}缺失${X}` : `${Y}未设${X}`;
  const note = r.ok
    ? `${D}${r.shown}${X}`
    : r.shadowed
      ? `${Y}.env.local 里有值，但被同名环境变量（可能是空值）覆盖${X}`
      : `${D}${r.why}${X}`;
  process.stdout.write(`  ${tag} ${r.name.padEnd(22)} ${note}\n`);
}

if (shadowed.length > 0) {
  process.stdout.write(
    `\n  ${Y}${shadowed.length} 项被环境变量遮蔽${X}：${shadowed.map((r) => r.name).join(", ")}\n` +
      `  ${D}dotenv 不会覆盖已存在的环境变量，且"已导出但为空"也算存在。请 unset 后重试。${X}\n`
  );
}

if (isRealValue(process.env.JARVIS_TEST_USER_ID)) {
  process.stdout.write(
    `\n  ${Y}注意${X} JARVIS_TEST_USER_ID=${process.env.JARVIS_TEST_USER_ID} 已设置 —— 它会绕过登录，\n` +
      `       验证真实 Google 登录时必须取消设置，否则看不出 OAuth 是否真的通了。\n`
  );
}

if (missingRequired.length === 0) {
  const url = process.env.NEXTAUTH_URL;
  process.stdout.write(`\n  ${G}配置完整${X}。Google 控制台需要放行：\n`);
  process.stdout.write(`    Authorized origin       ${url}\n`);
  process.stdout.write(`    Authorized redirect URI ${url?.replace(/\/$/, "")}/api/auth/callback/google\n`);
  process.stdout.write(`  ${D}改动 .env.local 后需重启 dev server（Next 只在启动时读取 env）。${X}\n\n`);
  process.exit(0);
}

process.stdout.write(`\n  ${R}缺少 ${missingRequired.length} 项必需配置：${X}${missingRequired.map((r) => r.name).join(", ")}\n`);
process.stdout.write(`  ${D}填好后重启 dev server，再跑一次本检查。参见 docs/LOCAL_CONFIGURATION.md${X}\n\n`);
process.exit(1);

// Keep the module resolvable as a path for tooling that inspects it.
export const CONFIG_CHECK_PATH = fileURLToPath(import.meta.url);
