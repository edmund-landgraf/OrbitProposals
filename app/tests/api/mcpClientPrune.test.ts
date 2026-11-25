// Unused self-registered MCP clients are pruned after mcp_client_setting.unused_client_ttl_days; used, staff, and demo clients stay.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { loadUnusedClientTtlDays, pruneUnusedDcrClients } from "../../server/mcpClientPrune.js";
import { TOOL_SCOPES } from "../../unwh-mcp/src/toolAccess.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

test("client delete and prune tools need admin", () => {
  assert.equal((TOOL_SCOPES as Record<string, string>).unw_admin_delete_mcp_client, "admin");
  assert.equal((TOOL_SCOPES as Record<string, string>).unw_admin_prune_mcp_clients, "admin");
});

test("prune keeps used, recent, staff and demo clients", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  try {
    assert.equal(await loadUnusedClientTtlDays(prisma as never), 7);
    const tag = randomUUID().slice(0, 8);
    const old = new Date(Date.now() - 30 * 86_400_000);
    const stale = await prisma.mcpClient.create({ data: { clientId: `dcr-stale-${tag}`, name: "stale", createdAt: old } });
    const recent = await prisma.mcpClient.create({ data: { clientId: `dcr-recent-${tag}`, name: "recent" } });
    const used = await prisma.mcpClient.create({ data: { clientId: `dcr-used-${tag}`, name: "used", createdAt: old } });
    await prisma.mcpToken.create({ data: { clientId: used.id, tokenHash: `hash-${tag}` } });
    const staff = await prisma.mcpClient.create({ data: { clientId: `admin-${tag}`, name: "staff", createdAt: old } });
    const demo = await prisma.mcpClient.create({ data: { clientId: `try-me-${tag}`, name: "demo", createdAt: old } });
    assert.ok((await pruneUnusedDcrClients(prisma as never, new Date())) >= 1);
    const left = new Set((await prisma.mcpClient.findMany({ where: { id: { in: [stale.id, recent.id, used.id, staff.id, demo.id] } } })).map((c) => c.id));
    assert.ok(!left.has(stale.id));
    for (const id of [recent.id, used.id, staff.id, demo.id]) assert.ok(left.has(id));
    await prisma.mcpClient.deleteMany({ where: { id: { in: [recent.id, used.id, staff.id, demo.id] } } });
  } finally { await prisma.$disconnect(); }
});