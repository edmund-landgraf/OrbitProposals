import type { PrismaClient } from "@prisma/client";
import { enforcedValidUntil } from "./proposalExpiry.js";

export type ReminderRuleRow = {
  code: string;
  kind: string;
  audience: string;
  thresholdDays: number;
  reviewStates: string[];
  label: string;
  messageTemplate: string;
  active: boolean;
  sortOrder: number;
};

export type ReminderCandidate = {
  id: string;
  title: string;
  status: string;
  reviewState: string;
  updatedAt: Date;
  validUntil: Date | null;
  hasContract: boolean;
};

export type DueReminder = {
  proposalId: string;
  ruleCode: string;
  audience: string;
  anchorKey: string;
  message: string;
  days: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function renderReminder(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}

/** Pure: which reminders are due now. anchorKey makes a run idempotent for the same deadline or state entry. */
export function dueReminders(rules: readonly ReminderRuleRow[], proposals: readonly ReminderCandidate[], now: Date): DueReminder[] {
  const due: DueReminder[] = [];
  const ordered = [...rules].filter((rule) => rule.active).sort((left, right) => left.sortOrder - right.sortOrder);
  for (const proposal of proposals) {
    if (proposal.status === "closed" || proposal.hasContract) continue;
    for (const rule of ordered) {
      if (rule.kind === "near_expiry") {
        const deadline = enforcedValidUntil(proposal.validUntil);
        if (!deadline) continue;
        const remainingMs = deadline.getTime() - now.getTime();
        if (remainingMs <= 0 || remainingMs > rule.thresholdDays * DAY_MS) continue;
        const days = Math.ceil(remainingMs / DAY_MS);
        due.push({ proposalId: proposal.id, ruleCode: rule.code, audience: rule.audience, anchorKey: `valid_until:${deadline.toISOString()}`, days, message: renderReminder(rule.messageTemplate, { title: proposal.title, days, state: proposal.reviewState }) });
      } else if (rule.kind === "state_age") {
        if (!rule.reviewStates.includes(proposal.reviewState)) continue;
        const ageMs = now.getTime() - proposal.updatedAt.getTime();
        if (ageMs < rule.thresholdDays * DAY_MS) continue;
        const days = Math.floor(ageMs / DAY_MS);
        due.push({ proposalId: proposal.id, ruleCode: rule.code, audience: rule.audience, anchorKey: `${proposal.reviewState}:${proposal.updatedAt.toISOString()}`, days, message: renderReminder(rule.messageTemplate, { title: proposal.title, days, state: proposal.reviewState }) });
      }
    }
  }
  return due;
}

/** Proposal.valid_until arrives with the expiry migration. Until then near_expiry rules find nothing. */
async function hasValidUntil(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ present: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Proposal' AND column_name = 'valid_until') AS "present"`,
  );
  return Boolean(rows[0]?.present);
}

export async function loadReminderCandidates(prisma: PrismaClient): Promise<ReminderCandidate[]> {
  const proposals = await prisma.proposal.findMany({
    where: { status: { not: "closed" } },
    select: { id: true, title: true, status: true, reviewState: true, updatedAt: true, _count: { select: { contracts: true } } },
  });
  const validUntil = new Map<string, Date | null>();
  if (proposals.length && await hasValidUntil(prisma)) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; valid_until: Date | null }>>(
      `SELECT "id"::text AS "id", "valid_until" FROM "Proposal" WHERE "status" <> 'closed'`,
    );
    for (const row of rows) validUntil.set(row.id, row.valid_until);
  }
  return proposals.map((proposal) => ({
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    reviewState: proposal.reviewState,
    updatedAt: proposal.updatedAt,
    validUntil: validUntil.get(proposal.id) ?? null,
    hasContract: proposal._count.contracts > 0,
  }));
}

export type ReminderRunResult = { due: number; queued: number; alreadyQueued: number; dryRun: boolean; items: DueReminder[] };

/** Computes due reminders and records new ones as queued. It never sends email. */
export async function runReminders(prisma: PrismaClient, options: { now?: Date; dryRun?: boolean } = {}): Promise<ReminderRunResult> {
  const now = options.now ?? new Date();
  const rules = await prisma.reminderRule.findMany({ where: { active: true } });
  const due = dueReminders(rules, await loadReminderCandidates(prisma), now);
  if (options.dryRun) return { due: due.length, queued: 0, alreadyQueued: 0, dryRun: true, items: due };
  const created = due.length
    ? await prisma.proposalReminder.createMany({ data: due.map((item) => ({ proposalId: item.proposalId, ruleCode: item.ruleCode, audience: item.audience, anchorKey: item.anchorKey, message: item.message })), skipDuplicates: true })
    : { count: 0 };
  return { due: due.length, queued: created.count, alreadyQueued: due.length - created.count, dryRun: false, items: due };
}
