import type { Prisma, PrismaClient } from "@prisma/client";

const UPGRADABLE = ["open", "needs_review"] as const;

type JsonRecord = Record<string, unknown>;

const asObject = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};

const textFromBody = (body: unknown) => {
  const record = asObject(body);
  return typeof record.text === "string" ? record.text : "";
};

/** Parts that already have saved content and should show as drafted once the completion tree exists. */
export function writtenNodeKeys(input: {
  scope?: unknown;
  timeline?: unknown;
  tableMilestones?: number;
  pricing?: unknown;
  optionsCount?: number;
  narrative?: Array<{ key: string; text?: string | null }>;
}): string[] {
  const keys = new Set<string>();
  const scope = asObject(input.scope);
  const summary = String(scope.summary ?? "").trim();
  const deliverables = Array.isArray(scope.deliverables) ? scope.deliverables.map((item) => String(item).trim()).filter(Boolean) : [];
  if (summary && deliverables.length) keys.add("scope");

  const timeline = asObject(input.timeline);
  if (timeline.startDate || timeline.targetDate) keys.add("schedule");
  const jsonMilestones = Array.isArray(timeline.milestones) ? timeline.milestones.length : 0;
  if ((input.tableMilestones ?? 0) > 0 || jsonMilestones > 0) keys.add("milestones");

  const pricing = asObject(input.pricing);
  if (pricing.model && (pricing.amountMinor != null || pricing.rateMinor != null)) keys.add("price");
  if (typeof pricing.hours === "number" && pricing.hours > 0) keys.add("hours");
  if ((input.optionsCount ?? 0) > 0) keys.add("options");

  for (const part of input.narrative ?? []) {
    if (part.text && part.text.trim()) keys.add(part.key);
  }
  return [...keys];
}

export function keysToMarkDrafted(nodes: Array<{ key: string; stateCode: string }>, written: string[]) {
  const wanted = new Set(written);
  return nodes.filter((node) => wanted.has(node.key) && (UPGRADABLE as readonly string[]).includes(node.stateCode)).map((node) => node.key);
}

export async function markWrittenParts(prisma: PrismaClient | Prisma.TransactionClient, proposalId: string, onlyKeys?: string[]) {
  const nodes = await prisma.proposalNode.findMany({ where: { proposalId }, select: { key: true, stateCode: true, body: true } });
  if (nodes.length === 0) return [];
  let written = onlyKeys;
  if (!written) {
    const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { options: true, milestones: true } });
    if (!proposal) return [];
    written = writtenNodeKeys({
      scope: proposal.scope,
      timeline: proposal.timeline,
      tableMilestones: proposal.milestones.length,
      pricing: proposal.pricing,
      optionsCount: proposal.options.length,
      narrative: nodes.map((node) => ({ key: node.key, text: textFromBody(node.body) })),
    });
  }
  const keys = keysToMarkDrafted(nodes, written);
  if (keys.length === 0) return [];
  await prisma.proposalNode.updateMany({
    where: { proposalId, key: { in: keys }, stateCode: { in: [...UPGRADABLE] } },
    data: { stateCode: "drafted" },
  });
  return keys;
}

export function writtenKeysForPatch(input: { scope?: unknown; timeline?: unknown; pricing?: unknown }) {
  const keys: string[] = [];
  if (input.scope !== undefined) keys.push("scope");
  if (input.pricing !== undefined) {
    keys.push("price");
    const pricing = asObject(input.pricing);
    if (typeof pricing.hours === "number" && pricing.hours > 0) keys.push("hours");
  }
  if (input.timeline !== undefined) {
    const timeline = asObject(input.timeline);
    if (timeline.startDate || timeline.targetDate) keys.push("schedule");
    if (Array.isArray(timeline.milestones) && timeline.milestones.length > 0) keys.push("milestones");
  }
  return keys;
}
