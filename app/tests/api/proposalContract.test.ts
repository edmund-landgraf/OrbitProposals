import assert from "node:assert/strict";
import test from "node:test";
import { createProposalContractRouter, proposalDocument } from "../../server/routes/proposalContract.js";

test("proposalDocument maps Prisma JSON and relational rows to the exported proposal shape", () => {
  const document = proposalDocument({
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: null,
    ownerId: "22222222-2222-4222-8222-222222222222",
    title: "Website",
    engagement: "fixed_price",
    status: "draft",
    scope: { summary: "Build it", deliverables: ["Site"], assumptions: [], exclusions: [] },
    timeline: { startDate: "2026-01-01", targetDate: "2026-02-01" },
    pricingModel: "fixed_price",
    pricing: { model: "fixed_price", amountMinor: 300000, currency: "USD" },
    version: 2,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    options: [{ id: "33333333-3333-4333-8333-333333333333", proposalId: "11111111-1111-4111-8111-111111111111", label: "Rush", description: "Fast", priceDeltaMinor: 5000, priceCurrency: "USD", selected: false }],
    milestones: [{ id: "44444444-4444-4444-8444-444444444444", proposalId: "11111111-1111-4111-8111-111111111111", title: "Launch", description: "Ship", dueDate: new Date("2026-02-01T00:00:00.000Z") }],
  } as never);

  assert.equal(document.schemaVersion, 1);
  assert.equal(document.pricing.model, "fixed_price");
  assert.equal(document.pricing.amountMinor, 300000);
  assert.equal(document.options[0]?.priceDelta.currency, "USD");
  assert.equal(document.timeline.milestones[0]?.dueDate, "2026-02-01");
});

test("router exposes proposal, public proposal, and contract operations", () => {
  const router = createProposalContractRouter({
    prisma: {} as never,
    authorize: async () => ({ userId: "22222222-2222-4222-8222-222222222222", organizationId: "55555555-5555-4555-8555-555555555555", role: "staff" }),
  });
  const stack = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack;
  const routes = stack.flatMap((layer) => layer.route ? Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route?.path}`) : []);
  assert.deepEqual(routes, [
    "POST /proposals/:id/public-link",
    "DELETE /proposals/:id/public-link",
    "GET /public/proposals/:token",
    "PUT /proposals/:id/sections/:sectionId",
    "PUT /proposals/:id/timeline",
    "POST /proposals/:id/phase-estimates",
    "GET /proposals/:id/roles",
    "PUT /proposals/:id/roles",
    "PUT /proposals/:id/budget",
    "PUT /proposals/:id/options",
    "POST /proposals/:id/options/selection",
    "POST /proposals/:id/review",
    "GET /proposals/:id/export",
    "GET /proposals/:id/redline",
    "GET /proposals/:id/pdf",
    "GET /proposals/:id/attachments",
    "PUT /proposals/:id/attachments/order",
    "POST /proposals/:id/attachments",
    "POST /proposals/:id/attachments/link",
    "POST /proposals/:id/attachments/fetch",
    "POST /proposals/:id/attachments/parts",
    "PUT /proposals/:id/attachments",
    "GET /proposals/:id/attachments/:attachmentId",
    "PUT /proposals/:id/attachments/:attachmentId",
    "DELETE /proposals/:id/attachments/:attachmentId",
    "POST /proposals/import",
    "GET /proposals/:id/commitment-preview",
    "POST /proposals/:id/accept",
    "GET /proposals/:id/acceptance",
    "GET /payment-terms",
    "PATCH /contracts/:id/billing-terms",
    "POST /contracts/:id/retainage/release",
    "GET /contracts",
    "POST /contracts",
    "GET /contracts/:id",
    "GET /contracts/:id/pdf",
    "PATCH /contracts/:id",
    "POST /contracts/:id/sign",
    "POST /contracts/:id/esign/send",
    "GET /contracts/:id/esign/status",
    "GET /contracts/:id/esign/artifacts/:kind",
    "POST /contracts/:id/esign/cancel",
    "POST /esign/signwell/webhook",
    "GET /esign/signwell/callback",
    "POST /esign/pandadoc/webhook",
    "GET /esign/pandadoc/callback",
    "POST /contracts/:id/cancel",
    "GET /contracts/:id/handoff",
  ]);
});
