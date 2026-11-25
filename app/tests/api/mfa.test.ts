import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { resetMfaAttempts } from "../../server/auth/mfaRateLimit.js";
import { encryptTotpSecret } from "../../server/auth/totpCrypto.js";
import { codeAt, generateSecret, resetTotpReplay } from "../../server/auth/totp.js";
import { createAdminRouter } from "../../server/routes/admin.js";
import { createMfaRouter } from "../../server/routes/mfa.js";
import { createSystemAuthRouter } from "../../server/routes/systemAuth.js";

process.env.UNWH_TOTP_KEY = Buffer.alloc(32, 7).toString("base64");

type User = {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: Date;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  totpRecoveryHashes: string[];
  memberships: unknown[];
};
type Audit = { id: string; actorUserId: string | null; operation: string; method: string; path: string; recordType: string | null; recordId: string | null; requestId: string; inputRedacted: unknown; statusCode: number; previousHash: string | null; hash: string; createdAt: Date; tokenId?: string | null };
type Token = { id: string; tokenHash: string; scopes: string[]; revokedAt: Date | null; expiresAt: Date | null; user: User; client: { id: string; name: string } };

const users: User[] = [];
const audits: Audit[] = [];
const tokens: Token[] = [];

function user(partial: Partial<User> & Pick<User, "id" | "email" | "isAdmin">): User {
  return {
    displayName: "Admin",
    createdAt: new Date(),
    totpSecretEnc: null,
    totpEnabledAt: null,
    totpRecoveryHashes: [],
    memberships: [],
    ...partial,
  };
}

const prisma = {
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => users.find((item) => item.id === where.id || item.email === where.email) ?? null,
    findMany: async () => [...users],
    update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
      const found = users.find((item) => item.id === where.id);
      if (!found) throw new Error("missing user");
      Object.assign(found, data);
      return found;
    },
    create: async ({ data }: { data: { email: string; displayName: string; isAdmin: boolean } }) => {
      const created = user({ id: randomUUID(), email: data.email, displayName: data.displayName, isAdmin: data.isAdmin });
      users.push(created);
      return created;
    },
  },
  auditEvent: {
    findFirst: async () => audits[0] ?? null,
    findMany: async () => audits,
    create: async ({ data }: { data: Omit<Audit, "id" | "createdAt"> }) => {
      const row = { ...data, id: randomUUID(), createdAt: new Date() } as Audit;
      audits.unshift(row);
      const serialized = JSON.stringify(row.inputRedacted);
      assert.equal(serialized.includes("secret"), false);
      assert.equal(/code/i.test(serialized), false);
      return row;
    },
  },
  mcpToken: {
    findFirst: async ({ where }: { where: { tokenHash?: string } }) => tokens.find((item) => item.tokenHash === where.tokenHash && !item.revokedAt) ?? null,
    findMany: async () => [],
  },
  mcpClient: { create: async () => ({ id: randomUUID(), name: "unused" }) },
  magicLink: { create: async () => ({ id: randomUUID(), expiresAt: new Date() }) },
};

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function withApp(run: (baseUrl: string) => Promise<void>, now = () => new Date()) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => {
    const userId = request.header("x-user");
    if (userId) request.session.userId = userId;
    const verified = request.header("x-mfa-at");
    if (verified) request.session.mfaVerifiedAt = verified;
    next();
  });
  app.use("/api/v1", createMfaRouter({ prisma: prisma as never, now }));
  app.use("/api/v1", createAdminRouter({ prisma: prisma as never, now }));
  app.use("/api/v1", createSystemAuthRouter({ prisma: prisma as never, checkDatabase: async () => undefined, now }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); } finally { server.close(); }
}

test("confirm and verify enroll TOTP, accept a recovery code once, and record the audit", async () => {
  users.length = 0;
  audits.length = 0;
  resetMfaAttempts();
  resetTotpReplay();
  const admin = user({ id: randomUUID(), email: "mfa@example.com", isAdmin: true });
  users.push(admin);
  let clock = Date.parse("2026-01-01T00:00:00Z");
  await withApp(async (baseUrl) => {
    let cookie = "";
    const headers = { "content-type": "application/json", "x-user": admin.id, cookie };
    const remember = (response: Response) => {
      const next = (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).filter(Boolean);
      if (next.length) cookie = next.join("; ");
      headers.cookie = cookie;
    };
    const anonymous = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, { method: "POST" });
    assert.equal(anonymous.status, 401);

    const setup = await fetch(`${baseUrl}/api/v1/auth/mfa/setup`, { method: "POST", headers });
    remember(setup);
    const setupBody = await setup.json() as { entity: { otpauthUrl: string; qrCode: string } };
    assert.equal(setup.status, 200);
    assert.match(setupBody.entity.qrCode, /^data:image\/png;base64,/);
    assert.equal(admin.totpEnabledAt, null);
    assert.ok(admin.totpSecretEnc && !admin.totpSecretEnc.includes(new URL(setupBody.entity.otpauthUrl).searchParams.get("secret") ?? "missing"));
    const secret = new URL(setupBody.entity.otpauthUrl).searchParams.get("secret");
    assert.ok(secret);

    const confirm = await fetch(`${baseUrl}/api/v1/auth/mfa/confirm`, { method: "POST", headers, body: JSON.stringify({ code: codeAt(secret, new Date(clock)) }) });
    remember(confirm);
    const confirmBody = await confirm.json() as { entity: { recoveryCodes: string[] } };
    assert.equal(confirm.status, 200);
    assert.equal(confirmBody.entity.recoveryCodes.length, 8);
    assert.ok(admin.totpEnabledAt);
    assert.equal(admin.totpRecoveryHashes.includes(confirmBody.entity.recoveryCodes[0]!), false);
    assert.match(admin.totpRecoveryHashes[0] ?? "", /^[a-f0-9]{64}$/);
    resetMfaAttempts();

    const loggedOut = await fetch(`${baseUrl}/api/v1/auth/session`);
    const loggedOutBody = await loggedOut.json() as { entity: { mfa: { enrolled: boolean; verifiedAt: string | null }; authMode: string } };
    assert.equal(loggedOutBody.entity.authMode, "public");
    assert.deepEqual(loggedOutBody.entity.mfa, { enrolled: false, verifiedAt: null });

    clock += 30_000;
    const rejected = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, { method: "POST", headers, body: JSON.stringify({ code: "000000" }) });
    assert.equal(rejected.status, 401);
    const verified = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, { method: "POST", headers, body: JSON.stringify({ code: codeAt(secret, new Date(clock)) }) });
    remember(verified);
    assert.equal(verified.status, 200);
    const again = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, { method: "POST", headers, body: JSON.stringify({ code: codeAt(secret, new Date(clock)) }) });
    assert.equal(again.status, 401);

    clock += 30_000;
    const sessionResponse = await fetch(`${baseUrl}/api/v1/auth/session`, { headers });
    const sessionBody = await sessionResponse.json() as { entity: { mfa: { enrolled: boolean; verifiedAt: string } } };
    assert.equal(sessionBody.entity.mfa.enrolled, true);
    assert.equal(sessionBody.entity.mfa.verifiedAt, new Date(clock - 30_000).toISOString());

    const recovery = confirmBody.entity.recoveryCodes[1]!;
    const recovered = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, { method: "POST", headers, body: JSON.stringify({ code: recovery }) });
    assert.equal(recovered.status, 200);
    assert.equal(admin.totpRecoveryHashes.some((stored) => stored === hash(recovery)), false);
    const reused = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, { method: "POST", headers, body: JSON.stringify({ code: recovery }) });
    assert.equal(reused.status, 401);

    resetMfaAttempts();
    clock += 30_000;
    const disabled = await fetch(`${baseUrl}/api/v1/auth/mfa/disable`, { method: "POST", headers, body: JSON.stringify({ code: codeAt(secret, new Date(clock)) }) });
    assert.equal(disabled.status, 200);
    assert.equal(admin.totpEnabledAt, null);
    assert.equal(admin.totpSecretEnc, null);

    const operations = audits.map((event) => event.operation);
    for (const operation of ["mfa.setup", "mfa.confirm", "mfa.verify", "mfa.failed", "mfa.disable"]) {
      assert.ok(operations.includes(operation), operation);
    }
  }, () => new Date(clock));
});

test("authenticator routes stop after five tries in fifteen minutes", async () => {
  users.length = 0;
  audits.length = 0;
  resetMfaAttempts();
  const admin = user({ id: randomUUID(), email: "limited@example.com", isAdmin: true, totpEnabledAt: new Date(), totpSecretEnc: encryptTotpSecret(generateSecret()) });
  users.push(admin);
  await withApp(async (baseUrl) => {
    const headers = { "content-type": "application/json", "x-user": admin.id };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, { method: "POST", headers, body: JSON.stringify({ code: "000000" }) });
      assert.equal(response.status, 401);
    }
    const limited = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, { method: "POST", headers, body: JSON.stringify({ code: "000000" }) });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "RATE_LIMITED");
  });
});

test("admin MFA guard is off, warns, or requires a fresh verification", async () => {
  users.length = 0;
  tokens.length = 0;
  const previous = process.env.UNWH_ADMIN_MFA;
  const admin = user({ id: randomUUID(), email: "guard@example.com", isAdmin: true });
  users.push(admin);
  const fixed = new Date("2026-06-01T12:00:00Z");
  const fresh = new Date(fixed.getTime() - 60_000).toISOString();
  const stale = new Date(fixed.getTime() - 12 * 60 * 60 * 1000 - 1000).toISOString();
  const raw = `bearer-${randomUUID()}`;
  tokens.push({ id: randomUUID(), tokenHash: hash(raw), scopes: ["admin"], revokedAt: null, expiresAt: null, user: admin, client: { id: randomUUID(), name: "ci" } });
  const warned: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(" ")); };
  try {
    await withApp(async (baseUrl) => {
      const headers = { "x-user": admin.id };
      process.env.UNWH_ADMIN_MFA = "off";
      const open = await fetch(`${baseUrl}/api/v1/admin/users`, { headers });
      assert.equal(open.status, 200);
      assert.deepEqual((await open.json()).warnings, []);

      process.env.UNWH_ADMIN_MFA = "warn";
      const warning = await fetch(`${baseUrl}/api/v1/admin/users`, { headers });
      const warningBody = await warning.json() as { warnings: string[] };
      assert.equal(warning.status, 200);
      assert.equal(warningBody.warnings.length, 1);
      assert.ok(warned.some((line) => line.includes(admin.id)));

      process.env.UNWH_ADMIN_MFA = "enforce";
      const blocked = await fetch(`${baseUrl}/api/v1/admin/users`, { headers });
      assert.equal(blocked.status, 403);
      assert.equal((await blocked.json()).code, "MFA_REQUIRED");

      admin.totpEnabledAt = fixed;
      const staleResponse = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { ...headers, "x-mfa-at": stale } });
      assert.equal(staleResponse.status, 403);

      const allowed = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { ...headers, "x-mfa-at": fresh } });
      assert.equal(allowed.status, 200);

      admin.totpEnabledAt = null;
      const bearer = await fetch(`${baseUrl}/api/v1/admin/users`, { headers: { authorization: `Bearer ${raw}` } });
      assert.equal(bearer.status, 200);
    }, () => fixed);
  } finally {
    console.warn = original;
    if (previous === undefined) delete process.env.UNWH_ADMIN_MFA;
    else process.env.UNWH_ADMIN_MFA = previous;
  }
});
