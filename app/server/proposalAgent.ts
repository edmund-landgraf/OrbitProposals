import { pricing } from "../shared/pricing.js";

export const PROPOSAL_SYSTEM_PROMPT = `You are Unwhelm's proposal agent. Recommend one published engagement, then draft the proposal by calling create_proposal yourself. Quote only these prices:

- Workflow Check $250
- Capped Hours 4h for $550 or 8h for $900
- Fixed Price from $3K
- $175/hr

Workflow Check is up to ${pricing.workflowCheckMinutes / 60} hours on one workflow the client picks: a map of how it works today, the top fixes, and a working prototype or a scoped build plan. If the client goes ahead within ${pricing.workflowCheckCreditDays} days, the fee is credited back. Use engagement "workflow_check" and pricing { "model": "workflow_check", "amountMinor": 25000, "currency": "USD" }.
Capped Hours, 4 hours, is exactly $550. Use engagement "capped_hours_4" and pricing { "model": "capped_hours", "hours": 4, "amountMinor": 55000, "currency": "USD" }.
Capped Hours, 8 hours, is exactly $900. Use engagement "capped_hours_8" and pricing { "model": "capped_hours", "hours": 8, "amountMinor": 90000, "currency": "USD" }.
Fixed Price starts at $3,000. Use engagement "fixed_price" and pricing { "model": "fixed_price", "amountMinor": 300000 or more, "currency": "USD" }.
Hourly ad-hoc work is exactly $175/hr. Use engagement "hourly" and pricing { "model": "hourly", "rateMinor": 17500, "currency": "USD" }.
A proposal has exactly one pricing model. Do not offer several models on one proposal.

create_proposal arguments:
- title: short string
- engagement: workflow_check, capped_hours_4, capped_hours_8, fixed_price, or hourly
- scope: { "summary": string, "deliverables": [string, ...], "assumptions": [string], "exclusions": [string] }
- timeline: { "startDate": "YYYY-MM-DD" or null, "targetDate": "YYYY-MM-DD" or null }
- pricing: the object matching the engagement

Call create_proposal once the engagement and scope are clear enough to draft. Also reply in plain language with the recommendation.
If you are not sure which engagement fits, the scope is too vague to draft, or the price would leave these rules, call escalate with a short reason and do not call create_proposal.
The Workflow Check is a bounded slice. Ask which part of the workflow hurts most or costs the most time. Put only that slice in the check. Park every other request with unw_park_item so it can feed a follow-up proposal, and say that those items are next phases, not part of this check.
Before a locked or agreed item changes, call unw_preview_change_impact and tell the client the sentence it returns, including what reopens and the completion percentage before and after. Then offer to apply it, park it as a later phase, or swap it for something of a similar size. Steer unbounded requests back to a cap, a fixed list, or a dated milestone. Do not apply a change that reopens downstream nodes until the client picks one of those three.`;

export type AgentToolCall =
  | { name: "create_proposal"; arguments: unknown }
  | { name: "escalate"; arguments: { reason: string } };

export type AgentTurn = { content: string; toolCalls: AgentToolCall[] };

export type ProposalDraft = {
  title: string;
  engagement: "workflow_check" | "capped_hours_4" | "capped_hours_8" | "fixed_price" | "hourly";
  scope: { summary: string; deliverables: string[]; assumptions: string[]; exclusions: string[] };
  timeline: Record<string, unknown>;
  pricing: { model: "workflow_check" | "capped_hours" | "fixed_price" | "hourly"; currency: "USD"; amountMinor?: number; hours?: number; rateMinor?: number };
};

type HistoryMessage = { role: "user" | "assistant" | "human" | "system"; content: string };

const tools = [
  {
    type: "function",
    function: {
      name: "create_proposal",
      description: "Save a proposal draft using the published Workflow Check, Capped Hours, or Fixed Price rules.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["title", "engagement", "scope", "timeline", "pricing"],
        properties: {
          title: { type: "string" },
          engagement: { type: "string", enum: ["workflow_check", "capped_hours_4", "capped_hours_8", "fixed_price", "hourly"] },
          scope: { type: "object" },
          timeline: { type: "object" },
          pricing: { type: "object" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate",
      description: "Hand this conversation to a human when the engagement or scope is not clear.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["reason"],
        properties: { reason: { type: "string" } },
      },
    },
  },
];

export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): { baseUrl: string; apiKey: string; model: string } | undefined {
  const apiKey = env.UNWH_MODEL_API_KEY || env.MODEL_API_KEY;
  if (!apiKey) return undefined;
  return {
    apiKey,
    baseUrl: (env.UNWH_MODEL_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, ""),
    model: env.UNWH_MODEL_NAME || "grok-4",
  };
}

export async function completeProposalTurn(
  history: HistoryMessage[],
  config: { baseUrl: string; apiKey: string; model: string },
  fetchImpl: typeof fetch = fetch,
): Promise<AgentTurn> {
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "system", content: PROPOSAL_SYSTEM_PROMPT }, ...history.map((message) => ({ role: message.role === "human" ? "user" : message.role, content: message.content }))],
      tools,
    }),
  });
  if (!response.ok) throw new Error(`Proposal model request failed (${response.status}).`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
  const message = body.choices?.[0]?.message;
  const toolCalls: AgentToolCall[] = [];
  for (const call of message?.tool_calls ?? []) {
    const name = call.function?.name;
    let args: unknown = {};
    try { args = call.function?.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = {}; }
    if (name === "create_proposal") toolCalls.push({ name, arguments: args });
    if (name === "escalate") {
      const reason = args && typeof args === "object" && "reason" in args && typeof (args as { reason: unknown }).reason === "string" ? (args as { reason: string }).reason : "The proposal agent asked for a person.";
      toolCalls.push({ name, arguments: { reason } });
    }
  }
  return { content: message?.content?.trim() ?? "", toolCalls };
}

const ASKS_FOR_HUMAN = /\b(human|person|someone|somebody|staff|call me|phone|talk to|speak to|speak with|talk with|real person|agent please)\b/i;
const QUESTION_WORDS = /^\s*(what|which|how|where|when|who|is|are|do|does|did|can|could|show|list|tell me|status)\b/i;
const PROPOSAL_TOPICS = /\b(part|parts|section|sections|open|left|remaining|status|progress|done|settled|drafted|missing|next|proposal|step|steps)\b/i;

/** True for short questions about the proposal's state that never need a person (and never ask for one). */
export function isInformationalQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 300 || ASKS_FOR_HUMAN.test(trimmed)) return false;
  return (trimmed.endsWith("?") || QUESTION_WORDS.test(trimmed)) && PROPOSAL_TOPICS.test(trimmed);
}

export async function runProposalAgent(input: {
  history: HistoryMessage[];
  userContent: string;
  complete: (history: HistoryMessage[]) => Promise<AgentTurn>;
  createProposal: (draft: unknown) => Promise<{ id: string; title: string }>;
  escalate: (reason: string) => Promise<void>;
  /** When the session already has a proposal: a plain-language answer about it (such as which parts are still open). */
  answerAboutProposal?: () => Promise<string | null>;
}): Promise<{ content: string; proposalId?: string; escalated: boolean }> {
  const history = [...input.history, { role: "user" as const, content: input.userContent }];
  let turn: AgentTurn;
  try {
    turn = await input.complete(history);
  } catch {
    const reason = "The proposal model could not complete a turn.";
    await input.escalate(reason);
    return { content: "I couldn't finish that draft, so I asked a person at Unwhelm to take it from here.", escalated: true };
  }
  const escalateCall = turn.toolCalls.find((call) => call.name === "escalate");
  const createCall = turn.toolCalls.find((call) => call.name === "create_proposal");
  if (escalateCall || !createCall) {
    if (!createCall && turn.content && !escalateCall) return { content: turn.content, escalated: false };
    // A simple question about an existing proposal ("what parts are still open?") is not a reason to hand the chat to a
    // person. Answer it from the proposal instead, unless the client asked for a human.
    if (input.answerAboutProposal && isInformationalQuestion(input.userContent)) {
      const answer = await input.answerAboutProposal();
      if (answer) return { content: answer, escalated: false };
    }
    const reason = escalateCall?.arguments.reason || "The proposal agent was not sure which engagement to recommend.";
    await input.escalate(reason);
    return { content: turn.content || "I'm not sure which engagement fits, so I asked a person at Unwhelm to take a look.", escalated: true };
  }
  try {
    const created = await input.createProposal(createCall.arguments);
    return { content: turn.content || `I recommend this shape and drafted “${created.title}.”`, proposalId: created.id, escalated: false };
  } catch {
    const reason = "The proposal draft did not match the published pricing rules.";
    await input.escalate(reason);
    return { content: "That draft didn't match our published pricing, so I asked a person at Unwhelm to take it from here.", escalated: true };
  }
}
