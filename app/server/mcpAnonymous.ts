type PrismaClient = { $queryRaw?: any };

export type AnonymousMcpSettings = { rateLimit: number; windowSeconds: number };

/** Used only when the rows cannot be read; matches the strict MCP-side fallback. */
const FALLBACK: AnonymousMcpSettings = { rateLimit: 10, windowSeconds: 600 };

/** Anonymous MCP limits come from mcp_client_setting rows (anonymous_rate_limit, anonymous_rate_window_seconds). */
export async function loadAnonymousMcpSettings(prisma: PrismaClient): Promise<AnonymousMcpSettings> {
  try {
    if (!prisma.$queryRaw) return FALLBACK;
    const rows: Array<{ key: string; value: number }> = await prisma.$queryRaw`SELECT key, value FROM mcp_client_setting WHERE key IN ('anonymous_rate_limit', 'anonymous_rate_window_seconds')`;
    const byKey = new Map(rows.map((row) => [row.key, Number(row.value)]));
    const rateLimit = byKey.get("anonymous_rate_limit");
    const windowSeconds = byKey.get("anonymous_rate_window_seconds");
    return {
      rateLimit: rateLimit !== undefined && Number.isInteger(rateLimit) && rateLimit >= 0 ? rateLimit : FALLBACK.rateLimit,
      windowSeconds: windowSeconds !== undefined && Number.isInteger(windowSeconds) && windowSeconds > 0 ? windowSeconds : FALLBACK.windowSeconds,
    };
  } catch {
    return FALLBACK;
  }
}
