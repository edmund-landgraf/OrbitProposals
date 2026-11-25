import type { Prisma, PrismaClient } from "@prisma/client";

export type ExpiryConfig = {
  defaultValidDays: number;
  nearExpiryDays: number;
  extendDefaultDays: number;
  extendMaxDays: number;
  labelActive: string;
  labelExpiring: string;
  labelExpired: string;
  expiredMessage: string;
};

export type ExpiryStateCode = "active" | "expiring" | "expired" | "none";

export type ExpiryView = {
  validUntil: string | null;
  state: ExpiryStateCode;
  label: string | null;
  daysRemaining: number | null;
  nearExpiryDays: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Proposals do not expire. Stored valid_until values are ignored by acceptance,
 * the expiry API, near-expiry reminders, the follow-up queue, and ticklers.
 * Migration 0055 drops the insert trigger that stamped the column and clears
 * existing deadlines. POST /proposals/:id/expiry/extend clears a stored date
 * instead of writing a new one. Magic links, OAuth codes, public share links,
 * and Try me sandboxes keep their own TTLs.
 */
export const PROPOSALS_NEVER_EXPIRE = true;

/** The deadline production code is allowed to enforce. Null while proposals do not expire. */
export function enforcedValidUntil(validUntil: Date | null | undefined): Date | null {
  if (PROPOSALS_NEVER_EXPIRE) return null;
  return validUntil ?? null;
}

export class ExpiryError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type ConfigClient = { proposalExpiryConfig?: { findFirst: (args: { orderBy: { id: "asc" } }) => Promise<ExpiryConfig | null> } };

export async function loadExpiryConfig(client: PrismaClient | Prisma.TransactionClient): Promise<ExpiryConfig | null> {
  const delegate = (client as unknown as ConfigClient).proposalExpiryConfig;
  return delegate ? delegate.findFirst({ orderBy: { id: "asc" } }) : null;
}

export function isExpired(validUntil: Date | null | undefined, now: Date): boolean {
  const deadline = enforcedValidUntil(validUntil);
  return Boolean(deadline && deadline.getTime() <= now.getTime());
}

export function expiryView(validUntil: Date | null | undefined, now: Date, config: ExpiryConfig | null): ExpiryView {
  const nearExpiryDays = config?.nearExpiryDays ?? 0;
  const deadline = enforcedValidUntil(validUntil);
  if (!deadline) return { validUntil: null, state: "none", label: null, daysRemaining: null, nearExpiryDays };
  // The branches below apply only when PROPOSALS_NEVER_EXPIRE is turned off.
  validUntil = deadline;
  const remainingMs = validUntil.getTime() - now.getTime();
  const daysRemaining = Math.ceil(remainingMs / DAY_MS);
  const state: ExpiryStateCode = remainingMs <= 0 ? "expired" : daysRemaining <= nearExpiryDays ? "expiring" : "active";
  const label = !config ? null : state === "expired" ? config.labelExpired : state === "expiring" ? config.labelExpiring : config.labelActive;
  return { validUntil: validUntil.toISOString(), state, label, daysRemaining: Math.max(daysRemaining, 0), nearExpiryDays };
}

/** New valid_until: days added to the later of now and the current date, so an extension never shortens the window. */
export function extendedValidUntil(current: Date | null, now: Date, days: number, config: ExpiryConfig): Date {
  if (!Number.isInteger(days) || days <= 0) throw new ExpiryError(400, "VALIDATION_FAILED", "Extension days must be a positive whole number.");
  if (days > config.extendMaxDays) throw new ExpiryError(400, "VALIDATION_FAILED", `An extension can be at most ${config.extendMaxDays} days.`);
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + days * DAY_MS);
}
