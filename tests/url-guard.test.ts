import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  assertAllowedUrl,
  blockedReasonForAddress,
  fetchWithGuardedRedirects,
  MAX_REDIRECTS,
  UrlNotAllowedError,
  type Resolver,
} from "@/lib/tools/url-guard";

/**
 * TEST-071 — SSRF adversarial samples (REQ-NF-009 ③, DEC-025, TASK-069).
 *
 * `read_url` fetches an address the **model** chose, and the model's context holds
 * attacker-controlled page text. Each sample is asserted on its own (原则 15) rather than
 * rolled into one loop, so a regression names the exact hole it opened.
 */

/** Every hostname resolves to one public address unless a test says otherwise. */
const publicResolver: Resolver = async () => ["93.184.216.34"];

const opts = { resolver: publicResolver };

describe("assertAllowedUrl — 逐条对抗样本", () => {
  it("① 拒绝 127.0.0.1", async () => {
    await expect(assertAllowedUrl("http://127.0.0.1/x", opts)).rejects.toBeInstanceOf(UrlNotAllowedError);
  });

  it("① 拒绝 localhost 名（无需 DNS）", async () => {
    await expect(assertAllowedUrl("http://localhost:8080/x", opts)).rejects.toThrow(/本机/);
  });

  it("② 拒绝 IPv6 ::1", async () => {
    await expect(assertAllowedUrl("http://[::1]/x", opts)).rejects.toThrow(/IPv6 loopback/);
  });

  it("② 拒绝 IPv6 链路本地 fe80::", async () => {
    await expect(assertAllowedUrl("http://[fe80::1]/x", opts)).rejects.toThrow(/链路本地/);
  });

  it("② 拒绝 IPv6 唯一本地 fc00::/7", async () => {
    await expect(assertAllowedUrl("http://[fd12::1]/x", opts)).rejects.toThrow(/唯一本地/);
  });

  it("② 拒绝 IPv4-mapped ::ffff:127.0.0.1", async () => {
    await expect(assertAllowedUrl("http://[::ffff:127.0.0.1]/x", opts)).rejects.toThrow(/loopback/);
  });

  it("③ 拒绝私网 10/172.16/192.168", async () => {
    await expect(assertAllowedUrl("http://10.0.0.5/x", opts)).rejects.toThrow(/10\.0\.0\.0\/8/);
    await expect(assertAllowedUrl("http://172.16.3.4/x", opts)).rejects.toThrow(/172\.16\.0\.0\/12/);
    await expect(assertAllowedUrl("http://192.168.1.1/x", opts)).rejects.toThrow(/192\.168\.0\.0\/16/);
  });

  it("④ 拒绝 0.0.0.0/8 与 100.64/10", async () => {
    await expect(assertAllowedUrl("http://0.0.0.0/x", opts)).rejects.toThrow(/0\.0\.0\.0\/8/);
    await expect(assertAllowedUrl("http://100.64.1.1/x", opts)).rejects.toThrow(/CGNAT/);
  });

  it("⑤ 拒绝云元数据 169.254.169.254", async () => {
    await expect(assertAllowedUrl("http://169.254.169.254/latest/meta-data/", opts)).rejects.toThrow(/元数据/);
  });

  it("⑥ 拒绝 URL 中的 userinfo", async () => {
    await expect(assertAllowedUrl("http://user:pass@example.com/x", opts)).rejects.toThrow(/用户名或密码/);
  });

  it("⑦ 拒绝非 http(s) 协议", async () => {
    for (const url of ["file:///etc/passwd", "gopher://example.com/", "data:text/html,<b>x</b>"]) {
      await expect(assertAllowedUrl(url, opts)).rejects.toThrow(/仅支持 http\/https/);
    }
  });

  it("⑧ 多 A 记录中任一落禁区即整体拒绝", async () => {
    const mixed: Resolver = async () => ["93.184.216.34", "10.1.2.3"];
    await expect(assertAllowedUrl("http://split.example.com/x", { resolver: mixed })).rejects.toThrow(/10\.0\.0\.0\/8/);
  });

  it("放行公网地址", async () => {
    const url = await assertAllowedUrl("https://example.com/page", opts);
    expect(url.hostname).toBe("example.com");
  });

  it("解析失败或零结果即拒绝（不默认放行）", async () => {
    await expect(assertAllowedUrl("http://nx.example/x", { resolver: async () => [] })).rejects.toThrow(/没有解析结果/);
    await expect(
      assertAllowedUrl("http://nx.example/x", {
        resolver: async () => {
          throw new Error("ENOTFOUND");
        },
      })
    ).rejects.toThrow(/解析失败/);
  });
});

describe("fetchWithGuardedRedirects — 每跳重校验", () => {
  it("⑨ 重定向到内网在第 2 跳被拒（依赖可注入的 resolver 与宿主白名单）", async () => {
    // Without injection this case is untestable: the local test server is itself
    // loopback and would be rejected on hop 1 — the exact gap the R1 test role flagged.
    const fetcher = vi.fn(async (url: string) => {
      if (url.startsWith("https://start.example.com")) {
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/" } });
      }
      return new Response("should never be reached", { status: 200 });
    });

    await expect(
      fetchWithGuardedRedirects("https://start.example.com/a", {
        resolver: publicResolver,
        fetcher: fetcher as unknown as typeof fetch,
      })
    ).rejects.toThrow(/元数据/);
    // Hop 1 happened, hop 2 never did.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("⑨ 每跳都过校验：连续公网跳转可以完成", async () => {
    let hop = 0;
    const fetcher = vi.fn(async () => {
      hop += 1;
      return hop < 3
        ? new Response(null, { status: 302, headers: { location: `https://next-${hop}.example.com/` } })
        : new Response("ok", { status: 200 });
    });
    const response = await fetchWithGuardedRedirects("https://a.example.com/", {
      resolver: publicResolver,
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(await response.text()).toBe("ok");
  });

  it("⑩ 超过跳数上限即拒绝", async () => {
    const fetcher = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "https://loop.example.com/" } })
    );
    await expect(
      fetchWithGuardedRedirects("https://loop.example.com/", {
        resolver: publicResolver,
        fetcher: fetcher as unknown as typeof fetch,
      })
    ).rejects.toThrow(new RegExp(`${MAX_REDIRECTS}`));
  });
});

describe("已登记的残余风险与模块约束", () => {
  it("⑪ DNS 重绑定：如实记录当前行为，不伪装已防护", async () => {
    // Validation and connection are not atomic: a resolver that answers public on the
    // check and private at connect time is not caught. Closing this needs a custom
    // `lookup` on node:https and is registered as a known limitation, not fixed here.
    let call = 0;
    const rebinding: Resolver = async () => (call++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]);
    await expect(assertAllowedUrl("http://rebind.example.com/x", { resolver: rebinding })).resolves.toBeInstanceOf(URL);
    // Second check — by now the name points inward — does reject, which is why a
    // per-hop re-check narrows (but does not close) the window.
    await expect(assertAllowedUrl("http://rebind.example.com/x", { resolver: rebinding })).rejects.toThrow(/loopback/);
  });

  it("⑫ url-guard 不接触文件系统（grep 守卫）", () => {
    const source = readFileSync(new URL("../src/lib/tools/url-guard.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from "node:fs/);
    expect(source).not.toMatch(/require\(["']node:fs/);
  });

  it("地址判定是纯函数，可脱离 DNS 穷举", () => {
    expect(blockedReasonForAddress("8.8.8.8")).toBeNull();
    expect(blockedReasonForAddress("127.0.0.1")).toMatch(/loopback/);
    expect(blockedReasonForAddress("::1")).toMatch(/loopback/);
  });
});
