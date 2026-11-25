import { z } from "zod";
import { IdSchema, ProposalRoleSchema, ProposalRoleSideSchema } from "../packages/shapes/src/index.js";

export const RoleWriteSchema = z.object({
  name: z.string().trim().min(1).max(200),
  side: ProposalRoleSideSchema,
  responsibility: z.string().max(2000).default(""),
  heaviestIn: z.array(z.string().min(1).max(80)).default([]),
}).strict();

export const RolesReplaceSchema = z.object({
  roles: z.array(RoleWriteSchema).max(50),
}).strict();

export function heaviestInFromRow(role: { heaviestAll: boolean; heaviestGates: boolean; phases: Array<{ milestoneId: string }> }): string[] {
  return [
    ...(role.heaviestAll ? ["all"] : []),
    ...(role.heaviestGates ? ["gates"] : []),
    ...role.phases.map((phase) => phase.milestoneId),
  ];
}

export function roleView(role: { id: string; name: string; side: string; responsibility: string; heaviestAll: boolean; heaviestGates: boolean; phases: Array<{ milestoneId: string }> }) {
  return ProposalRoleSchema.parse({
    id: role.id,
    name: role.name,
    side: role.side,
    responsibility: role.responsibility,
    heaviestIn: heaviestInFromRow(role),
  });
}

export function parseHeaviest(heaviestIn: readonly string[], phaseIds: ReadonlySet<string>): { heaviestAll: boolean; heaviestGates: boolean; phaseIds: string[] } | { error: string } {
  const unknown = heaviestIn.filter((item) => item !== "all" && item !== "gates" && !IdSchema.safeParse(item).success);
  if (unknown.length) return { error: `Unknown heaviestIn value: ${unknown.join(", ")}.` };
  const ids = heaviestIn.filter((item) => IdSchema.safeParse(item).success);
  const missing = ids.filter((id) => !phaseIds.has(id));
  if (missing.length) return { error: "Each heaviestIn phase id must belong to this proposal's timeline." };
  return {
    heaviestAll: heaviestIn.includes("all"),
    heaviestGates: heaviestIn.includes("gates"),
    phaseIds: [...new Set(ids)],
  };
}
