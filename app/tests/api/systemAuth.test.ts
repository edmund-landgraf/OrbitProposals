// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import express from "express";
import session from "express-session";
import { createSystemAuthRouter } from "../../server/routes/systemAuth.js";

const prisma = {
  user: { findUnique: async () => null },
  mcpClient: { findUnique: async () => null, findUniqueOrThrow: async () => ({ id: "00000000-0000-0000-0000-000000000001" }), findMany: async () => [] },
  mcpToken: { create: async () => ({ expiresAt: new Date(Date.now() + 1000) }), updateMany: async () => ({ count: 0 }) },
  auditEvent: { findMany: async () => [] },
};

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use("/api/v1", createSystemAuthRouter({ prisma: prisma as never, checkDatabase: async () => undefined }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); } finally { server.close(); }
}

test("health returns the database service envelope", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    const body = await response.json() as { ok: boolean; entity: { connected: boolean }; requestId: string };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.entity.connected, true);
    assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  });
});

test("public pricing and MCP info are available without a session", async () => {
  await withServer(async (baseUrl) => {
    const [pricing, mcpInfo] = await Promise.all([
      fetch(`${baseUrl}/api/v1/public/pricing`),
      fetch(`${baseUrl}/api/v1/public/mcp-info`),
    ]);
    assert.equal(pricing.status, 200);
    assert.equal(mcpInfo.status, 200);
    const pricingBody = await pricing.json() as { entity: { currency: string; plans: { id: string; price: { amountMinor: number } | null; priceKind: string; hours: number | null }[] } };
    const mcpBody = await mcpInfo.json() as { entity: { status: string } };
    assert.equal(pricingBody.entity.currency, "USD");
    const byId = Object.fromEntries(pricingBody.entity.plans.map((plan) => [plan.id, plan]));
    assert.equal(byId.workflow_check?.price?.amountMinor, 25000);
    assert.equal(byId.workflow_check?.priceKind, "exact");
    assert.equal(byId.capped_hours_4?.hours, 4);
    assert.equal(byId.capped_hours_4?.price?.amountMinor, 55000);
    assert.equal(byId.capped_hours_8?.hours, 8);
    assert.equal(byId.capped_hours_8?.price?.amountMinor, 90000);
    assert.equal(byId.fixed_price?.price?.amountMinor, 300000);
    assert.equal(byId.fixed_price?.priceKind, "minimum");
    assert.equal(byId.hourly?.price?.amountMinor, 17500);
    assert.equal(byId.hourly?.priceKind, "rate");
    assert.equal(pricingBody.entity.plans.length, 5);
    assert.equal(mcpBody.entity.status, "not_live");
  });
});

test("mcp-info reports the authorization server from UNWH_AUTHORIZATION_SERVER", async () => {
  const previous = {
    auth: process.env.UNWH_AUTHORIZATION_SERVER,
    specific: process.env.UNWH_MCP_AUTHORIZATION_SERVER,
    mcp: process.env.UNWH_MCP_PUBLIC_URL,
  };
  const restore = () => {
    for (const [key, value] of Object.entries({ UNWH_AUTHORIZATION_SERVER: previous.auth, UNWH_MCP_AUTHORIZATION_SERVER: previous.specific, UNWH_MCP_PUBLIC_URL: previous.mcp })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  process.env.UNWH_MCP_PUBLIC_URL = "https://mcp.example.test/mcp";
  delete process.env.UNWH_MCP_AUTHORIZATION_SERVER;
  process.env.UNWH_AUTHORIZATION_SERVER = "https://auth.example.test";
  try {
    await withServer(async (baseUrl) => {
      const body = await (await fetch(`${baseUrl}/api/v1/public/mcp-info`)).json() as { entity: { authorizationServer: string | null; mcpUrl: string; status: string } };
      assert.equal(body.entity.status, "available");
      assert.equal(body.entity.mcpUrl, "https://mcp.example.test/mcp");
      assert.equal(body.entity.authorizationServer, "https://auth.example.test");
    });
    process.env.UNWH_MCP_AUTHORIZATION_SERVER = "https://auth-override.example.test";
    await withServer(async (baseUrl) => {
      const body = await (await fetch(`${baseUrl}/api/v1/public/mcp-info`)).json() as { entity: { authorizationServer: string | null } };
      assert.equal(body.entity.authorizationServer, "https://auth-override.example.test");
    });
  } finally {
    restore();
  }
});

test("session and protected identity routes use documented auth errors", async () => {
  await withServer(async (baseUrl) => {
    const sessionResponse = await fetch(`${baseUrl}/api/v1/auth/session`);
    const meResponse = await fetch(`${baseUrl}/api/v1/me`);
    assert.equal(sessionResponse.status, 200);
    assert.equal((await sessionResponse.json()).entity.authMode, "public");
    assert.equal(meResponse.status, 401);
    const meBody = await meResponse.json() as { ok: boolean; code: string; retryable: boolean };
    assert.equal(meBody.ok, false);
    assert.equal(meBody.code, "AUTH_REQUIRED");
    assert.equal(meBody.retryable, false);
  });
});

test("session response for an admin includes user.isAdmin true", async () => {
  const issued: { id: string; email: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null }[] = [];
  const user = { id: "00000000-0000-0000-0000-000000000003", email: "admin@example.com", displayName: "Admin", isAdmin: true, createdAt: new Date(), memberships: [] as unknown[] };
  const magicLink = {
    create: async ({ data }: any) => { const record = { id: "magic-admin", ...data, consumedAt: null }; issued.push(record); return record; },
    findFirst: async ({ where }: any) => issued.find((item) => item.tokenHash === where.tokenHash && item.consumedAt === null && item.expiresAt > where.expiresAt.gt) ?? null,
    updateMany: async ({ where, data }: any) => { const item = issued.find((candidate) => candidate.id === where.id && candidate.consumedAt === null); if (!item) return { count: 0 }; item.consumedAt = data.consumedAt; return { count: 1 }; },
  };
  const testPrisma = { ...prisma, magicLink, user: { findUnique: async () => user } };
  const app = express(); app.use(express.json()); app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  let sentToken = "";
  app.use("/api/v1", createSystemAuthRouter({ prisma: testPrisma as never, sendMagicLink: async ({ token }) => { sentToken = token; } }));
  const server = app.listen(0); await once(server, "listening"); const address = server.address(); assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  try {
    const requestResponse = await fetch(`${baseUrl}/api/v1/auth/magic-link/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email }) });
    assert.equal(requestResponse.status, 200);
    const verified = await fetch(`${baseUrl}/api/v1/auth/magic-link/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: sentToken }) });
    assert.equal(verified.status, 200);
    cookie = (verified.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).filter(Boolean).join("; ");
    const sessionResponse = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { cookie } });
    const body = await sessionResponse.json() as { entity: { user: { isAdmin: boolean } } };
    assert.equal(sessionResponse.status, 200);
    assert.equal(body.entity.user.isAdmin, true);
  } finally { server.close(); }
});

test("MCP revoke rejects requests without a bearer token", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/mcp/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
  });
});

test("magic links are persisted, emailed, and consumed only once", async () => {
  const issued: { id: string; email: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null }[] = [];
  const user = { id: "00000000-0000-0000-0000-000000000002", email: "person@example.com", displayName: "Person", createdAt: new Date(), memberships: [] };
  const magicLink = {
    create: async ({ data }: any) => { const record = { id: "magic-1", ...data, consumedAt: null }; issued.push(record); return record; },
    findFirst: async ({ where }: any) => issued.find((item) => item.tokenHash === where.tokenHash && item.consumedAt === null && item.expiresAt > where.expiresAt.gt) ?? null,
    updateMany: async ({ where, data }: any) => { const item = issued.find((candidate) => candidate.id === where.id && candidate.consumedAt === null); if (!item) return { count: 0 }; item.consumedAt = data.consumedAt; return { count: 1 }; },
  };
  const testPrisma = { ...prisma, magicLink, user: { findUnique: async () => user } };
  const app = express(); app.use(express.json()); app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  let sentToken = "";
  app.use("/api/v1", createSystemAuthRouter({ prisma: testPrisma as never, sendMagicLink: async ({ token }) => { sentToken = token; } }));
  const server = app.listen(0); await once(server, "listening"); const address = server.address(); assert(address && typeof address !== "string");
  try {
    const requestResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/magic-link/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "Person@example.com" }) });
    assert.equal(requestResponse.status, 200); assert.equal(issued.length, 1); assert.notEqual(sentToken, "");
    const verify = () => fetch(`http://127.0.0.1:${address.port}/api/v1/auth/magic-link/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: sentToken }) });
    assert.equal((await verify()).status, 200); assert.equal((await verify()).status, 400); assert.ok(issued[0].consumedAt);
  } finally { server.close(); }
});

test("dynamic MCP clients sign in, consent, and call the MCP listener", async () => {
  const clients: { id: string; clientId: string; name: string; redirectUris: string[] }[] = [];
  const issued: { id: string; email: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null }[] = [];
  const user = { id: "00000000-0000-0000-0000-000000000002", email: "person@example.com", displayName: "Person", createdAt: new Date(), memberships: [] as { status: string; organizationId?: string }[] };
  const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
  const magicLink = {
    create: async ({ data }: { data: { email: string; tokenHash: string; expiresAt: Date } }) => { const record = { id: randomUUID(), ...data, consumedAt: null }; issued.push(record); return record; },
    findFirst: async ({ where }: { where: { tokenHash: string; expiresAt: { gt: Date } } }) => issued.find((item) => item.tokenHash === where.tokenHash && item.consumedAt === null && item.expiresAt > where.expiresAt.gt) ?? null,
    updateMany: async ({ where, data }: { where: { id: string }; data: { consumedAt: Date } }) => { const item = issued.find((candidate) => candidate.id === where.id && candidate.consumedAt === null); if (!item) return { count: 0 }; item.consumedAt = data.consumedAt; return { count: 1 }; },
  };
  const mcpClient = {
    create: async ({ data }: { data: { clientId: string; name: string; redirectUris: string[] } }) => { const row = { id: randomUUID(), ...data }; clients.push(row); return row; },
    findUnique: async ({ where }: { where: { clientId: string } }) => clients.find((item) => item.clientId === where.clientId) ?? null,
    findUniqueOrThrow: async ({ where }: { where: { clientId: string } }) => { const row = clients.find((item) => item.clientId === where.clientId); if (!row) throw new Error("missing client"); return row; },
    findMany: async () => clients,
  };
  const tokens: unknown[] = [];
  const testPrisma = { ...prisma, magicLink, mcpClient, mcpToken: { ...prisma.mcpToken, create: async ({ data }: { data: unknown }) => { tokens.push(data); return { expiresAt: new Date(Date.now() + 1000) }; } }, user: { findUnique: async ({ where }: { where: { id?: string; email?: string } }) => (where.id && where.id !== user.id) || (where.email && where.email !== user.email) ? null : user } };
  const app = express(); app.use(express.json()); app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  let sentToken = "";
  app.use("/api/v1", createSystemAuthRouter({ prisma: testPrisma as never, sendMagicLink: async ({ token }) => { sentToken = token; } }));
  const server = app.listen(0); await once(server, "listening"); const address = server.address(); assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  const store = (response: Response) => { const set = response.headers.getSetCookie?.() ?? []; const next = set.map((value) => value.split(";")[0]).filter(Boolean); if (next.length) cookie = next.join("; "); };
  const headers = (extra: Record<string, string> = {}) => ({ ...(cookie ? { cookie } : {}), ...extra });
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://127.0.0.1:9/callback";
  try {
    const discovery = await fetch(`${baseUrl}/api/v1/.well-known/oauth-authorization-server`);
    const discoveryBody = await discovery.json() as { registration_endpoint: string; token_endpoint_auth_methods_supported: string[] };
    assert.equal(discoveryBody.token_endpoint_auth_methods_supported[0], "none");
    assert.match(discoveryBody.registration_endpoint, /\/api\/v1\/auth\/mcp\/register$/);

    const rejected = await fetch(`${baseUrl}/api/v1/auth/mcp/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://example.com/cb", "https://example.com/cb#frag"], grant_types: ["authorization_code"], token_endpoint_auth_method: "none" }) });
    assert.equal(rejected.status, 400);
    const secretRejected = await fetch(`${baseUrl}/api/v1/auth/mcp/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["cursor://anysphere.cursor-mcp/callback"], client_secret: "secret" }) });
    assert.equal(secretRejected.status, 400);
    const overridden = await fetch(`${baseUrl}/api/v1/auth/mcp/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["cursor://anysphere.cursor-mcp/callback"], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "client_secret_post" }) });
    assert.equal(overridden.status, 201);
    const overriddenBody = await overridden.json() as { token_endpoint_auth_method: string; grant_types: string[]; client_secret?: string };
    assert.equal(overriddenBody.token_endpoint_auth_method, "none");
    assert.deepEqual(overriddenBody.grant_types, ["authorization_code", "refresh_token"]);
    assert.equal(overriddenBody.client_secret, undefined);

    const registered = await fetch(`${baseUrl}/api/v1/auth/mcp/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [redirectUri, "cursor://anysphere.cursor-mcp/callback"], client_name: "Cursor", grant_types: ["authorization_code"], token_endpoint_auth_method: "none", response_types: ["code"], scope: "openid", client_uri: "https://cursor.com", logo_uri: "https://cursor.com/logo.png" }) });
    assert.equal(registered.status, 201);
    const client = await registered.json() as { client_id: string; client_secret?: string; token_endpoint_auth_method: string; grant_types: string[]; response_types: string[] };
    assert.equal(client.client_secret, undefined);
    assert.equal(client.token_endpoint_auth_method, "none");
    assert.deepEqual(client.grant_types, ["authorization_code", "refresh_token"]);
    assert.deepEqual(client.response_types, ["code"]);

    const authorize = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "xyz", resource: "https://mcp.unwhelm.net/mcp" })}`, { redirect: "manual" });
    store(authorize);
    assert.equal(authorize.status, 302);
    assert.equal(authorize.headers.get("location"), "/api/v1/auth/signin");

    const unregistered = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: "http://127.0.0.1:9/other", response_type: "code", code_challenge: challenge, code_challenge_method: "S256" })}`, { redirect: "manual" });
    assert.equal(unregistered.status, 400);
    assert.equal(unregistered.headers.get("location"), null);
    assert.match(await unregistered.text(), /not registered/);

    const signInPage = await fetch(`${baseUrl}/api/v1/auth/signin`, { headers: headers() });
    const signInHtml = await signInPage.text();
    assert.equal(signInPage.status, 200);
    assert.match(signInHtml, /action="\/api\/v1\/auth\/signin"/);
    assert.match(signInHtml, /name="email"/);
    assert.match(signInHtml, /sign-in link has been sent/);
    const requested = await fetch(`${baseUrl}/api/v1/auth/signin`, { method: "POST", headers: headers({ "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ email: user.email }) });
    assert.equal(requested.status, 200);
    assert.match(await requested.text(), /Check your email/);
    assert.notEqual(sentToken, "");
    const returned = await fetch(`${baseUrl}/api/v1/auth/magic-link?${new URLSearchParams({ token: sentToken })}`, { headers: headers(), redirect: "manual" });
    store(returned);
    assert.equal(returned.status, 302);
    assert.equal(returned.headers.get("location"), "/api/v1/auth/mcp/authorize/resume");

    const consent = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize/resume`, { headers: headers() });
    const consentHtml = await consent.text();
    assert.equal(consent.status, 200);
    assert.match(consentHtml, /Cursor<\/strong> wants access to your Unwhelm account/);
    const csrf = /name="csrf" value="([^"]+)"/.exec(consentHtml)?.[1];
    assert.ok(csrf);

    const allowed = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize/decision`, { method: "POST", headers: headers({ "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ csrf, decision: "allow" }), redirect: "manual" });
    store(allowed);
    const allowedLocation = new URL(allowed.headers.get("location") ?? "", redirectUri);
    assert.equal(allowed.status, 302);
    assert.equal(allowedLocation.searchParams.get("state"), "xyz");
    const code = allowedLocation.searchParams.get("code");
    assert.ok(code);

    const wrong = await fetch(`${baseUrl}/api/v1/auth/mcp/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: randomBytes(32).toString("base64url") }) });
    assert.equal(wrong.status, 400);
    const reused = await fetch(`${baseUrl}/api/v1/auth/mcp/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier }) });
    assert.equal(reused.status, 400);
    const offsiteRequest = await fetch(`${baseUrl}/api/v1/auth/magic-link/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: user.email }) });
    assert.equal(offsiteRequest.status, 200);
    const offsite = await fetch(`${baseUrl}/api/v1/auth/magic-link?${new URLSearchParams({ token: sentToken, next: "https://evil.example/phish" })}`, { redirect: "manual" });
    assert.equal(offsite.status, 302);
    assert.equal(offsite.headers.get("location"), "/");

    const again = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "again" })}`, { headers: headers() });
    const againHtml = await again.text();
    const csrfAgain = /name="csrf" value="([^"]+)"/.exec(againHtml)?.[1];
    assert.ok(csrfAgain);
    const allowedAgain = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize/decision`, { method: "POST", headers: headers({ "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ csrf: csrfAgain!, decision: "allow" }), redirect: "manual" });
    const goodCode = new URL(allowedAgain.headers.get("location") ?? "", redirectUri).searchParams.get("code");
    const wrongResource = await fetch(`${baseUrl}/api/v1/auth/mcp/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code: goodCode, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier, resource: "https://evil.example/mcp" }) });
    assert.equal(wrongResource.status, 400);
    const exchanged = await fetch(`${baseUrl}/api/v1/auth/mcp/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code: goodCode, client_id: client.client_id, redirect_uri: redirectUri, code_verifier: verifier, resource: "https://mcp.unwhelm.net/mcp" }) });
    assert.equal(exchanged.status, 200);
    const tokenBody = await exchanged.json() as { access_token: string; token_type: string };
    assert.equal(tokenBody.token_type, "Bearer");
    assert.equal(tokens.length, 1);

    const { createServer } = await import("../../unwh-mcp/src/createServer.ts");
    const { StreamableHTTPServerTransport } = await import("../../unwh-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js");
    const mcp = createHttpServer(async (mcpRequest, mcpResponse) => {
      if (mcpRequest.url !== "/mcp" || mcpRequest.method !== "POST") { mcpResponse.writeHead(404); mcpResponse.end(); return; }
      if (mcpRequest.headers.authorization !== `Bearer ${tokenBody.access_token}`) { mcpResponse.writeHead(401); mcpResponse.end(); return; }
      const mcpServer = createServer({ apiOrigin: baseUrl, bearer: mcpRequest.headers.authorization });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcpServer.connect(transport);
      await transport.handleRequest(mcpRequest, mcpResponse);
    });
    mcp.listen(0); await once(mcp, "listening"); const mcpAddress = mcp.address(); assert(mcpAddress && typeof mcpAddress !== "string");
    try {
      const mcpResponse = await fetch(`http://127.0.0.1:${mcpAddress.port}/mcp`, { method: "POST", headers: { authorization: `Bearer ${tokenBody.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } } }) });
      assert.equal(mcpResponse.status, 200);
    } finally { mcp.close(); }
  } finally { server.close(); }
});


async function withSendCounter(run: (signIn: (email: string, ip: string, path?: string) => Promise<Response>, sent: () => number) => Promise<void>) {
  let sends = 0;
  const testPrisma = { ...prisma, magicLink: { create: async ({ data }: any) => ({ id: randomUUID(), ...data }) }, user: { findUnique: async ({ where }: any) => ({ id: randomUUID(), email: where.email, memberships: [] }) } };
  const app = express(); app.set("trust proxy", true); app.use(express.json()); app.use(express.urlencoded({ extended: false })); app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use("/api/v1", createSystemAuthRouter({ prisma: testPrisma as never, sendMagicLink: async () => { sends += 1; } }));
  const server = app.listen(0); await once(server, "listening"); const address = server.address(); assert(address && typeof address !== "string");
  const signIn = (email: string, ip: string, path = "/auth/signin") => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ email }) });
  try { await run(signIn, () => sends); } finally { server.close(); }
}

test("magic-link requests are throttled at 5 per hour per email, and the 6th gets 429 with Retry-After", async () => {
  await withSendCounter(async (signIn, sent) => {
    for (let index = 0; index < 5; index += 1) {
      const response = await signIn(index % 2 ? "Limit.Email@Example.com" : "limit.email@example.com", `203.0.113.${10 + index}`);
      assert.equal(response.status, 200);
    }
    assert.equal(sent(), 5);
    const sixth = await signIn("limit.email@example.com", "203.0.113.99");
    assert.equal(sixth.status, 429);
    assert.ok(Number(sixth.headers.get("retry-after")) > 0);
    assert.equal(sent(), 5, "the 6th request must not send another link");
    const api = await signIn("limit.email@example.com", "203.0.113.98", "/auth/magic-link/request");
    assert.equal(api.status, 429);
    const retry = Number(api.headers.get("retry-after"));
    assert.ok(retry > 0 && retry <= 3600, `Retry-After ${retry}`);
    assert.equal((await api.json()).code, "RATE_LIMITED");
    assert.equal(sent(), 5);
  });
});

test("magic-link requests are throttled at 5 per hour per IP across different emails", async () => {
  await withSendCounter(async (signIn, sent) => {
    for (let index = 0; index < 5; index += 1) assert.equal((await signIn(`ip-limit-${index}@example.com`, "198.51.100.7")).status, 200);
    assert.equal(sent(), 5);
    const sixth = await signIn("ip-limit-6@example.com", "198.51.100.7", "/auth/magic-link/request");
    assert.equal(sixth.status, 429);
    assert.ok(Number(sixth.headers.get("retry-after")) > 0);
    assert.equal(sent(), 5);
  });
});

test("unknown emails stay non-enumerating below the limit and are counted toward it", async () => {
  let sends = 0;
  const testPrisma = { ...prisma, magicLink: { create: async ({ data }: any) => ({ id: randomUUID(), ...data }) }, user: { findUnique: async () => null } };
  const app = express(); app.set("trust proxy", 1); app.use(express.json()); app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use("/api/v1", createSystemAuthRouter({ prisma: testPrisma as never, sendMagicLink: async () => { sends += 1; } }));
  const server = app.listen(0); await once(server, "listening"); const address = server.address(); assert(address && typeof address !== "string");
  // Prod runs behind one proxy (trust proxy 1): the client IP is the last X-Forwarded-For hop, so a spoofed leading hop does not reset the counter.
  const ask = (spoof: string) => fetch(`http://127.0.0.1:${address.port}/api/v1/auth/magic-link/request`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `${spoof}, 192.0.2.44` }, body: JSON.stringify({ email: "nobody-here@example.com" }) });
  try {
    for (let index = 0; index < 5; index += 1) {
      const response = await ask(`10.0.0.${index}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).entity.accepted, true);
    }
    const sixth = await ask("10.0.0.99");
    assert.equal(sixth.status, 429);
    assert.ok(Number(sixth.headers.get("retry-after")) > 0);
    assert.equal(sends, 0);
  } finally { server.close(); }
});
