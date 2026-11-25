# Orbit Proposals — multi-tenant architecture plan

Status: plan only. This document does not change runtime behavior. It describes how to turn the extracted Unwhelm proposal manager into a multi-tenant product, using the code in this folder as it exists today.

The tenant is an **organization** (a workspace). Users are people. A person can belong to more than one organization. Every proposal, contract, invoice, library item, MCP token, and audit row that holds customer data is owned by exactly one organization. Platform operators (the Orbit staff who run the service) are a separate role from a tenant's own admins.

Recommendation up front: **one shared Postgres schema, with `organization_id` on every tenant-owned row, enforced in application queries, and later backed by row-level security on a non-bypass role.** Do not give each customer their own schema or database. Reasons are in [Shared schema versus schema-per-tenant](#shared-schema-versus-schema-per-tenant).

Effort labels below are engineering size (how many modules and how invasive), not calendar time.

## 1. Current architecture

```text
Browser (Vite SPA, src/App.tsx)
  cookie session
        |
        v
Express API  server/index.ts          Postgres via Prisma
  /api/v1/*  + /.well-known/oauth-*     server/db.ts  PrismaPg(DATABASE_URL)
        ^
        |  Bearer access token, unchanged
MCP  unwh-mcp/src/http.ts  POST /mcp
```

Production (`DEPLOY.md`) runs three pm2 processes on one VPS: `unwh-api` (port 3201), `unwh-mcp` (port 3202), `unwhelm-redesign` (port 3200). nginx sends `unwhelm.net/api` and `/.well-known/oauth-*` to the API, `/` to the site, and `mcp.unwhelm.net/mcp` to the MCP server. Postgres is on `127.0.0.1:5432`.

The API declares every route in `server/apiSurface.ts`. Responses use one envelope (`ok`, `changed`, `entity`, `warnings`, `links`, `requestId`). The MCP server is a thin client: `unwh-mcp/src/createServer.ts` registers 158 tools, `unwh-mcp/src/anonymousDraft.ts` registers `unw_draft_proposal`, and `unwh-mcp/src/apiClient.ts` forwards the inbound `Authorization` header to the API. The MCP process has no database connection and no notion of an organization.

### 1.1 Users, sessions, and tokens

| Piece | Where | What it actually does |
|---|---|---|
| User | `User` in `prisma/schema.prisma` | Global unique email. `isAdmin` is a boolean on the user, not on a membership. Suspension is `suspendedAt`. TOTP secret is per user. |
| Sign-in | `server/routes/systemAuth.ts` | Magic link, 15 minutes, hashed in `MagicLink`. Unknown and suspended emails get the same response. Reviewer password sign-in exists only when `REVIEWER_EMAIL` and `REVIEWER_PASSWORD` are set, and it refuses staff and admin accounts. |
| Google | `GET /auth/google/start` and `/auth/google/callback` in `systemAuth.ts` | Start builds a Google URL. The callback returns `501 NOT_IMPLEMENTED`. |
| Session | `server/index.ts`, `server/sessionTypes.d.ts` | `express-session` stored by `connect-pg-simple` in a table named `session`. Cookie fields are `userId`, `organizationId`, `mfaVerifiedAt`, and an in-progress MCP authorize request. The `session` table is not in the Prisma schema. |
| Session org | `establishSession` in `systemAuth.ts` | Sets `organizationId` to the first membership with `status === "active"`, otherwise the first membership of any status. There is no org switch. |
| MCP OAuth | `systemAuth.ts` | Discovery at `/.well-known/oauth-authorization-server` (also mounted at `/api/v1/...`). Dynamic client registration creates an `McpClient` with `organizationId: null`. Consent stores `organizationId` on an **in-memory** `pendingAuthorizations` map (lost on process restart, not shared across API processes). |
| Access token | `issueTokens` in `server/mcpRefresh.ts` | Writes `McpToken` with `clientId`, `userId`, hashed access and refresh tokens, scopes, and expiry. **The organization id captured at consent is not stored.** Refresh (`exchangeRefreshToken`) copies `userId` and scopes only. |
| Bearer resolution | Duplicated in each router | A token is looked up by SHA-256. Organization is `McpClient.organizationId`, else the user's first active membership. Which membership, and whether the session org is consulted, differs by file (section 1.3). |
| Admin | `server/routes/admin.ts` `resolveAdmin` | `User.isAdmin` plus, for a bearer token, an `admin` scope. Admin is global. |
| Access requests | `approveAccessRequest` in `admin.ts` | Approved people become `client` members of the single org in `UNWH_TRIAL_ORG_ID`. |
| Try me | `server/demo.ts` `startDemo` | Creates a throwaway organization, user, membership, MCP client, and short-lived token. The visitor's proof is the raw token, returned once. `scripts/purge-demos.ts` deletes expired sandboxes. |
| Mail tenant | `UNWHELM_TENANT_ID` in `.env.example`, read by `server/contact-email.mjs` | Azure AD tenant for Microsoft Graph. Not an application tenant. |

`Membership.permissions` is stored (`Membership` model, written as `[]` or `{}` from `admin.ts`) and returned on `/me`. No route reads it to allow or deny a call. Authorization is `Role` (`prospect`, `client`, `staff`), `User.isAdmin`, and OAuth scope strings from the catalog (`server/catalog.ts`, `shared/mcpScopes.ts`).

### 1.2 Data ownership today

Rows that already carry `organizationId`:

- Required: `Contract`, `Project`, `ContractCredit` (via the contract's organization).
- Optional: `Proposal.organizationId`, `McpClient.organizationId`, `IdempotencyKey.organizationId`, `AuditEvent.organizationId`, `ContentLibraryItem.organizationId`, `TryMeSession.organizationId`, `ContactPreference.organizationId`, `AgentTrace.organizationId`.

`Proposal.organizationId` is nullable and `onDelete: SetNull`. Creating a proposal copies whatever organization the caller happened to resolve (`server/routes/chatProposalRead.ts`, `POST /proposals`). A proposal with a null organization is visible to its `ownerId` only, on the routes that check the owner.

Child rows (sections, requirements, tasks, attachments, versions, guest invites, esign requests, invoices, time entries) do not have their own `organizationId`. They are reachable through `proposalId` or `contractId`. Isolation is only as good as the parent check, and several parent checks are wrong (next section).

These tables are **global**. One row set serves every caller:

- Catalog: `CatalogVersion` and its price tiers, billing schedules, invoice policy, OAuth scopes, `SessionScopeGrant`.
- Proposal shape: `ProposalTemplate`, `ProposalTemplateNode`, `ProposalSectionLibrary`, `ProposalNodeTemplate`, review rules and phrases, completion copy, guidance rules (`GuidanceRule` and the rest of the playbook), `FollowUpReason`, `PaymentTerm`, `ReminderTemplate`, `TicklerOption`, `ProposalExpiryConfig` (a single historical row).
- Content library identity: `ContentLibraryItem.stableKey` is `@unique` globally, not per organization.
- Contact preference: `ContactPreference.userId` is `@unique`, so one person has one reminder preference for the whole database.
- Audit chain: `writeAudit` in `server/routes/proposalManager.ts` and `server/routes/admin.ts` hashes against the latest `AuditEvent` in the whole table, not per organization.
- Idempotency: `@@unique([organizationId, requestId, operation])`. In Postgres, two rows with `organizationId` NULL do not conflict, so retries are not idempotent for callers who have no org.

`ContractEsignRequest` stores SignWell document ids with no organization column. The provider credentials are process environment, not rows: `SIGNWELL_API_KEY`, `UNWH_ESIGN_PROVIDER`, `UNWH_ESIGN_LIVE` (`server/esign/index.ts`, `server/esign/esignConfig.ts`). One key signs for every organization. Webhook verification uses one shared secret (`server/esign/providers/signwellWebhook.ts`).

Billing in this codebase is **Unwhelm invoicing a client for a signed proposal** (`Invoice`, `BillingEntry`, `TimeEntry`, `server/routes/billingProjects.ts`). It is not a subscription that Orbit charges a customer organization. There is no plan, seat count, or Stripe customer id.

### 1.3 Every place that assumes one user or one organization

These are the behaviors that break, or leak, as soon as two real organizations share the database.

**Organization is chosen by accident.**

- `establishSession` (`server/routes/systemAuth.ts`) saves the first active membership and never changes it.
- `proposalManager.ts` `defaultAuthorize`, `proposalReminders.ts`, `reminderDelivery.ts`, and `followUpQueue.ts` take `memberships.find(status === "active")` and ignore `session.organizationId`.
- `chatProposalRead.ts` `defaultAuth` for a cookie session sets `role: "client"` even when the membership is `staff`. The staff branch of `GET /proposals` therefore does not run for a signed-in staff user. A bearer token on the same route uses the real membership role.
- `timeEntries.ts`, `billingProjects.ts`, and `proposalContract.ts` use `session.organizationId` when it is set, and otherwise `findFirst` ordered by `organizationId`. The same person can land in different organizations depending on which router handles the request.
- `GET /auth/mcp/clients` and `GET /operation-log` (`systemAuth.ts`) filter by `session.organizationId` only when it is set. When it is missing, the query has no `where` and returns every client or every audit row.
- `issueTokens` drops the organization chosen at consent. A later request re-derives it from the client row (null for dynamically registered clients) or from whichever membership is first.

**Staff and admin cross the tenant boundary.**

- `proposalManager.ts` `canSee`: `isAdmin` or `membershipRole === "staff"` returns true for any proposal, in any organization.
- `proposalReview.ts` `canSee`: same, staff sees every proposal.
- `chatProposalRead.ts` `canSee`: `role === "staff"` sees every proposal and every chat session. `GET /chat/sessions` uses an empty `where` for staff, so the list is the whole table.
- `followUpQueue.ts` `loadFollowUpQueue` loads every non-closed proposal with no organization filter. `GET /admin/follow-up-queue` returns that list to any staff principal.
- `agentTrace.ts` `listTraces` filters by tool, client, user, and error, never by `organizationId`, even though `AgentTrace` has the column. `requireStaff` in `server/routes/agentTraces.ts` accepts any staff membership.
- `User.isAdmin` is global (`admin.ts`). An admin token lists users, orgs, tokens, and audit events across the database. That is acceptable for a platform operator and unacceptable if "admin" is copied onto a customer.

**Uniqueness and null organization ids.**

- Two organizations cannot reuse a content-library `stableKey` (`ContentLibraryItem`).
- `libraryVisible` in `proposalManager.ts` treats `visibility: "global"` and `organizationId: null` as visible to every principal. A library row saved without an organization is world-readable to any authenticated caller who passes the route's scope check.
- `ContactPreference.userId` unique means a person in two organizations has one phone number, one consent timestamp, and one unsubscribe token.
- Guest access (`ProposalGuestInvite`) is per proposal and per email, which is the right grain, but the invitee is still a global `User`. Recording an invite does not send mail (comment on the model).

**Single shared configuration.**

- Price floors, hours tiers, and billing splits come from the one published `CatalogVersion` (`server/catalog.ts`). A second organization would bill at Unwhelm's rates.
- Templates, section library, guidance rules, and review rules are global. Editing a template (`server/routes/templateEdit.ts`) edits it for everyone.
- Try-me settings (`TryMeSetting`) and the scripted plans (`TryMe`, `TryMeTask`) are global, which is fine for a hosted demo, as long as sandbox rows cannot attach to a customer organization.

**Process-wide secrets and in-memory state.**

- SignWell and PandaDoc credentials, the session secret, the TOTP key, and the reviewer password are one set of environment variables.
- OAuth authorization codes live in a `Map` on the API process (`pendingAuthorizations` in `systemAuth.ts`). A second API instance would not see them. That is already a single-process assumption; multi-tenant hosting makes it more visible.
- Magic-link and registration rate limits are in-process maps, keyed by IP and email, not by organization.

**Sandbox and trial share the production tables.**

- Try me inserts real `Organization`, `User`, `Proposal`, and `McpToken` rows (`server/demo.ts`). Isolation is by short TTL and a purge job, not by a schema or a flag the other routes understand.
- Approved access requests all join `UNWH_TRIAL_ORG_ID` (`admin.ts`). There is one trial bucket.

**Front end.**

- `src/portal.tsx` treats the signed-in user as allowed when `isAdmin` or the flattened role list contains `client` or `staff`. Roles are the union of every membership (`identity()` in `systemAuth.ts`). There is no organization picker.
- `src/admin.tsx` is a platform admin screen (users, orgs, tokens). It is not an organization settings screen.
- Connect pages (`src/connectMcpClient.tsx`, `src/mcpGettingStarted.tsx`) describe one public MCP URL and one authorization server.

## 2. Target tenant model

### 2.1 Accounts and organizations

- A **user** is a person, identified by a globally unique email, with a passwordless magic link (keep the current flow). `isAdmin` stops meaning "staff of the only company." Rename the platform flag in a later phase to something that cannot be confused with a tenant role, and stop granting it to customer owners.
- An **organization** is the tenant. Add columns the current model does not have: `kind` (`customer`, `sandbox`, `platform`), `status` (`active`, `suspended`), and a slug that stays unique. Sandbox orgs are the try-me orgs. The platform org, if needed, holds Orbit operators and is not a customer workspace.
- A **membership** is the only way a user acts inside an organization. Status stays `invited | active | suspended`. A suspended membership loses that org only; `User.suspendedAt` remains the platform-wide ban.
- Personal workspace: the first time a user has no membership, create an organization they own. Do this in the approval path and in magic-link sign-in, not by falling through to "no organization" (today that path creates proposals with `organizationId: null`).

### 2.2 Roles and permissions

Replace the three-value `Role` enum with tenant roles. Suggested set:

| Role | Sees | Can change |
|---|---|---|
| `owner` | Everything in the org | Billing settings, membership, delete org, SignWell credentials |
| `admin` | Everything in the org | Members except owners, templates, library approval, catalog overrides |
| `member` | Org proposals, contracts, library | Draft and edit, the work `staff` does today inside one org |
| `client` | Proposals and contracts shared with them | Accept, comment, sign, the portal behavior in `src/portal.tsx` |
| `guest` | One proposal, via `ProposalGuestInvite` | Read, and only the writes the invite allows |

`client` here is a membership in the **selling** organization (the same shape as today: Unwhelm's client is a member of Unwhelm's org). A counterparty who is itself an Orbit customer is a later question, not this model. See open questions.

Platform operator is not a row in `Membership`. It stays a column on `User`, checked only by `server/routes/admin.ts` and by explicit cross-tenant jobs (purge, support). A platform operator acting inside a customer org must pass that org id on purpose, and the audit row must record both identities. `Membership.permissions` is unused. Either delete it or define a short list (`catalog:write`, `esign:manage`, `members:invite`) that `owner` and `admin` can grant. Do not invent a second permission system beside scopes.

OAuth scopes (`proposals:read`, `proposals:write`, `admin`, catalog scopes) stay as they are: they limit what an MCP client may call. They do not choose the organization, and they do not replace the membership role. `connectorTokenScopes` in `server/connectorScopes.ts` already adds staff scopes when the user is staff or admin. That check must use the membership in the **token's** organization, not "any membership is staff."

### 2.3 Invitations

Two different invites exist in spirit and should stay different:

1. **Organization invitation.** New table, for example `OrganizationInvite`: email, organization id, role, token hash, expiry, inviter. Accepting creates or reuses the `User` and an active `Membership`. This replaces "everyone approved goes into `UNWH_TRIAL_ORG_ID`" for real customers. The trial org can remain as a single sandbox-kind org for the public preview.
2. **Proposal guest invite.** Keep `ProposalGuestInvite`. It grants one proposal, not the organization. Link `userId` when the email matches a user. Still do not treat the guest as `staff`.

`approveAccessRequest` should create a customer organization (or attach to an existing one the reviewer picks) instead of always using one environment variable.

### 2.4 Per-user and per-org isolation

Rules:

- Every request has a `TenantContext`: `{ userId, organizationId, membershipRole, isPlatformAdmin, scopes }`. `organizationId` is required for every data route except platform-admin routes and the public try-me start route.
- Lists filter `organizationId` in the query. A missing filter is a bug, not a default of "all rows."
- Reads of a single id also include `organizationId` in the `where` (the pattern `proposalWhere` in `server/routes/proposalContract.ts` already tries to do this). Return 404 when the row exists in another org, matching `SCHEMA-PLAN.md`.
- `staff` / `member` does **not** skip the organization predicate. The current `canSee` helpers in `proposalManager.ts`, `proposalReview.ts`, `chatProposalRead.ts`, and `followUpQueue.ts` must lose the cross-org branch.
- Platform admin bypass is a separate function used only by `admin.ts`, and it writes an audit row.
- Child rows are isolated by joining the parent. Adding a denormalized `organizationId` is worth it on tables that are listed without the parent: `ContentLibraryItem` (already present), `AuditEvent`, `AgentTrace`, `ContactPreference`, `IdempotencyKey`, `ReminderDelivery`. Do not add it to every section and comment row in the first migration.
- `ContentLibraryItem.stableKey` becomes unique on `(organizationId, stableKey)`. Global library entries, if kept, live in the platform org, not as `organizationId: null`.
- `ContactPreference` becomes unique on `(userId, organizationId)`.
- The audit hash chain is per organization (`previousHash` looks up the latest event with the same `organizationId`).
- `GET /chat/sessions`, `loadFollowUpQueue`, and `listTraces` take the context's organization id. Staff of org A do not see org B's chats, queue, or traces.
- `chatProposalRead.ts` must set `role` from the membership, not hardcode `"client"`.

Catalog, templates, and guidance:

- Platform rows remain the default (the current tables).
- An organization may override price tiers and templates later. Phase 3. Until then, new customer orgs **read** the platform catalog and do not get `templateEdit` or `catalogEdit` routes. Those routes become platform-admin or `catalog:write` on the platform org. Shipping Unwhelm's dollar amounts as every tenant's prices is a product decision; the open questions ask Edmund to confirm it. The safe default is: seed each new org with a copy of the published catalog, so later edits do not change other tenants.

### 2.5 How a request resolves the tenant

One module, used by every router. Today each router has its own `defaultAuthorize` / `resolvePrincipal` (see section 1.3). Replace those with:

1. **Cookie session.** Read `session.userId` and `session.organizationId`. Load the membership for that pair. If the user has one active membership and the session has no org, set it (the current sign-in behavior) and continue. If the user has more than one and the session org is missing or not an active membership, return `409` with a stable code such as `ORG_REQUIRED` and the list of orgs. Do not pick `findFirst`.
2. **Bearer token.** Load `McpToken` by hash. Read `organizationId` **from the token row**. Confirm the user still has an active membership in that org, and that the user is not suspended. Ignore `McpClient.organizationId` when the token has its own (the client is the OAuth app; the token is the grant). Dynamically registered clients stay `organizationId: null`; the grant carries the org.
3. **Scopes.** Intersect the token's scopes with the route's required scope, as today (`scopeAllows` in `shared/mcpScopes.ts`). A session cookie has the scopes of its membership role (`grantsForRole` in `server/catalog.ts`), not a hardcoded read/write pair. `chatProposalRead.ts` currently invents `["proposals:read","proposals:write"]` for any session that has a membership.
4. **Guest.** If the membership role is absent but an active `ProposalGuestInvite` matches `userId` and the proposal id, the context is guest and `organizationId` is the proposal's org. Guest list routes return only invited proposals.

Org switch is `POST /api/v1/auth/organization` with an organization id. It checks membership, regenerates nothing else, and sets `session.organizationId`. MCP tokens do not switch. A token is minted for one org. Connecting a second org means a second consent and a second token. That matches how the consent screen works: the organization is chosen before Allow.

### 2.6 MCP and OAuth

Changes, all in the API, because the MCP process only forwards the header:

- Add `organizationId` to `McpToken`. `issueTokens` and `exchangeRefreshToken` in `server/mcpRefresh.ts` persist it. The value comes from `pendingAuthorizations`, which already records `organizationFor(request)` at consent time (`systemAuth.ts`).
- Move `pendingAuthorizations` from the in-memory `Map` to a table (hashed code, user id, organization id, client id, scopes, PKCE challenge, expiry). Required once more than one API process runs, and required so a restart does not drop a consent.
- Consent screen shows the organization name, not only the client name (`consentPage` in `systemAuth.ts` currently lists scopes and the client name).
- `GET /api/v1/health` with a bearer token returns scopes and a staff bit (`systemAuth.ts`). Extend the entity with `organizationId` so the MCP server can trace the tenant. `unwh-mcp/src/http.ts` `tokenAccess` already reads that health payload for scopes. It does not need to enforce the org; the API does.
- Tool handlers in `createServer.ts` stay as they are. They pass the bearer token. They must not grow an organization argument that a model can set. The org is a property of the token. If a tool accepted `organizationId` from the model, a prompt could point it at another tenant.
- Anonymous MCP (`http.ts`, no bearer, `anonymous: true`) stays a separate tool set with no tenant. It must not read or write customer rows. Try-me continues to mint a real token for a sandbox org.
- DCR (`POST /auth/mcp/register`) keeps creating an org-less client. Optional later: a signed-in user can register a client bound to the current org, which is what `GET /auth/mcp/clients` already pretends to list.

Revocation (`POST /auth/mcp/revoke`) stays by token hash. It does not need an org to be correct, and it must not revoke every token for that user in other orgs.

## 3. Data model and migration

One Prisma migration after the backfill script has run in the same transaction, or as two steps: expand, backfill, then constrain. Do not drop columns in the same migration that adds the constraint.

### 3.1 New and changed columns

- `Organization.kind` (`customer | sandbox | platform`), `Organization.status`.
- `McpToken.organizationId` non-null for tokens issued after the migration. Old tokens: backfill from `McpClient.organizationId`, else the user's single active membership, else revoke them and force a reconnect. A token that cannot be placed is more dangerous than a reconnect.
- `Proposal.organizationId` becomes required. Backfill nulls to the owner's single organization, else to a designated Unwhelm organization recorded during the migration (the org Edmund names). Do not invent a new org per null proposal without a human check; print the unresolved ids and stop.
- `ContentLibraryItem`: unique `(organizationId, stableKey)`, `organizationId` required. Rows with null org go to the Unwhelm org. `visibility = global` rows go to the platform org and the read path unions "platform org published items" plus "caller org."
- `ContactPreference`: drop the unique on `userId`, add unique `(userId, organizationId)`, require `organizationId`.
- `IdempotencyKey.organizationId` required. Existing null keys can be deleted; they are an hour-scale cache, not source data.
- `AuditEvent` stays nullable only for platform events that are not inside a tenant. The hash lookup becomes "latest row with this `organizationId`" (and a separate chain for null).
- `OrganizationInvite` table as in section 2.3.
- `OrganizationPlan` table, even if unused at first: `organizationId` unique, `planCode`, `seatLimit`, `status`. This is the billing hook. It does not replace `Invoice`.
- Optional `EsignAccount`: `organizationId` unique, provider, encrypted API key, webhook secret id, `live` boolean. Encryption key is `UNWH_ESIGN_KEY` (32 bytes, same pattern as `UNWH_TOTP_KEY` in `server/auth/totpCrypto.ts`). Until a row exists, the process-level `SIGNWELL_API_KEY` remains the fallback for the Unwhelm org only.

Roles: adding enum values in Postgres is additive (`ALTER TYPE "Role" ADD VALUE`). Map `staff` → `member` only after every `membershipRole === "staff"` check has been updated. A safer first step is to keep storing `staff` and treat `staff` as `member` in the new context helper, then rename in a later migration. `owner` and `admin` are new values.

`User.isAdmin` stays through the first phases so `admin.ts` keeps working. New customer owners do not get `isAdmin`.

### 3.2 Backfill order

1. Ensure one customer organization exists for the current Unwhelm practice. `scripts/org-attach.ts` already attaches a user as `staff` of a named org; the migration should not depend on that script having been run, but the operator should know which org id is canonical.
2. Attach every user who owns a proposal, contract, or time entry and has no membership.
3. Set `Proposal.organizationId` where it is null, using the owner's membership. Abort the constraint step if any row is still null.
4. Set `McpToken.organizationId`. Revoke tokens that still have none.
5. Set library items and contact preferences.
6. Add `NOT NULL` and the new unique indexes.
7. Mark try-me organizations `kind = sandbox` by joining `TryMeSession.organizationId`.

Try-me orgs created after the migration set `kind` in `startDemo`.

### 3.3 What not to migrate

Do not split the database. Do not copy `auth.users` (there is no Supabase Auth in this repo). Do not move attachment bytes (`ProposalAttachment.bytes`, `ContractEsignArtifact.bytes`) to object storage in this same change. They can stay `bytea` until a storage project exists.

## 4. API, MCP, and front end

### 4.1 API

- New `server/tenantContext.ts` (name indicative): resolve session or bearer into `TenantContext`, or throw the existing `AUTH_REQUIRED` / `FORBIDDEN` / `ORG_REQUIRED` errors. Routers listed in section 1.3 call it instead of their private copies.
- `GET /proposals` and `POST /proposals` (`chatProposalRead.ts`): always set `organizationId` from the context. The staff list filter becomes "this org," for members and owners, not "staff sees the org, everyone else sees owner id only" with a hardcoded client role.
- `proposalWhere` in `proposalContract.ts` is the pattern to keep: id plus organization, guest as a narrow exception.
- `billingProjects.ts` already scopes invoices and projects by `identity.organizationId`. A bearer token with the `admin` scope and no resolved organization may supply `organizationId` in the query or body (`organizationForAdmin`); that path does not override an organization the token already has. Keep it for platform operators only. A tenant member must not gain it. The session path ignores that parameter and uses `session.organizationId` or the first active membership.
- `loadFollowUpQueue` gains an `organizationId` argument. The route passes the context.
- `listTraces` gains `organizationId` and applies it unless the caller is a platform admin.
- `operation-log` and MCP client list always filter. No more "missing session org means all rows."
- Catalog write routes (`server/routes/catalogEdit.ts`, `server/routes/templateEdit.ts`) require platform admin or `catalog:write` on the org that owns the row. Reads of the active catalog stay available to members, because pricing validation (`parseCatalogPricing` on create) needs them.
- Guest, public proposal links (`ProposalPublicLink`), and public chat workspaces (`POST /public/proposal-sessions` in `chatProposalRead.ts`) stay unauthenticated and token-scoped. They must not accept an organization id from the body. Public workspaces today have `ownerId: null` and no organization; when they are submitted they become an escalation for staff. For multi-tenant, a public link is minted by a member and stores that proposal's organization. The resume cookie does not become a session in some other org.

### 4.2 MCP tools

No tool signatures change in the first phase. Tools keep calling `/api/v1/...` with the bearer token. The API applies the token's organization.

Worth doing in the same phase as the token column:

- Health payload includes `organizationId` (section 2.6).
- Trace rows (`server/agentTrace.ts` `TraceActor`) already accept `organizationId`. The MCP trace sink should keep passing the token, and the API should fill the org from the token rather than from the client.
- Anonymous tools stay on the unauthenticated path in `unwh-mcp/src/http.ts`. Confirm with a test that those tools cannot call `unw_list_proposals`.

Later, a `unw_list_organizations` read tool is unnecessary if one token is one org. A "which org am I" tool that returns the token's org name is useful and cannot be used to switch.

### 4.3 Front end

- After sign-in, if the session response (`GET /auth/session`) includes more than one active membership, `src/portal.tsx` and any signed-in page show an organization switcher that calls `POST /auth/organization`. The session payload already includes one organization (`identity()` in `systemAuth.ts`); extend it with `memberships: [{ id, name, role }]`.
- Portal proposal fetches already go to the API. Once the API filters, the UI cannot show another org's proposal by guessing a UUID (the API returns 404). Still do not put the organization id only in the query string as the authority.
- `src/admin.tsx` remains the platform console. Add an org settings page for owners: members, invites, plan display, SignWell "connected / not connected." That page does not exist today.
- Connect instructions (`src/connectMcpClient.tsx`) should say that the OAuth grant is for the organization you have selected, and that a second organization needs a second connection. The MCP URL itself stays one URL.
- Template editor (`src/templateEditor.tsx`) is hidden for tenants who do not have `catalog:write`.

### 4.4 Sandbox and try-me

`startDemo` in `server/demo.ts` is already the right shape: a new org, a new user, a token, a TTL, a purge. Changes:

- Set `kind = sandbox` on that organization.
- Sandbox orgs cannot set `UNWH_ESIGN_LIVE` behavior, cannot call invoice charge routes, and are invisible to customer lists. `purgeExpiredDemos` already deletes the org; keep that, and make the delete depend on `kind = sandbox` so a bug cannot purge a customer org.
- Rate limits stay per IP (`demo.ts`). They are not per tenant.
- The 30-minute visitor token Edmund described is this try-me token (TTL from `TryMeSetting`), not the OAuth access token. OAuth access lifetimes come from `McpTokenSetting` (migration `0051`, fallback 30 days in `mcpRefresh.ts`). Do not conflate them.
- `UNWH_TRIAL_ORG_ID` remains a single preview org if Edmund still wants a shared trial. It should be `kind = sandbox` or a dedicated `kind = trial`, and it must not be the Unwhelm customer org. People in a shared trial can see each other's proposals. That is a product choice and should be labeled in the UI. Prefer one sandbox org per approved visitor if the trial is supposed to be private.

### 4.5 SignWell

Today one API key and one webhook secret serve every contract (`server/esign/index.ts`). `ContractEsignRequest` is keyed by contract and proposal version, and the webhook looks up `providerDocumentId`.

Target:

- Each customer org stores its own SignWell key, encrypted, in `EsignAccount`. The Unwhelm org keeps using the environment variable until its row is filled, so production signing does not break on the day of the migration.
- The webhook URL can stay one endpoint. The handler looks up the request by `providerDocumentId` (already unique enough if SignWell ids are globally unique) and then checks that the contract's `organizationId` matches the account whose secret verified the signature. Verify with the org's secret, not a single process secret, once more than one account exists. A document id that matches no row is 404 and does not try every secret (that would be an oracle). With one shared URL and many secrets, the practical approach is: store a per-request signing key id on `ContractEsignRequest`, and try only that secret. SignWell's signature covers type and time, not the body (`signwellWebhook.ts`); the handler must keep fetching document state from that org's API key before it writes, which the comment in that file already requires.
- Sandbox orgs force `testMode`. `UNWH_ESIGN_LIVE=1` does not apply to them.
- Do not log API keys or signed-PDF bytes. `server/esign/redact.ts` is the existing redaction path; extend it to the per-org key.

### 4.6 Billing and plan hooks

Leave contract invoicing (`Invoice`, `server/routes/billingProjects.ts`, credits, retainage) as a feature **inside** a tenant: the org bills its own clients. Scope is already by organization on those routes; the work is to make the organization unambiguous (section 2.5) and to remove the admin query-string override for non-platform callers.

Add `OrganizationPlan` and nothing else in the first billing phase. No Stripe integration until Edmund wants Orbit to charge tenants. The hook is: seat limit checked when creating a membership, and a `planCode` the UI can show. Enforcement can ship as a warning before it ships as a hard stop.

Payment-processor keys on `InvoiceCharge` (`processor`, `processorId`) are per charge and already not card numbers. A tenant-level processor account is a later column, same pattern as SignWell.

## 5. Security, observability, rollout

### 5.1 Tenant isolation tests

Add tests that fail if any of these succeed. Use two organizations, two users, two tokens. The API suite already hits a real database when `UNWH_DB_TEST=1` (`tests/api/*Db.test.ts`). Follow that pattern.

- User A token cannot `GET /proposals/:id` for org B. Response is 404, not 403 (so existence does not leak).
- User A token cannot list org B proposals, chat sessions, invoices, traces, follow-up items, library items, or audit events.
- Staff of org A cannot see org B (this is the regression the current `canSee` helpers would fail).
- A body or query `organizationId` that does not match the token is ignored or rejected, and never selects the other org (`billingProjects.ts` is the test to write first).
- Library `stableKey` collision: org A and org B can both own `standard-intro`.
- Guest invite for one proposal does not reveal a second proposal in the same org.
- Sandbox token cannot read a customer proposal and cannot start a live SignWell request.
- Platform admin can, and the audit row records `actorUserId` and the target `organizationId`.
- MCP: the same bearer token, sent through `unwh-mcp` to `unw_list_proposals`, returns only that token's org. No tool parameter changes the org.

Run the list and the get as a pair. A filter on the list with a missing filter on the get is the usual leak.

### 5.2 Row-level checks

Application `where` clauses are the control that ships first, because Prisma connects as one privileged role (`server/db.ts`) and Postgres RLS would not apply to that role. See `SUPABASE_PRISMA_MIGRATION.md` for how RLS can sit behind the same queries later.

Defense in depth that does not need RLS:

- One context helper, so a new route cannot invent a third resolution rule.
- A test that greps route files for `proposal.findMany` / `proposal.findUnique` and fails when a new call site has no organization predicate. This will be noisy at first; start with an allowlist of the known helpers.
- Idempotency keys include the org, so a replay cannot return another tenant's cached response. The unique index already has the column; the bug is the null.
- 404 on cross-tenant ids.

### 5.3 Observability

`server/observability.ts` logs method, path, status, duration, and request id. It does not log the user or the organization. Add `organizationId` and `userId` to that line when a context exists. Do not log bearer tokens, magic-link tokens, or emails on the info line (email belongs on the audit row, which is already access-controlled).

`AuditEvent` is the support trail. After the hash chain is per org, a tenant admin can read their own chain (`GET /operation-log` filtered). Platform admin keeps `GET /admin/audit`.

Agent traces (`AgentTrace`) are the MCP audit. They must be filtered by org before any customer can open them. Retention (`purgeOldTraces`) can stay global.

The in-memory OAuth code map and the in-memory rate limits are invisible to a second process. Moving codes to Postgres (section 2.6) also makes failed consents visible. Rate limits can stay in memory until there is more than one API instance; document that as a known limit, not as a tenant feature.

### 5.4 Phased rollout

Each phase is shippable on the current VPS. Feature-flag with an environment switch only where behavior would change for the existing Unwhelm org. The goal of phases 0–2 is that Unwhelm's single organization sees no change, while a second test organization is isolated.

**Phase 0 — Characterize and lock the leaks. Size: medium.**

Write the two-org tests against the current code and record which ones fail. Do not "fix" them in the same change as the test file; the failing tests are the checklist. Include `canSee` in `proposalManager.ts`, the follow-up queue, chat session list, trace list, and the hardcoded client role in `chatProposalRead.ts`.

**Phase 1 — One tenant context, Unwhelm unchanged. Size: large.**

Introduce `TenantContext`. Persist `McpToken.organizationId`. Backfill proposals and tokens into the existing Unwhelm org. Make `Proposal.organizationId` required. Fix staff `canSee` so staff means "staff of this org." Fix the session role hardcode. Add org switch for users with two memberships. Move OAuth codes out of the process `Map`.

Exit test: the two-org suite passes, and a scripted proposal (`npm run test:scripted-proposal`) still completes for the original org. Existing MCP clients must reconnect once so their tokens gain an organization id.

**Phase 2 — Roles and invitations. Size: large.**

Add `owner` and `admin` (or map them onto permissions without an enum change, if the enum migration is the riskier half). Organization invites. Stop sending every approved access request to `UNWH_TRIAL_ORG_ID`. Portal org switcher. Consent screen shows the org name.

Exit test: a user in two orgs, with a token for each, sees two disjoint proposal lists. An invite acceptance creates a membership and no `isAdmin`.

**Phase 3 — Shared configuration becomes copy-on-org. Size: medium.**

Per-org catalog snapshot at org creation. Library uniqueness per org. Per-org audit chain and contact preferences. Template and catalog editors restricted.

Exit test: editing org A's price floor does not change org B's create-proposal validation.

**Phase 4 — SignWell, sandbox flag, plan hook. Size: medium.**

`Organization.kind`, try-me sets `sandbox`, purge refuses non-sandbox. `EsignAccount` for a second org, environment key remains the Unwhelm fallback. `OrganizationPlan` row created with the org, seat check as a warning.

Exit test: sandbox token cannot start a live e-sign; org B's SignWell key is the one used for org B's contract; Unwhelm's existing sign path still uses `SIGNWELL_API_KEY`.

**Phase 5 — Row-level security, optional, after Supabase or not. Size: medium.**

Only after phase 1's queries are correct. RLS is a backstop, not the design. Details are in `SUPABASE_PRISMA_MIGRATION.md`. Skip this phase if the database stays on the VPS and the two-org tests are in CI.

**Phase 6 — Orbit as its own service. Size: medium, mostly operations.**

This folder becomes the Orbit repository. New hostname, new pm2 names, new database (or a new schema only if phase 5's decision changes). Unwhelm.net keeps the marketing site. The proposal API and MCP move with Orbit. Data migration of the Unwhelm org is a dump of that organization's rows, not of every try-me sandbox.

Do not run phase 6 until phase 1 and phase 2 have passed against a second real organization.

### 5.5 What this plan deliberately does not do

- It does not implement the changes in this branch.
- It does not replace magic links with Supabase Auth. That choice is in `SUPABASE_PRISMA_MIGRATION.md`.
- It does not introduce per-tenant databases.
- It does not let the model pass `organizationId` into an MCP tool.

## 6. How this fits the code that is already here

A surprising amount of the model is already multi-org on paper:

- `Organization`, `Membership`, and `Proposal.organizationId` exist, and `SCHEMA-PLAN.md` already says an inaccessible record is a 404.
- `billingProjects.ts` and `proposalContract.ts` already query by organization when the caller has one.
- Try me already manufactures a tenant per visitor.
- MCP already authenticates a user via a hashed bearer token rather than a shared API key.

The gap is that those pieces were built for one practice that sometimes has client logins. The organization is a label, the first membership wins, staff skips the label, and several lists never look at the label. The work is to make the label mandatory and to route every check through one context, not to invent a second identity system.

## 7. Open questions for Edmund

1. **Customer zero.** Should the existing Unwhelm proposals, contracts, and invoices become the first Orbit organization, or should Orbit start empty and Unwhelm stay on the current VPS database until a cutover weekend?
2. **Who is the seller?** Today a client is a `Membership` on Unwhelm's organization (`Role.client`). Is that still right for Orbit (the tenant's customers are members of the tenant), or do two Orbit customers ever need to sit on opposite sides of one proposal?
3. **Multiple orgs per person.** Will consultants belong to several customer orgs with one email, or is that rare enough that phase 1 can reject a second membership and add the switcher in phase 2?
4. **Platform admin.** Should `User.isAdmin` remain a single Edmund-level switch, with no customer able to hold it, and with tenant administration done only by `owner`?
5. **Catalog prices.** New organizations must not inherit Unwhelm's rate card silently. Confirm: copy the structure (models, milestones) with empty amounts, or copy the numbers and let the owner edit them.
6. **Templates and guidance.** Are the proposal templates and guidance rules Orbit product content (shared, versioned by Orbit) or each tenant's intellectual property (copied at creation, then private)?
7. **SignWell accounts.** Does each customer bring their own SignWell API key, or does Orbit hold one SignWell account and send envelopes on the customer's behalf? The data model differs (per-org secret versus one secret plus a sender identity).
8. **Try me.** Does the public sandbox stay on unwhelm.net/try and call Orbit's API, or does it move to the Orbit host? A shared `UNWH_TRIAL_ORG_ID` lets strangers read each other's drafts. Is a private sandbox per visitor required before the first external user?
9. **Orbit billing.** Is `OrganizationPlan` enough for now, or is charging tenants (Stripe) part of the first public release? The proposal invoicing feature (tenant bills their client) is a separate product surface and should not be blocked on Stripe.
10. **Google sign-in.** The callback is `501`. Is magic link the only login for the first multi-tenant release?
11. **Guest mail.** `ProposalGuestInvite` does not send email. Should organization invites send mail in phase 2, using the same Graph sender as `server/contact-email.mjs`?
12. **Data residency.** If a later customer requires a dedicated database, the shared-schema design can still export one org. Is that an explicit non-goal for the first year, so nobody designs schema-per-tenant now?
13. **OAuth codes in memory.** Production is one `unwh-api` process (`DEPLOY.md`). Confirm that a short move of authorization codes into Postgres in phase 1 is acceptable, because it changes restart behavior (codes survive a restart) and is the right fix before a second instance.
14. **Hostname and MCP resource.** Tokens are bound to the resource `https://mcp.unwhelm.net/mcp` (`MCP_RESOURCE` in `systemAuth.ts`). An Orbit hostname needs its own resource string. Existing Unwhelm tokens should keep working until clients reconnect. Confirm the Orbit MCP URL before phase 6.
