import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import express from "express";
import type { Server } from "node:http";
import {
  addComment,
  applyTransition,
  reviseOwnComment,
  diffVersions,
  editRefusal,
  fieldDiff,
  transitionRefusal,
  noteCommercialEdit,
  unboundedFindings,
  workspaceFor,
  type ReviewPolicy,
  type ReviewStore,
  type StoredComment,
  type StoredEvent,
  type StoredFlag,
  type StoredMeeting,
  type StoredProposal,
  type StoredVersion,
} from "../../server/proposalReview.js";
import { changedProposalFields, createProposalReviewRouter, partsForFields } from "../../server/routes/proposalReview.js";

const migration = readFileSync(new URL("../../prisma/migrations/0019_proposal_review/migration.sql", import.meta.url), "utf8");

test("migration stores states, the declined label, phrases, and staff comment requirements", () => {
  assert.match(migration, /'rejected', 90, 'Declined'/);
  assert.match(migration, /'in_review', 'changes_requested', 'staff', 'request_changes', 'Request changes', false, true/);
  assert.match(migration, /'in_review', 'rejected', 'staff', 'reject', 'Decline', true, true/);
  assert.match(migration, /'in_review', 'approved', 'staff', 'approve', 'Approve', false, false, false, true, false, true, true/);
  assert.match(migration, /'as needed'/);
  assert.match(migration, /'chose_other', 'Chose someone else', 'reject,withdraw'/);
  assert.doesNotMatch(migration, /'client', 'approve'/);
});

const policy: ReviewPolicy = {
  statuses: [
    { code: "draft", sortOrder: 10, clientLabel: "Draft", staffLabel: "Draft", terminal: false, clientEditable: true },
    { code: "agent_review", sortOrder: 20, clientLabel: "With Unwhelm", staffLabel: "Agent review", terminal: false, clientEditable: false },
    { code: "in_review", sortOrder: 30, clientLabel: "In review", staffLabel: "Staff review", terminal: false, clientEditable: false },
    { code: "changes_requested", sortOrder: 40, clientLabel: "Changes requested", staffLabel: "Changes requested", terminal: false, clientEditable: false },
    { code: "client_revising", sortOrder: 50, clientLabel: "Revising", staffLabel: "Client revising", terminal: false, clientEditable: true },
    { code: "resubmitted", sortOrder: 60, clientLabel: "Resubmitted", staffLabel: "Resubmitted", terminal: false, clientEditable: false },
    { code: "review_meeting_scheduled", sortOrder: 70, clientLabel: "Review call scheduled", staffLabel: "Review meeting scheduled", terminal: false, clientEditable: false },
    { code: "approved", sortOrder: 80, clientLabel: "Approved", staffLabel: "Approved", terminal: true, clientEditable: false },
    { code: "rejected", sortOrder: 90, clientLabel: "Declined", staffLabel: "Rejected", terminal: true, clientEditable: false },
    { code: "withdrawn", sortOrder: 100, clientLabel: "Withdrawn", staffLabel: "Withdrawn", terminal: true, clientEditable: false },
  ],
  transitions: [
    { fromStatus: "draft", toStatus: "agent_review", actorRole: "agent", action: "submit", label: "Submit for agent review", requiresReason: false, requiresComment: false, snapshots: true, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: true },
    { fromStatus: "agent_review", toStatus: "in_review", actorRole: "agent", action: "handoff", label: "Hand to staff", requiresReason: false, requiresComment: false, snapshots: false, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: false },
    { fromStatus: "in_review", toStatus: "changes_requested", actorRole: "staff", action: "request_changes", label: "Request changes", requiresReason: false, requiresComment: true, snapshots: false, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: false },
    { fromStatus: "in_review", toStatus: "approved", actorRole: "staff", action: "approve", label: "Approve", requiresReason: false, requiresComment: false, snapshots: false, locksVersion: true, clearsApprovedVersion: false, blockedByOpenFlags: true, runsUnboundedCheck: true },
    { fromStatus: "in_review", toStatus: "rejected", actorRole: "staff", action: "reject", label: "Decline", requiresReason: true, requiresComment: true, snapshots: false, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: false },
    { fromStatus: "in_review", toStatus: "review_meeting_scheduled", actorRole: "staff", action: "schedule_meeting", label: "Schedule review call", requiresReason: false, requiresComment: false, snapshots: false, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: false },
    { fromStatus: "changes_requested", toStatus: "client_revising", actorRole: "client", action: "start_revision", label: "Start revision", requiresReason: false, requiresComment: false, snapshots: false, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: false },
    { fromStatus: "client_revising", toStatus: "resubmitted", actorRole: "client", action: "resubmit", label: "Resubmit", requiresReason: false, requiresComment: false, snapshots: true, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: false },
    { fromStatus: "resubmitted", toStatus: "in_review", actorRole: "staff", action: "take_up", label: "Take up resubmission", requiresReason: false, requiresComment: false, snapshots: false, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: false },
    { fromStatus: "approved", toStatus: "in_review", actorRole: "client", action: "reopen", label: "Edit after approval", requiresReason: false, requiresComment: false, snapshots: true, locksVersion: false, clearsApprovedVersion: true, blockedByOpenFlags: false, runsUnboundedCheck: false },
    { fromStatus: "draft", toStatus: "withdrawn", actorRole: "client", action: "withdraw", label: "Withdraw", requiresReason: true, requiresComment: false, snapshots: false, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: false },
  ],
  commentTypes: [
    { code: "question", blocksApproval: false },
    { code: "pushback", blocksApproval: false },
    { code: "clarification", blocksApproval: false },
    { code: "needs_bounding", blocksApproval: true },
  ],
  visibilities: ["internal", "client"],
  openStatus: "open",
  resolvedStatus: "resolved",
  reasonCodes: [
    { code: "budget", label: "Budget", appliesTo: ["reject", "withdraw"] },
    { code: "timing", label: "Timing", appliesTo: ["reject", "withdraw"] },
    { code: "scope", label: "Scope", appliesTo: ["reject", "withdraw"] },
    { code: "chose_other", label: "Chose someone else", appliesTo: ["reject", "withdraw"] },
    { code: "other", label: "Other", appliesTo: ["reject", "withdraw"] },
  ],
  phrases: ["as needed", "ongoing"],
  checks: [
    { code: "missing_total", kind: "missing_total", enabled: true },
    { code: "missing_hour_cap", kind: "missing_hour_cap", enabled: true },
    { code: "open_ended_phrase", kind: "phrase", enabled: true },
  ],
  limits: { comment_body_max: 4000, reason_text_max: 2000, meeting_notes_max: 2000, meeting_link_max: 500 },
  flagKinds: [{ code: "unbounded", blocksApproval: true, allowedRoles: ["staff", "agent"] }],
};

function memoryStore(initial: StoredProposal): ReviewStore & { proposal: StoredProposal; comments: StoredComment[]; flags: StoredFlag[]; versions: StoredVersion[]; events: StoredEvent[] } {
  const bag = {
    proposal: initial,
    comments: [] as StoredComment[],
    flags: [] as StoredFlag[],
    versions: [] as StoredVersion[],
    events: [] as StoredEvent[],
    meeting: null as StoredMeeting | null,
  };
  const store: ReviewStore = {
    policy: async () => policy,
    listProposals: async (state) => state && bag.proposal.reviewState !== state ? [] : [bag.proposal],
    getProposal: async (id) => bag.proposal.id === id ? bag.proposal : null,
    updateProposal: async (_id, data) => { Object.assign(bag.proposal, data, { updatedAt: new Date() }); return bag.proposal; },
    listVersions: async () => bag.versions,
    insertVersion: async (row) => { const stored = { ...row, createdAt: row.createdAt ?? new Date() }; bag.versions.push(stored); return stored; },
    lockVersion: async (id) => { const version = bag.versions.find((item) => item.id === id); if (version) version.locked = true; },
    listComments: async () => bag.comments,
    insertComment: async (row) => { const stored = { ...row, createdAt: row.createdAt ?? new Date() }; bag.comments.push(stored); return stored; },
    updateComment: async (id, data) => { const comment = bag.comments.find((item) => item.id === id); if (!comment) throw new Error("missing"); if (data.status !== undefined) comment.status = data.status; if (data.body !== undefined) comment.body = data.body; return comment; },
    listFlags: async () => bag.flags,
    insertFlag: async (row) => { const stored = { ...row, createdAt: row.createdAt ?? new Date() }; bag.flags.push(stored); return stored; },
    updateFlag: async (id, data) => { const flag = bag.flags.find((item) => item.id === id); if (!flag) throw new Error("missing"); flag.status = data.status; return flag; },
    listEvents: async () => bag.events,
    insertEvent: async (row) => { const stored = { ...row, id: row.id ?? crypto.randomUUID(), createdAt: new Date() }; bag.events.push(stored); return stored; },
    getMeeting: async () => bag.meeting,
    upsertMeeting: async (row) => { bag.meeting = row; return row; },
  };
  return Object.assign(store, bag);
}

const proposal = (): StoredProposal => ({
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "55555555-5555-4555-8555-555555555555",
  ownerId: "22222222-2222-4222-8222-222222222222",
  title: "Field mapping",
  reviewState: "draft",
  approvedVersionId: null,
  scope: { summary: "Map the intake.", deliverables: ["Map"] },
  timeline: {},
  pricing: { model: "fixed_price", amountMinor: 100000, currency: "USD" },
  options: [],
  milestones: [],
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
});

test("roles follow the transition table, and a client cannot approve", async () => {
  const store = memoryStore(proposal());
  await assert.rejects(() => applyTransition(store, { proposalId: store.proposal.id, actorId: "c", actorRole: "client", toStatus: "approved" }), /not allowed/);
  await assert.rejects(() => applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "approved" }), /not allowed/);
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "agent_review" });
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "in_review" });
  await assert.rejects(() => applyTransition(store, { proposalId: store.proposal.id, actorId: "c", actorRole: "client", toStatus: "approved" }), /not allowed/);
  await assert.rejects(() => applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "changes_requested" }), /comment is required/);
  await assert.rejects(() => applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "rejected", commentBody: "No.", commentType: "pushback" }), /reason code/);
  assert.equal(store.events.at(-1)?.toStatus, "in_review");
});

test("approval waits for blocking flags, and resubmit stores a diffable version", async () => {
  const store = memoryStore({ ...proposal(), scope: { summary: "Support as needed." } });
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "agent_review" });
  assert.equal(store.versions.length, 1);
  assert.equal(store.flags.some((flag) => flag.automatic && flag.status === "open"), true);
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "in_review" });
  await assert.rejects(() => applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "approved" }), /blocking flags/);
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "changes_requested", commentBody: "Bound the support.", commentType: "needs_bounding" });
  assert.equal(store.proposal.reviewState, "changes_requested");
  await assert.rejects(() => applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "approved" }), /not allowed/);
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "c", actorRole: "client", toStatus: "client_revising" });
  store.proposal.scope = { summary: "Forty hours of support." };
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "c", actorRole: "client", toStatus: "resubmitted" });
  assert.equal(store.versions.length, 2);
  assert.equal(store.versions[1]?.number, 2);
  const diff = await diffVersions(store, store.proposal.id, 1, 2);
  assert.ok(diff.changes.some((change) => change.path.includes("summary")));
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "in_review" });
  for (const flag of store.flags) flag.status = "resolved";
  const openBlockingComment = store.comments.find((comment) => comment.typeCode === "needs_bounding");
  assert.ok(openBlockingComment);
  await assert.rejects(() => applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "approved" }), /blocking flags/);
  openBlockingComment.status = "resolved";
  const approved = await applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "approved" });
  assert.equal(approved.version?.locked, true);
  assert.equal(store.proposal.approvedVersionId, approved.version?.id);
  store.proposal.pricing = { model: "fixed_price", amountMinor: 120000, currency: "USD" };
  await noteCommercialEdit(store, store.proposal.id, { userId: "c", role: "client" });
  assert.equal(store.proposal.reviewState, "in_review");
  assert.equal(store.proposal.approvedVersionId, null);
  assert.equal(store.versions.length, 4);
});

test("hourly work without a cap and open-ended phrases are unbounded findings", () => {
  const findings = unboundedFindings(policy, {
    title: "Care",
    scope: { summary: "Help ongoing." },
    timeline: {},
    pricing: { model: "hourly", currency: "USD" },
    options: [],
    milestones: [],
  });
  assert.ok(findings.some((item) => item.reason.includes("cap")));
  assert.ok(findings.some((item) => item.reason.includes("ongoing")));
  const ongoing = findings.find((item) => item.reason.includes("ongoing"));
  assert.equal(ongoing?.fieldPath, "scope.summary");
  assert.equal(ongoing?.targetKind, "field");
  assert.equal(ongoing?.targetId, "scope.summary");
});

test("field diff names the changed field", () => {
  const changes = fieldDiff({ scope: { summary: "A" } }, { scope: { summary: "B" } });
  assert.deepEqual(changes, [{ path: "scope.summary", before: "A", after: "B" }]);
});

test("a client workspace hides internal comments and flags", async () => {
  const store = memoryStore({ ...proposal(), reviewState: "in_review" });
  await store.insertComment({ id: "c1", proposalId: store.proposal.id, parentId: null, targetKind: "proposal", targetId: null, typeCode: "question", status: "open", visibility: "internal", authorRole: "staff", authorId: "s", body: "Internal only" });
  await store.insertComment({ id: "c2", proposalId: store.proposal.id, parentId: null, targetKind: "scope", targetId: null, typeCode: "pushback", status: "open", visibility: "client", authorRole: "staff", authorId: "s", body: "Please narrow the scope." });
  await store.insertFlag({ id: "f1", proposalId: store.proposal.id, targetKind: "proposal", targetId: null, kind: "unbounded", reason: "secret", status: "open", visibility: "internal", authorRole: "staff", authorId: "s", blocksApproval: true, automatic: false });
  const client = await workspaceFor(store, store.proposal.id, "client");
  assert.deepEqual(client.comments.map((comment) => comment.id), ["c2"]);
  assert.equal(client.flags.length, 0);
  assert.equal(client.clientLabel, "In review");
  const staff = await workspaceFor(store, store.proposal.id, "staff");
  assert.equal(staff.comments.length, 2);
  assert.equal(staff.flags.length, 1);
  const rejected = policy.statuses.find((item) => item.code === "rejected");
  assert.equal(rejected?.clientLabel, "Declined");
});

test("the review route returns the same client filter and refuses a client approval", async () => {
  const store = memoryStore({ ...proposal(), reviewState: "in_review" });
  await store.insertComment({ id: "c1", proposalId: store.proposal.id, parentId: null, targetKind: "proposal", targetId: null, typeCode: "question", status: "open", visibility: "internal", authorRole: "agent", authorId: "a", body: "Keep this internal" });
  const app = express();
  app.use(express.json());
  const client = { userId: store.proposal.ownerId, organizationId: store.proposal.organizationId ?? undefined, membershipRole: "client" as const, isAdmin: false, scopes: ["proposals:read", "proposals:write"] };
  app.use("/api/v1", createProposalReviewRouter({
    prisma: {} as never,
    store,
    authorize: async (request) => request.header("x-test-role") === "staff" ? { ...client, membershipRole: "staff", isAdmin: true } : client,
  }));
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const visible = await fetch(`${base}/api/v1/proposals/${store.proposal.id}/review`);
    const body = await visible.json() as { ok: boolean; entity: { comments: Array<{ visibility: string }> } };
    assert.equal(body.ok, true);
    assert.equal(body.entity.comments.length, 0);
    const denied = await fetch(`${base}/api/v1/proposals/${store.proposal.id}/review/transition`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: "approved" }) });
    const denial = await denied.json() as { ok: boolean; code: string };
    assert.equal(denied.status, 403);
    assert.equal(denial.ok, false);
    assert.equal(denial.code, "FORBIDDEN");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a client gets 403 for approve and request_changes whatever the proposal's state", async () => {
  for (const state of ["draft", "in_review", "client_revising"]) {
    const store = memoryStore({ ...proposal(), reviewState: state });
    const app = express();
    app.use(express.json());
    const client = { userId: store.proposal.ownerId, organizationId: store.proposal.organizationId ?? undefined, membershipRole: "client" as const, isAdmin: false, scopes: ["proposals:read", "proposals:write"] };
    app.use("/api/v1", createProposalReviewRouter({ prisma: {} as never, store, authorize: async () => client }));
    const server = await new Promise<Server>((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    try {
      for (const to of ["approved", "changes_requested", "rejected"]) {
        const denied = await fetch(`http://127.0.0.1:${address.port}/api/v1/proposals/${store.proposal.id}/review/transition`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to, commentBody: "x", reasonCode: "other" }) });
        assert.equal(denied.status, 403, `${state} -> ${to}`);
        assert.equal((await denied.json() as { code: string }).code, "FORBIDDEN");
      }
      assert.equal(store.proposal.reviewState, state);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("open-ended words in scope exclusions are not findings, and stale automatic flags resolve on the next check", async () => {
  const snapshot = { title: "Site refresh", scope: { summary: "Refresh the site.", deliverables: ["Design"], exclusions: ["Ongoing marketing or ongoing SEO."] }, timeline: {}, pricing: { model: "fixed_price", amountMinor: 1500000, currency: "USD" }, options: [], milestones: [] };
  assert.deepEqual(unboundedFindings(policy, snapshot), []);
  assert.ok(unboundedFindings(policy, { ...snapshot, scope: { ...snapshot.scope, summary: "Ongoing support." } }).some((item) => item.reason.includes("ongoing") && item.fieldPath === "scope.summary"));

  const store = memoryStore({ ...proposal(), scope: { summary: "Support as needed.", deliverables: ["Support"] } });
  const reviewAgain = { fromStatus: "resubmitted", toStatus: "agent_review", actorRole: "agent" as const, action: "handoff", label: "Review again", requiresReason: false, requiresComment: false, snapshots: false, locksVersion: false, clearsApprovedVersion: false, blockedByOpenFlags: false, runsUnboundedCheck: true };
  if (!policy.transitions.some((item) => item.fromStatus === "resubmitted" && item.toStatus === "agent_review")) policy.transitions.push(reviewAgain);
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "agent_review" });
  assert.equal(store.flags.filter((flag) => flag.status === "open").length, 1);
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "in_review" });
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "changes_requested", commentBody: "Bound it.", commentType: "pushback" });
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "c", actorRole: "client", toStatus: "client_revising" });
  store.proposal.scope = { summary: "Forty hours of support.", deliverables: ["Support"], exclusions: ["No ongoing retainer."] };
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "c", actorRole: "client", toStatus: "resubmitted" });
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "agent_review" });
  assert.equal(store.flags.filter((flag) => flag.status === "open").length, 0, "the as-needed flag resolves once the text is bounded");
});

const TERMS_EXCLUSION_SENTENCE = "Work outside Phase 1 (such as CRM integrations, new photography, or ongoing SEO) will be scoped separately for Phase 2.";

test("narrative sentences about excluded or later-phase work are not unbounded, and flags name the field", () => {
  const base = { title: "Law firm site", scope: { summary: "Phase 1 website." }, timeline: {}, pricing: { model: "fixed_price", amountMinor: 1500000, currency: "USD" }, options: [], milestones: [] };
  assert.deepEqual(unboundedFindings(policy, base, [{ key: "terms", text: TERMS_EXCLUSION_SENTENCE }]), []);

  const flagged = unboundedFindings(policy, base, [{ key: "terms", text: "Ongoing support is included at no extra cost." }]);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0]?.fieldPath, "terms");
  assert.equal(flagged[0]?.targetKind, "section");
  assert.equal(flagged[0]?.targetId, "terms");
  assert.match(flagged[0]?.reason ?? "", /Open-ended language “ongoing” in terms:/);
  assert.match(flagged[0]?.reason ?? "", /Ongoing support is included at no extra cost/);

  const mixed = unboundedFindings(policy, base, [{ key: "terms", text: `${TERMS_EXCLUSION_SENTENCE} Ongoing support is included at no extra cost.` }]);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0]?.fieldPath, "terms");
  assert.match(mixed[0]?.reason ?? "", /Ongoing support is included at no extra cost/);
});

test("submit records the triggering field on an automatic unbounded flag", async () => {
  const store = memoryStore({ ...proposal(), scope: { summary: "Phase 1 website." } });
  store.listSections = async () => [{ key: "terms", text: "Ongoing support is included at no extra cost." }];
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "agent_review" });
  const flag = store.flags.find((item) => item.status === "open" && item.automatic);
  assert.ok(flag);
  assert.equal(flag.targetKind, "section");
  assert.equal(flag.targetId, "terms");
  assert.match(flag.reason, /Open-ended language “ongoing” in terms:/);
  assert.match(flag.reason, /Ongoing support is included at no extra cost/);
});

test("approve reports its version as locked even when the store returns a copy", async () => {
  const store = memoryStore(proposal());
  const insert = store.insertVersion;
  store.insertVersion = async (row) => ({ ...(await insert(row)) });
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "agent_review" });
  await applyTransition(store, { proposalId: store.proposal.id, actorId: "a", actorRole: "agent", toStatus: "in_review" });
  const approved = await applyTransition(store, { proposalId: store.proposal.id, actorId: "s", actorRole: "staff", toStatus: "approved" });
  assert.equal(approved.version?.locked, true);
});

test("a refused transition names the state and the moves that are open", () => {
  const refusal = transitionRefusal(policy, "draft", "approved", "agent");
  assert.equal(refusal.status, 409);
  assert.match(refusal.message, /not allowed/);
  assert.match(refusal.message, /agent_review \(submit\)/);
  assert.deepEqual(refusal.details?.allowedTransitions, [{ to: "agent_review", action: "submit" }]);
});

test("edit rule: approved and closed refuse, locked parts refuse every role, clients wait while Unwhelm reviews", () => {
  assert.equal(editRefusal(policy, "approved", "staff")?.code, "PROPOSAL_LOCKED");
  assert.equal(editRefusal(policy, "rejected", "staff")?.code, "CONFLICT");
  assert.equal(editRefusal(policy, "agent_review", "staff"), null);
  assert.equal(editRefusal(policy, "agent_review", "client")?.code, "SECTION_LOCKED");
  assert.equal(editRefusal(policy, "agent_review", "client", { clientEditableCheck: false }), null);
  assert.equal(editRefusal(policy, "draft", "staff", { lockedParts: [{ key: "scope", lockedVersionId: "v1" }] })?.code, "SECTION_LOCKED");
  assert.equal(editRefusal(policy, "draft", "client", { lockedParts: [{ key: "scope", lockedVersionId: null }] }), null);
});

test("identical PATCH values are not changes, and milestone ids do not count", () => {
  const old = { scope: { summary: "A", deliverables: ["x"], assumptions: [], exclusions: [] }, pricing: { model: "fixed_price", amountMinor: 1, currency: "USD" }, timeline: { startDate: "2026-11-16", targetDate: null, milestones: [{ id: "m1", title: "Kickoff", description: "", dueDate: "2026-11-16" }] } };
  assert.deepEqual(changedProposalFields(old, { pricing: { currency: "USD", amountMinor: 1, model: "fixed_price" }, scope: { deliverables: ["x"], summary: "A", assumptions: [], exclusions: [] } }), []);
  assert.deepEqual(changedProposalFields(old, { timeline: { startDate: "2026-11-16", targetDate: null, milestones: [{ id: "m2", title: "Kickoff", description: "", dueDate: "2026-11-16" }] } }), []);
  assert.deepEqual(changedProposalFields(old, { pricing: { model: "fixed_price", amountMinor: 2, currency: "USD" }, title: undefined }), ["pricing"]);
  assert.deepEqual(partsForFields(["scope", "timeline"]), ["scope", "schedule", "milestones"]);
});


test("an author can rewrite or supersede their own comment", async () => {
  const store = memoryStore(proposal());
  const author = "22222222-2222-4222-8222-222222222222";
  const created = await addComment(store, { proposalId: store.proposal.id, actorId: author, actorRole: "agent", body: "One unbroken paragraph.", typeCode: "clarification", visibility: "internal" });
  const rewritten = await reviseOwnComment(store, { proposalId: store.proposal.id, commentId: created.id, actorId: author, actorRole: "agent", body: "The ask.\n\n- 60 to 110 hours" });
  assert.equal(rewritten.comment.body, "The ask.\n\n- 60 to 110 hours");
  assert.equal(rewritten.successor, undefined);
  await assert.rejects(() => reviseOwnComment(store, { proposalId: store.proposal.id, commentId: created.id, actorId: "someone-else", actorRole: "staff", body: "No." }), /author/);
  const superseded = await reviseOwnComment(store, { proposalId: store.proposal.id, commentId: created.id, actorId: author, actorRole: "agent", body: "- 60 hours low\n- 110 hours high", supersede: true });
  assert.equal(superseded.comment.status, "superseded");
  assert.equal(superseded.successor?.parentId, created.id);
  await assert.rejects(() => reviseOwnComment(store, { proposalId: store.proposal.id, commentId: created.id, actorId: author, actorRole: "agent", body: "Again." }), /open/);
});

test("excluded text does not hide a separate unbounded commitment", () => {
  const base = { title: "Site", scope: {}, timeline: {}, pricing: { model: "fixed_price", amountMinor: 1500000 }, options: [], milestones: [] };
  for (const text of [
    "SEO is excluded. ongoing support is included at no extra cost.",
    "SEO is excluded\nOngoing support is included at no extra cost",
    "SEO is excluded; ongoing support is included at no extra cost.",
    "SEO is excluded but ongoing support is included at no extra cost.",
  ]) {
    const findings = unboundedFindings(policy, base, [{ key: "terms", text }]);
    assert.equal(findings.length, 1, text);
    assert.equal(findings[0]?.targetId, "terms");
    assert.match(findings[0]?.reason ?? "", /ongoing/i);
  }
});
