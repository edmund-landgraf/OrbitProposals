# Guidance playbook nightly scoring (Approach A learning loop)

The live turn loop logs `guidance_session_event` rows with signals and which rules fired. Staff can also rate a session or a specific event good/bad via `guidance_feedback`. Nightly scoring turns those logs into per-rule scores and (when evidence is sufficient) updates `guidance_rule.learned_weight`, which the live ranker uses.

This is an **offline learning loop**: it is safe to run repeatedly and does not change rule text or base weights.

## Inputs

- **Fires**: each `guidance_session_event` where `fired_rule_ids` contains the rule id.
- **Outcomes**:
  - `guidance_session_event.action_taken` when it matches a configured `guidance_outcome_code` (unknown codes are ignored).
  - `guidance_outcome` rows, if present (they are additive evidence).
- **Staff feedback**: `guidance_feedback` rows. Ratings must exist in `guidance_feedback_rating` and carry a `polarity` (-1/0/1).

Attribution:
- Event-scoped outcomes/feedback (`eventId`) apply to the rules fired on that event.
- Session-scoped outcomes/feedback (`sessionId` only) apply once to each rule that fired in that session on that day.

Unknown outcomes are **not treated as negative**.

## Output

- One `guidance_rule_score` row per `(rule_id, period)` (period is `YYYY-MM-DD` in **UTC**), upserted idempotently.
- `guidance_rule.learned_weight` is updated only when:
  - the rule fired at least 5 times that day, and
  - there is non-zero evidence (positive + negative > 0), and
  - the computed weight differs from `base_weight` (neutral evidence does not overwrite).

Each score row stores an `evidence` JSON object with the window and the inputs used to compute it.

## How to run (not scheduled by default)

This repo’s cron-safe scripts live in `scripts/` and are invoked via npm scripts (see `package.json`).

- **Dry run (prints JSON, no writes)**:

```bash
npm run guidance:score -- --dry-run
```

- **Score a specific UTC day**:

```bash
npm run guidance:score -- --period=2026-11-06
```

The process needs `DATABASE_URL` set (same as other scripts).

## Migrations

- `0033_guidance_playbook`: playbook tables, `guidance_rule_score`, `guidance_feedback`, `guidance_outcome`.
- `0058_guidance_scoring`: adds `guidance_rule_score.evidence` and an outcome idempotency index.

