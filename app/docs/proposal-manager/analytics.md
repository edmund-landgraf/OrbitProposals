# Proposal pipeline and outcome analytics

## Goal

Measure proposal throughput and learn which pursuits, content, pricing patterns, and processes lead to wins.

## Proposed tools

- `unw_record_proposal_outcome` — record won, lost, cancelled, or no_decision with reason and value.
- `unw_get_proposal_pipeline` — summarize proposals by lifecycle stage, owner, client, value, and expected close date.
- `unw_get_win_loss_analytics` — return rates, reasons, revenue, and trends over a date range.
- `unw_get_proposal_cycle_metrics` — report time from creation to submission, review, decision, and outcome.
- `unw_get_content_performance` — correlate approved library items with reuse and outcomes, subject to privacy rules.

## Required dimensions

Proposal, project/client account, segment, template version, source, bid decision, proposal owner, contributors, pricing revision, outcome, reason, value, currency, created date, submitted date, decision date, and outcome date.

## Rules

- Outcome capture must support unknown and no-decision; do not force a false loss reason.
- Reports must distinguish count-based win rate from value-weighted win rate.
- Historical metrics use the state and template versions that existed at the time, not only current labels.
- Internal margin and contributor performance require restricted scopes and aggregation thresholds.
- Analytics are read-only and must not mutate proposal state.
