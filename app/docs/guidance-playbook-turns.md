# Guidance playbook on live turns (Approach A)

The playbook tells a proposal agent what to try next: explain a drop, park a new idea, ask for priorities, offer a reminder, or hand off to a person. Rule text, weights, and thresholds live in Postgres. TypeScript only computes signals, matches rows, injects a few phrases, and writes a log row. The agent still never sets hours or price.

This is Approach A. Approach B (a staff-curated case library scored from these logs) is not wired here. There is no nightly scorer and no staff admin UI in this pass.

Related tables were created in migration `0033_guidance_playbook`. Live-turn knobs and `session_baseline` are in `0057_guidance_turn`. Code: `server/guidancePlaybook.ts` (pure matching) and `server/guidanceTurn.ts` (I/O). Tests: `tests/api/guidancePlaybook.test.ts`, `tests/api/guidanceTurnDb.test.ts`.

Nightly learning loop: [guidance-playbook-scoring.md](guidance-playbook-scoring.md).

## What a turn is

A **turn** is one agent read of proposal progress, or one user chat message on a bound proposal session.

| Entry | When | Session id | Side effect |
| --- | --- | --- | --- |
| `GET /proposals/:id/progress` (MCP `unw_get_proposal_progress`) | Bearer with scopes, or header `x-unw-guidance-session` | `x-unw-guidance-session` if present (1–200 chars, no CR/LF), else `agent:{userId}:{proposalId}` | Writes a `guidance_session_event` (unless `?markSeen=true` and one already exists). Adds a `guidance` object on the progress payload. |
| Chat `replyToUser` | Chat session `agent === "proposal"`, `status === "open"`, `proposalId` set | The chat session UUID | Writes an event with `userJustSpoke: true`. Injects a system message from `guidanceContext` before the model runs. |
| Portal progress with no scopes and no header | Client portal cookie | — | No event. Progress JSON is unchanged. |

`safeGuidanceTurn` wraps the write. Any throw is logged as `guidance turn failed` and the original tool still succeeds.

`?markSeen=true` on progress uses `record: "if-absent"`: if this session already has an event, return that event's moves and do not insert another. That keeps a “mark seen” poll from flooding the log.

## Pipeline (one turn)

1. Ensure the proposal has a completion tree (`proposalCompletion.ensure`).
2. Load nodes, completion policy, all `guidance_rule` rows, `guidance_setting`, enabled `guidance_signal_def` keys, and prior `guidance_session_event` rows for `(proposalId, sessionId)` ordered by `turnIndex`.
3. Resolve **session baseline** (first snapshot of this session).
4. Compute **signals**. Drop any key whose `guidance_signal_def.enabled` is false.
5. Choose **eligible triggers**, then a **primary trigger** stored on the event.
6. Rank matching rules. Cap suggested moves at `guidance_setting.max_suggested_moves` (clamped 1–20, default 3).
7. Fill `{placeholders}` in `client_phrase` from live proposal labels.
8. Insert `guidance_session_event`. On the first event of the session, store `session_baseline`.
9. Return `{ eventId, sessionId, turnIndex, trigger, signals, suggestedMoves, recorded }` for injection.

`fired_rule_ids` stores up to 20 matching rule UUIDs (the ranked list, not only the injected slice). The payload's `suggestedMoves` is the first `max_suggested_moves` of that list.

`turn_index` is `max(turn_index) + 1` for that `session_id` (unique on `(session_id, turn_index)`). A `P2002` insert is retried once.

## Session baseline

Stored JSON on the first event:

```json
{
  "completion": 75,
  "nodeCount": 12,
  "states": { "scope.summary": "agreed", "timeline.start": "open" },
  "startedAt": "2026-11-05T11:00:00.000Z"
}
```

- `completion`: completion percent at session start (same function as progress: settled nodes vs policy).
- `nodeCount` / `states`: node keys and `stateCode` at that moment. Reopens are “now `needs_review` (or the policy's reopen target) and was not that at baseline.”
- `startedAt`: ISO time. Parked-item counts and idle gaps are measured from here when needed.

If older events exist without `session_baseline`, the first event's `completionBefore` and current node map are used. On a true first turn, baseline `startedAt` is `now - 2s` so an immediate pause rule does not fire from a zero-width clock.

## Signals

Only keys in `guidance_signal_def` with `enabled = true` are stored and used for matching. Seeded keys and how this code fills them:

| Key | Type | Formula on a turn |
| --- | --- | --- |
| `completion_delta` | percent | `round2(currentPercent - baseline.completion)`. Negative means the tree looks less settled than at session start. |
| `nodes_reopened` | integer | Count of nodes whose current state is the policy reopen target (`isReopenTarget`, typically `needs_review`) and whose baseline state was not that code. |
| `turns_without_progress` | integer | Walk prior events from newest to oldest while `completionAfter <= completionBefore` (nulls treated as 0 / before). Add 1 if this turn also does not increase percent. |
| `unsure_count` | integer | Nodes whose `stateCode` is in `proposal_part_resolution` rows with `flagsForCall = true` (the “talk to a human” resolutions, not a hardcoded `unsure` string). |
| `unbounded_flags` | integer | Open `proposal_review_flag` rows with kind `unbounded` and a status whose `proposal_review_comment_status.open` is true (fallback status list `["open"]` if none). |
| `scope_growth_pct` | percent | If baseline node count is 0: `100` when there are nodes now, else `0`. Otherwise `round2((nodeCount - baselineNodeCount) / baselineNodeCount * 100)`. Seeded “growth” rules use `> 20`. |
| `idle_minutes` | minutes | If `userJustSpoke`: `0`. Else whole minutes since the last user chat message (chat UUID sessions) or since the previous event. |
| `parked_count` | integer | `proposal_parked_change` + `proposal_intake_park` created at or after `baseline.startedAt`. |

`round2` is `Math.round(value * 100) / 100`. Missing signal keys fail the clause (the comparator is not run).

## Triggers

Allowed values (SQL check and TS set): `turn`, `node_changed`, `pause`, `resume`, `submit_attempt`.

**Eligible set** (`eligibleTriggers`):

- If the caller passes `explicitTrigger` other than `turn`: that trigger alone, except `node_changed` which also includes `turn`.
- Otherwise start with `turn`.
- Add `node_changed` when `nodes_reopened > 0`.
- Add `pause` or `resume` when idle gap is at least the lowest `>=` / `>` `idle_minutes` threshold on any enabled rule with `trigger = pause`. `resume` if `userJustSpoke`, else `pause`.

**Primary trigger** stored on the event: explicit non-`turn` trigger, else `resume`, else `pause`, else `turn`. Submit is only explicit (review submit and contract sign).

A rule matches only if `rule.enabled`, `rule.trigger` is in the eligible set, and `condition` matches.

## Conditions and ranking

`guidance_rule.condition` must be `{ "all": [ { "signal", "op", "value" }, ... ] }`. Empty `all` matches (used by `resume_summary`). Any other JSON shape fails.

Ops: `>`, `>=`, `<`, `<=`, `==`, `=`, `!=`. `value` must be a finite number. Every clause is AND.

**Weight:** `learned_weight` if not null (including `0`), else `base_weight`.

**Sort:** higher weight first, then lower `priority` number, then `key` lexicographically.

Suggested-move count is `guidance_setting.max_suggested_moves` (seeded `3`). Fallback if the table is empty: 3.

## Client phrases

`client_phrase` templates use `{name}`. Unknown or empty names stay as `{name}`.

| Token | Source |
| --- | --- |
| `item` | Latest intake park summary, else latest parked-change summary, else first reopened node's `clientLabel`, else `"this"` |
| `parts` | English list of reopened `clientLabel`s, else `"some parts"` |
| `before` / `after` | Baseline completion and current percent |
| `other` | A settled node's label that is not the first reopened one, else `"something already in the proposal"` |
| `part` / `next` | First unsettled node by `sortOrder`, else `"that part"` / `"the next open part"` |
| `settled` / `total` | Count of nodes in settled state groups / node count |

Settled means the node's `stateCode` belongs to a `proposal_progress_state_group` whose group has `settled = true`.

Injected progress field `guidance` is the turn view (`suggestedMoves` plus ids and signals). Chat injects `guidanceContext`: a short instruction (“steer collection, parking, a reminder, or a handoff… Say the client phrase in your own words. Do not set hours or price.”) plus numbered `move: phrase` lines. `staff_note` is appended as “Staff note, do not read this aloud”. Empty move list → no system line.

## Seeded rules (0033)

| key | trigger | when | move | weight / priority |
| --- | --- | --- | --- | --- |
| `scope_growth_drop_explain` | turn | `scope_growth_pct > 20` and `completion_delta < 0` | `explain_drop` | 1.0 / 10 |
| `scope_growth_drop_park` | turn | same | `offer_park` | 0.9 / 20 |
| `reopened_offer_swap` | node_changed | `nodes_reopened >= 2` | `offer_swap` | 0.7 / 30 |
| `stuck_handoff` | turn | `turns_without_progress >= 6` | `recommend_handoff` | 1.2 / 5 |
| `unsure_handoff` | turn | `unsure_count >= 2` | `recommend_handoff` | 1.1 / 6 |
| `idle_tickler` | pause | `idle_minutes >= 15` | `offer_tickler` | 1.0 / 40 |
| `unbounded_priority` | turn | `unbounded_flags >= 1` | `ask_priority` | 1.0 / 15 |
| `resume_summary` | resume | empty `all` | `summarize_progress` | 0.8 / 50 |

Moves and outcome codes are also rows (`guidance_move`, `guidance_outcome_code`). Do not copy these strings into TypeScript except tests.

## Stamping an action after the turn

`noteGuidanceAction` runs after a follow-up tool. Failures log `guidance action not recorded` and do not fail the tool.

`guidance_setting.action_attach_seconds` (seeded 120, fallback 120): if the latest event for this `(proposalId, sessionId)` has no `action_taken` and is younger than that window, update it (`action_taken`, optional `chosen_move`). Else insert a new turn with that action (and optional `explicitTrigger`).

`action_taken` is stored as the `guidance_outcome_code.code` when that code exists; otherwise the raw string (so `mark_unsure` and `offer_tickler` can be logged even though they are move keys, not outcome codes). `chosen_move` is stored only if it exists on `guidance_move`.

| Caller | `action_taken` | `chosen_move` | explicit trigger |
| --- | --- | --- | --- |
| Resolve node, not unsure | `resolved` | — | — |
| Resolve node, unsure | `mark_unsure` | `mark_unsure` | — |
| Recommend handoff (API) | `handoff` | `recommend_handoff` | — |
| Chat escalate | `handoff` | `recommend_handoff` | — |
| Park item / park change | `parked` | `offer_park` or `offer_swap` if `mode === "swap"` | — |
| Submit for review | `submitted` | — | `submit_attempt` |
| Sign / accept contract | `submitted` then `accepted` | — | `submit_attempt` on submit |
| Set tickler / reminder preference | `offer_tickler` | `offer_tickler` | `pause` |

Outcome rows on `guidance_outcome` are not written by this loop. Nightly scoring tables (`guidance_rule_score`, `guidance_feedback`) are unused here.

## Read path

- `GET /proposals/:id/guidance-events?limit=` — API id `proposal_guidance_events`, bearer, `proposals:read`. Default limit from the route (tests use 50 max on MCP).
- MCP `unw_list_guidance_events` `{ proposalId, limit? }` — read-only, same route.

Each item: `id`, `sessionId`, `turnIndex`, `trigger`, `signals`, `firedRules` (hydrated from current `guidance_rule` rows by id), `suggestedMoves` (first N of `firedRules`), `chosenMove`, `actionTaken`, `completionBefore`, `completionAfter`, `createdAt`. Deleted/disabled rules that still appear in `fired_rule_ids` are omitted from the hydrated list.

Try me: `try_me_task_call` seq 3 on task `7d0f0002-0000-4000-8000-000000000005` calls this tool; exercise `progress` lists it.

## What is not in this pass

- Hardcoded rule text or weights in production TS (only fallbacks for missing settings, and tests).
- Staff UI to edit rules, nightly weight updates, `guidance_outcome` / `guidance_feedback` writers.
- Portal progress writing events (avoids a page load looking like an agent turn).
- Changing hours or price from suggested moves.

## Verify one turn

1. With a scoped bearer (or MCP), call `unw_get_proposal_progress` / `GET /api/v1/proposals/:id/progress`.
2. Call `unw_list_guidance_events` with that `proposalId` (or `GET /api/v1/proposals/:id/guidance-events`).
3. Expect an item with `signals`, `firedRules`, and `suggestedMoves`. A second progress call should add another event unless `markSeen=true`.

Local: `UNWH_DB_TEST=1 DATABASE_URL=… npx tsx --test tests/api/guidancePlaybook.test.ts tests/api/guidanceTurnDb.test.ts`.
