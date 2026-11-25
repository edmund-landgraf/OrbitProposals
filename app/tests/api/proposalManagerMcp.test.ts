import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "../../unwh-mcp/src/createServer.js";

type Handler = (args: unknown, extra: unknown) => Promise<{ structuredContent: { ok: boolean; changed?: boolean } }>;
const handlerOf = (server: ReturnType<typeof createServer>, name: string): Handler => {
  const tool = (server as unknown as { _registeredTools: Record<string, { handler?: Handler; callback?: Handler }> })._registeredTools[name];
  assert.ok(tool, `Expected MCP tool ${name} to be registered.`);
  return (tool.handler ?? tool.callback)!;
};

test("proposal-manager MVP tools are registered and use the expected API families", async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const target = String(input instanceof Request ? input.url : input);
    calls.push(target);
    return new Response(JSON.stringify({ ok: true, changed: true, entity: {}, warnings: [], links: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const previous = process.env.UNWH_MCP_TRACE;
  process.env.UNWH_MCP_TRACE = "0";
  try {
    const server = createServer({ apiOrigin: "http://api.test", bearer: "Bearer test", traceSink: null });
    const proposalId = randomUUID();
    const tools: Array<[string, unknown]> = [
      ["unw_ingest_rfp", { proposalId, fileName: "rfp.txt", content: "Deliver a migration plan." }],
      ["unw_extract_rfp_requirements", { proposalId, requirements: [{ text: "Provide a migration plan." }] }],
      ["unw_analyze_rfp_requirements", { proposalId, content: "The vendor shall provide a migration plan." }],
      ["unw_list_compliance_requirements", { proposalId }],
      ["unw_update_compliance_requirement", { proposalId, requirementId: randomUUID(), confirmed: true }],
      ["unw_map_requirement_to_section", { proposalId, requirementId: randomUUID(), nodeKeys: ["scope"] }],
      ["unw_add_requirement_evidence", { proposalId, requirementId: randomUUID(), kind: "note", ref: "Reviewed with the sponsor." }],
      ["unw_get_compliance_matrix", { proposalId }],
      ["unw_sign_off_compliance", { proposalId, note: "Coverage accepted." }],
      ["unw_draft_proposal_section", { proposalId, nodeKey: "approach", apply: false }],
      ["unw_create_go_no_go_assessment", { proposalId, factors: [{ key: "fit", score: 4 }] }],
      ["unw_assign_proposal_task", { proposalId, title: "Review scope" }],
      ["unw_list_proposal_tasks", { proposalId }],
      ["unw_create_compliance_matrix", { proposalId, mappings: [{ requirementId: randomUUID(), nodeKeys: ["scope"] }] }],
      ["unw_validate_proposal_readiness", { proposalId }],
      ["unw_upsert_content_library_item", { title: "Migration answer", category: "delivery", body: { text: "We migrate in phases." }, stableKey: "migration-answer" }],
      ["unw_get_content_library_item", { itemId: randomUUID() }],
      ["unw_submit_content_library_item", { itemId: randomUUID() }],
      ["unw_approve_content_library_item", { itemId: randomUUID(), decision: "approve" }],
      ["unw_archive_content_library_item", { itemId: randomUUID() }],
      ["unw_search_content_library", { query: "migration" }],
      ["unw_insert_approved_content", { proposalId, itemId: randomUUID(), nodeKey: "scope" }],
      ["unw_create_scope_baseline", { proposalId, items: [] }],
      ["unw_create_pricing_model", { proposalId, currency: "USD", lines: [] }],
      ["unw_validate_commercial_policy", { proposalId }],
      ["unw_get_pending_client_decisions", { proposalId }],
      ["unw_compare_proposal_versions", { proposalId, fromVersion: 1, toVersion: 2 }],
      ["unw_create_delivery_project", { contractId: randomUUID(), title: "Implementation" }],
    ];
    for (const [name, args] of tools) {
      const result = await handlerOf(server, name)(args, { signal: new AbortController().signal });
      assert.equal(result.structuredContent.ok, true, name);
    }
    assert.ok(calls.some((value) => value.includes("/source-documents")));
    assert.ok(calls.some((value) => value.includes("/requirements/extract")));
    assert.ok(calls.some((value) => value.includes("/compliance-matrix")));
    assert.ok(calls.some((value) => value.includes("/projects")));
  } finally {
    globalThis.fetch = realFetch;
    if (previous === undefined) delete process.env.UNWH_MCP_TRACE; else process.env.UNWH_MCP_TRACE = previous;
  }
});
