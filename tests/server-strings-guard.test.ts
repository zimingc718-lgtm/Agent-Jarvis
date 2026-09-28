import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { zhServer } from "@/lib/i18n-server";

/**
 * TEST-592 — error-code coverage (REQ-F-350 ④, DEC-470 ⑤; CR-20260928-server-strings-i18n).
 * Every dictionary code the server code names — `X.coded("…")`, `unformatted("…")`,
 * `reasonCode` / `messageCode` / `code` fields, `t("…")` / `ts("…")` / `tServer(lang, "…")` /
 * `zhMessage("…")` calls — must be a key of the server dictionary. TypeScript already refuses
 * an unknown key where the type reaches; this catches the places it does not (string fields
 * typed loosely, tests, future helpers) and proves the scan is not vacuous.
 */
const ROOT = join(__dirname, "..");
const SCAN_ROOTS = [join(ROOT, "src", "lib"), join(ROOT, "src", "app", "api")];
const PATTERNS = [
  /\.coded\(\s*(?:\d+,\s*)?"([\w.]+)"/g,
  /\bunformatted\(\s*"([\w.]+)"/g,
  /\b(?:reasonCode|messageCode|noteCode|code):\s*"([\w.]+)"/g,
  /\b(?:t|ts)\(\s*"([\w.]+)"/g,
  /\btServer\([^,()]+,\s*"([\w.]+)"/g,
  /\bzhMessage\(\s*"([\w.]+)"/g,
  /\bmessageFor\([^,()]+,[^,()]+,\s*"([\w.]+)"/g,
];
/** Keys that look like dictionary codes but belong to other vocabularies (settings keys, wake reasons, provider notes). */
const NOT_DICTIONARY = new Set(["disabled", "cap", "no-provider", "no-conversation", "failed", "secretUndecryptable", "missingKey"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sources(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("TEST-592 服务端错误码全部在字典里", () => {
  const files = SCAN_ROOTS.flatMap((dir) => sources(dir));
  const found: { file: string; code: string }[] = [];
  for (const file of files) {
    if (file.endsWith("i18n-server.ts") || file.endsWith("i18n.ts")) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const code = match[1]!;
        if (code.includes(".") && !NOT_DICTIONARY.has(code)) {
          found.push({ file: relative(ROOT, file).replace(/\\/g, "/"), code });
        }
      }
    }
  }

  it("① 扫到的错误码不是空集，且覆盖路由与领域模块", () => {
    expect(found.length).toBeGreaterThan(150);
    expect(found.some((f) => f.file.startsWith("src/app/api/"))).toBe(true);
    expect(found.some((f) => f.file === "src/lib/entities.ts")).toBe(true);
    expect(found.some((f) => f.file === "src/lib/zip.ts")).toBe(true);
  });

  it("② 每个错误码都是服务端字典的键", () => {
    const keys = new Set(Object.keys(zhServer));
    // UI-dictionary keys reach here through `t()` calls in browser-run lib code (send-failure.ts) and page-level hints.
    const uiKeys = new Set(["chat.requestFailed", "sendFailure.serverGone", "sendFailure.transferBroken", "page.storageHint"]);
    const unknown = found.filter((f) => !keys.has(f.code) && !uiKeys.has(f.code));
    expect(unknown, `不在字典里的错误码：\n${unknown.map((u) => `${u.file}: ${u.code}`).join("\n")}`).toEqual([]);
  });
});
