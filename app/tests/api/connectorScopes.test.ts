import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { MCP_SCOPES } from "../../shared/mcpScopes.js";
import { connectorTokenScopes, isStaffOrAdmin } from "../../server/connectorScopes.js";
import { createSystemAuthRouter } from "../../server/routes/systemAuth.js";

const staffGrants = ["billing:read", "billing:write", "catalog:write", "projects:read", "change_orders:write"];

test("connector tokens keep requested mcp scopes and add staff grants for staff and admins", () => {
  const client = connectorTokenScopes({
    requested: "proposals:read",
    mcpScopes: MCP_SCOPES,
    staffGrants,
    isStaffOrAdmin: false,
  });
  assert.deepEqual(client, ["proposals:read"]);

  const staff = connectorTokenScopes({
    requested: "proposals:read",
    mcpScopes: MCP_SCOPES,
    staffGrants,
    isStaffOrAdmin: true,
  });
  assert.deepEqual(staff, ["proposals:read", "billing:read", "billing:write", "catalog:write", "projects:read"]);
  assert.equal(staff.includes("change_orders:write"), false);

  const requested = connectorTokenScopes({
    requested: "billing:read billing:write catalog:write",
    mcpScopes: MCP_SCOPES,
    staffGrants,
    isStaffOrAdmin: false,
  });
  assert.deepEqual(requested, ["billing:read", "billing:write", "catalog:write"]);

  assert.equal(isStaffOrAdmin({ isAdmin: true, memberships: [] }), true);
  assert.equal(isStaffOrAdmin({ isAdmin: false, memberships: [{ status: "active", role: "staff" }] }), true);
  assert.equal(isStaffOrAdmin({ isAdmin: false, memberships: [{ status: "active", role: "client" }] }), false);
});

test("oauth consent grants billing and catalog scopes to a staff connector that did not ask for them", async () => {
  const clients: { id: string; clientId: string; name: string; redirectUris: string[] }[] = [];
  const issued: { id: string; email: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null }[] = [];
  const user = {
    id: "00000000-0000-0000-0000-000000000010",
    email: "staff@example.com",
    displayName: "Staff",
    isAdmin: false,
    createdAt: new Date(),
    memberships: [{ status: "active", role: "staff", organizationId: "00000000-0000-0000-0000-000000000011" }],
  };
  const magicLink = {
    create: async ({ data }: { data: { email: string; tokenHash: string; expiresAt: Date } }) => { const record = { id: randomUUID(), ...data, consumedAt: null }; issued.push(record); return record; },
    findFirst: async ({ where }: { where: { tokenHash: string; expiresAt: { gt: Date } } }) => issued.find((item) => item.tokenHash === where.tokenHash && item.consumedAt === null && item.expiresAt > where.expiresAt.gt) ?? null,
    updateMany: async ({ where, data }: { where: { id: string }; data: { consumedAt: Date } }) => { const item = issued.find((candidate) => candidate.id === where.id && candidate.consumedAt === null); if (!item) return { count: 0 }; item.consumedAt = data.consumedAt; return { count: 1 }; },
  };
  const mcpClient = {
    create: async ({ data }: { data: { clientId: string; name: string; redirectUris: string[] } }) => { const row = { id: randomUUID(), ...data }; clients.push(row); return row; },
    findUnique: async ({ where }: { where: { clientId: string } }) => clients.find((item) => item.clientId === where.clientId) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { clientId: string } }) => { const row = clients.find((item) => item.clientId === where.clientId); if (!row) throw new Error("missing client"); return row; },
  };
  const tokens: Array<{ tokenHash?: string; scopes?: string[] }> = [];
  const prisma = {
    user: { findUnique: async () => user },
    mcpClient,
    mcpToken: {
      create: async ({ data }: { data: { tokenHash?: string; scopes?: string[] } }) => { tokens.push(data); return { expiresAt: new Date(Date.now() + 1000) }; },
      updateMany: async () => ({ count: 0 }),
      findFirst: async ({ where }: { where: { tokenHash: string } }) => tokens.find((item) => item.tokenHash === where.tokenHash) ?? null,
    },
    auditEvent: { findMany: async () => [] },
    magicLink,
  };
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  let sentToken = "";
  app.use("/api/v1", createSystemAuthRouter({ prisma: prisma as never, sendMagicLink: async ({ token }) => { sentToken = token; } }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  const store = (response: Response) => { const next = (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).filter(Boolean); if (next.length) cookie = next.join("; "); };
  const headers = (extra: Record<string, string> = {}) => ({ ...(cookie ? { cookie } : {}), ...extra });
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://127.0.0.1:9/callback";
  try {
    const discovery = await fetch(`${baseUrl}/api/v1/.well-known/oauth-authorization-server`);
    const advertised = (await discovery.json() as { scopes_supported: string[] }).scopes_supported;
    for (const scope of ["billing:read", "billing:write"]) assert.ok(advertised.includes(scope), scope);
    // Staff-only scopes are not advertised to self-registered clients; staff still receive them through their role grants.
    for (const scope of ["catalog:write", "admin"]) assert.ok(!advertised.includes(scope), scope);

    const registered = await fetch(`${baseUrl}/api/v1/auth/mcp/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Cursor", grant_types: ["authorization_code"], token_endpoint_auth_method: "none" }) });
    const client = await registered.json() as { client_id: string };
    const authorize = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "staff", scope: "proposals:read", resource: "https://mcp.unwhelm.net/mcp" })}`, { redirect: "manual" });
    store(authorize);
    await fetch(`${baseUrl}/api/v1/auth/signin`, { method: "POST", headers: headers({ "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ email: user.email }) });
    const returned = await fetch(`${baseUrl}/api/v1/auth/magic-link?${new URLSearchParams({ token: sentToken })}`, { headers: headers(), redirect: "manual" });
    store(returned);
    const consent = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize/resume`, { headers: headers() });
    const consentHtml = await consent.text();
    assert.match(consentHtml, /billing:read/);
    assert.match(consentHtml, /billing:write/);
    assert.match(consentHtml, /catalog:write/);
    const csrf = /name="csrf" value="([^"]+)"/.exec(consentHtml)?.[1];
    assert.ok(csrf);
    const allowed = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize/decision`, { method: "POST", headers: headers({ "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ csrf: csrf!, decision: "allow" }), redirect: "manual" });
    const code = new URL(allowed.headers.get("location") ?? "", redirectUri).searchParams.get("code");
    const exchanged = await fetch(`${baseUrl}/api/v1/auth/mcp/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier, resource: "https://mcp.unwhelm.net/mcp" }) });
    assert.equal(exchanged.status, 200);
    const tokenBody = await exchanged.json() as { access_token: string; scope: string };
    const granted = tokenBody.scope.split(" ");
    for (const scope of ["proposals:read", "billing:read", "billing:write", "catalog:write"]) assert.ok(granted.includes(scope), scope);
    assert.deepEqual(tokens[0]?.scopes, granted);

    const health = await fetch(`${baseUrl}/api/v1/health`, { headers: { authorization: `Bearer ${tokenBody.access_token}` } });
    const reported = await health.json() as { entity: { scopes: string[] } };
    assert.deepEqual(reported.entity.scopes, granted);
  } finally {
    server.close();
  }
});

test("health reports the scopes stored on a bearer token", async () => {
  const token = "connector-token-value-with-enough-length";
  const prisma = {
    user: { findUnique: async () => null },
    mcpClient: { findUnique: async () => null, findMany: async () => [] },
    mcpToken: {
      create: async () => ({ expiresAt: new Date() }),
      updateMany: async () => ({ count: 0 }),
      findFirst: async ({ where }: { where: { tokenHash: string } }) => where.tokenHash === createHash("sha256").update(token).digest("hex") ? { scopes: ["proposals:read", "billing:read"] } : null,
    },
    auditEvent: { findMany: async () => [] },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createSystemAuthRouter({ prisma: prisma as never, checkDatabase: async () => undefined }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`, { headers: { authorization: `Bearer ${token}` } });
    const body = await response.json() as { entity: { scopes: string[] } };
    assert.deepEqual(body.entity.scopes, ["proposals:read", "billing:read"]);
    const anonymous = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
    assert.equal((await anonymous.json() as { entity: { scopes?: string[] } }).entity.scopes, undefined);
  } finally {
    server.close();
  }
});
