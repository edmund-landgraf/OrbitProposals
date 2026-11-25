# Proposal manager capability gaps

This folder turns the proposal-tool gap analysis into implementation-ready markdown specifications.

The current system is strong at proposal composition, review, approvals, attachments, lifecycle state, export, billing, and chat. The missing layer is proposal-manager orchestration: deciding whether to bid, coordinating contributors, reusing governed content, proving requirement coverage, modeling price, and learning from outcomes.

## Documents

- [Gap analysis](gap-analysis.md) — scope, market cross-reference, priorities, and shared design rules.
- [Task assignment](task-assignment.md) — section ownership, milestones, workload, and reminders.
- [Content library](content-library.md) — governed reusable content with versions and approval state.
- [Compliance matrix](compliance-matrix.md) — RFP requirement extraction, mapping, and evidence.
- [Go/no-go assessment](go-no-go.md) — bid decision criteria, risks, and decision audit trail.
- [Pricing model](pricing-model.md) — proposal-level cost build-up, price, discount, margin, and approvals.
- [Analytics](analytics.md) — pipeline, outcomes, win/loss, and cycle-time reporting.
- [Template governance](template-governance.md) — template CRUD, publication, versioning, and policy configuration.

## Recommended delivery order

1. Task assignment and content library.
2. Compliance matrix and go/no-go assessment.
3. Pricing model and approval rules.
4. Template governance.
5. Analytics and historical outcome capture.

Each capability should expose a REST route, an MCP tool with the `unw_` prefix, database-backed audit events, scope checks, and idempotent writes where retries are likely.
