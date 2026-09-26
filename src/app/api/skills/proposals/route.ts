import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { storageUnavailable } from "@/lib/api-guard";
import { requireUserId } from "@/lib/auth-guard";
import { getStore } from "@/lib/store-singleton";

/**
 * Skills the model proposed and the user has not decided on yet (REQ-F-320 ①, DEC-430 ②;
 * CR-20260925-write-approval-action-log). Read by ☰「技能」's 待确认 section; the decision
 * itself is `POST`/`DELETE /api/skills/proposals/[id]`.
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
  const proposals = getStore()
    .listPendingSkillProposals(auth.userId)
    .map((proposal) => ({
      id: proposal.id,
      name: proposal.name,
      description: proposal.description,
      conversationId: proposal.conversationId,
      createdAt: proposal.createdAt,
    }));
  return NextResponse.json({ proposals });
}
