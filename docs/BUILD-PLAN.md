# UnwhelmNet 2.0 build plan

Status: implementation plan, v0.1 (2026-10-20).

This document is the ordered build plan for the Unwhelm application, API, and
MCP service. It mirrors the useful parts of the AMBA layout while keeping the
current UnwhelmNet 2.0 site as the starting point.

## How to read this document

The sections labelled **Current** describe code that exists in this repository.
The sections labelled **Planned** describe work that has not been implemented
yet. The attached planning document was used as design input; it is not an
executable deployment instruction or evidence that the proposed services exist.

## Next implementation slice — PR #9: client portal and proposal editing

PR #9 should deliver the first client-portal MVP, centered on a proposal
section. It should follow the existing React admin portal's structure and
visual language rather than introducing a second UI pattern.

### Portal structure

- Add a client-only route guard and portal shell, modeled on `AdminRoute` and
  `AdminPage` in `src/admin.tsx`.
- Use the same tabbed navigation, `fetch`-based request helper, response
  envelope handling, inline error states, forms, tables, dialogs, and
  responsive CSS conventions.
- Add a proposal list and proposal detail/editor view. A proposal detail page
  must render the canonical proposal as readable, user-visible HTML before it
  enters edit mode.
- Reuse the existing site container, typography, buttons, form controls, and
  table styles. Add portal-specific selectors only where the admin styles do
  not already cover the interaction.

### Proposal editing

- Allow a client or authorized staff user to edit proposal sections, scope,
  timeline, budget, options, and milestones by hand.
- Keep the canonical proposal shape and shared validation as the source of
  truth. The HTML representation is a view of that shape, not a separate
  document format.
- Show save errors and validation failures in the same way as the admin page.
- Preserve proposal status and revision behavior so edits cannot silently
  overwrite a newer version or bypass the review/ready-for-review gate.

### Common API and MCP boundary

- The portal UI and MCP tools are both clients of the same proposal API. Neither
  client may write directly to Prisma or implement a second proposal mutation
  path.
- Enforce authentication, organization ownership, proposal status rules,
  shared Zod validation, audit logging, and revision checks in the API layer.
- Add MCP read/edit operations that map to the same list, get, and update API
  routes used by the portal.
- Keep tool scope checks and UI authorization aligned with the existing
  proposal scopes; return the same error codes through both paths.

### PR #9 exit gate

- A client can sign in, open the portal, view a proposal as HTML, edit it by
  hand, preview the result, and save it through the API.
- An authorized MCP client can read and make the same edits through the same
  API boundary, with matching validation and audit records.
- Unauthorized users cannot discover or modify another organization's
  proposals.
- API, MCP, and Playwright tests cover the route guard, HTML rendering,
  section editing, revision conflicts, authorization, and UI/MCP parity.

## PR #10 — client portal delivery workspace

Extend the portal beyond proposals with client-safe views of the records that
follow acceptance:

- contracts and their billing schedules;
- invoices, amounts, due dates, and payment status;
- projects and milestones with status, descriptions, and due dates.

Keep this slice read-only for clients. Reuse the existing portal tabs, tables,
document cards, API response envelopes, organization authorization, and shared
scope checks. The UI must call the existing API routes for contracts, billing,
invoices, projects, and milestones; no portal-specific persistence or direct
database access is allowed.

### PR #10 exit gate

- A signed-in client can move from a proposal to its contract, billing
  schedule, invoices, projects, and milestones in one portal.
- Empty states, loading states, and API authorization errors are handled using
  the same patterns as the proposal section.
- Clients can view only records in their organization, and the portal exposes
  no staff-only write controls.
- Typecheck, production build, API scope tests, and portal/route Playwright
  coverage pass.

## PR #11 — proposal review

The client portal (PR #9) and delivery records (PR #10) stay as they are. This slice adds the review loop around a proposal before it is approved.

Review state, who may move it, comment types, visibility, reason codes, unbounded phrases, and length limits are database rows, in the same way as `invoice_status_transition`. The application reads those rows. It does not keep a second copy of the workflow in code.

States: `draft`, `agent_review`, `in_review`, `changes_requested`, `client_revising`, `resubmitted`, `review_meeting_scheduled`, `approved`, `rejected`, `withdrawn`. Each state has a client-facing label (`rejected` is shown as Declined). Actors are `client`, `staff`, and `agent`. Staff cannot reject or request changes without a comment. Those rounds stay put until the client resubmits. Open blocking flags, including the automatic unbounded check, block approval. Decline and withdraw require a reason code from `proposal_review_reason_code`.

Submit and resubmit store a numbered snapshot. Approval locks that version, and contract creation and signing bill from it. A later edit to scope or price stores a new version and returns the proposal to `in_review`.

The admin portal has a filterable review queue and a review view. The client portal shows the client label, client-visible comments and flags, replies, edit, resubmit, and withdraw. Internal notes never leave staff and agent views. MCP tools `unw_submit_proposal_for_review`, `unw_add_review_comment`, `unw_list_review_feedback`, `unw_resolve_review_comment`, `unw_review_decision` (staff membership), `unw_resubmit_proposal`, and `unw_add_review_flag` call the same API and the same scopes.

### PR #11 exit gate

- Transition tests cover each actor, approval blocked by an open blocking flag, the resubmit version loop, and a client who cannot approve.
- A client-scoped read omits internal comments and flags.
- Playwright covers staff request-changes and the client resubmit.
- Typecheck, production build, and the smoke suite pass.

## PR #12 — proposal completion tree

Stacked on the review workflow. A proposal is a tree of nodes (scope, hours, price, milestones, schedule, terms). Node states, their completion weights, and client labels are rows in `proposal_node_state`. Dependency edges are rows: scope affects hours, hours affect price, and scope affects milestones. Schedule dates have no downstream edge.

Changing a locked or agreed node sends that node and everything downstream back to `needs_review`. Nodes that are not downstream stay locked. Completion is the weighted share of locked and agreed nodes. Each change records the percentage before and after and the reason. A lock stores the review version id it was tied to.

`POST /proposals/:id/completion/preview` returns the nodes that would reopen, the percentage before and after, and a sentence from `proposal_completion_copy`. The caller can apply it, park it (`phase_2` or `swap`) without reopening anything, or lock and unlock a node. MCP tools `unw_get_completion_tree`, `unw_preview_change_impact`, `unw_lock_node`, `unw_unlock_node`, and `unw_park_change` use the same routes. The proposal agent is told to narrate that sentence and steer the client back to a bounded shape.

The client portal and the admin review view show the tree and the percentage.

The Workflow Check price tier stores its hour cap (`price_tier.hours`, default 3). Logging time uses that cap through the existing hour-cap check. Intake items that are outside the check are rows in `proposal_intake_park`. `unw_park_item` and `unw_list_parked` read and write that list, and the client portal shows it. The agent asks which part of the workflow hurts most or costs the most time, keeps that slice in the check, and parks the rest as next phases.

### PR #12 exit gate

- A scope change reopens hours, price, and milestones, and leaves schedule and terms locked.
- A schedule-only change does not reopen other nodes.
- Parking does not move node state. A lock requires a version snapshot.
- Typecheck and the completion unit tests pass.

### Later, not in this PR

- Expiry with reminders.
- A follow-up queue.
- Client-selectable optional items.
- View analytics.
- Multi-approver chains, Word redlining, and payments stay out until a later decision.

## PR #13 — accept creates the contract and the first invoice

When the review state is `approved` and the approved version is locked, `POST /proposals/:id/accept` copies that snapshot's scope, price, and terms onto a contract linked by `proposal_version_id`. The first invoice comes from `first_invoice_rule`, one row per pricing model on the catalog version: a deposit percent, the first milestone entry, or the first period. An open Workflow Check credit is applied in the same transaction. Repeating the call returns the same contract and invoice. The accept writes an audit event. `GET /proposals/:id/acceptance` and `unw_accept_proposal` use that result. The client portal shows an Accept action on an approved proposal and the resulting contract and invoice. The admin review view shows the same result.

## PR #14 — due dates, payment terms, and retainage

Invoices and the billing entries they cover take a due date from the contract's payment term. Terms such as due on receipt, net 15, and net 30 are rows in `payment_term`, and one row is the default copied onto a contract at acceptance. A sent invoice whose due date is before today becomes `overdue` when invoices are listed. Retainage is a default percent in `retainage_default`, copied onto the contract, withheld from each invoice, and accumulated. `POST /contracts/:id/retainage/release` writes an explicit release invoice and clears the balance. The portal shows due dates, overdue, withheld retainage, and the held balance. The admin acceptance view shows retainage held. MCP tools `unw_list_payment_terms`, `unw_set_contract_billing_terms`, and `unw_release_retainage` call the same routes.

## PR #15 — optional items and packages

Line items are `required`, `optional`, or `preselected`, and they can sit in a `single` group (one package, such as good, better, or best) or a `multi` group. Staff create the lines and their prices. The client selects in the portal and the total updates from the base price plus the selected deltas. The selection is stored on the proposal options, which are already part of the review version snapshot and freeze when that version is locked. Changing a selection after that lock returns the completion-tree impact preview first; saving it reopens the downstream nodes. `unw_select_proposal_options` only accepts option ids. A body that includes a price is refused.

### PR #15 exit gate

- A single-select group keeps one line, and a required line stays selected.
- The total is the base amount plus the selected deltas.
- A price on the selection request is refused.
- Typecheck and `tests/api/optionPackages.test.ts` pass.

### PR #14 exit gate

- Net 30 from a UTC day lands 30 days later.
- Ten percent retainage is withheld from the invoice and released once.
- A sent invoice due yesterday is overdue.
- Typecheck and `tests/api/billingTerms.test.ts` pass.

### PR #13 exit gate

- A proposal that is not approved cannot be accepted.
- A fixed-price deposit rule invoices half the frozen total, and a second accept does not create another contract.
- An eligible Workflow Check credit reduces the first invoice.
- Typecheck and `tests/api/proposalAccept.test.ts` pass.

## 1. Current repository baseline

The repository currently contains one Vite application and a small Node static
server:

- `src/` — React and TypeScript public site.
- `shared/routes.json` — public route source of truth.
- `shared/redirects.json` — legacy one-hop redirects.
- `scripts/prerender.mjs` — generates the public route HTML and sitemap.
- `server.mjs` — serves `dist/`, redirects, security headers, and the two
  existing contact/scheduling endpoints.
- `server/contact-email.mjs` — current contact and scheduling handlers.
- `tests/` — Playwright smoke, route, and accessibility tests.

Current commands:

```text
npm run check          TypeScript check
npm run build          typecheck, Vite production build, prerender
npm run test:smoke     Playwright smoke suite
npm run test:axe       Playwright accessibility suite
npm run test:production production-style static-server smoke test
npm start              start server.mjs
```

The current application does **not** yet contain `unwh-api`, `unwh-mcp`,
Prisma, OAuth, a database, an authenticated portal, or a staff console.

## 2. Target process topology

The target deployment is one repository with three buildable surfaces:

```text
unwh/                         root web + API package
  src/web/                    public and authenticated React surfaces
  src/server/                 Express API and auth boundary
  src/shared/                 shared client/server helpers
  packages/shapes/            Zod schemas, rules, and JSON Schema export
unwh-mcp/                     separate thin MCP HTTP package
prisma/                       PostgreSQL schema and migrations
deploy/nginx/                 committed reverse-proxy configuration
ecosystem.config.cjs          committed PM2 source of truth
```

Production topology:

```text
nginx/TLS
  unwhelm.net      -> 127.0.0.1:3201 -> unwh-api
  /mcp             -> 127.0.0.1:3202 -> unwh-mcp
```

Both Node processes bind to loopback. The MCP listener never owns database
credentials and forwards the caller's bearer token to `unwh-api`.

### 2.1 Contract-first 75-operation API surface

This table is the contract to approve before implementing business behavior.
The implementation must expose these operation IDs, methods, paths, auth
boundaries, and scopes. A mapped route may initially return `NOT_IMPLEMENTED`,
but it must not silently disappear or be renamed. The current code scaffold is
not approval of this contract; it remains pending until this table is accepted.

| # | Operation | Method | Path | Auth | Scope |
|---:|---|---|---|---|---|
| 1 | `health` | GET | `/health` | public | — |
| 2 | `me` | GET | `/me` | session | — |
| 3 | `public_mcp_info` | GET | `/public/mcp-info` | public | — |
| 4 | `public_pricing` | GET | `/public/pricing` | public | — |
| 5 | `session_get` | GET | `/auth/session` | session | — |
| 6 | `session_logout` | POST | `/auth/logout` | session | — |
| 7 | `magic_link_request` | POST | `/auth/magic-link/request` | public | — |
| 8 | `magic_link_verify` | POST | `/auth/magic-link/verify` | public | — |
| 9 | `google_start` | GET | `/auth/google/start` | public | — |
| 10 | `google_callback` | GET | `/auth/google/callback` | public | — |
| 11 | `mcp_authorize` | GET | `/auth/mcp/authorize` | session | — |
| 12 | `mcp_token` | POST | `/auth/mcp/token` | public | — |
| 13 | `mcp_revoke` | POST | `/auth/mcp/revoke` | bearer | `tokens:write` |
| 14 | `mcp_clients` | GET | `/auth/mcp/clients` | staff | `tokens:read` |
| 15 | `operation_log_list` | GET | `/operation-log` | staff | `audit:read` |
| 16 | `chat_session_create` | POST | `/chat/sessions` | public | — |
| 17 | `chat_session_list` | GET | `/chat/sessions` | session | — |
| 18 | `chat_session_get` | GET | `/chat/sessions/:id` | session | — |
| 19 | `chat_message_create` | POST | `/chat/sessions/:id/messages` | session | — |
| 20 | `chat_message_list` | GET | `/chat/sessions/:id/messages` | session | — |
| 21 | `chat_escalate` | POST | `/chat/sessions/:id/escalate` | session | — |
| 22 | `chat_takeover` | POST | `/chat/sessions/:id/takeover` | staff | `chat:write` |
| 23 | `chat_handback` | POST | `/chat/sessions/:id/handback` | staff | `chat:write` |
| 24 | `proposal_list` | GET | `/proposals` | bearer | `proposals:read` |
| 25 | `proposal_create` | POST | `/proposals` | bearer | `proposals:write` |
| 26 | `proposal_get` | GET | `/proposals/:id` | bearer | `proposals:read` |
| 27 | `proposal_update` | PATCH | `/proposals/:id` | bearer | `proposals:write` |
| 28 | `proposal_delete` | DELETE | `/proposals/:id` | bearer | `proposals:write` |
| 29 | `proposal_status` | GET | `/proposals/:id/status` | bearer | `proposals:read` |
| 30 | `proposal_sections_list` | GET | `/proposals/:id/sections` | bearer | `proposals:read` |
| 31 | `proposal_section_update` | PUT | `/proposals/:id/sections/:sectionId` | bearer | `proposals:write` |
| 32 | `proposal_timeline_update` | PUT | `/proposals/:id/timeline` | bearer | `proposals:write` |
| 33 | `proposal_budget_update` | PUT | `/proposals/:id/budget` | bearer | `proposals:write` |
| 34 | `proposal_options_update` | PUT | `/proposals/:id/options` | bearer | `proposals:write` |
| 35 | `proposal_review` | POST | `/proposals/:id/review` | bearer | `proposals:write` |
| 36 | `proposal_export` | GET | `/proposals/:id/export` | bearer | `proposals:read` |
| 37 | `proposal_import` | POST | `/proposals/import` | bearer | `proposals:write` |
| 38 | `proposal_accept` | POST | `/proposals/:id/accept` | bearer | `proposals:write` |
| 39 | `contract_list` | GET | `/contracts` | bearer | `contracts:read` |
| 40 | `contract_create` | POST | `/contracts` | staff | `contracts:write` |
| 41 | `contract_get` | GET | `/contracts/:id` | bearer | `contracts:read` |
| 42 | `contract_update` | PATCH | `/contracts/:id` | staff | `contracts:write` |
| 43 | `contract_sign` | POST | `/contracts/:id/sign` | bearer | `contracts:write` |
| 44 | `contract_cancel` | POST | `/contracts/:id/cancel` | staff | `contracts:write` |
| 45 | `contract_handoff` | GET | `/contracts/:id/handoff` | bearer | `contracts:read` |
| 46 | `invoice_list` | GET | `/invoices` | bearer | `billing:read` |
| 47 | `invoice_create` | POST | `/invoices` | staff | `billing:write` |
| 48 | `invoice_get` | GET | `/invoices/:id` | bearer | `billing:read` |
| 49 | `invoice_send` | POST | `/invoices/:id/send` | staff | `billing:write` |
| 50 | `invoice_pay` | POST | `/invoices/:id/pay` | bearer | `billing:write` |
| 51 | `invoice_void` | POST | `/invoices/:id/void` | staff | `billing:write` |
| 52 | `billing_schedule` | GET | `/contracts/:id/billing` | bearer | `billing:read` |
| 53 | `change_order_create` | POST | `/change-orders` | bearer | `change_orders:write` |
| 54 | `project_list` | GET | `/projects` | bearer | `projects:read` |
| 55 | `project_create` | POST | `/projects` | staff | `projects:write` |
| 56 | `project_get` | GET | `/projects/:id` | bearer | `projects:read` |
| 57 | `project_update` | PATCH | `/projects/:id` | staff | `projects:write` |
| 58 | `milestone_list` | GET | `/projects/:id/milestones` | bearer | `projects:read` |
| 59 | `milestone_create` | POST | `/projects/:id/milestones` | staff | `projects:write` |
| 60 | `milestone_update` | PATCH | `/milestones/:id` | staff | `projects:write` |
| 61 | `milestone_accept` | POST | `/milestones/:id/accept` | bearer | `projects:write` |
| 62 | `task_list` | GET | `/projects/:id/tasks` | bearer | `projects:read` |
| 63 | `task_update` | PATCH | `/tasks/:id` | staff | `projects:write` |
| 64 | `staff_escalation_list` | GET | `/staff/escalations` | staff | `staff:read` |
| 65 | `staff_escalation_get` | GET | `/staff/escalations/:id` | staff | `staff:read` |
| 66 | `staff_escalation_claim` | POST | `/staff/escalations/:id/claim` | staff | `staff:write` |
| 67 | `staff_escalation_resolve` | POST | `/staff/escalations/:id/resolve` | staff | `staff:write` |
| 68 | `staff_approval_list` | GET | `/staff/approvals` | staff | `staff:read` |
| 69 | `staff_approval_get` | GET | `/staff/approvals/:id` | staff | `staff:read` |
| 70 | `staff_approval_approve` | POST | `/staff/approvals/:id/approve` | staff | `staff:write` |
| 71 | `staff_approval_reject` | POST | `/staff/approvals/:id/reject` | staff | `staff:write` |
| 72 | `staff_hold` | POST | `/staff/records/:type/:id/hold` | staff | `staff:write` |
| 73 | `staff_release` | POST | `/staff/records/:type/:id/release` | staff | `staff:write` |
| 74 | `staff_conversation_list` | GET | `/staff/conversations` | staff | `staff:read` |
| 75 | `staff_conversation_get` | GET | `/staff/conversations/:id` | staff | `staff:read` |

The table intentionally separates the API contract from implementation phases.
The route registry, request/response schemas, authorization middleware, and
business handlers must be reviewed against this table before the 75 operations
are considered implemented.

## 3. Required implementation order

Do not start a later phase until its exit gate is green. Each phase should
leave the repository buildable and deployable.

### Phase 0 — preserve the current site and establish the build spine

1. Add a baseline route/server test around the current `server.mjs` behavior:
   redirects, known routes, unknown extensionless paths, missing assets,
   compression, CSP, and the two existing POST endpoints.
2. Extract reusable static routing into `server/static-routes.mjs` while
   keeping `server.mjs` as the current compatibility entry point.
3. Add `tsconfig.api.json` and a root `build:api` script only after there is
   server TypeScript code to compile.
4. Add a root `build:web` script for the existing Vite/prerender sequence.
5. Make `npm run build` execute, in order:

   ```text
   check -> build:web -> prerender -> build:api -> schema export
   ```

6. Add `npm run smoke` as the one local gate that starts the built services
   and exercises the public site.

**Exit gate:** the current public routes, redirects, accessibility tests, and
production smoke test pass with no API or MCP service required.

### Phase 1 — shared shapes and domain rules

Build this before API routes or MCP tools so every boundary uses the same
runtime validation.

1. Create `packages/shapes` and make it the only Zod source of truth.
2. Add schemas for users/roles, proposals, engagements, handoffs, contracts,
   billing entries, invoices, milestones, escalations, approvals, and chat
   messages.
3. Add domain functions for readiness, pricing constraints, billing-percent
   reconciliation, and handoff construction.
4. Export draft-07 JSON Schema into `dist/schemas/`.
5. Add fixtures for valid, invalid, and boundary cases.
6. Add a CI drift check that fails when generated schemas differ from the
   committed schema output.

**Exit gate:** `npm run schemas:export`, shape tests, and the single-Zod-major
check pass. No API or MCP code may duplicate these schemas.

### Phase 2 — API foundation and database

Build the API before the MCP listener because the API owns persistence,
authorization, OAuth, and audit decisions.

1. Add PostgreSQL Prisma configuration and the first migration.
2. Add `src/server/db.ts` with one shared Prisma client.
3. Add the initial models: `User`, `Org`, `Membership`, `AuditEvent`,
   `OperationLog`, `UserMcpToken`, `McpAuthorizationCode`, and `ChatSession`.
4. Add `memory` and `prisma` backend adapters behind one interface.
5. Add Express startup in `src/server/index.ts` with this middleware order:

   ```text
   trust proxy
   /mcp stream proxy (before body parsing)
   security headers/CSP
   JSON body parser and sessions
   existing contact and scheduling endpoints
   /api/v1 routes
   OAuth and .well-known metadata
   redirects
   static assets and prerendered public routes
   authenticated app-shell routes
   real 404
   ```

6. Preserve the existing `/api/contact/submit` and
   `/api/session/schedule` paths while adding versioned aliases only when
   their request/response contracts are tested.
7. Add `/api/v1/health` and `/api/v1/me`.

**Exit gate:** memory-backed API tests pass; Prisma migrations apply to a
clean PostgreSQL database; public route parity with `server.mjs` is proven.

### Phase 3 — authentication, authorization, and audit

1. Add web sessions with secure production cookie settings.
2. Add Google login and email magic links; keep any test login development-only.
3. Add prospect, client, and staff roles with organization scoping.
4. Add MCP OAuth authorization-code flow with PKCE S256.
5. Store only hashes of opaque MCP tokens and authorization codes.
6. Enforce bearer precedence: an invalid bearer must not fall back to a web
   session cookie.
7. Resolve the MCP tool from `x-unw-mcp-tool`, check its scope, then check
   record and organization authorization.
8. Write a redacted append-only `AuditEvent` for every mutation.

**Exit gate:** the auth matrix covers every route/tool × role × scope case;
revoked tokens fail immediately; audit rows contain no bearer, password, or
raw authorization-code secrets.

### Phase 4 — MCP package and tool registry

Build `unwh-mcp` only after the API auth boundary works.

1. Create `unwh-mcp/package.json` and its own `tsconfig.json`.
2. Add `createServer`, HTTP transport, environment validation, request limits,
   rate limiting, logging, bearer forwarding, and tool-scope lookup.
3. Add resources and prompts before the write tools so clients can discover
   schemas and workflows.
4. Add read-only tools first: `unw_whoami`, `unw_get_service_info`, public
   catalog reads, and proposal reads.
5. Add bounded write tools with explicit confirmation/dry-run behavior.
6. Keep API and MCP tool-scope registries synchronized with a snapshot test.
7. Add an in-process MCP client test and an authenticated HTTP smoke client.

**Exit gate:** `tools/list` is deterministic; every listed tool has a schema,
description, scope, and error contract; the smoke client can initialize,
list tools, call `unw_whoami`, and verify audit behavior.

### Phase 5 — web app shells and hosted chat

1. Add a second Vite entry for the authenticated application shell.
2. Add `/chat`, `/portal`, and `/staff` route metadata separately from public
   SEO routes.
3. Add the hosted chat loop as an API/MCP client, not as a second tool
   implementation.
4. Add prospect session creation, conversation history, proposal draft, and
   escalation-to-human.
5. Add proposal JSON export/import through the shared shapes package.

**Exit gate:** a prospect can complete a proposal to `ready_for_review`, the
JSON round trip is lossless, and the public prerender/sitemap never exposes
private portal or staff routes.

### Phase 6 — handoff, contracts, billing, and project management

Implement in this order because each layer consumes the previous layer's
validated output:

1. proposal acceptance transaction;
2. proposal and project handoff snapshots;
3. contract and billing-entry generation;
4. invoice records and manual invoice workflow;
5. projects, milestones, and tasks;
6. explicit/deemed milestone acceptance;
7. change orders and disputes as staff-reviewed escalations.

**Exit gate:** golden-file tests prove that a proposal produces correct
handoffs, a contract, a 100%-reconciled billing schedule, and the expected
project milestones.

### Phase 7 — staff controls and hardening

1. Add staff queues for escalations and approvals.
2. Add record holds; all agent writes must refuse held records.
3. Add conversation takeover and handback.
4. Add audit hash chaining and activity views.
5. Add abuse limits for anonymous chat and MCP clients.
6. Add backups, monitoring, crash-loop alerts, and secret-rotation docs.

**Exit gate:** security review passes; hold, approval, revoke, and audit-chain
tests pass; no production-only feature depends on a development test user.

## 4. Local build order

Use this order from a clean checkout:

```text
npm ci
npm run db:generate                 # once Prisma exists
npm run schemas:export              # once packages/shapes exists
npm run check
npm run test:unit
npm run build:web
npm run build:api                   # once src/server exists
npm run build:mcp                   # once unwh-mcp exists
npm run test:smoke
npm run test:axe
npm run test:production
```

The combined `npm run build` must call the build steps in dependency order and
must fail on the first failing step. Do not hide TypeScript, schema, or MCP
errors behind a successful Vite build.

## 5. CI order

Every pull request runs:

1. `npm ci`
2. single-major dependency checks (Zod and MCP SDK)
3. typecheck and lint
4. schema export and drift check
5. unit tests
6. PostgreSQL integration tests
7. Prisma migration diff check
8. web, API, and MCP builds
9. start API and MCP with memory/test configuration
10. authenticated MCP smoke test
11. Playwright smoke and accessibility tests

Deployment runs only after all gates pass. Production deployment requires a
manual approval and records the commit SHA, migration result, build output,
PM2 state, health response, and smoke response.

## 6. Production deployment order

The production runbook is deliberately ordered so a failed build cannot
restart a working release:

```text
git fetch origin
git merge --ff-only origin/main
npm ci
npm run db:generate
npm run db:deploy                  # only when migrations changed
npm run schemas:export
npm run build
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
curl http://127.0.0.1:3201/api/v1/health
curl https://unwhelm.net/api/v1/health
npm run smoke -- --url https://unwhelm.net/mcp
```

If any build or smoke step fails, do not restart the production processes.
Rollback uses the previous release commit, reruns the build, and reloads PM2;
database rollback is a separately reviewed migration operation.

Required committed deployment files:

- `ecosystem.config.cjs` with `unwh-api` and `unwh-mcp`;
- `deploy/nginx/unwhelm.net.conf`;
- `deploy/nginx/mcp.unwhelm.net.conf`;
- `docs/deploy-to-production.md` with start, restart, logs, health, rollback,
  and secret-rotation procedures.

## 7. Non-negotiable build gates

- The public site remains route-compatible during the API migration.
- The API owns authentication, authorization, OAuth, persistence, and audit;
  the MCP process does not access the database.
- Every API/MCP write is validated by shared shapes and is auditable.
- Production binds both Node processes to loopback only.
- `/mcp` is not announced publicly until the local listener, OAuth metadata,
  bearer failures, scope failures, rate limits, and valid-client flow are
  tested through HTTPS.
- A release is not complete because TypeScript compiled; health, smoke,
  migration, and route checks must also pass.

## 8. Decisions still required before implementation

1. Confirm whether `unwh-api` remains in this repository (recommended) or is
   split into a second repository.
2. Confirm the production VPS and ports 3201/3202.
3. Confirm the MCP hostname: same-origin `/mcp` or `mcp.unwhelm.net`.
4. Select the magic-link email provider and hosted-chat model provider.
5. Confirm invoice/e-sign provider and retention policy for prospect chats.

