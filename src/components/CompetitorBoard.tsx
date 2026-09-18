"use client";

import { useEffect, useState } from "react";

/**
 * 友商看板（CR-20260918-competitor-board，REQ-F-243）。
 *
 * 对比维度取自各友商已登记的 `params`（看板的技术脊梁，见 `entities.ts`）——不新起一份
 * 数据模型，直接读已有的。逐维度评价**不落库**：评价是判断而不是事实，落库意味着要给出
 * 「谁来判断、什么时候过期」的答案；把它交给对话现场回答，模型有 `list_entities`/
 * `read_entity` 就能看到这张表背后的同一份数据，用户想要的评价永远是问出来的最新一次。
 */

export type CompetitorParam = { name: string; value: string };
export type CompetitorEntity = { name: string; title: string; params: CompetitorParam[] };
export type CompetitorBoardData = { competitors: CompetitorEntity[] };

type CompetitorBoardProps = {
  /** 测试缝。 */
  load?: () => Promise<CompetitorBoardData>;
};

type RawEntity = { kind?: string; name?: string; title?: string; params?: CompetitorParam[] };

async function defaultLoad(): Promise<CompetitorBoardData> {
  const response = await fetch("/api/entities", { headers: { accept: "application/json" } });
  if (!response.ok) {
    return { competitors: [] };
  }
  const data = (await response.json().catch(() => ({}))) as { entities?: RawEntity[] };
  const competitors = (data.entities ?? [])
    .filter((entity): entity is Required<RawEntity> => entity.kind === "competitor" && !!entity.name)
    .map((entity) => ({ name: entity.name, title: entity.title || entity.name, params: entity.params ?? [] }));
  return { competitors };
}

export function CompetitorBoard({ load = defaultLoad }: CompetitorBoardProps) {
  const [data, setData] = useState<CompetitorBoardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("读不到友商数据。服务可能正在重启，稍后再打开一次。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (error) {
    return (
      <p className="competitor-board__error text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p className="competitor-board__loading text-sm text-muted-foreground">正在读取友商数据…</p>;
  }
  if (data.competitors.length === 0) {
    return <p className="competitor-board__empty text-sm text-muted-foreground">还没有登记友商——先在知识看板新增一个。</p>;
  }

  // 维度 = 各友商已登记参数名的并集，按首次出现的顺序——和看板本身「参数不重排」同一条道理。
  const dimensions: string[] = [];
  for (const competitor of data.competitors) {
    for (const param of competitor.params) {
      if (!dimensions.includes(param.name)) {
        dimensions.push(param.name);
      }
    }
  }

  return (
    <section aria-label="友商看板" className="competitor-board flex flex-col gap-3 p-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">友商看板</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          对比维度取自各友商已登记的技术参数。逐维度的评价请直接在对话里问——现场给出的判断，不写死在表格里。
        </p>
      </div>
      {dimensions.length === 0 ? (
        <p className="competitor-board__no-params text-sm text-muted-foreground">
          这些友商还没有登记任何技术参数，可以在知识看板里补充，或让 Jarvis 从已入库的材料里抽。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground">维度</th>
                {data.competitors.map((competitor) => (
                  <th className="border-b border-border px-3 py-2 text-left font-medium" key={competitor.name}>
                    {competitor.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dimension) => (
                <tr key={dimension}>
                  <td className="border-b border-border px-3 py-2 font-medium text-muted-foreground">{dimension}</td>
                  {data.competitors.map((competitor) => {
                    const param = competitor.params.find((candidate) => candidate.name === dimension);
                    return (
                      <td className="border-b border-border px-3 py-2" key={competitor.name}>
                        {param?.value || "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
