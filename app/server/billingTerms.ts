import { addUtcDays, utcDay } from "./catalog.js";

const PERCENT_SCALE = 1_000_000;

export type PaymentTermRow = { id: string; code: string; label: string; days: number; isDefault: boolean; sortOrder: number };

export function dueFromPaymentTerm(anchor: Date, days: number): Date {
  return addUtcDays(utcDay(anchor), days);
}

export function splitRetainage(grossMinor: number, percentBasis: number): { netMinor: number; withheldMinor: number } {
  const basis = Math.min(PERCENT_SCALE, Math.max(0, percentBasis));
  const withheldMinor = Math.floor(grossMinor * basis / PERCENT_SCALE);
  return { netMinor: grossMinor - withheldMinor, withheldMinor };
}

/** A sent invoice whose due date is before today is overdue. */
export function overdueStatus(status: string, dueDate: Date, now = new Date()): string {
  if (status !== "sent") return status;
  return dueDate.getTime() < utcDay(now).getTime() ? "overdue" : status;
}
