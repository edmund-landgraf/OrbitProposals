import type { PrismaClient } from "@prisma/client";
import { completionPercent, downstreamKeys, reopenState, type CompletionPolicy, type TreeEdge, type TreeNode } from "./completionTree.js";
import { CompletionError } from "./completionTree.js";
import { treeView, type CompletionStore } from "./proposalCompletion.js";

export type ProgressGroup = { code: string; clientLabel: string; sortOrder: number; settled: boolean; toDiscuss?: boolean; nextStepPriority: number | null; whatsLeft: string; nextStep: string };
export type ProgressPolicy = {
  groups: ProgressGroup[];
  stateGroups: Record<string, string>;
  phrases: Array<{ code: string; minPercent: number; phrase: string }>;
  copy: Record<string, string>;
};
export type PartResolution = { stateCode: string; clientLabel: string; sortOrder: number; clientCan: boolean; agentCan: boolean; flagsForCall: boolean };
export type HandoffReason = { code: string; clientLabel: string; sortOrder: number; turnThreshold: number | null; automatic: boolean };
export type HandoffEntry = { id: string; reasonCode: string; note: string | null; createdAt: string };
export type ProgressNode = TreeNode & { body?: unknown };
export type ProgressSnapshot = { percent: number; states: Record<string, string>; seenAt: string };
export type ParkedEntry = { id: string; summary: string; nodeKey?: string | null };

export type ProgressPart = {
  key: string;
  label: string;
  state: string;
  stateLabel: string;
  group: string;
  settled: boolean;
  whatsLeft: string;
  toDiscuss: boolean;
  note: string | null;
  reopenedBy: { source: string; change: string } | null;
  dependsOn: string[];
};

export type ProposalProgress = {
  settled: number;
  toDiscuss: number;
  total: number;
  headline: string;
  phrase: string;
  percent: number;
  groups: Array<{ code: string; label: string; settled: boolean; parts: ProgressPart[] }>;
  nextStep: { key: string | null; text: string };
  savedForLater: { heading: string; note: string; items: ParkedEntry[] };
  sinceLastVisit: { direction: "down" | "up"; before: number; after: number; text: string; reopened: Array<{ source: string; change: string; parts: string[] }> } | null;
  lastSeenAt: string | null;
  resolutions: Array<{ code: string; label: string; flagsForCall: boolean }>;
  statuses: Array<{ code: string; label: string }>;
  handoff: {
    ready: boolean;
    heading: string;
    body: string;
    submitLabel: string;
    reasons: Array<{ code: string; label: string; note: string | null }>;
    openParts: string[];
    draftedParts: string[];
    reopenedParts: string[];
    discussParts: string[];
    openSummary: string;
  };
};

function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

function listPhrase(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function capitalize(text: string) { return text ? text[0]!.toUpperCase() + text.slice(1) : text; }

function copyOf(policy: ProgressPolicy, code: string) {
  const template = policy.copy[code];
  if (template === undefined) throw new CompletionError(500, "INTERNAL_ERROR", `Progress copy ${code} is not configured.`);
  return template;
}

function reopenSource(node: ProgressNode, nodes: ProgressNode[], edges: TreeEdge[]): { source: string; change: string } {
  const body = node.body && typeof node.body === "object" ? node.body as Record<string, unknown> : {};
  const change = typeof body.change === "string" ? body.change : "";
  const sourceKey = typeof body.sourceKey === "string" ? body.sourceKey : edges.find((edge) => edge.toKey === node.key)?.fromKey;
  const source = nodes.find((item) => item.key === sourceKey) ?? node;
  return { source: source.clientLabel, change };
}

/** Pure: turns completion-tree data plus progress rows into the client-facing summary. */
export function buildProgress(input: {
  nodes: ProgressNode[];
  edges: TreeEdge[];
  completion: CompletionPolicy;
  policy: ProgressPolicy;
  parked: ParkedEntry[];
  snapshot: ProgressSnapshot | null;
  resolutions?: PartResolution[];
  handoffReasons?: HandoffReason[];
  handoffs?: HandoffEntry[];
}): ProposalProgress {
  const { nodes, edges, completion, policy } = input;
  const percent = completionPercent(nodes, completion);
  const groupOf = (stateCode: string) => {
    const code = policy.stateGroups[stateCode];
    const group = policy.groups.find((item) => item.code === code);
    if (!group) throw new CompletionError(500, "INTERNAL_ERROR", `Node state ${stateCode} has no progress group.`);
    return group;
  };
  const isSettledState = (stateCode: string) => Boolean(policy.stateGroups[stateCode]) && groupOf(stateCode).settled;
  const reopenTarget = completion.states.find((state) => state.isReopenTarget)?.code;

  const parts: ProgressPart[] = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder).map((node) => {
    const group = groupOf(node.stateCode);
    const reopenedBy = node.stateCode === reopenTarget ? reopenSource(node, nodes, edges) : null;
    const reason = reopenedBy && reopenedBy.change ? fill(copyOf(policy, "reopened_by"), reopenedBy) : copyOf(policy, "reopened_by_unknown");
    const state = completion.states.find((item) => item.code === node.stateCode);
    const body = node.body && typeof node.body === "object" ? node.body as Record<string, unknown> : {};
    return {
      key: node.key,
      label: capitalize(node.clientLabel),
      state: node.stateCode,
      stateLabel: state?.clientLabel ?? node.stateCode,
      group: group.code,
      settled: group.settled,
      whatsLeft: fill(group.whatsLeft, { part: node.clientLabel, reason }),
      toDiscuss: Boolean(group.toDiscuss),
      note: !reopenedBy && typeof body.note === "string" && body.note ? body.note : null,
      reopenedBy,
      dependsOn: edges.filter((edge) => edge.toKey === node.key).map((edge) => nodes.find((item) => item.key === edge.fromKey)?.clientLabel ?? edge.fromKey),
    };
  });

  const settled = parts.filter((part) => part.settled).length;
  const total = parts.length;
  const discussParts = parts.filter((part) => part.toDiscuss);
  const openParts = parts.filter((part) => !part.settled && part.group === "needs_input");
  const draftedParts = parts.filter((part) => part.group === "in_progress");
  const reopenedParts = parts.filter((part) => part.group === "reopened");
  const phrase = [...policy.phrases].sort((a, b) => b.minPercent - a.minPercent).find((item) => percent >= item.minPercent)?.phrase ?? "";

  const groups = [...policy.groups].sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => ({ code: group.code, label: group.clientLabel, settled: group.settled, parts: parts.filter((part) => part.group === group.code) }))
    .filter((group) => group.parts.length > 0);

  // Next best step: highest-priority open group, preferring parts whose dependencies are already settled.
  const settledKeys = new Set(parts.filter((part) => part.settled).map((part) => part.key));
  const ready = (key: string) => edges.filter((edge) => edge.toKey === key).every((edge) => settledKeys.has(edge.fromKey));
  const candidates = parts.filter((part) => !part.settled).map((part) => ({ part, group: groupOf(part.state), node: nodes.find((item) => item.key === part.key)! }))
    .sort((a, b) => Number(ready(b.part.key)) - Number(ready(a.part.key)) || (a.group.nextStepPriority ?? 99) - (b.group.nextStepPriority ?? 99) || a.node.sortOrder - b.node.sortOrder);
  const next = candidates[0];
  const nextStep = next
    ? { key: next.part.key, text: fill(next.group.nextStep, { part: next.node.clientLabel, reason: next.part.reopenedBy?.change ? fill(copyOf(policy, "reopened_by"), next.part.reopenedBy) : copyOf(policy, "reopened_by_unknown") }) }
    : { key: null, text: copyOf(policy, "next_done") };

  let sinceLastVisit: ProposalProgress["sinceLastVisit"] = null;
  const snapshot = input.snapshot;
  if (snapshot && snapshot.percent !== percent) {
    if (percent < snapshot.percent) {
      const lost = parts.filter((part) => !part.settled && snapshot.states[part.key] && isSettledState(snapshot.states[part.key]!));
      const bySource = new Map<string, { source: string; change: string; parts: string[] }>();
      for (const part of lost) {
        const key = `${part.reopenedBy?.source ?? ""}|${part.reopenedBy?.change ?? ""}`;
        const entry = bySource.get(key) ?? { source: part.reopenedBy?.source ?? part.label, change: part.reopenedBy?.change ?? "", parts: [] };
        entry.parts.push(part.label);
        bySource.set(key, entry);
      }
      const reopened = [...bySource.values()];
      const reasons = reopened.map((entry) => fill(copyOf(policy, "delta_reason"), { source: entry.source, change: entry.change || copyOf(policy, "reopened_by_unknown"), parts: listPhrase(entry.parts) })).join(" ");
      sinceLastVisit = { direction: "down", before: snapshot.percent, after: percent, text: fill(copyOf(policy, "delta_down"), { before: snapshot.percent, after: percent, reasons }).trim(), reopened };
    } else {
      sinceLastVisit = { direction: "up", before: snapshot.percent, after: percent, text: fill(copyOf(policy, "delta_up"), { before: snapshot.percent, after: percent }), reopened: [] };
    }
  }

  return {
    settled,
    total,
    toDiscuss: discussParts.length,
    headline: fill(copyOf(policy, discussParts.length ? "headline_discuss" : "headline"), { settled, total, discuss: discussParts.length }),
    phrase,
    percent,
    groups,
    nextStep,
    savedForLater: { heading: copyOf(policy, "parked_heading"), note: copyOf(policy, "parked_note"), items: input.parked },
    sinceLastVisit,
    lastSeenAt: snapshot?.seenAt ?? null,
    resolutions: [...(input.resolutions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder).map((row) => ({ code: row.stateCode, label: row.clientLabel, flagsForCall: row.flagsForCall })),
    statuses: [],
    handoff: handoffView(policy, input.handoffReasons ?? [], input.handoffs ?? [], discussParts.map((part) => part.label), openParts.map((part) => part.label), draftedParts.map((part) => part.label), reopenedParts.map((part) => part.label)),
  };
}

function handoffSummary(policy: ProgressPolicy, openParts: string[], draftedParts: string[], reopenedParts: string[]): string {
  const bits: string[] = [];
  if (openParts.length) bits.push(fill(copyOf(policy, "open_for_review"), { parts: listPhrase(openParts) }));
  if (draftedParts.length) bits.push(fill(copyOf(policy, "drafted_for_review"), { parts: listPhrase(draftedParts) }));
  if (reopenedParts.length) bits.push(fill(copyOf(policy, "reopened_for_review"), { parts: listPhrase(reopenedParts) }));
  return bits.join(" ");
}

function handoffView(policy: ProgressPolicy, reasonRows: HandoffReason[], handoffs: HandoffEntry[], discussParts: string[], openParts: string[], draftedParts: string[], reopenedParts: string[]): ProposalProgress["handoff"] {
  const label = (code: string) => reasonRows.find((row) => row.code === code)?.clientLabel ?? code;
  const reasons = new Map<string, { code: string; label: string; note: string | null }>();
  for (const entry of handoffs) if (!reasons.has(entry.reasonCode)) reasons.set(entry.reasonCode, { code: entry.reasonCode, label: label(entry.reasonCode), note: entry.note });
  // Automatic reasons (e.g. parts marked unsure) make the call recommendation without the agent having to ask.
  if (discussParts.length) for (const row of reasonRows.filter((item) => item.automatic)) if (!reasons.has(row.code)) reasons.set(row.code, { code: row.code, label: row.clientLabel, note: null });
  const ordered = [...reasons.values()].sort((a, b) => (reasonRows.find((row) => row.code === a.code)?.sortOrder ?? 99) - (reasonRows.find((row) => row.code === b.code)?.sortOrder ?? 99));
  return {
    ready: ordered.length > 0,
    heading: copyOf(policy, "handoff_heading"),
    body: copyOf(policy, "handoff_body"),
    submitLabel: copyOf(policy, "handoff_submit"),
    reasons: ordered,
    openParts,
    draftedParts,
    reopenedParts,
    discussParts,
    openSummary: handoffSummary(policy, openParts, draftedParts, reopenedParts),
  };
}

export type ProgressStore = {
  policy(): Promise<ProgressPolicy>;
  nodeBodies(proposalId: string): Promise<Record<string, unknown>>;
  snapshot(proposalId: string, viewerId: string): Promise<ProgressSnapshot | null>;
  saveSnapshot(proposalId: string, viewerId: string, percent: number, states: Record<string, string>): Promise<void>;
  resolutions(): Promise<PartResolution[]>;
  handoffReasons(): Promise<HandoffReason[]>;
  handoffs(proposalId: string): Promise<HandoffEntry[]>;
  addHandoff(row: { proposalId: string; reasonCode: string; note: string | null; actorId: string | null }): Promise<HandoffEntry>;
};

export function prismaProgressStore(prisma: PrismaClient): ProgressStore {
  return {
    async policy() {
      const [groups, stateGroups, phrases, copy] = await Promise.all([
        prisma.proposalProgressGroup.findMany({ orderBy: { sortOrder: "asc" } }),
        prisma.proposalProgressStateGroup.findMany(),
        prisma.proposalProgressPhrase.findMany(),
        prisma.proposalProgressCopy.findMany(),
      ]);
      return {
        groups,
        stateGroups: Object.fromEntries(stateGroups.map((row) => [row.stateCode, row.groupCode])),
        phrases,
        copy: Object.fromEntries(copy.map((row) => [row.code, row.template])),
      };
    },
    async nodeBodies(proposalId) {
      const rows = await prisma.proposalNode.findMany({ where: { proposalId }, select: { key: true, body: true } });
      return Object.fromEntries(rows.map((row) => [row.key, row.body]));
    },
    async snapshot(proposalId, viewerId) {
      const row = await prisma.proposalProgressView.findUnique({ where: { proposalId_viewerId: { proposalId, viewerId } } });
      if (!row) return null;
      const states = row.states && typeof row.states === "object" && !Array.isArray(row.states) ? row.states as Record<string, string> : {};
      return { percent: row.percent, states, seenAt: row.seenAt.toISOString() };
    },
    async saveSnapshot(proposalId, viewerId, percent, states) {
      await prisma.proposalProgressView.upsert({
        where: { proposalId_viewerId: { proposalId, viewerId } },
        create: { proposalId, viewerId, percent, states },
        update: { percent, states, seenAt: new Date() },
      });
    },
    async resolutions() { return prisma.proposalPartResolution.findMany({ orderBy: { sortOrder: "asc" } }); },
    async handoffReasons() { return prisma.proposalHandoffReason.findMany({ orderBy: { sortOrder: "asc" } }); },
    async handoffs(proposalId) {
      const rows = await prisma.proposalHandoff.findMany({ where: { proposalId, clearedAt: null }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => ({ id: row.id, reasonCode: row.reasonCode, note: row.note, createdAt: row.createdAt.toISOString() }));
    },
    async addHandoff(row) {
      const created = await prisma.proposalHandoff.create({ data: row });
      return { id: created.id, reasonCode: created.reasonCode, note: created.note, createdAt: created.createdAt.toISOString() };
    },
  };
}

/** Reuses the same data as GET /completion (treeView) so the screen and unw_get_completion_tree never disagree. */
export async function proposalProgress(completion: CompletionStore, progress: ProgressStore, proposalId: string, viewerId: string, options: { markSeen?: boolean } = {}) {
  const tree = await treeView(completion, proposalId);
  const [policy, completionPolicy, bodies, snapshot, parkedItems, resolutions, handoffReasons, handoffs] = await Promise.all([
    progress.policy(), completion.policy(), progress.nodeBodies(proposalId), progress.snapshot(proposalId, viewerId), completion.listParkedItems(proposalId),
    progress.resolutions(), progress.handoffReasons(), progress.handoffs(proposalId),
  ]);
  const nodes: ProgressNode[] = tree.nodes.map((node) => ({ ...node, body: bodies[node.key] }));
  const parked: ParkedEntry[] = [
    ...tree.parked.map((item) => ({ id: item.id, summary: item.summary, nodeKey: item.nodeKey })),
    ...parkedItems.map((item) => ({ id: item.id, summary: item.summary, nodeKey: null })),
  ];
  const view = buildProgress({ nodes, edges: tree.edges, completion: completionPolicy, policy, parked, snapshot, resolutions, handoffReasons, handoffs });
  const resolutionCodes = new Set((resolutions ?? []).map((row) => row.stateCode));
  const statuses = clientStatuses(completionPolicy.states, resolutionCodes);
  if (options.markSeen) await progress.saveSnapshot(proposalId, viewerId, view.percent, Object.fromEntries(nodes.map((node) => [node.key, node.stateCode])));
  return { ...view, statuses };
}

/** Resolve a part without agreeing it: unsure (talk to a human), staff decides, or out of scope. Counts as settled for submission. */
export async function resolvePart(completion: CompletionStore, progress: ProgressStore, proposalId: string, input: { nodeKey: string; resolution: string; note?: string | null; actorId: string; actor: "client" | "agent" }) {
  await completion.ensure(proposalId);
  const [resolutions, policy, nodes] = await Promise.all([progress.resolutions(), completion.policy(), completion.nodes(proposalId)]);
  const resolution = resolutions.find((row) => row.stateCode === input.resolution);
  if (!resolution) throw new CompletionError(422, "VALIDATION_ERROR", `Unknown resolution. Use one of: ${resolutions.map((row) => row.stateCode).join(", ")}.`);
  if (input.actor === "client" ? !resolution.clientCan : !resolution.agentCan) throw new CompletionError(403, "FORBIDDEN", "That resolution cannot be set from here.");
  const node = nodes.find((item) => item.key === input.nodeKey);
  if (!node) throw new CompletionError(404, "NOT_FOUND", "That completion node was not found.");
  if (policy.states.find((state) => state.code === node.stateCode)?.isLock) throw new CompletionError(409, "CONFLICT", "That part is locked. Unlock it before changing how it is resolved.");
  const before = completionPercent(nodes, policy);
  const note = input.note?.trim() || null;
  await completion.setNode(node.id, { stateCode: resolution.stateCode, body: { resolution: resolution.stateCode, note } });
  const after = completionPercent(nodes.map((item) => item.id === node.id ? { ...item, stateCode: resolution.stateCode } : item), policy);
  await completion.record({ proposalId, percentBefore: before, percentAfter: after, reason: `${node.clientLabel}: ${resolution.clientLabel}${note ? ` (${note})` : ""}.`, actorId: input.actorId });
  return { key: node.key, state: resolution.stateCode, label: resolution.clientLabel, flagsForCall: resolution.flagsForCall, percent: after };
}

/** Client-editable statuses shown in the progress dropdown: Not started, Drafted, and Agreed.
 * Agreed has reopensDownstream=true (leaving it reopens downstream parts), so it must not be
 * filtered out of the list the way locked / reopen-target / resolution states are. */
export const CLIENT_STATUS_CODES = new Set(["open", "drafted", "agreed"]);

export function clientStatuses(states: Array<{ code: string; clientLabel: string; sortOrder: number }>, resolutionCodes: Set<string>) {
  return [...states]
    .filter((state) => CLIENT_STATUS_CODES.has(state.code) && !resolutionCodes.has(state.code))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((state) => ({ code: state.code, label: state.clientLabel }));
}

/** Sets a part to a client-editable status (Not started / Drafted / Agreed) or a help resolution. Locked parts cannot be changed. Leaving Agreed reopens downstream agreed or locked parts to needs review. */
export async function setPartState(completion: CompletionStore, progress: ProgressStore, proposalId: string, input: { nodeKey: string; state: string; note?: string | null; actorId: string; actor: "client" | "agent" }) {
  await completion.ensure(proposalId);
  const [resolutions, policy, nodes] = await Promise.all([progress.resolutions(), completion.policy(), completion.nodes(proposalId)]);
  if (resolutions.some((row) => row.stateCode === input.state)) {
    return resolvePart(completion, progress, proposalId, { nodeKey: input.nodeKey, resolution: input.state, note: input.note, actorId: input.actorId, actor: input.actor });
  }
  const state = policy.states.find((item) => item.code === input.state);
  if (!state || !CLIENT_STATUS_CODES.has(input.state)) {
    throw new CompletionError(422, "VALIDATION_ERROR", `Unknown status. Use one of: ${[...CLIENT_STATUS_CODES].join(", ")}, or a resolution (${resolutions.map((row) => row.stateCode).join(", ")}).`);
  }
  const node = nodes.find((item) => item.key === input.nodeKey);
  if (!node) throw new CompletionError(404, "NOT_FOUND", "That completion node was not found.");
  const current = policy.states.find((item) => item.code === node.stateCode);
  if (current?.isLock) throw new CompletionError(409, "CONFLICT", "That part is locked. Unlock it before changing its status.");
  const before = completionPercent(nodes, policy);
  await completion.setNode(node.id, { stateCode: state.code });
  const afterNodes = nodes.map((item) => item.id === node.id ? { ...item, stateCode: state.code } : item);
  if (current?.reopensDownstream && current.code !== state.code) {
    const target = reopenState(policy);
    const edges = await completion.edges(proposalId);
    const change = `${node.clientLabel} is no longer ${current.clientLabel.toLowerCase()}.`;
    for (const key of downstreamKeys(node.key, edges)) {
      const item = afterNodes.find((candidate) => candidate.key === key);
      if (!item || item.stateCode === target.code) continue;
      await completion.setNode(item.id, { stateCode: target.code, lockedVersionId: null, body: { change, sourceKey: node.key } });
      item.stateCode = target.code;
      item.lockedVersionId = null;
    }
  }
  const after = completionPercent(afterNodes, policy);
  await completion.record({ proposalId, percentBefore: before, percentAfter: after, reason: `${node.clientLabel}: ${state.clientLabel}.`, actorId: input.actorId });
  return { key: node.key, state: state.code, label: state.clientLabel, flagsForCall: false, percent: after };
}

/** Agent (or client) recommends a call with a human. Reason codes are rows in proposal_handoff_reason. */
export async function recommendHandoff(progress: ProgressStore, proposalId: string, input: { reasonCode: string; note?: string | null; actorId: string | null }) {
  const reasons = await progress.handoffReasons();
  if (!reasons.some((row) => row.code === input.reasonCode)) throw new CompletionError(422, "VALIDATION_ERROR", `Unknown handoff reason. Use one of: ${reasons.map((row) => row.code).join(", ")}.`);
  return progress.addHandoff({ proposalId, reasonCode: input.reasonCode, note: input.note?.trim() || null, actorId: input.actorId });
}
