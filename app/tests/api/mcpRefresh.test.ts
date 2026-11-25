import test from "node:test";
import assert from "node:assert/strict";
import { exchangeRefreshToken, issueTokens, loadTokenLifetimes, hashToken } from "../../server/mcpRefresh.js";

type Row = { id: string; clientId: string; userId: string | null; scopes: string[]; tokenHash: string; refreshTokenHash: string; refreshExpiresAt: Date; expiresAt: Date; revokedAt: Date | null };
function memoryDb() {
  const rows: Row[] = [];
  return { rows, mcpToken: {
    create: async ({ data }: { data: Record<string, unknown> }) => { rows.push({ id: String(rows.length + 1), revokedAt: null, ...(data as never) }); return {}; },
    findUnique: async ({ where }: { where: { refreshTokenHash: string } }) => { const row = rows.find((r) => r.refreshTokenHash === where.refreshTokenHash); return row ? { ...row, client: { clientId: row.clientId === "c-row" ? "client-a" : "other" } } : null; },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { revokedAt: Date } }) => { let count = 0; for (const r of rows) { if (Object.entries(where).every(([k, v]) => (r as never)[k] === v)) { r.revokedAt = data.revokedAt; count++; } } return { count }; },
  } };
}
const life = { accessDays: 30, refreshDays: 90 };
const t0 = new Date("2026-11-04T00:00:00Z");

test("lifetimes come from mcp_token_setting rows", async () => {
  assert.deepEqual(await loadTokenLifetimes({ mcpTokenSetting: { findMany: async () => [{ code: "access_token_ttl_days", value: 7 }, { code: "refresh_token_ttl_days", value: 60 }] } }), { accessDays: 7, refreshDays: 60 });
});

test("refresh rotates the pair and the old refresh token stops working", async () => {
  const db = memoryDb();
  const first = await issueTokens(db, { clientRowId: "c-row", userId: "u1", scopes: ["proposals:read", "billing:read"] }, life, t0);
  assert.equal(first.expires_in, 30 * 86400);
  assert.ok(first.refresh_token);
  const second = await exchangeRefreshToken(db as never, { refreshToken: first.refresh_token, clientId: "client-a" }, life, t0);
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.notEqual(second.tokens.access_token, first.access_token);
  assert.notEqual(second.tokens.refresh_token, first.refresh_token);
  assert.equal(second.tokens.scope, "proposals:read billing:read");
  assert.ok(db.rows[0].revokedAt);
  assert.equal(db.rows[1].revokedAt, null);
});

test("reusing a rotated refresh token revokes the whole client+user family", async () => {
  const db = memoryDb();
  const first = await issueTokens(db, { clientRowId: "c-row", userId: "u1", scopes: ["proposals:read"] }, life, t0);
  await exchangeRefreshToken(db as never, { refreshToken: first.refresh_token, clientId: "client-a" }, life, t0);
  const replay = await exchangeRefreshToken(db as never, { refreshToken: first.refresh_token, clientId: "client-a" }, life, t0);
  assert.deepEqual(replay, { ok: false, reason: "reused" });
  assert.ok(db.rows.every((r) => r.revokedAt));
});

test("wrong client, expiry, unknown token and scope widening are rejected", async () => {
  const db = memoryDb();
  const first = await issueTokens(db, { clientRowId: "c-row", userId: "u1", scopes: ["proposals:read"] }, life, t0);
  assert.deepEqual(await exchangeRefreshToken(db as never, { refreshToken: first.refresh_token, clientId: "client-b" }, life, t0), { ok: false, reason: "client_mismatch" });
  assert.deepEqual(await exchangeRefreshToken(db as never, { refreshToken: first.refresh_token, clientId: "client-a", scope: "proposals:read admin" }, life, t0), { ok: false, reason: "scope_widened" });
  assert.deepEqual(await exchangeRefreshToken(db as never, { refreshToken: "nope-nope-nope-nope", clientId: "client-a" }, life, t0), { ok: false, reason: "invalid" });
  const later = new Date(t0.getTime() + 91 * 86400_000);
  assert.deepEqual(await exchangeRefreshToken(db as never, { refreshToken: first.refresh_token, clientId: "client-a" }, life, later), { ok: false, reason: "expired" });
  assert.equal(db.rows[0].refreshTokenHash, hashToken(first.refresh_token));
});
