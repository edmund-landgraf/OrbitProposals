// Approach A: rank database guidance rules against signals computed for one agent turn.
// Rule text, weights, and thresholds stay on the rows. This module only evaluates them.

export type SignalMap = Record<string, number>;

export type GuidanceRuleRow = {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
  priority: number;
  baseWeight: number;
  learnedWeight: number | null;
  trigger: string;
  condition: unknown;
  suggestedMove: string;
  clientPhrase: string;
  staffNote: string | null;
};

export type RankedRule = GuidanceRuleRow & { weight: number };

export type SuggestedMove = {
  ruleId: string;
  ruleKey: string;
  name: string;
  move: string;
  clientPhrase: string;
  staffNote: string | null;
  weight: number;
  priority: number;
};

const TRIGGERS = new Set(["turn", "node_changed", "pause", "resume", "submit_attempt"]);

const compare: Record<string, (left: number, right: number) => boolean> = {
  ">": (left, right) => left > right,
  ">=": (left, right) => left >= right,
  "<": (left, right) => left < right,
  "<=": (left, right) => left <= right,
  "==": (left, right) => left === right,
  "=": (left, right) => left === right,
  "!=": (left, right) => left !== right,
};

type Clause = { signal: string; op: string; value: number };

/** A condition is `{ all: [{ signal, op, value }, ...] }`. An empty `all` matches. Anything else does not. */
export function conditionClauses(condition: unknown): Clause[] | null {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) return null;
  const all = (condition as { all?: unknown }).all;
  if (!Array.isArray(all)) return null;
  const clauses: Clause[] = [];
  for (const item of all) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const signal = (item as { signal?: unknown }).signal;
    const op = (item as { op?: unknown }).op;
    const value = (item as { value?: unknown }).value;
    if (typeof signal !== "string" || typeof op !== "string" || typeof value !== "number" || !Number.isFinite(value)) return null;
    clauses.push({ signal, op, value });
  }
  return clauses;
}

export function conditionMatches(condition: unknown, signals: SignalMap): boolean {
  const clauses = conditionClauses(condition);
  if (!clauses) return false;
  return clauses.every((clause) => {
    const have = signals[clause.signal];
    const op = compare[clause.op];
    return have !== undefined && op !== undefined && op(have, clause.value);
  });
}

/** Learned weight wins when it is set, including zero. */
export function ruleWeight(rule: { baseWeight: number; learnedWeight: number | null }): number {
  return rule.learnedWeight ?? rule.baseWeight;
}

/** Enabled rules for these triggers whose conditions match, highest weight first, then lower priority number. */
export function rankMatchingRules(rules: readonly GuidanceRuleRow[], signals: SignalMap, triggers: readonly string[]): RankedRule[] {
  const allowed = new Set(triggers);
  return rules
    .filter((rule) => rule.enabled && allowed.has(rule.trigger) && conditionMatches(rule.condition, signals))
    .map((rule) => ({ ...rule, weight: ruleWeight(rule) }))
    .sort((left, right) => right.weight - left.weight || left.priority - right.priority || left.key.localeCompare(right.key));
}

export function toSuggestedMoves(ranked: readonly RankedRule[], limit: number, phrase: Record<string, string | number> = {}): SuggestedMove[] {
  return ranked.slice(0, Math.max(0, limit)).map((rule) => ({
    ruleId: rule.id,
    ruleKey: rule.key,
    name: rule.name,
    move: rule.suggestedMove,
    clientPhrase: fillPhrase(rule.clientPhrase, phrase),
    staffNote: rule.staffNote,
    weight: rule.weight,
    priority: rule.priority,
  }));
}

export function pauseIdleMinutes(rules: readonly GuidanceRuleRow[]): number | null {
  let threshold: number | null = null;
  for (const rule of rules) {
    if (!rule.enabled || rule.trigger !== "pause") continue;
    for (const clause of conditionClauses(rule.condition) ?? []) {
      if (clause.signal !== "idle_minutes" || (clause.op !== ">=" && clause.op !== ">")) continue;
      threshold = threshold === null ? clause.value : Math.min(threshold, clause.value);
    }
  }
  return threshold;
}

export function eligibleTriggers(input: {
  explicit: string | null;
  nodesReopened: number;
  gapMinutes: number;
  userJustSpoke: boolean;
  pauseAfterMinutes: number | null;
}): string[] {
  const explicit = input.explicit && TRIGGERS.has(input.explicit) && input.explicit !== "turn" ? input.explicit : null;
  if (explicit) return explicit === "node_changed" ? ["node_changed", "turn"] : [explicit];
  const triggers = new Set<string>(["turn"]);
  if (input.nodesReopened > 0) triggers.add("node_changed");
  if (input.pauseAfterMinutes !== null && input.gapMinutes >= input.pauseAfterMinutes) triggers.add(input.userJustSpoke ? "resume" : "pause");
  return [...triggers];
}

export function primaryTrigger(triggers: readonly string[], explicit: string | null): string {
  if (explicit && TRIGGERS.has(explicit) && explicit !== "turn") return explicit;
  if (triggers.includes("resume")) return "resume";
  if (triggers.includes("pause")) return "pause";
  return "turn";
}

export type ProgressTurn = {
  completionBefore: number | null;
  completionAfter: number | null;
  stateProgressBefore?: number | null;
  stateProgressAfter?: number | null;
};

/** A turn made progress when completion percent rose, or when parts moved forward
 * (for example open → drafted) even if settled weight stayed the same. */
export function turnStalled(before: number, after: number, stateBefore?: number | null, stateAfter?: number | null): boolean {
  if (after > before) return false;
  if ((stateAfter ?? 0) > (stateBefore ?? 0)) return false;
  return true;
}

export function turnsWithoutProgress(
  prior: readonly ProgressTurn[],
  current: { before: number; after: number; stateProgressBefore?: number; stateProgressAfter?: number },
): number {
  let count = 0;
  for (let index = prior.length - 1; index >= 0; index -= 1) {
    const event = prior[index]!;
    const before = event.completionBefore ?? 0;
    const after = event.completionAfter ?? before;
    if (turnStalled(before, after, event.stateProgressBefore, event.stateProgressAfter)) count += 1;
    else break;
  }
  if (turnStalled(current.before, current.after, current.stateProgressBefore, current.stateProgressAfter)) count += 1;
  return count;
}

/** Rank a part for "was there drafting progress?": settled=2, drafted/needs review=1, not started=0. */
export function stateProgress(nodes: ReadonlyArray<{ stateCode: string }>, policy: { states: ReadonlyArray<{ code: string; completionWeight: number }> }): number {
  const weight = new Map(policy.states.map((state) => [state.code, state.completionWeight]));
  return nodes.reduce((sum, node) => {
    const earned = weight.get(node.stateCode) ?? 0;
    if (earned > 0) return sum + 2;
    if (node.stateCode !== "open") return sum + 1;
    return sum;
  }, 0);
}

export function fillPhrase(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => {
    const value = values[key];
    return value === undefined || value === "" ? token : String(value);
  });
}

export function guidanceContext(moves: readonly Pick<SuggestedMove, "move" | "clientPhrase" | "staffNote">[]): string {
  if (moves.length === 0) return "";
  const lines = moves.map((move, index) => {
    const note = move.staffNote ? ` Staff note, do not read this aloud: ${move.staffNote}` : "";
    return `${index + 1}. ${move.move}: ${move.clientPhrase}${note}`;
  });
  return [
    "Suggested next moves from the guidance playbook. Use them to steer collection, parking, a reminder, or a handoff to a person.",
    "Say the client phrase in your own words. Do not set hours or price.",
    ...lines,
  ].join("\n");
}

export function roundSignal(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeTurnSignals(input: {
  completion: number;
  baselineCompletion: number;
  baselineNodeCount: number;
  nodeCount: number;
  nodesReopened: number;
  prior: readonly ProgressTurn[];
  completionBefore: number;
  unsureCount: number;
  unboundedFlags: number;
  idleMinutes: number;
  parkedCount: number;
  stateProgressBefore?: number;
  stateProgressAfter?: number;
}): SignalMap {
  const growth = input.baselineNodeCount <= 0
    ? (input.nodeCount > 0 ? 100 : 0)
    : ((input.nodeCount - input.baselineNodeCount) / input.baselineNodeCount) * 100;
  return {
    completion_delta: roundSignal(input.completion - input.baselineCompletion),
    nodes_reopened: input.nodesReopened,
    turns_without_progress: turnsWithoutProgress(input.prior, { before: input.completionBefore, after: input.completion, stateProgressBefore: input.stateProgressBefore, stateProgressAfter: input.stateProgressAfter }),
    unsure_count: input.unsureCount,
    unbounded_flags: input.unboundedFlags,
    scope_growth_pct: roundSignal(growth),
    idle_minutes: input.idleMinutes,
    parked_count: input.parkedCount,
  };
}
