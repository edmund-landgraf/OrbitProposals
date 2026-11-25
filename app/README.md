# Orbit Proposals — application

This directory is the proposal manager: API, web UI, database layer, and MCP server. The standalone HTML marketing site for Orbit Proposals lives at the [repository root](../README.md).

Nothing here implements multi-user tenancy yet. Planning lives under [`../docs/`](../docs/):

- [MULTI_USER_PLAN.md](../docs/MULTI_USER_PLAN.md) — multi-tenant architecture for accounts, organizations, roles, MCP tokens, and data isolation.
- [SUPABASE_PRISMA_MIGRATION.md](../docs/SUPABASE_PRISMA_MIGRATION.md) — moving the current Postgres + Prisma setup to Supabase.

## What it is

Orbit Proposals is the product that lets a person, or an MCP client such as Claude or Cursor, draft a proposal, review it, sign a contract, and bill the work. Today that product is Unwhelm's own practice tool. The plan is to make the same code a multi-tenant product.

Three processes, same as production ([`../docs/app-DEPLOY.md`](../docs/app-DEPLOY.md)):

| Process | Entry | Default port |
|---|---|---|
| API | `server/index.ts` (`npm run dev:api` / `dist-api/server/index.js`) | 3201 |
| MCP | `unwh-mcp/src/http.ts` | 3202, path `/mcp` |
| Web | Vite in development, `server.mjs` serving `dist/` in production | 5192 dev, 3200 in the current VPS layout |

The MCP server does not talk to the database. It forwards the caller's bearer token to the API (`unwh-mcp/src/apiClient.ts`, `unwh-mcp/src/http.ts`). `unwh-mcp/src/createServer.ts` registers 158 tools, and `unwh-mcp/src/anonymousDraft.ts` adds `unw_draft_proposal`.

## What was copied

Everything required to build and run that product, including the Vite app it is bundled with:

- `server/` — Express 5 API, auth, proposals, contracts, billing, e-sign, try-me sandbox.
- `unwh-mcp/` — Streamable HTTP MCP server.
- `prisma/` and `prisma.config.ts` — schema and SQL migrations.
- `packages/shapes/` — shared pricing and API shapes.
- `shared/` — scopes, retry, catalog seed, routes.
- `scripts/` — bootstrap, seed, reminders, purge, admin helpers.
- `src/` — React UI. Proposal surfaces are `src/portal.tsx`, `src/tryMe.tsx`, `src/tryMeHelp.tsx`, `src/tryChat.tsx`, `src/admin.tsx`, `src/templateEditor.tsx`, `src/reviewPanels.tsx`, `src/progressPanel.tsx`, `src/remindersPanel.tsx`, `src/requestAccess.tsx`, and the MCP connect pages. Marketing pages live in the same `src/App.tsx` bundle, so they came along.
- `tests/` — API and Playwright coverage.
- `public/` — static site assets used by that bundle.
- Root config: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.api.json`, `vite.config.ts`, `playwright.config.ts`, `server.mjs`, `.env.example`.

Not copied: `node_modules`, build output (`dist/`, `dist-api/`, `unwh-mcp/dist`), and any `.env`. `.env.example` has empty placeholders only. Do not put real secrets in this folder.

`package.json` is named `orbit-proposals`.

## Run it

From this directory:

```bash
cp .env.example .env
# Set DATABASE_URL and UNWH_SESSION_SECRET. Leave other secrets empty until you need them.

npm install
npm run db:bootstrap   # empty Postgres: applies the pg_dump baseline, then the rest
npm run db:seed
npm run dev:api        # http://127.0.0.1:3201
npm run dev            # http://localhost:5192 , proxies /api to the API
```

MCP, in another shell:

```bash
npm --prefix unwh-mcp install
UNWH_API_ORIGIN=http://127.0.0.1:3201 npx --prefix unwh-mcp tsx unwh-mcp/src/http.ts
```

`npm run dev:api` loads `.env`. `npm run start:api` does not; the process environment must already contain `DATABASE_URL` and `UNWH_SESSION_SECRET` (`server/index.ts`).

`npm run db:migrate` is `prisma migrate deploy`. On a brand-new database use `npm run db:bootstrap` instead. Migration `prisma/migrations/0001_init_unwhelm` is a `pg_dump` that `prisma migrate` cannot apply by itself (`scripts/db-bootstrap.ts`).

Production build:

```bash
npm run build:all
```

## Identity today

The database already has `User`, `Organization`, and `Membership` (`prisma/schema.prisma`). Production behavior is still one practice: a session stores a single `organizationId`, many routes ignore it and take the first active membership, and a staff or admin principal can read proposals outside that organization. [`MULTI_USER_PLAN.md`](../docs/MULTI_USER_PLAN.md) lists each of those spots.

`UNWHELM_TENANT_ID` in `.env.example` is the Azure AD tenant for Microsoft Graph mail (`server/contact-email.mjs`). It is not an application tenant.
