// Pure pricing rules always run. The database half runs when UNWH_DB_TEST=1 and DATABASE_URL are set.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { copyTitle, duplicatePricing, duplicateProposal } from "../../server/proposalDuplicate.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";

test("same engagement keeps the price, a new engagement waits for staff", () => {
  const source = { engagement: "fixed_price", pricing: { model: "fixed_price", amountMinor: 500000, currency: "USD" } };
  assert.deepEqual(duplicatePricing(source, "fixed_price", { pricingModel: "fixed_price", pendingPriceMessage: "m" }), { changed: false, pricing: source.pricing });
  const changed = duplicatePricing(source, "hourly", { pricingModel: "hourly", pendingPriceMessage: "m" });
  assert.equal(changed.changed, true);
  assert.deepEqual(changed.pricing, { model: "hourly", currency: "USD", pendingStaffPrice: true, message: "m" });
  assert.equal("amountMinor" in (changed.pricing as object), false);
  assert.equal(copyTitle("A", " "), "A");
  assert.equal(copyTitle("A", "B"), "B");
});

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;

test("duplicate copies options, groups and milestones and records lineage", { skip: !url && "set UNWH_DB_TEST=1 and DATABASE_URL" }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `dup-${randomUUID()}@test.invalid`, displayName: "Dup test" } });
  const ids: string[] = [];
  try {
    const source = await prisma.proposal.create({ data: { ownerId: owner.id, title: "Source", engagement: "fixed_price", pricingModel: "fixed_price", status: "draft", scope: { summary: "s", deliverables: [], assumptions: [], exclusions: [] }, timeline: {}, pricing: { model: "fixed_price", amountMinor: 500000, currency: "USD" } } });
    ids.push(source.id);
    const group = await prisma.proposalOptionGroup.create({ data: { proposalId: source.id, name: "G", mode: "single" } });
    await prisma.proposalOption.create({ data: { proposalId: source.id, label: "O", description: "d", priceDeltaMinor: 100, priceCurrency: "USD", groupId: group.id } });
    await prisma.timelineMilestone.create({ data: { proposalId: source.id, title: "M", description: "d" } });

    const same = await duplicateProposal(prisma, { sourceId: source.id, actorUserId: owner.id, reason: "revise" });
    ids.push(same.copy.id);
    assert.equal(same.copy.status, "draft");
    assert.equal(same.pendingStaffPrice, false);
    assert.deepEqual(same.copy.pricing, source.pricing);
    const option = await prisma.proposalOption.findFirstOrThrow({ where: { proposalId: same.copy.id } });
    const copiedGroup = await prisma.proposalOptionGroup.findFirstOrThrow({ where: { proposalId: same.copy.id } });
    assert.equal(option.groupId, copiedGroup.id);
    assert.equal(await prisma.timelineMilestone.count({ where: { proposalId: same.copy.id } }), 1);
    assert.equal((await prisma.proposalLineage.findUniqueOrThrow({ where: { proposalId: same.copy.id } })).sourceProposalId, source.id);

    const changed = await duplicateProposal(prisma, { sourceId: source.id, actorUserId: owner.id, engagement: "hourly" });
    ids.push(changed.copy.id);
    assert.equal(changed.pendingStaffPrice, true);
    assert.equal(changed.copy.pricingModel, "hourly");
    assert.equal((changed.copy.pricing as { pendingStaffPrice?: boolean }).pendingStaffPrice, true);
    assert.equal("amountMinor" in (changed.copy.pricing as object), false);
  } finally {
    for (const id of ids.reverse()) await deleteProposalCascade(prisma, id);
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});
