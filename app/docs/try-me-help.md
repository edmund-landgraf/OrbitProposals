# Try me help guide

`/try/help` is a set of hands-on exercises a visitor runs with their own agent, using the sandbox MCP server address and token that [Try me](try-me.md) shows once when a run starts. The page reads that token from the browser session, so it is filled into the setup snippet automatically while the sandbox lives.

## Where the exercises live

Exercises are rows, served by `GET /api/v1/public/demo/guide`:

| Table | One row is | Key columns |
| --- | --- | --- |
| `try_me_exercise` | an exercise | `code`, `sort`, `title`, `goal`, `prompt` (copy-paste text for the visitor's agent), `active` |
| `try_me_exercise_tool` | one MCP tool the exercise uses | `exercise_code`, `tool_name` |

## Coverage rule

Together the exercises must cover at least 80% of the MCP tools a Try me token can see, which are the tools allowed by the `client` scope preset. `tests/api/tryMeGuide.test.ts` computes the percentage, prints it, and fails under 80%, listing the uncovered tools. It also fails if an exercise names a tool that does not exist. A new client-visible tool therefore needs a `try_me_exercise_tool` row (in a new migration) or the percentage drops.

The seeded guide has 12 exercises that cover all 60 demo-visible tools.

## Exercises

1. Look around first: service info, catalog, consult offerings, payment terms.
2. Build a proposal draft: create, list, open, list and write sections, pick options, status.
3. Check how complete it is: completion tree, X of Y progress, mark a part unsure, handoff recommendation.
4. Change your mind safely: preview impact, park a change and an idea, list parked, lock and unlock.
5. Go through review: self-review, submit, comment, flag, feedback, resolve, decision (may be refused), resubmit.
6. Set up reminders: options, contact preference, tickler, list, run, deliver, deliveries, follow-up queue.
7. Talk to the proposal agent: chat sessions and messages.
8. Expiry, copies, and export.
9. Ask for a free consult.
10. Accept and sign: accept, sign, billing terms, billing schedule, retainage, projects.
11. Read your billing: invoices, hours, remaining hours, credits.
12. Stop the plan and take over: stop a Try me run mid-plan, connect your own agent, read the agent traces, and run a tool the plan never reached.