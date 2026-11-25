import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/prismaClient.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for org:attach");

const email = process.argv[2]?.trim().toLowerCase();
const orgName = process.argv[3]?.trim();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !orgName) {
  console.error("Usage: npm run org:attach -- <email> <orgName>");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error("No user exists for that email.");
    process.exitCode = 1;
  } else {
    const organization = await prisma.organization.findFirst({ where: { name: orgName } });
    if (!organization) {
      console.error("No organization exists with that name.");
      process.exitCode = 1;
    } else {
      await prisma.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
        create: { userId: user.id, organizationId: organization.id, role: "staff", status: "active" },
        update: { role: "staff", status: "active" },
      });
      process.stdout.write(`${email} is an active staff member of ${organization.name}.\n`);
    }
  }
} finally {
  await prisma.$disconnect();
}
