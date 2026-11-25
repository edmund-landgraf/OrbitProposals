// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
// Staff edit proposal templates as rows: copy, reshape parts, samples, no-price options, and template review rules.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { createTemplateEditRouter } from "../../server/routes/templateEdit.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type T = { code: string; active: boolean; suggestedPricingModel: string | null; nodes: { nodeKey: string }[]; samples: { nodeKey: string }[]; options: { code: string }[]; reviewRules: { code: string; templateCode: string }[] };

test("staff edit proposal templates end to end", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: "Template editors", slug: `tpl-${tag}` } });
  const staff = await prisma.user.create({ data: { email: `staff-${tag}@test.invalid`, displayName: "Staff" } });
  const client = await prisma.user.create({ data: { email: `client-${tag}@test.invalid`, displayName: "Client" } });
  await prisma.membership.create({ data: { userId: staff.id, organizationId: org.id, role: "staff", status: "active" } });
  await prisma.membership.create({ data: { userId: client.id, organizationId: org.id, role: "client", status: "active" } });
  let as = staff.id;
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { request.session.userId = as; request.session.organizationId = org.id; next(); });
  app.use("/api/v1", createTemplateEditRouter({ prisma }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { ok: boolean; entity: T; code?: string } };
  };
  const code = `copy_${tag}`;
  try {
    as = client.id;
    assert.equal((await call("/staff/proposal-templates")).status, 403);
    as = staff.id;
    assert.equal((await call("/staff/proposal-templates")).status, 200);

    const created = await call("/staff/proposal-templates", "POST", { code, name: "Copied web app", copyFrom: "web_app" });
    assert.equal(created.status, 201);
    const t = created.body.entity;
    assert.equal(t.active, false, "new templates start inactive");
    assert.equal(t.suggestedPricingModel, "fixed_price");
    assert.ok(t.nodes.length >= 11 && t.samples.length > 0 && t.options.length === 3);
    assert.ok(t.reviewRules.length > 0 && t.reviewRules.every((r) => r.templateCode === code));
    assert.equal((await call("/staff/proposal-templates", "POST", { code, name: "Dup" })).status, 409);

    const keep = t.nodes.map((n) => n.nodeKey).filter((k) => k !== "service_levels");
    const reshaped = await call(`/staff/proposal-templates/${code}/nodes`, "PUT", { nodes: [...keep, "integrations"].map((nodeKey) => ({ nodeKey })) });
    assert.equal(reshaped.status, 200);
    assert.ok(reshaped.body.entity.nodes.some((n) => n.nodeKey === "integrations"));
    assert.ok(!reshaped.body.entity.samples.some((s) => s.nodeKey === "service_levels"), "samples for dropped parts go too");
    assert.equal((await call(`/staff/proposal-templates/${code}/nodes`, "PUT", { nodes: [{ nodeKey: "no_such_part" }] })).status, 400);

    assert.equal((await call(`/staff/proposal-templates/${code}/samples/integrations`, "PUT", { content: { text: "Connects to the client's CRM and billing systems." } })).status, 200);
    assert.equal((await call(`/staff/proposal-templates/${code}/samples/not_in_template`, "PUT", { content: { text: "x" } })).status, 400);

    assert.equal((await call(`/staff/proposal-templates/${code}/options`, "PUT", { options: [{ code: "sso", label: "Single sign-on", amountMinor: 5000 }] })).status, 400, "options never carry a price");
    const opts = await call(`/staff/proposal-templates/${code}/options`, "PUT", { options: [{ code: "sso", label: "Single sign-on" }] });
    assert.deepEqual(opts.body.entity.options.map((o) => o.code), ["sso"]);

    const rule = { code: `r_${tag}`, nodeKey: "integrations", check: "min_chars", minChars: 40, severity: "issue", weight: 10, message: "Describe the integrations.", suggestion: "Name each system and the data that moves." };
    assert.equal((await call(`/staff/proposal-templates/${code}/rules`, "POST", { ...rule, minChars: undefined })).status, 400);
    assert.equal((await call(`/staff/proposal-templates/${code}/rules`, "POST", { ...rule, check: "pattern", pattern: "(" })).status, 400);
    assert.equal((await call(`/staff/proposal-templates/${code}/rules`, "POST", rule)).status, 201);
    assert.equal((await call(`/staff/proposal-templates/${code}/rules/${rule.code}`, "PATCH", { weight: 20 })).status, 200);
    assert.equal((await call(`/staff/proposal-templates/web_app/rules/${rule.code}`, "PATCH", { weight: 5 })).status, 404, "rules stay with their template");
    assert.equal((await call(`/staff/proposal-templates/${code}/rules/${rule.code}`, "DELETE")).status, 200);

    const on = await call(`/staff/proposal-templates/${code}`, "PATCH", { active: true, suggestedPricingModel: "hourly" });
    assert.equal(on.status, 200);
    assert.equal(on.body.entity.active, true);
    assert.equal((await call(`/staff/proposal-templates/${code}`, "PATCH", { suggestedPricingModel: "barter" })).status, 400);
  } finally {
    server.close();
    await prisma.proposalTemplate.deleteMany({ where: { code } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [staff.id, client.id] } } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
