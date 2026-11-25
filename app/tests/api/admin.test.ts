import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { clearAdminMintLimit, createAdminPage, createAdminRouter } from "../../server/routes/admin.js";

type User = { id: string; email: string; displayName: string; isAdmin: boolean; createdAt: Date };
type Token = { id: string; userId: string; clientId: string; tokenHash: string; scopes: string[]; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date; client: { id: string; name: string }; user: User };
type Audit = { id: string; actorUserId: string | null; tokenId: string | null; operation: string; method: string; path: string; recordType: string | null; recordId: string | null; requestId: string; inputRedacted: unknown; statusCode: number; previousHash: string | null; hash: string; createdAt: Date };

const users: User[] = [];
const tokens: Token[] = [];
const audits: Audit[] = [];
const links: { id: string; email: string; tokenHash: string; expiresAt: Date }[] = [];

const adminId = randomUUID();
const memberId = randomUUID();
users.push(
  { id: adminId, email: "admin@example.com", displayName: "Admin", isAdmin: true, createdAt: new Date() },
  { id: memberId, email: "member@example.com", displayName: "Member", isAdmin: false, createdAt: new Date() },
);

function matchesToken(token: Token, where: Record<string, unknown>) {
  if (typeof where.id === "string" && token.id !== where.id) return false;
  if (typeof where.tokenHash === "string" && token.tokenHash !== where.tokenHash) return false;
  if (where.revokedAt === null && token.revokedAt) return false;
  const clauses = where.OR as { expiresAt: null | { gt: Date } }[] | undefined;
  if (clauses && !clauses.some((clause) => clause.expiresAt === null ? token.expiresAt === null : token.expiresAt !== null && token.expiresAt > clause.expiresAt.gt)) return false;
  return true;
}

const prisma = {
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => users.find((user) => user.id === where.id || user.email === where.email) ?? null,
    findMany: async () => [...users].sort((left, right) => left.email.localeCompare(right.email)),
    create: async ({ data }: { data: { email: string; displayName: string; isAdmin: boolean } }) => {
      const user = { id: randomUUID(), email: data.email, displayName: data.displayName, isAdmin: data.isAdmin, createdAt: new Date() };
      users.push(user);
      return user;
    },
  },
  magicLink: {
    create: async ({ data }: { data: { email: string; tokenHash: string; expiresAt: Date } }) => {
      const record = { id: randomUUID(), ...data };
      links.push(record);
      return record;
    },
  },
  scopePreset: {
    findUnique: async ({ where }: { where: { code: string } }) => where.code === "client" ? { code: "client", label: "Client", scopes: ["proposals:read", "proposals:write", "contracts:write", "billing:read", "projects:read"], active: true, sortOrder: 10 } : null,
    findMany: async () => [{ code: "client", label: "Client", scopes: ["proposals:read", "proposals:write", "contracts:write", "billing:read", "projects:read"], active: true, sortOrder: 10 }],
  },
  mcpClient: {
    create: async ({ data }: { data: { name: string } }) => ({ id: randomUUID(), name: data.name }),
  },
  mcpToken: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => tokens.find((token) => matchesToken(token, where)) ?? null,
    findMany: async () => [...tokens].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    create: async ({ data }: { data: { clientId: string; userId: string; tokenHash: string; scopes: string[]; expiresAt: Date } }) => {
      const user = users.find((item) => item.id === data.userId)!;
      const token: Token = { id: randomUUID(), clientId: data.clientId, userId: data.userId, tokenHash: data.tokenHash, scopes: data.scopes, expiresAt: data.expiresAt, revokedAt: null, createdAt: new Date(), client: { id: data.clientId, name: "pending" }, user };
      const clientName = tokens.length;
      token.client.name = `token-${clientName}`;
      tokens.push(token);
      return token;
    },
    update: async ({ where, data }: { where: { id: string }; data: { revokedAt: Date } }) => {
      const token = tokens.find((item) => item.id === where.id)!;
      token.revokedAt = data.revokedAt;
      return token;
    },
  },
  auditEvent: {
    findFirst: async () => audits[0] ?? null,
    findMany: async ({ take }: { take: number }) => audits.slice(0, take),
    create: async ({ data }: { data: Omit<Audit, "id" | "createdAt"> }) => {
      const row = { ...data, id: randomUUID(), createdAt: new Date() } as Audit;
      audits.unshift(row);
      assert.equal(JSON.stringify(row).includes("token="), false);
      return row;
    },
  },
};

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => {
    const userId = request.header("x-user");
    if (userId) request.session.userId = userId;
    next();
  });
  app.get("/admin", createAdminPage({ prisma: prisma as never }));
  app.use("/api/v1", createAdminRouter({ prisma: prisma as never }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); } finally { server.close(); }
}

test("non-admins get 403 on every admin route and the page is hidden", async () => {
  await withServer(async (baseUrl) => {
    const calls: { method: string; path: string; body?: string }[] = [
      { method: "GET", path: "/api/v1/admin/users" },
      { method: "POST", path: "/api/v1/admin/users", body: JSON.stringify({ email: "new@example.com", name: "New" }) },
      { method: "POST", path: `/api/v1/admin/users/${memberId}/magic-link` },
      { method: "GET", path: "/api/v1/admin/tokens" },
      { method: "POST", path: "/api/v1/admin/tokens", body: JSON.stringify({ userId: memberId, name: "nope", scopes: ["projects:read"] }) },
      { method: "DELETE", path: `/api/v1/admin/tokens/${randomUUID()}` },
      { method: "GET", path: "/api/v1/admin/audit?limit=100" },
      { method: "GET", path: "/api/v1/admin/access-requests" },
      { method: "POST", path: `/api/v1/admin/access-requests/${randomUUID()}/approve`, body: "{}" },
      { method: "POST", path: `/api/v1/admin/access-requests/${randomUUID()}/reject`, body: "{}" },
      { method: "POST", path: `/api/v1/admin/users/${memberId}/suspend`, body: "{}" },
      { method: "POST", path: `/api/v1/admin/users/${memberId}/unsuspend`, body: "{}" },
    ];
    for (const call of calls) {
      const response = await fetch(`${baseUrl}${call.path}`, { method: call.method, headers: { "x-user": memberId, "content-type": "application/json" }, body: call.body });
      assert.equal(response.status, 403, `${call.method} ${call.path}`);
    }
    const hidden = await fetch(`${baseUrl}/admin`, { headers: { "x-user": memberId } });
    assert.equal(hidden.status, 404);
    const visible = await fetch(`${baseUrl}/admin`, { headers: { "x-user": adminId } });
    assert.equal(visible.status, 200);
    assert.match(await visible.text(), /Sign-in link/);
  });
});

test("bearer mint responses omit the raw secret and revoked tokens are rejected", async () => {
  await withServer(async (baseUrl) => {
    const minted = await fetch(`${baseUrl}/api/v1/admin/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": adminId },
      body: JSON.stringify({ userId: adminId, name: "ops", scopes: ["admin"], expiresInDays: 90 }),
    });
    const mintedBody = await minted.json() as { entity: { token: string; id: string } };
    assert.equal(minted.status, 201);
    const raw = mintedBody.entity.token;
    const bearer = { authorization: `Bearer ${raw}`, "content-type": "application/json" };
    const again = await fetch(`${baseUrl}/api/v1/admin/users/${memberId}/magic-link`, { method: "POST", headers: bearer });
    const againBody = await again.json() as { entity: { link?: string; token?: string; message?: string; id: string; expiresAt: string } };
    const serialized = JSON.stringify(againBody);
    assert.equal(again.status, 201);
    assert.equal(againBody.entity.message, "copy it from /admin");
    assert.equal("link" in againBody.entity, false);
    assert.equal("token" in againBody.entity, false);
    assert.equal(serialized.includes(raw), false);
    assert.equal(links.some((link) => serialized.includes(link.tokenHash)), false);
    const listed = await fetch(`${baseUrl}/api/v1/admin/tokens`, { headers: bearer });
    const listedBody = await listed.json() as { entity: { items: { id: string }[] } };
    await fetch(`${baseUrl}/api/v1/admin/tokens/${listedBody.entity.items[0].id}`, { method: "DELETE", headers: { "x-user": adminId } });
    const rejected = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: bearer });
    assert.equal(rejected.status, 403);
    const audit = await fetch(`${baseUrl}/api/v1/admin/audit?limit=100`, { headers: { "x-user": adminId } });
    const auditBody = await audit.json() as { entity: { items: { operation: string; actorUserId: string }[] } };
    assert.ok(auditBody.entity.items.some((event) => event.operation === "admin.token.revoke" && event.actorUserId === adminId));
    assert.equal(JSON.stringify(auditBody).includes(raw), false);
  });
});

test("minting is limited to 20 per hour for an admin", async () => {
  clearAdminMintLimit();
  await withServer(async (baseUrl) => {
    let limited = 0;
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/v1/admin/users/${memberId}/magic-link`, { method: "POST", headers: { "x-user": adminId } });
      if (response.status === 429) limited += 1;
    }
    assert.equal(limited, 1);
  });
});

test("minted tokens are stored only as a SHA-256 hash, presets set scopes, and admins revoke other users' tokens", async () => {
  clearAdminMintLimit();
  await withServer(async (baseUrl) => {
    const presets = await fetch(`${baseUrl}/api/v1/admin/scope-presets`, { headers: { "x-user": adminId } });
    const presetsBody = await presets.json() as { entity: { items: { code: string; label: string }[] } };
    assert.deepEqual(presetsBody.entity.items.map((item) => item.label), ["Client"]);
    const minted = await fetch(`${baseUrl}/api/v1/admin/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": adminId },
      body: JSON.stringify({ userId: memberId, name: "client agent", preset: "client", expiresInDays: 30 }),
    });
    assert.equal(minted.status, 201);
    const body = await minted.json() as { entity: { id: string; token: string } };
    const stored = tokens.find((token) => token.id === body.entity.id)!;
    assert.equal(stored.userId, memberId, "admin can mint for a user in another org");
    assert.deepEqual(stored.scopes, ["proposals:read", "proposals:write", "contracts:write", "billing:read", "projects:read"]);
    assert.notEqual(stored.tokenHash, body.entity.token);
    assert.equal(stored.tokenHash, createHash("sha256").update(body.entity.token).digest("hex"));
    assert.equal(JSON.stringify(tokens).includes(body.entity.token), false, "plaintext is never stored");
    const listed = await fetch(`${baseUrl}/api/v1/admin/tokens`, { headers: { "x-user": adminId } });
    assert.equal((await listed.text()).includes(body.entity.token), false, "the list never shows the secret");
    const revoked = await fetch(`${baseUrl}/api/v1/admin/tokens/${body.entity.id}`, { method: "DELETE", headers: { "x-user": adminId } });
    assert.equal(revoked.status, 200);
    assert.ok(stored.revokedAt, "a token owned by another user is revoked");
    const rejected = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { authorization: `Bearer ${body.entity.token}` } });
    assert.ok(rejected.status === 401 || rejected.status === 403, String(rejected.status));
  });
});
