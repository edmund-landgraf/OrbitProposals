import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/prismaClient.js";
import { magicLinkUrl, mintMagicLinkMaterial } from "../server/services/magicLinkMint.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for mint:link");

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npx tsx scripts/mint-magic-link.ts <email>");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error("No user exists for that email.");
    process.exitCode = 1;
  } else {
    const { token, expiresAt, tokenHash } = mintMagicLinkMaterial(new Date());
    await prisma.magicLink.create({
      data: { email, tokenHash, expiresAt, requestIp: null, userAgent: null },
    });
    process.stdout.write(`${magicLinkUrl(token)}\n`);
  }
} finally {
  await prisma.$disconnect();
}
