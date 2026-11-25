# Go/no-go assessment

## Goal

Make bid decisions explicit, repeatable, and auditable before proposal effort is committed.

## Proposed tools

- `unw_create_go_no_go_assessment` — create an assessment from configurable criteria.
- `unw_update_go_no_go_factor` — record score, evidence, owner, and risk treatment.
- `unw_submit_go_no_go_assessment` — submit for decision review.
- `unw_record_go_no_go_decision` — record `go`, `no_go`, or `go_with_conditions`.
- `unw_get_go_no_go_assessment` — return factors, score, unresolved risks, and decision history.

## Default factors

Strategic fit, client relationship, win probability, competitive position, capability fit, delivery capacity, timeline feasibility, compliance burden, commercial attractiveness, margin potential, legal/security risk, and referenceability.

Each factor has a configurable weight, a 0–5 score, evidence, owner, confidence, and mitigation. The calculated score is advisory; policy can require approval for low scores or high-risk factors.

## Rules

- A proposal may be drafted before a decision, but submission should warn when the required decision is missing.
- `no_go` does not delete proposal work; it closes or pauses the pursuit with a reason.
- `go_with_conditions` must list conditions, owners, and due dates.
- Decision changes are append-only events and require an actor and rationale.
- Criteria and thresholds are versioned so historical decisions remain explainable.
