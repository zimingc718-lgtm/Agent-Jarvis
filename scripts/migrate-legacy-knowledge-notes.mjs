// 一次性迁移：CR-20260915-knowledge-library-merge CP-3。
//
// 资料库并入知识库、统一浏览视图上线之后，把「合并之前」就存在的知识笔记归档——不是新
// 功能，是这次合并本身要做的一步。依据是用户 2026-09-15 21:00 对助手三项待裁定之一的
// 明确答复「同意删除」（INPUT-2026-09-15-032：①资料库并入知识库后是否删除现有知识笔记
// ——同意删除）。
//
// 用归档不用真删：跟这个 CR 里其它每一处「删除」入口站在同一条安全线上（CP-1 的
// `deleteKnowledge`、更早 CR-20260915-board-card-lifecycle 的 `deleteEntity`）——判断
// 错了，文件还在 `archive/` 里，原样挪回知识库根目录就能恢复，不是真的没了。
//
// 只走 HTTP，不直接 import `src/lib`——跟仓库里其它脚本一致。本机单管理员模式下，回环
// 地址发出的请求不需要登录（见 `src/lib/auth-guard.ts` 的 `JARVIS_SINGLE_ADMIN_ID`），
// 因此不需要 Playwright 起浏览器，一个纯 `fetch` 脚本即可。
//
// 默认 dry-run：只读 `/api/knowledge`、只打印/写清单，不改一个文件。确认清单无误后加
// `--commit` 才会真的逐条调用 `DELETE /api/knowledge/<name>`。跑完把清单落盘在
// `.data/knowledge/archive/` 下（与被归档的文件同目录树），作为这次迁移可核查、可定位
// 的证据——`.data/` 不进版本库，证据文档引用这份清单的本机路径，与本会话其它「用户自己
// 那台」的真实入口证据是同一种记法。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = process.env.JARVIS_BASE_URL ?? "http://localhost:3000";
const commit = process.argv.includes("--commit");

const listed = await fetch(`${base}/api/knowledge`, { headers: { accept: "application/json" } });
if (!listed.ok) {
  console.log(`FAIL 读不到知识库列表（${listed.status}）。服务是否在跑？`);
  process.exit(1);
}
const { entries } = await listed.json();
const legacy = entries.filter((entry) => entry.source !== "library-index");

console.log(
  `知识库共 ${entries.length} 条，其中资料库索引卡 ${entries.length - legacy.length} 条（保留），` +
    `合并前遗留笔记 ${legacy.length} 条${commit ? "——即将归档" : "（dry-run，不会真的归档；加 --commit 才执行）"}。`
);

const manifest = {
  cr: "CR-20260915-knowledge-library-merge",
  cp: "CP-3",
  at: new Date().toISOString(),
  mode: commit ? "commit" : "dry-run",
  totalBefore: entries.length,
  archived: [],
  failed: [],
};

for (const entry of legacy) {
  const record = { name: entry.name, title: entry.title, source: entry.source, entity: entry.entity, docType: entry.docType };
  if (!commit) {
    manifest.archived.push(record);
    continue;
  }
  const response = await fetch(`${base}/api/knowledge/${encodeURIComponent(entry.name)}`, { method: "DELETE" });
  if (response.ok) {
    manifest.archived.push(record);
  } else {
    manifest.failed.push({ ...record, status: response.status });
  }
}

const outDir = join(process.cwd(), ".data", "knowledge", "archive");
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, `_migration-${manifest.at.replace(/[:.]/g, "-")}.json`);
await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`清单已写入 ${outPath}`);
console.log(
  commit
    ? `已归档 ${manifest.archived.length} 条，失败 ${manifest.failed.length} 条。撤销：把 archive/ 下对应的 .md 文件挪回知识库根目录即可。`
    : "dry-run 完成，没有改动任何文件。确认清单无误后加 --commit 重跑一次。"
);

process.exit(manifest.failed.length > 0 ? 1 : 0);
