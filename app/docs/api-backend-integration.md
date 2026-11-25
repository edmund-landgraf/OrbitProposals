# unwh ↔ unwh-api: backend integration plan

Status: **Plan, not built.** Date: 2026-10-20.
Scope: wire this web app (`unwh`, repo `UnwhelmNet20`, Vite + React + TS) into an API backend, `unwh-api`, that serves it the same way AMBA's backend serves AMBA's front end.

Every endpoint, table, and env var below that does not exist today is marked **(proposed)**. Nothing here is a description of a running system unless it says *current*.

---

## 0. What exists today (evidence)

### This repo (`UnwhelmNet20`) — current

- `server.mjs`: a dependency-free Node `http` server.
  - Serves `dist/` (built and prerendered by `scripts/prerender.mjs`), with brotli/gzip.
  - Single-hop 301s from `shared/redirects.json`.
  - Returns 404 for any extension-less path not in `shared/routes.json` (plus `/markdown-viewer`).
  - Static security headers with a fixed CSP:
    `default-src 'self'; script-src 'self' https://plausible.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; media-src 'self' https://unwhelm.net; connect-src 'self' https://plausible.io; frame-ancestors 'self'; form-action 'self'`.
  - Two API routes: `POST /api/contact/submit` and `POST /api/session/schedule` (`server/contact-email.mjs`).
  - Listens on `HOST:PORT`, default `127.0.0.1:5193`. It exports `handleRequest` for tests (`UNWHELM_SERVER_NO_LISTEN=1`).
- `vite.config.ts`: dev on `:5192`; the contact API is mounted as Vite middleware. There is no proxy.
- Client routing: `src/App.tsx` maps `Page` → path (`routeByPage`) and uses history API navigation. Breadcrumb trails are kept in `shared/breadcrumbs.json`, and prerender writes BreadcrumbList JSON-LD.
- `/services/agent-setup` shows a placeholder MCP URL, `https://mcp.example.invalid/your-server-url`, marked `TODO` in `src/App.tsx` (`agentMcpServerUrl`).

### AMBA (`D:\repos\edmund-landgraf\AdventureMakerByAct`) — read-only reference

Patterns observed and worth copying:

| Concern | AMBA today | Source |
| --- | --- | --- |
| Process | One Express process, PM2 `amba-api`, `127.0.0.1:3101`; nginx terminates TLS | `docs/mcp/architecture-current-state.md`, `docs/deploy-to-production.md` |
| SPA serving | `express.static("dist/web", { index:false })`, `assets/` immutable cache, then a negative-lookahead catch-all that `sendFile(index.html)` with `no-cache` for everything not `/api/`, `/mcp`, `/.well-known/`, server-rendered pages, etc. Missing static assets 404 instead of falling back | `src/server/index.ts` ~L218–244 |
| API mount | `mountJsonApi(app, "/api/v1", …)` plus a legacy `/api` mount | `src/server/index.ts` L154–155 |
| MCP | `/mcp` is intercepted first and **stream-proxied** to a private MCP listener on `127.0.0.1:3102` (`MCP_HTTP_PORT`); never buffered | `src/server/mcp/publicMcpProxy.ts` |
| OAuth for MCP | Express is its own authorization server; opaque `UserMcpToken` (hashed row, not JWT), scopes + revoke; `/.well-known/oauth-protected-resource[/mcp]` and `/.well-known/oauth-authorization-server` | `docs/mcp/adr-oauth-provider.md`, `src/server/index.ts` L166–168 |
| Human auth | `express-session` cookie (`httpOnly`, `sameSite=lax`, `secure:"auto"`, `trust proxy 1`), Google OAuth + email/password; dev-only test login | `src/server/index.ts` L110–126, `routes/auth.ts` |
| Auth middleware | Bearer `UserMcpToken` wins if present (no fallback to cookie); else session; MCP calls must name a tool (`x-amba-mcp-tool`), scope looked up per tool | `src/server/middleware/auth.ts` |
| CORS | Allow-list set from `webAppUrl()`, env `CORS_ALLOWED_ORIGINS`, dev satellite origins; `credentials:true` | `src/server/index.ts` L45–96 |
| CSP | Per-response nonce for server-rendered public HTML (`publicHtmlCsp.ts`) | `src/server/http/publicHtmlCsp.ts` |
| Dev | `concurrently` API + Vite; satellites proxy `/api` to the API origin read from `.amba-local-api-port.json` | `package.json`, `Amba-AI-Assist/vite.config.ts` |

### `unwh-api`

**Not found.** I searched `D:\repos` and `D:\` two levels deep; there is no `unwh-api`. Everything about it below is **(proposed)**, modelled on AMBA.

---

## 1. Target shape (proposed)

```
Browser / user's own AI (ChatGPT, Claude, Grok, Gemini, Mistral, Cursor…)
        │ HTTPS
      nginx  (TLS, unwhelm.net)
        │ http://127.0.0.1:<UNWH_API_PORT>
   unwh-api (Express, PM2 "unwh-api")
     ├── /api/v1/*            JSON API (session cookie or bearer)
     ├── /mcp                 stream-proxy → 127.0.0.1:<UNWH_MCP_PORT> (private MCP listener)
     ├── /.well-known/oauth-* OAuth AS + protected-resource metadata
     ├── 301s                 shared/redirects.json
     ├── prerendered public   dist/<route>/index.html (from shared/routes.json)
     ├── app shell            dist/app.html for /chat, /portal/*, /staff/*
     └── static assets        dist/assets/* (immutable)
```

A single origin keeps the session cookie first-party and removes CORS from the browser app. Only third-party AI clients hit `/mcp`, and they use bearer tokens.

Repo layout options (decision needed, see §11):
- **A. Monorepo, like AMBA:** `unwh-api` lives in this repo as `src/server` + `tsconfig.api.json`, and `npm run build` = `build:web && build:api`.
- **B. Two repos:** `unwh-api` vendors `shared/` (or pulls it in as a package) and serves `../UnwhelmNet20/dist`.

The plan below works for either. **A** is assumed for the examples because it is what AMBA does.

---

## 2. How unwh-api serves the SPA beside /api and /mcp (proposed)

Order of middleware, mirroring AMBA's `index.ts`:

1. `app.set("trust proxy", 1)`.
2. `/mcp` interceptor → `proxyPublicMcp` (stream, no body parsing). This **must run before** `express.json()`.
3. Security headers / CSP middleware (§8).
4. `express.json({ limit })`, `express-session`.
5. Existing endpoints, ported from `server/contact-email.mjs`: `POST /api/contact/submit`, `POST /api/session/schedule`. Keep the paths so the current front end keeps working. Optionally alias them under `/api/v1/...`.
6. `mountJsonApi(app, "/api/v1")` (§5).
7. `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`.
8. Legacy 301s from `shared/redirects.json` (same single-hop rule as `server.mjs`).
9. `express.static("dist", { index:false })`, with `assets/` getting `Cache-Control: public, max-age=31536000, immutable` and HTML getting `no-cache`.
10. **Prerendered public routes:** for a GET whose normalized path is in `shared/routes.json`, `sendFile(dist/<path>/index.html)`.
11. **App-shell routes:** a GET matching `^/(chat|portal|staff)(/.*)?$` → `sendFile(dist/app.html)` with `no-cache` (§3). Auth is enforced by the API, not by withholding the shell; see §4.
12. Everything else that has no extension → `dist/404.html` with status 404. This keeps today's behaviour: unknown paths are a real 404, not a soft SPA fallback. Missing assets → plain 404 (AMBA's `isMissingStaticAssetRequest`).

`server.mjs` stays as a zero-dependency fallback and as the test harness until unwh-api replaces it in production (§9). To avoid two divergent route tables, port its logic into a shared module, e.g. `server/static-routes.mjs` **(proposed)**.

---

## 3. Public prerendered routes vs app-shell routes

| Kind | Routes | Rendering | Indexed |
| --- | --- | --- | --- |
| Public, prerendered (current) | Everything in `shared/routes.json`: home, services incl. `/services/agent-setup`, industries, work + case studies, about, pricing, contact, privacy | Static HTML shell + hydrate; BreadcrumbList JSON-LD | Yes (sitemap) |
| Prospect chat (proposed) | `/chat` | App shell; anonymous allowed, prospect session created lazily | `/chat` landing: yes (needs a prerendered intro so it isn't an empty page); conversations: no |
| Client portal (proposed) | `/portal`, `/portal/proposals/:id`, `/portal/contracts/:id`, `/portal/invoices`, `/portal/milestones` | App shell; requires a `client` session | No (`noindex`, not in the sitemap, `Disallow: /portal` in robots) |
| Staff console (proposed) | `/staff`, `/staff/escalations`, `/staff/approvals`, `/staff/holds`, `/staff/conversations/:id` | App shell; requires a `staff` session | No (`noindex`, `Disallow: /staff`) |
| Auth (proposed) | `/login`, `/login/callback`, `/oauth/authorize` (MCP consent) | App shell, or a small server-rendered page | No |

Front-end changes (proposed):
- Add a second Vite entry, `app.html` → `src/app/main.tsx`, so the authenticated bundle (chat, portal, staff) doesn't bloat the public pages. The current single chunk already triggers Vite's 500 kB warning.
- `prerender.mjs` keeps reading `shared/routes.json` only. App-shell routes are deliberately **not** added to it, to the sitemap, or to `breadcrumbs.json`. A new `shared/app-routes.json` **(proposed)** lists them for unwh-api's matcher and for tests.

---

## 4. Auth and roles (proposed)

Roles: **prospect**, **client**, **staff**. A staff user may also carry sub-permissions (e.g. `approve_pricing`, `approve_change_order`, `hold_records`); see §11.

| Role | How they authenticate | What they reach |
| --- | --- | --- |
| prospect | Anonymous at first: a server-issued `prospect` session cookie on the first `/chat` message. Optionally upgraded with email magic link or Google so they can come back | `/chat`; their own conversation and proposal draft; proposal JSON export/import |
| client | Email magic link or Google (AMBA's pattern: Google OAuth client + session) after a proposal is accepted and a `Client` record exists | `/portal`; their org's proposals, contracts, invoices, milestones; MCP with a client-scoped token |
| staff | Google Workspace login restricted to the Unwhelm domain (assumption), plus optional TOTP | `/staff`; all records; approvals; holds; join any conversation |

Mechanics, copied from AMBA:
- Browser: `express-session` cookie (`httpOnly`, `sameSite=lax`, `secure:"auto"`), with `SESSION_SECRET` from env.
- MCP: unwh-api is its own OAuth 2.1 authorization server, issuing opaque, hashed `McpToken` rows **(proposed)** with scopes, an optional record allowlist, and instant revoke.
  - The token endpoint takes an auth code and never reads the session (AMBA ADR decision 5).
  - A bearer token, when present, wins and never falls back to the cookie (AMBA ADR decision 6).
  - Scope is checked per resolved tool name (AMBA `toolScopes.ts`).
- The MCP listener does **not** resolve tokens; it forwards the client bearer to `/api/v1` unchanged (AMBA ADR decision 10).
- Authorization is enforced in the API on every record (`assertCanRead(record, user)`). The app shell is public HTML; hiding UI is not access control.
- Denied record access returns 404, not 403, to avoid leaking existence (AMBA's choice).

---

## 5. API surface by area (all proposed)

Prefix `/api/v1`. JSON. Every write is audited (`AuditEvent`). Types are in §6.

### 5.1 Public site
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/contact/submit` | **current**; keep the path |
| POST | `/api/session/schedule` | **current**; keep the path |
| GET | `/api/v1/public/mcp-info` | Returns `{ mcpUrl, authorizationServer, status }` so `/services/agent-setup` can show the real URL when live instead of the hard-coded placeholder. Until live: `status:"not_live"` |
| GET | `/api/v1/public/pricing` | Optional: serve the `pricing` constant so the site and the agents quote the same numbers |

### 5.2 Prospect chat (`/chat`)
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/chat/sessions` | Create or resume a prospect session; returns `conversationId` |
| POST | `/api/v1/chat/conversations/:id/messages` | User message → proposal-agent turn; streamed (SSE) response |
| GET | `/api/v1/chat/conversations/:id` | History |
| GET | `/api/v1/proposals/:id/export` | Download the proposal JSON (`ProposalDocument`, versioned schema) |
| POST | `/api/v1/proposals/import` | Upload a proposal JSON; validated against the schema; creates a draft owned by the caller |
| POST | `/api/v1/chat/conversations/:id/escalate` | Ask for a human → creates an `Escalation` |

The hosted chatbot calls the **same tool implementations** as the MCP server (proposal-agent tools). One tool registry and two transports, so `/chat` and a user's own AI behave identically.

### 5.3 Client portal (`/portal`) and client MCP
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/me` | User, role, org |
| GET | `/api/v1/proposals` / `/:id` | The client's proposals |
| POST | `/api/v1/proposals/:id/accept` | Accept → hands off to the Contract and Project manager agents |
| GET | `/api/v1/contracts` / `/:id` | Contract, terms |
| GET | `/api/v1/invoices` / `/:id` | Invoices, status |
| GET | `/api/v1/projects/:id/milestones` | Milestones and status |
| POST | `/api/v1/change-orders` | Client requests a change → pending staff approval |
| POST | `/api/v1/conversations/:id/messages` | Talk to the Contract or Project manager agent |

MCP tools for client AIs (proposed names): `get_proposal`, `list_invoices`, `get_contract`, `list_milestones`, `request_change_order`, `message_agent`. Scopes: `proposals:read`, `billing:read`, `contracts:read`, `projects:read`, `change_orders:write`.

### 5.4 Staff console (`/staff`)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/staff/escalations` | Queue |
| POST | `/api/v1/staff/escalations/:id/claim` / `/resolve` | |
| GET | `/api/v1/staff/approvals` | Pending pricing and change orders |
| POST | `/api/v1/staff/approvals/:id/approve` / `/reject` | Records approver and reason |
| POST | `/api/v1/staff/records/:type/:id/hold` / `/release` | Put a proposal, contract, invoice, or project on hold; agents must refuse writes on held records |
| GET | `/api/v1/staff/conversations` / `/:id` | Any conversation |
| POST | `/api/v1/staff/conversations/:id/takeover` / `/messages` / `/handback` | Human steps in; the agent pauses while a human holds the conversation |

Edmund's description of the staff console was cut off; this list covers only what he named.

---

## 6. Shared types (proposed)

Put them in `shared/types/` (plain TS, no runtime deps), imported by the SPA, unwh-api, and the MCP listener. JSON Schemas generated from them (or hand-written) go in `shared/schemas/` for proposal import validation.

```ts
type Role = "prospect" | "client" | "staff";
type RecordStatus = "draft" | "pending_approval" | "active" | "on_hold" | "closed";
type EngagementKind = "workflow_check" | "capped_hours_4" | "capped_hours_8" | "fixed_price";

interface ProposalDocument {        // the downloadable / importable JSON
  schemaVersion: 1;
  id: string;
  title: string;
  engagement: EngagementKind;
  scope: { summary: string; deliverables: string[]; assumptions: string[] };
  priceCents?: number;              // set or confirmed by staff approval, not by the agent alone
  createdAt: string; updatedAt: string;
}
interface Contract { id: string; proposalId: string; status: RecordStatus; terms: string; billing: { kind: EngagementKind; capHours?: number } }
interface Invoice { id: string; contractId: string; amountCents: number; status: "draft" | "sent" | "paid" | "void"; dueDate: string }
interface Milestone { id: string; projectId: string; title: string; due?: string; status: "planned" | "in_progress" | "done" | "blocked" }
interface Escalation { id: string; conversationId: string; reason: string; status: "open" | "claimed" | "resolved"; assignee?: string }
interface Approval { id: string; kind: "pricing" | "change_order"; recordId: string; status: "pending" | "approved" | "rejected"; decidedBy?: string }
interface Conversation { id: string; agent: "proposal" | "contract" | "project_manager"; ownerId: string; humanHolder?: string }
```

The `pricing` constant now in `src/App.tsx` should move to `shared/pricing.ts` so the site, the agents, and the API quote the same numbers.

---

## 7. MCP endpoint (proposed)

- Public URL: `https://unwhelm.net/mcp`. This is an assumption: same origin as the site, as AMBA does with `amba.unwhelm.online/mcp`. A subdomain such as `mcp.unwhelm.net` would also work; it would need its own nginx server block and CORS entry.
- unwh-api stream-proxies `/mcp` to a private listener on `127.0.0.1:${UNWH_MCP_PORT}`, which is never exposed. The code is a copy of AMBA's `publicMcpProxy.ts`.
- Keep `/mcp` and the `/.well-known/oauth-*` metadata **dark until the listener answers locally** (AMBA ADR decision 3). When it is live, replace `agentMcpServerUrl` in `src/App.tsx` (or read it from `/api/v1/public/mcp-info`) and remove the "placeholder" note on `/services/agent-setup`.
- Client registration (Dynamic Client Registration vs Client ID Metadata Documents) is deferred until each AI vendor's connector screen shows its real redirect URI (AMBA ADR decision 8). Expect to test ChatGPT and Grok first; the site copy says those two are tested.

---

## 8. CSP and server.mjs changes

Current CSP (above) stays valid for the public pages. Changes (proposed):

| Directive | Change | Why |
| --- | --- | --- |
| `connect-src` | Keep `'self'`; add nothing for `/api` and `/mcp` (same origin). Add `wss:`/the same origin only if chat streaming uses WebSockets; SSE needs no change | Chat streaming |
| `form-action` | Add the OAuth IdP origins if login posts or redirects through a form (e.g. `https://accounts.google.com`) | Login |
| `frame-ancestors` | `'none'` for `/portal`, `/staff`, `/oauth/authorize` | Clickjacking protection on consent and approval screens |
| `media-src` | `'self' https://unwhelm.net` today; drop the absolute host once served same-origin | Tidy |
| `script-src` | Keep `'self' https://plausible.io`. If server-rendered pages are added (consent screen), use AMBA's per-response nonce helper | No inline scripts |
| Headers on `/api` | `Cache-Control: no-store` for authenticated responses | Don't cache private data |
| App shell | `X-Robots-Tag: noindex` on `/portal`, `/staff`, `/chat/*` | Keep private routes out of search |

`server.mjs` (proposed):
- Extract the route, redirect, and static logic into `server/static-routes.mjs`, which both `server.mjs` and unwh-api import. `handleRequest` stays exported for the existing tests.
- Add the `/chat|/portal|/staff` → `dist/app.html` rule so production (even before unwh-api) doesn't 404 the app shell.
- Optional: an `UNWH_API_ORIGIN` env var that makes `server.mjs` reverse-proxy `/api` and `/mcp`. This is a stopgap only if the static server keeps fronting production for a while.

---

## 9. Dev proxy in Vite (proposed)

Same pattern as `Amba-AI-Assist/vite.config.ts`:

```ts
function unwhApiOrigin() {
  return (process.env.UNWH_API_ORIGIN ?? "http://127.0.0.1:3201").replace(/\/$/, ""); // port is an assumption
}
export default defineConfig({
  plugins: [contactApiPlugin(), react()],   // keep until /api/contact moves into unwh-api
  server: {
    port: 5192, strictPort: true,
    proxy: {
      "/api/v1": { target: unwhApiOrigin(), changeOrigin: false, xfwd: true },
      "/mcp": { target: unwhApiOrigin(), changeOrigin: false, ws: false },
      "/.well-known/oauth-": { target: unwhApiOrigin(), changeOrigin: false },
    },
  },
});
```

- `changeOrigin:false` + `xfwd:true` keeps cookies host-scoped to `localhost:5192`, as AMBA does.
- `npm run dev` → `concurrently npm:dev:api npm:dev:web` (AMBA uses `wait-local-api.mjs` before starting Vite).
- Playwright keeps using the static build. API tests run against unwh-api with a seeded test DB and a dev-only test login (AMBA: `ENABLE_TEST_LOGIN`, never enabled in production).

---

## 10. Deployment to the VPS (proposed; mirrors AMBA)

- PM2 app `unwh-api` (`ecosystem.config.cjs`), `127.0.0.1:${PORT}`; PM2 app `unwh-mcp` on `127.0.0.1:${UNWH_MCP_PORT}`. Both bind to localhost only.
- nginx `server_name unwhelm.net www.unwhelm.net` → `proxy_pass http://127.0.0.1:${PORT}`.
  - For `location /mcp`: `proxy_buffering off; proxy_read_timeout 3600s;` (AMBA's proxy uses a one-hour upstream timeout).
  - Chat SSE needs `proxy_buffering off` as well.
- Deploy steps (same as AMBA's `deploy-to-production.md`):
  1. `git pull`.
  2. `rm -rf node_modules && npm ci`. This also covers the rolldown native binding issue seen on Linux.
  3. Run DB migrations if the schema changed.
  4. `npm run build` (web + prerender + api).
  5. `pm2 startOrReload ecosystem.config.cjs --update-env && pm2 save`.
  6. Run `npm run test:production` (`scripts/production-smoke.mjs`) against the live origin.
- Env (proposed): `PORT`, `UNWH_MCP_PORT`, `SESSION_SECRET`, `DATABASE_URL`, `GOOGLE_CLIENT_ID/SECRET`, `STAFF_EMAIL_DOMAIN`, the current SMTP vars for contact mail, `MODEL_API_KEY` for the hosted `/chat` agent, and `PUBLIC_ORIGIN=https://unwhelm.net`.
- Data store: assumed Postgres + Prisma, as AMBA uses. Not decided (§11).
- Cut-over: run unwh-api on a new port beside the current static server, switch the nginx `proxy_pass`, keep the old process for rollback, then retire it.

---

## 11. Phased rollout (proposed)

| Phase | Ships | Exit criteria |
| --- | --- | --- |
| 0. Parity | unwh-api serves `dist` exactly like `server.mjs` (routes, 301s, 404s, headers, contact endpoints) | Existing Playwright suite + production smoke pass against unwh-api; nginx switched |
| 1. Auth + data | Sessions, roles, `/api/v1/me`, DB, audit log, staff login | Staff can sign in; record-level authz tests |
| 2. Prospect chat | `/chat` app shell, proposal-agent tools, proposal JSON export/import, escalate-to-human | A prospect gets a proposal draft without their own AI; import round-trips |
| 3. Staff console (MVP) | Escalation queue, conversation takeover/handback, pricing approval, holds | Every agent-priced proposal needs staff approval; held records reject agent writes |
| 4. Client portal | Proposal/contract/invoice/milestone views, change-order requests | Client sees only their org's records |
| 5. Public MCP | Private listener → `/mcp` proxy, OAuth AS, scoped tokens, revoke; real URL on `/services/agent-setup` | ChatGPT Plus and Grok connect end to end; revoke fails the next call |
| 6. Hardening | Rate limits, abuse controls on anonymous chat, backups, monitoring | — |

### Open questions
1. Monorepo (A) or separate `unwh-api` repo (B)?
2. Database choice and hosting (Postgres on the same VPS as AMBA?).
3. MCP host: `unwhelm.net/mcp` or `mcp.unwhelm.net`?
4. Prospect identity: anonymous cookie only, or require email before a proposal is saved or exported?
5. Which model and provider runs the hosted `/chat` agent, and who pays for its usage (it isn't the visitor's own plan)?
6. Staff sub-permissions: can any staff member approve pricing, or only Edmund?
7. Invoices: generated in unwh-api, or synced from an accounting system (which one)?
8. The rest of Edmund's staff-console description, which was cut off.
9. Proposal JSON schema: is it a public, documented format for other AIs, or internal?
10. Retention: how long are prospect conversations kept, given the "your data stays with you" promise on the site?

---

## Assumptions made
- `unwh-api` does not exist yet; its design copies AMBA's Express + PM2 + nginx + session + opaque-MCP-token model.
- unwh-api is on the same origin as the site (`unwhelm.net`) and serves `/api`, `/mcp`, and the SPA from one process.
- Ports `3201` (API) and `3202` (MCP) are placeholders.
- Staff log in with Google, restricted to the company domain.
- Postgres + Prisma for storage.
- The hosted chat and the MCP server share one tool registry.
