type SessionLike = {
  user?: {
    id?: string | null;
    email?: string | null;
  } | null;
} | null;

type AuthGuardEnv = {
  NODE_ENV?: string;
  JARVIS_TEST_USER_ID?: string;
};

export type AuthGuardResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401; message: "Authentication required." };

export function requireUserId(session: SessionLike, env: AuthGuardEnv = process.env): AuthGuardResult {
  const userId = session?.user?.id ?? session?.user?.email ?? getNonProductionTestUserId(env);
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
