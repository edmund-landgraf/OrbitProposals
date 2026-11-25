// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type Section = { key: string; title: string; state: string; text: string | null; guidance: string; maxChars: number; updatedAt: string };
type Envelope<T> = { ok: boolean; code?: string; entity: T };

test("narrative sections come from template rows and are written through the sections route", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `sections-${randomUUID()}@test.invalid`, displayName: "Sections" } });
  const proposal = await prisma.proposal.create({ data: {
    ownerId: owner.id, title: "Sections", engagement: "capped_hours_4", pricingModel: "capped_hours",
    scope: { summary: "Map the intake workflow.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, amountMinor: 80000, currency: "USD" },
  } });
  const outsider = await prisma.user.create({ data: { email: `outside-${randomUUID()}@test.invalid`, displayName: "Other client" } });
  let userId = owner.id;
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { request.session.userId = userId; next(); });
  app.use("/api/v1", createProposalCompletionRouter({ prisma }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/proposals/${proposal.id}`;
  const call = async <T>(path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Envelope<T> };
  };
  try {
    const listed = await call<Section[]>("/narrative");
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.entity.map((s) => s.key), ["terms", "executive_summary", "background", "approach", "success_metrics"]);
    assert.ok(listed.body.entity.every((s) => s.text === null && s.state === "open" && s.guidance.length > 0));

    const written = await call<Section>("/narrative/executive_summary", "PUT", { text: "We will map the intake workflow." });
    assert.equal(written.status, 200);
    assert.equal(written.body.entity.text, "We will map the intake workflow.");
    assert.equal(written.body.entity.state, "drafted");
    const node = await prisma.proposalNode.findFirst({ where: { proposalId: proposal.id, key: "executive_summary" } });
    assert.equal(node?.stateCode, "drafted");
    const single = await call<Section>("/narrative/executive_summary");
    assert.equal(single.status, 200);
    assert.equal(single.body.entity.text, written.body.entity.text);
    assert.equal(single.body.entity.updatedAt, node?.updatedAt.toISOString());
    const fresh = await call<{ record: { version: number; updatedAt: string }; parts: Array<{ key: string; updatedAt: string }> }>("/freshness");
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.entity.parts.find(part => part.key === "executive_summary")?.updatedAt, single.body.entity.updatedAt);
    assert.equal(typeof fresh.body.entity.record.version, "number");
    assert.equal((await call("/narrative/not_a_section")).status, 404);


    userId = outsider.id;
    assert.equal((await call("/freshness")).status, 404);
    assert.equal((await call("/narrative/executive_summary")).status, 404);
    userId = owner.id;

    const terms = await call<Section>("/narrative/terms", "PUT", { text: "Invoices are due Net 30. The client provides brand assets and names a single reviewer." });
    assert.equal(terms.status, 200);
    assert.equal(terms.body.entity.state, "drafted");
    assert.match(terms.body.entity.text ?? "", /Net 30/);
    const listedAfter = await call<Section[]>("/narrative");
    assert.equal(listedAfter.body.entity.find((s) => s.key === "terms")?.text?.includes("Net 30"), true);

    const spec = await prisma.proposalSectionSpec.findUniqueOrThrow({ where: { nodeKey: "success_metrics" } });
    assert.equal((await call("/narrative/success_metrics", "PUT", { text: "x".repeat(spec.maxChars + 1) })).status, 400);
    assert.equal((await call("/narrative/scope", "PUT", { text: "Not a narrative section." })).status, 404);
    assert.equal((await call("/narrative/approach", "PUT", { text: "" })).status, 400);


    type Review = { score: number; readySections: number; totalSections: number; sections: { key: string; score: number; issues: { code: string }[]; suggestions: { code: string }[] }[] };
    const review = await call<Review>("/review-feedback");
    assert.equal(review.status, 200);
    assert.equal(review.body.entity.totalSections, 7);
    assert.ok(review.body.entity.sections.find((s) => s.key === "schedule")!.issues.some((i) => i.code === "timeline_target_missing"));
    assert.ok(review.body.entity.sections.find((s) => s.key === "scope")!.suggestions.some((i) => i.code === "scope_exclusions_missing"));
    const exec = review.body.entity.sections.find((s) => s.key === "executive_summary")!;
    assert.deepEqual(exec.issues, []);
    assert.deepEqual(exec.suggestions.map((s) => s.code), ["exec_short"]);
    assert.ok(review.body.entity.sections.filter((s) => ["background", "approach", "success_metrics"].includes(s.key)).every((s) => s.issues.some((i) => i.code.endsWith("_missing"))));
    await prisma.proposal.update({ where: { id: proposal.id }, data: { reviewState: "in_review" } });
    const locked = await call<Section>("/narrative/approach", "PUT", { text: "Edited after submit." });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.code, "SECTION_LOCKED");
    const approach = await prisma.proposalNode.findFirst({ where: { proposalId: proposal.id, key: "approach" } });
    assert.equal((approach?.body as { text?: string } | null)?.text, undefined);
  } finally {
    server.close();
    await deleteProposalCascade(prisma, proposal.id);
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.user.delete({ where: { id: outsider.id } });
    await prisma.$disconnect();
  }
});
