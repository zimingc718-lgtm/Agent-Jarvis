"use client";

import { useEffect, useState } from "react";

/**
 * 组织架构 / 研发阵型看板（CR-20260918-org-chart-board，REQ-F-260）。
 *
 * 人员数据是对象（公司）的一个字段（`entities.ts` 的 `people: Person[]`），跟 `params`
 * 同一条道理——维谛这样的公司已经作为 `competitor` 实体存在，人只在某家公司的语境下才有
 * 意义，没有必要另起一份跨公司的「人物库」。头像是外链 URL，不在本地存字节（DEC-370）：
 * 组织架构本身已经是这批需求里第二大的一项，头像托管是另一层不小的基础设施，等真的需要
 * 「源链接会失效」这个问题时再单独考虑。
 */

export type Person = { name: string; title: string; team: string; avatarUrl: string; bio: string };
export type OrgChartEntity = { name: string; title: string; kind?: string; people: Person[] };
export type OrgChartBoardData = { companies: OrgChartEntity[] };

type OrgChartBoardProps = {
  /** 测试缝。 */
  load?: () => Promise<OrgChartBoardData>;
};

type RawEntity = { kind?: string; name?: string; title?: string; people?: Person[] };

async function defaultLoad(): Promise<OrgChartBoardData> {
  const response = await fetch("/api/entities", { headers: { accept: "application/json" } });
  if (!response.ok) {
    return { companies: [] };
  }
  const data = (await response.json().catch(() => ({}))) as { entities?: RawEntity[] };
  const companies = (data.entities ?? [])
    .filter((entity): entity is Required<Pick<RawEntity, "name" | "title">> & RawEntity => !!entity.name && (entity.people?.length ?? 0) > 0)
    .map((entity) => ({ name: entity.name, title: entity.title || entity.name, kind: entity.kind, people: entity.people ?? [] }));
  return { companies };
}

/** 没有头像，或头像加载失败时的兜底——姓名首字，跟真实头像同样大小，不留一个破图标。 */
function AvatarFallback({ name }: { name: string }) {
  return (
    <div
      className="org-chart-board__avatar-fallback flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground"
      aria-hidden="true"
    >
      {name.slice(0, 1)}
    </div>
  );
}

function PersonAvatar({ person }: { person: Person }) {
  const [failed, setFailed] = useState(false);
  if (!person.avatarUrl || failed) {
    return <AvatarFallback name={person.name} />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- external, unmoderated URLs; next/image's remote-pattern allowlist doesn't fit a user-supplied source per person.
  return (
    <img
      src={person.avatarUrl}
      alt=""
      className="org-chart-board__avatar h-10 w-10 shrink-0 rounded-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

function PersonCard({ person }: { person: Person }) {
  return (
    <li className="org-chart-board__person flex items-start gap-3 rounded border border-border p-3">
      <PersonAvatar person={person} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {person.name}
          <span className="ml-2 font-normal text-muted-foreground">{person.title}</span>
        </p>
        {person.bio ? <p className="mt-0.5 text-xs text-muted-foreground">{person.bio}</p> : null}
      </div>
    </li>
  );
}

function CompanySection({ company }: { company: OrgChartEntity }) {
  // 按团队/阵型分组，未标团队的归入「其他」；组的先后顺序是人员首次出现的顺序，跟看板
  // 「参数不重排」同一条道理——今天看到的顺序，明天还应该在那。
  const groups: { team: string; people: Person[] }[] = [];
  for (const person of company.people) {
    const team = person.team || "其他";
    const group = groups.find((g) => g.team === team);
    if (group) {
      group.people.push(person);
    } else {
      groups.push({ team, people: [person] });
    }
  }
  return (
    <section className="org-chart-board__company flex flex-col gap-3" aria-label={`${company.title} 组织架构`}>
      <h3 className="text-base font-semibold tracking-tight">{company.title}</h3>
      {groups.map((group) => (
        <div key={group.team} className="org-chart-board__team">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.team}</p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.people.map((person) => (
              <PersonCard key={person.name} person={person} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export function OrgChartBoard({ load = defaultLoad }: OrgChartBoardProps) {
  const [data, setData] = useState<OrgChartBoardData | null>(null);
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
          setError("读不到组织架构数据。服务可能正在重启，稍后再打开一次。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (error) {
    return (
      <p className="org-chart-board__error text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (!data) {
    return <p className="org-chart-board__loading text-sm text-muted-foreground">正在读取组织架构数据…</p>;
  }
  if (data.companies.length === 0) {
    return (
      <p className="org-chart-board__empty text-sm text-muted-foreground">
        还没有登记任何组织架构信息——可以直接在对话里说「帮我查一下维谛的组织架构」，我会带来源登记人员。
      </p>
    );
  }

  return (
    <div aria-label="组织架构/研发阵型看板" className="org-chart-board flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">组织架构/研发阵型看板</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          按公司分区，同一公司内按团队/阵型分组。每个人的信息都带来源链接——没有来源不会出现在这里。
        </p>
      </div>
      {data.companies.map((company) => (
        <CompanySection key={company.name} company={company} />
      ))}
    </div>
  );
}
