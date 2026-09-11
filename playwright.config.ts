import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  // One worker: every spec shares the same dev server and SQLite file, and
  // `resolveActiveProvider` walks a single global priority order — parallel spec
  // files would race over which provider the console resolves to.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3330",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3330",
    url: "http://127.0.0.1:3330",
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      // Own build dir so this server never corrupts a developer's `.next`.
      NEXT_DIST_DIR: ".next-e2e",
      JARVIS_TEST_USER_ID: "e2e-user",
      JARVIS_SECRET_KEY: "0123456789abcdef0123456789abcdef",
      NEXTAUTH_SECRET: "0123456789abcdef0123456789abcdef",
      NEXTAUTH_URL: "http://127.0.0.1:3330",
      GOOGLE_CLIENT_ID: "e2e-client.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "e2e-client-secret",
      JARVIS_DB_PATH: process.env.JARVIS_E2E_DB_PATH ?? "./.data/e2e.sqlite",
      JARVIS_SKILLS_PATH: process.env.JARVIS_E2E_SKILLS_PATH ?? "./.data/e2e-skills",
      JARVIS_KNOWLEDGE_PATH: process.env.JARVIS_E2E_KNOWLEDGE_PATH ?? "./.data/e2e-knowledge",
      JARVIS_E2E_MODEL_PORT: "3321"
    }
  }
});
