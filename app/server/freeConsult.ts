import type { Prisma, PrismaClient } from "@prisma/client";

export class ConsultError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export type ConsultOfferingRow = {
  code: string;
  label: string;
  description: string;
  engagement: string;
  pricingModel: string;
  amountMinor: number;
  currency: string;
  durationMinutes: number;
  perClientLimit: number | null;
  limitScope: string;
  proposalTitleTemplate: string;
  limitMessage: string;
  active: boolean;
};

export const consultTitle = (template: string, topic: string) => template.replace(/\{topic\}/g, topic).slice(0, 300);

export const limitReached = (offering: Pick<ConsultOfferingRow, "perClientLimit">, used: number) =>
  offering.perClientLimit !== null && used >= offering.perClientLimit;

/** Price and pricing model come from the offering row. The caller (agent or client) never supplies them. */
export const consultPricing = (offering: ConsultOfferingRow) => ({ model: offering.pricingModel, amountMinor: offering.amountMinor, currency: offering.currency, offering: offering.code });

export type ConsultIntakeInput = { offeringCode?: string; topic: string; details?: string; userId: string; organizationId: string | null; defaultOfferingCode: string };

export async function createConsultIntake(prisma: PrismaClient, input: ConsultIntakeInput) {
  return prisma.$transaction(async (tx) => {
    const code = input.offeringCode ?? input.defaultOfferingCode;
    const offering = await tx.consultOffering.findUnique({ where: { code } }) as ConsultOfferingRow | null;
    if (!offering || !offering.active) throw new ConsultError(404, "NOT_FOUND", "That consult offering is not available.");
    const byOrganization = offering.limitScope === "organization" && input.organizationId;
    const scopeKey = byOrganization ? `org:${input.organizationId}` : `user:${input.userId}`;
    // Serialize intakes for one client so two requests cannot both pass the limit.
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `consult:${offering.code}:${scopeKey}`);
    const used = await tx.consultIntake.count({ where: { offeringCode: offering.code, ...(byOrganization ? { organizationId: input.organizationId } : { userId: input.userId }) } });
    if (limitReached(offering, used)) throw new ConsultError(409, "LIMIT_REACHED", offering.limitMessage);
    const proposal = await tx.proposal.create({
      data: {
        ownerId: input.userId,
        organizationId: input.organizationId,
        title: consultTitle(offering.proposalTitleTemplate, input.topic),
        engagement: offering.engagement as Prisma.ProposalCreateInput["engagement"],
        pricingModel: offering.pricingModel as Prisma.ProposalCreateInput["pricingModel"],
        status: "draft",
        scope: { summary: input.details?.trim() || input.topic, deliverables: [offering.label], assumptions: [], exclusions: [], consult: { offering: offering.code, durationMinutes: offering.durationMinutes } } as Prisma.InputJsonValue,
        timeline: { startDate: null, targetDate: null } as Prisma.InputJsonValue,
        pricing: consultPricing(offering) as Prisma.InputJsonValue,
      },
    });
    const intake = await tx.consultIntake.create({
      data: { offeringCode: offering.code, proposalId: proposal.id, organizationId: input.organizationId, userId: input.userId, topic: input.topic, details: input.details ?? null },
    });
    return { intake, proposal, offering, remaining: offering.perClientLimit === null ? null : Math.max(offering.perClientLimit - used - 1, 0) };
  });
}
