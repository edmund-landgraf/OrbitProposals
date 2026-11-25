// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import {
  CreditError,
  applyOpenCredits,
  creditAmountMinor,
  creditExpiresAt,
  issueWorkflowCheckCredit,
  presentCredit,
  voidCredit,
  type ContractCreditRow,
  type CreditRuleRow,
} from "../../server/credits.js";
import { createCreditsRouter } from "../../server/routes/credits.js";

const organizationId = "55555555-5555-4555-8555-555555555555";
const catalogVersionId = "00000000-0000-4000-8000-000000000001";
const DAY = 86_400_000;

test("v1 seed credits the Workflow Check fee for 30 days at 100 percent", () => {
  const sql = readFileSync(new URL("../../prisma/migrations/0017_workflow_check_credit/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /workflow_check_follow_on/);
  assert.match(sql, /'workflow_check'/);
  assert.match(sql, /\n\s+30,/);
  assert.match(sql, /1000000/);
  assert.match(sql, /'capped_hours'/);
  assert.equal(creditAmountMinor({ creditAmountMinor: null, creditPercentBasis: 1_000_000 }, 25000), 25000);
  assert.equal(creditAmountMinor({ creditAmountMinor: 25000, creditPercentBasis: null }, 999), 25000);
  assert.equal(creditAmountMinor({ creditAmountMinor: null, creditPercentBasis: 500_000 }, 25000), 12500);
  const issued = new Date("2026-06-01T00:00:00.000Z");
  assert.equal(creditExpiresAt(issued, 30).getTime() - issued.getTime(), 30 * DAY);
});

type Invoice = {
  id: string;
  contractId: string;
  amountMinor: number;
  currency: string;
  status: string;
  organizationId: string;
  pricingModel: string;
};

function store(percentBasis = 1_000_000) {
  const rule: CreditRuleRow = {
    id: "00000000-0000-4000-8000-000000000091",
    code: "workflow_check_follow_on",
    sourcePricingModel: "workflow_check",
    sourceTierCode: "workflow_check",
    windowDays: 30,
    creditAmountMinor: null,
    creditPercentBasis: percentBasis,
    currency: "USD",
    targets: [
      { pricingModel: "capped_hours", tierCode: "" },
      { pricingModel: "fixed_price", tierCode: "" },
      { pricingModel: "hourly", tierCode: "" },
    ],
  };
  const credits: ContractCreditRow[] = [];
  const lines: Array<{ id: string; contractId: string; invoiceId: string; amountMinor: number; label: string }> = [];
  const invoices: Invoice[] = [];

  function matchCredit(credit: ContractCreditRow, where: Record<string, unknown>): boolean {
    if (typeof where.id === "string" && credit.id !== where.id) return false;
    if (typeof where.organizationId === "string" && credit.organizationId !== where.organizationId) return false;
    if (typeof where.sourceContractId === "string" && credit.sourceContractId !== where.sourceContractId) return false;
    if (where.sourceContractId && typeof where.sourceContractId === "object" && "not" in where.sourceContractId && credit.sourceContractId === (where.sourceContractId as { not: string }).not) return false;
    if ("redeemedAt" in where && where.redeemedAt === null && credit.redeemedAt !== null) return false;
    if ("voidedAt" in where && where.voidedAt === null && credit.voidedAt !== null) return false;
    const expires = where.expiresAt as { gt?: Date } | undefined;
    if (expires?.gt && credit.expiresAt.getTime() <= expires.gt.getTime()) return false;
    return true;
  }

  const contractCredit = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => credits.find((credit) => matchCredit(credit, where)) ?? null,
    findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { expiresAt?: "asc"; issuedAt?: "desc" } }) => {
      const found = credits.filter((credit) => matchCredit(credit, where));
      if (orderBy?.expiresAt === "asc") found.sort((left, right) => left.expiresAt.getTime() - right.expiresAt.getTime());
      if (orderBy?.issuedAt === "desc") found.sort((left, right) => right.issuedAt.getTime() - left.issuedAt.getTime());
      return found.map((credit) => ({ ...credit, creditRule: rule }));
    },
    create: async ({ data }: { data: ContractCreditRow }) => {
      if (credits.some((credit) => credit.sourceContractId === data.sourceContractId || credit.sourceInvoiceId === data.sourceInvoiceId)) {
        const error = new Error("unique") as Error & { code: string };
        error.code = "P2002";
        throw error;
      }
      const created = { ...data, redeemedAt: null, redeemedInvoiceId: null, voidedAt: null, creditRule: rule };
      credits.push(created);
      return created;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<ContractCreditRow> }) => {
      const matches = credits.filter((credit) => matchCredit(credit, where));
      for (const credit of matches) Object.assign(credit, data);
      return { count: matches.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<ContractCreditRow> }) => {
      const credit = credits.find((item) => item.id === where.id);
      if (!credit) throw new Error("missing");
      Object.assign(credit, data);
      return credit;
    },
  };
  const db = {
    creditRule: {
      findMany: async ({ where }: { where: { catalogVersionId: string; sourcePricingModel?: string } }) => {
        if (where.catalogVersionId !== catalogVersionId) return [];
        if (where.sourcePricingModel && where.sourcePricingModel !== rule.sourcePricingModel) return [];
        return [rule];
      },
    },
    contractCredit,
    billingEntry: {
      create: async ({ data }: { data: { id: string; contractId: string; invoiceId: string; amountMinor: number; label: string } }) => {
        lines.push(data);
        return data;
      },
    },
    invoice: {
      findFirst: async ({ where }: { where: { id: string; contract?: { organizationId: string } } }) => {
        const invoice = invoices.find((item) => item.id === where.id && (!where.contract || item.organizationId === where.contract.organizationId));
        if (!invoice) return null;
        return {
          ...invoice,
          contract: { organizationId: invoice.organizationId, proposal: { pricing: { model: invoice.pricingModel } } },
        };
      },
      update: async ({ where, data }: { where: { id: string }; data: { amountMinor: number } }) => {
        const invoice = invoices.find((item) => item.id === where.id);
        if (!invoice) throw new Error("missing invoice");
        invoice.amountMinor = data.amountMinor;
        return invoice;
      },
    },
    $transaction: async <T>(callback: (transaction: typeof db) => Promise<T>) => callback(db),
    credits,
    lines,
    invoices,
  };
  return db;
}

function addInvoice(db: ReturnType<typeof store>, pricingModel: string, amountMinor: number, status = "draft"): Invoice {
  const invoice: Invoice = {
    id: randomUUID(),
    contractId: randomUUID(),
    amountMinor,
    currency: "USD",
    status,
    organizationId,
    pricingModel,
  };
  db.invoices.push(invoice);
  return invoice;
}

test("issues a credit when a Workflow Check is invoiced and does not issue it twice", async () => {
  const db = store();
  const contractId = randomUUID();
  const invoiceId = randomUUID();
  const issuedAt = new Date("2026-06-01T12:00:00.000Z");
  const first = await issueWorkflowCheckCredit(db, {
    organizationId,
    contractId,
    invoiceId,
    catalogVersionId,
    pricingModel: "workflow_check",
    sourceAmountMinor: 25000,
    currency: "USD",
    now: issuedAt,
  });
  const second = await issueWorkflowCheckCredit(db, {
    organizationId,
    contractId,
    invoiceId,
    catalogVersionId,
    pricingModel: "workflow_check",
    sourceAmountMinor: 25000,
    currency: "USD",
    now: new Date("2026-06-02T00:00:00.000Z"),
  });
  assert.ok(first);
  assert.equal(second?.id, first?.id);
  assert.equal(db.credits.length, 1);
  assert.equal(first?.amountMinor, 25000);
  assert.equal(first?.expiresAt.toISOString(), "2026-07-01T12:00:00.000Z");
  assert.equal(presentCredit(first!, issuedAt).status, "open");
  const ignored = await issueWorkflowCheckCredit(db, {
    organizationId,
    contractId: randomUUID(),
    invoiceId: randomUUID(),
    catalogVersionId,
    pricingModel: "hourly",
    sourceAmountMinor: 17500,
    currency: "USD",
  });
  assert.equal(ignored, null);
});

test("applies an unexpired credit once as a negative line and refuses a second apply", async () => {
  const db = store();
  const sourceContractId = randomUUID();
  const sourceInvoiceId = randomUUID();
  const issued = await issueWorkflowCheckCredit(db, {
    organizationId,
    contractId: sourceContractId,
    invoiceId: sourceInvoiceId,
    catalogVersionId,
    pricingModel: "workflow_check",
    sourceAmountMinor: 25000,
    currency: "USD",
    now: new Date("2026-06-01T00:00:00.000Z"),
  });
  assert.ok(issued);
  const invoice = addInvoice(db, "hourly", 40000);
  const applied = await applyOpenCredits(db, {
    organizationId,
    contractId: invoice.contractId,
    invoiceId: invoice.id,
    pricingModel: "hourly",
    currency: "USD",
    amountMinor: invoice.amountMinor,
    now: new Date("2026-06-15T00:00:00.000Z"),
  });
  assert.equal(applied.amountMinor, 15000);
  assert.equal(invoice.amountMinor, 15000);
  assert.equal(db.lines.length, 1);
  assert.equal(db.lines[0]?.amountMinor, -25000);
  assert.equal(issued.redeemedInvoiceId, invoice.id);
  assert.ok(issued.redeemedAt);
  await assert.rejects(
    () => applyOpenCredits(db, {
      organizationId,
      contractId: invoice.contractId,
      invoiceId: invoice.id,
      pricingModel: "hourly",
      currency: "USD",
      amountMinor: 15000,
      creditId: issued.id,
      now: new Date("2026-06-16T00:00:00.000Z"),
    }),
    (error: unknown) => error instanceof CreditError && error.statusCode === 409,
  );
  assert.equal(db.lines.length, 1);
  const later = addInvoice(db, "fixed_price", 150000);
  const again = await applyOpenCredits(db, {
    organizationId,
    contractId: later.contractId,
    invoiceId: later.id,
    pricingModel: "fixed_price",
    currency: "USD",
    amountMinor: later.amountMinor,
    now: new Date("2026-06-20T00:00:00.000Z"),
  });
  assert.equal(again.applied.length, 0);
  assert.equal(later.amountMinor, 150000);
});

test("does not apply an expired credit", async () => {
  const db = store();
  const issued = await issueWorkflowCheckCredit(db, {
    organizationId,
    contractId: randomUUID(),
    invoiceId: randomUUID(),
    catalogVersionId,
    pricingModel: "workflow_check",
    sourceAmountMinor: 25000,
    currency: "USD",
    now: new Date("2026-05-01T00:00:00.000Z"),
  });
  assert.ok(issued);
  const invoice = addInvoice(db, "capped_hours", 55000);
  const after = new Date("2026-06-01T00:00:00.000Z");
  const skipped = await applyOpenCredits(db, {
    organizationId,
    contractId: invoice.contractId,
    invoiceId: invoice.id,
    pricingModel: "capped_hours",
    currency: "USD",
    amountMinor: 55000,
    now: after,
  });
  assert.equal(skipped.applied.length, 0);
  assert.equal(invoice.amountMinor, 55000);
  assert.equal(issued.redeemedAt, null);
  assert.equal(presentCredit(issued, after).status, "expired");
  await assert.rejects(
    () => applyOpenCredits(db, {
      organizationId,
      contractId: invoice.contractId,
      invoiceId: invoice.id,
      pricingModel: "capped_hours",
      currency: "USD",
      amountMinor: 55000,
      creditId: issued.id,
      now: after,
    }),
    (error: unknown) => error instanceof CreditError && error.message.includes("expired"),
  );
});

test("staff can list, apply, and void credits, and other roles cannot", async () => {
  const db = store();
  const issued = await issueWorkflowCheckCredit(db, {
    organizationId,
    contractId: randomUUID(),
    invoiceId: randomUUID(),
    catalogVersionId,
    pricingModel: "workflow_check",
    sourceAmountMinor: 25000,
    currency: "USD",
    now: new Date(),
  });
  assert.ok(issued);
  const invoice = addInvoice(db, "fixed_price", 300000);
  const userId = randomUUID();
  const staff = { userId, organizationId, role: "staff" as const, scopes: ["billing:read", "billing:write"] };
  const app = express();
  app.use(express.json());
  let identity: typeof staff | { userId: string; organizationId: string; role: "client"; scopes: string[] } | null = staff;
  app.use("/api/v1", createCreditsRouter({ prisma: db as never, authorize: () => identity }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  const origin = `http://127.0.0.1:${address.port}`;
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${origin}/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as { ok: boolean; entity?: { items?: Array<{ id: string }>; status?: string; amount?: { amountMinor: number } } } };
  };
  try {
    identity = { userId, organizationId, role: "client", scopes: ["billing:read", "billing:write"] };
    assert.equal((await call("/credits")).status, 403);
    identity = { ...staff, scopes: ["admin"] };
    assert.equal((await call("/credits")).status, 200);
    identity = { ...staff, scopes: ["billing:read"] };
    assert.equal((await call("/credits")).status, 200);
    identity = { ...staff, scopes: ["billing:read"] };
    assert.equal((await call(`/credits/${issued.id}/void`, "POST", {})).status, 403);
    identity = staff;
    const listed = await call("/credits");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.entity?.items?.[0]?.id, issued.id);
    const applied = await call(`/credits/${issued.id}/apply`, "POST", { invoiceId: invoice.id });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.entity?.amount?.amountMinor, 275000);
    const twice = await call(`/credits/${issued.id}/apply`, "POST", { invoiceId: invoice.id });
    assert.equal(twice.status, 409);
    const blocked = await call(`/credits/${issued.id}/void`, "POST", {});
    assert.equal(blocked.status, 409);
    const fresh = await issueWorkflowCheckCredit(db, {
      organizationId,
      contractId: randomUUID(),
      invoiceId: randomUUID(),
      catalogVersionId,
      pricingModel: "workflow_check",
      sourceAmountMinor: 25000,
      currency: "USD",
      now: new Date(),
    });
    assert.ok(fresh);
    const voided = await call(`/credits/${fresh.id}/void`, "POST", {});
    assert.equal(voided.status, 200);
    assert.equal(voided.body.entity?.status, "void");
    const next = addInvoice(db, "hourly", 17500);
    await assert.rejects(
      () => applyOpenCredits(db, {
        organizationId,
        contractId: next.contractId,
        invoiceId: next.id,
        pricingModel: "hourly",
        currency: "USD",
        amountMinor: next.amountMinor,
        creditId: fresh.id,
      }),
      (error: unknown) => error instanceof CreditError && error.message.includes("void"),
    );
    assert.equal(next.amountMinor, 17500);
    await assert.rejects(() => voidCredit(db, fresh.id, organizationId), (error: unknown) => error instanceof CreditError && error.statusCode === 409);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
