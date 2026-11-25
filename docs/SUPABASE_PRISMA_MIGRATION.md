# Postgres and Prisma, and a move to Supabase

Status: plan only. The application still talks to whatever Postgres `DATABASE_URL` points at. This document records how that connection works in the repo, then how Prisma would run if that database were a Supabase project.

Nothing here adopts Supabase Auth, Storage, or Row Level Security. Those are options, with a recommendation: **use Supabase as managed Postgres first, keep the current magic-link users and the current `public` schema, and keep enforcing tenancy in application code.** Add RLS only as a second check, on a role that does not bypass it. Do not point Prisma at the `anon` or `service_role` API keys.

Related: [MULTI_USER_PLAN.md](MULTI_USER_PLAN.md) for organizations and tenant isolation. This file is about the database host and the Prisma client.

## 1. What the repo does today

### 1.1 Schema

`prisma/schema.prisma`:

- `generator client { provider = "prisma-client-js" }`.
- `datasource db { provider = "postgresql" }`. There is no `url` and no `directUrl` in the schema. That matches Prisma 7, which takes the CLI connection string from `prisma.config.ts` instead of the schema file.
- The schema has no `schemas = [...]` list and no multi-schema preview. Prisma's default is the `public` schema. Tables and enums live there.
- Identifiers are mixed. The baseline dump created quoted PascalCase tables (`User`, `Proposal`, `Organization`, `McpToken`). Later models set `@@map` to snake_case (`proposal_attachment`, `content_library_item`, `contract_esign_request`, `try_me_session`). Both styles are in `public`.
- Enums are Postgres enums (`Role`, `MembershipStatus`, `EngagementKind`, and the rest at the top of the schema).
- File bytes are `Bytes` columns: `ProposalAttachment.bytes`, `ProposalUploadPart.bytes`, `ContractEsignArtifact.bytes`. They are not object-storage URLs.
- There is no `auth.users` foreign key. `User` is an application table (`id` UUID, unique `email`, `isAdmin`, TOTP columns, `suspendedAt`).

`prisma.config.ts` is the whole CLI datasource:

```ts
export default {
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
};
```

One URL. Migrate, generate, and any future `db pull` all use `DATABASE_URL`. There is no shadow database URL and no direct-versus-pooled split.

### 1.2 Runtime connection

`server/db.ts` builds the client the API uses:

- Reads `DATABASE_URL`. If it is missing, it substitutes `postgresql://missing:missing@127.0.0.1:1/missing` so unit tests can import the module. The first real query fails, and `/health` surfaces that as `DATABASE_UNAVAILABLE`.
- `new PrismaPg({ connectionString: databaseUrl })` from `@prisma/adapter-pg` (dependency `@prisma/adapter-pg` and `pg` in `package.json`).
- `new PrismaClient({ adapter })`. The client does not read `prisma.config.ts` at runtime. The adapter's connection string is the only runtime URL.
- A `$extends` query wrapper retries transient connection errors (`UNWH_DB_RETRY_ATTEMPTS`, default 4). Writes retry only when the database was never reached (`shared/retry.ts`, `shouldRetryDbOperation`).
- In non-production, the client is stored on `globalThis` so the dev process does not open a new pool on every reload.

`server/index.ts` opens a second pool to the same URL: `connect-pg-simple` with `conString: process.env.DATABASE_URL`, `tableName: "session"`, `createTableIfMissing: false`. Express sessions are not Prisma models. The `session` table is not created by any file under `prisma/migrations/` (the only "session" SQL there is `session_scope_grant`, `guidance_session_event`, and `try_me_session`). A new database needs that table created before login works. `connect-pg-simple` expects `sid`, `sess` JSON, and `expire`.

Scripts that open their own client, each with `PrismaPg` and `DATABASE_URL`: `scripts/seed.ts`, `scripts/make-admin.ts`, `scripts/mint-magic-link.ts`, `scripts/org-attach.ts`, `scripts/purge-expired.ts`, `scripts/purge-demos.ts`, `scripts/purge-agent-traces.ts`, `scripts/scripted-proposal.ts`. Tests that opt in with `UNWH_DB_TEST=1` do the same (`tests/api/proposalReviewDb.test.ts` and the other `*Db.test.ts` files).

`server/prismaClient.ts` only re-exports `PrismaClient`. It does not construct a connection. Playwright's ESM loader is why that file uses `createRequire`.

### 1.3 Migrations

`prisma/migrations/migration_lock.toml` pins `provider = "postgresql"`.

`0001_init_unwhelm/migration.sql` is a `pg_dump` from PostgreSQL 16.13, not a hand-written Prisma migration. It contains:

- psql meta-commands `\restrict` and `\unrestrict`, which Prisma's migrate runner does not understand.
- `SELECT pg_catalog.set_config('search_path', '', false);` which clears the search path for the rest of the script.
- `SET row_security = off;` as a session setting for the dump restore.
- `CREATE TYPE` and `CREATE TABLE` in `public`. No `CREATE EXTENSION`.

`scripts/db-bootstrap.ts` exists because `prisma migrate deploy` cannot apply that file on an empty database. The script:

1. If `0001` is already recorded in `_prisma_migrations`, it only runs `prisma migrate deploy` for the rest.
2. If `public` already has tables and `0001` is not recorded, it refuses.
3. On an empty database, it runs a sanitized copy of `0001` in memory (strips `\restrict` / `\unrestrict` and the empty `search_path` line), then `prisma migrate resolve --applied` so the checksum of the **committed** file is what Prisma records.
4. Then `prisma migrate deploy`.

`npm run db:migrate` is `prisma migrate deploy` and assumes `0001` is already applied. `npm run db:bootstrap` is the command for a fresh Postgres. `package.json` `"postinstall": "prisma generate"` generates the client and does not migrate.

Migrations `0002` through `0075` are normal SQL. Nothing in `prisma/migrations` enables RLS or creates a policy. Nothing creates an extension. `0001` sets `row_security` off for that session only; it does not persist a database default that would disable RLS later.

Production (`DEPLOY.md`) applies migrations with `npx prisma migrate deploy` on the VPS after a successful build, against Postgres on `127.0.0.1:5432`. There is no backup script in the repo.

### 1.4 Auth that is not the database

Sign-in is magic links in the `MagicLink` table, sessions in the `session` table, and MCP tokens in `McpToken` (`server/routes/systemAuth.ts`, `server/mcpRefresh.ts`). Google's callback returns `501 NOT_IMPLEMENTED`. `UNWHELM_TENANT_ID` is the Azure AD tenant for Graph mail (`server/contact-email.mjs`), not a Postgres tenant.

Supabase would be a new system beside all of that. Moving the database does not require moving login.

## 2. Connection strings on Supabase

Supabase gives three ways to open Postgres. Prisma in this repo needs two of them, because the CLI and the `PrismaPg` adapter do not share a URL.

| Use | Which URL | Why |
|---|---|---|
| `prisma migrate`, `db:bootstrap`, `prisma generate`'s engine when it connects | Direct, or the session pooler if the host has no IPv6 | Migrate takes session-level advisory locks and holds a session for the migration. Transaction-mode pooling (port 6543) will break that. |
| API and scripts at runtime (`server/db.ts`, `PrismaPg`) | Session pooler, or direct if the connection count stays small | The VPS runs a few long-lived Node processes, not a swarm of serverless functions. A small pool is enough. |

Supabase's usual endpoints:

- **Direct:** `postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres`. Often IPv6-only. The current VPS (`DEPLOY.md`, `vps-unwh`) is a typical IPv4 host. Direct will fail from there unless the Supabase project has the IPv4 add-on or the host has IPv6. Test with one connection before cutover.
- **Session pooler (Supavisor):** host `aws-[region].pooler.supabase.com` (or the newer pooler host shown in the dashboard), port **5432**, user `postgres.[project-ref]`. The server session is dedicated for the life of the client connection. This is the right pooled URL for Prisma migrate and for interactive transactions.
- **Transaction pooler:** same pooler host, port **6543**. The server connection is returned to the pool after each transaction. Prepared statements and `SET` that are not `SET LOCAL` leak or error. Do not use 6543 for `prisma migrate deploy`. Do not use it for the `PrismaPg` pool unless prepared statements are turned off and every tenant `set_config` is local to a transaction (section 5).

This repo's `pg` dependency does not understand Prisma's old `?pgbouncer=true` query flag. That flag was for the Prisma engine in versions that put `url` and `directUrl` in the schema. `@prisma/adapter-pg` speaks the `pg` protocol. On a transaction pooler, `pg` will still prepare statements unless the pool is configured not to. The safe choice for this codebase is the **session pooler or the direct port**, not port 6543.

### 2.1 Where each URL goes

There is no `directUrl` field in `prisma/schema.prisma` today, and adding one there does nothing useful on Prisma 7: the schema datasource block has no URL fields, and `prisma.config.ts` is what migrate reads.

Recommended split, without inventing a second config key the CLI might ignore:

- `DIRECT_URL` — direct 5432, or the session pooler if direct is unreachable. `prisma.config.ts` should read this for migrate: `datasource.url` becomes `process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? ""`. Bootstrap and migrate then avoid the transaction pooler even if someone puts the pooler in `DATABASE_URL`.
- `DATABASE_URL` — the URL the running API uses. `server/db.ts` and the scripts keep reading it. On Supabase, set it to the session pooler (port 5432 on the pooler host, user `postgres.[ref]`).
- `connect-pg-simple` in `server/index.ts` uses `DATABASE_URL` as well. Session mode pooling is fine for it. Transaction mode is not, because the session store's queries are short but the driver may still prepare them, and a `SET` from another feature on the same pooled connection would leak.

Do not put the database password in the repo. `.env.example` already has a placeholder `DATABASE_URL`. Add a placeholder `DIRECT_URL` only when the config change is implemented. This plan does not edit that file's real values; there are none.

Pool size: `PrismaPg` is constructed with a connection string and no `max`. The `pg` default pool is 10. Three Node processes (API, plus scripts run by hand, plus the session store's own pool) on a Supabase project with a small connection limit can exhaust it if `DATABASE_URL` is the direct port. Set an explicit pool (`new Pool({ connectionString, max: 5 })` passed to `PrismaPg`) when the URL is Supabase. The session store needs its own small pool. The MCP process does not connect to Postgres.

`server/db.ts` retries on connection errors. A pooler that closes idle connections will trip that path. That is acceptable. Do not retry a write that the server may have committed; the existing helper already limits write retries to "never reached the database."

## 3. Running Prisma migrate against Supabase

1. Create the Supabase project. Prefer a Postgres major version close to 16. The baseline dump is from 16.13. Supabase projects are commonly 15 or 17. Plain `CREATE TABLE` / `CREATE TYPE` from this repo does not need version-specific syntax, but restore it once on a staging project of the exact version you will ship before you trust production.
2. Do not enable Supabase's example schemas or seed apps in `public` before bootstrap. `db:bootstrap` refuses to run `0001` if `public` already contains tables other than `_prisma_migrations`.
3. From this directory, with `DIRECT_URL` (or `DATABASE_URL` if that is the direct/session URL) pointing at the empty database:

```bash
npm install
npm run db:bootstrap
```

That is the supported path. `npm run db:migrate` alone will fail on a fresh database because of `0001`.

4. `prisma migrate deploy` then applies `0002` onward. It records checksums in `_prisma_migrations` in `public`. Leave that table alone. Supabase has its own `supabase_migrations.schema_migrations` for the Supabase CLI. The two histories must not both own `public`.
5. Generate the client with `npx prisma generate`. Runtime still needs `DATABASE_URL` in the API process. Generate does not embed the URL.
6. Create the `session` table before the API accepts logins. Because `createTableIfMissing` is false, the API will error on the first session write if the table is absent. Add a SQL migration for it when this move is implemented, matching `connect-pg-simple`'s columns, so the table stops living outside Prisma. Until that migration exists, create it by hand on the Supabase project and record that you did.
7. `npm run db:seed` loads catalog and template rows the API expects (`scripts/seed.ts`).

`prisma db pull` against a Supabase project as the `postgres` user will see `auth`, `storage`, `realtime`, and the rest. A pull that gets committed would make the next migration try to create or drop Supabase-owned objects. Do not run `db pull` on the Supabase project. If a pull is ever required, restrict it to `public` and review the diff by hand. This schema does not set `schemas`, so the CLI has no such restriction today.

`prisma migrate dev` wants a shadow database. Supabase will not give you a second empty database on the same project for free, and creating one in `public` is wrong. Develop migrations against local Postgres or `supabase start` (section 7), and use only `migrate deploy` against the hosted project.

## 4. Coexisting with Supabase-managed schemas

Supabase owns, among others, `auth`, `storage`, `realtime`, `extensions`, `supabase_migrations`, `vault`, and `graphql`. Prisma must not create, alter, or drop those.

Rules that match this repo:

- All application tables stay in `public`, which is already where every migration writes.
- Do not add `auth` or `storage` to a Prisma `schemas` list unless you are intentionally modeling a read-only mapping, and even then mark those models so migrate does not diff them. The simpler rule: Prisma never names those schemas.
- Do not install the Supabase CLI's migration runner as a second writer of `public`. If a trigger on `auth.users` is required later, put that one function in a Supabase CLI migration and keep every application table in `prisma/migrations`.
- Storage buckets are unrelated to `ProposalAttachment.bytes`. Leaving bytes in Postgres is valid. Moving them to Supabase Storage is a product change (signed URLs, tenancy on the object path, virus scanning) and is out of scope for a host migration. The bytea columns will dominate backup size; that is a reason to plan storage later, not a reason to switch in the same cutover.
- `SET row_security = off` inside `0001` applies only while that script runs. It does not turn off RLS on the Supabase project afterward. New tables created by later migrations have RLS off until someone enables it, which is the same as a stock Postgres. Supabase's API roles (`anon`, `authenticated`) have no privileges on those tables unless you grant them. Prisma does not use those roles. Do not grant `anon` anything on `public`.

## 5. Supabase Auth versus the current auth

### 5.1 Recommendation

Keep `User`, `MagicLink`, express sessions, and `McpToken` for the first Supabase move. The authorization server at `/.well-known/oauth-authorization-server` (`server/routes/systemAuth.ts` and the duplicate mount in `server/index.ts`) is a custom OAuth authorization server for MCP clients. Supabase Auth is not a substitute for that. It does not issue the hashed `McpToken` rows, it does not run the consent screen, and it does not know `proposals:write`.

Using Supabase only as Postgres avoids a second user table and a mapping problem during cutover.

### 5.2 If login moves to Supabase Auth later

That is a follow-on project, not part of the database move.

- `auth.users.id` would become `User.id`. A trigger in `auth` (owned by the Supabase CLI, not by Prisma) inserts the `public.User` row and, if the product requires it, a personal `Organization` and `Membership`. Prisma would read `User`; it would not model `auth.users` as a migrated table.
- Magic-link routes in `systemAuth.ts` would be replaced by Supabase's mailer. The reviewer password path (`REVIEWER_EMAIL`) and admin TOTP (`server/auth/totp.ts`, key from `UNWH_TOTP_KEY`) would need a new home. Supabase MFA and the app's TOTP columns would otherwise both be active.
- Browser sessions could become a Supabase access token checked in middleware, instead of `connect-pg-simple`. The `session` table could go away only after that middleware exists. MCP tokens stay opaque rows in `McpToken`. Do not put a Supabase JWT in the MCP client and call it the bearer token the API already hashes and looks up.
- `User.email` unique and `auth.users` email unique must be the same string. Suspension is `User.suspendedAt` today (`server/auth/suspension.ts`). A ban in Supabase Auth would not set that column unless a trigger or the API does.
- Tenant membership does not come from `auth.users`. It stays `Membership`. The JWT can carry `organization_id` as app metadata after the user picks an org, but the API must still load the membership and refuse a claim that does not match a row. A client-supplied org id is not authority. This is the same rule as `MULTI_USER_PLAN.md`.

Do not start this until magic-link login on Supabase Postgres has already run in production for a while.

## 6. Row Level Security next to Prisma

Prisma connects as one role: whoever is in the connection string. On Supabase that is usually `postgres`, which owns `public` and **bypasses RLS**. The `service_role` key also bypasses RLS, and it is not a Postgres URL this app should use. Policies on `Proposal` would not run for `server/db.ts` as it is written. Turning on RLS and adding policies does not, by itself, isolate tenants.

Three options:

1. **Application checks only (do this first).** `MULTI_USER_PLAN.md` puts `organizationId` in every query through one tenant context. That works on the VPS and on Supabase with the current privileged role. The two-org tests are the enforcement. This matches the code, which has never had a policy.

2. **RLS as a backstop, with a role that is subject to it.** Create `orbit_app` with `NOBYPASSRLS`, `GRANT` the table privileges Prisma needs, and set the runtime URL to that role. Keep `postgres` / `DIRECT_URL` for migrate, because migrate must own the tables. Policies look like: `organization_id = current_setting('app.organization_id', true)::uuid` on tenant tables, and no policy that allows `anon`.

   Inside every request, the queries for that request must run in one transaction that starts with:

   ```sql
   SELECT set_config('app.organization_id', $org, true);
   ```

   The third argument `true` means `SET LOCAL`: it ends with the transaction. That is required. `PrismaPg` uses a pool. A session-level `SET` on a checked-out connection is still on that connection when the pool lends it to the next request, which would serve the next tenant under the previous org id, or throw if the cast fails. `server/db.ts` also retries operations. A retry must not reuse a transaction that already ran writes. The existing retry wrapper runs per operation, outside a tenant transaction. A tenant `set_config` has to live inside the route's `$transaction`, after the retry decision, not in the extension that wraps every query.

   Platform-admin routes that intentionally cross tenants cannot use the same restricted transaction. They use a separate code path. If they use `orbit_app`, the policy must allow a second setting such as `app.platform_admin = 'on'`, and those queries must set it. Prefer a dedicated admin role over a setting the app could forget to clear.

   Tables without `organization_id` (proposal sections, messages, invoices) need policies that join the parent, or they need the denormalized column from the multi-user plan. A policy on `Proposal` does not protect `Invoice` if the role has `SELECT` on `Invoice`.

   Enable RLS only after the policies exist for every tenant table, including join tables. In Postgres, a table with RLS and no policy returns no rows for `orbit_app`. A missed table is a production outage, which is preferable to a leak, but it should be found by the two-org tests against `orbit_app`, not by users.

3. **Pretend to be PostgREST.** Supabase SQL helpers such as `auth.uid()` read `request.jwt.claims`. Prisma does not send a user JWT. You can `set_config('request.jwt.claims', ..., true)` in the same transaction. That couples the app to PostgREST's GUC names for no benefit over `app.organization_id`. Skip it.

Do not open the Supabase Data API (PostgREST) to the browser for these tables. The browser already talks to the Express API. A second API with the `anon` key would bypass every check in `server/`.

## 7. Extensions

No migration creates an extension. `gen_random_uuid()` is used as a column default in the dump era and in Prisma `@default(uuid())`; on PostgreSQL 16 that function is in core, not in `pgcrypto`. Supabase also installs `pgcrypto` in the `extensions` schema and puts that schema on the search path for its own roles.

If a later migration needs `pg_trgm` or `pgcrypto`, enable it in `extensions` (`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions`) and call functions schema-qualified. Do not install extensions into `public`. Do not depend on a search path that includes `extensions` inside a migration, because `0001` clears the search path and `db-bootstrap` only puts back the default by removing that one statement. Later migrations run with Prisma's search path, which is `public`. An unqualified `gen_random_uuid()` is fine on PG 13+. An unqualified `crypt()` from `pgcrypto` is not, if `extensions` is off the path.

`SET row_security` and extension scripts do not belong in application migrations beyond that.

## 8. Backups

The repo does not back up the VPS database. Supabase Pro has daily backups; point-in-time recovery is a higher tier and should be on before customer data that is not Unwhelm's own lives there. Confirm the plan in the dashboard rather than assuming the free tier is enough.

Before cutover, take a logical dump from the VPS that is **public only**:

```bash
pg_dump --format=custom --schema=public --no-owner --no-privileges "$VPS_DATABASE_URL" -f unwhelm-public.dump
```

Do not dump `auth` or `storage` from Supabase and try to merge them. Restore drills belong on a staging Supabase project: `db:bootstrap` on empty, then data-only restore, then the API health check and one magic link.

`ProposalAttachment.bytes` and signed PDFs in `ContractEsignArtifact` make the dump large and sensitive. Encrypt the dump file and do not commit it. The same rule as the rest of this folder: no `.env`, no dump, no API key in git.

Prisma migrate history is not a backup. `_prisma_migrations` must be restored with the schema or the next deploy will try to reapply `0001`.

A rollback copy of the VPS data directory, or at least this custom dump, should exist before the API's `DATABASE_URL` changes.

## 9. Local development with the Supabase CLI

Use this when you want Auth or Storage running locally. For application work, a local Postgres and `npm run db:bootstrap` is still enough, and it matches CI (`UNWH_DB_TEST=1`).

- `supabase init` creates `supabase/` config. Do not commit a generated `supabase/migrations` history that recreates Prisma tables.
- `supabase start` serves Postgres on the CLI's local port (commonly `54322`), with user `postgres` and a published local password. Point `DATABASE_URL` and `DIRECT_URL` at that URL. They can be the same locally.
- Run `npm run db:bootstrap` against it once. Then `npm run db:seed`.
- Studio on the local API port can browse `public`. It will also show `auth`. Do not edit Prisma tables in Studio and then assume the next migration knows.
- `supabase db reset` wipes the local database and replays Supabase CLI migrations, **not** `prisma/migrations`, unless you wire a seed script that calls `npm run db:bootstrap`. If you use `db reset`, add that command as the seed. Otherwise ignore `db reset` and recreate with bootstrap.
- The local service role and anon key are for the local Data API. The Express app does not need them.

`0001`'s `\restrict` token is a dump artifact. Bootstrap strips it. Do not "fix" the committed `0001` file: production has already recorded its checksum (`db-bootstrap.ts` says this explicitly).

## 10. Cutover

Do this on a staging Supabase project first, including a full `pg_dump` restore and a sign-in.

1. **Staging project.** Note the exact Postgres version. Run `npm run db:bootstrap` with `DIRECT_URL` set to the direct or session-pooler URL. Fix bootstrap against that version before touching production data. Create the `session` table.
2. **Restore data.** Data-only load of `public` from the VPS dump into staging. Sequences and identity defaults in this schema are mostly UUIDs (`@default(uuid())`), so sequence reset is less of an issue than with serial keys. Check `User` count, `Proposal` count, and one known contract.
3. **App against staging.** `DATABASE_URL` is the session pooler. `DIRECT_URL` is direct or session. Start the API the way production does (`npm run build:api`, `node dist-api/server/index.js`) with `UNWH_SESSION_SECRET` set. Confirm `GET /api/v1/health` (no bearer) reports the database connected, magic-link request writes a `MagicLink` row, and an existing session cookie is **not** expected to survive: the `session` table is new, so every user signs in again. Warn before cutover.
4. **MCP.** Point `UNWH_API_ORIGIN` at the staging API. Existing access tokens are rows in `McpToken`. If those rows were restored, old tokens still hash-match and keep working. If you start from an empty token table, every MCP client reconnects through OAuth. Pick one and say so. Restoring tokens copies live credentials into Supabase; restrict the project and rotate the database password after restore.
5. **Webhooks.** SignWell and any mail bounce URLs must reach the new API host. `UNWH_API_PUBLIC_URL` is part of OAuth discovery (`server/index.ts`). A host change invalidates the issuer URL clients cached. Plan the DNS cut with that in mind. `MCP_RESOURCE` in `systemAuth.ts` is hardcoded to `https://mcp.unwhelm.net/mcp`. Leave it until Orbit has its own host (`MULTI_USER_PLAN.md` question 14).
6. **Production window.** Stop writers: `pm2 stop unwh-api unwh-mcp` (the site can stay up if it only reads the API and you accept errors). Dump `public` again. Restore into the production Supabase project that was already bootstrapped on staging's twin (empty, migrated, no extra data). Point the API environment at the new URLs. `pm2 restart unwh-api unwh-mcp --update-env` only after `prisma generate` and `build:all` have finished (`DEPLOY.md`).
7. **Checks.** Ports and health URLs from `DEPLOY.md`: catalog returns 200, a magic link can be requested, a proposal loads for a known user, an MCP `tools/list` with a restored or freshly issued token succeeds. `pm2 logs unwh-api --err` for `Can't reach database server` and for missing `session`.
8. **Rollback.** Keep the VPS Postgres running and read-only, not dropped. Rollback is switching `DATABASE_URL` back and restarting `unwh-api`. Any writes that landed only in Supabase during the window have to be reconciled by hand; keep the window short and the VPS app stopped. Do not run migrate on the VPS during the rollback.
9. **After a quiet period.** Take a Supabase backup, confirm it restores onto a scratch project, then decommission the VPS Postgres. Not before.

Run `db:bootstrap` only on the empty project. Running it against the VPS is a no-op when `0001` is recorded, but running a data restore on top of a half-bootstrapped project will collide. If bootstrap refuses because `public` is non-empty, stop and look. Do not delete `auth` to make it happy.

## 11. Risks

- **`0001` is a dump.** A future editor who "formats" that file changes the checksum production already applied. Bootstrap will not re-run it on production, but a new environment would record a different history. Leave the file untouched. Sanitize only in memory, as `db-bootstrap.ts` does.
- **IPv6 direct host.** Migrate from the VPS to `db.*.supabase.co` may time out. Use the session pooler and test from the VPS, not from a laptop that has IPv6.
- **Transaction pooler on 6543.** Migrate fails (advisory locks, prepared statements) or, worse, appears to work and then times out mid-migration. Runtime `SET` for RLS leaks across tenants. Avoid 6543.
- **Privileged role and RLS.** Enabling RLS on `postgres` feels like a control and is not one. Either stay with application checks or switch the runtime role to `orbit_app`.
- **`db pull` imports `auth`.** A careless pull becomes a migration that fights Supabase. Ban `db pull` on the hosted project.
- **Two migration histories.** Supabase CLI and Prisma both tracking `public` will double-apply or drop tables. Prisma alone owns `public`.
- **`session` table missing.** Login fails after a successful migrate because Prisma never created it. Test a magic link, not only `/health`.
- **Pool exhaustion.** Default pools in the API plus `connect-pg-simple` plus a one-off script can hit Supabase's cap. Set `max`.
- **Search path and extensions.** Unqualified extension functions fail inside migrations. Core `gen_random_uuid()` is fine.
- **Bytes and backups.** Attachments in `bytea` make dumps slow and put signed contracts in the database backup. Treat the dump as secret.
- **Token restore.** Restoring `McpToken` and `MagicLink` copies live secrets. Prefer restoring users and proposals, revoking tokens, and forcing reconnect, if the cutover can stand that. Magic links are short-lived (15 minutes in `systemAuth.ts`); expired rows are harmless, unexpired ones are credentials.
- **OAuth issuer and resource.** Changing `UNWH_API_PUBLIC_URL` changes the issuer in `/.well-known/oauth-authorization-server`. Clients that pinned the old issuer need a reconnect. The MCP resource string is hardcoded to `mcp.unwhelm.net`.
- **In-memory OAuth codes.** `pendingAuthorizations` in `systemAuth.ts` is a process `Map`. A Supabase move does not fix that. A restart during someone's consent still drops the code. The multi-user plan moves those rows to Postgres; do that independently of the host change.
- **Postgres version drift.** A dump from 16 restored onto 15 can fail on a type or a default the older server lacks. Match versions on staging first.
- **Connection-error retry.** The wrapper in `server/db.ts` will hide a short pooler blip. It will also retry a few times when the password is wrong. Watch the `db_retry` log line rather than assuming the first error is the only one.
- **Service role in the browser or in MCP.** There is no reason to put `service_role` in `unwh-mcp` or in Vite. The MCP server never opens Postgres. Adding the key "so the client can query Supabase directly" would skip the API's auth. Do not.

## 12. Suggested order relative to multi-tenant work

1. Move Unwhelm's existing single organization onto Supabase Postgres using this cutover, with the current privileged role and **no RLS**, after a staging restore. Behavior stays single-tenant.
2. Land the tenant context and the two-org tests from `MULTI_USER_PLAN.md` phase 1 against that database.
3. Only then consider `orbit_app` and RLS (phase 5 of that plan), or Supabase Auth (section 5.2 here).

Doing RLS, Auth, and the host change in one weekend makes a failure impossible to attribute. The database move should be boring.
