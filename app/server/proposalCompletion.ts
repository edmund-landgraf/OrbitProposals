import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  completionPercent,
  previewImpact,
  stateBy,
  type CompletionPolicy,
  type Impact,
  type ImpactOptions,
  type TreeEdge,
  type TreeNode,
} from "./completionTree.js";
import { CompletionError, lockState, reopenState } from "./completionTree.js";
import { markWrittenParts } from "./proposalWrittenState.js";

export type CompletionStore = {
  policy(): Promise<CompletionPolicy & { parkModes: Array<{ code: string; clientLabel: string; reopens: boolean }> }>;
  ensure(proposalId: string): Promise<void>;
  nodes(proposalId: string): Promise<TreeNode[]>;
  edges(proposalId: string): Promise<TreeEdge[]>;
  setNode(id: string, data: { stateCode?: string; lockedVersionId?: string | null; body?: Prisma.InputJsonValue }): Promise<void>;
  record(row: { proposalId: string; percentBefore: number; percentAfter: number; reason: string; actorId: string | null }): Promise<void>;
  history(proposalId: string): Promise<Array<{ id: string; percentBefore: number; percentAfter: number; reason: string; createdAt: string }>>;
  park(row: { proposalId: string; nodeKey: string; summary: string; mode: string; swapSummary: string | null; actorId: string | null }): Promise<{ id: string }>;
  parked(proposalId: string): Promise<Array<{ id: string; nodeKey: string; summary: string; mode: string; swapSummary: string | null }>>;
  addEdge(proposalId: string, fromKey: string, toKey: string): Promise<TreeEdge>;
  removeEdge(proposalId: string, edgeId: string): Promise<void>;
  versionExists(versionId: string, proposalId: string): Promise<boolean>;
  parkItem(proposalId: string, summary: string, actorId: string | null): Promise<{ id: string; summary: string }>;
  listParkedItems(proposalId: string): Promise<Array<{ id: string; summary: string; createdAt: string }>>;
};

export function prismaCompletionStore(prisma: PrismaClient): CompletionStore {
  return {
    async policy() {
      const [states, copy, parkModes] = await Promise.all([
        prisma.proposalNodeState.findMany({ orderBy: { sortOrder: "asc" } }),
        prisma.proposalCompletionCopy.findMany(),
        prisma.proposalParkMode.findMany(),
      ]);
      return {
        states,
        copy: Object.fromEntries(copy.map((row) => [row.code, row.template])),
        parkModes,
      };
    },
    async ensure(proposalId) {
      const count = await prisma.proposalNode.count({ where: { proposalId } });
      if (count > 0) return;
      const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { templateCode: true } });
      if (!proposal) throw new CompletionError(404, "NOT_FOUND", "Proposal not found.");
      const [templates, edges, open] = await Promise.all([
        templateNodes(prisma, proposal.templateCode),
        prisma.proposalNodeEdgeTemplate.findMany(),
        prisma.proposalNodeState.findFirst({ where: { reopensDownstream: false, isLock: false, isReopenTarget: false }, orderBy: { sortOrder: "asc" } }),
      ]);
      if (!open) throw new CompletionError(500, "INTERNAL_ERROR", "No starting node state is configured.");
      const created = new Map<string, string>();
      for (const template of templates) {
        const node = await prisma.proposalNode.create({
          data: {
            proposalId,
            key: template.key,
            kind: template.kind,
            title: template.title,
            clientLabel: template.clientLabel,
            stateCode: open.code,
            sortOrder: template.sortOrder,
            parentKey: template.parentKey,
          },
        });
        created.set(template.key, node.id);
      }
      for (const edge of edges) {
        const fromNodeId = created.get(edge.fromKey);
        const toNodeId = created.get(edge.toKey);
        if (!fromNodeId || !toNodeId) continue;
        await prisma.proposalNodeEdge.create({ data: { proposalId, fromNodeId, toNodeId } });
      }
      await markWrittenParts(prisma, proposalId);
    },
    async nodes(proposalId) {
      const rows = await prisma.proposalNode.findMany({ where: { proposalId }, orderBy: { sortOrder: "asc" } });
      return rows.map(presentNode);
    },
    async edges(proposalId) {
      const rows = await prisma.proposalNodeEdge.findMany({ where: { proposalId }, include: { fromNode: true, toNode: true } });
      return rows.map((row) => ({ id: row.id, fromKey: row.fromNode.key, toKey: row.toNode.key }));
    },
    async setNode(id, data) {
      await prisma.proposalNode.update({ where: { id }, data });
    },
    async record(row) {
      await prisma.proposalCompletionEvent.create({ data: row });
    },
    async history(proposalId) {
      const rows = await prisma.proposalCompletionEvent.findMany({ where: { proposalId }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => ({ id: row.id, percentBefore: row.percentBefore, percentAfter: row.percentAfter, reason: row.reason, createdAt: row.createdAt.toISOString() }));
    },
    async park(row) {
      const created = await prisma.proposalParkedChange.create({ data: row });
      return { id: created.id };
    },
    async parked(proposalId) {
      const rows = await prisma.proposalParkedChange.findMany({ where: { proposalId }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => ({ id: row.id, nodeKey: row.nodeKey, summary: row.summary, mode: row.mode, swapSummary: row.swapSummary }));
    },
    async addEdge(proposalId, fromKey, toKey) {
      const nodes = await prisma.proposalNode.findMany({ where: { proposalId, key: { in: [fromKey, toKey] } } });
      const from = nodes.find((item) => item.key === fromKey);
      const to = nodes.find((item) => item.key === toKey);
      if (!from || !to) throw new CompletionError(404, "NOT_FOUND", "Both nodes must exist.");
      const created = await prisma.proposalNodeEdge.create({ data: { proposalId, fromNodeId: from.id, toNodeId: to.id } });
      return { id: created.id, fromKey, toKey };
    },
    async removeEdge(proposalId, edgeId) {
      await prisma.proposalNodeEdge.deleteMany({ where: { id: edgeId, proposalId } });
    },
    async versionExists(versionId, proposalId) {
      const version = await prisma.proposalVersion.findFirst({ where: { id: versionId, proposalId } });
      return Boolean(version);
    },
    async parkItem(proposalId, summary, actorId) {
      const created = await prisma.proposalIntakePark.create({ data: { proposalId, summary, actorId } });
      return { id: created.id, summary: created.summary };
    },
    async listParkedItems(proposalId) {
      const rows = await prisma.proposalIntakePark.findMany({ where: { proposalId }, orderBy: { createdAt: "asc" } });
      return rows.map((row) => ({ id: row.id, summary: row.summary, createdAt: row.createdAt.toISOString() }));
    },
  };
}

function presentNode(row: { id: string; key: string; kind: string; title: string; clientLabel: string; stateCode: string; lockedVersionId: string | null; sortOrder: number; parentKey: string | null }): TreeNode {
  return row;
}

export async function treeView(store: CompletionStore, proposalId: string) {
  await store.ensure(proposalId);
  const policy = await store.policy();
  const [nodes, edges, history, parked] = await Promise.all([store.nodes(proposalId), store.edges(proposalId), store.history(proposalId), store.parked(proposalId)]);
  return {
    percent: completionPercent(nodes, policy),
    nodes: nodes.map((node) => ({ ...node, stateLabel: policy.states.find((state) => state.code === node.stateCode)?.clientLabel ?? node.stateCode })),
    edges,
    history,
    parked,
    states: policy.states.map((state) => ({ code: state.code, clientLabel: state.clientLabel, completionWeight: state.completionWeight })),
    parkModes: policy.parkModes,
  };
}

export async function previewChange(store: CompletionStore, proposalId: string, nodeKey: string, change: string, options: ImpactOptions = {}): Promise<Impact> {
  await store.ensure(proposalId);
  const policy = await store.policy();
  return previewImpact(await store.nodes(proposalId), await store.edges(proposalId), policy, nodeKey, change, options);
}

export async function applyChange(store: CompletionStore, proposalId: string, nodeKey: string, change: string, actorId: string, options: ImpactOptions = {}) {
  const impact = await previewChange(store, proposalId, nodeKey, change, options);
  const policy = await store.policy();
  const target = reopenState(policy);
  const nodes = await store.nodes(proposalId);
  for (const item of impact.reopened) {
    const node = nodes.find((candidate) => candidate.key === item.key);
    if (!node) continue;
    await store.setNode(node.id, { stateCode: target.code, lockedVersionId: null, body: { change, sourceKey: nodeKey } });
  }
  if (impact.percentBefore !== impact.percentAfter) {
    await store.record({ proposalId, percentBefore: impact.percentBefore, percentAfter: impact.percentAfter, reason: impact.sentence, actorId });
  }
  return { ...impact, applied: true as const };
}

export async function parkChange(store: CompletionStore, proposalId: string, input: { nodeKey: string; change: string; mode: string; swapSummary?: string; actorId: string }) {
  await store.ensure(proposalId);
  const policy = await store.policy();
  const mode = policy.parkModes.find((item) => item.code === input.mode);
  if (!mode) throw new CompletionError(400, "VALIDATION_FAILED", "That park mode is not configured.");
  if (mode.reopens) throw new CompletionError(409, "CONFLICT", "That mode would reopen the tree.");
  if (input.mode === "swap" && !input.swapSummary?.trim()) throw new CompletionError(400, "VALIDATION_FAILED", "A swap needs a replacement of similar size.");
  const nodes = await store.nodes(proposalId);
  if (!nodes.some((node) => node.key === input.nodeKey)) throw new CompletionError(404, "NOT_FOUND", "That completion node was not found.");
  const parked = await store.park({
    proposalId,
    nodeKey: input.nodeKey,
    summary: input.change,
    mode: mode.code,
    swapSummary: input.swapSummary?.trim() || null,
    actorId: input.actorId,
  });
  return { ...parked, reopened: [] as string[], percent: completionPercent(nodes, policy) };
}

export async function lockNode(store: CompletionStore, proposalId: string, nodeKey: string, versionId: string, actorId: string) {
  await store.ensure(proposalId);
  // An unknown version is a missing resource, not a state conflict.
  if (!(await store.versionExists(versionId, proposalId))) throw new CompletionError(404, "NOT_FOUND", `Proposal version ${versionId} was not found on this proposal. A lock must cite one of its version snapshots (unw_list_review_feedback versions[].id).`);
  const policy = await store.policy();
  const locked = lockState(policy);
  const nodes = await store.nodes(proposalId);
  const node = nodes.find((item) => item.key === nodeKey);
  if (!node) throw new CompletionError(404, "NOT_FOUND", "That completion node was not found.");
  const before = completionPercent(nodes, policy);
  await store.setNode(node.id, { stateCode: locked.code, lockedVersionId: versionId });
  const afterNodes = nodes.map((item) => item.id === node.id ? { ...item, stateCode: locked.code, lockedVersionId: versionId } : item);
  const after = completionPercent(afterNodes, policy);
  await store.record({ proposalId, percentBefore: before, percentAfter: after, reason: `Locked ${node.clientLabel} on version ${versionId}.`, actorId });
  return { key: node.key, state: locked.code, lockedVersionId: versionId, percent: after };
}

/**
 * Unlocks one part. The part and any agreed or locked parts downstream go back to needs review; drafted, open, and
 * resolved parts keep their state. Unlocking a part that is not agreed or locked changes nothing and reports applied: false.
 */
export async function unlockNode(store: CompletionStore, proposalId: string, nodeKey: string, actorId: string) {
  await store.ensure(proposalId);
  const [policy, nodes] = await Promise.all([store.policy(), store.nodes(proposalId)]);
  const node = nodes.find((item) => item.key === nodeKey);
  if (!node) throw new CompletionError(404, "NOT_FOUND", "That completion node was not found.");
  const label = node.clientLabel || node.title || node.key;
  const state = stateBy(policy, node.stateCode);
  if (!state.reopensDownstream && !state.isLock && !node.lockedVersionId) {
    const impact = previewImpact(nodes, await store.edges(proposalId), policy, nodeKey, label, { lead: `Unlocking ${label}` });
    return { ...impact, sentence: `${label} is not locked or agreed, so unlocking it changes nothing.`, applied: false as const };
  }
  return applyChange(store, proposalId, nodeKey, label, actorId, { lead: `Unlocking ${label}` });
}

/** True when a node holds client-written narrative text (body.text). */
export const hasWrittenText = (body: unknown) => !!body && typeof body === "object" && !Array.isArray(body) && typeof (body as { text?: unknown }).text === "string" && (body as { text: string }).text.trim().length > 0;

/**
 * Rebuilds a draft's parts from another template. Parts in both keep their state and text. Parts the new template lacks
 * are removed unless they hold written narrative text: those stay as extra top-level parts so switching templates
 * (even through one that lacks the part) never loses what the client wrote. Returns the keys kept that way.
 */
export async function retargetTemplate(prisma: PrismaClient, proposalId: string, templateCode: string): Promise<{ keptWritten: string[] }> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { status: true, reviewState: true } });
  if (!proposal) throw new CompletionError(404, "NOT_FOUND", "Proposal not found.");
  if (proposal.status !== "draft") throw new CompletionError(409, "CONFLICT", "Only a draft proposal can change its template.");
  const review = await prisma.proposalReviewStatus.findUnique({ where: { code: proposal.reviewState } });
  if (review && !review.clientEditable) throw new CompletionError(409, "CONFLICT", "This proposal is locked for review, so its template can no longer change. Start a revision first.");
  const locked = await prisma.proposalNode.count({ where: { proposalId, lockedVersionId: { not: null } } });
  if (locked > 0) throw new CompletionError(409, "CONFLICT", "This proposal has a locked section, so its template can no longer change. Start a revision first.");
  const templates = await templateNodes(prisma, templateCode);
  const open = await prisma.proposalNodeState.findFirst({ where: { reopensDownstream: false, isLock: false, isReopenTarget: false }, orderBy: { sortOrder: "asc" } });
  if (!open) throw new CompletionError(500, "INTERNAL_ERROR", "No starting node state is configured.");
  const edges = await prisma.proposalNodeEdgeTemplate.findMany();
  const keptWritten: string[] = [];
  await prisma.$transaction(async (tx) => {
    const existing = await tx.proposalNode.findMany({ where: { proposalId } });
    const byKey = new Map(existing.map((node) => [node.key, node]));
    await tx.proposalNodeEdge.deleteMany({ where: { proposalId } });
    const templateKeys = new Set(templates.map((item) => item.key));
    const kept = existing.filter((node) => !templateKeys.has(node.key) && hasWrittenText(node.body));
    keptWritten.push(...kept.map((node) => node.key));
    await tx.proposalNode.deleteMany({ where: { proposalId, key: { notIn: [...templateKeys, ...keptWritten] } } });
    const lastOrder = Math.max(0, ...templates.filter((item) => !item.parentKey).map((item) => item.sortOrder));
    for (const [index, node] of kept.entries()) {
      await tx.proposalNode.update({ where: { id: node.id }, data: { parentKey: null, sortOrder: lastOrder + (index + 1) * 10 } });
    }
    const created = new Map<string, string>(kept.map((node) => [node.key, node.id]));
    for (const template of templates) {
      const current = byKey.get(template.key);
      if (current) {
        const updated = await tx.proposalNode.update({
          where: { id: current.id },
          data: { kind: template.kind, title: template.title, clientLabel: template.clientLabel, sortOrder: template.sortOrder, parentKey: template.parentKey },
        });
        created.set(template.key, updated.id);
      } else {
        const node = await tx.proposalNode.create({
          data: { proposalId, key: template.key, kind: template.kind, title: template.title, clientLabel: template.clientLabel, stateCode: open.code, sortOrder: template.sortOrder, parentKey: template.parentKey },
        });
        created.set(template.key, node.id);
      }
    }
    for (const edge of edges) {
      const fromNodeId = created.get(edge.fromKey);
      const toNodeId = created.get(edge.toKey);
      if (!fromNodeId || !toNodeId) continue;
      await tx.proposalNodeEdge.create({ data: { proposalId, fromNodeId, toNodeId } });
    }
    await tx.proposal.update({ where: { id: proposalId }, data: { templateCode } });
  });
  return { keptWritten };
}

/** The nodes a template builds, in the template's order and with its parent links; parents outside the template are dropped. */
export async function templateNodes(prisma: PrismaClient, templateCode: string) {
  const rows = await prisma.proposalTemplateNode.findMany({ where: { templateCode }, include: { node: true }, orderBy: { sortOrder: "asc" } });
  if (rows.length === 0) throw new CompletionError(500, "INTERNAL_ERROR", `Proposal template ${templateCode} has no nodes.`);
  const keys = new Set(rows.map((row) => row.nodeKey));
  return rows.map((row) => ({
    key: row.nodeKey,
    kind: row.node.kind,
    title: row.node.title,
    clientLabel: row.node.clientLabel,
    sortOrder: row.sortOrder,
    parentKey: row.parentKey && keys.has(row.parentKey) ? row.parentKey : null,
  }));
}