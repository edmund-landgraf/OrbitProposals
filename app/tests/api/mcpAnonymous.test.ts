process.env.UNWH_MCP_TRACE = "off";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../../unwh-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { InMemoryTransport } from "../../unwh-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js";
import { createServer } from "../../unwh-mcp/src/createServer.js";
import { ANONYMOUS_TOOLS, anonymousRateLimiter, anonymousSettingsSource, authChallenge, clientAddress, FALLBACK_ANONYMOUS_SETTINGS, securitySchemesFor } from "../../unwh-mcp/src/anonymousAccess.js";
import { containsContactDetails } from "../../unwh-mcp/src/anonymousDraft.js";
import { loadAnonymousMcpSettings } from "../../server/mcpAnonymous.js";

const METADATA = "https://mcp.example.test/.well-known/oauth-protected-resource";

async function connect(options: Parameters<typeof createServer>[0]) {
  const server = createServer(options);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function recordFetch() {
  const calls: Array<{ url: string; method: string; authorization?: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), method: init?.method ?? "GET", authorization: headers.get("authorization") ?? undefined });
    const url = String(input);
    const entity = url.includes("/catalog") ? { plans: [], currency: "USD" } : { ok: true, service: "unwh-api" };
    return new Response(JSON.stringify({ ok: true, entity, warnings: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("declares securitySchemes the way the Apps SDK expects", () => {
  assert.deepEqual(securitySchemesFor("unw_get_catalog"), [{ type: "noauth" }]);
  assert.deepEqual(securitySchemesFor("unw_draft_proposal"), [{ type: "noauth" }]);
  assert.deepEqual(securitySchemesFor("search"), [{ type: "noauth" }, { type: "oauth2", scopes: ["proposals:read"] }]);
  assert.deepEqual(securitySchemesFor("unw_create_proposal"), [{ type: "oauth2", scopes: ["proposals:write"] }]);
});

test("the auth challenge carries mcp/www_authenticate with the resource metadata", () => {
  const challenge = authChallenge(METADATA, "proposals:write", "save a proposal");
  assert.equal(challenge.isError, true);
  const [header] = challenge._meta["mcp/www_authenticate"];
  assert.match(header!, /^Bearer resource_metadata="https:\/\/mcp\.example\.test\/\.well-known\/oauth-protected-resource"/);
  assert.match(header!, /error="insufficient_scope"/);
  assert.match(header!, /error_description="Sign in to Unwhelm to save a proposal\."/);
});

test("anonymous tools/list shows anonymous and sign-in tools with schemes, never staff or admin tools", async () => {
  const fake = recordFetch();
  try {
    const client = await connect({ apiOrigin: "http://api.test", anonymous: true, resourceMetadataUrl: METADATA, traceSink: null });
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of ANONYMOUS_TOOLS) assert.ok(names.includes(name), name);
    assert.ok(names.includes("unw_create_proposal"));
    assert.ok(!names.some((name) => name.startsWith("unw_admin")), "admin tools hidden");
    assert.ok(!names.includes("unw_list_agent_traces"));
    for (const tool of tools) assert.ok(Array.isArray((tool._meta as { securitySchemes?: unknown } | undefined)?.securitySchemes), `${tool.name} declares securitySchemes`);
  } finally { fake.restore(); }
});

test("anonymous calls to sign-in tools return the challenge and never reach the API", async () => {
  const fake = recordFetch();
  try {
    const client = await connect({ apiOrigin: "http://api.test", anonymous: true, resourceMetadataUrl: METADATA, traceSink: null });
    const result = await client.callTool({ name: "unw_list_proposals", arguments: {} });
    assert.equal(result.isError, true);
    assert.ok(Array.isArray((result._meta as Record<string, unknown>)["mcp/www_authenticate"]));
    const fetched = await client.callTool({ name: "fetch", arguments: { id: "proposal:00000000-0000-4000-8000-000000000001" } });
    assert.equal(fetched.isError, true);
    assert.ok(Array.isArray((fetched._meta as Record<string, unknown>)["mcp/www_authenticate"]));
    assert.ok(!fake.calls.some((call) => call.url.includes("/proposals")), "no proposal reads");
    assert.ok(fake.calls.every((call) => call.authorization === undefined));
  } finally { fake.restore(); }
});

test("anonymous catalog and draft work without a token; drafts are not stored and refuse contact details", async () => {
  const fake = recordFetch();
  try {
    const client = await connect({ apiOrigin: "http://api.test", anonymous: true, resourceMetadataUrl: METADATA, traceSink: null });
    const catalog = await client.callTool({ name: "unw_get_catalog", arguments: {} });
    assert.notEqual(catalog.isError, true);
    const before = fake.calls.length;
    const draft = await client.callTool({ name: "unw_draft_proposal", arguments: { title: "Listing sync", engagement: "fixed_price", scope: { summary: "Hourly sync of rental listings.", deliverables: ["Sync job"] } } });
    assert.notEqual(draft.isError, true);
    const entity = (draft.structuredContent as { entity: { saved: boolean; missing: string[] } }).entity;
    assert.equal(entity.saved, false);
    assert.deepEqual(entity.missing, ["pricing"]);
    assert.equal(fake.calls.length, before, "draft makes no API calls");
    const pii = await client.callTool({ name: "unw_draft_proposal", arguments: { title: "Call me at 415 555 0100", scope: { summary: "Email jane@example.com" } } });
    assert.equal(pii.isError, true);
  } finally { fake.restore(); }
});

test("contact detail check", () => {
  assert.ok(containsContactDetails("reach me: a.b@example.org"));
  assert.ok(containsContactDetails("+1 (415) 555-0100"));
  assert.ok(!containsContactDetails("Sync 3 sites every 15 minutes in 2027"));
});

test("anonymous rate limiter allows the limit per window and reports Retry-After", () => {
  const allow = anonymousRateLimiter();
  for (let i = 0; i < 3; i += 1) assert.equal(allow("1.2.3.4", 3, 60_000, 1_000).allowed, true);
  const blocked = allow("1.2.3.4", 3, 60_000, 11_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 50);
  assert.equal(allow("5.6.7.8", 3, 60_000, 11_000).allowed, true, "other addresses unaffected");
  assert.equal(allow("1.2.3.4", 3, 60_000, 61_000).allowed, true, "new window");
  assert.equal(anonymousRateLimiter()("x", 0, 1000, 0).allowed, false, "limit 0 disables anonymous access");
});

test("client address uses the last forwarded hop, else the socket", () => {
  assert.equal(clientAddress({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" }, "127.0.0.1"), "1.2.3.4");
  assert.equal(clientAddress({}, "10.0.0.2"), "10.0.0.2");
});

test("anonymous settings come from mcp-info and fall back strictly", async () => {
  const good = anonymousSettingsSource("http://api.test", async () => ({ ok: true, json: async () => ({ entity: { anonymous: { rateLimit: 30, windowSeconds: 600 } } }) }));
  assert.deepEqual(await good(), { rateLimit: 30, windowSeconds: 600 });
  const down = anonymousSettingsSource("http://api.test", async () => { throw new Error("down"); });
  assert.deepEqual(await down(), FALLBACK_ANONYMOUS_SETTINGS);
  assert.deepEqual(await loadAnonymousMcpSettings({ $queryRaw: async () => [{ key: "anonymous_rate_limit", value: 7 }, { key: "anonymous_rate_window_seconds", value: 60 }] }), { rateLimit: 7, windowSeconds: 60 });
  assert.deepEqual(await loadAnonymousMcpSettings({ $queryRaw: async () => { throw new Error("no table"); } }), FALLBACK_ANONYMOUS_SETTINGS);
});
