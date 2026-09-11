import { getServerSession } from "next-auth";
import { ConfigWarning } from "@/components/ConfigWarning";
import { FloatingChat, type FloatingMessage } from "@/components/FloatingChat";
import { KnowledgeDashboard, type DashboardData, type OverviewData } from "@/components/KnowledgeDashboard";
import { authOptions } from "@/lib/auth";
import { requireUserId } from "@/lib/auth-guard";
import { countByEntity, KNOWLEDGE_ROOT, listKnowledge, listSearchMisses } from "@/lib/knowledge";
import { ENTITIES_ROOT, listEntities, listPendingEntities } from "@/lib/entities";
import { listProposals } from "@/lib/entity-proposals";
import { STORAGE_CONFIG_HINT, getStorageConfig } from "@/lib/runtime-config";
import { buildTranscript } from "@/lib/transcript";
import { getStore } from "@/lib/store-singleton";

/**
 * Interim entry for the knowledge board (CR-20260911-home-dashboard).
 *
 * The board's real home is a state of the display screen: title with its animation,
 * then the board once work starts. That wiring is held by CR-20260911-display-console-ux,
 * which is rewriting `DisplayScreen.tsx`, `page.tsx` and the hover behaviour this
 * transition has to share — so it is an exit obligation, not something to fork.
 *
 * Until then this route mounts the same component with the same floating chat over it,
 * so the whole loop is usable and reviewable: ask Jarvis to propose an entity, watch it
 * land in the pending queue, adopt it, see the card appear. When the display screen gains
 * its third state this file goes away.
 */
export default async function DashboardPage() {
  const auth = requireUserId(await getServerSession(authOptions));
  const storage = getStorageConfig();
  const storeReady = auth.ok && storage.configured;

  const board: DashboardData = storeReady
    ? {
        entities: await listEntities(ENTITIES_ROOT),
        pending: await listPendingEntities(ENTITIES_ROOT),
        proposals: await listProposals(ENTITIES_ROOT),
      }
    : { entities: [], pending: [], proposals: [] };

  let overview: OverviewData = { total: 0, byEntity: {}, byType: {}, unowned: 0, misses: [] };
  if (storeReady) {
    const [entries, byEntity, misses] = await Promise.all([
      listKnowledge(KNOWLEDGE_ROOT),
      countByEntity(KNOWLEDGE_ROOT),
      listSearchMisses(KNOWLEDGE_ROOT),
    ]);
    const byType: Record<string, number> = {};
    for (const entry of entries) {
      const key = entry.docType || "未分类";
      byType[key] = (byType[key] ?? 0) + 1;
    }
    overview = { total: entries.length, byEntity, byType, unowned: byEntity[""] ?? 0, misses: misses.slice(0, 8) };
  }

  const savedProviders = storeReady ? getStore().listProviders(auth.userId) : [];
  const hasEnabledProvider = savedProviders.some((provider) => provider.enabled);

  let initialConversationId: string | null = null;
  let initialMessages: FloatingMessage[] = [];
  if (storeReady) {
    const [recent] = getStore().listRecentConversations(auth.userId);
    if (recent) {
      initialConversationId = recent.id;
      initialMessages = buildTranscript(getStore().listMessages(recent.id));
    }
  }

  return (
    <main className="dashboard-page relative min-h-screen bg-background text-foreground">
      {auth.ok && !storage.configured ? (
        <div className="mx-auto max-w-3xl px-6 pt-8">
          <ConfigWarning title="本地存储未配置" missing={storage.missing} hint={STORAGE_CONFIG_HINT} />
        </div>
      ) : null}

      {/* pb-36 keeps the last row clear of the fixed bottom console. */}
      <div className="pb-36">
        <KnowledgeDashboard initialData={board} initialOverview={overview} />
      </div>

      {storeReady ? (
        <FloatingChat
          hasEnabledProvider={hasEnabledProvider}
          initialConversationId={initialConversationId}
          initialMessages={initialMessages}
        />
      ) : null}
    </main>
  );
}
