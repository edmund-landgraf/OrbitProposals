import { randomUUID } from "node:crypto";

export type ReviewActorRole = "client" | "staff" | "agent";

export type ReviewStatus = {
  code: string;
  sortOrder: number;
  clientLabel: string;
  staffLabel: string;
  terminal: boolean;
  clientEditable: boolean;
  /** Proposal.status value this review state maps to (proposal_review_status.record_status). */
  recordStatus?: string | null;
};

export type ReviewTransition = {
  fromStatus: string;
  toStatus: string;
  actorRole: ReviewActorRole;
  action: string;
  label: string;
  requiresReason: boolean;
  requiresComment: boolean;
  snapshots: boolean;
  locksVersion: boolean;
  clearsApprovedVersion: boolean;
  blockedByOpenFlags: boolean;
  runsUnboundedCheck: boolean;
};

export type ReviewPolicy = {
  statuses: ReviewStatus[];
  transitions: ReviewTransition[];
  commentTypes: Array<{ code: string; blocksApproval: boolean }>;
  visibilities: string[];
  openStatus: string;
  resolvedStatus: string;
  reasonCodes: Array<{ code: string; label: string; appliesTo: string[] }>;
  phrases: string[];
  checks: Array<{ code: string; kind: string; enabled: boolean }>;
  limits: Record<string, number>;
  flagKinds: Array<{ code: string; blocksApproval: boolean; allowedRoles: string[] }>;
};

export type ReviewSnapshot = {
  title: string;
  scope: unknown;
  timeline: unknown;
  pricing: unknown;
  options: unknown;
  milestones: unknown;
};

/** Narrative section text from a completion-tree node, keyed like `terms` or `executive_summary`. */
export type ReviewSectionText = { key: string; text: string };

/** One result from the unbounded-language / pricing-cap check, including which field triggered it. */
export type UnboundedFinding = {
  reason: string;
  fieldPath: string;
  excerpt: string;
  targetKind: string;
  targetId: string | null;
};

export type StoredComment = {
  id: string;
  proposalId: string;
  parentId: string | null;
  targetKind: string;
  targetId: string | null;
  typeCode: string;
  status: string;
  visibility: string;
  authorRole: string;
  authorId: string | null;
  body: string;
  createdAt: Date;
};

export type StoredFlag = {
  id: string;
  proposalId: string;
  targetKind: string;
  targetId: string | null;
  kind: string;
  reason: string;
  status: string;
  visibility: string;
  authorRole: string;
  authorId: string | null;
  blocksApproval: boolean;
  automatic: boolean;
  createdAt: Date;
};

export type StoredVersion = {
  id: string;
  proposalId: string;
  number: number;
  snapshot: ReviewSnapshot;
  locked: boolean;
  createdAt: Date;
  createdById: string | null;
  reason: string | null;
};

export type StoredEvent = {
  id: string;
  proposalId: string;
  actorId: string | null;
  actorRole: string;
  fromStatus: string;
  toStatus: string;
  reasonCode: string | null;
  reasonText: string | null;
  createdAt: Date;
};

export type StoredMeeting = {
  proposalId: string;
  scheduledAt: Date;
  link: string | null;
  notes: string | null;
  createdById: string | null;
};

export type StoredProposal = {
  id: string;
  organizationId: string | null;
  ownerId: string;
  title: string;
  reviewState: string;
  approvedVersionId: string | null;
  scope: unknown;
  timeline: unknown;
  pricing: unknown;
  options: unknown;
  milestones: unknown;
  updatedAt: Date;
};

export type ReviewStore = {
  policy(): Promise<ReviewPolicy>;
  listProposals(state?: string): Promise<StoredProposal[]>;
  getProposal(id: string): Promise<StoredProposal | null>;
  updateProposal(id: string, data: { reviewState?: string; status?: string; approvedVersionId?: string | null }): Promise<StoredProposal>;
  /** Runs fn atomically. Stores without transactions (tests) may omit it. */
  transaction?<T>(fn: (store: ReviewStore) => Promise<T>): Promise<T>;
  listVersions(proposalId: string): Promise<StoredVersion[]>;
  insertVersion(row: Omit<StoredVersion, "createdAt"> & { createdAt?: Date }): Promise<StoredVersion>;
  lockVersion(id: string): Promise<void>;
  listComments(proposalId: string): Promise<StoredComment[]>;
  insertComment(row: Omit<StoredComment, "createdAt"> & { createdAt?: Date }): Promise<StoredComment>;
  updateComment(id: string, data: { status?: string; body?: string }): Promise<StoredComment>;
  listFlags(proposalId: string): Promise<StoredFlag[]>;
  insertFlag(row: Omit<StoredFlag, "createdAt"> & { createdAt?: Date }): Promise<StoredFlag>;
  updateFlag(id: string, data: { status: string }): Promise<StoredFlag>;
  listEvents(proposalId: string): Promise<StoredEvent[]>;
  insertEvent(row: Omit<StoredEvent, "createdAt" | "id"> & { id?: string }): Promise<StoredEvent>;
  getMeeting(proposalId: string): Promise<StoredMeeting | null>;
  upsertMeeting(row: StoredMeeting): Promise<StoredMeeting>;
  /** Completion-tree part keys on the proposal, used to check section comment targets. Stores without a tree may omit it. */
  listSectionKeys?(proposalId: string): Promise<string[]>;
  /** Narrative section text (node body.text), used by the unbounded-language check. Stores without a tree may omit it. */
  listSections?(proposalId: string): Promise<ReviewSectionText[]>;
};

export class ReviewError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) { super(message); }
}

/** Describes the transitions open to a role from a state, so a refused transition can say what would work instead. */
export function transitionRefusal(policy: ReviewPolicy, from: string, to: string, role: ReviewActorRole): ReviewError {
  const open = policy.transitions.filter((item) => item.fromStatus === from && item.actorRole === role);
  const label = policy.statuses.find((item) => item.code === from)?.staffLabel ?? from;
  const choices = open.map((item) => `${item.toStatus} (${item.action})`);
  const otherRoles = [...new Set(policy.transitions.filter((item) => item.fromStatus === from && item.toStatus === to && item.actorRole !== role).map((item) => item.actorRole))];
  const hint = choices.length ? ` From here the ${role} can move to: ${choices.join(", ")}.` : ` The ${role} has no transitions from here.`;
  const roleHint = otherRoles.length ? ` Moving to ${to} from here is open to: ${otherRoles.join(", ")}.` : "";
  return new ReviewError(409, "CONFLICT", `That review transition is not allowed: the proposal is in ${label} (${from}), so the ${role} cannot move it to ${to}.${hint}${roleHint}`, {
    from,
    to,
    role,
    allowedTransitions: open.map((item) => ({ to: item.toStatus, action: item.action })),
  });
}

export function limitOf(policy: ReviewPolicy, code: string): number {
  const value = policy.limits[code];
  if (value == null) throw new ReviewError(500, "INTERNAL_ERROR", `Review limit ${code} is not configured.`);
  return value;
}

export function statusOf(policy: ReviewPolicy, code: string): ReviewStatus {
  const status = policy.statuses.find((item) => item.code === code);
  if (!status) throw new ReviewError(500, "INTERNAL_ERROR", `Review status ${code} is not configured.`);
  return status;
}

export function transitionFor(policy: ReviewPolicy, from: string, to: string, role: ReviewActorRole): ReviewTransition | undefined {
  return policy.transitions.find((item) => item.fromStatus === from && item.toStatus === to && item.actorRole === role);
}

export function seesInternal(role: ReviewActorRole): boolean {
  return role === "staff" || role === "agent";
}

export function fieldDiff(before: unknown, after: unknown, path = ""): Array<{ path: string; before: unknown; after: unknown }> {
  if (Object.is(before, after)) return [];
  const bothObjects = isRecord(before) && isRecord(after);
  if (!bothObjects) {
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
      return before.flatMap((item, index) => fieldDiff(item, after[index], `${path}[${index}]`));
    }
    return [{ path: path || "(root)", before, after }];
  }
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.flatMap((key) => fieldDiff(before[key], after[key], path ? `${path}.${key}` : key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function snapshotOf(proposal: StoredProposal): ReviewSnapshot {
  return {
    title: proposal.title,
    scope: proposal.scope,
    timeline: proposal.timeline,
    pricing: proposal.pricing,
    options: proposal.options,
    milestones: proposal.milestones,
  };
}

export function unboundedFindings(policy: ReviewPolicy, snapshot: ReviewSnapshot, sections: ReviewSectionText[] = []): UnboundedFinding[] {
  const findings: UnboundedFinding[] = [];
  const pricing = isRecord(snapshot.pricing) ? snapshot.pricing : {};
  const model = typeof pricing.model === "string" ? pricing.model : "";
  const amount = typeof pricing.amountMinor === "number" ? pricing.amountMinor : 0;
  const hourCap = positiveNumber(pricing.hours) || positiveNumber(pricing.hourCap) || positiveNumber(pricing.notToExceedHours) || positiveNumber(pricing.cappedHours);
  for (const check of policy.checks) {
    if (!check.enabled) continue;
    if (check.kind === "missing_hour_cap" && model === "hourly" && !hourCap) {
      findings.push(pricingFinding("No cap on hours.", "pricing.hours"));
    }
    if (check.kind === "missing_total" && model !== "hourly" && amount <= 0) {
      findings.push(pricingFinding("No total price.", "pricing.amountMinor"));
    }
    if (check.kind === "phrase") {
      findings.push(...phraseFindings(policy, snapshot, sections));
    }
  }
  return findings;
}

function pricingFinding(reason: string, fieldPath: string): UnboundedFinding {
  return { reason, fieldPath, excerpt: reason, targetKind: "field", targetId: fieldPath };
}

/** Words that mark a sentence as describing excluded, out-of-scope, or deferred work rather than a present commitment. */
const EXCLUSION_SENTENCE = /\b(scoped separately|out of scope|not included|excluded|phase\s*2|phase\s+two|future phase|later phase|separate engagement)\b/i;

function phraseFindings(policy: ReviewPolicy, snapshot: ReviewSnapshot, sections: ReviewSectionText[]): UnboundedFinding[] {
  const findings: UnboundedFinding[] = [];
  const fields = collectScanFields(snapshot, sections);
  for (const field of fields) {
    for (const sentence of sentencesOf(field.text)) {
      if (EXCLUSION_SENTENCE.test(sentence)) continue;
      const lower = sentence.toLowerCase();
      for (const phrase of policy.phrases) {
        if (!phrase || !lower.includes(phrase.toLowerCase())) continue;
        const excerpt = excerptOf(sentence);
        findings.push({
          reason: `Open-ended language “${phrase}” in ${field.path}: "${excerpt}"`,
          fieldPath: field.path,
          excerpt,
          targetKind: field.targetKind,
          targetId: field.targetId,
        });
      }
    }
  }
  return findings;
}

type ScanField = { path: string; text: string; targetKind: string; targetId: string | null };

function collectScanFields(snapshot: ReviewSnapshot, sections: ReviewSectionText[]): ScanField[] {
  const fields: ScanField[] = [];
  // scope.exclusions are omitted: they bound work out, so open-ended words there are not findings.
  const roots: Array<{ path: string; value: unknown }> = [
    { path: "title", value: snapshot.title },
    { path: "scope", value: scopeWithoutExclusions(snapshot.scope) },
    { path: "timeline", value: snapshot.timeline },
    { path: "options", value: snapshot.options },
    { path: "milestones", value: snapshot.milestones },
    { path: "pricing.lines", value: isRecord(snapshot.pricing) ? snapshot.pricing.lines : undefined },
  ];
  for (const root of roots) collectStringFields(root.value, root.path, "field", fields);
  for (const section of sections) {
    if (section.text.trim()) collectStringFields(section.text, section.key, "section", fields);
  }
  return fields;
}

function collectStringFields(value: unknown, path: string, targetKind: string, out: ScanField[]): void {
  if (typeof value === "string") {
    if (value.trim()) out.push({ path, text: value, targetKind, targetId: path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringFields(item, `${path}[${index}]`, targetKind, out));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectStringFields(child, path ? `${path}.${key}` : key, targetKind, out);
    }
  }
}

function sentencesOf(text: string): string[] {
  // Keep list items and separate commitments apart before normalizing whitespace.
  // An excluded sentence must not exempt the next line or a lowercase sentence.
  return text.split(/\r?\n+|(?<=[.!?;])\s+|\s+(?:but|however)\s+/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function excerptOf(sentence: string, max = 200): string {
  const trimmed = sentence.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function scopeWithoutExclusions(scope: unknown): unknown {
  if (!isRecord(scope)) return scope;
  const { exclusions: _exclusions, ...rest } = scope;
  return rest;
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && value > 0;
}

function reasonMatches(policy: ReviewPolicy, action: string, code: string | undefined): boolean {
  if (!code) return false;
  const row = policy.reasonCodes.find((item) => item.code === code);
  return Boolean(row && row.appliesTo.includes(action));
}

export async function openBlocking(store: ReviewStore, policy: ReviewPolicy, proposalId: string): Promise<boolean> {
  const [comments, flags] = await Promise.all([store.listComments(proposalId), store.listFlags(proposalId)]);
  const blockingTypes = new Set(policy.commentTypes.filter((item) => item.blocksApproval).map((item) => item.code));
  return comments.some((comment) => comment.status === policy.openStatus && blockingTypes.has(comment.typeCode))
    || flags.some((flag) => flag.status === policy.openStatus && flag.blocksApproval);
}

async function recordUnbounded(store: ReviewStore, policy: ReviewPolicy, proposal: StoredProposal, actorRole: ReviewActorRole): Promise<string[]> {
  const kind = policy.flagKinds.find((item) => item.code === "unbounded");
  if (!kind) return [];
  const sections = store.listSections ? await store.listSections(proposal.id) : [];
  const findings = unboundedFindings(policy, snapshotOf(proposal), sections);
  const reasons = new Set(findings.map((item) => item.reason));
  const existing = await store.listFlags(proposal.id);
  // An automatic flag whose finding no longer appears (the text was fixed, or the check changed) is resolved on the next check.
  for (const flag of existing) {
    if (flag.automatic && flag.kind === kind.code && flag.status === policy.openStatus && !reasons.has(flag.reason)) {
      await store.updateFlag(flag.id, { status: policy.resolvedStatus });
    }
  }
  for (const finding of findings) {
    const already = existing.some((flag) => flag.status === policy.openStatus && flag.automatic && flag.reason === finding.reason);
    if (already) continue;
    await store.insertFlag({
      id: randomUUID(),
      proposalId: proposal.id,
      targetKind: finding.targetKind,
      targetId: finding.targetId,
      kind: kind.code,
      reason: finding.reason,
      status: policy.openStatus,
      visibility: "client",
      authorRole: actorRole,
      authorId: null,
      blocksApproval: kind.blocksApproval,
      automatic: true,
    });
  }
  return findings.map((item) => item.reason);
}

export function recordStatusFor(policy: ReviewPolicy, reviewState: string): { status: string } | Record<string, never> {
  const mapped = statusOf(policy, reviewState).recordStatus;
  return mapped ? { status: mapped } : {};
}

export function atomically<T>(store: ReviewStore, fn: (store: ReviewStore) => Promise<T>): Promise<T> {
  return store.transaction ? store.transaction(fn) : fn(store);
}

export async function applyTransition(outer: ReviewStore, input: {
  proposalId: string;
  actorId: string;
  actorRole: ReviewActorRole;
  toStatus: string;
  reasonCode?: string;
  reasonText?: string;
  commentBody?: string;
  commentType?: string;
  commentTargetKind?: string;
  commentTargetId?: string;
  meeting?: { scheduledAt: Date; link?: string; notes?: string };
}): Promise<{ proposal: StoredProposal; version: StoredVersion | null }> {
  return atomically(outer, (store) => transitionInside(store, input));
}

async function transitionInside(store: ReviewStore, input: Parameters<typeof applyTransition>[1]): Promise<{ proposal: StoredProposal; version: StoredVersion | null }> {
  const policy = await store.policy();
  const proposal = await store.getProposal(input.proposalId);
  if (!proposal) throw new ReviewError(404, "NOT_FOUND", "The proposal was not found.");
  const transition = transitionFor(policy, proposal.reviewState, input.toStatus, input.actorRole);
  if (!transition) throw transitionRefusal(policy, proposal.reviewState, input.toStatus, input.actorRole);
  if (transition.requiresComment) {
    const body = input.commentBody?.trim() ?? "";
    if (!body) throw new ReviewError(400, "VALIDATION_FAILED", "A comment is required for this transition.");
    if (body.length > limitOf(policy, "comment_body_max")) throw new ReviewError(400, "VALIDATION_FAILED", "The comment is too long.");
    const typeCode = input.commentType ?? "pushback";
    if (!policy.commentTypes.some((item) => item.code === typeCode)) throw new ReviewError(400, "VALIDATION_FAILED", `The comment type is not configured. Use one of: ${policy.commentTypes.map((item) => item.code).join(", ")}.`);
    await checkCommentTarget(store, proposal, input.commentTargetKind ?? "proposal", input.commentTargetId?.trim() || null);
    await store.insertComment({
      id: randomUUID(),
      proposalId: proposal.id,
      parentId: null,
      targetKind: input.commentTargetKind ?? "proposal",
      targetId: input.commentTargetId ?? null,
      typeCode,
      status: policy.openStatus,
      visibility: "client",
      authorRole: input.actorRole,
      authorId: input.actorId,
      body,
    });
  }
  if (transition.requiresReason) {
    if (!reasonMatches(policy, transition.action, input.reasonCode)) throw new ReviewError(400, "VALIDATION_FAILED", "A configured reason code is required.");
    const text = input.reasonText?.trim() ?? "";
    if (text.length > limitOf(policy, "reason_text_max")) throw new ReviewError(400, "VALIDATION_FAILED", "The reason is too long.");
  }
  if (transition.action === "schedule_meeting") {
    if (!input.meeting?.scheduledAt || Number.isNaN(input.meeting.scheduledAt.valueOf())) throw new ReviewError(400, "VALIDATION_FAILED", "A meeting time is required.");
    const link = input.meeting.link?.trim() ?? "";
    const notes = input.meeting.notes?.trim() ?? "";
    if (link.length > limitOf(policy, "meeting_link_max")) throw new ReviewError(400, "VALIDATION_FAILED", "The meeting link is too long.");
    if (notes.length > limitOf(policy, "meeting_notes_max")) throw new ReviewError(400, "VALIDATION_FAILED", "The meeting notes are too long.");
    await store.upsertMeeting({
      proposalId: proposal.id,
      scheduledAt: input.meeting.scheduledAt,
      link: link || null,
      notes: notes || null,
      createdById: input.actorId,
    });
  }
  if (transition.runsUnboundedCheck) await recordUnbounded(store, policy, proposal, input.actorRole);
  if (transition.blockedByOpenFlags && await openBlocking(store, policy, proposal.id)) {
    const [comments, flags] = await Promise.all([store.listComments(proposal.id), store.listFlags(proposal.id)]);
    const blockingTypes = new Set(policy.commentTypes.filter((item) => item.blocksApproval).map((item) => item.code));
    const openFlags = flags.filter((flag) => flag.status === policy.openStatus && flag.blocksApproval).map((flag) => ({ id: flag.id, reason: flag.reason, automatic: flag.automatic }));
    const openComments = comments.filter((comment) => comment.status === policy.openStatus && blockingTypes.has(comment.typeCode)).map((comment) => ({ id: comment.id, type: comment.typeCode }));
    throw new ReviewError(409, "CONFLICT", `Open blocking flags must be resolved before approval: ${openFlags.length} flag(s) and ${openComments.length} comment(s). Resolve flags with unw_resolve_review_flag and comments with unw_resolve_review_comment.`, { openFlags, openComments });
  }
  let version: StoredVersion | null = null;
  if (transition.snapshots || transition.locksVersion) {
    const versions = await store.listVersions(proposal.id);
    const number = (versions.at(-1)?.number ?? 0) + 1;
    version = await store.insertVersion({
      id: randomUUID(),
      proposalId: proposal.id,
      number,
      snapshot: snapshotOf(proposal),
      locked: false,
      createdById: input.actorId,
      reason: transition.action,
    });
  }
  if (transition.locksVersion && version) {
    await store.lockVersion(version.id);
    // The response reports the version as stored, so it must say locked once the lock is written.
    version = { ...version, locked: true };
  }
  const updated = await store.updateProposal(proposal.id, {
    reviewState: transition.toStatus,
    ...recordStatusFor(policy, transition.toStatus),
    ...(transition.locksVersion && version ? { approvedVersionId: version.id } : {}),
    ...(transition.clearsApprovedVersion ? { approvedVersionId: null } : {}),
  });
  await store.insertEvent({
    proposalId: proposal.id,
    actorId: input.actorId,
    actorRole: input.actorRole,
    fromStatus: proposal.reviewState,
    toStatus: transition.toStatus,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText?.trim() || null,
  });
  return { proposal: updated, version };
}

export async function addComment(store: ReviewStore, input: {
  proposalId: string;
  actorId: string;
  actorRole: ReviewActorRole;
  body: string;
  typeCode: string;
  visibility: string;
  targetKind?: string;
  targetId?: string;
  parentId?: string;
}): Promise<StoredComment> {
  const policy = await store.policy();
  const proposal = await store.getProposal(input.proposalId);
  if (!proposal) throw new ReviewError(404, "NOT_FOUND", "The proposal was not found.");
  if (statusOf(policy, proposal.reviewState).terminal && input.actorRole === "client") throw new ReviewError(409, "CONFLICT", "This proposal is closed for comments.");
  const body = input.body.trim();
  if (!body) throw new ReviewError(400, "VALIDATION_FAILED", "A comment is required.");
  if (body.length > limitOf(policy, "comment_body_max")) throw new ReviewError(400, "VALIDATION_FAILED", "The comment is too long.");
  if (!policy.commentTypes.some((item) => item.code === input.typeCode)) throw new ReviewError(400, "VALIDATION_FAILED", `The comment type is not configured. Use one of: ${policy.commentTypes.map((item) => item.code).join(", ")}.`);
  const visibility = input.actorRole === "client" ? "client" : input.visibility;
  if (!policy.visibilities.includes(visibility)) throw new ReviewError(400, "VALIDATION_FAILED", "The comment visibility is not configured.");
  let targetKind = input.targetKind ?? "proposal";
  let targetId: string | null = input.targetId?.trim() || null;
  if (input.parentId) {
    const parent = (await store.listComments(proposal.id)).find((item) => item.id === input.parentId);
    if (!parent) throw new ReviewError(404, "NOT_FOUND", "The comment thread was not found.", { parentId: input.parentId });
    if (!seesInternal(input.actorRole) && parent.visibility !== "client") throw new ReviewError(404, "NOT_FOUND", "The comment thread was not found.", { parentId: input.parentId });
    // A reply belongs to its parent's thread, so it keeps the parent's target.
    const kindMismatch = input.targetKind !== undefined && input.targetKind !== "proposal" && input.targetKind !== parent.targetKind;
    const idMismatch = targetId !== null && targetId !== parent.targetId;
    if (kindMismatch || idMismatch) {
      throw new ReviewError(400, "VALIDATION_FAILED", `A reply stays on its parent's target (${parent.targetKind}${parent.targetId ? ` ${parent.targetId}` : ""}). Leave targetKind and targetId out of replies.`, { parentTargetKind: parent.targetKind, parentTargetId: parent.targetId });
    }
    targetKind = parent.targetKind;
    targetId = parent.targetId;
  } else {
    await checkCommentTarget(store, proposal, targetKind, targetId);
  }
  return store.insertComment({
    id: randomUUID(),
    proposalId: proposal.id,
    parentId: input.parentId ?? null,
    targetKind,
    targetId,
    typeCode: input.typeCode,
    status: policy.openStatus,
    visibility,
    authorRole: input.actorRole,
    authorId: input.actorId,
    body,
  });
}

const TARGETS_NEEDING_ID = new Set(["section", "field", "milestone", "option", "pricing_line"]);
const FIELD_ROOTS = ["title", "scope", "timeline", "pricing", "options", "milestones"] as const;

function idsOf(list: unknown, keys: string[] = ["id"]): string[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => isRecord(item) ? keys.map((key) => item[key]).filter((value): value is string => typeof value === "string" && value.length > 0) : []);
}

/** Follows a path like scope.deliverables[2] or pricing.amountMinor through the proposal snapshot. */
function resolveFieldPath(snapshot: ReviewSnapshot, path: string): boolean {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  const root = parts.shift();
  if (!root || !(FIELD_ROOTS as readonly string[]).includes(root)) return false;
  let value: unknown = snapshot[root as keyof ReviewSnapshot];
  for (const part of parts) {
    if (Array.isArray(value) && /^\d+$/.test(part)) value = value[Number(part)];
    else if (isRecord(value)) value = value[part];
    else return false;
    if (value === undefined) return false;
  }
  return value !== undefined;
}

/** Checks that a comment target names something on this proposal, so comments do not point at parts that do not exist. */
export async function checkCommentTarget(store: ReviewStore, proposal: StoredProposal, targetKind: string, targetId: string | null): Promise<void> {
  if (TARGETS_NEEDING_ID.has(targetKind) && !targetId) {
    throw new ReviewError(400, "VALIDATION_FAILED", `A ${targetKind} comment needs a targetId naming the ${targetKind} it is about.`, { targetKind });
  }
  if (!targetId) return;
  const missing = (known: string[], noun: string) => new ReviewError(404, "NOT_FOUND", `This proposal has no ${noun} ${targetId}.${known.length ? ` Known: ${known.slice(0, 25).join(", ")}.` : ""}`, { targetKind, targetId, known: known.slice(0, 50) });
  const snapshot = snapshotOf(proposal);
  switch (targetKind) {
    case "proposal":
      if (targetId !== proposal.id) throw new ReviewError(400, "VALIDATION_FAILED", "A proposal comment's targetId must be the proposal id, or left out.", { targetKind, targetId });
      return;
    case "scope": {
      const path = targetId.startsWith("scope") ? targetId : `scope.${targetId}`;
      if (!resolveFieldPath(snapshot, path)) throw missing(isRecord(proposal.scope) ? Object.keys(proposal.scope) : [], "scope field");
      return;
    }
    case "field":
      if (!resolveFieldPath(snapshot, targetId)) throw new ReviewError(404, "NOT_FOUND", `This proposal has no field ${targetId}. Use a path such as scope.summary, scope.deliverables[0], timeline.targetDate, or pricing.amountMinor.`, { targetKind, targetId, roots: [...FIELD_ROOTS] });
      return;
    case "section": {
      if (!store.listSectionKeys) return;
      const keys = await store.listSectionKeys(proposal.id);
      // A proposal whose completion tree was never built has no parts to check against yet.
      if (keys.length && !keys.includes(targetId)) throw missing(keys, "section");
      return;
    }
    case "milestone": {
      const timeline = isRecord(proposal.timeline) ? proposal.timeline : {};
      const known = [...new Set([...idsOf(proposal.milestones), ...idsOf(timeline.milestones)])];
      if (!known.includes(targetId)) throw missing(known, "milestone");
      return;
    }
    case "option": {
      const known = idsOf(proposal.options, ["id", "code"]);
      if (!known.includes(targetId)) throw missing(known, "option");
      return;
    }
    case "pricing_line": {
      const pricing = isRecord(proposal.pricing) ? proposal.pricing : {};
      const known = idsOf(pricing.lines, ["id", "code"]);
      if (!known.includes(targetId)) throw missing(known, "pricing line");
      return;
    }
    default:
      throw new ReviewError(400, "VALIDATION_FAILED", `The comment target kind ${targetKind} is not supported.`, { targetKind });
  }
}

export async function resolveComment(store: ReviewStore, input: { proposalId: string; commentId: string; actorRole: ReviewActorRole }): Promise<StoredComment> {
  if (input.actorRole === "client") throw new ReviewError(403, "FORBIDDEN", "Clients cannot resolve review comments.");
  const policy = await store.policy();
  const comment = (await store.listComments(input.proposalId)).find((item) => item.id === input.commentId);
  if (!comment) throw new ReviewError(404, "NOT_FOUND", "The comment was not found.");
  return store.updateComment(comment.id, { status: policy.resolvedStatus });
}

/** The author may replace their own open comment, or leave it in place and post a successor. */
export async function reviseOwnComment(store: ReviewStore, input: {
  proposalId: string;
  commentId: string;
  actorId: string;
  actorRole: ReviewActorRole;
  body: string;
  supersede?: boolean;
}): Promise<{ comment: StoredComment; successor?: StoredComment }> {
  const policy = await store.policy();
  const comment = (await store.listComments(input.proposalId)).find((item) => item.id === input.commentId);
  if (!comment || (!seesInternal(input.actorRole) && comment.visibility !== "client")) throw new ReviewError(404, "NOT_FOUND", "The comment was not found.");
  if (!comment.authorId || comment.authorId !== input.actorId) throw new ReviewError(403, "FORBIDDEN", "Only the author can change this comment.");
  if (comment.status !== policy.openStatus) throw new ReviewError(409, "CONFLICT", "Only an open comment can be changed.");
  const body = input.body.trim();
  if (!body) throw new ReviewError(400, "VALIDATION_FAILED", "A comment is required.");
  if (body.length > limitOf(policy, "comment_body_max")) throw new ReviewError(400, "VALIDATION_FAILED", "The comment is too long.");
  if (!input.supersede) {
    const updated = await store.updateComment(comment.id, { body });
    return { comment: updated };
  }
  const superseded = await store.updateComment(comment.id, { status: "superseded" });
  const successor = await store.insertComment({
    id: randomUUID(),
    proposalId: comment.proposalId,
    parentId: comment.id,
    targetKind: comment.targetKind,
    targetId: comment.targetId,
    typeCode: comment.typeCode,
    status: policy.openStatus,
    visibility: comment.visibility,
    authorRole: input.actorRole,
    authorId: input.actorId,
    body,
  });
  return { comment: superseded, successor };
}

export async function addFlag(store: ReviewStore, input: {
  proposalId: string;
  actorId: string;
  actorRole: ReviewActorRole;
  kind: string;
  reason: string;
  targetKind: string;
  targetId?: string;
  visibility: string;
}): Promise<StoredFlag> {
  const policy = await store.policy();
  const proposal = await store.getProposal(input.proposalId);
  if (!proposal) throw new ReviewError(404, "NOT_FOUND", "The proposal was not found.");
  const kind = policy.flagKinds.find((item) => item.code === input.kind);
  if (!kind) throw new ReviewError(400, "VALIDATION_FAILED", "The flag kind is not configured.");
  if (!kind.allowedRoles.includes(input.actorRole)) throw new ReviewError(403, "FORBIDDEN", "That role cannot set this flag.");
  const reason = input.reason.trim();
  if (!reason || reason.length > limitOf(policy, "reason_text_max")) throw new ReviewError(400, "VALIDATION_FAILED", "A flag reason is required.");
  const visibility = policy.visibilities.includes(input.visibility) ? input.visibility : "";
  if (!visibility) throw new ReviewError(400, "VALIDATION_FAILED", `The flag visibility is not configured. Use one of: ${policy.visibilities.join(", ")}.`);
  await checkCommentTarget(store, proposal, input.targetKind, input.targetId?.trim() || null);
  return store.insertFlag({
    id: randomUUID(),
    proposalId: proposal.id,
    targetKind: input.targetKind,
    targetId: input.targetId ?? null,
    kind: kind.code,
    reason,
    status: policy.openStatus,
    visibility,
    authorRole: input.actorRole,
    authorId: input.actorId,
    blocksApproval: kind.blocksApproval,
    automatic: false,
  });
}

export async function resolveFlag(store: ReviewStore, input: { proposalId: string; flagId: string; actorRole: ReviewActorRole }): Promise<StoredFlag> {
  if (input.actorRole === "client") throw new ReviewError(403, "FORBIDDEN", "Clients cannot resolve review flags.");
  const policy = await store.policy();
  const flag = (await store.listFlags(input.proposalId)).find((item) => item.id === input.flagId);
  if (!flag) throw new ReviewError(404, "NOT_FOUND", "The flag was not found.");
  return store.updateFlag(flag.id, { status: policy.resolvedStatus });
}

export async function workspaceFor(store: ReviewStore, proposalId: string, role: ReviewActorRole) {
  const policy = await store.policy();
  const proposal = await store.getProposal(proposalId);
  if (!proposal) throw new ReviewError(404, "NOT_FOUND", "The proposal was not found.");
  const status = statusOf(policy, proposal.reviewState);
  const [comments, flags, events, versions, meeting] = await Promise.all([
    store.listComments(proposalId),
    store.listFlags(proposalId),
    store.listEvents(proposalId),
    store.listVersions(proposalId),
    store.getMeeting(proposalId),
  ]);
  const visible = <T extends { visibility: string }>(rows: T[]) => seesInternal(role) ? rows : rows.filter((row) => row.visibility === "client");
  return {
    proposalId,
    state: status.code,
    clientLabel: status.clientLabel,
    staffLabel: status.staffLabel,
    clientEditable: status.clientEditable,
    approvedVersionId: proposal.approvedVersionId,
    meeting: meeting ? { scheduledAt: meeting.scheduledAt.toISOString(), link: meeting.link, notes: meeting.notes } : null,
    comments: visible(comments).map(presentComment),
    flags: visible(flags).map(presentFlag),
    events: events.map((event) => ({
      id: event.id,
      actorId: event.actorId,
      actorRole: event.actorRole,
      from: event.fromStatus,
      to: event.toStatus,
      reasonCode: event.reasonCode,
      reasonText: event.reasonText,
      createdAt: event.createdAt.toISOString(),
    })),
    versions: versions.map((version) => ({ id: version.id, number: version.number, locked: version.locked, createdAt: version.createdAt.toISOString(), reason: version.reason })),
    allowedTransitions: policy.transitions
      .filter((item) => item.fromStatus === proposal.reviewState && item.actorRole === role)
      .map((item) => ({ to: item.toStatus, action: item.action, label: item.label, requiresComment: item.requiresComment, requiresReason: item.requiresReason })),
    commentTypes: policy.commentTypes,
    reasonCodes: policy.reasonCodes.map((item) => ({ code: item.code, label: item.label, actions: item.appliesTo })),
    visibilities: seesInternal(role) ? policy.visibilities : ["client"],
  };
}

function presentComment(comment: StoredComment) {
  return {
    id: comment.id,
    parentId: comment.parentId,
    targetKind: comment.targetKind,
    targetId: comment.targetId,
    type: comment.typeCode,
    status: comment.status,
    visibility: comment.visibility,
    authorRole: comment.authorRole,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
  };
}

function presentFlag(flag: StoredFlag) {
  return {
    id: flag.id,
    targetKind: flag.targetKind,
    targetId: flag.targetId,
    kind: flag.kind,
    reason: flag.reason,
    status: flag.status,
    visibility: flag.visibility,
    authorRole: flag.authorRole,
    blocksApproval: flag.blocksApproval,
    automatic: flag.automatic,
    createdAt: flag.createdAt.toISOString(),
  };
}

export async function diffVersions(store: ReviewStore, proposalId: string, fromNumber: number, toNumber: number) {
  const versions = await store.listVersions(proposalId);
  const from = versions.find((item) => item.number === fromNumber);
  const to = versions.find((item) => item.number === toNumber);
  if (!from || !to) throw new ReviewError(404, "NOT_FOUND", "Those versions were not found.");
  return { from: fromNumber, to: toNumber, changes: fieldDiff(from.snapshot, to.snapshot) };
}

export async function noteCommercialEdit(outer: ReviewStore, proposalId: string, actor: { userId: string; role: ReviewActorRole }): Promise<void> {
  return atomically(outer, (store) => commercialEditInside(store, proposalId, actor));
}

async function commercialEditInside(store: ReviewStore, proposalId: string, actor: { userId: string; role: ReviewActorRole }): Promise<void> {
  const policy = await store.policy();
  const proposal = await store.getProposal(proposalId);
  if (!proposal) return;
  const status = policy.statuses.find((item) => item.code === proposal.reviewState);
  if (!status || status.terminal && proposal.reviewState !== "approved") throw new ReviewError(409, "CONFLICT", "A closed proposal cannot be edited.");
  // States the client is meant to edit in (draft, revising, changes requested) do not version each edit; resubmitting does.
  if (status.clientEditable) return;
  const versions = await store.listVersions(proposal.id);
  const number = (versions.at(-1)?.number ?? 0) + 1;
  await store.insertVersion({
    id: randomUUID(),
    proposalId: proposal.id,
    number,
    snapshot: snapshotOf(proposal),
    locked: false,
    createdById: actor.userId,
    reason: "commercial_edit",
  });
  const reopen = transitionFor(policy, proposal.reviewState, "in_review", actor.role);
  if (!reopen) return;
  await store.updateProposal(proposal.id, { reviewState: "in_review", ...recordStatusFor(policy, "in_review"), ...(reopen.clearsApprovedVersion ? { approvedVersionId: null } : {}) });
  await store.insertEvent({
    proposalId: proposal.id,
    actorId: actor.userId,
    actorRole: actor.role,
    fromStatus: proposal.reviewState,
    toStatus: "in_review",
    reasonCode: null,
    reasonText: "Scope or price changed.",
  });
}

/** Completion parts that a structured proposal field feeds. A locked part refuses writes to its field. */
export const FIELD_PARTS: Readonly<Record<string, readonly string[]>> = {
  scope: ["scope"],
  pricing: ["price", "hours"],
  engagement: ["price", "hours"],
  timeline: ["schedule", "milestones"],
};

/**
 * One rule for whether a write to proposal content may go ahead, used by structured (PATCH) and narrative writes.
 * Approved proposals are locked to their approved version: edits wait for an explicit reopen. Closed proposals refuse edits.
 * A part locked on a version refuses edits for every role. While the proposal is with Unwhelm, clients cannot edit;
 * staff and the agent can, and commercial edits by them are recorded as a new version.
 */
export function editRefusal(policy: ReviewPolicy, reviewState: string, role: ReviewActorRole, input: { part?: string; lockedParts?: Array<{ key: string; lockedVersionId: string | null }>; clientEditableCheck?: boolean } = {}): ReviewError | null {
  const status = policy.statuses.find((item) => item.code === reviewState);
  if (!status) return null;
  if (reviewState === "approved") {
    const reopen = policy.transitions.some((item) => item.fromStatus === "approved" && item.action === "reopen" && item.actorRole === role);
    return new ReviewError(409, "PROPOSAL_LOCKED", `This proposal is approved and its approved version is locked, so it cannot be edited.${reopen ? " Reopen it first (unw_reopen_proposal, or the review transition to in_review), which clears the approval and sends it back to staff review." : ""}`, { reviewState, role, reopenAvailable: reopen });
  }
  if (status.terminal) return new ReviewError(409, "CONFLICT", `A closed proposal cannot be edited. It is ${status.staffLabel.toLowerCase()}.`, { reviewState });
  const locked = (input.lockedParts ?? []).filter((item) => item.lockedVersionId);
  if (locked.length) {
    const keys = locked.map((item) => item.key);
    return new ReviewError(409, "SECTION_LOCKED", `The ${keys.join(", ")} part${keys.length > 1 ? "s are" : " is"} locked on a proposal version. Unlock it with unw_unlock_node before editing.`, { reviewState, lockedParts: locked.map((item) => ({ key: item.key, lockedVersionId: item.lockedVersionId })) });
  }
  if ((input.clientEditableCheck ?? true) && role === "client" && !status.clientEditable) {
    const what = input.part ? `The ${input.part} section is` : "This section is";
    return new ReviewError(409, "SECTION_LOCKED", `${what} locked because the proposal is ${status.clientLabel.toLowerCase()}. Start a revision before editing it.`, { reviewState, role });
  }
  return null;
}

/** Order-insensitive JSON equality for stored proposal fields. */
export function sameContent(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export function pricingFromLockedVersion(version: StoredVersion | null | undefined): unknown | undefined {
  if (!version?.locked) return undefined;
  return version.snapshot.pricing;
}
