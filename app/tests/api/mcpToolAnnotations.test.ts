import assert from "node:assert/strict";
import test from "node:test";
import { createServer, REMINDER_INSTRUCTIONS } from "../../unwh-mcp/src/createServer.js";
import { toolAnnotations } from "../../unwh-mcp/src/toolAnnotations.js";

type Annotations = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
type Registered = Record<string, { description?: string; annotations?: Annotations }>;
const server = createServer({ apiOrigin: "http://127.0.0.1:9", traceSink: null });
const tools = (server as unknown as { _registeredTools: Registered })._registeredTools;
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

test("get, list and find tools are read-only", () => {
  const reads = Object.keys(tools).filter((name) => /^unw_(admin_)?(get|list|find)_/.test(name));
  assert.ok(reads.length > 20);
  for (const name of reads) assert.deepEqual(tools[name]!.annotations, read, name);
});

test("review and the anonymous draft are read-only", () => {
  assert.deepEqual(tools.unw_review_proposal!.annotations, read);
  assert.deepEqual(tools.unw_draft_proposal!.annotations, read);
});

test("signing, paying, and deletes are destructive", () => {
  const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
  for (const name of ["unw_publish_catalog", "unw_admin_delete_proposal", "unw_admin_delete_mcp_client", "unw_void_invoice", "unw_pay_invoice", "unw_admin_prune_mcp_clients"]) {
    assert.deepEqual(tools[name]!.annotations, destructive, name);
  }
  assert.deepEqual(tools.unw_sign_contract!.annotations, { ...destructive, idempotentHint: true });
  assert.deepEqual(tools.unw_admin_revoke_token!.annotations, { ...destructive, idempotentHint: true });
  assert.deepEqual(tools.unw_remove_proposal_section!.annotations, { ...destructive, idempotentHint: true });
});

test("ordinary writes are closed-world and not read-only", () => {
  const writes = Object.values(tools).filter((tool) => tool.annotations?.readOnlyHint === false);
  assert.ok(writes.length >= 27, `expected the write tools to carry hints, saw ${writes.length}`);
  for (const [name, tool] of Object.entries(tools)) {
    if (tool.annotations?.readOnlyHint !== false) continue;
    assert.equal(typeof tool.annotations.destructiveHint, "boolean", name);
    assert.equal(typeof tool.annotations.openWorldHint, "boolean", name);
  }
  assert.deepEqual(tools.unw_create_proposal!.annotations, { readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  assert.deepEqual(tools.unw_update_proposal_section!.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(tools.unw_agree_part!.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.equal(toolAnnotations("unw_set_tickler")?.idempotentHint, true);
  assert.equal(tools.unw_deliver_reminders!.annotations?.openWorldHint, true);
  assert.equal(tools.unw_send_chat_message!.annotations?.openWorldHint, true);
  assert.equal(tools.unw_send_chat_message!.annotations?.destructiveHint, false);
});

test("section updates stay short and server instructions do not open intake with reminder preferences", () => {
  const description = tools.unw_update_proposal_section!.description ?? "";
  assert.ok(description.length < 600, `description is ${description.length} characters`);
  assert.match(description, /proposals:write/);
  assert.match(description, /narrative/);
  assert.match(description, /Never put hours or price in narrative text/);
  const instructions = (server as unknown as { server: { _instructions?: string } }).server._instructions ?? "";
  assert.equal(instructions, REMINDER_INSTRUCTIONS);
  assert.doesNotMatch(instructions, /before scoping/i);
  assert.doesNotMatch(instructions, /start of a proposal intake/i);
  assert.doesNotMatch(instructions, /unw_set_contact_preference/);
  assert.match(instructions, /unw_set_tickler/);
  assert.match(instructions, /You cannot upload a PDF you generated/);
  assert.match(instructions, /Do not call unw_create_proposal until the client agrees/);
  assert.match(instructions, /editing continues/);
  assert.match(tools.unw_create_proposal!.description ?? "", /only after the client agrees to save/);
  assert.doesNotMatch(tools.unw_set_contact_preference!.description ?? "", /beginning of intake/);
});

test("reminder delivery accepts and forwards a read-only preview request", async (context) => {
  const tool = (server as unknown as { _registeredTools: Record<string, {
    inputSchema: { parse(input: unknown): unknown };
    handler(input: unknown, extra: unknown): Promise<unknown>;
  }> })._registeredTools.unw_deliver_reminders!;
  const input = tool.inputSchema.parse({ dryRun: true, ticklers: false });
  let posted: unknown;
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    posted = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ ok: true, entity: { deliveries: [], sent: 0 }, warnings: [] }), { status: 200 });
  });
  await tool.handler(input, {});
  assert.deepEqual(posted, { dryRun: true, ticklers: false });
});
