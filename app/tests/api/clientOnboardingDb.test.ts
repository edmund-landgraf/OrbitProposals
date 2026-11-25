// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { createAdminRouter, deleteProposalCascade } from "../../server/routes/admin.js";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";
import { createChatProposalReadRouter } from "../../server/routes/chatProposalRead.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type Envelope<T = Record<string, unknown>> = { ok: boolean; code?: string; entity: T };

async function serve(app: express.Express, run: (base: string) => Promise<void>) {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); } finally { server.close(); }
}

async function call<T = Record<string, unknown>>(base: string, path: string, user: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-user": user }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Envelope<T> };
}

test("admin onboarding puts new users in an org and mints client-preset tokens", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const tag = randomUUID().slice(0, 8);
  const admin = await prisma.user.create({ data: { email: `admin-${tag}@test.invalid`, displayName: "Admin", isAdmin: true } });
  const userIds: string[] = [admin.id];
  const orgIds: string[] = [];
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { const id = request.header("x-user"); if (id) request.session.userId = id; next(); });
  app.use("/api/v1", createAdminRouter({ prisma }));
  try {
    await serve(app, async (base) => {
      const org = await call<{ id: string; slug: string }>(base, "/api/v1/admin/orgs", admin.id, "POST", { name: `Acme ${tag}` });
      assert.equal(org.status, 201);
      orgIds.push(org.body.entity.id);
      assert.equal(org.body.entity.slug, `acme-${tag}`);

      const joined = await call<{ id: string; org: { id: string; role: string; created: boolean } }>(base, "/api/v1/admin/users", admin.id, "POST", { email: `a-${tag}@test.invalid`, name: "A", orgId: org.body.entity.id });
      assert.equal(joined.status, 201);
      userIds.push(joined.body.entity.id);
      assert.deepEqual([joined.body.entity.org.id, joined.body.entity.org.role, joined.body.entity.org.created], [org.body.entity.id, "client", false]);

      const named = await call<{ id: string; org: { id: string; created: boolean } }>(base, "/api/v1/admin/users", admin.id, "POST", { email: `b-${tag}@test.invalid`, name: "B", orgName: `Beta ${tag}` });
      assert.equal(named.status, 201);
      userIds.push(named.body.entity.id);
      orgIds.push(named.body.entity.org.id);
      assert.equal(named.body.entity.org.created, true);
      const again = await call<{ id: string; org: { id: string; created: boolean } }>(base, "/api/v1/admin/users", admin.id, "POST", { email: `c-${tag}@test.invalid`, name: "C", orgName: `beta ${tag}` });
      userIds.push(again.body.entity.id);
      assert.deepEqual([again.body.entity.org.id, again.body.entity.org.created], [named.body.entity.org.id, false]);

      const loose = await call<{ id: string }>(base, "/api/v1/admin/users", admin.id, "POST", { email: `d-${tag}@test.invalid`, name: "D" });
      userIds.push(loose.body.entity.id);
      const member = await call<{ role: string; status: string }>(base, `/api/v1/admin/orgs/${org.body.entity.id}/members`, admin.id, "POST", { userId: loose.body.entity.id, role: "staff" });
      assert.equal(member.status, 201);
      assert.deepEqual([member.body.entity.role, member.body.entity.status], ["staff", "active"]);
      const bad = await call(base, `/api/v1/admin/orgs/${org.body.entity.id}/members`, admin.id, "POST", { userId: loose.body.entity.id, role: "owner" });
      assert.equal(bad.status, 400);

      const listed = await call<{ items: { id: string; org: { id: string; role: string } | null }[] }>(base, "/api/v1/admin/users", admin.id);
      const row = listed.body.entity.items.find((item) => item.id === loose.body.entity.id);
      assert.deepEqual(row?.org && [row.org.id, row.org.role], [org.body.entity.id, "staff"]);
      assert.equal(listed.body.entity.items.find((item) => item.id === admin.id)?.org, null);

      const minted = await call<{ id: string }>(base, "/api/v1/admin/tokens", admin.id, "POST", { userId: joined.body.entity.id, name: `client-${tag}`, preset: "client" });
      assert.equal(minted.status, 201);
      const token = await prisma.mcpToken.findUniqueOrThrow({ where: { id: minted.body.entity.id } });
      assert.deepEqual([...(token.scopes as string[])].sort(), ["billing:read", "contracts:write", "projects:read", "proposals:read", "proposals:write"]);
      const unknown = await call(base, "/api/v1/admin/tokens", admin.id, "POST", { userId: joined.body.entity.id, name: "x", preset: "nope" });
      assert.equal(unknown.status, 422);
      const neither = await call(base, "/api/v1/admin/tokens", admin.id, "POST", { userId: joined.body.entity.id, name: "x" });
      assert.equal(neither.status, 400);

      const operations = (await prisma.auditEvent.findMany({ where: { actorUserId: admin.id } })).map((event) => event.operation);
      for (const operation of ["admin.org.create", "admin.user.create", "admin.org.member.add", "admin.token.mint"]) assert.ok(operations.includes(operation), operation);
    });
  } finally {
    const tokens = await prisma.mcpToken.findMany({ where: { userId: { in: userIds } } });
    await prisma.mcpToken.deleteMany({ where: { id: { in: tokens.map((item) => item.id) } } });
    await prisma.mcpClient.deleteMany({ where: { id: { in: tokens.map((item) => item.clientId) } } });
    await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.auditEvent.updateMany({ where: { actorUserId: { in: userIds } }, data: { actorUserId: null } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});

test("portal submit moves the review state like the MCP tool, and the portal list/detail read it back", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `portal-${randomUUID()}@test.invalid`, displayName: "Portal" } });
  const proposal = await prisma.proposal.create({ data: {
    ownerId: owner.id, title: "Portal sync", engagement: "capped_hours_4", pricingModel: "capped_hours",
    scope: { summary: "Map the intake workflow.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, amountMinor: 80000, currency: "USD" },
  } });
  const principal = { userId: owner.id, role: "client" as const };
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createProposalContractRouter({ prisma, authorize: async () => principal }));
  app.use("/api/v1", createChatProposalReadRouter({ prisma, resolveAuth: () => ({ ...principal, scopes: ["proposals:read", "proposals:write"] }) }));
  try {
    await serve(app, async (base) => {
      const submitted = await call<{ status: string }>(base, `/api/v1/proposals/${proposal.id}/review`, owner.id, "POST", { notes: "Ready" });
      assert.equal(submitted.status, 200);
      const row = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
      const mapped = (await prisma.proposalReviewStatus.findUniqueOrThrow({ where: { code: "agent_review" } })).recordStatus;
      assert.equal(row.reviewState, "agent_review");
      assert.equal(row.status, mapped);
      assert.equal(submitted.body.entity.status, mapped);
      assert.equal(await prisma.proposalReviewEvent.count({ where: { proposalId: proposal.id } }), 1);

      const list = await call<{ items: { id: string; status: string }[] }>(base, "/api/v1/proposals", owner.id);
      assert.equal(list.body.entity.items.find((item) => item.id === proposal.id)?.status, mapped);
      const detail = await call<{ status: string }>(base, `/api/v1/proposals/${proposal.id}`, owner.id);
      assert.equal(detail.body.entity.status, mapped);
      const again = await call(base, `/api/v1/proposals/${proposal.id}/review`, owner.id, "POST", {});
      assert.equal(again.status, 409);
    });
  } finally {
    await deleteProposalCascade(prisma, proposal.id);
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});
