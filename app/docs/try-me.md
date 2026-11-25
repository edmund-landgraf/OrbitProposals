# Try me

`/try` lets a visitor watch an agent use Unwhelm's MCP server (`unwh-mcp`) in a throwaway sandbox, then stop at any point and take over with their own agent.

## How a plan is stored

Everything the demo does comes from rows, so plans change without a deploy.

| Table | One row is | Key columns |
| --- | --- | --- |
| `try_me` | a plan, and one entry in the page's dropdown | `code`, `title`, `description`, `sort`, `active` |
| `try_me_task` | a task in a plan; the visitor may stop after any task | `try_me_code`, `seq`, `title`, `narration`, `active` |
| `try_me_task_call` | one MCP tool call in a task, run in `seq` order | `tool_name`, `arguments`, `capture`, `expect`, `note`, `active` |
| `try_me_setting` | a knob | `enabled`, `ttl_minutes`, `max_starts_per_ip_per_hour`, `max_active_sessions`, `step_delay_ms` |

- `arguments` is a JSON template. `{name}` is replaced with a value captured earlier in the same run, and `{zeroId}` is a valid uuid that matches nothing (used to show not-found answers).
- `capture` maps a variable to a path in the tool's result, for example `{"proposalId": "entity.id"}`. Captured values carry across tasks and are kept on `try_me_session.vars`.
- `expect` is `ok` (must succeed), `refused` (must be refused, such as a staff or admin tool called with a client token), or `either` (shown as is, for calls whose answer depends on sandbox state). A call that contradicts its `expect` is shown as needing attention; it never stops the run. A tool the token's scopes hide is refused by `unwh-mcp` before it runs, so it has no trace row.

Plans may repeat calls. Taken together, the active plans must call every MCP tool. `tests/api/demo.test.ts` fails and lists any tool that has no `try_me_task_call` row, so a new tool needs a row (in a new migration) before CI passes.

Each run is a `try_me_session` with one `try_me_session_call` per call, linked to the `agent_trace` row `unwh-mcp` wrote for it.

## How a run works

1. `GET /api/v1/public/demo/plans` lists active plans for the dropdown.
2. `POST /api/v1/public/demo/sessions` with `{"plan": "<code>"}` creates a sandbox org, a client user, an MCP client, and a token with the `client` scope preset, runs the first task, and pauses. The response carries the raw sandbox `token` and the public `mcpUrl` once. Only the token's hash is stored.
3. `GET /api/v1/public/demo/sessions/:id` is what the page polls: tasks, calls, outcomes, and trace previews.
4. `POST /api/v1/public/demo/sessions/:id/continue` with `Authorization: Bearer <token>` runs the next task, or every remaining task with `{"all": true}`.
5. `POST /api/v1/public/demo/sessions/:id/stop` with the same bearer marks the run `taken_over`.

Session states are `running`, `paused`, `complete`, `taken_over`, and `failed`.

## Taking over

Stopping does not end the sandbox. The proposals, chat sessions, and contact preferences the plan made stay, and the token keeps working against the real MCP server until the run expires (`ttl_minutes`, 30 by default). So a visitor can stop halfway and take it a different direction: add scope and preview its impact, park an idea for phase 2, open a chat with the proposal agent, or try a tool the plan never got to.

The page shows, once:

- the MCP server address (`UNWH_DEMO_PUBLIC_MCP_URL`, default `https://mcp.unwhelm.net/mcp`),
- the sandbox token,
- a ready-to-paste MCP client config for Cursor (`.cursor/mcp.json`), Claude, and other clients:

```json
{ "mcpServers": { "unwhelm-try-me": { "url": "https://mcp.unwhelm.net/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

- and a `curl` command for a manual `tools/call`.

The token has client scopes only, so admin, catalog, and staff billing tools are refused, exactly as in the "What a client agent can't do" plan.

## Cleanup and limits

`npm run db:purge-demos` (and every new start) deletes expired sandboxes: proposals, chats, traces, token, client, membership, org, and user. Starts are limited per IP hash per hour and by the number of active sandboxes; both are `try_me_setting` rows. Setting `enabled` to 0 turns the page's start button off.

## Configuration

- `UNWH_DEMO_MCP_URL`: where the API calls `unwh-mcp` (default `http://127.0.0.1:3202/mcp`).
- `UNWH_DEMO_PUBLIC_MCP_URL`: the address shown to visitors for takeover.

See [the Try me help guide](try-me-help.md) for exercises a visitor runs with their own agent (served at `/try/help`).
