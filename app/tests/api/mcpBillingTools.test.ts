// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../../unwh-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { InMemoryTransport } from "../../unwh-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js";
import { createServer } from "../../unwh-mcp/src/createServer.js";
import { MCP_SCOPES as mcpScopes } from "../../unwh-mcp/src/scopes.js";
import { MCP_SCOPES as apiScopes } from "../../server/routes/systemAuth.js";

test("advertises billing and contract-sign scopes on the API and MCP listeners", () => {
  assert.deepEqual([...mcpScopes], [...apiScopes]);
  for (const scope of ["billing:read", "billing:write", "contracts:write"]) {
    assert.ok(mcpScopes.includes(scope), scope);
  }
});

test("registers sign, billing schedule, and invoice tools that forward to the API", async () => {
  const contractId = randomUUID();
  const invoiceId = randomUUID();
  const versionId = randomUUID();
  const calls: Array<{ url: string; method: string; authorization?: string; body?: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? undefined,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify({ ok: true, entity: { url: String(input) }, warnings: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const server = createServer({ apiOrigin: "http://api.test", bearer: "Bearer test-token" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "billing-tools-test", version: "0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    for (const name of ["unw_sign_contract", "unw_get_billing_schedule", "unw_list_invoices", "unw_get_invoice", "unw_create_invoice", "unw_send_invoice", "unw_pay_invoice", "unw_void_invoice", "unw_get_service_info", "unw_get_catalog", "unw_get_catalog_draft", "unw_create_catalog_draft", "unw_update_price_tier", "unw_update_billing_schedule_line", "unw_update_invoice_policy", "unw_publish_catalog", "unw_log_hours", "unw_list_hours", "unw_remaining_hours", "unw_invoice_hours", "unw_list_credits", "unw_apply_credit"]) {
      assert.ok(names.includes(name), name);
    }
    const byName = new Map(listed.tools.map((tool) => [tool.name, tool.description ?? ""]));
    assert.match(byName.get("unw_get_catalog") ?? "", /GET \/api\/v1\/catalog/);
    assert.match(byName.get("unw_get_catalog") ?? "", /does not return the open draft/);
    assert.doesNotMatch(byName.get("unw_get_catalog") ?? "", /catalog:write/);
    const mintSchema = listed.tools.find((tool) => tool.name === "unw_admin_mint_token")?.inputSchema as { properties?: { scopes?: { items?: { enum?: string[] } } } } | undefined;
    assert.deepEqual(mintSchema?.properties?.scopes?.items?.enum, [...mcpScopes]);
    assert.match(byName.get("unw_sign_contract") ?? "", /contracts:write/);
    assert.match(byName.get("unw_sign_contract") ?? "", /signing again does not add entries/);
    assert.match(byName.get("unw_sign_contract") ?? "", /GET \/api\/v1\/catalog/);
    assert.match(byName.get("unw_create_proposal") ?? "", /GET \/api\/v1\/catalog/);
    for (const name of ["unw_get_catalog_draft", "unw_create_catalog_draft", "unw_update_price_tier", "unw_update_billing_schedule_line", "unw_update_invoice_policy", "unw_publish_catalog"]) {
      assert.match(byName.get(name) ?? "", /catalog:write/, name);
    }
    assert.match(byName.get("unw_get_billing_schedule") ?? "", /billing:read/);
    assert.match(byName.get("unw_list_invoices") ?? "", /billing:read/);
    assert.match(byName.get("unw_get_invoice") ?? "", /billing:read/);
    for (const name of ["unw_create_invoice", "unw_send_invoice", "unw_pay_invoice", "unw_void_invoice"]) {
      assert.match(byName.get(name) ?? "", /billing:write/, name);
      assert.match(byName.get(name) ?? "", /does not charge a payment processor/, name);
    }

    await client.callTool({ name: "unw_sign_contract", arguments: { contractId } });
    await client.callTool({ name: "unw_get_billing_schedule", arguments: { contractId } });
    await client.callTool({ name: "unw_list_invoices", arguments: { limit: 2 } });
    await client.callTool({ name: "unw_get_invoice", arguments: { invoiceId } });
    await client.callTool({ name: "unw_create_invoice", arguments: { contractId, amount: { amountMinor: 150000, currency: "USD" }, dueDate: "2026-06-01", entryIds: [invoiceId] } });
    await client.callTool({ name: "unw_send_invoice", arguments: { invoiceId } });
    await client.callTool({ name: "unw_pay_invoice", arguments: { invoiceId } });
    await client.callTool({ name: "unw_void_invoice", arguments: { invoiceId } });
    await client.callTool({ name: "unw_get_catalog", arguments: {} });
    await client.callTool({ name: "unw_get_catalog_draft", arguments: {} });
    await client.callTool({ name: "unw_create_catalog_draft", arguments: {} });
    await client.callTool({ name: "unw_update_price_tier", arguments: { versionId, code: "workflow_check", amountMinor: 26000 } });
    await client.callTool({ name: "unw_update_billing_schedule_line", arguments: { versionId, lineId: invoiceId, label: "Deposit" } });
    await client.callTool({ name: "unw_update_invoice_policy", arguments: { versionId, signingDueOffsetDays: 3 } });
    await client.callTool({ name: "unw_publish_catalog", arguments: { versionId, effectiveFrom: "2026-03-01T00:00:00.000Z" } });
    await client.callTool({ name: "unw_list_credits", arguments: {} });
    await client.callTool({ name: "unw_apply_credit", arguments: { creditId: versionId, invoiceId } });
  } finally {
    await client.close();
    globalThis.fetch = original;
  }

  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    `POST http://api.test/api/v1/contracts/${contractId}/sign`,
    `GET http://api.test/api/v1/contracts/${contractId}/billing`,
    "GET http://api.test/api/v1/invoices?limit=2",
    `GET http://api.test/api/v1/invoices/${invoiceId}`,
    "POST http://api.test/api/v1/invoices",
    `POST http://api.test/api/v1/invoices/${invoiceId}/send`,
    `POST http://api.test/api/v1/invoices/${invoiceId}/pay`,
    `POST http://api.test/api/v1/invoices/${invoiceId}/void`,
    "GET http://api.test/api/v1/catalog",
    "GET http://api.test/api/v1/catalog/editor",
    "POST http://api.test/api/v1/catalog/drafts",
    `PATCH http://api.test/api/v1/catalog/drafts/${versionId}/price-tiers/workflow_check`,
    `PATCH http://api.test/api/v1/catalog/drafts/${versionId}/billing-schedule-lines/${invoiceId}`,
    `PATCH http://api.test/api/v1/catalog/drafts/${versionId}/invoice-policy`,
    `POST http://api.test/api/v1/catalog/drafts/${versionId}/publish`,
    "GET http://api.test/api/v1/credits",
    `POST http://api.test/api/v1/credits/${versionId}/apply`,
  ]);
  assert.ok(calls.every((call) => call.authorization === "Bearer test-token"));
  assert.equal(calls[0]?.body, "{}");
  assert.deepEqual(JSON.parse(calls[4]?.body ?? "{}"), {
    contractId,
    amount: { amountMinor: 150000, currency: "USD" },
    dueDate: "2026-06-01",
    entryIds: [invoiceId],
  });
  assert.equal(calls[6]?.body, "{}");
});

test("a token without billing or catalog scopes omits those tools and service info names them", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, entity: { service: "unwh-api", connected: true }, warnings: [] }), { status: 200, headers: { "content-type": "application/json" } });
  const server = createServer({ apiOrigin: "http://api.test", bearer: "Bearer narrow", scopes: ["proposals:read"] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "scope-filter-test", version: "0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(names.includes("unw_get_service_info"));
    assert.ok(names.includes("unw_get_proposal"));
    assert.ok(names.includes("unw_get_catalog"));
    for (const name of ["unw_log_hours", "unw_list_hours", "unw_remaining_hours", "unw_invoice_hours", "unw_list_credits", "unw_apply_credit", "unw_list_invoices", "unw_publish_catalog"]) {
      assert.equal(names.includes(name), false, name);
    }
    const result = await client.callTool({ name: "unw_get_service_info", arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const body = JSON.parse(text) as { scopes: string[]; hiddenTools: Array<{ name: string; scope: string }> };
    assert.deepEqual(body.scopes, ["proposals:read"]);
    const hidden = new Map(body.hiddenTools.map((tool) => [tool.name, tool.scope]));
    assert.equal(hidden.get("unw_log_hours"), "billing:write");
    assert.equal(hidden.get("unw_list_hours"), "billing:read");
    assert.equal(hidden.get("unw_remaining_hours"), "billing:read");
    assert.equal(hidden.get("unw_invoice_hours"), "billing:write");
    assert.equal(hidden.get("unw_list_credits"), "billing:read");
    assert.equal(hidden.get("unw_apply_credit"), "billing:write");
    assert.equal(hidden.get("unw_publish_catalog"), "catalog:write");
  } finally {
    globalThis.fetch = original;
  }
});

test("an admin scope lists hours, credit, and catalog tools", async () => {
  const server = createServer({ apiOrigin: "http://api.test", bearer: "Bearer admin", scopes: ["admin"] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "admin-scope-test", version: "0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  for (const name of ["unw_log_hours", "unw_list_credits", "unw_apply_credit", "unw_publish_catalog", "unw_get_service_info"]) {
    assert.ok(names.includes(name), name);
  }
});
