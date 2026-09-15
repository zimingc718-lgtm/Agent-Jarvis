import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TEST-400 — 资料库的两条 API（REQ-F-220；CR-20260915-library-adoption CP-3）。
 *
 * 环境变量必须在 import 之前设好：知识库根是模块级常量，加载那一刻就定死了。
 */

const dir = mkdtempSync(join(tmpdir(), "agent-jarvis-library-routes-"));
// 夹具目录用 ASCII 名：叫「资料库」时，beforeEach 里对它反复 rmSync(recursive) 会让
// vitest 的 worker 直接死掉（ERR_IPC_CHANNEL_CLOSED，一条用例结果都收不到，也没有堆栈）。
// 换成 ASCII 名即全绿。真实目录名由 JARVIS_LIBRARY_PATH 指定，与这里叫什么无关。
const root = join(dir, "lib-root");
process.env.JARVIS_LIBRARY_PATH = root;
process.env.JARVIS_LIBRARY_STATE_PATH = join(dir, "state");
process.env.JARVIS_KNOWLEDGE_PATH = join(dir, "knowledge");
process.env.JARVIS_DB_PATH = join(dir, "routes.sqlite");
process.env.JARVIS_SECRET_KEY = "0123456789abcdef0123456789abcdef";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => ({ user: { email: "library-user@example.com" } })),
}));

const { getServerSession } = await import("next-auth");
const listRoute = await import("@/app/api/library/route");
const decideRoute = await import("@/app/api/library/decide/route");

function get(url: string): Request {
  return new Request(url, { headers: { accept: "application/json" } });
}

function post(body: unknown): Request {
  return new Request("http://test/api/library/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PDF_ID = "AIDC/02_原文/P1_diablo.pdf";

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue({ user: { email: "library-user@example.com" } } as never);
  rmSync(root, { recursive: true, force: true });
  rmSync(join(dir, "state"), { recursive: true, force: true });
  rmSync(join(dir, "knowledge"), { recursive: true, force: true });
  mkdirSync(join(root, "AIDC", "02_原文"), { recursive: true });
  writeFileSync(
    join(root, "AIDC", "清单.csv"),
    "报告,编号,层级,来源,标题,URL,原文文件,文本层文件,取回方式,备注\n供电架构,P1,一手,OCP,Diablo 400,https://example.org/d,P1_diablo.pdf,,直取,\n",
    "utf8"
  );
  writeFileSync(join(root, "AIDC", "02_原文", "P1_diablo.pdf"), "%PDF-1.4 fake", "utf8");
});

afterAll(() => {
  delete process.env.JARVIS_LIBRARY_PATH;
  delete process.env.JARVIS_LIBRARY_STATE_PATH;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("TEST-400 资料库 API (REQ-F-220)", () => {
  it("① GET 列出全部并带计数；status= 可以只要待采纳的那部分", async () => {
    const all = await (await listRoute.GET(get("http://test/api/library"))).json();
    expect(all.counts).toEqual({ total: 2, pending: 2, adopted: 0, rejected: 0 });
    expect(all.items.map((item: { id: string }) => item.id)).toContain(PDF_ID);

    const pending = await (await listRoute.GET(get("http://test/api/library?status=pending"))).json();
    expect(pending.items).toHaveLength(2);
    const adopted = await (await listRoute.GET(get("http://test/api/library?status=adopted"))).json();
    expect(adopted.items).toHaveLength(0);
    // 计数始终是全量的，不跟着筛选变——否则「还剩多少要审」就没地方看了。
    expect(adopted.counts.total).toBe(2);
  });

  it("② POST 裁定后计数变化，重复裁定落在 unchanged", async () => {
    const first = await (await decideRoute.POST(post({ ids: [PDF_ID], status: "adopted" }))).json();
    expect(first.changed).toEqual([PDF_ID]);
    expect(first.counts).toEqual({ total: 2, pending: 1, adopted: 1, rejected: 0 });

    const second = await (await decideRoute.POST(post({ ids: [PDF_ID], status: "adopted" }))).json();
    expect(second.changed).toEqual([]);
    expect(second.unchanged).toEqual([PDF_ID]);
  });

  it("③ 参数不合法各报各的：status 不认得 400，id 不存在 404", async () => {
    expect((await decideRoute.POST(post({ ids: [PDF_ID], status: "maybe" }))).status).toBe(400);
    expect((await decideRoute.POST(post({ ids: [], status: "adopted" }))).status).toBe(400);
    expect((await decideRoute.POST(post({ ids: ["AIDC/没有.pdf"], status: "adopted" }))).status).toBe(404);
  });

  it("④ 未登录读不到资料库清单", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null as never);
    expect((await listRoute.GET(get("http://test/api/library"))).status).toBe(401);
    expect((await decideRoute.POST(post({ ids: [PDF_ID], status: "adopted" }))).status).toBe(401);
  });
});
