/** npm run db:purge-demos: deletes expired "Try me" sandboxes. Safe to run from cron. */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/prismaClient.js";
import { purgeExpiredDemos } from "../server/demo.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for db:purge-demos");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
try {
  const purged = await purgeExpiredDemos(prisma as never);
  console.log(`Purged ${purged} expired demo sandbox(es).`);
} finally {
  await prisma.$disconnect();
}
