// Reviewer password sign-in is config injected here. No secret is read from the environment.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { MIN_REVIEWER_PASSWORD_LENGTH, REVIEWER_ATTEMPT_LIMIT, reviewerCredentialsMatch, reviewerLoginFromEnv } from "../../server/auth/reviewerLogin.js";
import { createSystemAuthRouter } from "../../server/routes/systemAuth.js";

const PASSWORD = "reviewer-test-password";

type Membership = { status: string; role: string; organizationId: string };
type UserRow = { id: string; email: string; displayName: string; isAdmin: boolean; createdAt: Date; totpEnabledAt: null; memberships: Membership[] };

test("reviewer env stays off unless both values are usable, and the password is not a default", () => {
  assert.equal(reviewerLoginFromEnv({}), null);
  assert.equal(reviewerLoginFromEnv({ REVIEWER_EMAIL: "reviewer@example.com" }), null);
  assert.equal(reviewerLoginFromEnv({ REVIEWER_PASSWORD: PASSWORD }), null);
  assert.equal(reviewerLoginFromEnv({ REVIEWER_EMAIL: "reviewer@example.com", REVIEWER_PASSWORD: "short-pass" }), null);
  assert.equal(reviewerLoginFromEnv({ REVIEWER_EMAIL: "not-an-email", REVIEWER_PASSWORD: PASSWORD }), null);
  const config = reviewerLoginFromEnv({ REVIEWER_EMAIL: " Reviewer@Example.com ", REVIEWER_PASSWORD: PASSWORD });
  assert.equal(config?.email, "reviewer@example.com");
  assert.equal(config?.password, PASSWORD);
  assert.ok(PASSWORD.length >= MIN_REVIEWER_PASSWORD_LENGTH);
  assert.equal(process.env.REVIEWER_EMAIL, undefined);
  assert.equal(process.env.REVIEWER_PASSWORD, undefined);
});

test("only the designated email and password match", () => {
  const config = { email: "reviewer@example.com", password: PASSWORD };
  assert.equal(reviewerCredentialsMatch(config, "Reviewer@Example.com", PASSWORD), true);
  assert.equal(reviewerCredentialsMatch(config, "person@example.com", PASSWORD), false);
  assert.equal(reviewerCredentialsMatch(config, "reviewer@example.com", `${PASSWORD}!`), false);
  assert.equal(reviewerCredentialsMatch(null, "reviewer@example.com", PASSWORD), false);
});

function userRow(email: string, extras: Partial<UserRow> = {}): UserRow {
  return { id: randomUUID(), email, displayName: extras.displayName ?? "Person", isAdmin: extras.isAdmin ?? false, createdAt: new Date(), totpEnabledAt: null, memberships: extras.memberships ?? [], ...extras, email };
}

async function withAuth(options: { reviewer: { email: string; password: string } | null; users?: UserRow[] }, run: (ctx: { baseUrl: string; sent: () => number; created: () => UserRow[] }) => Promise<void>) {
  const users = new Map((options.users ?? []).map((item) => [item.email, item]));
  const created: UserRow[] = [];
  let sent = 0;
  const clients: { id: string; clientId: string; name: string; redirectUris: string[] }[] = [];
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.email) return users.get(where.email) ?? null;
        if (where.id) return [...users.values()].find((item) => item.id === where.id) ?? null;
        return null;
      },
      create: async ({ data }: { data: { email: string; displayName: string; isAdmin?: boolean } }) => {
        const row = userRow(data.email, { displayName: data.displayName, isAdmin: Boolean(data.isAdmin) });
        users.set(row.email, row);
        created.push(row);
        return row;
      },
    },
    magicLink: { create: async () => ({ id: randomUUID() }) },
    mcpClient: {
      create: async ({ data }: { data: { clientId: string; name: string; redirectUris: string[] } }) => { const row = { id: randomUUID(), ...data }; clients.push(row); return row; },
      findUnique: async ({ where }: { where: { clientId: string } }) => clients.find((item) => item.clientId === where.clientId) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { clientId: string } }) => { const row = clients.find((item) => item.clientId === where.clientId); if (!row) throw new Error("missing client"); return row; },
      findMany: async () => clients,
    },
    mcpToken: { create: async () => ({ expiresAt: new Date() }), updateMany: async () => ({ count: 0 }), findFirst: async () => null },
    auditEvent: { findMany: async () => [] },
  };
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use("/api/v1", createSystemAuthRouter({ prisma: prisma as never, reviewerLogin: options.reviewer, sendMagicLink: async () => { sent += 1; } }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try { await run({ baseUrl: `http://127.0.0.1:${address.port}`, sent: () => sent, created: () => created }); }
  finally { server.close(); }
}

function cookieJar() {
  let cookie = "";
  return {
    get: () => cookie,
    store(response: Response) {
      const next = (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).filter(Boolean);
      if (next.length) cookie = next.join("; ");
    },
  };
}

test("the reviewer password signs in without email, and a normal account still uses the magic link", async () => {
  const reviewer = userRow("reviewer@example.com", { displayName: "Demo reviewer" });
  const person = userRow("person@example.com");
  await withAuth({ reviewer: { email: reviewer.email, password: PASSWORD }, users: [reviewer, person] }, async ({ baseUrl, sent, created }) => {
    const jar = cookieJar();
    const headers = (extra: Record<string, string> = {}) => ({ "x-forwarded-for": "203.0.113.21", ...(jar.get() ? { cookie: jar.get() } : {}), ...extra });
    const page = await fetch(`${baseUrl}/api/v1/auth/signin`, { headers: headers() });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /action="\/api\/v1\/auth\/signin"/);
    assert.match(html, /Email me a link/);
    assert.match(html, /action="\/api\/v1\/auth\/reviewer\/signin"/);
    assert.match(html, /type="password"/);

    const link = await fetch(`${baseUrl}/api/v1/auth/magic-link/request`, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ email: person.email }) });
    assert.equal(link.status, 200);
    assert.equal((await link.json()).changed, true);
    assert.equal(sent(), 1);

    const reviewerLink = await fetch(`${baseUrl}/api/v1/auth/magic-link/request`, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ email: reviewer.email }) });
    assert.equal(reviewerLink.status, 200);
    assert.equal(sent(), 2, "the reviewer mailbox can still request a magic link");

    const wrongAccount = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ email: person.email, password: PASSWORD }) });
    const wrongBody = await wrongAccount.text();
    assert.equal(wrongAccount.status, 401);
    assert.equal(JSON.parse(wrongBody).code, "AUTH_REQUIRED");
    assert.equal(wrongBody.includes(PASSWORD), false);
    assert.equal(sent(), 2, "a password post must not send a magic link");
    assert.equal(created().length, 0);

    const signedOut = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: headers() });
    assert.equal((await signedOut.json()).entity.authMode, "public");

    const signedIn = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ email: "Reviewer@Example.com", password: PASSWORD }) });
    jar.store(signedIn);
    const signedBody = await signedIn.json() as { entity: { user: { email: string; isAdmin: boolean; displayName: string } } };
    assert.equal(signedIn.status, 200);
    assert.equal(signedBody.entity.user.email, reviewer.email);
    assert.equal(signedBody.entity.user.isAdmin, false);
    assert.equal(signedBody.entity.user.displayName, "Demo reviewer");
    assert.equal(created().length, 0);
    assert.equal(sent(), 2);
    const session = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: headers() });
    assert.equal((await session.json()).entity.user.email, reviewer.email);
  });
});

test("oauth consent resumes after the reviewer password form and does not send email", async () => {
  const reviewer = userRow("oauth-reviewer@example.com");
  await withAuth({ reviewer: { email: reviewer.email, password: PASSWORD }, users: [reviewer] }, async ({ baseUrl, sent }) => {
    const jar = cookieJar();
    const ip = "203.0.113.22";
    const headers = (extra: Record<string, string> = {}) => ({ "x-forwarded-for": ip, ...(jar.get() ? { cookie: jar.get() } : {}), ...extra });
    const redirectUri = "http://127.0.0.1:9/callback";
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const registered = await fetch(`${baseUrl}/api/v1/auth/mcp/register`, { method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "ChatGPT review", grant_types: ["authorization_code"] }) });
    assert.equal(registered.status, 201);
    const client = await registered.json() as { client_id: string };
    const authorize = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize?${new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "review", resource: "https://mcp.unwhelm.net/mcp" })}`, { headers: headers(), redirect: "manual" });
    jar.store(authorize);
    assert.equal(authorize.status, 302);
    assert.equal(authorize.headers.get("location"), "/api/v1/auth/signin");

    const form = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", redirect: "manual", headers: headers({ "content-type": "application/x-www-form-urlencoded" }), body: new URLSearchParams({ email: reviewer.email, password: PASSWORD }) });
    jar.store(form);
    assert.equal(form.status, 302);
    assert.equal(form.headers.get("location"), "/api/v1/auth/mcp/authorize/resume");
    assert.equal((await form.text()).includes(PASSWORD), false);
    assert.equal(sent(), 0);

    const consent = await fetch(`${baseUrl}/api/v1/auth/mcp/authorize/resume`, { headers: headers() });
    const consentHtml = await consent.text();
    assert.equal(consent.status, 200);
    assert.match(consentHtml, /ChatGPT review/);
    assert.match(consentHtml, /name="csrf"/);
  });
});

test("a missing reviewer user is created as a non-admin and not stored with a password", async () => {
  await withAuth({ reviewer: { email: "create-reviewer@example.com", password: PASSWORD } }, async ({ baseUrl, sent, created }) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.23" }, body: JSON.stringify({ email: "create-reviewer@example.com", password: PASSWORD }) });
    const body = await response.json() as { entity: { user: { email: string; isAdmin: boolean; displayName: string } } };
    assert.equal(response.status, 200);
    assert.equal(body.entity.user.email, "create-reviewer@example.com");
    assert.equal(body.entity.user.displayName, "App reviewer");
    assert.equal(body.entity.user.isAdmin, false);
    assert.equal(created().length, 1);
    assert.equal(JSON.stringify(created()[0]).includes(PASSWORD), false);
    assert.equal(sent(), 0);
  });
});

test("staff and admin accounts cannot use the reviewer password", async () => {
  const staff = userRow("staff-reviewer@example.com", { memberships: [{ status: "active", role: "staff", organizationId: randomUUID() }] });
  const admin = userRow("admin-reviewer@example.com", { isAdmin: true });
  await withAuth({ reviewer: { email: staff.email, password: PASSWORD }, users: [staff] }, async ({ baseUrl, sent, created }) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.24" }, body: JSON.stringify({ email: staff.email, password: PASSWORD }) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "FORBIDDEN");
    assert.equal(sent(), 0);
    assert.equal(created().length, 0);
    const session = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { "x-forwarded-for": "203.0.113.24" } });
    assert.equal((await session.json()).entity.authMode, "public");
  });
  await withAuth({ reviewer: { email: admin.email, password: PASSWORD }, users: [admin] }, async ({ baseUrl, sent }) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.25" }, body: JSON.stringify({ email: admin.email, password: PASSWORD }) });
    const text = await response.text();
    assert.equal(response.status, 403);
    assert.equal(text.includes(PASSWORD), false);
    assert.equal(sent(), 0);
  });
});

test("password sign-in is absent until configured, and magic link still works", async () => {
  const person = userRow("plain@example.com");
  await withAuth({ reviewer: null, users: [person] }, async ({ baseUrl, sent }) => {
    const page = await fetch(`${baseUrl}/api/v1/auth/signin`);
    const html = await page.text();
    assert.match(html, /Email me a link/);
    assert.equal(html.includes("/auth/reviewer/signin"), false);
    assert.equal(html.includes("password"), false);
    const blocked = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.26" }, body: JSON.stringify({ email: person.email, password: PASSWORD }) });
    const blockedText = await blocked.text();
    assert.equal(blocked.status, 404);
    assert.equal(JSON.parse(blockedText).code, "NOT_FOUND");
    assert.equal(blockedText.includes(PASSWORD), false);
    const link = await fetch(`${baseUrl}/api/v1/auth/magic-link/request`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.26" }, body: JSON.stringify({ email: person.email }) });
    assert.equal(link.status, 200);
    assert.equal(sent(), 1);
  });
});

test("a bad reviewer post does not echo the password", async () => {
  const secret = "super-secret-value-not-echoed";
  await withAuth({ reviewer: { email: "echo-reviewer@example.com", password: PASSWORD } }, async ({ baseUrl, sent }) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.27" }, body: JSON.stringify({ email: "not-an-email", password: secret }) });
    const text = await response.text();
    assert.equal(response.status, 400);
    assert.equal(text.includes(secret), false);
    assert.equal(sent(), 0);
  });
});

test("reviewer password attempts are rate limited without sending email", async () => {
  await withAuth({ reviewer: { email: "rate-reviewer@example.com", password: PASSWORD } }, async ({ baseUrl, sent, created }) => {
    const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.28" };
    for (let index = 0; index < REVIEWER_ATTEMPT_LIMIT; index += 1) {
      const response = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", headers, body: JSON.stringify({ email: "rate-reviewer@example.com", password: "wrong-password-value" }) });
      assert.equal(response.status, 401);
    }
    const limited = await fetch(`${baseUrl}/api/v1/auth/reviewer/signin`, { method: "POST", headers, body: JSON.stringify({ email: "rate-reviewer@example.com", password: PASSWORD }) });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "RATE_LIMITED");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(sent(), 0);
    assert.equal(created().length, 0);
  });
});
