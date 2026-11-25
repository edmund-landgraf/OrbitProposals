import assert from "node:assert/strict";
import test from "node:test";
import {
  computeTurnSignals,
  conditionMatches,
  eligibleTriggers,
  fillPhrase,
  guidanceContext,
  pauseIdleMinutes,
  primaryTrigger,
  rankMatchingRules,
  turnsWithoutProgress,
  type GuidanceRuleRow,
} from "../../server/guidancePlaybook.js";

const rule = (over: Partial<GuidanceRuleRow>): GuidanceRuleRow => ({
  id: over.id ?? "11111111-1111-4111-8111-111111111111",
  key: over.key ?? "rule",
  name: over.name ?? "Rule",
  enabled: over.enabled ?? true,
  priority: over.priority ?? 100,
  baseWeight: over.baseWeight ?? 1,
  learnedWeight: over.learnedWeight === undefined ? null : over.learnedWeight,
  trigger: over.trigger ?? "turn",
  condition: over.condition ?? { all: [] },
  suggestedMove: over.suggestedMove ?? "summarize_progress",
  clientPhrase: over.clientPhrase ?? "Hello {next}.",
  staffNote: over.staffNote === undefined ? null : over.staffNote,
});

const zero = { completion_delta: 0, nodes_reopened: 0, turns_without_progress: 0, unsure_count: 0, unbounded_flags: 0, scope_growth_pct: 0, idle_minutes: 0, parked_count: 0 };

test("signal math matches the playbook definitions", () => {
  const prior = Array.from({ length: 5 }, () => ({ completionBefore: 40, completionAfter: 40 }));
  const signals = computeTurnSignals({
    completion: 25, baselineCompletion: 40, baselineNodeCount: 8, nodeCount: 10, nodesReopened: 2,
    prior, completionBefore: 40, unsureCount: 2, unboundedFlags: 1, idleMinutes: 15, parkedCount: 1,
  });
  assert.equal(signals.completion_delta, -15);
  assert.equal(signals.scope_growth_pct, 25);
  assert.equal(signals.nodes_reopened, 2);
  assert.equal(signals.turns_without_progress, 6);
  assert.equal(signals.unsure_count, 2);
  assert.equal(signals.unbounded_flags, 1);
  assert.equal(signals.idle_minutes, 15);
  assert.equal(signals.parked_count, 1);
  assert.equal(computeTurnSignals({
    completion: 0, baselineCompletion: 0, baselineNodeCount: 0, nodeCount: 3, nodesReopened: 0,
    prior: [], completionBefore: 0, unsureCount: 0, unboundedFlags: 0, idleMinutes: 0, parkedCount: 0,
  }).scope_growth_pct, 100);
  const rose = [{ completionBefore: 10, completionAfter: 20 }, { completionBefore: 20, completionAfter: 20 }];
  assert.equal(turnsWithoutProgress(rose, { before: 20, after: 20 }), 2);
  assert.equal(turnsWithoutProgress(rose, { before: 20, after: 30 }), 1);
  const drafted = [
    { completionBefore: 0, completionAfter: 0, stateProgressBefore: 0, stateProgressAfter: 2 },
    { completionBefore: 0, completionAfter: 0, stateProgressBefore: 2, stateProgressAfter: 4 },
  ];
  assert.equal(turnsWithoutProgress(drafted, { before: 0, after: 0, stateProgressBefore: 4, stateProgressAfter: 5 }), 0);
  assert.equal(turnsWithoutProgress(drafted, { before: 0, after: 0, stateProgressBefore: 4, stateProgressAfter: 4 }), 1);
});

test("rule matching uses row weights, triggers, and conditions", () => {
  assert.equal(conditionMatches({ all: [] }, zero), true);
  assert.equal(conditionMatches({ all: [{ signal: "unsure_count", op: ">=", value: 2 }] }, zero), false);
  assert.equal(conditionMatches({ any: [] }, zero), false);
  const rules = [
    rule({ id: "1", key: "heavy", baseWeight: 0.2, learnedWeight: 2, priority: 50, condition: { all: [] } }),
    rule({ id: "2", key: "base", baseWeight: 1, priority: 1, condition: { all: [] } }),
    rule({ id: "3", key: "off", enabled: false, baseWeight: 9, condition: { all: [] } }),
    rule({ id: "4", key: "pause", trigger: "pause", condition: { all: [{ signal: "idle_minutes", op: ">=", value: 15 }] }, suggestedMove: "offer_tickler" }),
    rule({ id: "5", key: "drop", priority: 10, baseWeight: 1.5, clientPhrase: "Adding {item} reopened {parts}.", staffNote: "Explain first.", condition: { all: [{ signal: "scope_growth_pct", op: ">", value: 20 }, { signal: "completion_delta", op: "<", value: 0 }] } }),
  ];
  const ranked = rankMatchingRules(rules, { ...zero, scope_growth_pct: 25, completion_delta: -1 }, ["turn"]);
  assert.deepEqual(ranked.map((item) => item.key), ["heavy", "drop", "base"]);
  const tied = rankMatchingRules([
    rule({ id: "a", key: "later", priority: 20, condition: { all: [] } }),
    rule({ id: "b", key: "sooner", priority: 5, condition: { all: [] } }),
  ], zero, ["turn"]);
  assert.deepEqual(tied.map((item) => item.key), ["sooner", "later"]);
  assert.equal(pauseIdleMinutes(rules), 15);
  assert.deepEqual(eligibleTriggers({ explicit: null, nodesReopened: 2, gapMinutes: 15, userJustSpoke: false, pauseAfterMinutes: 15 }).sort(), ["node_changed", "pause", "turn"]);
  assert.deepEqual(eligibleTriggers({ explicit: null, nodesReopened: 0, gapMinutes: 15, userJustSpoke: true, pauseAfterMinutes: 15 }).sort(), ["resume", "turn"]);
  assert.deepEqual(eligibleTriggers({ explicit: null, nodesReopened: 0, gapMinutes: 14, userJustSpoke: false, pauseAfterMinutes: 15 }), ["turn"]);
  assert.equal(primaryTrigger(["turn", "pause"], null), "pause");
  assert.equal(primaryTrigger(["turn"], "submit_attempt"), "submit_attempt");
  const phrase = fillPhrase(ranked.find((item) => item.key === "drop")!.clientPhrase, { item: "a mobile app", parts: "scope and hours" });
  assert.equal(phrase, "Adding a mobile app reopened scope and hours.");
  const context = guidanceContext([{ move: "explain_drop", clientPhrase: phrase, staffNote: "Explain first." }]);
  assert.match(context, /Do not set hours or price/);
  assert.match(context, /explain_drop/);
  assert.equal(guidanceContext([]), "");
});
