import "dotenv/config";
import { WORKFLOW_CHECK_AMOUNT_MINOR, pricing } from "../shared/pricing.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/prismaClient.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for db:seed");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const ids = {
  user: "00000000-0000-0000-0000-000000000101",
  organization: "00000000-0000-0000-0000-000000000102",
  membership: "00000000-0000-0000-0000-000000000103",
  proposal: "00000000-0000-0000-0000-000000000104",
  chat: "00000000-0000-0000-0000-000000000105",
  mcpClient: "00000000-0000-0000-0000-000000000106",
} as const;

try {
  const organization = await prisma.organization.upsert({ where: { id: ids.organization }, update: { name: "Unwhelm Local", slug: "unwhelm-local" }, create: { id: ids.organization, name: "Unwhelm Local", slug: "unwhelm-local" } });
  const user = await prisma.user.upsert({ where: { id: ids.user }, update: { email: "seed@unwhelm.local", displayName: "Unwhelm Seed User" }, create: { id: ids.user, email: "seed@unwhelm.local", displayName: "Unwhelm Seed User" } });
  await prisma.membership.upsert({ where: { id: ids.membership }, update: { role: "staff", status: "active", organizationId: organization.id, userId: user.id }, create: { id: ids.membership, role: "staff", status: "active", organizationId: organization.id, userId: user.id, permissions: ["*"] } });
  await prisma.proposal.upsert({ where: { id: ids.proposal }, update: { title: "Seed automation assessment", status: "draft", organizationId: organization.id, ownerId: user.id }, create: { id: ids.proposal, title: "Seed automation assessment", engagement: "workflow_check", status: "draft", organizationId: organization.id, ownerId: user.id, scope: { summary: "Seed record", deliverables: ["Assessment"] }, timeline: { milestones: [] }, pricingModel: "workflow_check", pricing: { model: "workflow_check", amountMinor: WORKFLOW_CHECK_AMOUNT_MINOR, currency: pricing.currency } } });
  await prisma.chatSession.upsert({ where: { id: ids.chat }, update: { ownerId: user.id, proposalId: ids.proposal, status: "open" }, create: { id: ids.chat, ownerId: user.id, proposalId: ids.proposal, agent: "proposal", status: "open" } });
  await prisma.mcpClient.upsert({ where: { id: ids.mcpClient }, update: { name: "Local seed MCP client", organizationId: organization.id }, create: { id: ids.mcpClient, clientId: "unwhelm-local-seed", name: "Local seed MCP client", organizationId: organization.id, redirectUris: [], scopes: ["proposals:read"] } });
  console.log(JSON.stringify({ ok: true, userId: user.id, organizationId: organization.id, proposalId: ids.proposal, chatSessionId: ids.chat }));
} finally {
  await prisma.$disconnect();
}
