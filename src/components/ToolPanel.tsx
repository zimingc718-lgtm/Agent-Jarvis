"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/LanguageProvider";
import type { MessageKey } from "@/lib/i18n";

/**
 * 现在有哪些工具是活的（REQ-F-200 ③）。
 *
 * 工具按可用性动态注册（REQ-NF-008 ④）：没技能就没有技能工具，联网关掉就没有 `web_search`，
 * 归档目录没配就没有 `archive_insight`。此前这件事只有模型知道——用户既看不到系统一共有哪些
 * 能力，也看不到某一个这轮为什么不在。**看不见的能力等于不存在**，这正是本轮几个缺陷的共同
 * 形状。
 *
 * 所以未注册的也列出来并标明，而不是过滤掉：「没注册」和「不存在」对用户是两件事。
 */

export type ToolRow = {
  name: string;
  description: string;
  priority: number;
  registered: boolean;
};

export type ToolPanelValue = {
  tools: ToolRow[];
  context: {
    skillCount: number;
    webEnabled: boolean;
    searchConfigured: boolean;
    knowledgeCount: number;
    contextWindow: number;
    providerName: string | null;
  };
};

type ToolPanelProps = {
  /** 测试缝。 */
  load?: () => Promise<ToolPanelValue>;
};

async function loadFromApi(): Promise<ToolPanelValue> {
  const response = await fetch("/api/tools", { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`tools fetch failed (${response.status})`);
  }
  return (await response.json()) as ToolPanelValue;
}

const PRIORITY_LABEL: Record<number, MessageKey> = { 1: "tools.group.required", 2: "tools.group.general", 3: "tools.group.management" };

export function ToolPanel({ load = loadFromApi }: ToolPanelProps) {
  const t = useT();
  const [value, setValue] = useState<ToolPanelValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((next) => {
        if (!cancelled) {
          setValue(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(t("tools.loadFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (error) {
    return (
      <p className="tool-panel__error text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (!value) {
    return <p className="tool-panel__loading text-sm text-muted-foreground">{t("tools.loading")}</p>;
  }

  const live = value.tools.filter((tool) => tool.registered);
  const idle = value.tools.filter((tool) => !tool.registered);

  return (
    <div className="tool-panel flex flex-col gap-4">
      <p className="tool-panel__summary text-sm text-muted-foreground">
        {t("tools.summary", {
          live: live.length,
          idle: idle.length,
          skills: value.context.skillCount,
          knowledge: value.context.knowledgeCount,
          web: value.context.webEnabled ? t("tools.on") : t("tools.off"),
        })}
        {value.context.providerName ? t("tools.providerSuffix", { name: value.context.providerName }) : t("tools.noProvider")}
      </p>

      <section className="flex flex-col gap-1.5" aria-label={t("tools.availableAria")}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tools.available")}</h3>
        <ul className="flex flex-col gap-1">
          {live.map((tool) => (
            <li className="rounded-md border border-border px-3 py-2" key={tool.name}>
              <span className="flex items-baseline gap-2">
                <code className="text-sm font-medium">{tool.name}</code>
                <span className="text-xs text-muted-foreground">{t(PRIORITY_LABEL[tool.priority] ?? "tools.group.general")}</span>
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{tool.description}</span>
            </li>
          ))}
        </ul>
      </section>

      {idle.length > 0 ? (
        <section className="flex flex-col gap-1.5" aria-label={t("tools.unregisteredAria")}>
          {/* 列出来而不是滤掉：「没注册」和「不存在」是两件事。 */}
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("tools.unregistered")}
          </h3>
          <ul className="flex flex-col gap-1">
            {idle.map((tool) => (
              <li className="rounded-md border border-dashed border-border px-3 py-2 opacity-70" key={tool.name}>
                <code className="text-sm">{tool.name}</code>
                <span className="mt-0.5 block text-xs text-muted-foreground">{tool.description}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
