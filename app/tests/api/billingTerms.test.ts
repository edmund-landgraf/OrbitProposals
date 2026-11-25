import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { dueFromPaymentTerm, overdueStatus, splitRetainage } from "../../server/billingTerms.js";
import { releaseRetainage } from "../../server/proposalAccept.js";
import { seedCatalogFixture } from "../../server/catalog.js";

const migration = readFileSync(new URL("../../prisma/migrations/0023_payment_terms_retainage/migration.sql", import.meta.url), "utf8");

test("payment terms and retainage are database rows with a net 30 default", () => {
  assert.match(migration, /'net_15', 'Net 15', 15, false/);
  assert.match(migration, /'net_30', 'Net 30', 30, true/);
  assert.match(migration, /100000, 'Retainage 10%'/);
  assert.match(migration, /ADD VALUE IF NOT EXISTS 'overdue'/);
});

test("net 30 is thirty UTC days after the anchor, and a sent invoice past that day is overdue", () => {
  assert.equal(dueFromPaymentTerm(new Date("2026-10-23T18:00:00.000Z"), 30).toISOString(), "2026-11-22T00:00:00.000Z");
  assert.equal(overdueStatus("sent", new Date("2026-10-22T00:00:00.000Z"), new Date("2026-10-23T00:00:00.000Z")), "overdue");
  assert.equal(overdueStatus("sent", new Date("2026-10-23T00:00:00.000Z"), new Date("2026-10-23T12:00:00.000Z")), "sent");
  assert.equal(overdueStatus("draft", new Date("2026-01-01T00:00:00.000Z")), "draft");
});

test("retainage withholds the configured percent and a release invoice clears it once", async () => {
  assert.deepEqual(splitRetainage(150_000, 100_000), { netMinor: 135_000, withheldMinor: 15_000 });
  const contractId = randomUUID();
  const organizationId = randomUUID();
  const state = {
    contract: { id: contractId, organizationId, retainageHeldMinor: 15_000, paymentTermId: "term", pricing: { currency: "USD" } },
    invoices: [] as Array<Record<string, unknown>>,
  };
  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    contract: {
      findFirst: async () => state.contract,
      update: async ({ data }: { data: { retainageHeldMinor: number } }) => { state.contract.retainageHeldMinor = data.retainageHeldMinor; return state.contract; },
    },
    paymentTerm: { findUnique: async () => ({ id: "term", days: 15 }), findFirst: async () => ({ id: "term", days: 15 }) },
    invoice: {
      findFirst: async ({ where }: { where: { kind?: string } }) => state.invoices.find((row) => row.kind === where.kind) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: randomUUID(), ...data }; state.invoices.push(row); return row; },
    },
  };
  const first = await releaseRetainage(db as never, seedCatalogFixture(), { contractId, organizationId, now: new Date("2026-10-23T00:00:00.000Z") });
  assert.equal(first.idempotent, false);
  assert.equal(first.invoice.amountMinor, 15_000);
  assert.equal(first.invoice.dueDate, "2026-11-07T00:00:00.000Z");
  assert.equal(state.contract.retainageHeldMinor, 0);
  const second = await releaseRetainage(db as never, seedCatalogFixture(), { contractId, organizationId, now: new Date("2026-10-23T00:00:00.000Z") });
  assert.equal(second.idempotent, true);
  assert.equal(second.invoice.id, first.invoice.id);
  assert.equal(state.invoices.length, 1);
});
