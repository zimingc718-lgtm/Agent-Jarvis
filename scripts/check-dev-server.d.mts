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

/** 服务器供的那份产物是从哪个提交构建出来的，与磁盘上的 HEAD 比对（DEC-210 ①）。 */
export type BuildAnalysis =
  /** 页面根本没有版本戳：那台服务器比这套机制还老。 */
  | { state: "absent" }
  /** 戳是空的——起服务器的地方没有 git。不伪装成通过。 */
  | { state: "unknown" }
  /** 这里读不到 HEAD，没有可比的对象。 */
  | { state: "no-head"; served: string }
  | { state: "current" | "stale"; served: string; head: string };

export function analyseCss(css: string): CssAnalysis;
export function describe(result: CssAnalysis): string;
export function analyseBuild(html: string, headSha: string): BuildAnalysis;
export function describeBuild(result: BuildAnalysis): string;
