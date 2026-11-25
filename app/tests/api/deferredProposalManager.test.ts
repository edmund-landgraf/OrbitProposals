import assert from "node:assert/strict";
import test from "node:test";
import { remainingApprovals } from "../../server/approvalChain.js";
import { redlineDocx, redlineParts, snapshotText } from "../../server/docxRedline.js";
import { ChargeError, chargeInvoice } from "../../server/invoiceCharge.js";
import { summarizeViews } from "../../server/proposalViews.js";

test("view summary counts people and parts", () => {
  const summary = summarizeViews([
    { viewerId: "a", sectionKey: null },
    { viewerId: "a", sectionKey: "scope" },
    { viewerId: "b", sectionKey: "scope" },
  ]);
  assert.equal(summary.views, 3);
  assert.equal(summary.viewers, 2);
  assert.deepEqual(summary.sections[0], { section: "scope", count: 2 });
});

test("an approval chain blocks until every step is recorded, and an empty chain does not", () => {
  assert.deepEqual(remainingApprovals([]), []);
  const waiting = remainingApprovals([
    { id: "2", sortOrder: 20, label: "Finance", decided: false },
    { id: "1", sortOrder: 10, label: "Sponsor", decided: true },
  ]);
  assert.deepEqual(waiting.map((step) => step.label), ["Finance"]);
});

test("a redline keeps shared words and marks the change", () => {
  const parts = redlineParts("Map the intake.", "Map the intake and billing.");
  assert.equal(parts.some((part) => part.kind === "ins" && part.text.includes("billing")), true);
  assert.equal(parts.some((part) => part.kind === "same" && part.text.includes("Map")), true);
  const docx = redlineDocx(snapshotText({ title: "Before", scope: { summary: "Old" }, pricing: {} }), snapshotText({ title: "After", scope: { summary: "New" }, pricing: {} }));
  assert.equal(docx.subarray(0, 2).toString(), "PK");
  assert.match(docx.toString("utf8"), /w:delText/);
  assert.match(docx.toString("utf8"), /w:ins/);
});

test("a charge refuses card numbers, drafts, and a missing processor", async () => {
  await assert.rejects(() => chargeInvoice({ invoiceId: "i", amountMinor: 100, currency: "USD", status: "sent", paymentMethodId: "4242424242424242" }, async () => ({ processor: "stripe", processorId: "pi" })), (error: unknown) => error instanceof ChargeError && error.status === 422);
  await assert.rejects(() => chargeInvoice({ invoiceId: "i", amountMinor: 100, currency: "USD", status: "draft", paymentMethodId: "pm_card" }, async () => ({ processor: "stripe", processorId: "pi" })), (error: unknown) => error instanceof ChargeError && error.status === 409);
  await assert.rejects(() => chargeInvoice({ invoiceId: "i", amountMinor: 100, currency: "USD", status: "sent", paymentMethodId: "pm_card" }, null), (error: unknown) => error instanceof ChargeError && /configured/.test(error.message));
  const charged = await chargeInvoice({ invoiceId: "i", amountMinor: 100, currency: "USD", status: "overdue", paymentMethodId: "pm_card" }, async () => ({ processor: "stripe", processorId: "pi_1" }));
  assert.equal(charged.processorId, "pi_1");
});
