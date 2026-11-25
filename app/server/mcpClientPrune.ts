type PrismaClient = { $queryRaw?: any; mcpClient: { deleteMany: (args: any) => Promise<{ count: number }> } };

/** Self-registered (DCR) clients that never received a token are removed after mcp_client_setting.unused_client_ttl_days. Staff-created (admin-*) and demo (try-me-*) clients are left alone. */
export async function loadUnusedClientTtlDays(prisma: PrismaClient): Promise<number> {
  try {
    if (!prisma.$queryRaw) return 7;
    const rows: Array<{ value: number }> = await prisma.$queryRaw`SELECT value FROM mcp_client_setting WHERE key = 'unused_client_ttl_days' LIMIT 1`;
    const days = Number(rows[0]?.value);
    return Number.isFinite(days) && days > 0 ? days : 7;
  } catch {
    return 7;
  }
}

export async function pruneUnusedDcrClients(prisma: PrismaClient, now: Date): Promise<number> {
  const days = await loadUnusedClientTtlDays(prisma);
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const removed = await prisma.mcpClient.deleteMany({
    where: {
      createdAt: { lt: cutoff },
      secretHash: null,
      tokens: { none: {} },
      NOT: [{ clientId: { startsWith: "admin-" } }, { clientId: { startsWith: "try-me-" } }],
    },
  });
  return removed.count;
}