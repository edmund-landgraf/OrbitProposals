// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";

const organizationId = "55555555-5555-4555-8555-555555555555";
const userId = "22222222-2222-4222-8222-222222222222";
const usd = "USD";

type StoredEntry = { id: string; contractId: string; label: string; percent: string; amountMinor: number; currency: string; dueOn: null; trigger: string; milestoneId: string | null; invoiceId: string | null };
type Token = {
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  userId: string;
  scopes: unknown;
  client: { organizationId: string | null };
  user: { memberships: Array<{ status: string; role: "client" | "staff"; organizationId: string }> } | null;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("session sign stays open, and a bearer token must include contracts:write", async () => {
  const contracts = new Map<string, { id: string; organizationId: string; status: string; signedAt: Date | null; billing: unknown; proposal: { pricing: unknown }; proposalId: string; terms: string; createdAt: Date; updatedAt: Date }>();
  const entries: StoredEntry[] = [];
  const tokens = new Map<string, Token>();
  const writable = "token-with-contracts-write";
  const readable = "token-without-contracts-write";
  const expired = "expired-token";
  tokens.set(hash(writable), {
    tokenHash: hash(writable), revokedAt: null, expiresAt: null, userId, scopes: ["contracts:write"],
    client: { organizationId }, user: { memberships: [{ status: "active", role: "client", organizationId }] },
  });
  tokens.set(hash(readable), {
    tokenHash: hash(readable), revokedAt: null, expiresAt: null, userId, scopes: ["billing:read"],
    client: { organizationId }, user: { memberships: [{ status: "active", role: "client", organizationId }] },
  });
  tokens.set(hash(expired), {
    tokenHash: hash(expired), revokedAt: null, expiresAt: new Date(Date.now() - 60_000), userId, scopes: ["contracts:write"],
    client: { organizationId }, user: { memberships: [{ status: "active", role: "client", organizationId }] },
  });

  const view = (id: string) => {
    const contract = contracts.get(id);
    if (!contract) return null;
    return { ...contract, entries: entries.filter((entry) => entry.contractId === id).map((entry) => ({ ...entry })), proposal: contract.proposal };
  };
  const db = {
    membership: {
      findUnique: async () => ({ organizationId, role: "client" as const, status: "active" }),
      findFirst: async () => ({ organizationId, role: "client" as const, status: "active" }),
    },
    mcpToken: {
      findFirst: async ({ where }: { where: { tokenHash: string } }) => {
        const token = tokens.get(where.tokenHash);
        if (!token || token.revokedAt) return null;
        if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return null;
        return token;
      },
    },
    contract: {
      findFirstOrThrow: async ({ where }: { where: { id: string; organizationId?: string } }) => {
        const contract = view(where.id);
        if (!contract || (where.organizationId && contract.organizationId !== where.organizationId)) throw Object.assign(new Error("not found"), { code: "P2025" });
        return contract;
      },
      update: async ({ where, data }: { where: { id: string }; data: { status?: string; signedAt?: Date; billing?: unknown } }) => {
        const contract = contracts.get(where.id);
        if (!contract) throw Object.assign(new Error("not found"), { code: "P2025" });
        if (data.status) contract.status = data.status;
        if (data.signedAt instanceof Date) contract.signedAt = data.signedAt;
        if (data.billing !== undefined) contract.billing = data.billing;
        return view(where.id);
      },
    },
    billingEntry: {
      createMany: async ({ data }: { data: StoredEntry[] }) => {
        entries.push(...data.map((entry) => ({ ...entry, milestoneId: entry.milestoneId ?? null, invoiceId: entry.invoiceId ?? null })));
        return { count: data.length };
      },
      updateMany: async ({ where, data }: { where: { id: { in: string[] }; invoiceId: null }; data: { invoiceId: string } }) => {
        let count = 0;
        for (const entry of entries) {
          if (!where.id.in.includes(entry.id) || entry.invoiceId !== null) continue;
          entry.invoiceId = data.invoiceId;
          count += 1;
        }
        return { count };
      },
    },
    invoice: {
      create: async ({ data }: { data: { contractId: string; amountMinor: number; currency: string; dueDate: Date; status?: string } }) => ({
        id: randomUUID(), ...data, status: data.status ?? "draft", paidAt: null, createdAt: new Date(),
      }),
    },
    $transaction: async <T>(callback: (transaction: typeof db) => Promise<T>) => callback({ ...db, $queryRawUnsafe: async () => [] }),
  };

  function addContract() {
    const id = randomUUID();
    const now = new Date("2026-04-01T00:00:00.000Z");
    contracts.set(id, {
      id, proposalId: randomUUID(), organizationId, status: "draft", terms: "Terms", billing: {}, signedAt: null, createdAt: now, updatedAt: now,
      proposal: { pricing: { model: "workflow_check", amountMinor: 25_000, currency: usd } },
    });
    return id;
  }

  const app = express();
  app.use(express.json());
  app.use((request: Request, _response: Response, next: NextFunction) => {
    const sessionUser = request.header("x-user-id");
    if (sessionUser) Object.assign(request, { session: { userId: sessionUser, organizationId } });
    next();
  });
  app.use("/api/v1", createProposalContractRouter({ prisma: db as never }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  const origin = `http://127.0.0.1:${address.port}`;
  const sign = async (id: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${origin}/api/v1/contracts/${id}/sign`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
    return { status: response.status, body: await response.json() as { ok: boolean; code?: string; message?: string; changed?: boolean; entity?: { status?: string; entries?: unknown[] } } };
  };

  try {
    const sessionId = addContract();
    const session = await sign(sessionId, { "x-user-id": userId });
    assert.equal(session.status, 200);
    assert.equal(session.body.changed, true);
    assert.equal(session.body.entity?.status, "signed");
    assert.equal(session.body.entity?.entries?.length, 1);
    assert.equal(entries.filter((entry) => entry.contractId === sessionId).length, 1);

    const deniedId = addContract();
    const denied = await sign(deniedId, { authorization: `Bearer ${readable}`, "x-user-id": userId });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "SCOPE_REQUIRED");
    assert.match(denied.body.message ?? "", /contracts:write/);
    assert.equal(entries.some((entry) => entry.contractId === deniedId), false);
    assert.equal(contracts.get(deniedId)?.status, "draft");

    const missing = await sign(addContract(), { authorization: "Bearer not-a-known-token" });
    assert.equal(missing.status, 401);
    assert.equal(missing.body.code, "AUTH_REQUIRED");

    const stale = await sign(addContract(), { authorization: `Bearer ${expired}` });
    assert.equal(stale.status, 401);
    assert.equal(stale.body.code, "AUTH_REQUIRED");

    const allowedId = addContract();
    const allowed = await sign(allowedId, { authorization: `Bearer ${writable}` });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.changed, true);
    assert.equal(entries.filter((entry) => entry.contractId === allowedId).length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
