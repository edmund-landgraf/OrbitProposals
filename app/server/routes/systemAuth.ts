import { createHash, randomBytes, randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { pruneUnusedDcrClients } from "../mcpClientPrune.js";
import { loadAnonymousMcpSettings } from "../mcpAnonymous.js";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { grantsForRole, loadActiveCatalog, publicCatalogView, publicMcpScopes } from "../catalog.js";
import { connectorTokenScopes, isStaffOrAdmin } from "../connectorScopes.js";
import type {} from "../sessionTypes.js";
import { exchangeRefreshToken, issueTokens, loadTokenLifetimes } from "../mcpRefresh.js";
import { REVIEWER_ATTEMPT_LIMIT, reviewerCredentialsMatch, reviewerLoginFromEnv, type ReviewerLoginConfig } from "../auth/reviewerLogin.js";
import { userIsSuspended } from "../auth/suspension.js";

export { MCP_SCOPES } from "../../shared/mcpScopes.js";

type Database = Pick<PrismaClient, "user" | "mcpClient" | "mcpToken" | "auditEvent">;

export type SystemAuthDependencies = { prisma: Database & { magicLink: any }; checkDatabase?: () => Promise<void>; now?: () => Date; sendMagicLink?: (data: { email: string; token: string; expiresAt: Date }) => Promise<void>; reviewerLogin?: ReviewerLoginConfig | null };

const IdSchema = z.string().uuid();
const EmailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const MagicLinkRequestSchema = z.object({ email: EmailSchema }).strict();
const ReviewerSignInSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(200) }).strict();
const MagicLinkVerifySchema = z.object({ token: z.string().trim().min(16).max(512), next: z.string().max(2048).optional() }).strict();
const MCP_RESOURCE = "https://mcp.unwhelm.net/mcp";
const McpRefreshSchema = z.object({ grant_type: z.literal("refresh_token"), refresh_token: z.string().trim().min(16).max(512), client_id: z.string().trim().min(1).max(200), scope: z.string().trim().max(1000).optional(), resource: z.string().trim().min(1).max(2048).optional() });
const McpTokenSchema = z.object({
  grant_type: z.literal("authorization_code"), code: z.string().trim().min(16).max(512),
  client_id: z.string().trim().min(1).max(200), redirect_uri: z.string().trim().min(1).max(2048),
  code_verifier: z.string().trim().min(43).max(128).optional(),
  resource: z.string().trim().min(1).max(2048).optional(),
});
const RegisterSchema = z.object({
  redirect_uris: z.array(z.string().trim().min(1).max(2048)).min(1).max(16),
  client_name: z.string().trim().min(1).max(200).optional(),
  grant_types: z.array(z.string()).max(4).optional(),
  token_endpoint_auth_method: z.string().optional(),
  client_secret: z.string().optional(),
});
const RevokeSchema = z.object({ token: z.string().trim().min(16).max(512).optional() }).strict();

type PendingAuthorization = { clientId: string; userId: string; organizationId: string | null; redirectUri: string; scopes: string[]; codeChallenge?: string; expiresAt: number };
const pendingAuthorizations = new Map<string, PendingAuthorization>();
const magicLinkAttempts = new Map<string, number[]>();
const reviewerLoginAttempts = new Map<string, number[]>();
const registrationAttempts = new Map<string, number[]>();

function requestId(request: Request): string { const supplied = request.header("x-request-id"); return supplied && IdSchema.safeParse(supplied).success ? supplied : randomUUID(); }
function success(response: Response, request: Request, entity: unknown, options: { status?: number; changed?: boolean; links?: Record<string, string> } = {}) {
  response.status(options.status ?? 200).json({ ok: true, ...(options.changed === undefined ? {} : { changed: options.changed }), entity, warnings: [], links: options.links ?? {}, requestId: requestId(request) });
}
function failure(response: Response, request: Request, status: number, code: string, message: string, details?: unknown) {
  response.status(status).json({ ok: false, code, message, retryable: status >= 500 || code === "RATE_LIMITED", ...(details ? { details } : {}), requestId: requestId(request) });
}
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.length > 0 ? value : undefined; }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function organizationFor(request: Request): string | undefined { return request.session.organizationId; }
async function currentUser(deps: SystemAuthDependencies, request: Request) {
  if (!request.session.userId) return null;
  const user = await deps.prisma.user.findUnique({ where: { id: request.session.userId }, include: { memberships: { include: { organization: true } } } });
  if (userIsSuspended(user)) { delete request.session.userId; delete request.session.organizationId; return null; }
  return user;
}
async function requireSession(deps: SystemAuthDependencies, request: Request, response: Response) {
  const user = await currentUser(deps, request); if (!user) { failure(response, request, 401, "AUTH_REQUIRED", "Authentication is required."); return null; } return user;
}
async function requireStaff(deps: SystemAuthDependencies, request: Request, response: Response) {
  const user = await requireSession(deps, request, response); if (!user) return null;
  const organizationId = organizationFor(request);
  const membership = user.memberships.find((item) => item.status === "active" && item.role === "staff" && (!organizationId || item.organizationId === organizationId));
  if (!membership) { failure(response, request, 403, "FORBIDDEN", "Staff access is required."); return null; }
  return { user, membership };
}
function identity(user: any, membership: any) {
  return { user: user ? { id: user.id, email: user.email, displayName: user.displayName, isAdmin: Boolean(user.isAdmin), roles: [...new Set(user.memberships.map((item: any) => item.role))], createdAt: user.createdAt.toISOString() } : null,
    organization: membership?.organization ? { id: membership.organization.id, name: membership.organization.name, slug: membership.organization.slug, createdAt: membership.organization.createdAt.toISOString() } : null,
    membership: membership ? { id: membership.id, userId: membership.userId, organizationId: membership.organizationId, role: membership.role, status: membership.status, permissions: Array.isArray(membership.permissions) ? membership.permissions : [] } : null,
    isAdmin: Boolean(user?.isAdmin),
    authMode: "session" as const };
}
function prunePending(now: number) { for (const [key, value] of pendingAuthorizations) if (value.expiresAt <= now) pendingAuthorizations.delete(key); for (const bucket of [magicLinkAttempts, reviewerLoginAttempts, registrationAttempts]) { for (const [key, values] of bucket) { const recent = values.filter((value) => value > now - 60 * 60_000); if (recent.length) bucket.set(key, recent); else bucket.delete(key); } } }
function allowAttempt(bucket: Map<string, number[]>, key: string, timestamp: number, limit: number): boolean { const recent = (bucket.get(key) ?? []).filter((value) => value > timestamp - 60 * 60_000); if (recent.length >= limit) { bucket.set(key, recent); return false; } recent.push(timestamp); bucket.set(key, recent); return true; }
function allowMagicLink(key: string, timestamp: number): boolean { return allowAttempt(magicLinkAttempts, key, timestamp, 5); }
/** Seconds until the oldest attempt in this key's hour window ages out (at least 1). */
function retryAfter(bucket: Map<string, number[]>, keys: string[], timestamp: number, limit: number): number { let latest = 0; for (const key of keys) { const recent = (bucket.get(key) ?? []).filter((value) => value > timestamp - 60 * 60_000); if (recent.length >= limit) latest = Math.max(latest, recent[0] + 60 * 60_000 - timestamp); } return Math.max(1, Math.ceil(latest / 1000)); }
function magicLinkRetryAfter(keys: string[], timestamp: number): number { return retryAfter(magicLinkAttempts, keys, timestamp, 5); }
function reviewerRetryAfter(keys: string[], timestamp: number): number { return retryAfter(reviewerLoginAttempts, keys, timestamp, REVIEWER_ATTEMPT_LIMIT); }
function prefersJson(request: Request): boolean { return (request.get("content-type") ?? "").includes("application/json"); }
function isAllowedRedirectUri(value: string): boolean {
  if (value.includes("#") || value.includes("\\") || /\s/.test(value)) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return url.hostname.length > 0;
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (["javascript:", "data:", "file:", "blob:", "vbscript:"].includes(url.protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}
function signedInDestination(request: Request, requestedNext: unknown): string {
  if (request.session.mcpAuthorize) return "/api/v1/auth/mcp/authorize/resume";
  return safeNextPath(requestedNext) ?? "/";
}
function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value, "https://unwhelm.net"); } catch { return null; }
  if (url.origin !== "https://unwhelm.net") return null;
  return `${url.pathname}${url.search}`;
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character); }
function oauthDiscovery(origin: string, scopes: readonly string[]) { return { issuer: origin, authorization_endpoint: `${origin}/api/v1/auth/mcp/authorize`, token_endpoint: `${origin}/api/v1/auth/mcp/token`, registration_endpoint: `${origin}/api/v1/auth/mcp/register`, revocation_endpoint: `${origin}/api/v1/auth/mcp/revoke`, scopes_supported: [...scopes], code_challenge_methods_supported: ["S256"], response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"] }; }
function errorPage(response: Response, status: number, message: string) { response.status(status).type("html").send(`<!doctype html><html><head><title>Authorization error</title></head><body><h1>Authorization error</h1><p>${escapeHtml(message)}</p></body></html>`); }
function consentPage(response: Response, name: string, csrf: string, scopes: string[]) { const items = scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join(""); response.status(200).type("html").send(`<!doctype html><html><head><title>Authorize ${escapeHtml(name)}</title></head><body><p><strong>${escapeHtml(name)}</strong> wants access to your Unwhelm account</p><p>This application will be granted:</p><ul>${items}</ul><form method="post" action="/api/v1/auth/mcp/authorize/decision"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit" name="decision" value="allow">Allow</button><button type="submit" name="decision" value="deny">Deny</button></form></body></html>`); }
function signInPage(response: Response, reviewerEnabled: boolean) { const reviewer = reviewerEnabled ? `<h2>App reviewer</h2><form method="post" action="/api/v1/auth/reviewer/signin"><p>Password sign-in is only for the designated review account. Everyone else should use the email link above.</p><label>Email <input type="email" name="email" required autocomplete="username"></label> <label>Password <input type="password" name="password" required autocomplete="current-password"></label> <button type="submit">Sign in</button></form>` : ""; response.status(200).type("html").send(`<!doctype html><html><head><title>Sign in</title></head><body><h1>Sign in</h1><form method="post" action="/api/v1/auth/signin"><label>Email <input type="email" name="email" required autocomplete="email"></label> <button type="submit">Email me a link</button></form><p>The sign-in link has been sent to your email after you submit this form.</p><p>No account? <a href="/request-access">Request access</a></p>${reviewer}</body></html>`); }
function signInSentPage(response: Response) { response.status(200).type("html").send(`<!doctype html><html><head><title>Check your email</title></head><body><h1>Check your email</h1><p>The sign-in link has been sent.</p></body></html>`); }
function regenerateSession(request: Request): Promise<void> { return new Promise((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve())); }

export function createSystemAuthRouter(deps: SystemAuthDependencies): express.Router {
  const router = express.Router(); const now = deps.now ?? (() => new Date());
  const reviewerLogin = deps.reviewerLogin === undefined ? reviewerLoginFromEnv() : deps.reviewerLogin;
  router.use(express.urlencoded({ extended: false }));
  router.get("/.well-known/oauth-authorization-server", async (_request, response, next) => { try { const catalog = await loadActiveCatalog(deps.prisma); response.json(oauthDiscovery(process.env.UNWH_API_PUBLIC_URL ?? "http://127.0.0.1:3201", publicMcpScopes(catalog))); } catch (error) { next(error); } });
  router.get("/.well-known/openid-configuration", async (_request, response, next) => { try { const catalog = await loadActiveCatalog(deps.prisma); response.json(oauthDiscovery(process.env.UNWH_API_PUBLIC_URL ?? "http://127.0.0.1:3201", publicMcpScopes(catalog))); } catch (error) { next(error); } });
  async function scopesForConnector(requested: string, user: { isAdmin?: boolean | null; memberships?: Array<{ status?: string | null; role?: string | null }> } | null) {
    const catalog = await loadActiveCatalog(deps.prisma);
    return connectorTokenScopes({ requested, mcpScopes: catalog.mcpScopes, staffGrants: grantsForRole(catalog, "staff"), isStaffOrAdmin: isStaffOrAdmin(user), staffOnlyScopes: catalog.staffOnlyScopes ?? [] });
  }
  const bearerStaff = new WeakMap<Request, boolean>();
  async function tokenUserIsStaff(userId: string | null | undefined): Promise<boolean> {
    if (!userId || typeof deps.prisma.user?.findUnique !== "function") return false;
    const user = await deps.prisma.user.findUnique({ where: { id: userId }, include: { memberships: true } });
    return isStaffOrAdmin(user as never);
  }
  async function bearerScopes(request: Request): Promise<string[] | undefined> {
    const header = request.header("authorization");
    if (!header?.startsWith("Bearer ")) return undefined;
    const token = header.slice("Bearer ".length).trim();
    if (!token || typeof deps.prisma.mcpToken.findFirst !== "function") return undefined;
    const stored = await deps.prisma.mcpToken.findFirst({ where: { tokenHash: hash(token), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, include: { user: true } });
    if (!stored || userIsSuspended((stored as { user?: { suspendedAt?: Date | null } | null }).user)) return [];
    bearerStaff.set(request, await tokenUserIsStaff((stored as { userId?: string | null }).userId));
    const scopes = (stored as { scopes?: unknown }).scopes;
    return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string") : [];
  }
  router.get("/health", async (request, response, next) => { try { await deps.checkDatabase?.(); const scopes = await bearerScopes(request); success(response, request, { service: "unwh-api", mode: "database", connected: true, ...(scopes !== undefined ? { scopes, staff: bearerStaff.get(request) ?? false } : {}) }); } catch (error) { next(error); } });
  router.get("/me", async (request, response, next) => { try { const user = await requireSession(deps, request, response); if (!user) return; const membership = user.memberships.find((item) => item.status === "active" && (!organizationFor(request) || item.organizationId === organizationFor(request))) ?? user.memberships[0]; success(response, request, identity(user, membership)); } catch (error) { next(error); } });
  router.get("/public/mcp-info", async (request, response, next) => { try { success(response, request, { status: process.env.UNWH_MCP_PUBLIC_URL ? "available" : "not_live", mcpUrl: process.env.UNWH_MCP_PUBLIC_URL ?? null, authorizationServer: process.env.UNWH_MCP_AUTHORIZATION_SERVER ?? process.env.UNWH_AUTHORIZATION_SERVER ?? null, anonymous: await loadAnonymousMcpSettings(deps.prisma as never) }); } catch (error) { next(error); } });
  router.get("/public/pricing", async (request, response, next) => { try { const catalog = await loadActiveCatalog(deps.prisma); success(response, request, { currency: publicCatalogView(catalog).currency, plans: publicCatalogView(catalog).plans }); } catch (error) { next(error); } });
  router.get("/catalog", async (request, response, next) => { try { success(response, request, publicCatalogView(await loadActiveCatalog(deps.prisma))); } catch (error) { next(error); } });
  router.get("/auth/session", async (request, response, next) => { try { const user = await currentUser(deps, request); const mfa = { enrolled: Boolean(user?.totpEnabledAt), verifiedAt: user ? request.session.mfaVerifiedAt ?? null : null }; if (!user) { success(response, request, { ...identity(null, null), authMode: "public", mfa }); return; } const membership = user.memberships.find((item) => item.status === "active" && (!organizationFor(request) || item.organizationId === organizationFor(request))) ?? user.memberships[0]; success(response, request, { ...identity(user, membership), mfa }); } catch (error) { next(error); } });
  router.post("/auth/logout", (request, response) => request.session.destroy((error) => error ? failure(response, request, 500, "INTERNAL_ERROR", "The session could not be closed.") : success(response, request, { loggedOut: true }, { changed: true })));
  async function requestMagicLink(request: Request, email: string): Promise<{ result: "sent" | "accepted" | "limited"; retryAfter?: number }> {
    const issuedAt = now(); prunePending(issuedAt.getTime()); const ip = request.ip || "unknown"; email = email.trim().toLowerCase();
    // Count both keys on every request so a throttled IP cannot keep probing one email, and vice versa.
    const ipAllowed = allowMagicLink(`ip:${ip}`, issuedAt.getTime()); const emailAllowed = allowMagicLink(`email:${email}`, issuedAt.getTime());
    // The limit applies the same way to known and unknown emails, so a 429 does not reveal whether an account exists.
    if (!ipAllowed || !emailAllowed) return { result: "limited", retryAfter: magicLinkRetryAfter([`ip:${ip}`, `email:${email}`], issuedAt.getTime()) };
    const user = await deps.prisma.user.findUnique({ where: { email } });
    if (!user || userIsSuspended(user)) return { result: "accepted" };
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(issuedAt.getTime() + 900_000);
    await deps.prisma.magicLink.create({ data: { email, tokenHash: hash(token), expiresAt, requestIp: ip, userAgent: request.get("user-agent") ?? null } });
    await (deps.sendMagicLink ?? (async ({ email: to, token: rawToken, expiresAt: expiry }) => { const { sendMagicLinkEmail } = await import("../services/magicLinkEmail.js"); await sendMagicLinkEmail({ email: to, token: rawToken, expiresAt: expiry }); }))({ email, token, expiresAt });
    return { result: "sent" };
  }
  router.get("/auth/signin", (_request, response) => { signInPage(response, Boolean(reviewerLogin)); });
  router.post("/auth/signin", async (request, response, next) => { try { const input = MagicLinkRequestSchema.parse(request.body); const { result, retryAfter } = await requestMagicLink(request, input.email); if (result === "limited") { response.setHeader("Retry-After", String(retryAfter)); errorPage(response, 429, "Too many sign-in requests. Please try again later."); return; } signInSentPage(response); } catch (error) { if (error instanceof z.ZodError) errorPage(response, 400, "Enter a valid email address."); else next(error); } });
  router.post("/auth/magic-link/request", async (request, response, next) => { try { const input = MagicLinkRequestSchema.parse(request.body); const { result, retryAfter } = await requestMagicLink(request, input.email); if (result === "limited") { response.setHeader("Retry-After", String(retryAfter)); failure(response, request, 429, "RATE_LIMITED", "Too many sign-in requests. Please try again later."); return; } success(response, request, { accepted: true, expiresInSeconds: 900 }, result === "sent" ? { changed: true } : {}); } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid.", error.issues); else next(error); } });
  async function consumeMagicLink(request: Request, token: string) {
    const issuedAt = now();
    const record = await deps.prisma.magicLink.findFirst({ where: { tokenHash: hash(token), consumedAt: null, expiresAt: { gt: issuedAt } } });
    if (!record) return null;
    const claimed = await deps.prisma.magicLink.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: issuedAt } });
    if (claimed.count !== 1) return null;
    const user = await deps.prisma.user.findUnique({ where: { email: record.email }, include: { memberships: { include: { organization: true } } } });
    if (!user || userIsSuspended(user)) return null;
    const membership = await establishSession(request, user);
    return { user, membership };
  }
  async function establishSession(request: Request, user: { id: string; memberships: Array<{ status: string; organizationId?: string | null }> }) {
    const pending = request.session.mcpAuthorize;
    await regenerateSession(request);
    request.session.userId = user.id;
    const membership = user.memberships.find((item) => item.status === "active") ?? user.memberships[0];
    request.session.organizationId = membership?.organizationId ?? undefined;
    if (pending) request.session.mcpAuthorize = pending;
    return membership;
  }
  function reviewerFailure(request: Request, response: Response, status: number, code: string, message: string, retryAfterSeconds?: number) {
    if (retryAfterSeconds) response.setHeader("Retry-After", String(retryAfterSeconds));
    if (prefersJson(request)) failure(response, request, status, code, message);
    else errorPage(response, status, message);
  }
  async function reviewerAccount(email: string) {
    const include = { memberships: { include: { organization: true } } };
    const existing = await deps.prisma.user.findUnique({ where: { email }, include });
    if (existing) return existing;
    try {
      return await deps.prisma.user.create({ data: { email, displayName: "App reviewer", isAdmin: false }, include });
    } catch (error) {
      const again = await deps.prisma.user.findUnique({ where: { email }, include });
      if (again) return again;
      throw error;
    }
  }
  router.post("/auth/reviewer/signin", async (request, response, next) => {
    try {
      const issuedAt = now();
      prunePending(issuedAt.getTime());
      const ip = request.ip || "unknown";
      const ipKey = `ip:${ip}`;
      if (!allowAttempt(reviewerLoginAttempts, ipKey, issuedAt.getTime(), REVIEWER_ATTEMPT_LIMIT)) {
        reviewerFailure(request, response, 429, "RATE_LIMITED", "Too many sign-in requests. Please try again later.", reviewerRetryAfter([ipKey], issuedAt.getTime()));
        return;
      }
      if (!reviewerLogin) { reviewerFailure(request, response, 404, "NOT_FOUND", "Password sign-in is not enabled."); return; }
      const input = ReviewerSignInSchema.parse(request.body);
      const emailKey = `email:${input.email}`;
      if (!allowAttempt(reviewerLoginAttempts, emailKey, issuedAt.getTime(), REVIEWER_ATTEMPT_LIMIT)) {
        reviewerFailure(request, response, 429, "RATE_LIMITED", "Too many sign-in requests. Please try again later.", reviewerRetryAfter([ipKey, emailKey], issuedAt.getTime()));
        return;
      }
      if (!reviewerCredentialsMatch(reviewerLogin, input.email, input.password)) {
        reviewerFailure(request, response, 401, "AUTH_REQUIRED", "Those credentials were not accepted.");
        return;
      }
      const user = await reviewerAccount(input.email);
      if (userIsSuspended(user)) { reviewerFailure(request, response, 403, "FORBIDDEN", "This account is suspended."); return; }
      if (!user || isStaffOrAdmin(user)) {
        reviewerFailure(request, response, 403, "FORBIDDEN", "Password sign-in is not available for staff or admin accounts.");
        return;
      }
      const membership = await establishSession(request, user);
      if (prefersJson(request)) {
        const redirectTo = request.session.mcpAuthorize ? "/api/v1/auth/mcp/authorize/resume" : undefined;
        success(response, request, { ...identity(user, membership), ...(redirectTo ? { redirectTo } : {}) }, { changed: true });
        return;
      }
      response.redirect(signedInDestination(request, undefined));
    } catch (error) {
      if (error instanceof z.ZodError) reviewerFailure(request, response, 400, "VALIDATION_FAILED", "Enter the reviewer email and password.");
      else next(error);
    }
  });
  router.get("/auth/magic-link", async (request, response, next) => { try { const token = stringValue(request.query.token); const signedIn = token ? await consumeMagicLink(request, token) : null; if (!signedIn) { failure(response, request, 400, "OAUTH_INVALID_GRANT", "The magic link is invalid or expired."); return; } response.redirect(signedInDestination(request, request.query.next)); } catch (error) { next(error); } });
  router.post("/auth/magic-link/verify", async (request, response, next) => { try { const input = MagicLinkVerifySchema.parse(request.body); const signedIn = await consumeMagicLink(request, input.token); if (!signedIn) { failure(response, request, 400, "OAUTH_INVALID_GRANT", "The magic link is invalid or expired."); return; } const redirectTo = request.session.mcpAuthorize ? "/api/v1/auth/mcp/authorize/resume" : safeNextPath(input.next); success(response, request, { ...identity(signedIn.user, signedIn.membership), ...(redirectTo ? { redirectTo } : {}) }, { changed: true }); } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid.", error.issues); else next(error); } });
  router.get("/auth/google/start", (request, response) => { const callback = process.env.UNWH_GOOGLE_CALLBACK_URL; if (!process.env.UNWH_GOOGLE_CLIENT_ID || !callback) { success(response, request, { configured: false, provider: "google" }); return; } const url = new URL("https://accounts.google.com/o/oauth2/v2/auth"); url.searchParams.set("client_id", process.env.UNWH_GOOGLE_CLIENT_ID); url.searchParams.set("redirect_uri", callback); url.searchParams.set("response_type", "code"); url.searchParams.set("scope", "openid email profile"); url.searchParams.set("state", randomBytes(24).toString("base64url")); response.redirect(url.toString()); });
  router.get("/auth/google/callback", (request, response) => { if (!stringValue(request.query.code)) { failure(response, request, 400, "OAUTH_INVALID_GRANT", "Google did not return an authorization code."); return; } failure(response, request, 501, "NOT_IMPLEMENTED", "Google token exchange is not configured for this local route module."); });
  function redirectError(redirectUri: string, error: string, state?: string) { const location = new URL(redirectUri); location.searchParams.set("error", error); if (state) location.searchParams.set("state", state); return location.toString(); }
  async function loadAuthorizeClient(clientId: string | undefined, redirectUri: string | undefined) {
    if (!clientId || !redirectUri) return null;
    const client = await deps.prisma.mcpClient.findUnique({ where: { clientId } });
    const registeredUris = Array.isArray(client?.redirectUris) ? client.redirectUris as string[] : [];
    if (!client || !registeredUris.includes(redirectUri)) return null;
    return client;
  }
  async function showConsent(request: Request, response: Response) {
    const pending = request.session.mcpAuthorize;
    if (!pending) { errorPage(response, 400, "The authorization request expired. Start again from the application."); return; }
    const user = await currentUser(deps, request);
    consentPage(response, pending.clientName, pending.csrf, await scopesForConnector(pending.scope, user));
  }
  router.post("/auth/mcp/register", async (request, response, next) => { try {
    const issuedAt = now(); prunePending(issuedAt.getTime()); void pruneUnusedDcrClients(deps.prisma, issuedAt).catch(() => undefined);
    if (!allowAttempt(registrationAttempts, `ip:${request.ip || "unknown"}`, issuedAt.getTime(), 10)) { failure(response, request, 429, "RATE_LIMITED", "Too many client registrations. Please try again later."); return; }
    const input = RegisterSchema.parse(request.body);
    if (input.client_secret) { failure(response, request, 400, "VALIDATION_FAILED", "A client secret is not accepted."); return; }
    if (input.grant_types && !input.grant_types.includes("authorization_code")) { failure(response, request, 400, "VALIDATION_FAILED", "authorization_code is required."); return; }
    if (input.redirect_uris.some((uri) => !isAllowedRedirectUri(uri))) { failure(response, request, 400, "VALIDATION_FAILED", "A redirect URI is not allowed."); return; }
    const clientId = randomBytes(24).toString("base64url");
    await deps.prisma.mcpClient.create({ data: { clientId, name: input.client_name ?? "MCP client", redirectUris: input.redirect_uris, scopes: [], secretHash: null } });
    response.status(201).json({ client_id: clientId, client_id_issued_at: Math.floor(issuedAt.getTime() / 1000), redirect_uris: input.redirect_uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid.", error.issues); else next(error); } });
  router.get("/auth/mcp/authorize", async (request, response, next) => { try {
    const clientId = stringValue(request.query.client_id);
    const redirectUri = stringValue(request.query.redirect_uri);
    const client = await loadAuthorizeClient(clientId, redirectUri);
    if (!client || !clientId || !redirectUri) { errorPage(response, 400, "The client or redirect URI is not registered."); return; }
    const state = stringValue(request.query.state);
    const resource = stringValue(request.query.resource);
    if (stringValue(request.query.response_type) !== "code" || stringValue(request.query.code_challenge_method) !== "S256" || !stringValue(request.query.code_challenge) || (resource && resource !== MCP_RESOURCE)) { response.redirect(redirectError(redirectUri, resource && resource !== MCP_RESOURCE ? "invalid_target" : "invalid_request", state)); return; }
    request.session.mcpAuthorize = { clientId, clientName: client.name, redirectUri, codeChallenge: stringValue(request.query.code_challenge)!, state, scope: stringValue(request.query.scope) ?? "", csrf: randomBytes(24).toString("base64url") };
    const user = await currentUser(deps, request);
    if (!user) { response.redirect("/api/v1/auth/signin"); return; }
    await showConsent(request, response);
  } catch (error) { next(error); } });
  router.get("/auth/mcp/authorize/resume", async (request, response, next) => { try { const user = await currentUser(deps, request); if (!user) { response.redirect("/api/v1/auth/signin"); return; } await showConsent(request, response); } catch (error) { next(error); } });
  router.post("/auth/mcp/authorize/decision", async (request, response, next) => { try {
    const user = await currentUser(deps, request);
    const pending = request.session.mcpAuthorize;
    if (!user || !pending) { errorPage(response, 401, "Sign in before approving this application."); return; }
    const decision = stringValue(request.body?.decision);
    const csrf = stringValue(request.body?.csrf);
    if (!csrf || csrf !== pending.csrf) { errorPage(response, 403, "The approval form could not be verified."); return; }
    delete request.session.mcpAuthorize;
    if (decision === "deny") { response.redirect(redirectError(pending.redirectUri, "access_denied", pending.state)); return; }
    if (decision !== "allow") { errorPage(response, 400, "Choose Allow or Deny."); return; }
    const code = randomBytes(32).toString("base64url");
    const scopes = await scopesForConnector(pending.scope, user); pendingAuthorizations.set(code, { clientId: pending.clientId, userId: user.id, organizationId: organizationFor(request) ?? null, redirectUri: pending.redirectUri, scopes, codeChallenge: pending.codeChallenge, expiresAt: now().getTime() + 300_000 });
    const location = new URL(pending.redirectUri); location.searchParams.set("code", code); if (pending.state) location.searchParams.set("state", pending.state); response.redirect(location.toString());
  } catch (error) { next(error); } });
  router.post("/auth/mcp/token", async (request, response, next) => { try { if (request.body?.grant_type === "refresh_token") { const refreshInput = McpRefreshSchema.parse(request.body); if (refreshInput.resource && refreshInput.resource !== MCP_RESOURCE) { failure(response, request, 400, "VALIDATION_FAILED", "The resource is not the Unwhelm MCP server."); return; } const result = await exchangeRefreshToken(deps.prisma as never, { refreshToken: refreshInput.refresh_token, clientId: refreshInput.client_id, scope: refreshInput.scope }, await loadTokenLifetimes(deps.prisma as never), now()); if (!result.ok) { failure(response, request, 400, result.reason === "scope_widened" ? "OAUTH_INVALID_SCOPE" : "OAUTH_INVALID_GRANT", result.reason === "scope_widened" ? "A refresh cannot add scopes." : "The refresh token is invalid, expired, or already used."); return; } response.json(result.tokens); return; } const input = McpTokenSchema.parse(request.body); if (input.resource && input.resource !== MCP_RESOURCE) { failure(response, request, 400, "VALIDATION_FAILED", "The resource is not the Unwhelm MCP server."); return; } prunePending(now().getTime()); const pending = pendingAuthorizations.get(input.code); if (pending) pendingAuthorizations.delete(input.code); if (!pending || pending.clientId !== input.client_id || pending.redirectUri !== input.redirect_uri || !input.code_verifier) { failure(response, request, 400, "OAUTH_INVALID_GRANT", "The authorization code is invalid, expired, or missing its code verifier."); return; } const verifierChallenge = createHash("sha256").update(input.code_verifier).digest("base64url"); if (verifierChallenge !== pending.codeChallenge) { failure(response, request, 400, "OAUTH_INVALID_GRANT", "The code verifier does not match the authorization request."); return; } const client = await deps.prisma.mcpClient.findUniqueOrThrow({ where: { clientId: pending.clientId } }); /* Access and refresh lifetimes come from mcp_token_setting. */ response.json(await issueTokens(deps.prisma as never, { clientRowId: client.id, userId: pending.userId, scopes: pending.scopes }, await loadTokenLifetimes(deps.prisma as never), now())); } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid.", error.issues); else next(error); } });
  router.post("/auth/mcp/revoke", async (request, response, next) => { try { const auth = request.header("authorization"); const input = RevokeSchema.parse(request.body ?? {}); const token = input.token ?? (auth?.startsWith("Bearer ") ? auth.slice(7) : undefined); if (!token) { failure(response, request, 401, "AUTH_REQUIRED", "A bearer token is required."); return; } await deps.prisma.mcpToken.updateMany({ where: { tokenHash: hash(token), revokedAt: null }, data: { revokedAt: now() } }); success(response, request, { revoked: true }, { changed: true }); } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid.", error.issues); else next(error); } });
  router.get("/auth/mcp/clients", async (request, response, next) => { try { const staff = await requireStaff(deps, request, response); if (!staff) return; const organizationId = organizationFor(request); const clients = await deps.prisma.mcpClient.findMany({ where: organizationId ? { organizationId } : undefined, orderBy: { createdAt: "desc" } }); success(response, request, { items: clients.map((client) => ({ id: client.id, clientId: client.clientId, name: client.name, redirectUris: client.redirectUris, scopes: client.scopes, createdAt: client.createdAt.toISOString() })), nextCursor: null, totalEstimate: clients.length }); } catch (error) { next(error); } });
  router.delete("/auth/mcp/clients/:id", async (request, response, next) => { try { const staff = await requireStaff(deps, request, response); if (!staff) return; const id = z.string().uuid().safeParse(request.params.id); if (!id.success) { failure(response, request, 400, "VALIDATION_FAILED", "The client id is not valid."); return; } const organizationId = organizationFor(request); const removed = await deps.prisma.mcpClient.deleteMany({ where: { id: id.data, ...(organizationId ? { organizationId } : {}) } }); if (!removed.count) { failure(response, request, 404, "NOT_FOUND", "The MCP client was not found."); return; } success(response, request, { deleted: true, id: id.data }, { changed: true }); } catch (error) { next(error); } });
  router.post("/auth/mcp/clients/prune", async (request, response, next) => { try { const staff = await requireStaff(deps, request, response); if (!staff) return; const removed = await pruneUnusedDcrClients(deps.prisma, now()); success(response, request, { pruned: removed }, { changed: removed > 0 }); } catch (error) { next(error); } });  router.get("/operation-log", async (request, response, next) => { try { const staff = await requireStaff(deps, request, response); if (!staff) return; const organizationId = organizationFor(request); const limit = Math.min(Math.max(Number(request.query.limit ?? 25) || 25, 1), 100); const events = await deps.prisma.auditEvent.findMany({ where: organizationId ? { organizationId } : undefined, orderBy: { createdAt: "desc" }, take: limit + 1 }); const items = events.slice(0, limit).map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })); success(response, request, { items, nextCursor: events.length > limit ? items.at(-1)?.id ?? null : null, totalEstimate: null }); } catch (error) { next(error); } });
  router.use((error: unknown, request: Request, response: Response, next: NextFunction) => { if (error instanceof z.ZodError) { failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid.", error.issues); return; } next(error); });
  return router;
}

export const systemAuthRouter = createSystemAuthRouter;
