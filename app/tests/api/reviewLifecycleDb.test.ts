// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
// Covers the review lifecycle gaps found by the MCP proposal sweep: approval safety, exclusion flags and flag resolution,
// the changes-requested dead end, the staff-review handoff, node locks, and comment targets.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express, { type Request } from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";
import { createChatProposalReadRouter } from "../../server/routes/chatProposalRead.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";
import { createProposalReviewRouter } from "../../server/routes/proposalReview.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type Envelope = { ok: boolean; changed?: boolean; code?: string; message?: string; details?: unknown; entity: any };
type Role = "staff" | "client" | "agent";

const lawFirmScope = {
  summary: "Refresh the firm's WordPress site.",
  deliverables: ["Content audit", "Responsive design", "Lead forms"],
  assumptions: ["Existing content is reused."],
  exclusions: ["Ongoing marketing, paid advertising, or ongoing SEO campaigns.", "New photography."],
};
const pricing = { model: "fixed_price", amountMinor: 1500000, currency: "USD" };

async function harness() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `lifecycle-${randomUUID()}@test.invalid`, displayName: "Lifecycle" } });
  const proposal = await prisma.proposal.create({ data: {
    ownerId: owner.id, title: "Law firm refresh", engagement: "fixed_price", pricingModel: "fixed_price",
    scope: lawFirmScope, timeline: {}, pricing,
  } });
  const roleOf = (request: Request): Role => (request.header("x-test-role") as Role | undefined) ?? "client";
  const principal = (request: Request) => {
    const role = roleOf(request);
    return { userId: owner.id, membershipRole: role === "client" ? "client" as const : "staff" as const, isAdmin: false, scopes: null };
  };
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createChatProposalReadRouter({ prisma, resolveAuth: (request) => ({ userId: owner.id, role: roleOf(request) === "client" ? "client" : "staff", scopes: ["proposals:read", "proposals:write"] }) }));
  app.use("/api/v1", createProposalReviewRouter({ prisma, authorize: async (request) => principal(request) }));
  app.use("/api/v1", createProposalCompletionRouter({ prisma, authorize: async (request) => principal(request) }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/proposals/${proposal.id}`;
  const call = async (role: Role, path: string, method = "GET", body?: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-test-role": role };
    if (role === "agent") headers["x-unw-review-actor"] = "agent";
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Envelope };
  };
  const transition = (role: Role, body: Record<string, unknown>) => call(role, "/review/transition", "POST", body);
  const state = async () => (await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } }));
  const close = async () => {
    server.close();
    await deleteProposalCascade(prisma, proposal.id);
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  };
  return { prisma, proposal, call, transition, state, close };
}

test("scope exclusions are not flagged, flags can be resolved, and approve is reachable through staff review", { skip }, async () => {
  const h = await harness();
  try {
    assert.equal((await h.transition("agent", { to: "agent_review" })).status, 200);
    const flags = await h.prisma.proposalReviewFlag.findMany({ where: { proposalId: h.proposal.id } });
    assert.deepEqual(flags.map((flag) => flag.reason), [], "Ongoing in scope.exclusions must not raise an open-ended flag");

    // Approve straight from agent review is refused with the transitions that would work.
    const early = await h.transition("staff", { to: "approved" });
    assert.equal(early.status, 409);
    assert.match(early.body.message ?? "", /in_review \(handoff\)/);
    assert.deepEqual((early.body.details as { allowedTransitions: Array<{ to: string }> }).allowedTransitions.map((item) => item.to).sort(), ["in_review", "review_meeting_scheduled"]);

    // unw_start_staff_review guards against reopening: from agent review the move to in_review is a handoff.
    const handoff = await h.transition("staff", { to: "in_review", actions: ["handoff", "take_up"] });
    assert.equal(handoff.status, 200);
    assert.equal(handoff.body.entity.state, "in_review");

    const flag = await h.call("agent", "/review/flags", "POST", { kind: "unbounded", reason: "Support is open-ended.", visibility: "client" });
    assert.equal(flag.status, 201);
    const blocked = await h.transition("staff", { to: "approved" });
    assert.equal(blocked.status, 409);
    assert.equal((blocked.body.details as { openFlags: Array<{ id: string }> }).openFlags[0]?.id, flag.body.entity.id);
    const resolved = await h.call("agent", `/review/flags/${flag.body.entity.id}/resolve`, "POST", {});
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.entity.status, "resolved");

    const approved = await h.transition("staff", { to: "approved" });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.entity.version.locked, true, "the approve response reports the locked version");
    const row = await h.state();
    assert.equal(row.approvedVersionId, approved.body.entity.version.id);

    // A handoff guard on an approved proposal does not silently reopen it.
    const guarded = await h.transition("staff", { to: "in_review", actions: ["handoff", "take_up"] });
    assert.equal(guarded.status, 409);
    assert.equal((await h.state()).reviewState, "approved");
  } finally { await h.close(); }
});

test("an approved proposal ignores identical writes, refuses real edits, and reopens only explicitly", { skip }, async () => {
  const h = await harness();
  try {
    await h.transition("agent", { to: "agent_review" });
    await h.transition("staff", { to: "in_review" });
    const approved = await h.transition("staff", { to: "approved" });
    assert.equal(approved.status, 200);
    const before = await h.state();

    const same = await h.call("staff", "", "PATCH", { pricing });
    assert.equal(same.status, 200);
    assert.equal(same.body.changed, false);
    const after = await h.state();
    assert.equal(after.reviewState, "approved");
    assert.equal(after.approvedVersionId, before.approvedVersionId);
    assert.equal(after.version, before.version, "a no-op does not bump the version");
    assert.equal(await h.prisma.proposalVersion.count({ where: { proposalId: h.proposal.id } }), 2);

    const sameScope = await h.call("staff", "", "PATCH", { scope: { ...lawFirmScope, exclusions: [...lawFirmScope.exclusions] } });
    assert.equal(sameScope.body.changed, false);

    const edit = await h.call("staff", "", "PATCH", { pricing: { ...pricing, amountMinor: 1600000 } });
    assert.equal(edit.status, 409);
    assert.equal(edit.body.code, "PROPOSAL_LOCKED");
    const narrative = await h.call("staff", "/narrative/executive_summary", "PUT", { text: "Changed after approval." });
    assert.equal(narrative.status, 409);
    assert.equal(narrative.body.code, "PROPOSAL_LOCKED");
    assert.equal((await h.state()).approvedVersionId, before.approvedVersionId);

    const reopened = await h.transition("agent", { to: "in_review", actions: ["reopen"] });
    assert.equal(reopened.status, 200);
    const open = await h.state();
    assert.equal(open.reviewState, "in_review");
    assert.equal(open.approvedVersionId, null);
    assert.equal((await h.call("staff", "", "PATCH", { pricing: { ...pricing, amountMinor: 1600000 } })).status, 200);
  } finally { await h.close(); }
});

test("after changes are requested the client can edit scope and narrative and resubmit", { skip }, async () => {
  const h = await harness();
  try {
    await h.transition("agent", { to: "agent_review" });
    await h.transition("staff", { to: "in_review" });
    const requested = await h.transition("staff", { to: "changes_requested", commentBody: "Narrow the deliverables.", commentType: "pushback" });
    assert.equal(requested.status, 200);

    const workspace = await h.call("client", "/review");
    assert.equal(workspace.body.entity.clientEditable, true);
    assert.deepEqual(workspace.body.entity.allowedTransitions.map((item: { to: string }) => item.to).sort(), ["client_revising", "resubmitted", "withdrawn"]);

    const scope = await h.call("client", "", "PATCH", { scope: { ...lawFirmScope, deliverables: ["Content audit", "Responsive design"] } });
    assert.equal(scope.status, 200);
    const narrative = await h.call("client", "/narrative/executive_summary", "PUT", { text: "A narrower refresh." });
    assert.equal(narrative.status, 200);
    assert.equal((await h.state()).reviewState, "changes_requested", "client edits while changes are requested do not move the review");

    // unw_submit_proposal_for_review after changes were requested resubmits.
    const resubmitted = await h.transition("agent", { to: "agent_review" });
    assert.equal(resubmitted.status, 200);
    assert.equal(resubmitted.body.entity.state, "resubmitted");
    assert.equal(resubmitted.body.entity.version.number, 2);

    // Taking up the resubmission and requesting changes again, then starting a revision first, also resubmits.
    await h.transition("staff", { to: "in_review", actions: ["handoff", "take_up"] });
    await h.transition("staff", { to: "changes_requested", commentBody: "One more pass.", commentType: "pushback" });
    assert.equal((await h.transition("agent", { to: "client_revising" })).status, 200);
    assert.equal((await h.transition("agent", { to: "resubmitted" })).body.entity.state, "resubmitted");
  } finally { await h.close(); }
});

test("a locked part refuses edits for every role, unlocked parts stay editable for staff, and unknown versions are 404", { skip }, async () => {
  const h = await harness();
  try {
    const submitted = await h.transition("agent", { to: "agent_review" });
    const versionId = submitted.body.entity.version.id as string;

    const missing = await h.call("staff", "/completion/nodes/scope/lock", "POST", { versionId: randomUUID() });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");

    assert.equal((await h.call("staff", "/completion/nodes/scope/lock", "POST", { versionId })).status, 200);
    const scope = await h.call("staff", "", "PATCH", { scope: { ...lawFirmScope, summary: "Different." } });
    assert.equal(scope.status, 409);
    assert.equal(scope.body.code, "SECTION_LOCKED");
    const removed = await h.call("staff", "/sections/scope", "DELETE");
    assert.equal(removed.status, 409);

    // Unlocked narrative parts stay editable for staff during review, and stay closed to the client.
    assert.equal((await h.call("staff", "/narrative/executive_summary", "PUT", { text: "Staff tidy-up during review." })).status, 200);
    const client = await h.call("client", "/narrative/background", "PUT", { text: "Client edit during review." });
    assert.equal(client.status, 409);
    assert.equal(client.body.code, "SECTION_LOCKED");

    assert.equal((await h.call("staff", "/completion/nodes/scope/unlock", "POST", {})).status, 200);
    assert.equal((await h.call("staff", "", "PATCH", { scope: { ...lawFirmScope, summary: "Different." } })).status, 200);
  } finally { await h.close(); }
});

test("review comments check their targets and replies keep the parent's target", { skip }, async () => {
  const h = await harness();
  try {
    await h.call("staff", "/sections");
    const noId = await h.call("agent", "/review/comments", "POST", { body: "Which section?", type: "question", targetKind: "section" });
    assert.equal(noId.status, 400);
    assert.match(noId.body.message ?? "", /targetId/);
    const fake = await h.call("agent", "/review/comments", "POST", { body: "Fake.", type: "question", targetKind: "section", targetId: "not_a_part" });
    assert.equal(fake.status, 404);
    assert.ok(((fake.body.details as { known: string[] }).known).includes("executive_summary"));
    assert.equal((await h.call("agent", "/review/comments", "POST", { body: "Fake field.", type: "question", targetKind: "field", targetId: "scope.nope" })).status, 404);
    assert.equal((await h.call("agent", "/review/comments", "POST", { body: "Fake milestone.", type: "question", targetKind: "milestone", targetId: randomUUID() })).status, 404);
    assert.equal((await h.call("agent", "/review/comments", "POST", { body: "Fake option.", type: "question", targetKind: "option", targetId: randomUUID() })).status, 404);
    assert.equal((await h.call("agent", "/review/comments", "POST", { body: "Fake line.", type: "question", targetKind: "pricing_line", targetId: "line-1" })).status, 404);

    const field = await h.call("agent", "/review/comments", "POST", { body: "Name the forms.", type: "question", targetKind: "field", targetId: "scope.deliverables[2]" });
    assert.equal(field.status, 201);
    const section = await h.call("agent", "/review/comments", "POST", { body: "Tighten this.", type: "pushback", targetKind: "section", targetId: "executive_summary" });
    assert.equal(section.status, 201);
    const reply = await h.call("client", "/review/comments", "POST", { body: "Will do.", type: "clarification", parentId: section.body.entity.id });
    assert.equal(reply.status, 201);
    const stored = await h.prisma.proposalReviewComment.findUniqueOrThrow({ where: { id: reply.body.entity.id } });
    assert.equal(stored.targetKind, "section");
    assert.equal(stored.targetId, "executive_summary");
    const mismatched = await h.call("client", "/review/comments", "POST", { body: "Wrong place.", type: "clarification", parentId: section.body.entity.id, targetKind: "scope" });
    assert.equal(mismatched.status, 400);

    const invalid = await h.call("agent", "/review/comments", "POST", { body: "", type: "question" });
    assert.equal(invalid.status, 400);
    assert.match(invalid.body.message ?? "", /body/);
  } finally { await h.close(); }
});
