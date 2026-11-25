import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { maybeNotifyAccessRequest } from "../../server/services/accessRequestNotify.js";
import { clearAdminMintLimit, createAdminRouter } from "../../server/routes/admin.js";
import { clearAccessRequestLimit, createAccessRequestRouter } from "../../server/routes/accessRequests.js";
import { createSystemAuthRouter } from "../../server/routes/systemAuth.js";

type User = { id: string; email: string; displayName: string; isAdmin: boolean; suspendedAt: Date | null; createdAt: Date; memberships: Membership[] };
type Membership = { id: string; userId: string; organizationId: string; role: "prospect" | "client" | "staff"; status: "active"; permissions: unknown[]; organization: { id: string; name: string; slug: string; createdAt: Date } };
type AccessRow = { id: string; email: string; name: string; company: string | null; role: string | null; reason: string; referral: string | null; status: "pending" | "approved" | "rejected"; reviewedBy: string | null; reviewedAt: Date | null; reviewNote: string | null; createdAt: Date; ip: string | null; userAgent: string | null };
type Token = { id: string; userId: string; tokenHash: string; refreshTokenHash: string | null; scopes: string[]; revokedAt: Date | null; expiresAt: Date | null; refreshExpiresAt: Date | null; clientId: string; client: { clientId: string }; user: User };

const orgId = "11111111-1111-4111-8111-111111111111";
const org = { id: orgId, name: "Trial", slug: "trial", createdAt: new Date() };
const users: User[] = [];
const requests: AccessRow[] = [];
const tokens: Token[] = [];
const links: { email: string }[] = [];
const audits: { operation: string }[] = [];
let sent = 0;
let notified = 0;

const adminId = randomUUID();
const memberId = randomUUID();
users.push(
  { id: adminId, email: "admin@example.com", displayName: "Admin", isAdmin: true, suspendedAt: null, createdAt: new Date(), memberships: [] },
  { id: memberId, email: "member@example.com", displayName: "Member", isAdmin: false, suspendedAt: null, createdAt: new Date(), memberships: [] },
);

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

const prisma = {
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => users.find((user) => user.id === where.id || user.email === where.email) ?? null,
    findMany: async () => users,
    create: async ({ data }: { data: { email: string; displayName: string; isAdmin: boolean } }) => {
      const user: User = { id: randomUUID(), email: data.email, displayName: data.displayName, isAdmin: data.isAdmin, suspendedAt: null, createdAt: new Date(), memberships: [] };
      users.push(user);
      return user;
    },
    update: async ({ where, data }: { where: { id: string }; data: { suspendedAt: Date | null } }) => {
      const user = users.find((item) => item.id === where.id);
      assert.ok(user);
      user.suspendedAt = data.suspendedAt;
      return user;
    },
  },
  organization: { findUnique: async ({ where }: { where: { id: string } }) => where.id === org.id ? org : null },
  membership: {
    findUnique: async ({ where }: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => {
      const key = where.userId_organizationId;
      return users.flatMap((user) => user.memberships).find((item) => item.userId === key.userId && item.organizationId === key.organizationId) ?? null;
    },
    create: async ({ data }: { data: Membership }) => {
      const user = users.find((item) => item.id === data.userId);
      assert.ok(user);
      const membership: Membership = { ...data, id: randomUUID(), organization: org, permissions: [] };
      user.memberships.push(membership);
      return membership;
    },
    update: async ({ where, data }: { where: { id: string }; data: { role: Membership["role"]; status: "active" } }) => {
      const membership = users.flatMap((user) => user.memberships).find((item) => item.id === where.id);
      assert.ok(membership);
      membership.role = data.role;
      membership.status = data.status;
      return membership;
    },
  },
  accessRequest: {
    findFirst: async ({ where }: { where: { email: string; status: string } }) => requests.find((row) => row.email === where.email && row.status === where.status) ?? null,
    findUnique: async ({ where }: { where: { id: string } }) => requests.find((row) => row.id === where.id) ?? null,
    findMany: async () => [...requests].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    create: async ({ data }: { data: Omit<AccessRow, "id" | "reviewedBy" | "reviewedAt" | "reviewNote" | "createdAt" | "status"> & { status: "pending" } }) => {
      const row: AccessRow = { ...data, id: randomUUID(), status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null, createdAt: new Date() };
      requests.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<AccessRow> }) => {
      const row = requests.find((item) => item.id === where.id);
      assert.ok(row);
      Object.assign(row, data);
      return row;
    },
  },
  mcpToken: {
    findFirst: async ({ where }: { where: { tokenHash?: string; revokedAt?: null } }) => tokens.find((token) => token.tokenHash === where.tokenHash && (where.revokedAt !== null || !token.revokedAt)) ?? null,
    findMany: async () => tokens,
    updateMany: async ({ where, data }: { where: { userId: string; revokedAt: null }; data: { revokedAt: Date } }) => {
      let count = 0;
      for (const token of tokens) if (token.userId === where.userId && !token.revokedAt) { token.revokedAt = data.revokedAt; count += 1; }
      return { count };
    },
    findUnique: async ({ where }: { where: { refreshTokenHash: string } }) => tokens.find((token) => token.refreshTokenHash === where.refreshTokenHash) ?? null,
    create: async () => ({}),
  },
  magicLink: { create: async ({ data }: { data: { email: string } }) => { links.push({ email: data.email }); return { id: randomUUID() }; } },
  auditEvent: {
    findFirst: async () => null,
    findMany: async () => [],
    create: async ({ data }: { data: { operation: string } }) => { audits.push({ operation: data.operation }); return data; },
  },
  mcpClient: { findUnique: async () => null, findMany: async () => [] },
};

const body = {
  email: "New.Person@example.com",
  name: "New Person",
  company: "Northwind",
  role: "Ops lead",
  reason: "I want to try the proposal agent on a real workflow.",
  referral: "A colleague",
  consent: true,
  website: "",
};

function publicShape(value: { requestId?: string }) {
  const copy = { ...value };
  delete copy.requestId;
  return copy;
}

async function withServer(run: (baseUrl: string) => Promise<void>) {
  clearAccessRequestLimit();
  clearAdminMintLimit();
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => {
    const userId = request.header("x-user");
    if (userId) request.session.userId = userId;
    next();
  });
  app.use("/api/v1", createAccessRequestRouter({ prisma: prisma as never, notify: async () => { notified += 1; } }));
  app.use("/api/v1", createAdminRouter({ prisma: prisma as never }));
  app.use("/api/v1", createSystemAuthRouter({
    prisma: prisma as never,
    reviewerLogin: { email: "app-reviewer@unwhelm.net", password: "reviewer-password-ok" },
    sendMagicLink: async () => { sent += 1; },
  }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); } finally { server.close(); }
}

test("the sign-in page links to request access", async () => {
  await withServer(async (baseUrl) => {
    const page = await fetch(`${baseUrl}/api/v1/auth/signin`);
    assert.match(await page.text(), /No account\? <a href="\/request-access">Request access<\/a>/);
  });
});

test("access requests return one generic success and do not say who already has an account", async () => {
  const previous = process.env.UNWH_ACCESS_REQUEST_NOTIFY;
  delete process.env.UNWH_ACCESS_REQUEST_NOTIFY;
  notified = 0;
  await withServer(async (baseUrl) => {
    const post = (payload: unknown, ip = "203.0.113.10") => fetch(`${baseUrl}/api/v1/access-requests`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(payload),
    });
    const first = await post(body);
    const duplicate = await post({ ...body, name: "Someone else" });
    const existing = await post({ ...body, email: "member@example.com", name: "Member" }, "203.0.113.11");
    const honeypot = await post({ ...body, email: "bot@example.com", website: "https://spam.example" }, "203.0.113.12");
    const invalid = await post({ email: "nope", consent: false }, "203.0.113.13");
    const shapes = await Promise.all([first, duplicate, existing, honeypot].map(async (response) => publicShape(await response.json())));
    assert.equal(first.status, 200);
    assert.deepEqual(shapes[0], { ok: true, entity: { accepted: true }, warnings: [], links: {} });
    assert.deepEqual(shapes[1], shapes[0]);
    assert.deepEqual(shapes[2], shapes[0]);
    assert.deepEqual(shapes[3], shapes[0]);
    assert.equal(invalid.status, 400);
    assert.equal(requests.filter((row) => row.email === "new.person@example.com").length, 1);
    assert.equal(requests.filter((row) => row.email === "member@example.com").length, 1);
    assert.equal(requests.some((row) => row.email === "bot@example.com"), false);
    assert.equal(users.some((user) => user.email === "new.person@example.com"), false);
    assert.equal(notified, 2);
  });
  if (previous === undefined) delete process.env.UNWH_ACCESS_REQUEST_NOTIFY;
  else process.env.UNWH_ACCESS_REQUEST_NOTIFY = previous;
});

test("owner notification stays off unless UNWH_ACCESS_REQUEST_NOTIFY is 1", async () => {
  const previous = process.env.UNWH_ACCESS_REQUEST_NOTIFY;
  const fetchImpl = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("notify tried to send mail"); };
  try {
    delete process.env.UNWH_ACCESS_REQUEST_NOTIFY;
    await maybeNotifyAccessRequest({ email: "a@example.com", name: "A", company: null });
    process.env.UNWH_ACCESS_REQUEST_NOTIFY = "0";
    await maybeNotifyAccessRequest({ email: "a@example.com", name: "A", company: null });
  } finally {
    globalThis.fetch = fetchImpl;
    if (previous === undefined) delete process.env.UNWH_ACCESS_REQUEST_NOTIFY;
    else process.env.UNWH_ACCESS_REQUEST_NOTIFY = previous;
  }
});

test("access requests are rate limited by IP", async () => {
  await withServer(async (baseUrl) => {
    let limited = 0;
    for (let index = 0; index < 6; index += 1) {
      const response = await fetch(`${baseUrl}/api/v1/access-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, email: `rate-${index}@example.com` }),
      });
      if (response.status === 429) limited += 1;
    }
    assert.equal(limited, 1);
  });
});

test("non-admins cannot list, approve, reject, suspend, or unsuspend", async () => {
  await withServer(async (baseUrl) => {
    const headers = { "x-user": memberId, "content-type": "application/json" };
    const calls = [
      ["GET", "/api/v1/admin/access-requests"],
      ["POST", `/api/v1/admin/access-requests/${randomUUID()}/approve`],
      ["POST", `/api/v1/admin/access-requests/${randomUUID()}/reject`],
      ["POST", `/api/v1/admin/users/${memberId}/suspend`],
      ["POST", `/api/v1/admin/users/${memberId}/unsuspend`],
    ] as const;
    for (const [method, path] of calls) {
      const response = await fetch(`${baseUrl}${path}`, { method, headers, body: method === "GET" ? undefined : "{}" });
      assert.equal(response.status, 403, path);
    }
  });
});

test("approval creates only a client membership and fails clearly when the trial org is unset", async () => {
  const previous = process.env.UNWH_TRIAL_ORG_ID;
  delete process.env.UNWH_TRIAL_ORG_ID;
  await withServer(async (baseUrl) => {
    const pending = requests.find((row) => row.email === "new.person@example.com");
    assert.ok(pending);
    const headers = { "x-user": adminId, "content-type": "application/json" };
    const missing = await fetch(`${baseUrl}/api/v1/admin/access-requests/${pending.id}/approve`, { method: "POST", headers, body: "{}" });
    const missingBody = await missing.json() as { code: string; message: string };
    assert.equal(missing.status, 409);
    assert.equal(missingBody.code, "TRIAL_ORG_UNCONFIGURED");
    assert.match(missingBody.message, /UNWH_TRIAL_ORG_ID/);
    assert.equal(users.some((user) => user.email === "new.person@example.com"), false);

    process.env.UNWH_TRIAL_ORG_ID = orgId;
    const approved = await fetch(`${baseUrl}/api/v1/admin/access-requests/${pending.id}/approve`, { method: "POST", headers, body: "{}" });
    const approvedBody = await approved.json() as { entity: { membershipRole: string; isAdmin: boolean; message: string } };
    assert.equal(approved.status, 200);
    assert.equal(approvedBody.entity.membershipRole, "client");
    assert.equal(approvedBody.entity.isAdmin, false);
    assert.match(approvedBody.entity.message, /sign-in page/);
    const created = users.find((user) => user.email === "new.person@example.com");
    assert.ok(created);
    assert.equal(created.isAdmin, false);
    assert.equal(created.memberships.length, 1);
    assert.equal(created.memberships[0].role, "client");
    assert.equal(created.memberships[0].status, "active");
    assert.equal(created.memberships[0].organizationId, orgId);

    const staff = users.find((user) => user.email === "member@example.com");
    assert.ok(staff);
    staff.memberships.push({ id: randomUUID(), userId: staff.id, organizationId: orgId, role: "staff", status: "active", permissions: [], organization: org });
    const staffRequest = requests.find((row) => row.email === "member@example.com");
    assert.ok(staffRequest);
    const kept = await fetch(`${baseUrl}/api/v1/admin/access-requests/${staffRequest.id}/approve`, { method: "POST", headers, body: "{}" });
    const keptBody = await kept.json() as { entity: { membershipRole: string } };
    assert.equal(kept.status, 200);
    assert.equal(keptBody.entity.membershipRole, "staff");
    assert.equal(staff.memberships.filter((item) => item.role === "staff").length, 1);
    assert.equal(staff.isAdmin, false);

    const rejected = requests[0];
    const other = { ...body, email: "reject.me@example.com" };
    await fetch(`${baseUrl}/api/v1/access-requests`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.40" }, body: JSON.stringify(other) });
    const rejectRow = requests.find((row) => row.email === "reject.me@example.com");
    assert.ok(rejectRow);
    const reject = await fetch(`${baseUrl}/api/v1/admin/access-requests/${rejectRow.id}/reject`, { method: "POST", headers, body: JSON.stringify({ note: "Not a fit" }) });
    assert.equal(reject.status, 200);
    assert.equal(rejectRow.status, "rejected");
    assert.equal(rejectRow.reviewNote, "Not a fit");
    assert.equal(rejected.id.length > 0, true);
  });
  if (previous === undefined) delete process.env.UNWH_TRIAL_ORG_ID;
  else process.env.UNWH_TRIAL_ORG_ID = previous;
});

test("a suspended user gets no magic link, loses tokens, and cannot use reviewer password sign-in", async () => {
  sent = 0;
  const reviewer = users.find((user) => user.email === "app-reviewer@unwhelm.net") ?? (() => {
    const user: User = { id: randomUUID(), email: "app-reviewer@unwhelm.net", displayName: "App reviewer", isAdmin: false, suspendedAt: null, createdAt: new Date(), memberships: [] };
    users.push(user);
    return user;
  })();
  const refresh = `refresh-${"a".repeat(40)}`;
  const access = `access-${"b".repeat(40)}`;
  tokens.push({
    id: randomUUID(), userId: reviewer.id, tokenHash: hash(access), refreshTokenHash: hash(refresh), scopes: ["proposals:read"],
    revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000), refreshExpiresAt: new Date(Date.now() + 86_400_000),
    clientId: randomUUID(), client: { clientId: "reviewer-client" }, user: reviewer,
  });
  await withServer(async (baseUrl) => {
    const headers = { "x-user": adminId, "content-type": "application/json" };
    const suspended = await fetch(`${baseUrl}/api/v1/admin/users/${reviewer.id}/suspend`, { method: "POST", headers, body: "{}" });
    assert.equal(suspended.status, 200);
    assert.ok(reviewer.suspendedAt);
    assert.ok(tokens.every((token) => token.userId !== reviewer.id || token.revokedAt));

    const unknown = await fetch(`${baseUrl}/api/v1/auth/magic-link/request`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.50" }, body: JSON.stringify({ email: "nobody-suspended-compare@example.com" }) });
    const known = await fetch(`${baseUrl}/api/v1/auth/magic-link/request`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.51" }, body: JSON.stringify({ email: reviewer.email }) });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.deepEqual(publicShape(await known.json()), publicShape(await unknown.json()));
    assert.equal(sent, 0);
    assert.equal(links.some((link) => link.email === reviewer.email), false);

    const health = await fetch(`${baseUrl}/api/v1/health`, { headers: { authorization: `Bearer ${access}` } });
    const healthBody = await health.json() as { entity: { scopes?: string[] } };
    assert.deepEqual(healthBody.entity.scopes ?? [], []);
    const refreshed = await fetch(`${baseUrl}/api/v1/auth/mcp/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refresh, client_id: "reviewer-client" }),
    });
    assert.equal(refreshed.status, 400);

    const password = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: reviewer.email, password: "reviewer-password-ok" }),
    });
    assert.equal(password.status, 403);
    const session = await fetch(`${baseUrl}/api/v1/me`, { headers: { "x-user": reviewer.id } });
    assert.equal(session.status, 401);
  });
});
