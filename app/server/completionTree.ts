export type NodeState = {
  code: string;
  sortOrder: number;
  clientLabel: string;
  completionWeight: number;
  reopensDownstream: boolean;
  isReopenTarget: boolean;
  isLock: boolean;
};

export type TreeNode = {
  id: string;
  key: string;
  kind: string;
  title: string;
  clientLabel: string;
  stateCode: string;
  lockedVersionId: string | null;
  sortOrder: number;
  parentKey: string | null;
};

export type TreeEdge = { id: string; fromKey: string; toKey: string };

export type CompletionPolicy = {
  states: NodeState[];
  copy: Record<string, string>;
};

export class CompletionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function stateBy(policy: CompletionPolicy, code: string): NodeState {
  const state = policy.states.find((item) => item.code === code);
  if (!state) throw new CompletionError(500, "INTERNAL_ERROR", `Node state ${code} is not configured.`);
  return state;
}

export function reopenState(policy: CompletionPolicy): NodeState {
  const state = policy.states.find((item) => item.isReopenTarget);
  if (!state) throw new CompletionError(500, "INTERNAL_ERROR", "No reopen state is configured.");
  return state;
}

export function lockState(policy: CompletionPolicy): NodeState {
  const state = policy.states.find((item) => item.isLock);
  if (!state) throw new CompletionError(500, "INTERNAL_ERROR", "No lock state is configured.");
  return state;
}

export function completionPercent(nodes: TreeNode[], policy: CompletionPolicy): number {
  if (nodes.length === 0) return 0;
  const full = Math.max(...policy.states.map((state) => state.completionWeight), 0);
  if (full <= 0) return 0;
  const earned = nodes.reduce((sum, node) => sum + (stateBy(policy, node.stateCode).completionWeight), 0);
  return Math.round((earned / (nodes.length * full)) * 100);
}

export function downstreamKeys(start: string, edges: TreeEdge[]): string[] {
  const seen = new Set<string>();
  const queue = edges.filter((edge) => edge.fromKey === start).map((edge) => edge.toKey);
  while (queue.length) {
    const key = queue.shift()!;
    if (seen.has(key) || key === start) continue;
    seen.add(key);
    for (const edge of edges) if (edge.fromKey === key) queue.push(edge.toKey);
  }
  return [...seen];
}

function listPhrase(labels: string[]): string {
  if (labels.length === 0) return "nothing";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

export type Impact = {
  reopened: Array<{ key: string; clientLabel: string; from: string; to: string }>;
  held: Array<{ key: string; clientLabel: string; state: string }>;
  percentBefore: number;
  percentAfter: number;
  sentence: string;
};

/** Options for previewImpact. lead replaces the "Adding {change}" opening, for actions that are not additions (such as an unlock). */
export type ImpactOptions = { lead?: string };

export function previewImpact(nodes: TreeNode[], edges: TreeEdge[], policy: CompletionPolicy, nodeKey: string, change: string, options: ImpactOptions = {}): Impact {
  const node = nodes.find((item) => item.key === nodeKey);
  if (!node) throw new CompletionError(404, "NOT_FOUND", "That completion node was not found.");
  const current = stateBy(policy, node.stateCode);
  const target = reopenState(policy);
  const touched = new Set<string>();
  if (current.reopensDownstream) {
    touched.add(node.key);
    // Only settled downstream parts (agreed or locked) go back to needs review. Drafted, open, and resolved parts
    // (such as staff_decides) keep their state: there is nothing settled on them to reopen.
    const byKey = new Map(nodes.map((item) => [item.key, item] as const));
    for (const key of downstreamKeys(node.key, edges)) {
      const downstream = byKey.get(key);
      if (!downstream) continue;
      const state = stateBy(policy, downstream.stateCode);
      if (state.reopensDownstream || state.isLock) touched.add(key);
    }
  }
  const after = nodes.map((item) => touched.has(item.key) ? { ...item, stateCode: target.code, lockedVersionId: null } : item);
  const reopened = nodes.filter((item) => touched.has(item.key) && item.stateCode !== target.code).map((item) => ({
    key: item.key,
    clientLabel: item.clientLabel,
    from: item.stateCode,
    to: target.code,
  }));
  const held = after.filter((item) => stateBy(policy, item.stateCode).isLock).map((item) => ({
    key: item.key,
    clientLabel: item.clientLabel,
    state: item.stateCode,
  }));
  const percentBefore = completionPercent(nodes, policy);
  const percentAfter = completionPercent(after, policy);
  const configured = policy.copy[reopened.length ? "impact_reopen" : "impact_clear"];
  if (!configured) throw new CompletionError(500, "INTERNAL_ERROR", "Impact copy is not configured.");
  let template = configured;
  if (options.lead) template = template.includes("Adding {change}") ? template.replace("Adding {change}", options.lead) : template.replace("{change}", options.lead);
  // "{held} stay locked" reads wrong with no held parts ("nothing stay locked") or one ("Scope stay locked").
  if (held.length === 0) template = template.replace(/[;,]?\s*\{held\} stays? locked\.?/, ".").replace(/\.\.$/, ".");
  else if (held.length === 1) template = template.replace("{held} stay locked", "{held} stays locked");
  const sentence = template
    .replaceAll("{change}", change)
    .replaceAll("{reopened}", listPhrase(reopened.map((item) => item.clientLabel)))
    .replaceAll("{held}", listPhrase(held.map((item) => item.clientLabel)))
    .replaceAll("{before}", String(percentBefore))
    .replaceAll("{after}", String(percentAfter));
  return { reopened, held, percentBefore, percentAfter, sentence };
}
