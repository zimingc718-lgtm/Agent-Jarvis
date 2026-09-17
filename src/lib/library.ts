import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import type { DocumentRoot } from "./documents";
import { deleteKnowledge, listKnowledge, saveKnowledge } from "./knowledge";

/**
 * 资料库：一层**受采纳约束**的原始资料（REQ-F-220、REQ-F-230、DEC-310；CR-20260915-library-adoption）。
 *
 * 为什么不是已有的两层里的任何一层：
 *
 * - 本地原档层（REQ-F-110）是「用户自己的文件，就地读，不复制不改写」，配上就**全部**可检索，
 *   没有审的概念。资料库里 258 个文件有一半是网页存档，未经人看一眼就涌进检索结果，等于把
 *   二手页面和一手规范混在一起喂给模型。
 * - 知识库（REQ-F-044..046）是策展过的条目，一条一个念头、上限 64 KB。单文件 17 MB 的 PDF
 *   既塞不进去，塞进去也毁掉那个形状。
 *
 * 所以这一层只做一件事：**判断**。字节仍留在资料库目录里（进版本库，由 git 管），知识库只拿到
 * 一张索引卡，采纳登记单独落一个 JSON 文件——三者各司其职，删掉任意一层另外两层仍然成立
 * （DEC-310：登记落文件不落表，门因此保持双向，删掉 `adoption.json` 全部回到待采纳）。
 */

/** 资料库在仓库里的目录名，同时也是它作为文档根时的标签。 */
export const LIBRARY_LABEL = "资料库";
export const ADOPTION_FILE = "adoption.json";

/**
 * 两个路径都**在调用时**算，不写成模块级常量。
 *
 * 写成常量会在模块加载那一刻按 `process.cwd()` 定死，于是单测拿到的是仓库里那个真的
 * 258 个文件的资料库——测试从此依赖仓库内容，也没法指到夹具目录。这是写完第一版就被
 * 测试当场逮到的。
 */
export function libraryRootPath(): string {
  return process.env.JARVIS_LIBRARY_PATH ?? join(process.cwd(), LIBRARY_LABEL);
}

/** 采纳登记的落盘位置。与知识库一样在 `.data/` 下：这是本机的判断，不是内容。 */
export function libraryStatePath(): string {
  return process.env.JARVIS_LIBRARY_STATE_PATH ?? join(process.cwd(), ".data", "library");
}

/** 遍历上限，与 `documents.ts` 同口径：一个指错的目录不该拖死一轮对话。 */
const MAX_WALK_FILES = 5_000;
const MAX_WALK_DEPTH = 8;

/** 人读索引与机器可读索引的文件名（资料库根下每个合集各一份）。 */
const MANIFEST_CSV = "清单.csv";

export type AdoptionStatus = "pending" | "adopted" | "rejected";

export type AdoptionRecord = {
  status: AdoptionStatus;
  at: string;
  /** 采纳时写进知识库的那张索引卡的文件名；取消采纳时按它删卡（CP-5）。 */
  card?: string;
};
export type AdoptionLedger = Record<string, AdoptionRecord>;

/** `清单.csv` 的一行。列名见资料库 README：报告/编号/层级/来源/标题/URL/原文文件/文本层文件/取回方式/备注。 */
export type ManifestRow = {
  report: string;
  no: string;
  level: string;
  org: string;
  title: string;
  url: string;
  sourceFile: string;
  textFile: string;
  retrieval: string;
  note: string;
};

export type LibraryItem = {
  /** 相对资料库根的 POSIX 路径，例如 `AIDC-供电架构与电网/01_报告/aidc-grid.html`。 */
  id: string;
  /** 顶层目录（一个合集 = 一份研究）。 */
  collection: string;
  /** 合集下的分组目录，例如 `01_报告`、`02_原文_供电架构`。根下的文件为空串。 */
  group: string;
  name: string;
  ext: string;
  bytes: number;
  modifiedAt: string;
  status: AdoptionStatus;
  /** 做出判断的时刻；待采纳为空串。 */
  decidedAt: string;
  /** 以下五项来自清单，匹配不上时为空串——**不猜**：匹配不上就是匹配不上，界面照实显示。 */
  no: string;
  title: string;
  sourceUrl: string;
  org: string;
  level: string;
  retrieval: string;
};

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

/**
 * 一行 CSV。只处理双引号包裹与 `""` 转义——清单是本项目自己产的，不是任意方言。
 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

/** 清单是 UTF-8 BOM 的（README 说明是为了 Excel 直接打开），解析前先剥掉。 */
export function parseManifest(raw: string): ManifestRow[] {
  const text = raw.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return [];
  }
  const header = splitCsvLine(lines[0]!).map((cell) => cell.trim());
  const indexOf = (name: string) => header.indexOf(name);
  const columns = {
    report: indexOf("报告"),
    no: indexOf("编号"),
    level: indexOf("层级"),
    org: indexOf("来源"),
    title: indexOf("标题"),
    url: indexOf("URL"),
    sourceFile: indexOf("原文文件"),
    textFile: indexOf("文本层文件"),
    retrieval: indexOf("取回方式"),
    note: indexOf("备注"),
  };
  const at = (cells: string[], index: number) => (index >= 0 ? (cells[index] ?? "").trim() : "");
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return {
      report: at(cells, columns.report),
      no: at(cells, columns.no),
      level: at(cells, columns.level),
      org: at(cells, columns.org),
      title: at(cells, columns.title),
      url: at(cells, columns.url),
      sourceFile: at(cells, columns.sourceFile),
      textFile: at(cells, columns.textFile),
      retrieval: at(cells, columns.retrieval),
      note: at(cells, columns.note),
    };
  });
}

/** 资料库存在时，它就是一个文档根——不需要用户去「本地文档」里手工添加（CP-5）。 */
export function libraryRoot(root: string = libraryRootPath()): DocumentRoot | null {
  return existsSync(root) ? { label: LIBRARY_LABEL, path: root } : null;
}

export async function readLedger(stateDir: string = libraryStatePath()): Promise<AdoptionLedger> {
  try {
    const raw = await readFile(join(stateDir, ADOPTION_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const ledger: AdoptionLedger = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const status = (value as { status?: unknown }).status;
      const at = (value as { at?: unknown }).at;
      const card = (value as { card?: unknown }).card;
      if (status === "adopted" || status === "rejected" || status === "pending") {
        ledger[id] = {
          status,
          at: typeof at === "string" ? at : "",
          ...(typeof card === "string" && card ? { card } : {}),
        };
      }
    }
    return ledger;
  } catch {
    // 没有文件 = 一条都没审过。坏掉的文件同样退回「全部待采纳」：宁可重审，不可把
    // 没审过的当成审过的。
    return {};
  }
}

export async function writeLedger(ledger: AdoptionLedger, stateDir: string = libraryStatePath()): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, ADOPTION_FILE), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

async function walk(root: string, budget: { files: number }): Promise<Array<{ id: string; bytes: number; modifiedAt: string }>> {
  const found: Array<{ id: string; bytes: number; modifiedAt: string }> = [];

  async function descend(dir: string, relative: string, depth: number): Promise<void> {
    if (depth > MAX_WALK_DEPTH || budget.files <= 0) {
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (budget.files <= 0) {
        return;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      const absolute = join(dir, entry.name);
      const id = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await descend(absolute, id, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      let info;
      try {
        info = await stat(absolute);
      } catch {
        continue;
      }
      budget.files -= 1;
      found.push({ id, bytes: info.size, modifiedAt: new Date(info.mtimeMs).toISOString() });
    }
  }

  await descend(root, "", 0);
  return found;
}

/**
 * 清单按**文件名**与磁盘对账：清单里记的是 `P100_xxx.pdf` 这样的名字，不是路径。
 * 一个名字可能同时出现在原文与文本层两列，两边都指回同一行。
 */
function indexManifest(rows: ManifestRow[]): Map<string, ManifestRow> {
  const byName = new Map<string, ManifestRow>();
  for (const row of rows) {
    for (const name of [row.sourceFile, row.textFile]) {
      const trimmed = name.trim();
      if (trimmed && !byName.has(trimmed)) {
        byName.set(trimmed, row);
      }
    }
  }
  return byName;
}

async function readManifests(root: string, collections: string[]): Promise<Map<string, ManifestRow>> {
  const merged = new Map<string, ManifestRow>();
  for (const collection of collections) {
    try {
      const raw = await readFile(join(root, collection, MANIFEST_CSV), "utf8");
      for (const [name, row] of indexManifest(parseManifest(raw))) {
        if (!merged.has(name)) {
          merged.set(name, row);
        }
      }
    } catch {
      // 没有清单的合集照常列出，只是每条都没有标题与来源——**不猜**。
    }
  }
  return merged;
}

export type ListLibraryOptions = { root?: string; stateDir?: string; knowledgeRoot?: string };

export async function listLibrary(options: ListLibraryOptions = {}): Promise<LibraryItem[]> {
  const root = options.root ?? libraryRootPath();
  if (!existsSync(root)) {
    return [];
  }
  const files = await walk(root, { files: MAX_WALK_FILES });
  const collections = [...new Set(files.map((file) => file.id.split("/")[0] ?? ""))].filter(Boolean);
  const manifest = await readManifests(root, collections);
  const ledger = await readLedger(options.stateDir);

  return files
    .map((file) => {
      const parts = file.id.split("/");
      const name = parts[parts.length - 1] ?? file.id;
      const row = manifest.get(name);
      const record = ledger[file.id];
      return {
        id: file.id,
        collection: parts[0] ?? "",
        group: parts.length > 2 ? (parts[1] ?? "") : "",
        name,
        ext: extname(name).toLowerCase(),
        bytes: file.bytes,
        modifiedAt: file.modifiedAt,
        status: record?.status ?? "pending",
        decidedAt: record?.at ?? "",
        no: row?.no ?? "",
        title: row?.title ?? "",
        sourceUrl: row?.url ?? "",
        org: row?.org ?? "",
        level: row?.level ?? "",
        retrieval: row?.retrieval ?? "",
      } satisfies LibraryItem;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function statusOf(id: string, stateDir: string = libraryStatePath()): Promise<AdoptionStatus> {
  const ledger = await readLedger(stateDir);
  return ledger[id]?.status ?? "pending";
}

/** 索引卡的 `source:`，也是**唯一**能把卡片认回来的标记——回滚时按它删卡。 */
export const INDEX_CARD_SOURCE = "library-index";

/**
 * 一张索引卡（CP-5）。这就是「与知识库链接起来」的那根线：
 * `search_knowledge` 命中卡片 → 卡片给出 `documentId` → `read_document` 取全文。
 *
 * 卡片故意写得小：它是一张目录卡，不是内容的副本。把 17 MB 的 PDF 抄一份进知识库，既超上限
 * 也毁掉知识库「一条一个念头」的形状（REQ-NF-013 ②）。
 */
export function renderIndexCard(item: LibraryItem): string {
  const lines = [
    `# ${item.title || item.name}`,
    "",
    `- 资料库编号: ${item.no || "（清单未收录）"}`,
    `- 合集: ${item.collection}${item.group ? ` / ${item.group}` : ""}`,
    `- 来源: ${item.org || "未标注"}${item.level ? `（${item.level}）` : ""}`,
    `- 原文链接: ${item.sourceUrl || "无"}`,
    `- 取回方式: ${item.retrieval || "未标注"}`,
    `- 文件: ${item.name}（${Math.max(1, Math.round(item.bytes / 1024))} KB）`,
    `- documentId: \`${LIBRARY_LABEL}/${item.id}\` —— 用 read_document 取全文`,
  ];
  return lines.join("\n");
}

export type DecideResult = { changed: LibraryItem[]; unchanged: string[] };

/**
 * 逐文件裁定（用户 2026-09-15 裁定的粒度）。批量是「一次调用多个 id」，不是「按目录一刀切」——
 * 界面上的「本目录全选」最终落到这里仍然是一串具体的 id，登记里留下的也是逐条的判断。
 */
export async function decideLibrary(
  ids: string[],
  status: AdoptionStatus,
  options: ListLibraryOptions = {}
): Promise<DecideResult> {
  const wanted = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (wanted.length === 0) {
    throw new LibraryError("没有指定要裁定的资料。", 400);
  }
  const items = await listLibrary(options);
  const known = new Map(items.map((item) => [item.id, item]));
  const missing = wanted.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new LibraryError(`资料库里没有这些条目：${missing.slice(0, 3).join("、")}${missing.length > 3 ? " 等" : ""}。`, 404);
  }

  const ledger = await readLedger(options.stateDir);
  const at = new Date().toISOString();
  const changed: LibraryItem[] = [];
  const unchanged: string[] = [];
  for (const id of wanted) {
    const previous = ledger[id];
    const before = previous?.status ?? "pending";
    if (before === status) {
      unchanged.push(id);
      continue;
    }
    const item = known.get(id)!;
    let card = previous?.card;

    // 采纳 → 写卡；离开采纳 → 删卡。两个方向都做，否则「取消采纳」只改了登记，
    // 检索里那张卡还在，用户会以为自己撤回了其实没有。
    if (status === "adopted") {
      const saved = await saveKnowledge(
        {
          title: item.title || item.name,
          content: renderIndexCard(item),
          source: INDEX_CARD_SOURCE,
          docType: item.level || "资料库原件",
          sourceUrl: item.sourceUrl,
          preferredName: `${LIBRARY_LABEL}-${item.no || item.name.replace(/\.[^.]+$/, "")}`,
        },
        options.knowledgeRoot
      );
      card = saved.name;
    } else if (card) {
      await deleteKnowledge(card, options.knowledgeRoot);
      card = undefined;
    }

    ledger[id] = { status, at, ...(card ? { card } : {}) };
    changed.push({ ...item, status, decidedAt: at });
  }
  if (changed.length > 0) {
    await writeLedger(ledger, options.stateDir);
  }
  return { changed, unchanged };
}

export type LibraryCounts = { total: number; pending: number; adopted: number; rejected: number };

export function countByStatus(items: LibraryItem[]): LibraryCounts {
  return items.reduce<LibraryCounts>(
    (counts, item) => {
      counts.total += 1;
      counts[item.status] += 1;
      return counts;
    },
    { total: 0, pending: 0, adopted: 0, rejected: 0 }
  );
}

/**
 * 统一浏览卡（REQ-F-046 ⑤，CR-20260915-knowledge-library-merge CP-2）。
 *
 * 已采纳的资料库原件本来就会在知识库里留一张索引卡（`decideLibrary` → `renderIndexCard`），
 * 所以「统一」不是新起一套存储，是把两个来源拼成一份看得见全貌的列表：已采纳的原件用
 * `LibraryItem` 本身的结构化字段（层级、来源、取回方式），比解析索引卡正文里的 Markdown
 * 更能撑起卡片界面；真正的知识条目（`source !== INDEX_CARD_SOURCE`）保留原样。两边不会
 * 重复——索引卡本身不会再单独出现一次。
 */
export type BrowseCard = {
  kind: "library" | "note";
  /** library：`LibraryItem.id`；note：知识条目的 `name`。 */
  id: string;
  title: string;
  docType: string;
  /** library 来源没有归属对象的概念，恒为空串。 */
  entity: string;
  bytes: number;
  /** library 用 `modifiedAt`，note 用 `createdAt`——都是「这份东西上次变化是什么时候」。 */
  updatedAt: string;
  sourceUrl: string;
  /** 非空时可用 `/api/documents/raw?id=` 查看原文；note 没有原文，恒为空串。 */
  documentId: string;
};

export type BrowseResult = { cards: BrowseCard[]; byType: Record<string, number> };

/**
 * 排序近似「模型推荐的优先级」：挂了归属对象的排前面（用户正在跟踪的东西，大概率比无主
 * 笔记更想先看到），组内按新旧。不是逐条调模型打分——258+ 条量级下不现实，方案选项里如实
 * 记了这个折衷。
 */
export async function listBrowseCards(options: ListLibraryOptions = {}): Promise<BrowseResult> {
  const [libraryItems, notes] = await Promise.all([listLibrary(options), listKnowledge(options.knowledgeRoot)]);

  const fromLibrary: BrowseCard[] = libraryItems
    .filter((item) => item.status === "adopted")
    .map((item) => ({
      kind: "library",
      id: item.id,
      title: item.title || item.name,
      docType: item.level || "资料库原件",
      entity: "",
      bytes: item.bytes,
      updatedAt: item.modifiedAt,
      sourceUrl: item.sourceUrl,
      documentId: `${LIBRARY_LABEL}/${item.id}`,
    }));

  const fromNotes: BrowseCard[] = notes
    .filter((entry) => entry.source !== INDEX_CARD_SOURCE)
    .map((entry) => ({
      kind: "note",
      id: entry.name,
      title: entry.title,
      docType: entry.docType,
      entity: entry.entity,
      bytes: entry.bytes,
      updatedAt: entry.createdAt,
      sourceUrl: entry.sourceUrl,
      documentId: "",
    }));

  const cards = [...fromLibrary, ...fromNotes].sort((a, b) => {
    const linkedA = a.entity ? 0 : 1;
    const linkedB = b.entity ? 0 : 1;
    if (linkedA !== linkedB) {
      return linkedA - linkedB;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const byType: Record<string, number> = {};
  for (const card of cards) {
    const key = card.docType || "未分类";
    byType[key] = (byType[key] ?? 0) + 1;
  }

  return { cards, byType };
}
