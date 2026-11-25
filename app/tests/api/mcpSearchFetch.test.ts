import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../../unwh-mcp/src/createServer.js";

type Tool = { annotations?: Record<string, unknown>; handler?: (args: unknown, extra: unknown) => Promise<{ structuredContent: any }>; callback?: (args: unknown, extra: unknown) => Promise<{ structuredContent: any }> };
const PID = "11111111-1111-4111-8111-111111111111";

function serverWith(scopes: string[] | undefined, seen: string[]) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input); seen.push(url);
    const body = url.includes("/api/v1/catalog") ? { ok: true, entity: { id: "cat1", currency: "USD", hourly: 115 } }
      : url.endsWith(`/api/v1/proposals/${PID}/narrative`) ? { ok: true, entity: [{ key: "executive_summary", title: "Executive summary", text: "Move the warehouse data.", state: "drafted" }] }
      : url.endsWith(`/api/v1/proposals/${PID}`) ? { ok: true, entity: { id: PID, title: "Data migration", status: "draft" } }
      : url.includes("/api/v1/proposals?") ? { ok: true, entity: { items: [{ id: PID, title: "Data migration" }, { id: "22222222-2222-4222-8222-222222222222", title: "Mobile app" }] } }
      : { ok: false, code: "NOT_FOUND" };
    return new Response(JSON.stringify(body), { status: body.ok ? 200 : 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const tools = (createServer({ apiOrigin: "http://api.test", bearer: "Bearer t", scopes, traceSink: null }) as unknown as { _registeredTools: Record<string, Tool> })._registeredTools;
  const run = (name: string, args: unknown) => { const t = tools[name]!; return (t.handler ?? t.callback)!(args, {}); };
  return { tools, run, restore: () => { globalThis.fetch = realFetch; } };
}

test("search and fetch are registered read-only", () => {
  const s = serverWith(undefined, []);
  try { for (const n of ["search", "fetch"]) assert.equal(s.tools[n]!.annotations?.readOnlyHint, true, n); } finally { s.restore(); }
});

test("search returns ids, titles and urls of matching proposals", async () => {
  const s = serverWith(["proposals:read"], []);
  try {
    const { structuredContent } = await s.run("search", { query: "migration" });
    assert.deepEqual(structuredContent.results, [{ id: `proposal:${PID}`, title: "Data migration", url: `https://unwhelm.net/portal?proposal=${PID}` }]);
  } finally { s.restore(); }
});

test("fetch returns the full proposal by id", async () => {
  const s = serverWith(["proposals:read"], []);
  try {
    const { structuredContent } = await s.run("fetch", { id: `proposal:${PID}` });
    assert.equal(structuredContent.title, "Data migration");
    assert.equal(structuredContent.url, `https://unwhelm.net/portal?proposal=${PID}`);
    assert.match(structuredContent.text, /"status": "draft"/);
    assert.match(structuredContent.text, /"executive_summary"/);
    assert.match(structuredContent.text, /Move the warehouse data/);
  } finally { s.restore(); }
});

test("a token without proposals:read only searches the public catalog", async () => {
  const seen: string[] = [];
  const s = serverWith(["catalog:read"], seen);
  try {
    const { structuredContent } = await s.run("search", { query: "pricing" });
    assert.deepEqual(structuredContent.results.map((r: { id: string }) => r.id), ["catalog:active"]);
    assert.ok(!seen.some((u) => u.includes("/proposals")));
    await assert.rejects(s.run("fetch", { id: `proposal:${PID}` }), /proposals:read/);
    const cat = await s.run("fetch", { id: "catalog:active" });
    assert.match(cat.structuredContent.text, /USD/);
  } finally { s.restore(); }
});
test("search and fetch urls use the public site, not the API origin", async () => {
  const s = serverWith(["proposals:read"], []);
  try {
    const searched = await s.run("search", { query: "pricing" });
    const catalog = searched.structuredContent.results.find((r: { id: string }) => r.id === "catalog:active");
    assert.equal(catalog.url, "https://unwhelm.net/pricing");
    const fetched = await s.run("fetch", { id: "catalog:active" });
    assert.equal(fetched.structuredContent.url, "https://unwhelm.net/pricing");
    const proposal = await s.run("fetch", { id: `proposal:${PID}` });
    assert.equal(proposal.structuredContent.url, `https://unwhelm.net/portal?proposal=${PID}`);
  } finally { s.restore(); }
});

test("search and fetch urls honor publicBaseUrl", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    const body = url.includes("/api/v1/catalog") ? { ok: true, entity: { currency: "USD" } } : { ok: false };
    return new Response(JSON.stringify(body), { status: body.ok ? 200 : 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const tools = (createServer({ apiOrigin: "http://127.0.0.1:3201", publicBaseUrl: "https://example.test/", bearer: "Bearer t", scopes: ["catalog:read"], traceSink: null }) as unknown as { _registeredTools: Record<string, Tool> })._registeredTools;
    const run = (name: string, args: unknown) => { const t = tools[name]!; return (t.handler ?? t.callback)!(args, {}); };
    const searched = await run("search", { query: "catalog" });
    assert.equal(searched.structuredContent.results[0].url, "https://example.test/pricing");
    const fetched = await run("fetch", { id: "catalog:active" });
    assert.equal(fetched.structuredContent.url, "https://example.test/pricing");
  } finally { globalThis.fetch = realFetch; }
});
