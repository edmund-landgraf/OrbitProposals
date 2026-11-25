import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { connectorTokenScopes } from "../../server/connectorScopes.js";
import { publicMcpScopes } from "../../server/catalog.js";
import { ANONYMOUS_TOOLS } from "../../unwh-mcp/src/anonymousAccess.js";
import { STAFF_ONLY_TOOLS, toolsHiddenForClients } from "../../unwh-mcp/src/toolAccess.js";
import { createServer } from "../../unwh-mcp/src/createServer.js";

const all = ["proposals:read", "proposals:write", "contracts:write", "billing:read", "billing:write", "projects:read", "projects:write", "catalog:write", "admin"];
const staffOnly = ["admin", "catalog:write"];

test("a non-staff connector (DCR) never receives admin or catalog:write, even when it asks", () => {
  const asked = connectorTokenScopes({ requested: "proposals:read admin catalog:write", mcpScopes: all, staffGrants: ["catalog:write"], isStaffOrAdmin: false, staffOnlyScopes: staffOnly });
  assert.deepEqual(asked, ["proposals:read"]);
  const defaulted = connectorTokenScopes({ requested: "", mcpScopes: all, staffGrants: [], isStaffOrAdmin: false, staffOnlyScopes: staffOnly });
  for (const scope of staffOnly) assert.ok(!defaulted.includes(scope), scope);
  assert.ok(defaulted.includes("proposals:write"));
  const staff = connectorTokenScopes({ requested: "proposals:read", mcpScopes: all, staffGrants: ["catalog:write"], isStaffOrAdmin: true, staffOnlyScopes: staffOnly });
  assert.ok(staff.includes("catalog:write"));
});

test("discovery advertises only non-staff scopes", () => {
  assert.deepEqual(publicMcpScopes({ mcpScopes: all, staffOnlyScopes: staffOnly }), all.filter((scope) => !staffOnly.includes(scope)));
});

test("migration 0050 marks staff-only scopes and narrows the client preset", () => {
  const sql = readFileSync(new URL("../../prisma/migrations/0050_client_scope_hardening/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN "staff_only" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /IN \('admin', 'catalog:write'\)/);
  assert.match(sql, /ARRAY\['proposals:read', 'proposals:write', 'billing:read', 'projects:read'\] WHERE "code" = 'client'/);
});

type Registered = Record<string, { enabled: boolean; inputSchema?: { safeParse: (value: unknown) => { success: boolean } } }>;
const registered = (server: unknown) => (server as { _registeredTools: Registered })._registeredTools;

test("a non-staff caller can read the published catalog", () => {
  // GET /api/v1/catalog is public, and Try me calls unw_get_catalog with a client token.
  assert.equal(STAFF_ONLY_TOOLS.includes("unw_get_catalog"), false);
  assert.ok(ANONYMOUS_TOOLS.includes("unw_get_catalog"));
  const clientScopes = ["proposals:read", "proposals:write", "contracts:write", "billing:read", "projects:read"];
  const client = registered(createServer({ apiOrigin: "http://127.0.0.1:9", scopes: clientScopes, staff: false, traceSink: null }));
  assert.equal(client.unw_get_catalog.enabled, true);
  assert.equal(client.unw_get_catalog_draft.enabled, false);
  assert.equal(client.unw_publish_catalog.enabled, false);
});

test("client callers do not see staff tools; staff callers do", () => {
  const seven = ["unw_get_catalog_draft", "unw_create_catalog_draft", "unw_publish_catalog", "unw_update_billing_schedule_line", "unw_set_contract_billing_terms", "unw_get_billing_schedule", "unw_update_invoice_policy"];
  for (const name of seven) assert.ok(STAFF_ONLY_TOOLS.includes(name), name);
  const client = registered(createServer({ apiOrigin: "http://127.0.0.1:9", scopes: all, staff: false, traceSink: null }));
  for (const name of [...seven, "unw_review_decision"]) { assert.ok(client[name], `${name} registered`); assert.equal(client[name].enabled, false, name); }
  assert.equal(client.unw_get_catalog.enabled, true);
  assert.equal(client.unw_get_proposal.enabled, true);
  const staff = registered(createServer({ apiOrigin: "http://127.0.0.1:9", scopes: all, staff: true, traceSink: null }));
  for (const name of seven) assert.equal(staff[name].enabled, true, name);
  assert.equal(toolsHiddenForClients(["unw_get_proposal"]).length, 0);
});

test("add_review_comment type is an enum of the configured comment types", () => {
  const tools = registered(createServer({ apiOrigin: "http://127.0.0.1:9", traceSink: null }));
  const schema = tools.unw_add_review_comment.inputSchema!;
  const base = { proposalId: "00000000-0000-4000-8000-000000000001", body: "Why?" };
  assert.equal(schema.safeParse({ ...base, type: "question" }).success, true);
  assert.equal(schema.safeParse({ ...base, type: "comment" }).success, false);
});
