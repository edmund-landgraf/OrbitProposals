import type { Prisma, PrismaClient } from "@prisma/client";

export type GuidanceScorePeriod = { period: string; start: Date; endExclusive: Date };

export function utcDayPeriod(date: Date): GuidanceScorePeriod {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const endExclusive = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));
  const period = start.toISOString().slice(0, 10);
  return { period, start, endExclusive };
}

export type RuleScoreInput = {
  baseWeight: number;
  fires: number;
  positive: number;
  negative: number;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Bounded, outcome- and feedback-driven weight adjustment.
 * - Unknown outcomes are ignored (not negative).
 * - Sparse data keeps the base weight.
 */
export function computeLearnedWeight(input: RuleScoreInput, opts: { minFires: number; maxDelta: number }): number {
  const base = input.baseWeight;
  if (!Number.isFinite(base) || base <= 0) return 1;
  if (input.fires < opts.minFires) return base;
  const net = input.positive - input.negative;
  if (net === 0) return base;
  const rate = net / Math.max(1, input.fires);
  const delta = clamp(rate, -opts.maxDelta, opts.maxDelta);
  return base * (1 + delta);
}

type EventRow = {
  id: string;
  sessionId: string;
  firedRuleIds: string[];
  actionTaken: string | null;
  createdAt: Date;
};

type OutcomeRow = {
  id: string;
  sessionId: string | null;
  eventId: string | null;
  outcomeCode: string;
  occurredAt: Date;
};

type FeedbackRow = {
  id: string;
  sessionId: string | null;
  eventId: string | null;
  rating: string;
  createdAt: Date;
};

export type GuidanceScoreRun = {
  period: string;
  window: { start: string; endExclusive: string };
  dryRun: boolean;
  rules: Array<{
    ruleId: string;
    ruleKey: string;
    fires: number;
    positiveOutcomes: number;
    negativeOutcomes: number;
    baseWeight: number;
    computedWeight: number;
    learnedWeightUpdated: boolean;
  }>;
};

export async function scoreGuidanceRulesNightly(prisma: PrismaClient, input: { at?: Date; period?: string; dryRun?: boolean } = {}): Promise<GuidanceScoreRun> {
  const now = input.at ?? new Date();
  const day = utcDayPeriod(now);
  const period = input.period ?? day.period;
  const window = input.period ? parseUtcPeriod(period) : day;
  const dryRun = Boolean(input.dryRun);

  const [rules, outcomeCodes, ratings, events, outcomes, feedback] = await Promise.all([
    prisma.guidanceRule.findMany({ select: { id: true, key: true, enabled: true, baseWeight: true, learnedWeight: true } }),
    prisma.guidanceOutcomeCode.findMany({ select: { code: true, polarity: true } }),
    prisma.guidanceFeedbackRating.findMany({ select: { code: true, polarity: true } }),
    prisma.guidanceSessionEvent.findMany({
      where: { createdAt: { gte: window.start, lt: window.endExclusive } },
      select: { id: true, sessionId: true, firedRuleIds: true, actionTaken: true, createdAt: true },
    }) as Promise<EventRow[]>,
    prisma.guidanceOutcome.findMany({
      where: { occurredAt: { gte: window.start, lt: window.endExclusive } },
      select: { id: true, sessionId: true, eventId: true, outcomeCode: true, occurredAt: true },
    }) as Promise<OutcomeRow[]>,
    prisma.guidanceFeedback.findMany({
      where: { createdAt: { gte: window.start, lt: window.endExclusive } },
      select: { id: true, sessionId: true, eventId: true, rating: true, createdAt: true },
    }) as Promise<FeedbackRow[]>,
  ]);

  const enabledRuleIds = new Set(rules.filter((r) => r.enabled).map((r) => r.id));
  const byRule = new Map(rules.map((r) => [r.id, r]));
  const outcomePolarity = new Map(outcomeCodes.map((o) => [o.code, o.polarity]));
  const ratingPolarity = new Map(ratings.map((r) => [r.code, r.polarity]));

  const fires = new Map<string, number>();
  const positive = new Map<string, number>();
  const negative = new Map<string, number>();

  const byEvent = new Map(events.map((e) => [e.id, e]));
  const sessionRules = new Map<string, Set<string>>();
  for (const event of events) {
    const set = sessionRules.get(event.sessionId) ?? new Set<string>();
    for (const ruleId of event.firedRuleIds) if (enabledRuleIds.has(ruleId)) set.add(ruleId);
    sessionRules.set(event.sessionId, set);
    for (const ruleId of event.firedRuleIds) {
      if (!enabledRuleIds.has(ruleId)) continue;
      fires.set(ruleId, (fires.get(ruleId) ?? 0) + 1);
    }
    if (event.actionTaken) {
      const pol = outcomePolarity.get(event.actionTaken) ?? 0;
      if (pol > 0) bumpMany(positive, event.firedRuleIds, enabledRuleIds, 1);
      if (pol < 0) bumpMany(negative, event.firedRuleIds, enabledRuleIds, 1);
    }
  }

  // Outcomes (if they are recorded explicitly) override nothing; they are additive evidence.
  const seenOutcomeAttribution = new Set<string>();
  for (const row of outcomes) {
    const pol = outcomePolarity.get(row.outcomeCode);
    if (!pol) continue;
    if (row.eventId && byEvent.has(row.eventId)) {
      const key = `event:${row.eventId}:${row.outcomeCode}`;
      if (seenOutcomeAttribution.has(key)) continue;
      seenOutcomeAttribution.add(key);
      const event = byEvent.get(row.eventId)!;
      if (pol > 0) bumpMany(positive, event.firedRuleIds, enabledRuleIds, 1);
      else bumpMany(negative, event.firedRuleIds, enabledRuleIds, 1);
      continue;
    }
    if (row.sessionId) {
      const set = sessionRules.get(row.sessionId);
      if (!set || set.size === 0) continue;
      const key = `session:${row.sessionId}:${row.outcomeCode}:${row.id}`;
      if (seenOutcomeAttribution.has(key)) continue;
      seenOutcomeAttribution.add(key);
      for (const ruleId of set) {
        if (pol > 0) positive.set(ruleId, (positive.get(ruleId) ?? 0) + 1);
        else negative.set(ruleId, (negative.get(ruleId) ?? 0) + 1);
      }
    }
  }

  const seenFeedbackAttribution = new Set<string>();
  for (const row of feedback) {
    const pol = ratingPolarity.get(row.rating);
    if (!pol) continue;
    if (row.eventId && byEvent.has(row.eventId)) {
      const key = `event:${row.eventId}:rating:${row.id}`;
      if (seenFeedbackAttribution.has(key)) continue;
      seenFeedbackAttribution.add(key);
      const event = byEvent.get(row.eventId)!;
      if (pol > 0) bumpMany(positive, event.firedRuleIds, enabledRuleIds, 1);
      else bumpMany(negative, event.firedRuleIds, enabledRuleIds, 1);
      continue;
    }
    if (row.sessionId) {
      const set = sessionRules.get(row.sessionId);
      if (!set || set.size === 0) continue;
      const key = `session:${row.sessionId}:rating:${row.id}`;
      if (seenFeedbackAttribution.has(key)) continue;
      seenFeedbackAttribution.add(key);
      for (const ruleId of set) {
        if (pol > 0) positive.set(ruleId, (positive.get(ruleId) ?? 0) + 1);
        else negative.set(ruleId, (negative.get(ruleId) ?? 0) + 1);
      }
    }
  }

  const MIN_FIRES = 5;
  const MAX_DELTA = 0.5;

  const scored = rules
    .filter((r) => r.enabled)
    .map((r) => {
      const count = fires.get(r.id) ?? 0;
      const pos = positive.get(r.id) ?? 0;
      const neg = negative.get(r.id) ?? 0;
      const computed = computeLearnedWeight({ baseWeight: r.baseWeight, fires: count, positive: pos, negative: neg }, { minFires: MIN_FIRES, maxDelta: MAX_DELTA });
      const evidence = {
        version: 1,
        period,
        window: { start: window.start.toISOString(), endExclusive: window.endExclusive.toISOString() },
        fires: count,
        positiveOutcomes: pos,
        negativeOutcomes: neg,
        inputs: { minFires: MIN_FIRES, maxDelta: MAX_DELTA },
      };
      return { ruleId: r.id, ruleKey: r.key, fires: count, positiveOutcomes: pos, negativeOutcomes: neg, baseWeight: r.baseWeight, computedWeight: computed, evidence };
    });

  if (!dryRun) {
    await prisma.$transaction(async (tx) => {
      for (const row of scored) {
        await tx.guidanceRuleScore.upsert({
          where: { ruleId_period: { ruleId: row.ruleId, period } },
          create: {
            ruleId: row.ruleId,
            period,
            fires: row.fires,
            positiveOutcomes: row.positiveOutcomes,
            negativeOutcomes: row.negativeOutcomes,
            computedWeight: row.computedWeight,
            evidence: row.evidence as Prisma.InputJsonValue,
          },
          update: {
            fires: row.fires,
            positiveOutcomes: row.positiveOutcomes,
            negativeOutcomes: row.negativeOutcomes,
            computedWeight: row.computedWeight,
            evidence: row.evidence as Prisma.InputJsonValue,
            computedAt: now,
          },
        });
        // Only update learnedWeight when we have enough fires and a non-zero signal.
        if (row.fires >= MIN_FIRES && row.positiveOutcomes + row.negativeOutcomes > 0 && row.computedWeight !== row.baseWeight) {
          await tx.guidanceRule.update({ where: { id: row.ruleId }, data: { learnedWeight: row.computedWeight } });
        }
      }
    });
  }

  return {
    period,
    window: { start: window.start.toISOString(), endExclusive: window.endExclusive.toISOString() },
    dryRun,
    rules: scored.map((r) => ({
      ruleId: r.ruleId,
      ruleKey: r.ruleKey,
      fires: r.fires,
      positiveOutcomes: r.positiveOutcomes,
      negativeOutcomes: r.negativeOutcomes,
      baseWeight: r.baseWeight,
      computedWeight: r.computedWeight,
      learnedWeightUpdated: !dryRun && r.fires >= MIN_FIRES && r.positiveOutcomes + r.negativeOutcomes > 0 && r.computedWeight !== r.baseWeight,
    })),
  };
}

function parseUtcPeriod(period: string): GuidanceScorePeriod {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!match) throw new Error("period must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  const endExclusive = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));
  return { period, start, endExclusive };
}

function bumpMany(target: Map<string, number>, ruleIds: readonly string[], enabled: Set<string>, by: number) {
  for (const ruleId of ruleIds) {
    if (!enabled.has(ruleId)) continue;
    target.set(ruleId, (target.get(ruleId) ?? 0) + by);
  }
}

