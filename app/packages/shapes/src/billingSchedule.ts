import { PricingSchema, pricing, type ProposalPricing } from "./pricing.js";

/**
 * Default BillingEntry schedule created the first time a contract is signed.
 * Percents are four-decimal strings that sum to 100.0000. Amounts are integer
 * cents in USD and sum to the schedule total. A later sign does not add rows.
 *
 * - workflow_check: one entry, 100% of the published $250, trigger
 *   `contract_signed` (due up front).
 * - capped_hours: one entry, 100% of the published cap ($550 for 4 hours or
 *   $900 for 8 hours), trigger `contract_signed` (due up front).
 * - fixed_price: two entries that split the fixed price in half. The deposit
 *   uses `contract_signed`. The remainder uses `milestone_accepted` and is not
 *   tied to a milestone yet (`milestoneId` null). A leftover cent is added to
 *   the milestone entry. Both percents stay 50.0000. When a milestone is
 *   accepted, that unscoped remainder is invoiced by the contract's only
 *   milestone, or by the final milestone when the contract has several.
 *   Final means the latest due date. Milestones with no due date are skipped
 *   while any milestone has one. If none have a due date, the greatest
 *   milestone id is final. An entry that already names a milestone is
 *   invoiced only when that milestone is accepted.
 * - hourly: one entry, 100%, amount 0, trigger `manual`. Hourly work has no
 *   prepaid total. Each invoice is raised manually at the published $175/hr
 *   rate, so the schedule total stays 0.
 */
export const BILLING_SCHEDULE_DEFAULTS = {
  workflow_check: "One entry for 100% of the Workflow Check, triggered when the contract is signed.",
  capped_hours: "One entry for 100% of the capped price (4 hours or 8 hours), triggered when the contract is signed.",
  fixed_price: "Two entries that split the fixed price 50/50. The deposit is triggered when the contract is signed, and the remainder is triggered when a milestone is accepted. A leftover cent is added to the milestone entry. The remainder starts unassigned. One milestone on the contract invoices it. Several milestones leave it to the final milestone (latest due date; if none are dated, the greatest milestone id).",
  hourly: "One manual entry for 100% with a zero amount. Hourly work is invoiced per invoice at the published hourly rate, so the schedule is not a prepaid balance.",
} as const;

const PERCENT_BASIS = 10_000;
const FULL_PERCENT = 100 * PERCENT_BASIS;

export class BillingScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingScheduleError";
  }
}

export type BillingTriggerName = "contract_signed" | "milestone_accepted" | "manual";

export type BillingScheduleDraftEntry = {
  label: string;
  percent: string;
  amountMinor: number;
  currency: "USD";
  dueOn: null;
  trigger: BillingTriggerName;
};

export type BillingScheduleDraft = {
  total: { amountMinor: number; currency: "USD" };
  entries: BillingScheduleDraftEntry[];
};

export function percentToBasis(percent: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(percent);
  if (!match) throw new BillingScheduleError(`Percent ${percent} is not a valid billing percent.`);
  const whole = Number(match[1]);
  const fraction = match[2] ? Number(match[2].padEnd(4, "0")) : 0;
  if (!Number.isInteger(whole) || !Number.isInteger(fraction)) throw new BillingScheduleError(`Percent ${percent} is not a valid billing percent.`);
  const basis = whole * PERCENT_BASIS + fraction;
  if (basis < 0 || basis > FULL_PERCENT) throw new BillingScheduleError(`Percent ${percent} is outside 0 to 100.`);
  return basis;
}

export function basisToPercent(basis: number): string {
  const whole = Math.trunc(basis / PERCENT_BASIS);
  const fraction = basis % PERCENT_BASIS;
  return `${whole}.${String(fraction).padStart(4, "0")}`;
}

/** Four-decimal percent string. Accepts "50" and "50.0000". */
export function formatBillingPercent(percent: string): string {
  return basisToPercent(percentToBasis(percent));
}

export function reconcileBillingSchedule(schedule: {
  total: { amountMinor: number; currency: string };
  entries: Array<{ percent: string; amountMinor: number; currency: string }>;
}): { percentBasis: number; amountMinor: number } {
  if (schedule.entries.length === 0) throw new BillingScheduleError("A billing schedule needs at least one entry.");
  if (!Number.isInteger(schedule.total.amountMinor) || schedule.total.amountMinor < 0) {
    throw new BillingScheduleError("The billing schedule total must be nonnegative integer cents.");
  }
  let percentBasis = 0;
  let amountMinor = 0;
  for (const entry of schedule.entries) {
    if (entry.currency !== schedule.total.currency) throw new BillingScheduleError("Billing entries must use the schedule currency.");
    if (!Number.isInteger(entry.amountMinor) || entry.amountMinor < 0) throw new BillingScheduleError("Billing amounts must be nonnegative integer cents.");
    percentBasis += percentToBasis(entry.percent);
    amountMinor += entry.amountMinor;
  }
  if (percentBasis !== FULL_PERCENT) throw new BillingScheduleError(`Billing percents must sum to 100.0000 (got ${basisToPercent(percentBasis)}).`);
  if (amountMinor !== schedule.total.amountMinor) throw new BillingScheduleError(`Billing amounts must sum to the schedule total (got ${amountMinor}, expected ${schedule.total.amountMinor}).`);
  return { percentBasis, amountMinor };
}

function allocateAmounts(totalMinor: number, bases: number[]): number[] {
  const amounts = bases.map((basis) => Math.floor((totalMinor * basis) / FULL_PERCENT));
  let remainder = totalMinor - amounts.reduce((sum, amount) => sum + amount, 0);
  const ranked = bases
    .map((basis, index) => ({ index, fraction: (totalMinor * basis) % FULL_PERCENT }))
    .sort((left, right) => right.fraction - left.fraction || right.index - left.index);
  for (const row of ranked) {
    if (remainder === 0) break;
    amounts[row.index] += 1;
    remainder -= 1;
  }
  if (remainder !== 0) throw new BillingScheduleError("Billing amounts could not be reconciled to the schedule total.");
  return amounts;
}

function entry(
  label: string,
  basis: number,
  amountMinor: number,
  trigger: BillingTriggerName,
): BillingScheduleDraftEntry {
  return {
    label,
    percent: basisToPercent(basis),
    amountMinor,
    currency: pricing.currency,
    dueOn: null,
    trigger,
  };
}

function singleUpfront(label: string, amountMinor: number): BillingScheduleDraft {
  return finish({
    total: { amountMinor, currency: pricing.currency },
    entries: [entry(label, FULL_PERCENT, amountMinor, "contract_signed")],
  });
}

function finish(schedule: BillingScheduleDraft): BillingScheduleDraft {
  reconcileBillingSchedule(schedule);
  return schedule;
}

function scheduleFor(price: ProposalPricing): BillingScheduleDraft {
  switch (price.model) {
    case "workflow_check":
      return singleUpfront("Workflow Check", price.amountMinor);
    case "capped_hours":
      return singleUpfront(`Capped Hours, ${price.hours} hours`, price.amountMinor);
    case "fixed_price": {
      const bases = [FULL_PERCENT / 2, FULL_PERCENT / 2];
      const amounts = allocateAmounts(price.amountMinor, bases);
      return finish({
        total: { amountMinor: price.amountMinor, currency: pricing.currency },
        entries: [
          entry("Deposit", bases[0] ?? 0, amounts[0] ?? 0, "contract_signed"),
          entry("Milestone acceptance", bases[1] ?? 0, amounts[1] ?? 0, "milestone_accepted"),
        ],
      });
    }
    case "hourly":
      return finish({
        total: { amountMinor: 0, currency: pricing.currency },
        entries: [entry(`Hourly, invoiced per invoice at $${pricing.hourlyRate}/hr`, FULL_PERCENT, 0, "manual")],
      });
    default: {
      const unreachable: never = price;
      throw new BillingScheduleError(`No billing schedule is defined for ${JSON.stringify(unreachable)}.`);
    }
  }
}

/**
 * Draft invoice raised from `contract_signed` entries the first time a
 * contract is signed. A zero total (hourly has no such entries) means there
 * is nothing to invoice. Mixed currencies are an error.
 */
export function contractSignedInvoiceAmount(entries: Array<{ amountMinor: number; currency: string }>): { amountMinor: number; currency: string } | null {
  if (entries.length === 0) return null;
  for (const entry of entries) {
    if (!Number.isInteger(entry.amountMinor) || entry.amountMinor < 0) {
      throw new BillingScheduleError("Billing amounts must be nonnegative integer cents.");
    }
    if (!/^[A-Z]{3}$/.test(entry.currency)) throw new BillingScheduleError("Billing entries must use a three-letter currency.");
  }
  const currencies = new Set(entries.map((entry) => entry.currency));
  if (currencies.size !== 1) throw new BillingScheduleError("Contract signing entries must use one currency.");
  const currency = [...currencies][0];
  if (!currency) return null;
  const amountMinor = entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
  if (amountMinor === 0) return null;
  return { amountMinor, currency };
}

export type MilestoneBillingTarget = { id: string; dueDate: Date | null };

/**
 * Milestone that invoices unscoped `milestone_accepted` entries.
 * One milestone owns them. Several milestones assign them to the final
 * milestone: the latest due date, ignoring undated milestones when any
 * milestone is dated, otherwise the greatest id.
 */
export function milestoneThatOwnsUnscopedEntries(milestones: MilestoneBillingTarget[]): string | null {
  if (milestones.length === 0) return null;
  if (milestones.length === 1) return milestones[0]?.id ?? null;
  const dated = milestones.filter((milestone) => milestone.dueDate != null);
  const pool = dated.length > 0 ? dated : milestones;
  const sorted = [...pool].sort((left, right) => {
    const leftTime = left.dueDate ? left.dueDate.getTime() : 0;
    const rightTime = right.dueDate ? right.dueDate.getTime() : 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return sorted[sorted.length - 1]?.id ?? null;
}

/** Uninvoiced `milestone_accepted` rows this acceptance should put on its draft invoice. */
export function entriesForMilestoneAcceptance<T extends { milestoneId: string | null }>(input: {
  milestoneId: string;
  milestones: MilestoneBillingTarget[];
  entries: T[];
}): T[] {
  const ownerId = milestoneThatOwnsUnscopedEntries(input.milestones);
  const ownsUnscoped = ownerId === input.milestoneId;
  return input.entries.filter((entry) => entry.milestoneId === input.milestoneId || (entry.milestoneId == null && ownsUnscoped));
}

/**
 * Draft invoice for accepting one milestone.
 * The amount is the uninvoiced `milestone_accepted` entries (the fixed-price
 * balance) plus retainage when the milestone has some. Retainage is held until
 * acceptance, and acceptance releases it onto this invoice. A currency mismatch
 * is an error. No entries and no retainage means there is nothing to invoice.
 */
export function milestoneAcceptanceInvoiceAmount(input: {
  entries: Array<{ amountMinor: number; currency: string }>;
  retainage: { amountMinor: number; currency: string } | null;
}): { amountMinor: number; currency: string } | null {
  const retainage = input.retainage && input.retainage.amountMinor > 0 ? input.retainage : null;
  if (input.entries.length === 0 && !retainage) return null;
  for (const entry of input.entries) {
    if (!Number.isInteger(entry.amountMinor) || entry.amountMinor < 0) {
      throw new BillingScheduleError("Billing amounts must be nonnegative integer cents.");
    }
    if (!/^[A-Z]{3}$/.test(entry.currency)) throw new BillingScheduleError("Billing entries must use a three-letter currency.");
  }
  if (retainage) {
    if (!Number.isInteger(retainage.amountMinor) || retainage.amountMinor < 0) {
      throw new BillingScheduleError("Retainage must be nonnegative integer cents.");
    }
    if (!/^[A-Z]{3}$/.test(retainage.currency)) throw new BillingScheduleError("Retainage must use a three-letter currency.");
  }
  const currencies = new Set(input.entries.map((entry) => entry.currency));
  if (retainage) currencies.add(retainage.currency);
  if (currencies.size !== 1) throw new BillingScheduleError("Milestone acceptance entries and retainage must use one currency.");
  const currency = [...currencies][0];
  if (!currency) return null;
  const amountMinor = input.entries.reduce((sum, entry) => sum + entry.amountMinor, 0) + (retainage?.amountMinor ?? 0);
  if (amountMinor === 0) return null;
  return { amountMinor, currency };
}

/** Build the default schedule for one proposal pricing model. */
export function billingScheduleFromPricing(input: unknown): BillingScheduleDraft {
  const parsed = PricingSchema.safeParse(input);
  if (!parsed.success) {
    throw new BillingScheduleError(parsed.error.issues.map((issue) => issue.message).join(" "));
  }
  return scheduleFor(parsed.data);
}
