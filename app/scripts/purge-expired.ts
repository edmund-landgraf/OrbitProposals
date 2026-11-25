import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/prismaClient.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for db:purge-expired");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const now = new Date();

try {
  const [workspaces, links, magicLinks] = await prisma.$transaction([
    prisma.chatSession.deleteMany({ where: { ownerId: null, expiresAt: { lt: now } } }),
    prisma.proposalPublicLink.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.magicLink.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] } }),
  ]);
  console.log(JSON.stringify({ ok: true, purged: { anonymousWorkspaces: workspaces.count, publicProposalLinks: links.count, magicLinks: magicLinks.count }, purgedBefore: now.toISOString() }));
} finally {
  await prisma.$disconnect();
}
