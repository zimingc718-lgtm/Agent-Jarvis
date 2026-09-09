import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

mkdirSync(".data", { recursive: true });
const dbPath = join(process.cwd(), ".data", `e2e-${Date.now()}.sqlite`);

const result = spawnSync("npx playwright test", {
  stdio: "inherit",
  env: {
    ...process.env,
    JARVIS_E2E_DB_PATH: dbPath
  },
  shell: true
});

if (result.error) {
  console.error(result.error);
}
for (const path of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`, `${dbPath}-journal`]) {
  rmSync(path, { force: true, maxRetries: 10, retryDelay: 200 });
}
process.exit(result.status ?? 1);
