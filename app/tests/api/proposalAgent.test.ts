import assert from "node:assert/strict";
import { test } from "node:test";
import { PROPOSAL_SYSTEM_PROMPT, completeProposalTurn, runProposalAgent } from "../../server/proposalAgent.js";

test("system prompt carries the published prices", () => {
  assert.match(PROPOSAL_SYSTEM_PROMPT, /Workflow Check \$250/);
  assert.match(PROPOSAL_SYSTEM_PROMPT, /Capped Hours 4h for \$550 or 8h for \$900/);
  assert.match(PROPOSAL_SYSTEM_PROMPT, /Fixed Price from \$3K/);
  assert.match(PROPOSAL_SYSTEM_PROMPT, /\$175\/hr/);
  assert.match(PROPOSAL_SYSTEM_PROMPT, /create_proposal/);
  assert.match(PROPOSAL_SYSTEM_PROMPT, /escalate/);
});

test("a clear recommendation drafts by calling create_proposal", async () => {
  const drafts: unknown[] = [];
  const outcome = await runProposalAgent({
    history: [],
    userContent: "We need a short workflow review of our intake form.",
    complete: async () => ({
      content: "Workflow Check fits this.",
      toolCalls: [{ name: "create_proposal", arguments: { title: "Intake workflow check", engagement: "workflow_check" } }],
    }),
    createProposal: async (draft) => { drafts.push(draft); return { id: "11111111-1111-1111-1111-111111111111", title: "Intake workflow check" }; },
    escalate: async () => { throw new Error("should not escalate"); },
  });
  assert.equal(outcome.escalated, false);
  assert.equal(outcome.proposalId, "11111111-1111-1111-1111-111111111111");
  assert.equal(drafts.length, 1);
  assert.match(outcome.content, /Workflow Check/);
});

test("uncertainty escalates and does not draft", async () => {
  let reason = "";
  const outcome = await runProposalAgent({
    history: [],
    userContent: "Something with AI, maybe.",
    complete: async () => ({ content: "", toolCalls: [{ name: "escalate", arguments: { reason: "Scope is too vague to choose an engagement." } }] }),
    createProposal: async () => { throw new Error("should not draft"); },
    escalate: async (value) => { reason = value; },
  });
  assert.equal(outcome.escalated, true);
  assert.equal(outcome.proposalId, undefined);
  assert.equal(reason, "Scope is too vague to choose an engagement.");
});

test("a draft that breaks pricing escalates", async () => {
  let reason = "";
  const outcome = await runProposalAgent({
    history: [],
    userContent: "Build the whole platform.",
    complete: async () => ({ content: "Fixed price.", toolCalls: [{ name: "create_proposal", arguments: { pricing: { amountMinor: 1 } } }] }),
    createProposal: async () => { throw new Error("INVALID_DRAFT"); },
    escalate: async (value) => { reason = value; },
  });
  assert.equal(outcome.escalated, true);
  assert.match(reason, /published pricing/);
});

test("completeProposalTurn reads create_proposal tool calls", async () => {
  const turn = await completeProposalTurn([{ role: "user", content: "Review our intake." }], { baseUrl: "https://model.test/v1", apiKey: "test", model: "grok-4" }, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.messages[0].content, PROPOSAL_SYSTEM_PROMPT);
    assert.equal(body.tools[0].function.name, "create_proposal");
    return new Response(JSON.stringify({ choices: [{ message: { content: "Workflow Check.", tool_calls: [{ function: { name: "create_proposal", arguments: "{\"title\":\"Intake\"}" } }] } }] }), { status: 200 });
  });
  assert.equal(turn.toolCalls[0]?.name, "create_proposal");
  assert.deepEqual(turn.toolCalls[0]?.arguments, { title: "Intake" });
});
