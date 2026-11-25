// Pure reminder rules always run. The database half runs when UNWH_DB_TEST=1 and DATABASE_URL are set.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { dueReminders, renderReminder, runReminders, type ReminderCandidate, type ReminderRuleRow } from "../../server/proposalReminders.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";

const now = new Date("2026-10-23T12:00:00.000Z");
const days = (count: number) => new Date(now.getTime() + count * 86_400_000);
const rules: ReminderRuleRow[] = [
  { code: "near_expiry", kind: "near_expiry", audience: "client", thresholdDays: 7, reviewStates: [], label: "Expires", messageTemplate: "{title} expires in {days} days.", active: true, sortOrder: 10 },
  { code: "stalled", kind: "state_age", audience: "staff", thresholdDays: 3, reviewStates: ["in_review"], label: "Stalled", messageTemplate: "{title} in {state} for {days} days.", active: true, sortOrder: 20 },
  { code: "off", kind: "state_age", audience: "staff", thresholdDays: 0, reviewStates: ["in_review"], label: "Off", messageTemplate: "x", active: false, sortOrder: 30 },
];
const proposal = (overrides: Partial<ReminderCandidate>): ReminderCandidate => ({ id: randomUUID(), title: "P", status: "pending_approval", reviewState: "in_review", updatedAt: now, validUntil: null, hasContract: false, ...overrides });

test("templates fill placeholders and leave unknown ones", () => {
  assert.equal(renderReminder("{title} in {days} {nope}", { title: "A", days: 2 }), "A in 2 {nope}");
});

test("due reminders follow the rule rows", () => {
  const nearing = proposal({ validUntil: days(3) });
  const far = proposal({ validUntil: days(30) });
  const expired = proposal({ validUntil: days(-1) });
  const stalled = proposal({ updatedAt: days(-4) });
  const fresh = proposal({ updatedAt: days(-1) });
  const closed = proposal({ status: "closed", updatedAt: days(-10) });
  const contracted = proposal({ hasContract: true, updatedAt: days(-10) });
  const due = dueReminders(rules, [nearing, far, expired, stalled, fresh, closed, contracted], now);
  assert.deepEqual(due.map((item) => [item.proposalId, item.ruleCode]), [[stalled.id, "stalled"]]);
  assert.equal(due.some((item) => item.ruleCode === "near_expiry"), false);
  assert.equal(due[0]?.message, "P in in_review for 4 days.");
  assert.equal(due[0]?.audience, "staff");
});

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;

test("a run queues stalled proposals once and never sends", { skip: !url && "set UNWH_DB_TEST=1 and DATABASE_URL" }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `reminder-${randomUUID()}@test.invalid`, displayName: "Reminder test" } });
  const created = await prisma.proposal.create({ data: {
    ownerId: owner.id, title: "Stalled", engagement: "capped_hours_4", pricingModel: "capped_hours", reviewState: "in_review", status: "pending_approval",
    scope: { summary: "Map it.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, currency: "USD" },
  } });
  try {
    const rule = await prisma.reminderRule.findUniqueOrThrow({ where: { code: "stalled_in_review" } });
    const later = new Date(created.updatedAt.getTime() + (rule.thresholdDays + 1) * 86_400_000);
    const dry = await runReminders(prisma, { now: later, dryRun: true });
    assert.ok(dry.items.some((item) => item.proposalId === created.id && item.ruleCode === "stalled_in_review"));
    assert.equal(await prisma.proposalReminder.count({ where: { proposalId: created.id } }), 0);
    await runReminders(prisma, { now: later });
    await runReminders(prisma, { now: later });
    const stored = await prisma.proposalReminder.findMany({ where: { proposalId: created.id, ruleCode: "stalled_in_review" } });
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.status, "queued");
    assert.equal(stored[0]?.sentAt, null);
  } finally {
    await deleteProposalCascade(prisma, created.id);
    assert.equal(await prisma.proposalReminder.count({ where: { proposalId: created.id } }), 0);
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});
