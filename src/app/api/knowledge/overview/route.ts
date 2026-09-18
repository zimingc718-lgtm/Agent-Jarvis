import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { countByEntity, listKnowledge, listSearchMisses } from "@/lib/knowledge";
import { resolveUserDataRoots } from "@/lib/user-data-paths";

/**
 * What the board's lower half needs (CR-20260911-home-dashboard).
 *
 * Three numbers and one list: how many entries per entity, how many per document type,
 * how many belong to nobody, and which searches came back empty. The misses are the
 * demand-side gap signal; the type counts are the supply-side one.
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

  const { knowledgeRoot } = await resolveUserDataRoots(auth.userId);
  const [entries, byEntity, misses] = await Promise.all([
    listKnowledge(knowledgeRoot),
    countByEntity(knowledgeRoot),
    listSearchMisses(knowledgeRoot),
  ]);

  const byType: Record<string, number> = {};
  for (const entry of entries) {
    const key = entry.docType || "未分类";
    byType[key] = (byType[key] ?? 0) + 1;
  }

  return NextResponse.json({
    total: entries.length,
    // "" is the unowned bucket; the client shows it by name rather than dropping it.
    byEntity,
    byType,
    unowned: byEntity[""] ?? 0,
    misses: misses.slice(0, 8),
  });
}
