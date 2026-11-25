// Pure scoring always runs. The database half runs when UNWH_DB_TEST=1 and DATABASE_URL are set.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { buildFollowUpQueue, loadFollowUpQueue, type FollowUpCandidate, type FollowUpReasonRow } from "../../server/followUpQueue.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";

const now = new Date("2026-10-23T12:00:00.000Z");
const days = (count: number) => new Date(now.getTime() + count * 86_400_000);
const reasons: FollowUpReasonRow[] = [
  { code: "in_review", kind: "review_state", reviewState: "in_review", label: "Review", baseWeight: 50, unitWeight: 10, thresholdDays: null, active: true, sortOrder: 10 },
  { code: "changes_requested", kind: "review_state", reviewState: "changes_requested", label: "Changes", baseWeight: 20, unitWeight: 3, thresholdDays: null, active: true, sortOrder: 20 },
  { code: "near_expiry", kind: "near_expiry", reviewState: null, label: "Expiring", baseWeight: 40, unitWeight: 8, thresholdDays: 7, active: true, sortOrder: 30 },
  { code: "parked_items", kind: "parked_items", reviewState: null, label: "Parked", baseWeight: 10, unitWeight: 5, thresholdDays: null, active: true, sortOrder: 40 },
];
const candidate = (overrides: Partial<FollowUpCandidate>): FollowUpCandidate => ({ id: randomUUID(), title: "P", status: "pending_approval", reviewState: "draft", organizationId: null, updatedAt: now, validUntil: null, parkedCount: 0, meetingAt: null, ...overrides });

test("queue scores reasons from rows and sorts by urgency", () => {
  const review = candidate({ reviewState: "in_review", updatedAt: days(-2) });
  const changes = candidate({ reviewState: "changes_requested", updatedAt: days(-1) });
  const expiring = candidate({ validUntil: days(2), parkedCount: 2 });
  const quiet = candidate({});
  const closed = candidate({ status: "closed", reviewState: "in_review" });
  const queue = buildFollowUpQueue(reasons, [quiet, changes, expiring, review, closed], now);
  assert.deepEqual(queue.map((entry) => entry.proposalId), [review.id, changes.id, expiring.id]);
  assert.equal(queue[0]?.urgency, 70);
  assert.equal(queue[1]?.urgency, 23);
  assert.equal(queue[2]?.urgency, 10 + 5 * 2);
  assert.deepEqual(queue[2]?.reasons.map((reason) => reason.code), ["parked_items"]);
  assert.equal(queue[2]?.validUntil, null);
});

test("inactive reasons are ignored", () => {
  const off = reasons.map((reason) => ({ ...reason, active: reason.code !== "in_review" }));
  assert.equal(buildFollowUpQueue(off, [candidate({ reviewState: "in_review" })], now).length, 0);
});

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;

test("in_review proposals and parked items show up on the queue", { skip: !url && "set UNWH_DB_TEST=1 and DATABASE_URL" }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `queue-${randomUUID()}@test.invalid`, displayName: "Queue test" } });
  const base = { ownerId: owner.id, engagement: "capped_hours_4" as const, pricingModel: "capped_hours" as const, scope: { summary: "Map it.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, currency: "USD" } };
  const review = await prisma.proposal.create({ data: { ...base, title: "Queue review", reviewState: "in_review", status: "pending_approval" } });
  const parked = await prisma.proposal.create({ data: { ...base, title: "Queue parked" } });
  try {
    await prisma.proposalIntakePark.create({ data: { proposalId: parked.id, summary: "Later" } });
    const { items } = await loadFollowUpQueue(prisma, { limit: 500 });
    const reviewEntry = items.find((item) => item.proposalId === review.id);
    const parkedEntry = items.find((item) => item.proposalId === parked.id);
    assert.ok(reviewEntry?.reasons.some((reason) => reason.code === "in_review"));
    assert.equal(parkedEntry?.parkedCount, 1);
    assert.ok(parkedEntry?.reasons.some((reason) => reason.code === "parked_items"));
    assert.ok(items.indexOf(reviewEntry!) < items.indexOf(parkedEntry!));
  } finally {
    await deleteProposalCascade(prisma, review.id);
    await deleteProposalCascade(prisma, parked.id);
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});
