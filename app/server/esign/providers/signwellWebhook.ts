import { createHmac, timingSafeEqual } from "node:crypto";

export type SignWellWebhookEvent = {
  event?: { type?: string; time?: string | number };
  document_id?: string;
  documentId?: string;
  type?: string;
  time?: string | number;
};

function normalizeHeader(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = found?.[1];
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function signwellWebhookMaterial(event: SignWellWebhookEvent): { type: string; time: string } {
  const eventType = event.event?.type ?? event.type ?? "";
  const eventTime = event.event?.time ?? event.time ?? "";
  return { type: String(eventType), time: String(eventTime) };
}

export function signwellWebhookDocumentId(event: SignWellWebhookEvent): string {
  const id = event.document_id ?? event.documentId ?? "";
  return typeof id === "string" ? id : "";
}

/**
 * Verifies the SignWell webhook signature using a shared secret.
 *
 * SignWell's signature does not cover the full payload (type+time only), so callers MUST reconcile
 * by fetching document state from the API before mutating any local state.
 */
export function verifySignWellWebhookSignature(args: {
  secret: string;
  headers: Record<string, string | string[] | undefined>;
  event: SignWellWebhookEvent;
}): boolean {
  const signature = normalizeHeader(args.headers, "x-signwell-signature")
    ?? normalizeHeader(args.headers, "x-signature")
    ?? normalizeHeader(args.headers, "signwell-signature")
    ?? "";
  if (!signature) return false;

  const { type, time } = signwellWebhookMaterial(args.event);
  if (!type || !time) return false;
  const message = `${type}.${time}`;
  const expected = createHmac("sha256", args.secret).update(message).digest("hex");

  // Constant-time compare, but avoid throwing on length mismatch.
  const a = Buffer.from(signature.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

