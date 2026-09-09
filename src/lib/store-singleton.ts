import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createStore, type Store } from "./store";

let store: Store | null = null;

export function getStore(): Store {
  if (!store) {
    const databasePath = process.env.JARVIS_DB_PATH ?? join(process.cwd(), ".data", "agent-jarvis.sqlite");
    mkdirSync(dirname(databasePath), { recursive: true });
    store = createStore(databasePath);
  }
  return store;
}
