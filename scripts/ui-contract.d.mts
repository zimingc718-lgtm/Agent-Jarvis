export type UiContractResult = {
  group: string;
  id: string;
  ref: string;
  req: string | null;
  title: string;
  guidance: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
};

export const CONTRACT: Array<{ group: string; rules: unknown[] }>;
export function runStatic(): UiContractResult[];
export function runLive(url: string): Promise<Array<Partial<UiContractResult> & { id: string; status: string }>>;
export function buildContext(): unknown;
