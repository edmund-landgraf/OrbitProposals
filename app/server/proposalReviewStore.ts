import type { Prisma, PrismaClient } from "@prisma/client";
import type { ReviewPolicy, ReviewSnapshot, ReviewStore, StoredProposal } from "./proposalReview.js";

const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function snapshot(value: Prisma.JsonValue): ReviewSnapshot {
  const record = jsonObject(value);
  return {
    title: typeof record.title === "string" ? record.title : "",
    scope: record.scope ?? {},
    timeline: record.timeline ?? {},
    pricing: record.pricing ?? {},
    options: record.options ?? [],
    milestones: record.milestones ?? [],
  };
}

type ProposalRow = {
  id: string;
  organizationId: string | null;
  ownerId: string;
  title: string;
  reviewState: string;
  approvedVersionId: string | null;
  scope: Prisma.JsonValue;
  timeline: Prisma.JsonValue;
  pricing: Prisma.JsonValue;
  options: Array<{ id: string; label: string; description: string; priceDeltaMinor: number; priceCurrency: string; selected: boolean }>;
  milestones: Array<{ id: string; title: string; description: string; dueDate: Date | null }>;
  updatedAt: Date;
};

function presentProposal(row: ProposalRow): StoredProposal {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerId: row.ownerId,
    title: row.title,
    reviewState: row.reviewState,
    approvedVersionId: row.approvedVersionId,
    scope: row.scope,
    timeline: row.timeline,
    pricing: row.pricing,
    options: row.options,
    milestones: row.milestones,
    updatedAt: row.updatedAt,
  };
}

const include = { options: true, milestones: true } as const;

type Db = PrismaClient | Prisma.TransactionClient;

export function prismaReviewStore(prisma: Db): ReviewStore {
  return {
    async transaction(fn) {
      if (!("$transaction" in prisma)) return fn(prismaReviewStore(prisma));
      return (prisma as PrismaClient).$transaction((tx) => fn(prismaReviewStore(tx)));
    },
    async policy(): Promise<ReviewPolicy> {
      const [statuses, transitions, commentTypes, visibilities, commentStatuses, reasonCodes, phrases, checks, limits, flagKinds] = await Promise.all([
        prisma.proposalReviewStatus.findMany({ orderBy: { sortOrder: "asc" } }),
        prisma.proposalReviewTransition.findMany(),
        prisma.proposalReviewCommentType.findMany(),
        prisma.proposalReviewVisibility.findMany(),
        prisma.proposalReviewCommentStatus.findMany(),
        prisma.proposalReviewReasonCode.findMany(),
        prisma.proposalReviewPhrase.findMany(),
        prisma.proposalReviewCheck.findMany(),
        prisma.proposalReviewLimit.findMany(),
        prisma.proposalReviewFlagKind.findMany(),
      ]);
      const open = commentStatuses.find((item) => item.open);
      const resolved = commentStatuses.find((item) => !item.open);
      if (!open || !resolved) throw new Error("Review comment statuses are not configured.");
      return {
        statuses: statuses.map((item) => ({ code: item.code, sortOrder: item.sortOrder, clientLabel: item.clientLabel, staffLabel: item.staffLabel, terminal: item.terminal, clientEditable: item.clientEditable, recordStatus: item.recordStatus })),
        transitions: transitions.map((item) => ({
          fromStatus: item.fromStatus,
          toStatus: item.toStatus,
          actorRole: item.actorRole as ReviewPolicy["transitions"][number]["actorRole"],
          action: item.action,
          label: item.label,
          requiresReason: item.requiresReason,
          requiresComment: item.requiresComment,
          snapshots: item.snapshots,
          locksVersion: item.locksVersion,
          clearsApprovedVersion: item.clearsApprovedVersion,
          blockedByOpenFlags: item.blockedByOpenFlags,
          runsUnboundedCheck: item.runsUnboundedCheck,
        })),
        commentTypes,
        visibilities: visibilities.map((item) => item.code),
        openStatus: open.code,
        resolvedStatus: resolved.code,
        reasonCodes: reasonCodes.map((item) => ({ code: item.code, label: item.label, appliesTo: item.appliesTo.split(",").map((part) => part.trim()).filter(Boolean) })),
        phrases: phrases.map((item) => item.phrase),
        checks,
        limits: Object.fromEntries(limits.map((item) => [item.code, item.value])),
        flagKinds: flagKinds.map((item) => ({ code: item.code, blocksApproval: item.blocksApproval, allowedRoles: item.allowedRoles.split(",").map((part) => part.trim()).filter(Boolean) })),
      };
    },
    async listProposals(state) {
      const rows = await prisma.proposal.findMany({ where: state ? { reviewState: state } : {}, include, orderBy: { updatedAt: "desc" } });
      return rows.map((row) => presentProposal(row));
    },
    async getProposal(id) {
      const row = await prisma.proposal.findUnique({ where: { id }, include });
      return row ? presentProposal(row) : null;
    },
    async updateProposal(id, data) {
      const row = await prisma.proposal.update({ where: { id }, data: data as Prisma.ProposalUncheckedUpdateInput, include });
      return presentProposal(row);
    },
    async listVersions(proposalId) {
      const rows = await prisma.proposalVersion.findMany({ where: { proposalId }, orderBy: { number: "asc" } });
      return rows.map((row) => ({ ...row, snapshot: snapshot(row.snapshot) }));
    },
    async insertVersion(row) {
      const created = await prisma.proposalVersion.create({
        data: {
          id: row.id,
          proposalId: row.proposalId,
          number: row.number,
          snapshot: row.snapshot as Prisma.InputJsonValue,
          locked: row.locked,
          createdById: row.createdById,
          reason: row.reason,
        },
      });
      return { ...created, snapshot: snapshot(created.snapshot) };
    },
    async lockVersion(id) {
      await prisma.proposalVersion.update({ where: { id }, data: { locked: true } });
    },
    async listComments(proposalId) {
      return prisma.proposalReviewComment.findMany({ where: { proposalId }, orderBy: { createdAt: "asc" } });
    },
    async insertComment(row) {
      return prisma.proposalReviewComment.create({ data: row });
    },
    async updateComment(id, data) {
      return prisma.proposalReviewComment.update({ where: { id }, data });
    },
    async listFlags(proposalId) {
      return prisma.proposalReviewFlag.findMany({ where: { proposalId }, orderBy: { createdAt: "asc" } });
    },
    async insertFlag(row) {
      return prisma.proposalReviewFlag.create({ data: row });
    },
    async updateFlag(id, data) {
      return prisma.proposalReviewFlag.update({ where: { id }, data });
    },
    async listEvents(proposalId) {
      return prisma.proposalReviewEvent.findMany({ where: { proposalId }, orderBy: { createdAt: "asc" } });
    },
    async insertEvent(row) {
      return prisma.proposalReviewEvent.create({ data: row });
    },
    async getMeeting(proposalId) {
      return prisma.proposalReviewMeeting.findUnique({ where: { proposalId } });
    },
    async listSectionKeys(proposalId) {
      const nodes = await prisma.proposalNode.findMany({ where: { proposalId }, select: { key: true } });
      return nodes.map((node) => node.key);
    },
    async listSections(proposalId) {
      const nodes = await prisma.proposalNode.findMany({ where: { proposalId }, select: { key: true, body: true } });
      return nodes.flatMap((node) => {
        const body = jsonObject(node.body);
        const text = typeof body.text === "string" ? body.text : "";
        return text.trim() ? [{ key: node.key, text }] : [];
      });
    },
    async upsertMeeting(row) {
      return prisma.proposalReviewMeeting.upsert({
        where: { proposalId: row.proposalId },
        create: row,
        update: { scheduledAt: row.scheduledAt, link: row.link, notes: row.notes, createdById: row.createdById },
      });
    },
  };
}

export async function lockedPricing(prisma: PrismaClient, versionId: string | null | undefined): Promise<unknown | undefined> {
  if (!versionId) return undefined;
  const version = await prisma.proposalVersion.findUnique({ where: { id: versionId } });
  if (!version?.locked) return undefined;
  return snapshot(version.snapshot).pricing;
}
