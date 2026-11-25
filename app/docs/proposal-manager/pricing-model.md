# Proposal pricing model

## Goal

Represent how a proposal price is built from effort, rates, costs, options, discounts, and margin while preserving staff control over commercial authority.

## Proposed tools

- `unw_build_pricing_model` — create or recalculate a proposal pricing model.
- `unw_update_pricing_line` — add or edit a role, unit, quantity, rate, cost, or assumption.
- `unw_add_pricing_option` — create an optional package or tier.
- `unw_calculate_pricing_model` — return totals, discount, margin, and validation warnings.
- `unw_submit_pricing_for_approval` — submit a price that needs policy approval.
- `unw_approve_pricing_model` — approve, reject, or approve with conditions.
- `unw_get_pricing_model` — load the current model and immutable revisions.

## Model shape

The model contains currency, tax treatment, validity dates, assumptions, line items, options, discounts, pass-through costs, contingency, target margin, approval status, and a published customer-facing summary.

Each line records quantity, unit, cost rate, sell rate, source rate-card version, and whether the value is editable by an agent. Totals must be calculated server-side using decimal arithmetic.

## Rules

- Agents may propose quantities and structure but may not bypass rate-card, discount, margin-floor, or approval policies.
- A price revision is immutable after submission; edits create a new revision.
- Internal cost and margin are never exposed in a client-facing export unless explicitly authorized.
- A proposal cannot be marked commercially ready while required pricing approvals are unresolved.
- Currency conversion, tax, and rounding rules must be explicit and versioned.
