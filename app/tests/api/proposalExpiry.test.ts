// Pure expiry rules always run. The database half runs when UNWH_DB_TEST=1 and DATABASE_URL are set.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { ExpiryError, enforcedValidUntil, expiryView, extendedValidUntil, isExpired, loadExpiryConfig, type ExpiryConfig } from "../../server/proposalExpiry.js";
import { AcceptError, acceptProposal } from "../../server/proposalAccept.js";
import { loadActiveCatalog } from "../../server/catalog.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";

const config: ExpiryConfig = { defaultValidDays: 30, nearExpiryDays: 7, extendDefaultDays: 14, extendMaxDays: 90, labelActive: "Open", labelExpiring: "Expires soon", labelExpired: "Expired", expiredMessage: "Expired." };
const now = new Date("2026-10-23T12:00:00.000Z");
const days = (count: number) => new Date(now.getTime() + count * 86_400_000);

test("proposals never expire, even when valid_until is in the past", () => {
  assert.equal(enforcedValidUntil(days(-1)), null);
  assert.equal(enforcedValidUntil(null), null);
  assert.equal(isExpired(now, now), false);
  assert.equal(isExpired(days(-1), now), false);
  assert.equal(isExpired(null, now), false);
  const past = expiryView(days(-1), now, config);
  assert.equal(past.state, "none");
  assert.equal(past.validUntil, null);
  assert.equal(past.label, null);
  assert.equal(past.daysRemaining, null);
  assert.equal(expiryView(days(3), now, config).state, "none");
  assert.equal(expiryView(null, now, config).state, "none");
  assert.equal(expiryView(null, now, config).nearExpiryDays, config.nearExpiryDays);
});

test("extension adds to the later of now and the current date and respects the cap", () => {
  assert.equal(extendedValidUntil(days(-5), now, 14, config).toISOString(), days(14).toISOString());
  assert.equal(extendedValidUntil(days(5), now, 14, config).toISOString(), days(19).toISOString());
  assert.throws(() => extendedValidUntil(null, now, 91, config), ExpiryError);
  assert.throws(() => extendedValidUntil(null, now, 0, config), ExpiryError);
});

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;

test("insert leaves valid_until empty and a past valid_until does not block acceptance", { skip: !url && "set UNWH_DB_TEST=1 and DATABASE_URL" }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `expiry-${randomUUID()}@test.invalid`, displayName: "Expiry test" } });
  const organization = await prisma.organization.create({ data: { name: "Expiry test", slug: `expiry-${randomUUID()}` } });
  const created = await prisma.proposal.create({ data: {
    ownerId: owner.id, organizationId: organization.id, title: "Expiry", engagement: "capped_hours_4", pricingModel: "capped_hours",
    scope: { summary: "Map it.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, currency: "USD" },
  } });
  try {
    const stored = await loadExpiryConfig(prisma);
    assert.ok(stored, "migration seeds the config row");
    assert.equal(created.validUntil, null, "insert no longer stamps a deadline");
    await prisma.proposal.update({ where: { id: created.id }, data: { validUntil: new Date(Date.now() - 60_000) } });
    const catalog = await loadActiveCatalog(prisma);
    await assert.rejects(
      acceptProposal(prisma, catalog, { proposalId: created.id, organizationId: organization.id, actorUserId: owner.id, requestId: randomUUID(), method: "POST", path: "/test" }),
      (error: unknown) => error instanceof AcceptError && error.code === "CONFLICT",
    );
  } finally {
    await deleteProposalCascade(prisma, created.id);
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});
