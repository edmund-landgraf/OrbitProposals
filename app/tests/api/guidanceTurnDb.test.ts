import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test, { describe } from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";
import { createChatProposalReadRouter } from "../../server/routes/chatProposalRead.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";
import { pauseIdleMinutes, rankMatchingRules, type SignalMap } from "../../server/guidancePlaybook.js";
import type { AgentTurn } from "../../server/proposalAgent.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type Envelope<T> = { ok: boolean; entity: T };
type Move = { ruleKey: string; move: string; clientPhrase: string };
type Progress = { guidance?: { eventId: string; turnIndex: number; signals: SignalMap; suggestedMoves: Move[]; recorded: boolean } };

describe("guidance turns against the seeded playbook", { skip, concurrency: 1 }, () => {
  test("seeded rules match the situations their conditions describe", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    try {
      const rules = await prisma.guidanceRule.findMany();
      const zero: SignalMap = { completion_delta: 0, nodes_reopened: 0, turns_without_progress: 0, unsure_count: 0, unbounded_flags: 0, scope_growth_pct: 0, idle_minutes: 0, parked_count: 0 };
      const keys = (over: Partial<SignalMap>, triggers: string[]) => rankMatchingRules(rules, { ...zero, ...over }, triggers).map((rule) => rule.key);
      const grown = keys({ scope_growth_pct: 25, completion_delta: -1 }, ["turn"]);
      assert.equal(grown[0], "scope_growth_drop_explain");
      assert.ok(grown.includes("scope_growth_drop_park"));
      assert.deepEqual(keys({ turns_without_progress: 6 }, ["turn"]), ["stuck_handoff"]);
      assert.deepEqual(keys({ turns_without_progress: 5 }, ["turn"]), []);
      assert.deepEqual(keys({ unsure_count: 2 }, ["turn"]), ["unsure_handoff"]);
      assert.deepEqual(keys({ nodes_reopened: 2 }, ["node_changed"]), ["reopened_offer_swap"]);
      assert.deepEqual(keys({ idle_minutes: 15 }, ["pause"]), ["idle_tickler"]);
      assert.deepEqual(keys({ unbounded_flags: 1 }, ["turn"]), ["unbounded_priority"]);
      assert.deepEqual(keys({}, ["resume"]), ["resume_summary"]);
      assert.equal(pauseIdleMinutes(rules), 15);
    } finally {
      await prisma.$disconnect();
    }
  });

  test("a progress turn writes a session event, injects seeded moves, and a handoff stamps the action", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const owner = await prisma.user.create({ data: { email: `guidance-turn-${randomUUID()}@test.invalid`, displayName: "Guidance turn" } });
    const proposal = await prisma.proposal.create({ data: {
      ownerId: owner.id, title: "Guidance turn", engagement: "capped_hours_4", pricingModel: "capped_hours",
      scope: { summary: "Map the intake workflow.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, amountMinor: 80000, currency: "USD" },
    } });
    const app = express();
    app.use(express.json());
    app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
    app.use((request, _response, next) => { request.session.userId = owner.id; next(); });
    app.use("/api/v1", createProposalCompletionRouter({
      prisma,
      authorize: async () => ({ userId: owner.id, isAdmin: false, scopes: ["proposals:read", "proposals:write"] }),
    }));
    const histories: Array<Array<{ role: string; content: string }>> = [];
    app.use("/api/v1", createChatProposalReadRouter({
      prisma,
      proposalModel: async (history) => {
        histories.push(history);
        return { content: "Here is the next step.", toolCalls: [] } satisfies AgentTurn;
      },
    }));
    const server = app.listen(0);
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v1`;
    const sessionId = `agent:${owner.id}:${proposal.id}`;
    const call = async <T>(path: string, method = "GET", body?: unknown) => {
      const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() as Envelope<T> };
    };
    try {
      await call(`/proposals/${proposal.id}/completion`);
      await prisma.proposalNode.updateMany({ where: { proposalId: proposal.id }, data: { stateCode: "agreed" } });
      const opened = await call<Progress>(`/proposals/${proposal.id}/progress`);
      assert.equal(opened.status, 200);
      assert.equal(opened.body.entity.guidance?.recorded, true);
      const first = await prisma.guidanceSessionEvent.findUniqueOrThrow({ where: { id: opened.body.entity.guidance!.eventId } });
      assert.equal(first.sessionId, sessionId);
      assert.equal(first.turnIndex, 1);

      const chat = await prisma.chatSession.create({ data: { agent: "proposal", proposalId: proposal.id, ownerId: owner.id } });
      const reply = await call<{ reply: { content: string } }>(`/chat/sessions/${chat.id}/messages`, "POST", { content: "Where are we?" });
      assert.equal(reply.status, 201);

      await prisma.proposalNode.updateMany({ where: { proposalId: proposal.id, key: { in: ["scope", "hours", "price", "milestones"] } }, data: { stateCode: "needs_review" } });
      const before = await prisma.proposalNode.count({ where: { proposalId: proposal.id } });
      const extras = Math.max(3, Math.ceil(before * 0.25));
      await prisma.proposalNode.createMany({ data: Array.from({ length: extras }, (_, index) => ({
        proposalId: proposal.id, key: `extra_${index}`, kind: "section", title: `Extra ${index}`, clientLabel: `extra ${index}`, stateCode: "open", sortOrder: 200 + index,
      })) });
      // A plain read previews fresh guidance but does not write a turn.
      const peek = await call<Progress>(`/proposals/${proposal.id}/progress`);
      assert.equal(peek.body.entity.guidance?.recorded, false);
      assert.equal(peek.body.entity.guidance?.eventId, first.id);
      assert.equal(peek.body.entity.guidance?.suggestedMoves[0]?.ruleKey, "scope_growth_drop_explain");
      assert.equal(await prisma.guidanceSessionEvent.count({ where: { proposalId: proposal.id, sessionId } }), 1);
      const dropped = await call<Progress>(`/proposals/${proposal.id}/progress?recordTurn=true`);
      const moves = dropped.body.entity.guidance?.suggestedMoves ?? [];
      assert.equal(moves[0]?.ruleKey, "scope_growth_drop_explain");
      assert.ok(moves.some((move) => move.ruleKey === "scope_growth_drop_park"));
      const second = await prisma.guidanceSessionEvent.findUniqueOrThrow({ where: { id: dropped.body.entity.guidance!.eventId } });
      assert.equal(second.turnIndex, 2);

      const seen = await call<Progress>(`/proposals/${proposal.id}/progress?markSeen=true`);
      assert.equal(seen.body.entity.guidance?.recorded, false);
      assert.equal(seen.body.entity.guidance?.eventId, second.id);

      const handoff = await call(`/proposals/${proposal.id}/handoff`, "POST", { reasonCode: "scope_unbounded", note: "It keeps growing" });
      assert.equal(handoff.status, 200);
      const stamped = await prisma.guidanceSessionEvent.findUniqueOrThrow({ where: { id: second.id } });
      assert.equal(stamped.actionTaken, "handoff");
      assert.equal(stamped.chosenMove, "recommend_handoff");

      const listed = await call<{ items: Array<{ id: string; actionTaken: string | null; suggestedMoves: Move[] }> }>(`/proposals/${proposal.id}/guidance-events`);
      assert.equal(listed.status, 200);
      assert.equal(listed.body.entity.items[0]?.id, second.id);
      assert.equal(listed.body.entity.items[0]?.suggestedMoves[0]?.ruleKey, "scope_growth_drop_explain");

      const again = await call(`/chat/sessions/${chat.id}/messages`, "POST", { content: "And now?" });
      assert.equal(again.status, 201);
      const injected = histories[1]!.find((message) => message.role === "system");
      assert.ok(injected);
      assert.match(injected!.content, /Do not set hours or price/);
      assert.match(injected!.content, /explain_drop/);
    } finally {
      server.close();
      await deleteProposalCascade(prisma, proposal.id).catch(() => undefined);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  });

  test("six turns without progress fire the seeded stuck_handoff rule", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const owner = await prisma.user.create({ data: { email: `guidance-stuck-${randomUUID()}@test.invalid`, displayName: "Stuck" } });
    const proposal = await prisma.proposal.create({ data: {
      ownerId: owner.id, title: "Stuck", engagement: "capped_hours_4", pricingModel: "capped_hours",
      scope: { summary: "Map the intake workflow.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, amountMinor: 80000, currency: "USD" },
    } });
    const app = express();
    app.use(express.json());
    app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
    app.use((request, _response, next) => { request.session.userId = owner.id; next(); });
    app.use("/api/v1", createProposalCompletionRouter({ prisma }));
    const server = app.listen(0);
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const sessionId = `stuck-${randomUUID()}`;
    try {
      await prisma.guidanceSessionEvent.createMany({ data: [1, 2, 3, 4, 5].map((turnIndex) => ({
        proposalId: proposal.id, sessionId, turnIndex, completionBefore: 0, completionAfter: 0, signals: { turns_without_progress: turnIndex },
      })) });
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/proposals/${proposal.id}/progress?recordTurn=true`, { headers: { "x-unw-guidance-session": sessionId } });
      const body = await response.json() as Envelope<Progress>;
      assert.equal(response.status, 200);
      assert.equal(body.entity.guidance?.signals.turns_without_progress, 6);
      assert.equal(body.entity.guidance?.suggestedMoves[0]?.ruleKey, "stuck_handoff");
      const event = await prisma.guidanceSessionEvent.findFirstOrThrow({ where: { sessionId, turnIndex: 6 } });
      const rule = await prisma.guidanceRule.findUniqueOrThrow({ where: { key: "stuck_handoff" } });
      assert.ok(event.firedRuleIds.includes(rule.id));
    } finally {
      server.close();
      await deleteProposalCascade(prisma, proposal.id).catch(() => undefined);
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
      await prisma.$disconnect();
    }
  });
});
