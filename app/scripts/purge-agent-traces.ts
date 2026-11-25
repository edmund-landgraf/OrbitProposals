import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/prismaClient.js";
import { purgeOldTraces } from "../server/agentTrace.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
try {
  const result = await purgeOldTraces(prisma);
  console.log(JSON.stringify({ ok: true, deleted: result.deleted, cutoff: result.cutoff.toISOString() }));
} finally {
  await prisma.$disconnect();
}
