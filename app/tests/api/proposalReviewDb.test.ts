// Runs against a real Postgres when DATABASE_URL is set (CI starts one and applies migrations).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { applyTransition } from "../../server/proposalReview.js";
import { prismaReviewStore } from "../../server/proposalReviewStore.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";

// Opt-in so other runners that import every *.test.ts (e.g. Playwright smoke) do not hit the database.
const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;

test("submit and every review transition keep Proposal.status in step with the review state", { skip: !url && "set UNWH_DB_TEST=1 and DATABASE_URL" }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `review-${randomUUID()}@test.invalid`, displayName: "Review test" } });
  const created = await prisma.proposal.create({ data: {
    ownerId: owner.id, title: "Status sync", engagement: "capped_hours_4", pricingModel: "capped_hours",
    scope: { summary: "Map the intake workflow.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, currency: "USD" },
  } });
  try {
    const mapping = new Map((await prisma.proposalReviewStatus.findMany()).map((row) => [row.code, row.recordStatus]));
    assert.equal(mapping.get("in_review"), "pending_approval");
    const store = prismaReviewStore(prisma);
    const expectSync = async (state: string) => {
      const row = await prisma.proposal.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(row.reviewState, state);
      assert.equal(row.status, mapping.get(state));
    };
    const submitted = await applyTransition(store, { proposalId: created.id, actorId: owner.id, actorRole: "agent", toStatus: "agent_review" });
    assert.equal(submitted.version?.number, 1);
    await expectSync("agent_review");
    await applyTransition(store, { proposalId: created.id, actorId: owner.id, actorRole: "agent", toStatus: "in_review" });
    await expectSync("in_review");
    await applyTransition(store, { proposalId: created.id, actorId: owner.id, actorRole: "staff", toStatus: "changes_requested", commentBody: "Bound it.", commentType: "pushback" });
    await expectSync("changes_requested");
    await applyTransition(store, { proposalId: created.id, actorId: owner.id, actorRole: "client", toStatus: "client_revising" });
    await expectSync("client_revising");
    const resubmitted = await applyTransition(store, { proposalId: created.id, actorId: owner.id, actorRole: "client", toStatus: "resubmitted" });
    assert.equal(resubmitted.version?.number, 2);
    await expectSync("resubmitted");
    const events = await prisma.proposalReviewEvent.count({ where: { proposalId: created.id } });
    assert.equal(events, 5);
  } finally {
    const result = await deleteProposalCascade(prisma, created.id);
    assert.notEqual(result, "has_contract");
    assert.equal(await prisma.proposalVersion.count({ where: { proposalId: created.id } }), 0);
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});
