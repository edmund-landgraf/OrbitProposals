import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/prismaClient.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for admin:grant");

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npx tsx scripts/make-admin.ts <email>");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error("No user exists for that email.");
    process.exitCode = 1;
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    process.stdout.write(`${email} is an admin.\n`);
  }
} finally {
  await prisma.$disconnect();
}
