// Proposal authoring fixes from the MCP tool sweep: duplicates with a pending staff price, milestone ids and weekOffset,
// impossible dates, template switches that keep written text, option selection checks, and export formats.
// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { createChatProposalReadRouter } from "../../server/routes/chatProposalRead.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";
import { createProposalDuplicateRouter } from "../../server/routes/proposalDuplicate.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type Envelope<T = Record<string, unknown>> = { ok: boolean; changed?: boolean; code?: string; message?: string; details?: unknown[]; entity: T; warnings: Array<{ code: string; message: string }>; links: Record<string, string> };
type Milestone = { id: string; title: string; dueDate: string | null; weekOffset?: number };
type Doc = { id: string; pricing: Record<string, unknown>; timeline: { startDate: string | null; targetDate: string | null; milestones: Milestone[] }; options: Array<{ id: string; selected: boolean }> };

async function harness() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `authoring-${randomUUID()}@test.invalid`, displayName: "Authoring" } });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { request.session.userId = owner.id; next(); });
  app.use("/api/v1", createChatProposalReadRouter({ prisma, resolveAuth: () => ({ userId: owner.id, role: "client", scopes: ["proposals:read", "proposals:write"] }) }));
  app.use("/api/v1", createProposalDuplicateRouter({ prisma }));
  app.use("/api/v1", createProposalContractRouter({ prisma, authorize: async () => ({ userId: owner.id, organizationId: null, role: "client" }) as never }));
  app.use("/api/v1", createProposalCompletionRouter({ prisma }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const call = async <T = Record<string, unknown>>(path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Envelope<T> };
  };
  const ids: string[] = [];
  const create = async (extra: Record<string, unknown> = {}) => {
    const created = await call<Doc>("/proposals", "POST", {
      title: "Law firm website refresh", engagement: "fixed_price",
      scope: { summary: "Refresh the WordPress site.", deliverables: ["Content audit"], assumptions: [], exclusions: [] },
      pricing: { model: "fixed_price", amountMinor: 1_500_000, currency: "USD" }, ...extra,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    ids.push(created.body.entity.id);
    return created;
  };
  const close = async () => {
    server.close();
    for (const id of ids) await deleteProposalCascade(prisma, id).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    await prisma.$disconnect();
  };
  return { prisma, call, create, ids, close };
}

test("milestones keep ids, store weekOffset without a start date, and resolve when the start date arrives", { skip }, async () => {
  const h = await harness();
  try {
    const created = await h.create({ timeline: { startDate: null, targetDate: null, milestones: [
      { title: "Discovery", description: "Audit", weekOffset: 2 },
      { title: "Launch", description: "Go live", weekOffset: 9 },
    ] } });
    assert.deepEqual(created.body.warnings.map((warning) => warning.code), ["MILESTONE_WEEK_OFFSET_UNRESOLVED", "MILESTONE_WEEK_OFFSET_UNRESOLVED"]);
    const id = created.body.entity.id;
    const before = created.body.entity.timeline.milestones;
    assert.deepEqual(before.map((m) => [m.title, m.dueDate, m.weekOffset]), [["Discovery", null, 2], ["Launch", null, 9]]);

    const started = await h.call<Doc>(`/proposals/${id}`, "PATCH", { timeline: { startDate: "2026-11-16" } });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.deepEqual(started.body.entity.timeline.milestones.map((m) => [m.title, m.dueDate, m.weekOffset]), [["Discovery", "2026-11-30", 2], ["Launch", "2027-01-18", 9]]);
    assert.deepEqual(started.body.entity.timeline.milestones.map((m) => m.id), before.map((m) => m.id));

    // Sending the milestones back with their ids keeps the ids; a re-sent title without an id reuses the existing id.
    const resent = await h.call<Doc>(`/proposals/${id}`, "PATCH", { timeline: { milestones: [
      { id: before[0]!.id, title: "Discovery", description: "Audit and baseline", weekOffset: 2 },
      { title: "Launch", description: "Go live", weekOffset: 10 },
    ] } });
    assert.equal(resent.status, 200, JSON.stringify(resent.body));
    assert.deepEqual(resent.body.entity.timeline.milestones.map((m) => m.id), before.map((m) => m.id));
    assert.equal(resent.body.entity.timeline.milestones[1]?.dueDate, "2027-01-25");
    const read = await h.call<Doc>(`/proposals/${id}`);
    assert.deepEqual(read.body.entity.timeline.milestones.map((m) => m.id), before.map((m) => m.id));

    // An id that belongs to another proposal is not taken over.
    const other = await h.create({ timeline: { startDate: "2026-11-16", targetDate: null, milestones: [{ title: "Kickoff", description: "", weekOffset: 0 }] } });
    const foreign = other.body.entity.timeline.milestones[0]!.id;
    const stolen = await h.call<Doc>(`/proposals/${id}`, "PATCH", { timeline: { milestones: [{ id: foreign, title: "Kickoff", description: "", weekOffset: 0 }] } });
    assert.equal(stolen.status, 200, JSON.stringify(stolen.body));
    assert.notEqual(stolen.body.entity.timeline.milestones[0]?.id, foreign);
    assert.ok(stolen.body.warnings.some((warning) => warning.code === "MILESTONE_ID_REPLACED"));
  } finally {
    await h.close();
  }
});

test("impossible dates come back as warnings and as review issues on the dates part", { skip }, async () => {
  const h = await harness();
  try {
    const created = await h.create();
    const id = created.body.entity.id;
    const patched = await h.call<Doc>(`/proposals/${id}`, "PATCH", { timeline: { startDate: "2027-01-25", targetDate: "2026-11-16", milestones: [{ title: "Kickoff", description: "", dueDate: "2026-11-01" }] } });
    assert.equal(patched.status, 200);
    const codes = patched.body.warnings.map((warning) => warning.code);
    assert.ok(codes.includes("TIMELINE_TARGET_BEFORE_START"), codes.join(","));
    assert.ok(codes.includes("MILESTONE_BEFORE_START"), codes.join(","));
    const review = await h.call<{ sections: Array<{ key: string; issues: Array<{ code: string }> }> }>(`/proposals/${id}/review-feedback`);
    assert.equal(review.status, 200);
    const dates = review.body.entity.sections.find((section) => section.issues.some((issue) => issue.code === "timeline_target_before_start"));
    assert.ok(dates, JSON.stringify(review.body.entity.sections.map((section) => [section.key, section.issues.map((issue) => issue.code)])));
  } finally {
    await h.close();
  }
});

test("a duplicate with a new engagement still reads, lists, and links to the portal", { skip }, async () => {
  const h = await harness();
  try {
    const source = await h.create();
    const copy = await h.call<{ proposal: { id: string } ; pendingStaffPrice: boolean }>(`/proposals/${source.body.entity.id}/duplicate`, "POST", { engagement: "hourly", title: "Hourly copy" });
    assert.equal(copy.status, 201, JSON.stringify(copy.body));
    const copyId = copy.body.entity.proposal.id;
    h.ids.push(copyId);
    assert.equal(copy.body.entity.pendingStaffPrice, true);
    assert.match(copy.body.links.portal ?? "", new RegExp(`/portal\\?proposal=${copyId}$`));

    const read = await h.call<Doc>(`/proposals/${copyId}`);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.entity.pricing.pendingStaffPrice, true);
    assert.equal(read.body.entity.pricing.model, "hourly");

    const listed = await h.call<{ items: Array<{ id: string; links: { portal: string } }>; nextCursor: string | null }>("/proposals?limit=1");
    assert.equal(listed.body.entity.items.length, 1, "a pending-price copy no longer shortens the page");
    const all = await h.call<{ items: Array<{ id: string; links: { portal: string } }> }>("/proposals?limit=50");
    const entry = all.body.entity.items.find((item) => item.id === copyId);
    assert.ok(entry, "the copy is listed");
    assert.match(entry!.links.portal, /\/portal\?proposal=/);
  } finally {
    await h.close();
  }
});

test("switching templates through one without background keeps the written background", { skip }, async () => {
  const h = await harness();
  try {
    const created = await h.create();
    const id = created.body.entity.id;
    assert.equal((await h.call(`/proposals/${id}/template`, "PUT", { code: "standard" })).status, 200);
    const written = await h.call(`/proposals/${id}/narrative/background`, "PUT", { text: "Their site is hard to update." });
    assert.equal(written.status, 200, JSON.stringify(written.body));
    const same = await h.call(`/proposals/${id}/template`, "PUT", { code: "standard" });
    assert.equal(same.body.changed, false);
    const fixed = await h.call<{ keptWritten: string[] }>(`/proposals/${id}/template`, "PUT", { code: "fixed_bid" });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    assert.deepEqual(fixed.body.entity.keptWritten, ["background"]);
    assert.ok(fixed.body.warnings.some((warning) => warning.code === "WRITTEN_PARTS_KEPT"));
    await h.call(`/proposals/${id}/template`, "PUT", { code: "standard" });
    const node = await h.prisma.proposalNode.findFirstOrThrow({ where: { proposalId: id, key: "background" } });
    assert.equal((node.body as { text?: string }).text, "Their site is hard to update.");

    const priced = await h.call(`/proposals/${id}/narrative/approach`, "PUT", { text: "About 120 hours for $15,000." });
    assert.deepEqual(priced.body.warnings.map((warning) => warning.code).sort(), ["NARRATIVE_HAS_HOURS", "NARRATIVE_HAS_PRICE"]);
  } finally {
    await h.close();
  }
});

test("option selection rejects ids that are not on the proposal and reports repeat selections as no-ops", { skip }, async () => {
  const h = await harness();
  try {
    const created = await h.create();
    const id = created.body.entity.id;
    const none = await h.call(`/proposals/${id}/options/selection`, "POST", { optionIds: [randomUUID()] });
    assert.equal(none.status, 409);
    assert.equal(none.body.code, "NO_PRICED_OPTIONS");
    const option = await h.prisma.proposalOption.create({ data: { proposalId: id, label: "Extra page", description: "", priceDeltaMinor: 50_000, priceCurrency: "USD" } });
    const fake = await h.call(`/proposals/${id}/options/selection`, "POST", { optionIds: [randomUUID()] });
    assert.equal(fake.status, 400);
    assert.equal(fake.body.code, "VALIDATION_FAILED");
    const first = await h.call(`/proposals/${id}/options/selection`, "POST", { optionIds: [option.id] });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.changed, true);
    const again = await h.call(`/proposals/${id}/options/selection`, "POST", { optionIds: [option.id] });
    assert.equal(again.body.changed, false);
  } finally {
    await h.close();
  }
});

test("export respects format and includes narrative, options, and parked items", { skip }, async () => {
  const h = await harness();
  try {
    const created = await h.create();
    const id = created.body.entity.id;
    await h.call(`/proposals/${id}/narrative/executive_summary`, "PUT", { text: "A calmer, faster site." });
    await h.call(`/proposals/${id}/parked-items`, "POST", { summary: "CRM integration" });
    await h.call(`/proposals/${id}/completion/park`, "POST", { nodeKey: "scope", change: "New photography", mode: "phase_2" });
    const json = await h.call<{ format: string; narrative: Array<{ key: string; text: string | null }>; parked: Array<{ kind: string; summary: string }> }>(`/proposals/${id}/export`);
    assert.equal(json.status, 200);
    assert.equal(json.body.entity.format, "json");
    assert.equal(json.body.entity.narrative.find((section) => section.key === "executive_summary")?.text, "A calmer, faster site.");
    assert.deepEqual(json.body.entity.parked.map((item) => [item.kind, item.summary]), [["item", "CRM integration"], ["change", "New photography"]]);
    const markdown = await h.call<{ format: string; markdown: string }>(`/proposals/${id}/export?format=markdown`);
    assert.equal(markdown.body.entity.format, "markdown");
    assert.match(markdown.body.entity.markdown, /^# Law firm website refresh/);
    assert.match(markdown.body.entity.markdown, /A calmer, faster site\./);
    assert.match(markdown.body.entity.markdown, /CRM integration/);
    const pdf = await h.call<{ format: string; downloadPath: string }>(`/proposals/${id}/export?format=pdf`);
    assert.equal(pdf.body.entity.downloadPath, `/api/v1/proposals/${id}/pdf`);
    assert.match(pdf.body.links.pdf ?? "", /\/pdf$/);
    const bad = await h.call(`/proposals/${id}/export?format=docx`);
    assert.equal(bad.status, 400);

    const parked = await h.call<{ items: Array<{ kind: string; summary: string }> }>(`/proposals/${id}/parked-items`);
    assert.deepEqual(parked.body.entity.items.map((item) => item.kind), ["item", "change"]);
  } finally {
    await h.close();
  }
});

test("unlocking keeps drafted downstream parts and an unlocked part is a no-op", { skip }, async () => {
  const h = await harness();
  try {
    const created = await h.create();
    const id = created.body.entity.id;
    await h.call(`/proposals/${id}/completion`);
    await h.prisma.proposalNode.updateMany({ where: { proposalId: id, key: "scope" }, data: { stateCode: "agreed" } });
    await h.prisma.proposalNode.updateMany({ where: { proposalId: id, key: "hours" }, data: { stateCode: "drafted" } });
    await h.prisma.proposalNode.updateMany({ where: { proposalId: id, key: "milestones" }, data: { stateCode: "agreed" } });
    const unlocked = await h.call<{ sentence: string; reopened: Array<{ key: string }> }>(`/proposals/${id}/completion/nodes/scope/unlock`, "POST", {});
    assert.equal(unlocked.status, 200, JSON.stringify(unlocked.body));
    assert.equal(unlocked.body.changed, true);
    const keys = unlocked.body.entity.reopened.map((item) => item.key);
    assert.ok(keys.includes("milestones"));
    assert.ok(!keys.includes("hours"));
    assert.doesNotMatch(unlocked.body.entity.sentence, /Adding unlock|nothing stay/);
    assert.match(unlocked.body.entity.sentence, /^Unlocking /);
    const hours = await h.prisma.proposalNode.findFirstOrThrow({ where: { proposalId: id, key: "hours" } });
    assert.equal(hours.stateCode, "drafted");
    const again = await h.call(`/proposals/${id}/completion/nodes/hours/unlock`, "POST", {});
    assert.equal(again.body.changed, false);
  } finally {
    await h.close();
  }
});
