// Client contracts:write is sign-only, and only for a contract the caller is a party to.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";
import { connectorTokenScopes } from "../../server/connectorScopes.js";
import { publicMcpScopes } from "../../server/catalog.js";

const ownOrg = "55555555-5555-4555-8555-555555555555";
const otherOrg = "66666666-6666-4666-8666-666666666666";
const clientId = "22222222-2222-4222-8222-222222222222";
const colleagueId = "33333333-3333-4333-8333-333333333333";
const outsiderId = "44444444-4444-4444-8444-444444444444";
const staffId = "77777777-7777-4777-8777-777777777777";

type Membership = { userId: string; organizationId: string; role: "client" | "staff"; status: "active" };
type StoredEntry = { id: string; contractId: string; label: string; percent: string; amountMinor: number; currency: string; dueOn: null; trigger: string; milestoneId: string | null; invoiceId: string | null };
type StoredContract = {
  id: string;
  proposalId: string;
  organizationId: string;
  status: string;
  terms: string;
  billing: unknown;
  signedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  proposal: { pricing: unknown; ownerId: string };
};

const memberships: Membership[] = [
  { userId: clientId, organizationId: ownOrg, role: "client", status: "active" },
  { userId: colleagueId, organizationId: ownOrg, role: "client", status: "active" },
  { userId: outsiderId, organizationId: otherOrg, role: "client", status: "active" },
  { userId: staffId, organizationId: ownOrg, role: "staff", status: "active" },
];

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("a client signs their own contract, cannot sign someone else's, and cannot use any other contract write", async () => {
  const contracts = new Map<string, StoredContract>();
  const entries: StoredEntry[] = [];
  const tokens = new Map<string, { tokenHash: string; revokedAt: null; expiresAt: null; userId: string; scopes: string[]; client: { organizationId: string }; user: { memberships: Membership[] } }>();
  const addToken = (raw: string, userId: string, scopes: string[], clientOrg: string) => {
    tokens.set(hash(raw), {
      tokenHash: hash(raw), revokedAt: null, expiresAt: null, userId, scopes, client: { organizationId: clientOrg },
      user: { memberships: memberships.filter((item) => item.userId === userId) },
    });
  };
  addToken("client-token", clientId, ["contracts:write", "proposals:read"], ownOrg);
  addToken("misbound-token", clientId, ["contracts:write"], otherOrg);
  addToken("colleague-token", colleagueId, ["contracts:write"], ownOrg);
  addToken("outsider-token", outsiderId, ["contracts:write"], otherOrg);
  addToken("staff-token", staffId, ["contracts:write"], ownOrg);
  addToken("read-token", clientId, ["proposals:read"], ownOrg);

  const view = (contract: StoredContract) => ({
    ...contract,
    entries: entries.filter((entry) => entry.contractId === contract.id).map((entry) => ({ ...entry })),
    proposal: contract.proposal,
  });
  const missing = () => Object.assign(new Error("not found"), { code: "P2025" });
  const db = {
    membership: {
      findUnique: async ({ where }: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => {
        const key = where.userId_organizationId;
        return memberships.find((item) => item.userId === key.userId && item.organizationId === key.organizationId) ?? null;
      },
      findFirst: async ({ where }: { where: { userId: string; organizationId?: string; status?: string } }) =>
        memberships.find((item) => item.userId === where.userId && (!where.organizationId || item.organizationId === where.organizationId) && (!where.status || item.status === where.status)) ?? null,
    },
    mcpToken: {
      findFirst: async ({ where }: { where: { tokenHash: string } }) => tokens.get(where.tokenHash) ?? null,
    },
    contract: {
      findFirstOrThrow: async ({ where }: { where: { id: string; organizationId?: string } }) => {
        const contract = contracts.get(where.id);
        if (!contract || (where.organizationId && contract.organizationId !== where.organizationId)) throw missing();
        return view(contract);
      },
      update: async ({ where, data }: { where: { id: string }; data: { status?: string; signedAt?: Date; billing?: unknown; terms?: string } }) => {
        const contract = contracts.get(where.id);
        if (!contract) throw missing();
        if (data.status) contract.status = data.status;
        if (data.terms) contract.terms = data.terms;
        if (data.signedAt instanceof Date) contract.signedAt = data.signedAt;
        if (data.billing !== undefined) contract.billing = data.billing;
        contract.updatedAt = new Date();
        return view(contract);
      },
      create: async () => { throw new Error("a client must not create a contract"); },
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

  function addContract(organizationId: string, ownerId: string) {
    const id = randomUUID();
    const now = new Date("2026-04-01T00:00:00.000Z");
    contracts.set(id, {
      id, proposalId: randomUUID(), organizationId, status: "draft", terms: "Terms", billing: {}, signedAt: null, createdAt: now, updatedAt: now,
      proposal: { pricing: { model: "workflow_check", amountMinor: 25_000, currency: "USD" }, ownerId },
    });
    return id;
  }

  const app = express();
  app.use(express.json());
  app.use((request: Request, _response: Response, next: NextFunction) => {
    const sessionUser = request.header("x-user-id");
    const sessionOrg = request.header("x-org-id");
    if (sessionUser && sessionOrg) Object.assign(request, { session: { userId: sessionUser, organizationId: sessionOrg } });
    next();
  });
  app.use("/api/v1", createProposalContractRouter({ prisma: db as never }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  const origin = `http://127.0.0.1:${address.port}`;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as { ok: boolean; code?: string; message?: string; changed?: boolean; entity?: { status?: string; terms?: string; entries?: unknown[] } } };
  };

  try {
    const ownId = addContract(ownOrg, clientId);
    const otherId = addContract(otherOrg, outsiderId);
    const colleagueIdContract = addContract(ownOrg, clientId);
    const staffDraft = addContract(ownOrg, clientId);

    const writes: Array<[string, string, unknown]> = [
      ["PATCH", `/api/v1/contracts/${ownId}`, { terms: "Rewritten" }],
      ["POST", `/api/v1/contracts/${ownId}/cancel`, {}],
      ["POST", "/api/v1/contracts", { proposalId: randomUUID(), terms: "Terms", billing: {} }],
      ["PATCH", `/api/v1/contracts/${ownId}/billing-terms`, { retainagePercentBasis: 0 }],
      ["POST", `/api/v1/contracts/${ownId}/retainage/release`, {}],
    ];
    for (const [method, path, body] of writes) {
      const denied = await call(method, path, "client-token", body);
      assert.equal(denied.status, 403, path);
      assert.equal(denied.body.code, "FORBIDDEN", path);
      assert.match(denied.body.message ?? "", /Staff authorization is required/, path);
    }
    assert.equal(contracts.get(ownId)?.status, "draft");
    assert.equal(contracts.get(ownId)?.terms, "Terms");

    const signed = await call("POST", `/api/v1/contracts/${ownId}/sign`, "client-token", {});
    assert.equal(signed.status, 200);
    assert.equal(signed.body.changed, true);
    assert.equal(signed.body.entity?.status, "signed");
    assert.equal(signed.body.entity?.entries?.length, 1);

    const other = await call("POST", `/api/v1/contracts/${otherId}/sign`, "client-token", {});
    assert.equal(other.status, 403);
    assert.equal(other.body.code, "FORBIDDEN");
    assert.match(other.body.message ?? "", /party/);
    assert.equal(contracts.get(otherId)?.status, "draft");

    const misbound = await call("POST", `/api/v1/contracts/${otherId}/sign`, "misbound-token", {});
    assert.equal(misbound.status, 403);
    assert.equal(misbound.body.code, "FORBIDDEN");
    assert.equal(contracts.get(otherId)?.status, "draft");

    const outsider = await call("POST", `/api/v1/contracts/${ownId}/sign`, "outsider-token", {});
    assert.equal(outsider.status, 403);
    assert.equal(outsider.body.code, "FORBIDDEN");

    const colleague = await call("POST", `/api/v1/contracts/${colleagueIdContract}/sign`, "colleague-token", {});
    assert.equal(colleague.status, 200);
    assert.equal(colleague.body.entity?.status, "signed");

    const unread = await call("POST", `/api/v1/contracts/${otherId}/sign`, "read-token", {});
    assert.equal(unread.status, 403);
    assert.equal(unread.body.code, "SCOPE_REQUIRED");

    const missing = await call("POST", `/api/v1/contracts/${randomUUID()}/sign`, "client-token", {});
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "NOT_FOUND");

    const staffWrite = await call("PATCH", `/api/v1/contracts/${staffDraft}`, "staff-token", { terms: "Staff terms" });
    assert.equal(staffWrite.status, 200);
    assert.equal(staffWrite.body.entity?.terms, "Staff terms");

    const staffOther = await call("POST", `/api/v1/contracts/${otherId}/sign`, "staff-token", {});
    assert.equal(staffOther.status, 404);
    assert.equal(contracts.get(otherId)?.status, "draft");

    const sessionOwn = addContract(ownOrg, clientId);
    const session = await fetch(`${origin}/api/v1/contracts/${sessionOwn}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": clientId, "x-org-id": ownOrg },
      body: "{}",
    });
    const sessionBody = await session.json() as { entity?: { status?: string } };
    assert.equal(session.status, 200);
    assert.equal(sessionBody.entity?.status, "signed");

    const sessionOther = await fetch(`${origin}/api/v1/contracts/${otherId}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": clientId, "x-org-id": ownOrg },
      body: "{}",
    });
    const sessionOtherBody = await sessionOther.json() as { code?: string };
    assert.equal(sessionOther.status, 403);
    assert.equal(sessionOtherBody.code, "FORBIDDEN");
    assert.equal(contracts.get(otherId)?.status, "draft");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("contracts:write stays grantable to clients and listed in discovery", () => {
  const all = ["proposals:read", "proposals:write", "contracts:write", "billing:read", "billing:write", "projects:read", "projects:write", "catalog:write", "admin"];
  const staffOnly = ["admin", "catalog:write"];
  const advertised = publicMcpScopes({ mcpScopes: all, staffOnlyScopes: staffOnly });
  assert.ok(advertised.includes("contracts:write"));
  for (const scope of staffOnly) assert.ok(!advertised.includes(scope), scope);
  const granted = connectorTokenScopes({
    requested: "contracts:write proposals:read",
    mcpScopes: all,
    staffGrants: [],
    isStaffOrAdmin: false,
    staffOnlyScopes: staffOnly,
  });
  assert.deepEqual(granted, ["contracts:write", "proposals:read"]);

  const restored = readFileSync(new URL("../../prisma/migrations/0056_client_contract_sign/migration.sql", import.meta.url), "utf8");
  assert.match(restored, /ARRAY\['proposals:read', 'proposals:write', 'contracts:write', 'billing:read', 'projects:read'\]/);
  assert.match(restored, /WHERE "code" = 'client'/);
  const hardened = readFileSync(new URL("../../prisma/migrations/0050_client_scope_hardening/migration.sql", import.meta.url), "utf8");
  assert.equal(hardened.includes("contracts:write"), false);
  assert.match(hardened, /IN \('admin', 'catalog:write'\)/);
});
