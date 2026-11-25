# UnwhelmNet20 for hiring managers

**Edmund Landgraf** builds client-facing software and the integrations behind it. This repo is a working example: a proposal manager that an AI agent drives through MCP, with guardrails, an audit trail, and a live demo.

**See it run:** [unwhelm.net/try](https://unwhelm.net/try). Pick a plan and watch an agent build and submit a real proposal, with every call traced.

## What it shows

- **Agent design with guardrails.** The agent drafts scope and narrative, but it can't set hours or price, and locked sections refuse edits.
- **Data-driven product.** Templates, section limits, guidance rules, and pricing models live in database rows, so changes don't need a deploy.
- **API discipline.** One typed contract across the REST API and MCP tools, with zod validation and a consistent response envelope.
- **Production habits.** Prisma migrations, DB-backed integration tests in strict CI, and deploys to a self-managed VPS.

## Stack

TypeScript, React, Express 5, zod, Prisma, Postgres, Model Context Protocol, node:test, Playwright, GitHub Actions.

## More

- [Architecture](architecture.md)
- [Try me design](try-me.md)
- [unwhelm.net](https://unwhelm.net) and [LinkedIn](https://www.linkedin.com/in/edmund-landgraf-5a990/)
