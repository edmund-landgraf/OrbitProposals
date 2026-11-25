import { createHash, randomBytes } from "node:crypto";

export type TokenLifetimes = { accessDays: number; refreshDays: number };
/** Used only if mcp_token_setting has no rows (e.g. in unit tests); migration 0051 seeds the real values. */
const FALLBACK: TokenLifetimes = { accessDays: 30, refreshDays: 90 };

export async function loadTokenLifetimes(prisma: { mcpTokenSetting?: { findMany: () => Promise<{ code: string; value: number }[]> } }): Promise<TokenLifetimes> {
  const rows = prisma.mcpTokenSetting ? await prisma.mcpTokenSetting.findMany() : [];
  const get = (code: string, fallback: number) => rows.find((row) => row.code === code)?.value ?? fallback;
  return { accessDays: get("access_token_ttl_days", FALLBACK.accessDays), refreshDays: get("refresh_token_ttl_days", FALLBACK.refreshDays) };
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const DAY = 24 * 60 * 60_000;

export type IssuedTokens = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

type TokenRow = { id: string; clientId: string; userId: string | null; scopes: unknown; revokedAt: Date | null; refreshExpiresAt: Date | null; client?: { clientId: string } };
export type RefreshDb = {
  mcpToken: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    findUnique: (args: { where: { refreshTokenHash: string }; include: { client: true } }) => Promise<TokenRow | null>;
    updateMany: (args: { where: Record<string, unknown>; data: { revokedAt: Date } }) => Promise<{ count: number }>;
  };
  user?: { findUnique: (args: { where: { id: string } }) => Promise<{ suspendedAt?: Date | null } | null> };
};

export async function issueTokens(db: Pick<RefreshDb, "mcpToken">, input: { clientRowId: string; userId: string | null; scopes: string[] }, lifetimes: TokenLifetimes, now: Date): Promise<IssuedTokens> {
  const access = randomBytes(48).toString("base64url");
  const refresh = randomBytes(48).toString("base64url");
  const expiresAt = new Date(now.getTime() + lifetimes.accessDays * DAY);
  const refreshExpiresAt = new Date(now.getTime() + lifetimes.refreshDays * DAY);
  await db.mcpToken.create({ data: { clientId: input.clientRowId, userId: input.userId, tokenHash: hashToken(access), refreshTokenHash: hashToken(refresh), refreshExpiresAt, scopes: input.scopes, expiresAt } });
  return { access_token: access, token_type: "Bearer", expires_in: Math.floor((expiresAt.getTime() - now.getTime()) / 1000), refresh_token: refresh, scope: input.scopes.join(" ") };
}

export type RefreshResult = { ok: true; tokens: IssuedTokens } | { ok: false; reason: "invalid" | "reused" | "expired" | "client_mismatch" | "scope_widened" };

/** Rotates a refresh token. The old access + refresh pair is revoked. A revoked refresh token presented again revokes every live token for that client and user. */
export async function exchangeRefreshToken(db: RefreshDb, input: { refreshToken: string; clientId: string; scope?: string }, lifetimes: TokenLifetimes, now: Date): Promise<RefreshResult> {
  const row = await db.mcpToken.findUnique({ where: { refreshTokenHash: hashToken(input.refreshToken) }, include: { client: true } });
  if (!row) return { ok: false, reason: "invalid" };
  if (row.userId && db.user) {
    const owner = await db.user.findUnique({ where: { id: row.userId } });
    if (owner?.suspendedAt) return { ok: false, reason: "invalid" };
  }
  if (row.client?.clientId !== input.clientId) return { ok: false, reason: "client_mismatch" };
  if (row.revokedAt) {
    await db.mcpToken.updateMany({ where: { clientId: row.clientId, userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
    return { ok: false, reason: "reused" };
  }
  if (!row.refreshExpiresAt || row.refreshExpiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  const granted = Array.isArray(row.scopes) ? row.scopes.filter((scope): scope is string => typeof scope === "string") : [];
  let scopes = granted;
  if (input.scope) {
    const asked = input.scope.split(/\s+/).filter(Boolean);
    if (asked.some((scope) => !granted.includes(scope))) return { ok: false, reason: "scope_widened" };
    scopes = asked;
  }
  const revoked = await db.mcpToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: now } });
  if (revoked.count !== 1) return { ok: false, reason: "reused" };
  return { ok: true, tokens: await issueTokens(db, { clientRowId: row.clientId, userId: row.userId, scopes }, lifetimes, now) };
}
