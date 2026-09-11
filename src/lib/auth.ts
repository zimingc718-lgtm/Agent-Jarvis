import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { isRealValue } from "./runtime-config";

type RuntimeEnv = Partial<Record<"GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "NEXTAUTH_SECRET" | "NEXTAUTH_URL", string>>;

type GoogleOAuthConfig =
  | {
      configured: true;
      clientId: string;
      clientSecret: string;
      nextAuthSecret: string;
      nextAuthUrl: string;
      missing: [];
    }
  | {
      configured: false;
      missing: Array<keyof RuntimeEnv>;
    };

const requiredGoogleOAuthEnv: Array<keyof RuntimeEnv> = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL"
];

export function getGoogleOAuthConfig(env: RuntimeEnv = process.env): GoogleOAuthConfig {
  const missing = requiredGoogleOAuthEnv.filter((name) => !isRealValue(env[name]));
  if (missing.length > 0) {
    return { configured: false, missing };
  }

  return {
    configured: true,
    clientId: env.GOOGLE_CLIENT_ID!.trim(),
    clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
    nextAuthSecret: env.NEXTAUTH_SECRET!.trim(),
    nextAuthUrl: env.NEXTAUTH_URL!.trim(),
    missing: []
  };
}

export function createAuthOptions(env: RuntimeEnv = process.env): NextAuthOptions {
  const googleConfig = getGoogleOAuthConfig(env);
  return {
    providers: googleConfig.configured
      ? [
          GoogleProvider({
            clientId: googleConfig.clientId,
            clientSecret: googleConfig.clientSecret
          })
        ]
      : [],
    secret: googleConfig.configured ? googleConfig.nextAuthSecret : undefined,
    callbacks: {
      async session({ session }) {
        return session;
      }
    }
  };
}

export const authOptions: NextAuthOptions = createAuthOptions();
