/** Types for the module dependency graph checker, consumed by tests. */

export type ImportEdgeKind = "import" | "import-bare" | "import-dynamic" | "export-from";

export type RawImport = {
  specifier: string;
  typeOnly: boolean;
  kind: ImportEdgeKind;
};

export type ModuleEdge = {
  /** Project-relative POSIX path of the importing file, e.g. `"src/lib/chat.ts"`. */
  from: string;
  /** The specifier exactly as written in source. */
  specifier: string;
  /** Project-relative POSIX path of the resolved target, or `null` for an external
   * (npm package / `node:*` builtin / unresolved) specifier. */
  to: string | null;
  typeOnly: boolean;
  kind: ImportEdgeKind;
};

export type ModuleGraph = {
  root: string;
  /** Every scanned file, project-relative POSIX paths, sorted. */
  files: string[];
  edges: ModuleEdge[];
};

export type CycleResult = {
  ok: boolean;
  /** Each cycle as a path of files, first element repeated as the last. */
  cycles: string[][];
};

export type LayeringViolation = {
  from: string;
  to: string;
  rule: "lib-must-not-import-components-or-app" | "new-lib-to-tools-edge";
};

export type LayeringResult = {
  ok: boolean;
  violations: LayeringViolation[];
};

export type ClosureViolation = {
  /** The `src/components/**` file the BFS started from. */
  component: string;
  /** component -> ... -> file -> dangerous target (a resolved path or a `node:*` /
   * `"<file> (imports node:sqlite)"` label). */
  path: string[];
};

export type ClosureResult = {
  ok: boolean;
  violations: ClosureViolation[];
};

export type ModuleGraphChecks = {
  graph: ModuleGraph;
  filesScanned: number;
  cycles: CycleResult;
  layering: LayeringResult;
  closure: ClosureResult;
};

export function listSourceFiles(root: string): string[];
export function maskCommentsAndStrings(source: string): string;
export function extractImports(source: string): RawImport[];
export function resolveSpecifier(specifier: string, fromRelPath: string, root: string): string | null;
export function buildModuleGraph(root: string): ModuleGraph;
export function checkCycles(graph: ModuleGraph): CycleResult;
export function checkLayering(graph: ModuleGraph): LayeringResult;
export function checkClientServerClosure(graph: ModuleGraph): ClosureResult;
export function runChecks(root: string): ModuleGraphChecks;
export function formatReport(result: ModuleGraphChecks): { lines: string[]; ok: boolean };

export const LIB_TO_TOOLS_KNOWN_EXCEPTIONS: ReadonlyArray<{ readonly from: string; readonly to: string }>;
