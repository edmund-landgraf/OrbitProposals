import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export class DuplicateError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export type DuplicateInput = { sourceId: string; actorUserId: string; title?: string; engagement?: string; reason?: string };

/** Keeps the price when the engagement is unchanged. Otherwise the copy carries no amount until staff price it. */
export function duplicatePricing(source: { engagement: string; pricing: unknown }, engagement: string, target: { pricingModel: string; pendingPriceMessage: string }) {
  if (engagement === source.engagement) return { changed: false, pricing: source.pricing };
  const currency = source.pricing && typeof source.pricing === "object" && "currency" in source.pricing ? (source.pricing as { currency: unknown }).currency : undefined;
  return { changed: true, pricing: { model: target.pricingModel, ...(typeof currency === "string" ? { currency } : {}), pendingStaffPrice: true, message: target.pendingPriceMessage } };
}

export function remapTimelineMilestoneIds(timeline: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) return timeline;
  const record = timeline as Record<string, unknown>;
  if (!Array.isArray(record.milestones)) return timeline;
  return { ...record, milestones: record.milestones.map((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && ids.has((item as { id: string }).id) ? { ...item, id: ids.get((item as { id: string }).id) } : item) };
}

export const copyTitle = (title: string, override?: string) => (override?.trim() || title).slice(0, 300);

export async function duplicateProposal(prisma: PrismaClient, input: DuplicateInput) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.proposal.findUnique({ where: { id: input.sourceId }, include: { optionGroups: true, options: true, milestones: true, roles: { include: { phases: true } } } });
    if (!source) throw new DuplicateError(404, "NOT_FOUND", "Proposal not found.");
    const engagement = input.engagement ?? source.engagement;
    const target = await tx.engagementPricingModel.findUnique({ where: { engagement: engagement as Prisma.EngagementPricingModelWhereUniqueInput["engagement"] } });
    if (!target) throw new DuplicateError(400, "VALIDATION_FAILED", "That engagement is not offered.");
    const priced = duplicatePricing(source, engagement, target);
    // Copied milestones get new ids; keep the timeline JSON (and its weekOffset values) pointing at them.
    const milestoneIds = new Map(source.milestones.map((milestone) => [milestone.id, randomUUID()] as const));
    const copiedTimeline = remapTimelineMilestoneIds(source.timeline, milestoneIds);
    const copy = await tx.proposal.create({
      data: {
        ownerId: source.ownerId,
        organizationId: source.organizationId,
        title: copyTitle(source.title, input.title),
        engagement: engagement as Prisma.ProposalCreateInput["engagement"],
        pricingModel: (priced.changed ? target.pricingModel : source.pricingModel) as Prisma.ProposalCreateInput["pricingModel"],
        status: "draft",
        scope: source.scope as Prisma.InputJsonValue,
        timeline: copiedTimeline as Prisma.InputJsonValue,
        pricing: priced.pricing as Prisma.InputJsonValue,
        catalogVersionId: source.catalogVersionId,
        templateCode: source.templateCode,
      },
    });
    const groupIds = new Map<string, string>();
    for (const group of source.optionGroups) {
      const created = await tx.proposalOptionGroup.create({ data: { proposalId: copy.id, name: group.name, mode: group.mode } });
      groupIds.set(group.id, created.id);
    }
    for (const option of source.options) {
      await tx.proposalOption.create({ data: { proposalId: copy.id, label: option.label, description: option.description, priceDeltaMinor: option.priceDeltaMinor, priceCurrency: option.priceCurrency, selected: option.selected, selection: option.selection, groupId: option.groupId ? groupIds.get(option.groupId) ?? null : null } });
    }
    for (const milestone of source.milestones) {
      await tx.timelineMilestone.create({
        data: {
          id: milestoneIds.get(milestone.id)!,
          proposalId: copy.id,
          title: milestone.title,
          description: milestone.description,
          dueDate: milestone.dueDate,
          weeksLow: milestone.weeksLow,
          weeksHigh: milestone.weeksHigh,
          gate: milestone.gate,
          actualStart: milestone.actualStart,
          actualEnd: milestone.actualEnd,
        },
      });
    }
    for (const role of source.roles) {
      const created = await tx.proposalRole.create({
        data: {
          proposalId: copy.id,
          sortOrder: role.sortOrder,
          name: role.name,
          side: role.side,
          responsibility: role.responsibility,
          heaviestAll: role.heaviestAll,
          heaviestGates: role.heaviestGates,
        },
      });
      for (const phase of role.phases) {
        const milestoneId = milestoneIds.get(phase.milestoneId);
        if (milestoneId) await tx.proposalRolePhase.create({ data: { roleId: created.id, milestoneId } });
      }
    }
    const nodes = await tx.proposalNode.findMany({ where: { proposalId: source.id } });
    if (nodes.length) {
      const states = await tx.proposalNodeState.findMany();
      const lockCodes = new Set(states.filter((state) => state.isLock).map((state) => state.code));
      const reopen = states.find((state) => state.isReopenTarget)?.code;
      const nodeIds = new Map<string, string>();
      for (const node of nodes) {
        const stateCode = lockCodes.has(node.stateCode) && reopen ? reopen : node.stateCode;
        const created = await tx.proposalNode.create({ data: { proposalId: copy.id, key: node.key, kind: node.kind, title: node.title, clientLabel: node.clientLabel, stateCode, body: node.body as Prisma.InputJsonValue, lockedVersionId: null, sortOrder: node.sortOrder, parentKey: node.parentKey } });
        nodeIds.set(node.id, created.id);
      }
      const edges = await tx.proposalNodeEdge.findMany({ where: { proposalId: source.id } });
      for (const edge of edges) {
        await tx.proposalNodeEdge.create({ data: { proposalId: copy.id, fromNodeId: nodeIds.get(edge.fromNodeId)!, toNodeId: nodeIds.get(edge.toNodeId)! } });
      }
    }
    const lineage = await tx.proposalLineage.create({ data: { proposalId: copy.id, sourceProposalId: source.id, reason: input.reason ?? "", engagementChanged: priced.changed, actorUserId: input.actorUserId } });
    return { source, copy, lineage, pendingStaffPrice: priced.changed, counts: { options: source.options.length, groups: source.optionGroups.length, milestones: source.milestones.length, nodes: nodes.length } };
  });
}
