// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

const expected: Record<string, string[]> = {
  fixed_bid: ["scope", "hours", "price", "options", "milestones", "schedule", "terms", "executive_summary", "approach", "success_metrics"],
  tm_retainer: ["scope", "hours", "price", "schedule", "terms", "executive_summary", "approach", "service_levels"],
  discovery: ["scope", "hours", "price", "schedule", "terms", "executive_summary", "background", "approach", "success_metrics"],
  data_migration: ["scope", "hours", "price", "milestones", "schedule", "terms", "executive_summary", "background", "approach", "security", "data_migration", "training"],
};

test("starter templates ship as active rows with a coherent part tree", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  try {
    for (const [code, keys] of Object.entries(expected)) {
      const template = await prisma.proposalTemplate.findUnique({ where: { code }, include: { nodes: { orderBy: { sortOrder: "asc" } } } });
      assert.ok(template?.active, `${code} exists and is active`);
      assert.deepEqual(template.nodes.map((node) => node.nodeKey), keys, `${code} parts in order`);
      const inTemplate = new Set(keys);
      for (const node of template.nodes) {
        if (node.parentKey) assert.ok(inTemplate.has(node.parentKey), `${code}.${node.nodeKey} parent ${node.parentKey} is in the template`);
      }
      for (const required of ["scope", "price", "terms"]) assert.ok(inTemplate.has(required), `${code} has ${required}`);
    }
  } finally {
    await prisma.$disconnect();
  }
});