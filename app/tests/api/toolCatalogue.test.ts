import assert from "node:assert/strict";
import test from "node:test";
import { parseLinkedDocument, parseUploadPart } from "../../server/proposalAttachments.js";
import { toolRisk } from "../../unwh-mcp/src/toolCatalogue.js";
import { createServer } from "../../unwh-mcp/src/createServer.js";

test("tool risk separates reads, edits, and commitments", () => {
  assert.equal(toolRisk("unw_list_proposals", "proposals:read"), "read");
  assert.equal(toolRisk("unw_list_tools"), "read");
  assert.equal(toolRisk("unw_update_proposal_section", "proposals:write"), "edit");
  assert.equal(toolRisk("unw_accept_proposal", "proposals:write"), "commit");
  assert.equal(toolRisk("unw_create_invoice", "billing:write"), "commit");
  assert.equal(toolRisk("unw_sign_contract", "contracts:write"), "commit");
});

test("the tool catalogue includes a risk label for every registered tool", async () => {
  const server = createServer({ apiOrigin: "http://127.0.0.1:9" });
  const tools = (server as unknown as { _registeredTools: Record<string, { enabled: boolean }> })._registeredTools;
  assert.ok(tools.unw_list_tools);
  const listed = await (tools.unw_list_tools as { handler: (args: Record<string, never>) => Promise<{ structuredContent: { tools: Array<{ name: string; risk: string }> } }> }).handler({});
  const names = listed.structuredContent.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, Object.keys(tools).sort());
  assert.equal(listed.structuredContent.tools.find((tool) => tool.name === "unw_accept_proposal")?.risk, "commit");
  assert.equal(listed.structuredContent.tools.find((tool) => tool.name === "unw_set_phase_estimate")?.risk, "edit");
  assert.equal(listed.structuredContent.tools.find((tool) => tool.name === "unw_list_tools")?.risk, "read");
});

test("an upload part stays within one tool call", () => {
  const part = parseUploadPart("notes.md", Buffer.from("# Notes\n").toString("base64"));
  assert.equal(part.filename, "notes.md");
  assert.throws(() => parseUploadPart("notes.md", "A".repeat(12_001)), /12000/);
});

test("a document link must be a public https URL", () => {
  assert.throws(() => parseLinkedDocument("architecture.pdf", "https://localhost/architecture.pdf"), /public/);
  assert.throws(() => parseLinkedDocument("architecture.pdf", "https://10.1.1.1/architecture.pdf"), /public/);
});

test("a document link must be https", () => {
  const linked = parseLinkedDocument("architecture.pdf", "https://example.com/architecture.pdf");
  assert.equal(linked.contentType, "application/pdf");
  assert.equal(linked.sourceUrl, "https://example.com/architecture.pdf");
  assert.throws(() => parseLinkedDocument("architecture.pdf", "http://example.com/architecture.pdf"), /https/);
});
