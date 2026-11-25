import { createHmac, timingSafeEqual } from "node:crypto";

export type PandaDocWebhookEvent = unknown;

function normalizeHeader(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = found?.[1];
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export function pandaDocWebhookSignature(headers: Record<string, string | string[] | undefined>, query?: Record<string, unknown>): string {
  const fromQuery = typeof query?.signature === "string" ? query.signature : Array.isArray(query?.signature) ? String(query.signature[0] ?? "") : "";
  return fromQuery
    || normalizeHeader(headers, "x-pandadoc-signature")
    || normalizeHeader(headers, "signature")
    || "";
}

export function pandaDocWebhookDocumentId(event: PandaDocWebhookEvent): string {
  const first = Array.isArray(event) ? event[0] : event;
  if (!first || typeof first !== "object") return "";
  const row = first as Record<string, unknown>;
  const data = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : row;
  const id = data.id ?? data.document_id ?? row.document_id ?? "";
  return typeof id === "string" ? id : "";
}

/** HMAC-SHA256 of the raw JSON body, matching PandaDoc's webhook signature query param. */
export function verifyPandaDocWebhookSignature(args: {
  secret: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  rawBody: string;
}): boolean {
  const signature = pandaDocWebhookSignature(args.headers, args.query);
  if (!signature || !args.rawBody) return false;
  const expected = createHmac("sha256", args.secret).update(args.rawBody, "utf8").digest("hex");
  const a = Buffer.from(signature.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
