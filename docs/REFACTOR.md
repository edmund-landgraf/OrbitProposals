# Business values this billing diff hardcodes

Scope: values introduced or read by the billing-schedule, upfront-invoice, and per-milestone work on this branch (the schedule generator, contract sign, milestone accept, and the invoice MCP tools). Other site copy, chat limits, and article prices are out of scope.

Each row should become an editable database value. A signed contract keeps the template version that produced its `BillingEntry` rows. Later edits must not rewrite those rows.

## Remainder and due dates, as the code does them

Fixed price is a 50/50 split. The deposit label is `Deposit`, trigger `contract_signed`. The remainder label is `Milestone acceptance`, trigger `milestone_accepted`, `milestoneId` null. Sign creates one draft invoice for uninvoiced `contract_signed` entries whose total is positive, due UTC today. Hourly’s zero manual entry is skipped.

Accepting a milestone invoices uninvoiced `milestone_accepted` entries that name that milestone, plus an unscoped remainder only when this milestone owns it. One milestone on the contract owns it. Several milestones leave it to the final milestone: the latest due date, skipping undated milestones when any milestone is dated, otherwise the greatest id. Acceptance also adds that milestone’s positive retainage. The draft is due the milestone’s `dueDate`, or UTC today when it has none. New invoices start as `draft`.

## Tables

Migration `0013_config_catalog` creates these tables and leaves them empty. The app still reads the TypeScript constants. `Proposal.catalog_version_id` and `Contract.catalog_version_id` are nullable. `Contract.billing_schedule_template_id` is nullable. Nothing writes them yet.

| Table | Holds |
| --- | --- |
| `catalog_version` | `effective_from`, `effective_to`. Proposals and contracts may reference the version they used. |
| `pricing_model` | `code` (`PricingModel`), `sort_order`, per version. |
| `price_tier` | `code`, `amount_minor` (price or hourly rate, cents), `hours`, `min_amount_minor` (floor), `currency`. |
| `billing_schedule_template` | `percent_basis` (10000 = 100%), `leftover_cent_target`. One template per model per version. |
| `billing_schedule_template_line` | `sort_order`, `label`, `trigger`, `percent_basis`, `amount_minor`, `amount_rule` (`percent_of_total` or `zero`), `due_offset_days` (null means no due date). |
| `invoice_policy` | One row per version: `signing_due_offset_days`, `milestone_due_offset_days`, `prefer_milestone_due_date`, `initial_status`, `unscoped_remainder_rule`, `retainage_policy`, `invoice_on_sign`. |
| `invoice_status_transition` | `from_status`, `to_status`, `staff_only`. |
| `oauth_scope` | `scope`, `mcp` (advertised to MCP). |
| `session_scope_grant` | `role`, `scope`. |

## Hardcodes

| File:line | Value | Controls | Proposed column | Edited by |
| --- | --- | --- | --- | --- |
| `packages/shapes/src/pricing.ts:6` | `workflowCheck` `250` | Workflow Check dollars the schedule bills | `price_tier.amount_minor` (code `workflow_check`) | Admin UI, MCP `unw_update_price_tier` |
| `packages/shapes/src/pricing.ts:19` | `WORKFLOW_CHECK_AMOUNT_MINOR` `25000` | Same amount in cents | `price_tier.amount_minor` | derived |
| `packages/shapes/src/pricing.ts:10` | `capped4.price` `550` | 4-hour cap the schedule bills | `price_tier.amount_minor` and `price_tier.hours` (code `capped_hours_4`) | Admin UI, MCP |
| `packages/shapes/src/pricing.ts:21` | `CAPPED_HOURS_4_AMOUNT_MINOR` `55000` | Same amount in cents | `price_tier.amount_minor` | derived |
| `packages/shapes/src/pricing.ts:12` | `capped8.price` `900` | 8-hour cap the schedule bills | `price_tier.amount_minor` and `price_tier.hours` (code `capped_hours_8`) | Admin UI, MCP |
| `packages/shapes/src/pricing.ts:22` | `CAPPED_HOURS_8_AMOUNT_MINOR` `90000` | Same amount in cents | `price_tier.amount_minor` | derived |
| `packages/shapes/src/pricing.ts:5` | `hourlyRate` `175` | Rate interpolated into the hourly entry label | `price_tier.amount_minor` (code `hourly`) | Admin UI, MCP |
| `packages/shapes/src/pricing.ts:4` | `currency` `USD` | Currency written on every generated entry and invoice | `price_tier.currency` | Admin UI |
| `packages/shapes/src/billingSchedule.ts:26-30` | `BILLING_SCHEDULE_DEFAULTS` | Prose for 100% upfront, 50/50, hourly manual zero, final-milestone remainder | generated from `billing_schedule_template_line` and `invoice_policy` | Admin UI |
| `packages/shapes/src/billingSchedule.ts:33-34` | `PERCENT_BASIS` `10000`, `FULL_PERCENT` | Percents are four-decimal and must sum to 100 | `billing_schedule_template.percent_basis` | Admin UI |
| `packages/shapes/src/billingSchedule.ts:102-112` | leftover cent to the later entry | Rounding of the 50/50 split | `billing_schedule_template.leftover_cent_target` | Admin UI |
| `packages/shapes/src/billingSchedule.ts:148` | label `Workflow Check`, 100%, `contract_signed` | Workflow Check entry | `billing_schedule_template_line.label`, `percent_basis`, `trigger` | Admin UI, MCP `unw_update_billing_template` |
| `packages/shapes/src/billingSchedule.ts:150` | label `Capped Hours, {hours} hours`, 100%, `contract_signed` | Capped-hours entry | `billing_schedule_template_line.label`, `percent_basis`, `trigger`; hours from `price_tier.hours` | Admin UI, MCP |
| `packages/shapes/src/billingSchedule.ts:152` | `FULL_PERCENT / 2` twice | Fixed-price 50% deposit and 50% remainder | `billing_schedule_template_line.percent_basis` | Admin UI, MCP |
| `packages/shapes/src/billingSchedule.ts:157` | label `Deposit`, trigger `contract_signed` | Fixed-price deposit | `billing_schedule_template_line.label`, `trigger` | Admin UI, MCP |
| `packages/shapes/src/billingSchedule.ts:158` | label `Milestone acceptance`, trigger `milestone_accepted` | Fixed-price remainder | `billing_schedule_template_line.label`, `trigger` | Admin UI, MCP |
| `packages/shapes/src/billingSchedule.ts:165` | label `Hourly, invoiced per invoice at $175/hr`, amount `0`, trigger `manual` | Hourly schedule is not a prepaid balance | `billing_schedule_template_line.amount_rule` `zero`, `amount_minor`, `label`, `trigger` | Admin UI, MCP |
| `packages/shapes/src/billingSchedule.ts:128` | `dueOn: null` | Schedule rows have no due date, so invoices fall back to today | `billing_schedule_template_line.due_offset_days` null | Admin UI |
| `packages/shapes/src/billingSchedule.ts:204-216` | sole milestone, else latest due date, else greatest id | Who invoices an unscoped remainder | `invoice_policy.unscoped_remainder_rule` | Admin UI |
| `packages/shapes/src/billingSchedule.ts:236-259` | selected entries plus positive retainage, one currency | Accept invoice amount | `invoice_policy.retainage_policy` | Admin UI |
| `server/routes/proposalContract.ts:429-439` | sign invoices uninvoiced `contract_signed` rows with a positive total | Upfront draft invoice | `invoice_policy.invoice_on_sign` | Admin UI |
| `server/routes/proposalContract.ts:439` | `dueDate: utcToday()`, `status: "draft"` | Upfront invoice due date and starting status | `invoice_policy.signing_due_offset_days`, `invoice_policy.initial_status` | Admin UI |
| `server/routes/billingProjects.ts:494-495` | `dueDate: milestone.dueDate ?? utcToday()`, `status: "draft"` | Milestone invoice due date and starting status | `invoice_policy.prefer_milestone_due_date`, `milestone_due_offset_days`, `initial_status` | Admin UI |
| `server/routes/billingProjects.ts:326` | `draft→sent`, `sent→paid`, void unless `paid` or `void` | Invoice transitions the MCP send/pay/void tools call | `invoice_status_transition.from_status`, `to_status` | Admin UI |
| `server/routes/billingProjects.ts:331-333` | send and void are staff-only; pay is not | Who may move an invoice | `invoice_status_transition.staff_only` | Admin UI |
| `server/routes/proposalContract.ts:635` | bearer sign requires `contracts:write` | Who may sign and generate the schedule | `oauth_scope.scope` | Admin UI |
| `server/routes/systemAuth.ts:17` | `MCP_SCOPES` includes `contracts:write`, `billing:read`, `billing:write` | Scopes granted and advertised | `oauth_scope.scope`, `oauth_scope.mcp` | Admin UI |
| `unwh-mcp/src/scopes.ts:7-15` | the same scope list | MCP advertisement; must match the API list | `oauth_scope.mcp` | Admin UI |
| `server/routes/billingProjects.ts:98-101` | staff gets `billing:write` (and billing/projects/change-order scopes); client gets `billing:read` without `billing:write` | Session powers for invoice writes | `session_scope_grant.role`, `session_scope_grant.scope` | Admin UI |
| `unwh-mcp/src/createServer.ts:17-18` | `pricingRules` and `billingDefaults` | Tool text that repeats the catalog and the splits | generated from `price_tier` and template lines | none |

Count: **30**.

Tests in `tests/api/billingSchedule.test.ts`, `milestoneInvoice.test.ts`, `contractSignGuards.test.ts`, and `mcpBillingTools.test.ts` pin these cents, labels, the 50/50 split, and the final-milestone rule. After the seed exists they should read the fixture, not a second copy of the numbers.

## Checklist

- [x] `0013_config_catalog` creates the tables. `0014_seed_config_catalog` inserts version `v1` (`00000000-0000-4000-8000-000000000001`) with the 30 values. `percent_basis` uses the schedule scale: `1000000` is 100%, `500000` is 50%.
- [x] `server/catalog.ts` loads the active version, caches it until `updated_at` changes, and `invalidateCatalogCache()` drops the cache. Pricing validation, sign, the upfront invoice, the remainder rule, due-day offsets, invoice transitions, and API scopes read that catalog.
- [x] Proposal create and pricing updates stamp `catalog_version_id`. Sign stamps `catalog_version_id` and `billing_schedule_template_id`.
- [x] `GET /api/v1/catalog` returns the active version. The site pricing teaser and pricing page render those dollars.
- [x] Staff with `catalog:write` (seeded on version `v1` by `0015_catalog_editing`, and granted to the staff role) create a draft with `POST /api/v1/catalog/drafts`. The draft is a clone. `PATCH` updates `price_tier`, `billing_schedule_template_line`, `invoice_policy`, `pricing_model`, and `billing_schedule_template`. `PUT` replaces `invoice_status_transition` rows. `POST .../validate` checks the draft. `POST .../publish` sets `effective_from`, sets the previous version's `effective_to`, marks the draft published, and calls `invalidateCatalogCache()`. Published versions reject edits. MCP tools `unw_get_catalog`, `unw_create_catalog_draft`, `unw_update_price_tier`, `unw_update_billing_schedule_line`, `unw_update_invoice_policy`, and `unw_publish_catalog` call those routes and require `catalog:write`.
- [x] MCP tool descriptions that used to repeat the seed amounts and splits now point at `GET /api/v1/catalog`.

There is no admin UI in this pass. The API and MCP tools are the editor. A signed contract keeps the catalog version and billing entries written at sign. A later publish changes pricing for new proposals only.

The TypeScript price constants remain the seed fixture and the unit-test double used when a stub Prisma client has no `catalogVersion` delegate. A real client with an empty catalog throws.
