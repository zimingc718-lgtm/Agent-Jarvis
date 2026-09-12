import { describe, expect, it } from "vitest";
import { describeAuthMode, getSingleAdminUserId, isLoopbackInstance, requireUserId } from "@/lib/auth-guard";

/**
 * TEST-140 — single-admin mode for the local production build
 * (REQ-F-080, REQ-NF-040; DEC-060; TASK-110). CR-20260912-local-production.
 *
 * Env is passed explicitly rather than mutated on `process.env`, so these cases cannot
 * leak into other files and cannot be weakened by whatever the runner happens to set.
 */

const LOCAL = { NODE_ENV: "production", NEXTAUTH_URL: "http://localhost:3000" };

describe("TEST-140 单管理员模式 (REQ-F-080)", () => {
  it("① 生产模式下，回环地址 + 显式 id → 放行", () => {
    const env = { ...LOCAL, JARVIS_SINGLE_ADMIN_ID: "admin" };
    expect(requireUserId(null, env)).toEqual({ ok: true, userId: "admin" });
    expect(getSingleAdminUserId(env)).toBe("admin");
  });

  it("② 没设 id 时不放行——必须是显式选择，不能是默认行为", () => {
    expect(requireUserId(null, LOCAL)).toEqual({
      ok: false,
      status: 401,
      message: "Authentication required.",
    });
    expect(getSingleAdminUserId(LOCAL)).toBeNull();
  });

  it("③ NEXTAUTH_URL 指向真实域名时拒绝——这是防止免登录模式开到公网的那道闸", () => {
    for (const url of ["https://jarvis.example.com", "http://192.168.1.20:3000", "http://10.0.0.5", "http://[2001:db8::1]"]) {
      const env = { ...LOCAL, JARVIS_SINGLE_ADMIN_ID: "admin", NEXTAUTH_URL: url };
      expect(getSingleAdminUserId(env), url).toBeNull();
      expect(requireUserId(null, env), url).toMatchObject({ ok: false, status: 401 });
    }
  });

  it("③ NEXTAUTH_URL 缺失或非法时也拒绝——判断不了就要求登录", () => {
    expect(getSingleAdminUserId({ ...LOCAL, JARVIS_SINGLE_ADMIN_ID: "admin", NEXTAUTH_URL: undefined })).toBeNull();
    expect(getSingleAdminUserId({ ...LOCAL, JARVIS_SINGLE_ADMIN_ID: "admin", NEXTAUTH_URL: "不是URL" })).toBeNull();
  });

  it("④ 各种回环写法都认", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3002", "http://[::1]:3000", "https://localhost"]) {
      expect(isLoopbackInstance({ NEXTAUTH_URL: url }), url).toBe(true);
    }
    expect(isLoopbackInstance({ NEXTAUTH_URL: "http://localhost.evil.com" })).toBe(false);
  });

  it("⑤ 真实会话优先于单管理员身份", () => {
    const env = { ...LOCAL, JARVIS_SINGLE_ADMIN_ID: "admin" };
    expect(requireUserId({ user: { id: "real-user" } }, env)).toEqual({ ok: true, userId: "real-user" });
  });

  it("⑥ 测试旁路仍然只在非生产生效——本 CR 没有放宽它", () => {
    const prod = { NODE_ENV: "production", JARVIS_TEST_USER_ID: "smoke", NEXTAUTH_URL: "http://localhost:3000" };
    expect(requireUserId(null, prod)).toMatchObject({ ok: false, status: 401 });
    const dev = { ...prod, NODE_ENV: "development" };
    expect(requireUserId(null, dev)).toEqual({ ok: true, userId: "smoke" });
  });

  it("⑦ describeAuthMode 说清当前是哪种身份来源，拒绝时给出修法", () => {
    expect(describeAuthMode({ ...LOCAL, JARVIS_SINGLE_ADMIN_ID: "admin" })).toMatchObject({
      kind: "single-admin",
      userId: "admin",
    });
    const refused = describeAuthMode({
      ...LOCAL,
      JARVIS_SINGLE_ADMIN_ID: "admin",
      NEXTAUTH_URL: "https://jarvis.example.com",
    });
    expect(refused.kind).toBe("refused");
    expect(refused.detail).toContain("不是回环地址");
    expect(describeAuthMode(LOCAL).kind).toBe("session");
    expect(describeAuthMode({ NODE_ENV: "development", JARVIS_TEST_USER_ID: "t" }).kind).toBe("test-bypass");
  });
});
