import { createHash, randomBytes, randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "../prismaClient.js";
import type {} from "../sessionTypes.js";
import { requireAdminMfa } from "../auth/adminMfa.js";
import { userIsSuspended } from "../auth/suspension.js";
import { magicLinkUrl, mintMagicLinkMaterial } from "../services/magicLinkMint.js";
import { MCP_SCOPES } from "../../shared/mcpScopes.js";

const TOKEN_SCOPES = MCP_SCOPES;
const MINT_LIMIT = 20;
const HOUR_MS = 60 * 60 * 1000;
const mintAttempts = new Map<string, number[]>();

const EmailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const RoleSchema = z.enum(["prospect", "client", "staff"]);
const OrgNameSchema = z.string().trim().min(1).max(200);
const CreateUserSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1).max(200),
  orgId: z.string().uuid().optional(),
  orgName: OrgNameSchema.optional(),
  role: RoleSchema.optional(),
}).strict().refine((value) => !(value.orgId && value.orgName), { message: "Give orgId or orgName, not both." })
  .refine((value) => !value.role || Boolean(value.orgId || value.orgName), { message: "role needs orgId or orgName." });
const CreateOrgSchema = z.object({ name: OrgNameSchema }).strict();
const AddMemberSchema = z.object({ userId: z.string().uuid(), role: RoleSchema.optional() }).strict();
const CreateTokenSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).optional(),
  preset: z.string().trim().min(1).max(100).optional(),
  expiresInDays: z.number().int().min(1).max(365).default(90),
}).strict().refine((value) => Boolean(value.scopes?.length || value.preset), { message: "Give scopes or a preset." });

class AdminInputError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

export function slugifyOrgName(name: string) {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug || "org";
}

type OrgDb = Pick<PrismaClient, "organization" | "membership" | "membershipRoleOption">;

async function uniqueSlug(db: OrgDb, name: string) {
  const base = slugifyOrgName(name);
  if (!await db.organization.findUnique({ where: { slug: base } })) return base;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base}-${randomBytes(3).toString("hex")}`;
    if (!await db.organization.findUnique({ where: { slug: candidate } })) return candidate;
  }
  throw new AdminInputError(409, "CONFLICT", "Could not pick a unique organization slug.");
}

/** Resolves the role from membership_role_option rows: the given one must be assignable, otherwise the default row is used. */
async function resolveRole(db: OrgDb, role: z.infer<typeof RoleSchema> | undefined) {
  const options = await db.membershipRoleOption.findMany({ orderBy: { sortOrder: "asc" } });
  const chosen = role ? options.find((option) => option.role === role && option.assignable) : options.find((option) => option.defaultForNewMember && option.assignable);
  if (!chosen) throw new AdminInputError(role ? 422 : 500, role ? "ROLE_NOT_ASSIGNABLE" : "ROLE_DEFAULT_MISSING", role ? `The role ${role} cannot be assigned.` : "No default membership role is configured.");
  return chosen.role;
}

async function addMember(db: OrgDb, organizationId: string, userId: string, role: z.infer<typeof RoleSchema>) {
  return db.membership.upsert({
    where: { userId_organizationId: { userId, organizationId } },
    create: { userId, organizationId, role, status: "active", permissions: {} },
    update: { role, status: "active" },
  });
}

type MembershipWithOrg = { organizationId: string; role: string; status: string; organization?: { id: string; name: string; slug: string } | null };
function orgView(org: { id: string; name: string; slug: string; createdAt: Date }) { return { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt.toISOString() }; }
function membershipsView(memberships: MembershipWithOrg[] | undefined) {
  return (memberships ?? []).map((item) => ({ orgId: item.organizationId, orgName: item.organization?.name ?? null, orgSlug: item.organization?.slug ?? null, role: item.role, status: item.status }));
}
function adminInputFailure(response: Response, request: Request, error: unknown) {
  if (error instanceof z.ZodError) { failure(response, request, 400, "VALIDATION_FAILED", error.issues[0]?.message && error.issues[0].code === "custom" ? error.issues[0].message : "The request is not valid."); return true; }
  if (error instanceof AdminInputError) { failure(response, request, error.status, error.code, error.message); return true; }
  return false;
}

function accessRequestView(row: { id: string; email: string; name: string; company: string | null; role: string | null; reason: string; referral: string | null; status: string; reviewedBy: string | null; reviewedAt: Date | null; reviewNote: string | null; createdAt: Date }) {
  return { id: row.id, email: row.email, name: row.name, company: row.company, role: row.role, reason: row.reason, referral: row.referral, status: row.status, reviewedBy: row.reviewedBy, reviewedAt: row.reviewedAt?.toISOString() ?? null, reviewNote: row.reviewNote, createdAt: row.createdAt.toISOString() };
}

/** Creates a non-admin user if needed and a client membership in UNWH_TRIAL_ORG_ID. Never assigns staff or isAdmin. */
export async function approveAccessRequest(prisma: PrismaClient, input: { id: string; reviewerId: string; note?: string; now: Date }) {
  const orgId = process.env.UNWH_TRIAL_ORG_ID?.trim() ?? "";
  if (!orgId) throw new AdminInputError(409, "TRIAL_ORG_UNCONFIGURED", "Set UNWH_TRIAL_ORG_ID to the trial organization before approving. Nothing was changed.");
  const parsedOrg = z.string().uuid().safeParse(orgId);
  if (!parsedOrg.success) throw new AdminInputError(409, "TRIAL_ORG_UNCONFIGURED", "UNWH_TRIAL_ORG_ID is not a valid organization id. Nothing was changed.");
  const org = await prisma.organization.findUnique({ where: { id: parsedOrg.data } });
  if (!org) throw new AdminInputError(409, "TRIAL_ORG_UNCONFIGURED", "UNWH_TRIAL_ORG_ID does not match an organization. Nothing was changed.");
  const row = await prisma.accessRequest.findUnique({ where: { id: input.id } });
  if (!row) throw new AdminInputError(404, "NOT_FOUND", "Access request not found.");
  if (row.status !== "pending") throw new AdminInputError(409, "CONFLICT", "This request was already reviewed.");
  const existing = await prisma.user.findUnique({ where: { email: row.email } });
  const user = existing ?? await prisma.user.create({ data: { email: row.email, displayName: row.name, isAdmin: false } });
  if (user.isAdmin) throw new AdminInputError(409, "CONFLICT", "This email already belongs to an admin. Approval will not change that account.");
  const membership = await prisma.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } } });
  const role = membership?.role === "staff" ? "staff" : "client";
  if (!membership) {
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "client", status: "active", permissions: [] } });
  } else if (membership.role !== "staff") {
    await prisma.membership.update({ where: { id: membership.id }, data: { role: "client", status: "active" } });
  }
  await prisma.accessRequest.update({ where: { id: row.id }, data: { status: "approved", reviewedBy: input.reviewerId, reviewedAt: input.now, reviewNote: input.note ?? null } });
  return { email: row.email, userId: user.id, organizationId: org.id, role };
}

export type AdminDependencies = { prisma: PrismaClient; now?: () => Date };

export type AdminActor = { userId: string; via: "session" | "bearer"; tokenId: string | null };

function requestId(request: Request) {
  const supplied = request.header("x-request-id");
  return supplied && z.string().uuid().safeParse(supplied).success ? supplied : randomUUID();
}
function success(response: Response, request: Request, entity: unknown, status = 200) {
  const warning = response.locals.mfaWarning;
  const warnings = typeof warning === "string" ? [warning] : [];
  response.status(status).json({ ok: true, entity, warnings, links: {}, requestId: requestId(request) });
}
function failure(response: Response, request: Request, status: number, code: string, message: string) {
  response.status(status).json({ ok: false, code, message, retryable: status >= 500 || status === 429, requestId: requestId(request) });
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function scopesOf(value: unknown): string[] { return Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === "string") : []; }

export function clearAdminMintLimit() { mintAttempts.clear(); }

function allowMint(userId: string, timestamp: number) {
  const recent = (mintAttempts.get(userId) ?? []).filter((value) => value > timestamp - HOUR_MS);
  if (recent.length >= MINT_LIMIT) { mintAttempts.set(userId, recent); return false; }
  recent.push(timestamp);
  mintAttempts.set(userId, recent);
  return true;
}

export async function resolveAdmin(deps: AdminDependencies, request: Request): Promise<AdminActor | null> {
  const authorization = request.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const raw = authorization.slice("Bearer ".length).trim();
    if (!raw) return null;
    const stored = await deps.prisma.mcpToken.findFirst({
      where: { tokenHash: hash(raw), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { user: true, client: true },
    });
    if (!stored?.user?.isAdmin || userIsSuspended(stored.user) || !scopesOf(stored.scopes).includes("admin")) return null;
    return { userId: stored.user.id, via: "bearer", tokenId: stored.id };
  }
  if (!request.session?.userId) return null;
  const user = await deps.prisma.user.findUnique({ where: { id: request.session.userId } });
  if (!user?.isAdmin || userIsSuspended(user)) return null;
  return { userId: user.id, via: "session", tokenId: null };
}

export function requireAdmin(deps: AdminDependencies) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const actor = await resolveAdmin(deps, request);
    if (!actor) { failure(response, request, 403, "FORBIDDEN", "Admin access is required."); return; }
    response.locals.admin = actor;
    next();
  };
}

async function writeAudit(deps: AdminDependencies, request: Request, actor: AdminActor, event: { operation: string; recordType: string; recordId: string; inputRedacted: Record<string, unknown>; statusCode: number }) {
  const previous = await deps.prisma.auditEvent.findFirst({ orderBy: { createdAt: "desc" } });
  const previousHash = previous?.hash ?? null;
  const digest = hash(JSON.stringify({ previousHash, operation: event.operation, actorUserId: actor.userId, recordType: event.recordType, recordId: event.recordId, inputRedacted: event.inputRedacted }));
  await deps.prisma.auditEvent.create({
    data: {
      actorUserId: actor.userId,
      tokenId: actor.tokenId,
      operation: event.operation,
      method: request.method,
      path: request.path,
      recordType: event.recordType,
      recordId: event.recordId,
      requestId: requestId(request),
      inputRedacted: event.inputRedacted as never,
      statusCode: event.statusCode,
      previousHash,
      hash: digest,
    },
  });
}

function userView(user: { id: string; email: string; displayName: string; isAdmin: boolean; createdAt: Date; suspendedAt?: Date | null }) {
  return { id: user.id, email: user.email, name: user.displayName, isAdmin: user.isAdmin, suspendedAt: user.suspendedAt ? user.suspendedAt.toISOString() : null, createdAt: user.createdAt.toISOString() };
}

function secretEntity(actor: AdminActor, id: string, expiresAt: Date, secret: Record<string, string>) {
  if (actor.via === "bearer") return { id, expiresAt: expiresAt.toISOString(), message: "copy it from /admin" };
  return { id, expiresAt: expiresAt.toISOString(), ...secret };
}

export function adminPageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Admin</title>
  <style>
    body { font-family: Georgia, serif; margin: 2rem; color: #1c1915; background: #f7f4ee; }
    h1, h2 { font-weight: normal; }
    section { margin: 2rem 0; }
    table { border-collapse: collapse; width: 100%; background: #fff; }
    th, td { border-bottom: 1px solid #ddd; text-align: left; padding: 0.45rem 0.6rem; vertical-align: top; }
    form, .secret { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: end; margin: 0.8rem 0; }
    label { display: flex; flex-direction: column; font-size: 0.85rem; gap: 0.2rem; }
    input, button { font: inherit; }
    .secret { background: #fff; border: 1px solid #ccc; padding: 0.6rem; }
    code { word-break: break-all; }
  </style>
</head>
<body>
  <h1>Admin</h1>
  <section>
    <h2>Users</h2>
    <form id="add-user">
      <label>Email <input name="email" type="email" required></label>
      <label>Name <input name="name" required></label>
      <button type="submit">Add user</button>
    </form>
    <table><thead><tr><th>Email</th><th>Name</th><th>Admin</th><th>Suspended</th><th></th></tr></thead><tbody id="users"></tbody></table>
    <div id="link-once"></div>
  </section>
  <section>
    <h2>Tokens</h2>
    <form id="mint-token">
      <label>User <select name="userId" id="token-user" required></select></label>
      <label>Name <input name="name" required></label>
      <fieldset>
        <legend>Permissions</legend>
        ${TOKEN_SCOPES.map((scope) => `<label><span><input type="checkbox" name="scopes" value="${scope}"> ${scope}</span></label>`).join("")}
      </fieldset>
      <label>Expiry days <input name="expiresInDays" type="number" min="1" max="365" value="90"></label>
      <button type="submit">Mint token</button>
    </form>
    <div id="token-once"></div>
    <table><thead><tr><th>Name</th><th>Owner</th><th>Permissions</th><th>Last used</th><th>Expiry</th><th></th></tr></thead><tbody id="tokens"></tbody></table>
  </section>
  <section>
    <h2>Access requests</h2>
    <p>Approving creates a client in the trial organization and does not send email. The person then uses Email me a link on the sign-in page.</p>
    <table><thead><tr><th>When</th><th>Email</th><th>Name</th><th>Why</th><th>Status</th><th></th></tr></thead><tbody id="requests"></tbody></table>
  </section>
  <section>
    <h2>Audit</h2>
    <table><thead><tr><th>When</th><th>Type</th><th>Actor</th><th>Target</th></tr></thead><tbody id="audit"></tbody></table>
  </section>
  <script>
    async function api(path, options) {
      const response = await fetch(path, { credentials: "same-origin", headers: { "content-type": "application/json" }, ...options });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.message || "Request failed");
      return body.entity;
    }
    function once(container, label, value, expiresAt) {
      container.innerHTML = "";
      const box = document.createElement("div");
      box.className = "secret";
      const code = document.createElement("code");
      code.textContent = value;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => navigator.clipboard.writeText(value));
      box.append(label + " ", code, " expires " + expiresAt + " ", copy);
      container.append(box);
    }
    async function load() {
      const [users, tokens, audit, requests] = await Promise.all([
        api("/api/v1/admin/users"),
        api("/api/v1/admin/tokens"),
        api("/api/v1/admin/audit?limit=100"),
        api("/api/v1/admin/access-requests"),
      ]);
      const usersBody = document.querySelector("#users");
      const tokenUser = document.querySelector("#token-user");
      usersBody.replaceChildren();
      tokenUser.replaceChildren();
      for (const user of users.items) {
        const option = document.createElement("option");
        option.value = user.id;
        option.textContent = user.email;
        tokenUser.append(option);
        const row = document.createElement("tr");
        const action = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Sign-in link";
        button.addEventListener("click", async () => {
          const minted = await api("/api/v1/admin/users/" + user.id + "/magic-link", { method: "POST" });
          if (minted.link) once(document.querySelector("#link-once"), "Sign-in link", minted.link, minted.expiresAt);
        });
        action.append(button);
        const suspend = document.createElement("button");
        suspend.type = "button";
        suspend.textContent = user.suspendedAt ? "Unsuspend" : "Suspend";
        suspend.addEventListener("click", async () => {
          await api("/api/v1/admin/users/" + user.id + (user.suspendedAt ? "/unsuspend" : "/suspend"), { method: "POST", body: "{}" });
          await load();
        });
        action.append(suspend);
        row.append(cell(user.email), cell(user.name), cell(user.isAdmin ? "yes" : "no"), cell(user.suspendedAt ? "yes" : "no"), action);
        usersBody.append(row);
      }
      const tokensBody = document.querySelector("#tokens");
      tokensBody.replaceChildren();
      for (const token of tokens.items) {
        const action = document.createElement("td");
        if (!token.revokedAt) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Revoke";
          button.addEventListener("click", async () => {
            if (!confirm("Revoke " + token.name + "?")) return;
            await api("/api/v1/admin/tokens/" + token.id, { method: "DELETE" });
            await load();
          });
          action.append(button);
        }
        const row = document.createElement("tr");
        row.append(cell(token.name), cell(token.owner), cell(token.scopes.join(", ")), cell(token.lastUsed || "—"), cell(token.expiresAt || "—"), action);
        tokensBody.append(row);
      }
      const requestsBody = document.querySelector("#requests");
      requestsBody.replaceChildren();
      for (const item of requests.items) {
        const action = document.createElement("td");
        if (item.status === "pending") {
          const approve = document.createElement("button");
          approve.type = "button";
          approve.textContent = "Approve";
          approve.addEventListener("click", async () => {
            const result = await api("/api/v1/admin/access-requests/" + item.id + "/approve", { method: "POST", body: "{}" });
            window.alert(result.message);
            await load();
          });
          const reject = document.createElement("button");
          reject.type = "button";
          reject.textContent = "Reject";
          reject.addEventListener("click", async () => {
            const note = window.prompt("Note for this rejection (optional)") ?? "";
            await api("/api/v1/admin/access-requests/" + item.id + "/reject", { method: "POST", body: JSON.stringify({ note }) });
            await load();
          });
          action.append(approve, reject);
        }
        const row = document.createElement("tr");
        row.append(cell(item.createdAt), cell(item.email), cell(item.name), cell(item.reason), cell(item.status), action);
        requestsBody.append(row);
      }
      const auditBody = document.querySelector("#audit");
      auditBody.replaceChildren();
      for (const event of audit.items) {
        const row = document.createElement("tr");
        row.append(cell(event.createdAt), cell(event.operation), cell(event.actorUserId || "—"), cell(event.recordId || "—"));
        auditBody.append(row);
      }
    }
    function cell(text) { const td = document.createElement("td"); td.textContent = text; return td; }
    document.querySelector("#add-user").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await api("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ email: form.email.value, name: form.name.value }) });
      form.reset();
      await load();
    });
    document.querySelector("#mint-token").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const selected = [...form.querySelectorAll('input[name="scopes"]:checked')].map((input) => input.value);
      const minted = await api("/api/v1/admin/tokens", { method: "POST", body: JSON.stringify({ userId: form.userId.value, name: form.name.value, scopes: selected, expiresInDays: Number(form.expiresInDays.value) }) });
      if (minted.token) once(document.querySelector("#token-once"), "Token", minted.token, minted.expiresAt);
      form.name.value = "";
      await load();
    });
    load().catch((error) => { document.body.prepend(cell(error.message)); });
  </script>
</body>
</html>`;
}

/** Deletes a proposal and its dependent rows (DB cascades) in one transaction. Refused when a Contract references it. */
export async function deleteProposalCascade(prisma: PrismaClient, id: string): Promise<"not_found" | "has_contract" | { title: string; reviewState: string }> {
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.proposal.findUnique({ where: { id } });
    if (!proposal) return "not_found" as const;
    if (await tx.contract.count({ where: { proposalId: id } }) > 0) return "has_contract" as const;
    await tx.proposal.update({ where: { id }, data: { approvedVersionId: null } });
    await tx.proposal.delete({ where: { id } });
    return { title: proposal.title, reviewState: proposal.reviewState };
  });
}

export function createAdminRouter(deps: AdminDependencies) {
  const router = express.Router();
  const now = deps.now ?? (() => new Date());
  const guard = requireAdmin(deps);
  const mfaGuard = requireAdminMfa(deps);
  const actorOf = (response: Response) => response.locals.admin as AdminActor;

  router.get("/admin/users", guard, mfaGuard, async (request, response, next) => {
    try {
      const users = await deps.prisma.user.findMany({ orderBy: { email: "asc" }, include: { memberships: { include: { organization: true } } } });
      success(response, request, { items: users.map((user) => {
        const memberships = membershipsView((user as { memberships?: MembershipWithOrg[] }).memberships);
        const active = memberships.find((item) => item.status === "active") ?? null;
        return { ...userView(user), org: active ? { id: active.orgId, name: active.orgName, slug: active.orgSlug, role: active.role } : null, memberships };
      }) });
    } catch (error) { next(error); }
  });

  router.get("/admin/orgs", guard, mfaGuard, async (request, response, next) => {
    try {
      const orgs = await deps.prisma.organization.findMany({ orderBy: { name: "asc" }, include: { memberships: { include: { user: true } } } });
      success(response, request, { items: orgs.map((org) => ({ ...orgView(org), members: org.memberships.map((item) => ({ userId: item.userId, email: item.user.email, role: item.role, status: item.status })) })) });
    } catch (error) { next(error); }
  });

  router.post("/admin/orgs", guard, mfaGuard, async (request, response, next) => {
    try {
      const input = CreateOrgSchema.parse(request.body);
      const actor = actorOf(response);
      const org = await deps.prisma.organization.create({ data: { name: input.name, slug: await uniqueSlug(deps.prisma, input.name) } });
      await writeAudit(deps, request, actor, { operation: "admin.org.create", recordType: "Organization", recordId: org.id, inputRedacted: { name: org.name, slug: org.slug }, statusCode: 201 });
      success(response, request, orgView(org), 201);
    } catch (error) { if (!adminInputFailure(response, request, error)) next(error); }
  });

  router.post("/admin/orgs/:id/members", guard, mfaGuard, async (request, response, next) => {
    try {
      const organizationId = z.string().uuid().parse(request.params.id);
      const input = AddMemberSchema.parse(request.body);
      const actor = actorOf(response);
      const org = await deps.prisma.organization.findUnique({ where: { id: organizationId } });
      if (!org) { failure(response, request, 404, "NOT_FOUND", "Organization not found."); return; }
      const user = await deps.prisma.user.findUnique({ where: { id: input.userId } });
      if (!user) { failure(response, request, 404, "NOT_FOUND", "User not found."); return; }
      const role = await resolveRole(deps.prisma, input.role);
      const membership = await addMember(deps.prisma, org.id, user.id, role);
      await writeAudit(deps, request, actor, { operation: "admin.org.member.add", recordType: "Membership", recordId: membership.id, inputRedacted: { organizationId: org.id, userId: user.id, role }, statusCode: 201 });
      success(response, request, { id: membership.id, orgId: org.id, orgName: org.name, userId: user.id, role: membership.role, status: membership.status }, 201);
    } catch (error) { if (!adminInputFailure(response, request, error)) next(error); }
  });

  router.get("/admin/scope-presets", guard, mfaGuard, async (request, response, next) => {
    try {
      const presets = await deps.prisma.scopePreset.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
      success(response, request, { items: presets.map((preset) => ({ code: preset.code, label: preset.label, scopes: preset.scopes })) });
    } catch (error) { next(error); }
  });

  router.post("/admin/users", guard, mfaGuard, async (request, response, next) => {
    try {
      const input = CreateUserSchema.parse(request.body);
      const actor = actorOf(response);
      const existing = await deps.prisma.user.findUnique({ where: { email: input.email } });
      if (existing) { failure(response, request, 409, "CONFLICT", "A user with that email already exists."); return; }
      if (!input.orgId && !input.orgName) {
        const user = await deps.prisma.user.create({ data: { email: input.email, displayName: input.name, isAdmin: false } });
        await writeAudit(deps, request, actor, { operation: "admin.user.create", recordType: "User", recordId: user.id, inputRedacted: { email: user.email }, statusCode: 201 });
        success(response, request, { ...userView(user), org: null }, 201);
        return;
      }
      const result = await deps.prisma.$transaction(async (tx) => {
        let org = input.orgId ? await tx.organization.findUnique({ where: { id: input.orgId } }) : await tx.organization.findFirst({ where: { name: { equals: input.orgName, mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
        if (input.orgId && !org) throw new AdminInputError(404, "NOT_FOUND", "Organization not found.");
        const createdOrg = !org;
        if (!org) org = await tx.organization.create({ data: { name: input.orgName ?? "", slug: await uniqueSlug(tx, input.orgName ?? "") } });
        const role = await resolveRole(tx, input.role);
        const user = await tx.user.create({ data: { email: input.email, displayName: input.name, isAdmin: false } });
        const membership = await addMember(tx, org.id, user.id, role);
        return { org, createdOrg, user, membership };
      });
      if (result.createdOrg) await writeAudit(deps, request, actor, { operation: "admin.org.create", recordType: "Organization", recordId: result.org.id, inputRedacted: { name: result.org.name, slug: result.org.slug }, statusCode: 201 });
      await writeAudit(deps, request, actor, { operation: "admin.user.create", recordType: "User", recordId: result.user.id, inputRedacted: { email: result.user.email, organizationId: result.org.id, role: result.membership.role }, statusCode: 201 });
      await writeAudit(deps, request, actor, { operation: "admin.org.member.add", recordType: "Membership", recordId: result.membership.id, inputRedacted: { organizationId: result.org.id, userId: result.user.id, role: result.membership.role }, statusCode: 201 });
      success(response, request, { ...userView(result.user), org: { id: result.org.id, name: result.org.name, slug: result.org.slug, role: result.membership.role, created: result.createdOrg } }, 201);
    } catch (error) { if (!adminInputFailure(response, request, error)) next(error); }
  });

  router.post("/admin/users/:id/magic-link", guard, mfaGuard, async (request, response, next) => {
    try {
      const id = z.string().uuid().parse(request.params.id);
      const actor = actorOf(response);
      const user = await deps.prisma.user.findUnique({ where: { id } });
      if (!user) { failure(response, request, 404, "NOT_FOUND", "User not found."); return; }
      if (userIsSuspended(user)) { failure(response, request, 409, "ACCOUNT_SUSPENDED", "This account is suspended. Unsuspend it before minting a sign-in link."); return; }
      if (!allowMint(actor.userId, now().getTime())) { failure(response, request, 429, "RATE_LIMITED", "Minting is limited to 20 per hour."); return; }
      const { token, expiresAt, tokenHash } = mintMagicLinkMaterial(now());
      const record = await deps.prisma.magicLink.create({ data: { email: user.email, tokenHash, expiresAt, requestIp: null, userAgent: null } });
      await writeAudit(deps, request, actor, { operation: "admin.magic_link.mint", recordType: "User", recordId: user.id, inputRedacted: { targetUserId: user.id, email: user.email }, statusCode: 201 });
      success(response, request, secretEntity(actor, record.id, record.expiresAt, { link: magicLinkUrl(token) }), 201);
    } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid."); else next(error); }
  });

  router.get("/admin/tokens", guard, mfaGuard, async (request, response, next) => {
    try {
      const tokens = await deps.prisma.mcpToken.findMany({ orderBy: { createdAt: "desc" }, include: { user: true, client: true } });
      const events = await deps.prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
      success(response, request, { items: tokens.map((token) => {
        const last = events.find((event) => event.tokenId === token.id && event.operation !== "admin.token.mint" && event.operation !== "admin.token.revoke");
        return { id: token.id, name: token.client.name, owner: token.user?.email ?? null, userId: token.userId, scopes: scopesOf(token.scopes), lastUsed: last ? last.createdAt.toISOString() : null, expiresAt: token.expiresAt?.toISOString() ?? null, revokedAt: token.revokedAt?.toISOString() ?? null };
      }) });
    } catch (error) { next(error); }
  });

  router.post("/admin/tokens", guard, mfaGuard, async (request, response, next) => {
    try {
      const input = CreateTokenSchema.parse(request.body);
      const actor = actorOf(response);
      const user = await deps.prisma.user.findUnique({ where: { id: input.userId } });
      if (!user) { failure(response, request, 404, "NOT_FOUND", "User not found."); return; }
      const scopeSet = new Set<string>(input.scopes ?? []);
      if (input.preset) {
        const preset = await deps.prisma.scopePreset.findUnique({ where: { code: input.preset } });
        if (!preset || !preset.active) { failure(response, request, 422, "UNKNOWN_PRESET", `No active scope preset named ${input.preset}.`); return; }
        for (const scope of preset.scopes) {
          if (!(TOKEN_SCOPES as readonly string[]).includes(scope)) { failure(response, request, 500, "PRESET_INVALID", `Preset ${preset.code} names an unknown scope.`); return; }
          scopeSet.add(scope);
        }
      }
      const scopes = [...scopeSet];
      if (scopes.includes("admin") && !user.isAdmin) { failure(response, request, 403, "FORBIDDEN", "Only an admin can receive the admin permission."); return; }
      if (!allowMint(actor.userId, now().getTime())) { failure(response, request, 429, "RATE_LIMITED", "Minting is limited to 20 per hour."); return; }
      const client = await deps.prisma.mcpClient.create({ data: { clientId: `admin-${randomBytes(16).toString("hex")}`, name: input.name, redirectUris: [], scopes: scopes } });
      const raw = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now().getTime() + input.expiresInDays * 24 * 60 * 60 * 1000);
      const token = await deps.prisma.mcpToken.create({ data: { clientId: client.id, userId: user.id, tokenHash: hash(raw), scopes: scopes, expiresAt } });
      await writeAudit(deps, request, actor, { operation: "admin.token.mint", recordType: "McpToken", recordId: token.id, inputRedacted: { targetUserId: user.id, name: input.name, scopes: scopes, expiresInDays: input.expiresInDays }, statusCode: 201 });
      success(response, request, secretEntity(actor, token.id, expiresAt, { token: raw }), 201);
    } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid."); else next(error); }
  });

  router.delete("/admin/tokens/:id", guard, mfaGuard, async (request, response, next) => {
    try {
      const id = z.string().uuid().parse(request.params.id);
      const actor = actorOf(response);
      const token = await deps.prisma.mcpToken.findFirst({ where: { id }, include: { user: true, client: true } });
      if (!token) { failure(response, request, 404, "NOT_FOUND", "Token not found."); return; }
      if (!token.revokedAt) {
        await deps.prisma.mcpToken.update({ where: { id }, data: { revokedAt: now() } });
        await writeAudit(deps, request, actor, { operation: "admin.token.revoke", recordType: "McpToken", recordId: id, inputRedacted: { tokenId: id }, statusCode: 200 });
      }
      success(response, request, { id, revoked: true });
    } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid."); else next(error); }
  });

  router.delete("/admin/proposals/:id", guard, mfaGuard, async (request, response, next) => {
    try {
      const id = z.string().uuid().parse(request.params.id);
      const actor = actorOf(response);
      const result = await deleteProposalCascade(deps.prisma, id);
      if (result === "not_found") { failure(response, request, 404, "NOT_FOUND", "Proposal not found."); return; }
      if (result === "has_contract") { failure(response, request, 409, "CONFLICT", "A contract references this proposal, so it cannot be deleted."); return; }
      await writeAudit(deps, request, actor, { operation: "admin.proposal.delete", recordType: "Proposal", recordId: id, inputRedacted: { proposalId: id, title: result.title, reviewState: result.reviewState }, statusCode: 200 });
      success(response, request, { id, deleted: true });
    } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid."); else next(error); }
  });

  router.get("/admin/access-requests", guard, mfaGuard, async (request, response, next) => {
    try {
      const status = z.enum(["pending", "approved", "rejected"]).optional().parse(typeof request.query.status === "string" ? request.query.status : undefined);
      const rows = await deps.prisma.accessRequest.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: "desc" }, take: 200 });
      success(response, request, { items: rows.map(accessRequestView) });
    } catch (error) { if (!adminInputFailure(response, request, error)) next(error); }
  });

  router.post("/admin/access-requests/:id/approve", guard, mfaGuard, async (request, response, next) => {
    try {
      const id = z.string().uuid().parse(request.params.id);
      const actor = actorOf(response);
      const note = z.object({ note: z.string().trim().max(2000).optional() }).strict().parse(request.body ?? {});
      const result = await approveAccessRequest(deps.prisma, { id, reviewerId: actor.userId, note: note.note, now: now() });
      await writeAudit(deps, request, actor, { operation: "admin.access_request.approve", recordType: "AccessRequest", recordId: id, inputRedacted: { email: result.email, userId: result.userId, organizationId: result.organizationId, role: result.role }, statusCode: 200 });
      success(response, request, { id, status: "approved", userId: result.userId, membershipRole: result.role, isAdmin: false, message: "No email was sent. They can request a magic link on the sign-in page." });
    } catch (error) { if (!adminInputFailure(response, request, error)) next(error); }
  });

  router.post("/admin/access-requests/:id/reject", guard, mfaGuard, async (request, response, next) => {
    try {
      const id = z.string().uuid().parse(request.params.id);
      const actor = actorOf(response);
      const note = z.object({ note: z.string().trim().max(2000).optional() }).strict().parse(request.body ?? {});
      const row = await deps.prisma.accessRequest.findUnique({ where: { id } });
      if (!row) { failure(response, request, 404, "NOT_FOUND", "Access request not found."); return; }
      if (row.status !== "pending") { failure(response, request, 409, "CONFLICT", "This request was already reviewed."); return; }
      const reviewedAt = now();
      await deps.prisma.accessRequest.update({ where: { id }, data: { status: "rejected", reviewedBy: actor.userId, reviewedAt, reviewNote: note.note ?? null } });
      await writeAudit(deps, request, actor, { operation: "admin.access_request.reject", recordType: "AccessRequest", recordId: id, inputRedacted: { email: row.email }, statusCode: 200 });
      success(response, request, { id, status: "rejected", reviewNote: note.note ?? null });
    } catch (error) { if (!adminInputFailure(response, request, error)) next(error); }
  });

  router.post("/admin/users/:id/suspend", guard, mfaGuard, async (request, response, next) => {
    try {
      const id = z.string().uuid().parse(request.params.id);
      const actor = actorOf(response);
      const user = await deps.prisma.user.findUnique({ where: { id } });
      if (!user) { failure(response, request, 404, "NOT_FOUND", "User not found."); return; }
      const suspendedAt = user.suspendedAt ?? now();
      if (!user.suspendedAt) await deps.prisma.user.update({ where: { id }, data: { suspendedAt } });
      const revoked = await deps.prisma.mcpToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now() } });
      await writeAudit(deps, request, actor, { operation: "admin.user.suspend", recordType: "User", recordId: id, inputRedacted: { email: user.email, tokensRevoked: revoked.count }, statusCode: 200 });
      success(response, request, { id, suspendedAt: suspendedAt.toISOString(), tokensRevoked: revoked.count });
    } catch (error) { if (!adminInputFailure(response, request, error)) next(error); }
  });

  router.post("/admin/users/:id/unsuspend", guard, mfaGuard, async (request, response, next) => {
    try {
      const id = z.string().uuid().parse(request.params.id);
      const actor = actorOf(response);
      const user = await deps.prisma.user.findUnique({ where: { id } });
      if (!user) { failure(response, request, 404, "NOT_FOUND", "User not found."); return; }
      if (user.suspendedAt) await deps.prisma.user.update({ where: { id }, data: { suspendedAt: null } });
      await writeAudit(deps, request, actor, { operation: "admin.user.unsuspend", recordType: "User", recordId: id, inputRedacted: { email: user.email }, statusCode: 200 });
      success(response, request, { id, suspendedAt: null });
    } catch (error) { if (!adminInputFailure(response, request, error)) next(error); }
  });

  router.get("/admin/audit", guard, mfaGuard, async (request, response, next) => {
    try {
      const limit = Math.min(Math.max(Number(request.query.limit ?? 100) || 100, 1), 100);
      const events = await deps.prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
      success(response, request, { items: events.map((event) => ({ id: event.id, operation: event.operation, actorUserId: event.actorUserId, recordType: event.recordType, recordId: event.recordId, createdAt: event.createdAt.toISOString() })) });
    } catch (error) { next(error); }
  });

  return router;
}

export function createAdminPage(deps: AdminDependencies) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const actor = await resolveAdmin(deps, request);
      if (!actor || actor.via !== "session") { response.status(404).type("text/plain").send("Not found"); return; }
      response.type("html").send(adminPageHtml());
    } catch (error) { next(error); }
  };
}
