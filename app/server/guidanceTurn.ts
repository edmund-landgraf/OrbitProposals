import type { Prisma, PrismaClient } from "@prisma/client";
import { completionPercent, type TreeNode } from "./completionTree.js";
import {
  computeTurnSignals,
  eligibleTriggers,
  pauseIdleMinutes,
  primaryTrigger,
  rankMatchingRules,
  stateProgress,
  toSuggestedMoves,
  type GuidanceRuleRow,
  type SignalMap,
  type SuggestedMove,
} from "./guidancePlaybook.js";
import { prismaCompletionStore } from "./proposalCompletion.js";

const FALLBACK_MAX_MOVES = 3;
const FALLBACK_ATTACH_SECONDS = 120;
const MAX_FIRED_RULES = 20;
const FIRST_TURN_CLOCK_SLACK_MS = 2_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SessionBaseline = {
  completion: number;
  nodeCount: number;
  states: Record<string, string>;
  startedAt: string;
};

export type GuidanceTurnView = {
  eventId: string | null;
  sessionId: string;
  turnIndex: number | null;
  trigger: string;
  signals: SignalMap;
  suggestedMoves: SuggestedMove[];
  recorded: boolean;
};

type PriorEvent = {
  id: string;
  turnIndex: number;
  trigger: string;
  signals: unknown;
  firedRuleIds: string[];
  completionBefore: number | null;
  completionAfter: number | null;
  sessionBaseline: unknown;
  createdAt: Date;
  actionTaken: string | null;
};

export type GuidanceTurnInput = {
  proposalId: string;
  sessionId: string;
  userJustSpoke?: boolean;
  explicitTrigger?: string | null;
  actionTaken?: string | null;
  chosenMove?: string | null;
  /**
   * always: write a new turn. if-absent: reuse the latest turn when one exists. preview: compute fresh signals and moves but
   * write nothing when the session already has a turn (plain progress reads must not bump turnIndex or count as a turn).
   */
  record?: "always" | "if-absent" | "preview";
  now?: Date;
};

export function guidanceSessionId(request: { header(name: string): string | undefined }, userId: string, proposalId: string): string {
  const raw = request.header("x-unw-guidance-session")?.trim() ?? "";
  if (raw.length > 0 && raw.length <= 200 && !/[\r\n]/.test(raw)) return raw;
  return `agent:${userId}:${proposalId}`;
}

export async function loadGuidanceSettings(prisma: PrismaClient): Promise<{ maxSuggestedMoves: number; actionAttachSeconds: number }> {
  const rows = await prisma.guidanceSetting.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const max = byKey.get("max_suggested_moves") ?? FALLBACK_MAX_MOVES;
  const attach = byKey.get("action_attach_seconds") ?? FALLBACK_ATTACH_SECONDS;
  return { maxSuggestedMoves: Math.min(Math.max(max, 1), 20), actionAttachSeconds: Math.max(0, attach) };
}

function readBaseline(value: unknown): SessionBaseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.completion !== "number" || typeof row.nodeCount !== "number" || typeof row.startedAt !== "string") return null;
  const states: Record<string, string> = {};
  if (row.states && typeof row.states === "object" && !Array.isArray(row.states)) {
    for (const [key, state] of Object.entries(row.states as Record<string, unknown>)) if (typeof state === "string") states[key] = state;
  }
  return { completion: row.completion, nodeCount: row.nodeCount, states, startedAt: row.startedAt };
}

function asSignals(value: unknown): SignalMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const signals: SignalMap = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (typeof item === "number" && Number.isFinite(item)) signals[key] = item;
  return signals;
}

function currentBaseline(nodes: TreeNode[], percent: number, startedAt: Date): SessionBaseline {
  return {
    completion: percent,
    nodeCount: nodes.length,
    states: Object.fromEntries(nodes.map((node) => [node.key, node.stateCode])),
    startedAt: startedAt.toISOString(),
  };
}

async function phraseValues(prisma: PrismaClient, proposalId: string, nodes: TreeNode[], baseline: SessionBaseline, percent: number, reopenCode: string | null): Promise<Record<string, string | number>> {
  const [groups, stateGroups, parks, changes] = await Promise.all([
    prisma.proposalProgressGroup.findMany({ where: { settled: true }, select: { code: true } }),
    prisma.proposalProgressStateGroup.findMany(),
    prisma.proposalIntakePark.findFirst({ where: { proposalId }, orderBy: { createdAt: "desc" }, select: { summary: true } }),
    prisma.proposalParkedChange.findFirst({ where: { proposalId }, orderBy: { createdAt: "desc" }, select: { summary: true } }),
  ]);
  const settledGroups = new Set(groups.map((group) => group.code));
  const settledStates = new Set(stateGroups.filter((row) => settledGroups.has(row.groupCode)).map((row) => row.stateCode));
  const settled = nodes.filter((node) => settledStates.has(node.stateCode));
  const reopened = nodes.filter((node) => reopenCode !== null && node.stateCode === reopenCode && baseline.states[node.key] !== reopenCode);
  const open = nodes.filter((node) => !settledStates.has(node.stateCode)).sort((left, right) => left.sortOrder - right.sortOrder);
  const list = (labels: string[]) => labels.length <= 1 ? labels[0] ?? "" : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return {
    item: parks?.summary ?? changes?.summary ?? reopened[0]?.clientLabel ?? "this",
    parts: list(reopened.map((node) => node.clientLabel)) || "some parts",
    before: baseline.completion,
    after: percent,
    other: settled.find((node) => node.clientLabel !== reopened[0]?.clientLabel)?.clientLabel ?? "something already in the proposal",
    part: open[0]?.clientLabel ?? "that part",
    settled: settled.length,
    total: nodes.length,
    next: open[0]?.clientLabel ?? "the next open part",
  };
}

async function loadRules(prisma: PrismaClient): Promise<GuidanceRuleRow[]> {
  const rows = await prisma.guidanceRule.findMany();
  return rows.map((row) => ({
    id: row.id, key: row.key, name: row.name, enabled: row.enabled, priority: row.priority,
    baseWeight: row.baseWeight, learnedWeight: row.learnedWeight, trigger: row.trigger, condition: row.condition,
    suggestedMove: row.suggestedMove, clientPhrase: row.clientPhrase, staffNote: row.staffNote,
  }));
}

async function movesFromIds(rules: readonly GuidanceRuleRow[], ids: readonly string[], phrase: Record<string, string | number>, limit: number): Promise<SuggestedMove[]> {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const ranked = ids.flatMap((id) => {
    const rule = byId.get(id);
    return rule ? [{ ...rule, weight: rule.learnedWeight ?? rule.baseWeight }] : [];
  });
  return toSuggestedMoves(ranked, limit, phrase);
}

export async function proposalGuidanceTurn(prisma: PrismaClient, input: GuidanceTurnInput): Promise<GuidanceTurnView> {
  const now = input.now ?? new Date();
  const record = input.record ?? "always";
  const store = prismaCompletionStore(prisma);
  await store.ensure(input.proposalId);
  const [nodes, policy, rules, settings, defs, prior, chat] = await Promise.all([
    store.nodes(input.proposalId),
    store.policy(),
    loadRules(prisma),
    loadGuidanceSettings(prisma),
    prisma.guidanceSignalDef.findMany({ where: { enabled: true } }),
    prisma.guidanceSessionEvent.findMany({
      where: { proposalId: input.proposalId, sessionId: input.sessionId },
      orderBy: { turnIndex: "asc" },
    }) as Promise<PriorEvent[]>,
    UUID.test(input.sessionId) ? prisma.chatSession.findUnique({ where: { id: input.sessionId }, select: { id: true } }) : Promise.resolve(null),
  ]);
  const latest = prior.at(-1) ?? null;
  if (record === "if-absent" && latest) {
    const storedBaseline = readBaseline(prior.find((event) => readBaseline(event.sessionBaseline))?.sessionBaseline) ?? currentBaseline(nodes, completionPercent(nodes, policy), now);
    const phrase = await phraseValues(prisma, input.proposalId, nodes, storedBaseline, completionPercent(nodes, policy), policy.states.find((state) => state.isReopenTarget)?.code ?? null);
    return {
      eventId: latest.id, sessionId: input.sessionId, turnIndex: latest.turnIndex, trigger: latest.trigger,
      signals: asSignals(latest.signals), suggestedMoves: await movesFromIds(rules, latest.firedRuleIds, phrase, settings.maxSuggestedMoves), recorded: false,
    };
  }

  const percent = completionPercent(nodes, policy);
  const reopenCode = policy.states.find((state) => state.isReopenTarget)?.code ?? null;
  const storedBaseline = readBaseline(prior.find((event) => readBaseline(event.sessionBaseline))?.sessionBaseline);
  const first = prior[0];
  const baseline = storedBaseline ?? (first
    ? { completion: first.completionBefore ?? percent, nodeCount: nodes.length, states: Object.fromEntries(nodes.map((node) => [node.key, node.stateCode])), startedAt: first.createdAt.toISOString() }
    : currentBaseline(nodes, percent, new Date(now.getTime() - FIRST_TURN_CLOCK_SLACK_MS)));
  const facts = await signalFacts(prisma, input, { nodes, reopenCode, baseline, percent, prior, chat: Boolean(chat), now, policy });
  const enabled = new Set(defs.map((def) => def.key));
  const signals: SignalMap = {};
  for (const [key, value] of Object.entries(facts.signals)) if (enabled.has(key)) signals[key] = value;
  // Always persist the drafting+settled rank so later turns can treat open → drafted as progress.
  signals.state_progress = facts.stateProgressAfter;
  const triggers = eligibleTriggers({
    explicit: input.explicitTrigger ?? null,
    nodesReopened: facts.signals.nodes_reopened ?? 0,
    gapMinutes: facts.gapMinutes,
    userJustSpoke: Boolean(input.userJustSpoke),
    pauseAfterMinutes: pauseIdleMinutes(rules),
  });
  const trigger = primaryTrigger(triggers, input.explicitTrigger ?? null);
  const ranked = rankMatchingRules(rules, signals, triggers);
  const phrase = await phraseValues(prisma, input.proposalId, nodes, baseline, percent, reopenCode);
  const suggestedMoves = toSuggestedMoves(ranked, settings.maxSuggestedMoves, phrase);
  const actionTaken = input.actionTaken ? await resolveActionCode(prisma, input.actionTaken) : null;
  const chosenMove = input.chosenMove && await prisma.guidanceMove.findUnique({ where: { key: input.chosenMove }, select: { key: true } }) ? input.chosenMove : null;
  const completionBefore = latest?.completionAfter ?? percent;
  if (record === "preview" && latest) {
    return { eventId: latest.id, sessionId: input.sessionId, turnIndex: latest.turnIndex, trigger, signals, suggestedMoves, recorded: false };
  }
  const event = await insertEvent(prisma, {
    proposalId: input.proposalId, sessionId: input.sessionId, trigger, signals,
    firedRuleIds: ranked.slice(0, MAX_FIRED_RULES).map((rule) => rule.id),
    chosenMove, actionTaken, completionBefore, completionAfter: percent,
    sessionBaseline: prior.length === 0 ? baseline : undefined,
  });
  return { eventId: event.id, sessionId: input.sessionId, turnIndex: event.turnIndex, trigger, signals, suggestedMoves, recorded: true };
}

async function signalFacts(prisma: PrismaClient, input: GuidanceTurnInput, ctx: {
  nodes: TreeNode[]; reopenCode: string | null; baseline: SessionBaseline; percent: number; prior: PriorEvent[]; chat: boolean; now: Date;
  policy: { states: Array<{ code: string; completionWeight: number }> };
}): Promise<{ signals: SignalMap; gapMinutes: number; stateProgressAfter: number }> {
  const since = new Date(ctx.baseline.startedAt);
  const [unsureStates, openStatuses, unboundedKind, parkedChanges, parkedItems, messages] = await Promise.all([
    prisma.proposalPartResolution.findMany({ where: { flagsForCall: true }, select: { stateCode: true } }),
    prisma.proposalReviewCommentStatus.findMany({ where: { open: true }, select: { code: true } }),
    prisma.proposalReviewFlagKind.findUnique({ where: { code: "unbounded" }, select: { code: true } }),
    prisma.proposalParkedChange.count({ where: { proposalId: input.proposalId, createdAt: { gte: since } } }),
    prisma.proposalIntakePark.count({ where: { proposalId: input.proposalId, createdAt: { gte: since } } }),
    ctx.chat
      ? prisma.chatMessage.findMany({ where: { sessionId: input.sessionId, role: "user" }, orderBy: { createdAt: "desc" }, take: input.userJustSpoke ? 2 : 1, select: { createdAt: true } })
      : Promise.resolve([] as { createdAt: Date }[]),
  ]);
  const openCodes = openStatuses.map((status) => status.code);
  const unbounded = unboundedKind
    ? await prisma.proposalReviewFlag.count({ where: { proposalId: input.proposalId, kind: unboundedKind.code, status: { in: openCodes.length ? openCodes : ["open"] } } })
    : 0;
  const unsure = new Set(unsureStates.map((row) => row.stateCode));
  const nodesReopened = ctx.nodes.filter((node) => ctx.reopenCode !== null && node.stateCode === ctx.reopenCode && ctx.baseline.states[node.key] !== ctx.reopenCode).length;
  const anchor = input.userJustSpoke ? messages[1]?.createdAt ?? null : messages[0]?.createdAt ?? ctx.prior.at(-1)?.createdAt ?? null;
  const gapMinutes = anchor ? Math.max(0, Math.floor((ctx.now.getTime() - anchor.getTime()) / 60_000)) : 0;
  const completionBefore = ctx.prior.at(-1)?.completionAfter ?? ctx.percent;
  const stateProgressAfter = stateProgress(ctx.nodes, ctx.policy);
  const lastSignals = ctx.prior.at(-1) ? asSignals(ctx.prior.at(-1)!.signals) : {};
  const stateProgressBefore = typeof lastSignals.state_progress === "number" ? lastSignals.state_progress : stateProgressAfter;
  const prior = ctx.prior.map((event, index, rows) => {
    const signals = asSignals(event.signals);
    const previous = index === 0 ? undefined : asSignals(rows[index - 1]!.signals).state_progress;
    return {
      completionBefore: event.completionBefore,
      completionAfter: event.completionAfter,
      stateProgressBefore: typeof previous === "number" ? previous : null,
      stateProgressAfter: typeof signals.state_progress === "number" ? signals.state_progress : null,
    };
  });
  return {
    gapMinutes,
    stateProgressAfter,
    signals: computeTurnSignals({
      completion: ctx.percent, baselineCompletion: ctx.baseline.completion, baselineNodeCount: ctx.baseline.nodeCount,
      nodeCount: ctx.nodes.length, nodesReopened, prior, completionBefore,
      unsureCount: ctx.nodes.filter((node) => unsure.has(node.stateCode)).length,
      unboundedFlags: unbounded, idleMinutes: input.userJustSpoke ? 0 : gapMinutes,
      parkedCount: parkedChanges + parkedItems,
      stateProgressBefore, stateProgressAfter,
    }),
  };
}

async function insertEvent(prisma: PrismaClient, row: {
  proposalId: string; sessionId: string; trigger: string; signals: SignalMap; firedRuleIds: string[];
  chosenMove: string | null; actionTaken: string | null; completionBefore: number; completionAfter: number; sessionBaseline?: SessionBaseline;
}) {
  const data = {
    proposalId: row.proposalId, sessionId: row.sessionId, trigger: row.trigger,
    signals: row.signals as Prisma.InputJsonValue, firedRuleIds: row.firedRuleIds,
    chosenMove: row.chosenMove, actionTaken: row.actionTaken,
    completionBefore: row.completionBefore, completionAfter: row.completionAfter,
    ...(row.sessionBaseline ? { sessionBaseline: row.sessionBaseline as Prisma.InputJsonValue } : {}),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const last = await tx.guidanceSessionEvent.findFirst({ where: { sessionId: row.sessionId }, orderBy: { turnIndex: "desc" }, select: { turnIndex: true } });
        return tx.guidanceSessionEvent.create({ data: { ...data, turnIndex: (last?.turnIndex ?? 0) + 1 } });
      });
    } catch (error) {
      if (attempt === 0 && (error as { code?: string }).code === "P2002") continue;
      throw error;
    }
  }
  throw new Error("The guidance turn could not be stored.");
}

export async function resolveActionCode(prisma: PrismaClient, action: string): Promise<string> {
  const outcome = await prisma.guidanceOutcomeCode.findUnique({ where: { code: action }, select: { code: true } });
  return outcome?.code ?? action;
}

export async function noteGuidanceAction(prisma: PrismaClient, input: {
  proposalId: string; sessionId: string; actionTaken: string; chosenMove?: string | null; explicitTrigger?: string | null;
}): Promise<void> {
  try {
    const settings = await loadGuidanceSettings(prisma);
    const latest = await prisma.guidanceSessionEvent.findFirst({
      where: { proposalId: input.proposalId, sessionId: input.sessionId },
      orderBy: { turnIndex: "desc" },
    });
    const age = latest ? Date.now() - latest.createdAt.getTime() : Number.POSITIVE_INFINITY;
    const actionTaken = await resolveActionCode(prisma, input.actionTaken);
    const chosenMove = input.chosenMove && await prisma.guidanceMove.findUnique({ where: { key: input.chosenMove }, select: { key: true } }) ? input.chosenMove : null;
    if (latest && !latest.actionTaken && age <= settings.actionAttachSeconds * 1000) {
      await prisma.$transaction(async (tx) => {
        await tx.guidanceSessionEvent.update({ where: { id: latest.id }, data: { actionTaken, ...(chosenMove ? { chosenMove } : {}) } });
        if (await tx.guidanceOutcomeCode.findUnique({ where: { code: actionTaken }, select: { code: true } })) {
          try {
            await tx.guidanceOutcome.create({ data: { proposalId: input.proposalId, sessionId: input.sessionId, outcomeCode: actionTaken, eventId: latest.id } });
          } catch (error) {
            if ((error as { code?: string }).code !== "P2002") throw error;
          }
        }
      });
      return;
    }
    await proposalGuidanceTurn(prisma, {
      proposalId: input.proposalId, sessionId: input.sessionId, explicitTrigger: input.explicitTrigger,
      actionTaken, chosenMove: input.chosenMove ?? null, record: "always",
    });
  } catch (error) {
    console.error("guidance action not recorded", error);
  }
}

export async function listGuidanceEvents(prisma: PrismaClient, proposalId: string, limit: number) {
  const [events, rules, settings] = await Promise.all([
    prisma.guidanceSessionEvent.findMany({ where: { proposalId }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.guidanceRule.findMany(),
    loadGuidanceSettings(prisma),
  ]);
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  return {
    items: events.map((event) => {
      const firedRules = event.firedRuleIds.flatMap((id) => {
        const rule = byId.get(id);
        return rule ? [{
          ruleId: rule.id, ruleKey: rule.key, name: rule.name, move: rule.suggestedMove,
          clientPhrase: rule.clientPhrase, staffNote: rule.staffNote,
          weight: rule.learnedWeight ?? rule.baseWeight, priority: rule.priority,
        }] : [];
      });
      return {
        id: event.id, sessionId: event.sessionId, turnIndex: event.turnIndex, trigger: event.trigger,
        signals: event.signals, firedRules, suggestedMoves: firedRules.slice(0, settings.maxSuggestedMoves),
        chosenMove: event.chosenMove, actionTaken: event.actionTaken,
        completionBefore: event.completionBefore, completionAfter: event.completionAfter,
        createdAt: event.createdAt.toISOString(),
      };
    }),
  };
}

export async function safeGuidanceTurn(prisma: PrismaClient, input: GuidanceTurnInput): Promise<GuidanceTurnView | null> {
  try {
    return await proposalGuidanceTurn(prisma, input);
  } catch (error) {
    console.error("guidance turn failed", error);
    return null;
  }
}
