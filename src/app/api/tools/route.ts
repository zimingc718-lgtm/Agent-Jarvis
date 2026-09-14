import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";
import { buildRegistry } from "@/lib/chat";
import { readWebSettings } from "@/lib/tools/web-tools";
import { KNOWLEDGE_ROOT, listKnowledge } from "@/lib/knowledge";
import { contextWindowFor } from "@/lib/tools/budget";
import type { ToolContext } from "@/lib/tools/registry";

/**
 * 现在到底有哪些工具是活的（REQ-F-200 ③）。
 *
 * 工具是**按可用性动态注册**的（REQ-NF-008 ④）：没技能就没有技能工具，联网关掉就没有
 * `web_search`，归档目录没配就没有 `archive_insight`。此前这件事只有模型知道——用户既看
 * 不到有哪些工具，也看不到某个工具为什么这轮不在。这条路由把同一份判定如实报出来。
 *
 * 判定与 `runChatTurn` 用的是**同一个 `buildRegistry` 与同一份 `ToolContext`**，不另写一份
 * 近似逻辑：两份判定迟早会分岔，而分岔的那天用户看到的就是一份假名单。
 */
export async function GET() {
  const auth = requireUserId(await getServerSession(authOptions));
  if (!auth.ok) {
    return NextResponse.json({ message: auth.message }, { status: auth.status });
  }

  const unavailable = storageUnavailable();
  if (unavailable) {
    return unavailable;
  }

  const store = getStore();
  const web = readWebSettings(store);
  const skills = store.listSkills(auth.userId);
  const knowledgeCount = (await listKnowledge(KNOWLEDGE_ROOT)).length;
  const provider = store.resolveActiveProvider(auth.userId);
  const contextWindow = provider
    ? contextWindowFor({ kind: provider.kind, contextWindow: provider.contextWindow })
    : 128_000;

  const context: ToolContext = {
    userId: auth.userId,
    conversationId: "",
    skillCount: skills.length,
    webEnabled: web.enabled,
    searchConfigured: Boolean(web.baseUrl),
    knowledgeCount,
    contextWindow,
  };

  const registry = buildRegistry(store);
  const live = new Set(registry.availableFor(context).map((tool) => tool.name));

  return NextResponse.json({
    // 未注册的也列出来，并说清它在等什么——「看不见」和「不存在」是两回事。
    tools: registry.all().map((tool) => ({
      name: tool.name,
      description: tool.description,
      priority: tool.priority,
      registered: live.has(tool.name),
    })),
    context: {
      skillCount: context.skillCount,
      webEnabled: context.webEnabled,
      searchConfigured: context.searchConfigured,
      knowledgeCount: context.knowledgeCount,
      contextWindow: context.contextWindow,
      providerName: provider?.name ?? null,
    },
  });
}
