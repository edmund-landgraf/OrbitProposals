// Pure consult rules always run. The database half runs when UNWH_DB_TEST=1 and DATABASE_URL are set.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { ConsultError, consultPricing, consultTitle, createConsultIntake, limitReached, type ConsultOfferingRow } from "../../server/freeConsult.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";

const offering: ConsultOfferingRow = { code: "c", label: "Consult", description: "d", engagement: "fixed_price", pricingModel: "fixed_price", amountMinor: 0, currency: "USD", durationMinutes: 30, perClientLimit: 1, limitScope: "organization", proposalTitleTemplate: "Free consult: {topic}", limitMessage: "Used.", active: true };

test("title, price and limit come from the offering row", () => {
  assert.equal(consultTitle(offering.proposalTitleTemplate, "Invoices"), "Free consult: Invoices");
  assert.deepEqual(consultPricing(offering), { model: "fixed_price", amountMinor: 0, currency: "USD", offering: "c" });
  assert.equal(limitReached(offering, 0), false);
  assert.equal(limitReached(offering, 1), true);
  assert.equal(limitReached({ perClientLimit: null }, 99), false);
});

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;

test("an intake creates a $0 draft proposal and the second one per client is refused", { skip: !url && "set UNWH_DB_TEST=1 and DATABASE_URL" }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `consult-${randomUUID()}@test.invalid`, displayName: "Consult test" } });
  const organization = await prisma.organization.create({ data: { name: "Consult test", slug: `consult-${randomUUID()}` } });
  const proposals: string[] = [];
  try {
    const seeded = await prisma.consultOffering.findUniqueOrThrow({ where: { code: "free_consult" } });
    assert.equal(seeded.amountMinor, 0);
    const first = await createConsultIntake(prisma, { topic: "Invoices", details: "We retype invoices.", userId: owner.id, organizationId: organization.id, defaultOfferingCode: "free_consult" });
    proposals.push(first.proposal.id);
    assert.equal(first.proposal.status, "draft");
    assert.equal(first.proposal.pricingModel, seeded.pricingModel);
    assert.deepEqual(first.proposal.pricing, { model: seeded.pricingModel, amountMinor: 0, currency: seeded.currency, offering: "free_consult" });
    assert.equal(first.intake.scheduledAt, null);
    assert.equal(first.intake.bookingReference, null);
    await assert.rejects(
      createConsultIntake(prisma, { topic: "Again", userId: owner.id, organizationId: organization.id, defaultOfferingCode: "free_consult" }),
      (error: unknown) => error instanceof ConsultError && error.code === "LIMIT_REACHED" && error.message === seeded.limitMessage,
    );
    assert.equal(await prisma.consultIntake.count({ where: { organizationId: organization.id } }), 1);
  } finally {
    for (const id of proposals) await deleteProposalCascade(prisma, id);
    assert.equal(await prisma.consultIntake.count({ where: { organizationId: organization.id } }), 0);
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});
