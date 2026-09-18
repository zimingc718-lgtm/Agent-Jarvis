import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST-500 — CR-20260918-per-user-data-isolation CP-1 (root resolution) + CP-2 (migration).
 *
 * `entitiesRootFor`/`knowledgeRootFor`/`ensureUserDataMigrated` read `ENTITIES_ROOT`/
 * `KNOWLEDGE_ROOT` from `entities.ts`/`knowledge.ts` at import time (those are module-level
 * constants derived from `process.env.JARVIS_ENTITIES_PATH`/`JARVIS_KNOWLEDGE_PATH`), so this
 * suite sets those env vars BEFORE importing the modules under test — the same pattern
 * `library.ts`'s own tests already use for its lazily-evaluated paths, adapted for a
 * constant that is fixed at module load.
 */

let root: string;
let entitiesLegacy: string;
let knowledgeLegacy: string;
let usersBase: string;

async function freshModule() {
  vi.resetModules();
  return import("../src/lib/user-data-paths");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-jarvis-udp-"));
  entitiesLegacy = join(root, "entities");
  knowledgeLegacy = join(root, "knowledge");
  usersBase = join(root, "users");
  process.env.JARVIS_ENTITIES_PATH = entitiesLegacy;
  process.env.JARVIS_KNOWLEDGE_PATH = knowledgeLegacy;
  process.env.JARVIS_USERS_PATH = usersBase;
  delete process.env.JARVIS_SINGLE_ADMIN_ID;
  delete process.env.JARVIS_OWNER_EMAIL;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.JARVIS_ENTITIES_PATH;
  delete process.env.JARVIS_KNOWLEDGE_PATH;
  delete process.env.JARVIS_USERS_PATH;
  delete process.env.JARVIS_SINGLE_ADMIN_ID;
  delete process.env.JARVIS_OWNER_EMAIL;
});

describe("entitiesRootFor / knowledgeRootFor (CP-1)", () => {
  it("① 同一个 userId 每次算出同一条路径，落在 USERS_BASE 下", async () => {
    const { entitiesRootFor, knowledgeRootFor } = await freshModule();
    const a1 = entitiesRootFor("ziming@example.com");
    const a2 = entitiesRootFor("ziming@example.com");
    expect(a1).toBe(a2);
    expect(a1.startsWith(usersBase)).toBe(true);
    expect(knowledgeRootFor("ziming@example.com").startsWith(usersBase)).toBe(true);
  });

  it("② 不同 userId 算出不同路径，互不覆盖", async () => {
    const { entitiesRootFor } = await freshModule();
    const a = entitiesRootFor("alice@example.com");
    const b = entitiesRootFor("bob@example.com");
    expect(a).not.toBe(b);
  });

  it("③ userId 里的路径穿越字符被净化，算出的路径仍在 USERS_BASE 之内", async () => {
    const { entitiesRootFor } = await freshModule();
    const malicious = entitiesRootFor("../../etc/passwd");
    expect(malicious.startsWith(usersBase)).toBe(true);
    expect(malicious).not.toContain("..");
    // 净化后不含分隔符，天然回答了"能不能拼出 .. 走出 USERS_BASE"这个问题——不需要
    // 用 fs 再去证一遍一个字符串比较已经证明的事。
  });

  it("④ 空字符串 userId 拒绝，不会悄悄算出 USERS_BASE 本身当作路径", async () => {
    const { entitiesRootFor } = await freshModule();
    expect(() => entitiesRootFor("")).toThrow();
    expect(() => entitiesRootFor("   ")).toThrow();
  });

  it("⑤ 邮箱地址净化后可读（下划线替换非法字符），不是纯哈希", async () => {
    const { entitiesRootFor } = await freshModule();
    const path = entitiesRootFor("ziming@example.com");
    expect(path).toContain("ziming");
    expect(path).toContain("example");
  });
});

describe("ensureUserDataMigrated (CP-2)", () => {
  it("① 单管理员模式：legacy 根有数据，JARVIS_SINGLE_ADMIN_ID 命中时真的搬过去", async () => {
    mkdirSync(entitiesLegacy, { recursive: true });
    writeFileSync(join(entitiesLegacy, "vertiv.md"), "kind: competitor\n---\n真实数据");
    mkdirSync(knowledgeLegacy, { recursive: true });
    writeFileSync(join(knowledgeLegacy, "note1.md"), "title: 笔记\n---\n真实知识");
    process.env.JARVIS_SINGLE_ADMIN_ID = "admin";

    const { ensureUserDataMigrated, entitiesRootFor, knowledgeRootFor } = await freshModule();
    const result = await ensureUserDataMigrated("admin");

    expect(result.entities).toBe("migrated");
    expect(result.knowledge).toBe("migrated");
    expect(existsSync(entitiesLegacy)).toBe(false); // rename, 不是 copy——旧路径不再存在
    expect(existsSync(join(entitiesRootFor("admin"), "vertiv.md"))).toBe(true);
    expect(readFileSync(join(entitiesRootFor("admin"), "vertiv.md"), "utf8")).toContain("真实数据");
    expect(existsSync(join(knowledgeRootFor("admin"), "note1.md"))).toBe(true);
  });

  it("② 幂等：第二次调用不重复搬、不报错，直接短路为 exists", async () => {
    mkdirSync(entitiesLegacy, { recursive: true });
    writeFileSync(join(entitiesLegacy, "vertiv.md"), "真实数据");
    process.env.JARVIS_SINGLE_ADMIN_ID = "admin";

    const { ensureUserDataMigrated } = await freshModule();
    const first = await ensureUserDataMigrated("admin");
    const second = await ensureUserDataMigrated("admin");

    expect(first.entities).toBe("migrated");
    expect(second.entities).toBe("exists");
    expect(second.knowledge).toBe("exists"); // 第一次已经把空的 knowledge 也建成 created-empty
  });

  it("③ 非 owner 的真实登录：不触发迁移，只建一个空目录，legacy 数据原样留在原地", async () => {
    mkdirSync(entitiesLegacy, { recursive: true });
    writeFileSync(join(entitiesLegacy, "vertiv.md"), "属于 owner 的真实数据");
    process.env.JARVIS_OWNER_EMAIL = "owner@example.com";

    const { ensureUserDataMigrated, entitiesRootFor } = await freshModule();
    const result = await ensureUserDataMigrated("someone-else@example.com");

    expect(result.entities).toBe("created-empty");
    expect(existsSync(entitiesLegacy)).toBe(true); // legacy 原样保留，没被别人搬走
    expect(existsSync(join(entitiesRootFor("someone-else@example.com"), "vertiv.md"))).toBe(false);
  });

  it("④ 邮箱大小写不敏感：JARVIS_OWNER_EMAIL 与真实 session 邮箱大小写不同也能识别为 owner", async () => {
    mkdirSync(entitiesLegacy, { recursive: true });
    writeFileSync(join(entitiesLegacy, "vertiv.md"), "真实数据");
    process.env.JARVIS_OWNER_EMAIL = "Owner@Example.com";

    const { ensureUserDataMigrated } = await freshModule();
    const result = await ensureUserDataMigrated("owner@example.com");

    expect(result.entities).toBe("migrated");
  });

  it("⑤ legacy 根为空（全新部署）：owner 得到一个空目录，不报错", async () => {
    process.env.JARVIS_SINGLE_ADMIN_ID = "admin";
    const { ensureUserDataMigrated, entitiesRootFor } = await freshModule();
    const result = await ensureUserDataMigrated("admin");

    expect(result.entities).toBe("created-empty");
    expect(existsSync(entitiesRootFor("admin"))).toBe(true);
  });

  it("⑥ 半迁移恢复：entities 已迁移、knowledge 还留在 legacy 时，第二次调用只补完 knowledge", async () => {
    mkdirSync(entitiesLegacy, { recursive: true });
    writeFileSync(join(entitiesLegacy, "vertiv.md"), "真实数据");
    mkdirSync(knowledgeLegacy, { recursive: true });
    writeFileSync(join(knowledgeLegacy, "note1.md"), "真实知识");
    process.env.JARVIS_SINGLE_ADMIN_ID = "admin";

    const { ensureUserDataMigrated, entitiesRootFor } = await freshModule();
    // 模拟"进程在两次搬迁之间崩溃"：手工只搬 entities，不调用完整函数。目标目录本身
    // 不能提前建——Windows 上 rename 到一个已存在的目录会报 EPERM，只需建父目录
    // （users/admin/），与 ensureRootMigrated 自己的真实做法一致。
    const { rename, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(entitiesRootFor("admin")), { recursive: true });
    await rename(entitiesLegacy, entitiesRootFor("admin"));

    const result = await ensureUserDataMigrated("admin");
    expect(result.entities).toBe("exists"); // 已经在那了，短路
    expect(result.knowledge).toBe("migrated"); // 还没搬的这次真的搬了
  });

  it("⑦ 没有配置任何 owner（JARVIS_SINGLE_ADMIN_ID 和 JARVIS_OWNER_EMAIL 都未设置）：谁登录都不触发迁移", async () => {
    mkdirSync(entitiesLegacy, { recursive: true });
    writeFileSync(join(entitiesLegacy, "vertiv.md"), "真实数据");

    const { ensureUserDataMigrated } = await freshModule();
    const result = await ensureUserDataMigrated("anyone@example.com");

    expect(result.entities).toBe("created-empty");
    expect(existsSync(entitiesLegacy)).toBe(true);
  });
});
