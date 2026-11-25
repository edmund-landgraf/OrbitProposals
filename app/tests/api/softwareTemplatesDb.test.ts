// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
// Each software template, filled from its own samples, must produce a proposal that review (unw_review_proposal) passes with zero issues.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type Envelope<T> = { ok: boolean; entity: T };
type Milestone = { title: string; description: string; weekOffset: number };
type Template = {
  code: string; suggestedPricingModel: string | null;
  nodes: { key: string; kind: string }[];
  samples: Record<string, { text?: string; milestones?: Milestone[]; [field: string]: unknown }>;
  options: { code: string; label: string }[];
};
type Review = { score: number; issueCount: number; sections: { key: string; issues: { code: string }[] }[] };

const SOFTWARE = ["web_app", "mobile_app", "ai_solution", "modernization"];
const PRICE_OR_HOURS = /(\$\s?\d|\b\d+\s?(hours|hrs)\b)/i;

test("software templates build end to end into proposals that pass review", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `software-${randomUUID()}@test.invalid`, displayName: "Software templates" } });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { request.session.userId = owner.id; next(); });
  app.use("/api/v1", createProposalCompletionRouter({ prisma }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call = async <T>(path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Envelope<T> };
  };
  try {
    const listed = await call<Template[]>("/proposal-templates");
    assert.equal(listed.status, 200);
    for (const code of SOFTWARE) {
      const template = listed.body.entity.find((row) => row.code === code);
      assert.ok(template, `${code} is listed`);
      assert.ok(template.suggestedPricingModel, `${code} suggests a pricing model`);
      assert.ok(template.options.length >= 3, `${code} suggests option packages`);
      const sections = template.nodes.filter((node) => node.kind === "section").map((node) => node.key);
      for (const key of [...sections, "scope", "schedule"]) assert.ok(template.samples[key], `${code} has a sample for ${key}`);
      for (const key of sections) assert.ok(!PRICE_OR_HOURS.test(template.samples[key].text ?? ""), `${code}.${key} sample never states hours or price`);

      // A proposal created bare, given the template, then filled the way the agent does through MCP tools.
      const model = template.suggestedPricingModel as "fixed_price" | "hourly";
      const proposal = await prisma.proposal.create({ data: {
        ownerId: owner.id, title: `Software ${code}`, engagement: model, pricingModel: model,
        scope: { summary: "To be written.", deliverables: ["To be written"] }, timeline: {}, pricing: { model, currency: "USD" },
      } });
      assert.equal((await call(`/proposals/${proposal.id}/template`, "PUT", { code })).status, 200);

      const before = await call<Review>(`/proposals/${proposal.id}/review-feedback`);
      assert.ok(before.body.entity.issueCount > 0, `${code} starts with review issues`);

      const start = new Date("2027-01-04T00:00:00Z");
      const day = (weeks: number) => new Date(start.getTime() + weeks * 7 * 86400000).toISOString().slice(0, 10);
      const milestones = template.samples.schedule.milestones!.map((m) => ({ id: randomUUID(), title: m.title, description: m.description, dueDate: day(m.weekOffset) }));
      const { text: _unused, ...scope } = template.samples.scope;
      await prisma.proposal.update({ where: { id: proposal.id }, data: {
        scope: scope as object,
        timeline: { startDate: day(0), targetDate: milestones.at(-1)!.dueDate, milestones },
      } });
      for (const key of sections) {
        const written = await call(`/proposals/${proposal.id}/narrative/${key}`, "PUT", { text: template.samples[key].text });
        assert.equal(written.status, 200, `${code}.${key} sample fits its section`);
      }

      const review = await call<Review>(`/proposals/${proposal.id}/review-feedback`);
      assert.equal(review.status, 200);
      const open = review.body.entity.sections.flatMap((s) => s.issues.map((issue) => `${s.key}:${issue.code}`));
      assert.deepEqual(open, [], `${code} passes review with no issues`);
      assert.equal(review.body.entity.issueCount, 0);
    }

    // Template rules stay with their template: a mobile rule never fires on a web proposal.
    const rules = await prisma.proposalReviewRule.findMany({ where: { templateCode: { in: SOFTWARE } } });
    for (const code of SOFTWARE) for (const node of ["scope", "schedule", "price"]) assert.ok(rules.some((r) => r.templateCode === code && r.nodeKey === node), `${code} has a ${node} rule`);
    const webProposal = await prisma.proposal.findFirstOrThrow({ where: { ownerId: owner.id, templateCode: "web_app" } });
    await prisma.proposal.update({ where: { id: webProposal.id }, data: { scope: { summary: "A web application for staff and customers to track requests in one place.", deliverables: ["App", "Admin", "Design", "Launch"], assumptions: ["Access"], exclusions: ["Mobile"] } } });
    const web = await call<Review>(`/proposals/${webProposal.id}/review-feedback`);
    assert.ok(!web.body.entity.sections.some((s) => s.issues.some((i) => i.code.startsWith("mobile_") || i.code.startsWith("mod_"))), "other templates' rules do not apply");
  } finally {
    server.close();
    await prisma.proposal.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});