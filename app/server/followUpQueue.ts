import type { PrismaClient } from "@prisma/client";
import { enforcedValidUntil } from "./proposalExpiry.js";

export type FollowUpReasonRow = {
  code: string;
  kind: string;
  reviewState: string | null;
  label: string;
  baseWeight: number;
  unitWeight: number;
  thresholdDays: number | null;
  active: boolean;
  sortOrder: number;
};

export type FollowUpCandidate = {
  id: string;
  title: string;
  status: string;
  reviewState: string;
  organizationId: string | null;
  updatedAt: Date;
  validUntil: Date | null;
  parkedCount: number;
  meetingAt: Date | null;
};

export type FollowUpEntry = {
  proposalId: string;
  title: string;
  organizationId: string | null;
  status: string;
  reviewState: string;
  urgency: number;
  reasons: Array<{ code: string; label: string; score: number; units: number }>;
  updatedAt: string;
  validUntil: string | null;
  meetingAt: string | null;
  parkedCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pure: score each proposal from the reason rows, drop ones with no reason, most urgent first. */
export function buildFollowUpQueue(reasons: readonly FollowUpReasonRow[], proposals: readonly FollowUpCandidate[], now: Date): FollowUpEntry[] {
  const active = [...reasons].filter((reason) => reason.active).sort((left, right) => left.sortOrder - right.sortOrder);
  const entries: FollowUpEntry[] = [];
  for (const proposal of proposals) {
    if (proposal.status === "closed") continue;
    const matched: FollowUpEntry["reasons"] = [];
    for (const reason of active) {
      let units: number | null = null;
      if (reason.kind === "review_state" && reason.reviewState === proposal.reviewState) {
        units = Math.max(0, Math.floor((now.getTime() - proposal.updatedAt.getTime()) / DAY_MS));
      } else if (reason.kind === "near_expiry" && reason.thresholdDays !== null) {
        const deadline = enforcedValidUntil(proposal.validUntil);
        if (deadline) {
          const remaining = Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
          if (remaining <= reason.thresholdDays) units = reason.thresholdDays - Math.max(remaining, 0);
        }
      } else if (reason.kind === "parked_items" && proposal.parkedCount > 0) {
        units = proposal.parkedCount;
      }
      if (units === null) continue;
      matched.push({ code: reason.code, label: reason.label, score: reason.baseWeight + reason.unitWeight * units, units });
    }
    if (!matched.length) continue;
    entries.push({
      proposalId: proposal.id,
      title: proposal.title,
      organizationId: proposal.organizationId,
      status: proposal.status,
      reviewState: proposal.reviewState,
      urgency: matched.reduce((sum, reason) => sum + reason.score, 0),
      reasons: matched,
      updatedAt: proposal.updatedAt.toISOString(),
      validUntil: enforcedValidUntil(proposal.validUntil)?.toISOString() ?? null,
      meetingAt: proposal.meetingAt?.toISOString() ?? null,
      parkedCount: proposal.parkedCount,
    });
  }
  return entries.sort((left, right) => right.urgency - left.urgency || left.updatedAt.localeCompare(right.updatedAt));
}

/** Proposal.valid_until arrives with the expiry migration. Until then near_expiry reasons match nothing. */
async function validUntilById(prisma: PrismaClient): Promise<Map<string, Date | null>> {
  const present = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Proposal' AND column_name = 'valid_until') AS "present"`,
  );
  if (!present[0]?.present) return new Map();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; valid_until: Date | null }>>(`SELECT "id"::text AS "id", "valid_until" FROM "Proposal" WHERE "status" <> 'closed'`);
  return new Map(rows.map((row) => [row.id, row.valid_until]));
}

export async function loadFollowUpQueue(prisma: PrismaClient, options: { now?: Date; limit?: number } = {}): Promise<{ items: FollowUpEntry[]; reasons: FollowUpReasonRow[] }> {
  const now = options.now ?? new Date();
  const [reasons, proposals, intake, changes, validUntil] = await Promise.all([
    prisma.followUpReason.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.proposal.findMany({
      where: { status: { not: "closed" }, contracts: { none: {} } },
      select: { id: true, title: true, status: true, reviewState: true, organizationId: true, updatedAt: true, reviewMeeting: { select: { scheduledAt: true } } },
    }),
    prisma.proposalIntakePark.groupBy({ by: ["proposalId"], _count: { _all: true } }),
    prisma.proposalParkedChange.groupBy({ by: ["proposalId"], _count: { _all: true } }),
    validUntilById(prisma),
  ]);
  const parked = new Map<string, number>();
  for (const row of [...intake, ...changes]) parked.set(row.proposalId, (parked.get(row.proposalId) ?? 0) + row._count._all);
  const items = buildFollowUpQueue(reasons, proposals.map((proposal) => ({
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    reviewState: proposal.reviewState,
    organizationId: proposal.organizationId,
    updatedAt: proposal.updatedAt,
    validUntil: validUntil.get(proposal.id) ?? null,
    parkedCount: parked.get(proposal.id) ?? 0,
    meetingAt: proposal.reviewMeeting?.scheduledAt ?? null,
  })), now);
  return { items: items.slice(0, options.limit ?? 100), reasons };
}
