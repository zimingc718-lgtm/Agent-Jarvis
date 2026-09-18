"use client";

import { useEffect, useState } from "react";

/**
 * 行业技术指标对比（CR-20260918-industry-spec-comparison，REQ-F-250）。
 *
 * 与 `CompetitorBoard`（CR-20260918-competitor-board）同一条道理——对比维度取自
 * `entities.ts` 的既有 `params` 字段，不新起数据模型。区别只在覆盖范围：友商看板只筛
 * `kind === "competitor"`，这一页覆盖全部三类跟踪对象（友商/规则与准入方/客户），因为
 * 用户原话把三者的技术指标一起点名要移出各自卡片、合并到这一页（INPUT-2026-09-18-001
 * 第 1 条），且明确确认要包含客户（INPUT-2026-09-18-002 答复 2）。规则与准入方的
 * `params` 是门槛式要求（如并网标准的 LVRT 时长），客户的 `params` 是其技术准入要求，
 * 友商的 `params` 是产品规格——三者的「值」在同一行对齐比较，正是「行业」二字的含义：
 * 不止友商之间比，还包括门槛要求与友商规格摆在一起看。
 *
 * `Param.status`（是否满足）本次不显示——那是「我们是否满足」的既有字段，不是本页要做
 * 的「不同来源的数值互相对比」，混进来是另一个问题，見 CR 文档「非目标」。
 */

export type SpecParam = { name: string; value: string };
export type SpecEntityKind = "competitor" | "authority" | "customer";
export type SpecEntity = { name: string; title: string; kind: SpecEntityKind; params: SpecParam[] };
export type IndustrySpecComparisonData = { entities: SpecEntity[] };

const KIND_LABEL: Record<SpecEntityKind, string> = {
  competitor: "友商",
  authority: "规则与准入方",
  customer: "客户",
};

type IndustrySpecComparisonProps = {
  /** 测试缝。 */
  load?: () => Promise<IndustrySpecComparisonData>;
};

type RawEntity = { kind?: string; name?: string; title?: string; params?: SpecParam[] };

function isSpecKind(value: string | undefined): value is SpecEntityKind {
  return value === "competitor" || value === "authority" || value === "customer";
}

async function defaultLoad(): Promise<IndustrySpecComparisonData> {
  const response = await fetch("/api/entities", { headers: { accept: "application/json" } });
  if (!response.ok) {
    return { entities: [] };
  }
  const data = (await response.json().catch(() => ({}))) as { entities?: RawEntity[] };
  const entities = (data.entities ?? [])
    .filter((entity): entity is RawEntity & { name: string; kind: SpecEntityKind } => isSpecKind(entity.kind) && !!entity.name)
    .map((entity) => ({ name: entity.name, title: entity.title || entity.name, kind: entity.kind, params: entity.params ?? [] }));
  return { entities };
}

export function IndustrySpecComparison({ load = defaultLoad }: IndustrySpecComparisonProps) {
  const [data, setData] = useState<IndustrySpecComparisonData | null>(null);
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
          setError("读不到行业指标数据。服务可能正在重启，稍后再打开一次。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (error) {
    return (
      <p className="industry-spec-comparison__error text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p className="industry-spec-comparison__loading text-sm text-muted-foreground">正在读取行业指标数据…</p>;
  }
  if (data.entities.length === 0) {
    return (
      <p className="industry-spec-comparison__empty text-sm text-muted-foreground">
        还没有登记友商、规则与准入方或客户——先在知识看板新增一个。
      </p>
    );
  }

  // 维度 = 全部对象已登记参数名的并集，按首次出现的顺序——和友商看板、看板本身同一条道理。
  const dimensions: string[] = [];
  for (const entity of data.entities) {
    for (const param of entity.params) {
      if (!dimensions.includes(param.name)) {
        dimensions.push(param.name);
      }
    }
  }

  return (
    <section aria-label="行业技术指标对比" className="industry-spec-comparison flex flex-col gap-3 p-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">行业技术指标对比</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          对比维度取自友商、规则与准入方、客户三类跟踪对象已登记的技术参数——门槛要求与产品规格摆在同一行对齐比较。
        </p>
      </div>
      {dimensions.length === 0 ? (
        <p className="industry-spec-comparison__no-params text-sm text-muted-foreground">
          这些对象还没有登记任何技术参数，可以在知识看板里补充，或让 Jarvis 从已入库的材料里抽。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-border px-3 py-2 text-left font-medium text-muted-foreground">维度</th>
                {data.entities.map((entity) => (
                  <th className="border-b border-border px-3 py-2 text-left font-medium" key={entity.name}>
                    <div>{entity.title}</div>
                    <div className="text-[10px] font-normal text-muted-foreground">{KIND_LABEL[entity.kind]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dimensions.map((dimension) => (
                <tr key={dimension}>
                  <td className="border-b border-border px-3 py-2 font-medium text-muted-foreground">{dimension}</td>
                  {data.entities.map((entity) => {
                    const param = entity.params.find((candidate) => candidate.name === dimension);
                    return (
                      <td className="border-b border-border px-3 py-2" key={entity.name}>
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
