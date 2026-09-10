/** Types for the dev-server consistency checker (TASK-057), consumed by tests. */

export type CssAnalysis = {
  /** True when the served CSS carries compiled Tailwind output. */
  ok: boolean;
  /** Human-readable names of the markers that were absent. */
  missing: string[];
  /** True when raw Tailwind directives survived, i.e. the PostCSS plugin never ran. */
  unprocessed: boolean;
  bytes: number;
};

export function analyseCss(css: string): CssAnalysis;
export function describe(result: CssAnalysis): string;
