import test from "node:test";
import assert from "node:assert/strict";
import { publicScopeSource, FALLBACK_PUBLIC_SCOPES } from "../../unwh-mcp/src/publicScopes.js";
import { toolsHiddenForClients } from "../../unwh-mcp/src/toolAccess.js";

test("protected-resource scopes come from API discovery", async () => {
  let calls = 0;
  const source = publicScopeSource("http://api/", async (url) => { calls++; assert.equal(url, "http://api/.well-known/oauth-authorization-server"); return { ok: true, json: async () => ({ scopes_supported: ["proposals:read", "billing:read"] }) }; });
  assert.deepEqual(await source(0), ["proposals:read", "billing:read"]);
  await source(1000);
  assert.equal(calls, 1);
});

test("API down falls back without staff-only scopes", async () => {
  const source = publicScopeSource("http://api", async () => { throw new Error("down"); });
  const scopes = await source(0);
  assert.deepEqual(scopes, FALLBACK_PUBLIC_SCOPES);
  assert.ok(!scopes.includes("admin"));
  assert.ok(!scopes.includes("catalog:write"));
});

test("invoice write tools are hidden from client tokens", () => {
  const hidden = toolsHiddenForClients(["unw_create_invoice", "unw_send_invoice", "unw_void_invoice", "unw_log_hours", "unw_invoice_hours", "unw_list_invoices", "unw_pay_invoice"]).map((h) => h.name);
  assert.deepEqual(hidden.sort(), ["unw_create_invoice", "unw_invoice_hours", "unw_log_hours", "unw_send_invoice", "unw_void_invoice"]);
});
