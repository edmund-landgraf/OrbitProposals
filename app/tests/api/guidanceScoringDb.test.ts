// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";
import { scoreGuidanceRulesNightly } from "../../server/guidanceScoring.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

test("nightly scoring upserts deterministic rule scores and updates learned weights only with enough evidence", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const now = new Date("2026-11-06T12:00:00.000Z");
  let proposalId: string | null = null;
  let ownerId: string | null = null;
  try {
    const owner = await prisma.user.create({ data: { email: `guidance-score-${randomUUID()}@test.invalid`, displayName: "Guidance scoring" } });
    const proposal = await prisma.proposal.create({ data: {
      ownerId: owner.id, title: "Guidance scoring", engagement: "capped_hours_4", pricingModel: "capped_hours",
      scope: { summary: "Score guidance rules.", deliverables: ["Score"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, amountMinor: 80000, currency: "USD" },
    } });
    proposalId = proposal.id;
    ownerId = owner.id;

    const rule = await prisma.guidanceRule.findFirst({ where: { enabled: true }, orderBy: { priority: "asc" } });
    assert(rule, "expected at least one seeded guidance rule");

    const sessionId = `agent:${owner.id}:${proposal.id}`;
    const day = "2026-11-06";

    // 5 fires (min fires threshold), one positive and one negative signal, and an unknown action_taken.
    const events = [];
    for (let i = 0; i < 5; i += 1) {
      events.push(await prisma.guidanceSessionEvent.create({ data: {
        proposalId: proposal.id,
        sessionId,
        turnIndex: i + 1,
        trigger: "turn",
        firedRuleIds: [rule.id],
        signals: {},
        actionTaken: i === 4 ? "mark_unsure" : null, // unknown as an outcome_code, should not count negative
        createdAt: now,
      } }));
    }

    const good = await prisma.guidanceFeedbackRating.findFirst({ where: { polarity: 1 } });
    const bad = await prisma.guidanceFeedbackRating.findFirst({ where: { polarity: -1 } });
    assert(good && bad, "expected seeded guidance feedback ratings with polarity +/-1");

    await prisma.guidanceFeedback.create({ data: { proposalId: proposal.id, sessionId, eventId: events[0]!.id, rating: good.code, note: "good" } });
    await prisma.guidanceFeedback.create({ data: { proposalId: proposal.id, sessionId, eventId: events[1]!.id, rating: bad.code, note: "bad" } });

    const first = await scoreGuidanceRulesNightly(prisma, { period: day, at: now });
    assert.equal(first.period, day);
    const score = await prisma.guidanceRuleScore.findUnique({ where: { ruleId_period: { ruleId: rule.id, period: day } } });
    assert(score, "expected a score row");
    assert.equal(score.fires, 5);
    assert.equal(score.positiveOutcomes, 1);
    assert.equal(score.negativeOutcomes, 1);
    assert.equal(typeof score.evidence, "object");

    const updated = await prisma.guidanceRule.findUnique({ where: { id: rule.id } });
    assert(updated, "expected rule");
    // net 0 => base weight (no update), since good and bad cancel out.
    assert.equal(updated.learnedWeight ?? null, null);

    // Add one more positive feedback so net becomes positive and learned weight updates.
    await prisma.guidanceFeedback.create({ data: { proposalId: proposal.id, sessionId, eventId: events[2]!.id, rating: good.code, note: "good again" } });
    await scoreGuidanceRulesNightly(prisma, { period: day, at: now });
    const updated2 = await prisma.guidanceRule.findUnique({ where: { id: rule.id } });
    assert(updated2, "expected rule");
    assert(updated2.learnedWeight !== null);
    assert(updated2.learnedWeight! > rule.baseWeight);

    // Idempotent per day: still a single row.
    assert.equal(await prisma.guidanceRuleScore.count({ where: { ruleId: rule.id, period: day } }), 1);
  } finally {
    if (proposalId) await deleteProposalCascade(prisma, proposalId).catch(() => undefined);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

