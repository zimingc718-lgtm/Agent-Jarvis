import type { UiLanguage } from "./language";

/**
 * The lookup shared by the interface dictionary (`i18n.ts`, shipped to the browser) and the
 * server dictionary (`i18n-server.ts`, never shipped) — REQ-F-340 / REQ-F-350, DEC-470.
 * Pure: no React, no `node:sqlite`, no store.
 */
export type Vars = Record<string, string | number>;
export type Tables<K extends string> = Record<UiLanguage, Record<K, string>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Look `key` up in `language`, apply `{name}` substitutions, prefer `<key>_one` for `count === 1`. */
export function lookup<K extends string>(tables: Tables<K>, language: UiLanguage, key: K, vars?: Vars): string {
  const table = tables[language] ?? tables.zh;
  let template: string = table[key] ?? tables.zh[key] ?? key;
  if (vars && vars.count === 1) {
    const singular = (table as Record<string, string | undefined>)[`${key}_one`];
    if (singular !== undefined) {
      template = singular;
    }
  }
  if (!vars) {
    return template;
  }
  return template.replace(PLACEHOLDER, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
