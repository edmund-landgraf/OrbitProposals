# Orbit Proposals

This repository has two related products:

| Part | Location | What it is |
|------|----------|------------|
| **Marketing site** | Repository root (`*.html`, `styles.css`, `script.js`) | Standalone HTML product site for Orbit Proposals (positioning, pricing, tools catalog, and related pages). |
| **Proposal manager** | [`app/`](app/) | Full-stack application: React UI, Express API, Prisma/Postgres, and the Unwhelm MCP server. |
| **Planning & architecture** | [`docs/`](docs/) | Multi-user roadmap, Supabase migration notes, build/schema plans, and app deployment notes. |
| **Marketing deploy** | [`deploy/`](deploy/) | VPS install script and Nginx config for the **static** site at `orbit-proposals.unwhelm.net`. |

The application code was imported from [`UnwhelmNet20`](https://github.com/edmund-landgraf/UnwhelmNet20) branch `cursor/orbit-proposals-extract-afee` (folder `orbit-proposals/`). The marketing HTML at the repo root is separate from the Vite/React bundle inside `app/`.

## Marketing site

Open any root-level `.html` file in a browser, or use a static file server. Production deployment is documented in [`deploy/README.md`](deploy/README.md).

## Proposal manager

All npm commands run from **`app/`**:

```bash
cd app
cp .env.example .env
# Set DATABASE_URL and UNWH_SESSION_SECRET.

npm install
npm run db:bootstrap   # empty Postgres only
npm run db:seed
npm run dev:api        # API on http://127.0.0.1:3201
npm run dev            # Web on http://localhost:5192 (proxies /api)
```

Details, MCP setup, and production build: [`app/README.md`](app/README.md). App VPS layout: [`docs/app-DEPLOY.md`](docs/app-DEPLOY.md).

### Planning docs

- [`docs/MULTI_USER_PLAN.md`](docs/MULTI_USER_PLAN.md) — multi-tenant architecture (planned, not implemented).
- [`docs/SUPABASE_PRISMA_MIGRATION.md`](docs/SUPABASE_PRISMA_MIGRATION.md) — Postgres → Supabase migration path.
- [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md), [`docs/SCHEMA-PLAN.md`](docs/SCHEMA-PLAN.md), [`docs/REFACTOR.md`](docs/REFACTOR.md) — engineering plans from the Unwhelm extraction.

## CI

GitHub Actions workflow [`.github/workflows/app-ci.yml`](.github/workflows/app-ci.yml) runs build and tests from the `app/` directory (Postgres service, API tests, Playwright smoke).

## Follow-up (marketing)

See [`TASKS.md`](TASKS.md) for open items on the standalone product site.