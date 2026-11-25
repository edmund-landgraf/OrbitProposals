import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";

// Needs migrations and `npm run db:seed` (CI runs both before this file).
const databaseUrl = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const integration = databaseUrl ? test : test.skip;

integration("local Postgres has the Unwhelm schema and seed data", async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  try {
    await prisma.$queryRaw`SELECT 1`;
    const organization = await prisma.organization.findUnique({ where: { slug: "unwhelm-local" }, include: { proposals: true } });
    assert.ok(organization, "seed organization should exist");
    assert.ok(organization.proposals.some((proposal) => proposal.title === "Seed automation assessment"));
  } finally {
    await prisma.$disconnect();
  }
});
