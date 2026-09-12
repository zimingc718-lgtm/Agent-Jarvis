type SessionLike = {
  user?: {
    id?: string | null;
    email?: string | null;
  } | null;
} | null;

type AuthGuardEnv = {
  NODE_ENV?: string;
  JARVIS_TEST_USER_ID?: string;
  /**
   * Single-admin mode (REQ-F-080, CR-20260912-local-production).
   *
   * Deliberately NOT the same switch as `JARVIS_TEST_USER_ID`. That one is a *test*
   * bypass and refusing it in production is the point of it — loosening it would quietly
   * weaken a guard whose whole job is "never in production". This is a separate, opt-in
   * statement of a different fact: "this instance has no login at all; every request is
   * this person", which is the posture the user chose on 2026-09-09 when Google login was
   * deferred. It exists so that posture can also be run from a production build, which
   * uses about a twelfth of the memory of `next dev` (EV-2026-09-12-local-production §1).
   */
  JARVIS_SINGLE_ADMIN_ID?: string;
  /** The instance's own public URL. Single-admin mode only applies on a loopback one. */
  NEXTAUTH_URL?: string;
};

export type AuthGuardResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401; message: "Authentication required." };

export function requireUserId(session: SessionLike, env: AuthGuardEnv = process.env): AuthGuardResult {
  const userId =
    session?.user?.id ??
    session?.user?.email ??
    getNonProductionTestUserId(env) ??
    getSingleAdminUserId(env);
  if (!userId) {
    return { ok: false, status: 401, message: "Authentication required." };
  }
  return { ok: true, userId };
}

function getNonProductionTestUserId(env: AuthGuardEnv): string | null {
  if (env.NODE_ENV === "production") {
    return null;
  }
  const value = env.JARVIS_TEST_USER_ID?.trim();
  return value || null;
}

/** Hosts that can only be reached from the machine itself. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0:0:0:0:0:0:0:1"]);

/**
 * Is this instance only reachable from its own machine?
 *
 * The guard that keeps single-admin mode from becoming an open door: if `NEXTAUTH_URL`
 * names a real host, the instance is (or intends to be) reachable by other people, and an
 * identity-free mode there would hand every visitor the owner's providers and
 * conversations. Then it refuses and the request gets a 401, forcing real authentication.
 *
 * A missing or unparseable URL is treated as NOT loopback: the safe answer when we cannot
 * tell is to require a login.
 */
export function isLoopbackInstance(env: AuthGuardEnv): boolean {
  const raw = env.NEXTAUTH_URL?.trim();
  if (!raw) {
    return false;
  }
  try {
    const hostname = new URL(raw).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * The single-admin identity, or null when the mode does not apply. Both conditions are
 * required: the id has to be set on purpose, and the instance has to be local-only.
 */
export function getSingleAdminUserId(env: AuthGuardEnv): string | null {
  const value = env.JARVIS_SINGLE_ADMIN_ID?.trim();
  if (!value) {
    return null;
  }
  return isLoopbackInstance(env) ? value : null;
}

/** What the preflight and the UI report about how this instance identifies its user. */
export type AuthMode =
  | { kind: "session"; detail: string }
  | { kind: "single-admin"; userId: string; detail: string }
  | { kind: "test-bypass"; userId: string; detail: string }
  | { kind: "refused"; detail: string };

export function describeAuthMode(env: AuthGuardEnv = process.env): AuthMode {
  const test = getNonProductionTestUserId(env);
  if (test) {
    return { kind: "test-bypass", userId: test, detail: `JARVIS_TEST_USER_ID=${test}（仅非生产，免登录）` };
  }
  const admin = env.JARVIS_SINGLE_ADMIN_ID?.trim();
  if (admin) {
    if (isLoopbackInstance(env)) {
      return {
        kind: "single-admin",
        userId: admin,
        detail: `JARVIS_SINGLE_ADMIN_ID=${admin}（本机单管理员，免登录；NEXTAUTH_URL 为回环地址）`,
      };
    }
    return {
      kind: "refused",
      detail: `JARVIS_SINGLE_ADMIN_ID 已设置，但 NEXTAUTH_URL=${env.NEXTAUTH_URL ?? "(未设置)"} 不是回环地址，单管理员模式已拒绝生效——请改回 http://localhost:<port>，或配置真实登录。`,
    };
  }
  return { kind: "session", detail: "需要登录（未启用任何免登录模式）" };
}
