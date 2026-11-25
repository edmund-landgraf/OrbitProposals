import type { PrismaClient } from "@prisma/client";

export const REDACTED = "[redacted]";
/** Used only if the redaction table is empty or unreadable, so secrets are never stored by accident. */
export const FALLBACK_REDACTION_PATTERNS = ["token", "secret", "password", "authorization", "apikey", "api_key", "cookie", "otp", "totp", "recovery"];
const BEARER_VALUE = /\b(Bearer\s+)[A-Za-z0-9._~+\/=-]{8,}/g;

export type TraceSettings = { maxPayloadChars: number; retentionDays: number; listDefaultLimit: number; listMaxLimit: number };
const DEFAULT_SETTINGS: TraceSettings = { maxPayloadChars: 20000, retentionDays: 30, listDefaultLimit: 50, listMaxLimit: 200 };

/** Replaces values under secret-looking keys and bearer strings anywhere, recursively. */
export function redact(value: unknown, patterns: readonly string[], depth = 0): unknown {
  if (depth > 20) return "[truncated]";
  if (typeof value === "string") return value.replace(BEARER_VALUE, `$1${REDACTED}`);
  if (Array.isArray(value)) return value.map((item) => redact(item, patterns, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      out[key] = patterns.some((pattern) => lower.includes(pattern)) ? REDACTED : redact(item, patterns, depth + 1);
    }
    return out;
  }
  return value;
}

/** Keeps stored payloads bounded; oversized payloads become a preview string. */
export function bound(value: unknown, maxChars: number): unknown {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  if (text === undefined || text.length <= maxChars) return value ?? null;
  return { truncated: true, chars: text.length, preview: text.slice(0, maxChars) };
}

export async function loadRedactionPatterns(prisma: PrismaClient): Promise<string[]> {
  try {
    const rows = await prisma.agentTraceRedaction.findMany({ where: { active: true } });
    return rows.length ? rows.map((row) => row.pattern.toLowerCase()) : FALLBACK_REDACTION_PATTERNS;
  } catch {
    return FALLBACK_REDACTION_PATTERNS;
  }
}

export async function loadTraceSettings(prisma: PrismaClient): Promise<TraceSettings> {
  const rows = await prisma.agentTraceSetting.findMany();
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  return {
    maxPayloadChars: byKey.get("max_payload_chars") ?? DEFAULT_SETTINGS.maxPayloadChars,
    retentionDays: byKey.get("retention_days") ?? DEFAULT_SETTINGS.retentionDays,
    listDefaultLimit: byKey.get("list_default_limit") ?? DEFAULT_SETTINGS.listDefaultLimit,
    listMaxLimit: byKey.get("list_max_limit") ?? DEFAULT_SETTINGS.listMaxLimit,
  };
}

export type TraceInput = {
  toolName: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  errorMessage?: string | null;
  durationMs: number;
  agentName?: string | null;
  sessionRef?: string | null;
  occurredAt?: Date;
};
export type TraceActor = { mcpClientId?: string | null; tokenId?: string | null; userId?: string | null; organizationId?: string | null };

export async function recordTrace(prisma: PrismaClient, actor: TraceActor, trace: TraceInput) {
  const [patterns, settings] = await Promise.all([loadRedactionPatterns(prisma), loadTraceSettings(prisma)]);
  const clean = (value: unknown) => bound(redact(value, patterns), settings.maxPayloadChars) as object;
  const errorMessage = trace.errorMessage ? String(redact(trace.errorMessage, patterns)).slice(0, 2000) : null;
  return prisma.agentTrace.create({
    data: {
      occurredAt: trace.occurredAt ?? new Date(),
      mcpClientId: actor.mcpClientId ?? null,
      tokenId: actor.tokenId ?? null,
      userId: actor.userId ?? null,
      organizationId: actor.organizationId ?? null,
      agentName: trace.agentName?.slice(0, 200) ?? null,
      sessionRef: trace.sessionRef?.slice(0, 200) ?? null,
      toolName: trace.toolName.slice(0, 200),
      input: clean(trace.input ?? {}),
      output: trace.output === undefined ? undefined : clean(trace.output),
      isError: Boolean(trace.isError),
      errorMessage,
      durationMs: Math.max(0, Math.round(trace.durationMs)),
    },
  });
}

export type TraceFilter = { toolName?: string; mcpClientId?: string; userId?: string; isError?: boolean; before?: Date; limit?: number };

export async function listTraces(prisma: PrismaClient, filter: TraceFilter) {
  const settings = await loadTraceSettings(prisma);
  const limit = Math.min(filter.limit ?? settings.listDefaultLimit, settings.listMaxLimit);
  const rows = await prisma.agentTrace.findMany({
    where: {
      ...(filter.toolName ? { toolName: filter.toolName } : {}),
      ...(filter.mcpClientId ? { mcpClientId: filter.mcpClientId } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.isError !== undefined ? { isError: filter.isError } : {}),
      ...(filter.before ? { occurredAt: { lt: filter.before } } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: limit + 1,
  });
  const items = rows.slice(0, limit);
  return { items, nextBefore: rows.length > limit ? items[items.length - 1]?.occurredAt.toISOString() ?? null : null };
}

export async function purgeOldTraces(prisma: PrismaClient, now = new Date()) {
  const settings = await loadTraceSettings(prisma);
  const cutoff = new Date(now.getTime() - settings.retentionDays * 86_400_000);
  const result = await prisma.agentTrace.deleteMany({ where: { occurredAt: { lt: cutoff } } });
  return { deleted: result.count, cutoff };
}
