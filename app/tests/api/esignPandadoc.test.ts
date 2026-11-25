import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createHmac, randomUUID } from "node:crypto";

import { esignConfigFromEnv } from "../../server/esign/esignConfig.js";
import { mapPandaDocStatus } from "../../server/esign/providers/pandadoc.js";
import { pandaDocWebhookDocumentId, verifyPandaDocWebhookSignature } from "../../server/esign/providers/pandadocWebhook.js";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";

test("esign config accepts pandadoc", () => {
  const cfg = esignConfigFromEnv({ UNWH_ESIGN_PROVIDER: "pandadoc" });
  assert.equal(cfg.provider, "pandadoc");
  assert.equal(cfg.live, false);
});

test("PandaDoc status names map onto Unwhelm esign statuses", () => {
  assert.equal(mapPandaDocStatus("document.draft"), "draft");
  assert.equal(mapPandaDocStatus("document.sent"), "sent");
  assert.equal(mapPandaDocStatus("document.viewed"), "sent");
  assert.equal(mapPandaDocStatus("document.completed"), "completed");
  assert.equal(mapPandaDocStatus("document.voided"), "cancelled");
  assert.equal(mapPandaDocStatus("document.declined"), "cancelled");
  assert.equal(mapPandaDocStatus("mystery"), "unknown");
});

test("webhook signature is HMAC-SHA256 of the raw body", () => {
  const secret = "pandadoc-test-secret";
  const rawBody = JSON.stringify([{ event: "document_state_changed", data: { id: "pd_123", status: "document.completed" } }]);
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  assert.equal(verifyPandaDocWebhookSignature({ secret, headers: {}, query: { signature: expected }, rawBody }), true);
  assert.equal(verifyPandaDocWebhookSignature({ secret, headers: { "x-pandadoc-signature": expected }, rawBody }), true);
  assert.equal(verifyPandaDocWebhookSignature({ secret, headers: {}, query: { signature: "bad" }, rawBody }), false);
  assert.equal(pandaDocWebhookDocumentId(JSON.parse(rawBody)), "pd_123");
});

test("browser callback never marks signed (simple 200 response)", async () => {
  const app = express();
  app.use(express.json());
  const prisma = {} as never;
  app.use("/api/v1", createProposalContractRouter({
    prisma,
    authorize: async () => ({ userId: randomUUID(), organizationId: randomUUID(), role: "staff" }),
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/v1/esign/pandadoc/callback`);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /status will update/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
