// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { MCP_SCOPES, scopeAllows } from "../../shared/mcpScopes.js";
import { MCP_SCOPES as apiScopes } from "../../server/routes/systemAuth.js";
import { MCP_SCOPES as mcpScopes } from "../../unwh-mcp/src/scopes.js";
import { createBillingProjectsRouter } from "../../server/routes/billingProjects.js";
import { createCatalogEditRouter } from "../../server/routes/catalogEdit.js";
import { createSystemAuthRouter } from "../../server/routes/systemAuth.js";

const organizationId = "55555555-5555-4555-8555-555555555555";
const userId = randomUUID();

test("admin satisfies every advertised scope, and the mint list is that same list", () => {
  assert.deepEqual([...apiScopes], [...MCP_SCOPES]);
  assert.deepEqual([...mcpScopes], [...MCP_SCOPES]);
  for (const scope of ["billing:read", "billing:write", "contracts:write", "catalog:write"]) {
    assert.equal(scopeAllows(["admin"], scope), true, scope);
    assert.equal(scopeAllows(["projects:read"], scope), false, scope);
  }
  assert.equal(scopeAllows(undefined, "billing:read"), true);
  assert.equal(scopeAllows([], "billing:read"), false);
});

test("published catalog read requires no scope", async () => {
  const app = express();
  app.use("/api/v1", createSystemAuthRouter({ prisma: {} as never }));
  const { origin, close } = await listen(app);
  try {
    const response = await fetch(`${origin}/api/v1/catalog`);
    const body = await response.json() as { ok: boolean; entity: { plans?: unknown } };
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.entity);
  } finally {
    await close();
  }
});

test("an admin token passes billing and catalog checks, and no organization returns ORG_REQUIRED", async () => {
  const billing = express();
  billing.use(express.json());
  billing.use("/api/v1", createBillingProjectsRouter({ prisma: billingPrisma() }));
  const catalog = express();
  catalog.use(express.json());
  catalog.use("/api/v1", createCatalogEditRouter({ prisma: catalogPrisma() }));
  const billingServer = await listen(billing);
  const catalogServer = await listen(catalog);
  try {
    const attached = await fetch(`${billingServer.origin}/api/v1/invoices`, { headers: { authorization: "Bearer admin-token" } });
    assert.equal(attached.status, 200);

    const missing = await fetch(`${billingServer.origin}/api/v1/invoices`, { headers: { authorization: "Bearer admin-no-org" } });
    const missingBody = await missing.json() as { code: string; message: string };
    assert.equal(missing.status, 403);
    assert.equal(missingBody.code, "ORG_REQUIRED");
    assert.match(missingBody.message, /organizationId/);
    assert.match(missingBody.message, /org:attach/);

    const chosen = await fetch(`${billingServer.origin}/api/v1/invoices?organizationId=${organizationId}`, { headers: { authorization: "Bearer admin-no-org" } });
    assert.equal(chosen.status, 200);

    const unknown = await fetch(`${billingServer.origin}/api/v1/invoices?organizationId=${randomUUID()}`, { headers: { authorization: "Bearer admin-no-org" } });
    assert.equal((await unknown.json() as { code: string }).code, "ORG_REQUIRED");

    const editor = await fetch(`${catalogServer.origin}/api/v1/catalog/editor`, { headers: { authorization: "Bearer admin-token" } });
    assert.equal(editor.status, 200);
    const editorBody = await editor.json() as { entity: { draft: unknown } };
    assert.equal(editorBody.entity.draft, null);

    const editorWithoutOrg = await fetch(`${catalogServer.origin}/api/v1/catalog/editor`, { headers: { authorization: "Bearer admin-no-org" } });
    const editorWithoutOrgBody = await editorWithoutOrg.json() as { entity: { active: unknown; draft: unknown } };
    assert.equal(editorWithoutOrg.status, 200);
    assert.equal(editorWithoutOrgBody.entity.active, null);
    assert.equal(editorWithoutOrgBody.entity.draft, null);

    const denied = await fetch(`${catalogServer.origin}/api/v1/catalog/editor`, { headers: { authorization: "Bearer staff-without-catalog" } });
    const deniedBody = await denied.json() as { code: string };
    assert.equal(denied.status, 403);
    assert.equal(deniedBody.code, "SCOPE_REQUIRED");
  } finally {
    await billingServer.close();
    await catalogServer.close();
  }
});

function bearerRecord(scopes: string[], withOrganization: boolean) {
  return {
    userId,
    scopes,
    client: { organizationId: null },
    user: {
      memberships: withOrganization ? [{ status: "active", role: "staff", organizationId }] : [],
    },
  };
}

function billingPrisma() {
  return {
    mcpToken: {
      findFirst: async ({ where }: { where: { tokenHash: string } }) => {
        if (where.tokenHash === hash("admin-token")) return bearerRecord(["admin"], true);
        if (where.tokenHash === hash("admin-no-org")) return { ...bearerRecord(["admin"], false), client: null, user: { memberships: undefined } };
        return null;
      },
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === organizationId ? { id: organizationId } : null),
    },
    invoice: { findMany: async () => [], count: async () => 0 },
  } as never;
}

function catalogPrisma() {
  return {
    mcpToken: {
      findFirst: async ({ where }: { where: { tokenHash: string } }) => {
        if (where.tokenHash === hash("admin-token")) return bearerRecord(["admin"], true);
        if (where.tokenHash === hash("admin-no-org")) return { ...bearerRecord(["admin"], false), client: null, user: { memberships: undefined } };
        if (where.tokenHash === hash("staff-without-catalog")) return bearerRecord(["projects:read"], true);
        return null;
      },
    },
    catalogVersion: { findFirst: async () => null },
  } as never;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function listen(app: express.Express): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
