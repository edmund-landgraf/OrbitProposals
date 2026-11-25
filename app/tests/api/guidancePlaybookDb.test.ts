// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

test("guidance playbook seed rows are present", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  try {
    assert.ok((await prisma.guidanceSignalDef.count()) >= 7);
    const moves = (await prisma.guidanceMove.findMany()).map((m) => m.key);
    for (const k of ["explain_drop", "offer_park", "offer_swap", "ask_priority", "mark_unsure", "recommend_handoff", "offer_tickler", "summarize_progress"]) assert.ok(moves.includes(k), k);
    const codes = (await prisma.guidanceOutcomeCode.findMany()).map((c) => c.code).sort();
    assert.deepEqual(codes, ["abandoned", "accepted", "handoff", "parked", "resolved", "submitted"]);
    const rules = await prisma.guidanceRule.findMany();
    assert.ok(rules.length >= 8);
    const signals = new Set((await prisma.guidanceSignalDef.findMany()).map((s) => s.key));
    for (const r of rules) {
      assert.ok(moves.includes(r.suggestedMove));
      const cond = r.condition as { all: Array<{ signal: string }> };
      for (const c of cond.all) assert.ok(signals.has(c.signal), `${r.key} uses unknown signal ${c.signal}`);
    }
  } finally {
    await prisma.$disconnect();
  }
});

test("guidance event, outcome, score, and feedback insert and cascade with the proposal", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `guidance-${randomUUID()}@test.invalid`, displayName: "Guidance" } });
  try {
    const proposal = await prisma.proposal.create({ data: {
      ownerId: owner.id, title: "Guidance", engagement: "capped_hours_4", pricingModel: "capped_hours",
      scope: { summary: "Test" }, timeline: {}, pricing: { model: "capped_hours", hours: 4, amountMinor: 80000, currency: "USD" },
    } });
    const rule = await prisma.guidanceRule.findUniqueOrThrow({ where: { key: "stuck_handoff" } });
    const sessionId = randomUUID();
    const event = await prisma.guidanceSessionEvent.create({ data: {
      proposalId: proposal.id, sessionId, turnIndex: 6, signals: { turns_without_progress: 6 },
      firedRuleIds: [rule.id], chosenMove: "recommend_handoff", actionTaken: "unw_recommend_handoff", completionBefore: 50, completionAfter: 50,
    } });
    await assert.rejects(prisma.guidanceSessionEvent.create({ data: { proposalId: proposal.id, sessionId, turnIndex: 6 } }));
    await assert.rejects(prisma.guidanceOutcome.create({ data: { proposalId: proposal.id, sessionId, outcomeCode: "nope" } }));
    const outcome = await prisma.guidanceOutcome.create({ data: { proposalId: proposal.id, sessionId, outcomeCode: "handoff", eventId: event.id } });
    assert.equal(outcome.eventId, event.id);
    await prisma.guidanceFeedback.create({ data: { proposalId: proposal.id, eventId: event.id, rating: "good", staffId: owner.id, note: "Right call" } });
    await assert.rejects(prisma.guidanceFeedback.create({ data: { proposalId: proposal.id, sessionId, rating: "meh" } }));
    const period = `test-${randomUUID()}`;
    await prisma.guidanceRuleScore.create({ data: { ruleId: rule.id, period, fires: 1, positiveOutcomes: 1, computedWeight: 1.3 } });
    const fired = await prisma.guidanceSessionEvent.findMany({ where: { firedRuleIds: { has: rule.id }, proposalId: proposal.id } });
    assert.equal(fired.length, 1);
    await prisma.guidanceRuleScore.deleteMany({ where: { period } });
    assert.notEqual(await deleteProposalCascade(prisma, proposal.id), "not_found");
    assert.equal(await prisma.guidanceSessionEvent.count({ where: { proposalId: proposal.id } }), 0);
    assert.equal(await prisma.guidanceOutcome.count({ where: { proposalId: proposal.id } }), 0);
    assert.equal(await prisma.guidanceFeedback.count({ where: { proposalId: proposal.id } }), 0);
  } finally {
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
