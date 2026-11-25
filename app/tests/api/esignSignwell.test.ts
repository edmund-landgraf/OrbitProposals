import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { createHmac, randomUUID } from "node:crypto";

import { esignConfigFromEnv } from "../../server/esign/esignConfig.js";
import { esignUniqueKey, reconcileEsignWebhook, sendContractForEsign } from "../../server/esign/esignService.js";
import { verifySignWellWebhookSignature } from "../../server/esign/providers/signwellWebhook.js";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";

test("esign config defaults disabled + test mode", () => {
  const cfg = esignConfigFromEnv({});
  assert.equal(cfg.provider, "disabled");
  assert.equal(cfg.live, false);
});

test("webhook signature verification is HMAC(type.time)", () => {
  const secret = "signwell-test-secret";
  const event = { event: { type: "document.completed", time: "2026-11-11T12:00:00Z" }, document_id: "doc_123" };
  const expected = createHmac("sha256", secret).update("document.completed.2026-11-11T12:00:00Z").digest("hex");
  assert.equal(verifySignWellWebhookSignature({ secret, headers: { "x-signwell-signature": expected }, event }), true);
  assert.equal(verifySignWellWebhookSignature({ secret, headers: { "x-signwell-signature": "bad" }, event }), false);
});

test("sendContractForEsign is idempotent and forces test_mode from deps", async () => {
  const calls: Array<{ testMode: boolean; uniqueKey: string }> = [];
  const contractId = randomUUID();
  const proposalVersionId = randomUUID();
  const uniqueKey = esignUniqueKey({ provider: "signwell", contractId, proposalVersionId });

  const db: any = {
    contractEsignRequest: {
      findUnique: async ({ where }: any) => (where.uniqueKey === uniqueKey ? db._row : null),
      create: async ({ data }: any) => { db._row = { id: randomUUID(), ...data, updatedAt: new Date(), completedAt: null, cancelledAt: null, createdAt: new Date() }; return db._row; },
      update: async ({ where, data }: any) => { assert.equal(where.id, db._row.id); db._row = { ...db._row, ...data, updatedAt: new Date() }; return db._row; },
    },
    contractEsignArtifact: { createMany: async () => ({ count: 0 }), findMany: async () => [] },
    _row: null as any,
  };

  const adapter: any = {
    provider: "signwell",
    createSigningRequest: async (input: any) => { calls.push({ testMode: input.testMode, uniqueKey: input.uniqueKey }); return { provider: "signwell", providerDocumentId: "sw_1", providerStatus: { status: "sent" } }; },
    getStatus: async () => ({ provider: "signwell", providerDocumentId: "sw_1", status: "sent", providerStatus: {} }),
    downloadCompleted: async () => ({ signedPdf: Buffer.from("%PDF-signed"), auditPdf: Buffer.from("%PDF-audit") }),
    cancel: async () => ({ ok: true }),
  };

  const first = await sendContractForEsign(
    { prisma: db, adapter, provider: "signwell", testMode: true, baseUrl: "https://example.test" },
    { contractId, proposalVersionId, contractTitle: "Contract", pdf: Buffer.from("pdf"), signer: { name: "Client", email: "client@example.com" } },
  );
  assert.equal(first.idempotent, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.testMode, true);

  const second = await sendContractForEsign(
    { prisma: db, adapter, provider: "signwell", testMode: true, baseUrl: "https://example.test" },
    { contractId, proposalVersionId, contractTitle: "Contract", pdf: Buffer.from("pdf"), signer: { name: "Client", email: "client@example.com" } },
  );
  assert.equal(second.idempotent, true);
  assert.equal(calls.length, 1, "should not call provider twice");
});

test("reconcileEsignWebhook fetches provider status before mutating + stores artifacts", async () => {
  const providerDocumentId = "sw_doc_99";
  const contractId = randomUUID();
  const requestId = randomUUID();
  let signCalls = 0;
  const db: any = {
    contractEsignRequest: {
      findFirst: async ({ where }: any) => (where.provider === "signwell" && where.providerDocumentId === providerDocumentId
        ? { id: requestId, contractId, provider: "signwell", providerDocumentId, status: "sent", updatedAt: new Date(), completedAt: null, cancelledAt: null }
        : null),
      update: async ({ data }: any) => ({ id: requestId, contractId, providerDocumentId, status: data.status ?? "sent", updatedAt: new Date(), completedAt: data.completedAt ?? null }),
    },
    contractEsignArtifact: {
      findMany: async () => [],
      createMany: async ({ data }: any) => ({ count: data.length }),
    },
  };

  const adapter: any = {
    provider: "signwell",
    getStatus: async () => ({ provider: "signwell", providerDocumentId, status: "completed", providerStatus: { status: "completed" }, completedAt: new Date("2026-11-11T12:00:00Z") }),
    downloadCompleted: async () => ({ signedPdf: Buffer.from("%PDF-signed"), auditPdf: Buffer.from("%PDF-audit") }),
    createSigningRequest: async () => { throw new Error("not used"); },
    cancel: async () => ({ ok: true }),
  };

  const reconciled = await reconcileEsignWebhook(
    { prisma: db, adapter, provider: "signwell", testMode: true, baseUrl: "https://example.test", signContract: async () => { signCalls += 1; } },
    { providerDocumentId },
  );
  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.status, "completed");
  assert.equal(signCalls, 1, "webhook reconciliation triggers signing via injected helper");
});

test("flag-off behavior: esign endpoints are not exposed (404) when UNWH_ESIGN_PROVIDER is unset", async () => {
  const app = express();
  app.use(express.json());
  const prisma = {} as any;
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
    const response = await fetch(`${origin}/api/v1/contracts/${randomUUID()}/esign/send`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

test("browser callback never marks signed (simple 200 response)", async () => {
  const app = express();
  app.use(express.json());
  const prisma = {} as any;
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
    const response = await fetch(`${origin}/api/v1/esign/signwell/callback`);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /status will update/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

