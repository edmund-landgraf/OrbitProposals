---
title: "I Pointed an MCP Client at Unwhelm and Drafted a Proposal"
author: UnwhelmNet
date: 2026-10-26
---

# I Pointed an MCP Client at Unwhelm and Drafted a Proposal

This is a session log. I connected a normal MCP client to Unwhelm's public server, with a client token from the [Try me](/try) sandbox, and did the work a client's own assistant would do. The server is `https://mcp.unwhelm.net/mcp`. The client speaks JSON-RPC over HTTP: `initialize`, then `tools/list`, then `tools/call`. No Unwhelm account UI in the loop.

## What the server said before I asked for anything

`initialize` came back with protocol `2025-03-26`, server name `unwh-mcp` `0.1.0`, and a block of instructions. Those instructions are the product, not a greeting. Scope the proposal first. When the client pauses or wants to finish later, offer a tickler and save it with `unw_set_tickler`.

`tools/list` returned **64 tools**. `unw_get_service_info` said the token's scopes were `proposals:read`, `proposals:write`, `contracts:write`, `billing:read`, and `projects:read`, and that the API was up in database mode. It also listed **24 tools the token cannot see**, each with the scope that hides it: invoice writes and hour logging (`billing:write`), every `unw_admin_*` tool (`admin`), and catalog drafts and price edits (`catalog:write`). I later called `unw_log_hours` anyway. The server answered `Tool unw_log_hours disabled`. It never reached the API.

## The catalog is a lookup, not a guess

`unw_get_catalog` returned the live price book, effective 2026-01-01, USD:

| Plan | What the tool returned |
|---|---|
| Workflow Check | $250, 3 hours |
| Capped Hours, 4 | $550 |
| Capped Hours, 8 | $900 |
| Fixed Price | minimum $3,000 |
| Hourly | $175 |

An agent is not supposed to invent a rate. If it quotes, it quotes this.

`unw_get_reminder_options` returned four channels (email, text, both, none) and four ticklers (tomorrow at a time, in a few days, every few days, once a week). Defaults: quiet hours 21:00–08:00, timezone `America/Los_Angeles`, tickler time 09:00, at most 5 ticklers, interval between 1 and 30 days.

I saved a preference with `unw_set_contact_preference`: channel `none`, `consent: false`, timezone `America/Los_Angeles`. The sandbox should not email anyone. The tool returned the stored preference, `changed: true`, `consentAt: null`.

## A real proposal, from tool calls

I called `unw_create_proposal` for a fixed-price engagement titled "Northwind order sync":

- Scope summary: sync paid Shopify orders into the warehouse system once a day, with a mismatch report.
- Deliverables: the daily sync, and a report the warehouse lead can read.
- Assumption: Shopify admin access in week one. Exclusion: orders older than 90 days.
- Timeline: 2026-11-03 to 2026-12-12, no milestones.
- Pricing: `{ model: "fixed_price", amountMinor: 450000, currency: "USD" }` — $4,500, above the $3,000 floor.

It came back `draft`, with an id. `unw_list_proposal_templates` listed nine: `standard`, `fixed_bid`, `tm_retainer`, `discovery`, `data_migration`, `web_app`, `mobile_app`, `ai_solution`, `modernization`. I set `standard`. Its parts include scope, hours, price, options, and the narrative sections. The tool description is explicit that this call never sets hours or price.

`unw_list_section_library` listed reusable parts: security, data migration, service levels, training, integrations, app release, AI evaluation. I added `integrations` ("Systems and integrations"). Guidance on the row: name the systems, the direction of data, who owns each side, and how failures are retried. "Never state hours or price."

I wrote the executive summary with `unw_update_proposal_section`. The section moved to `drafted`. Its own guidance says two or three short paragraphs a decision-maker can read alone, and again: never state hours or price. I kept the dollar figure in the pricing field, where it belongs, and out of the prose.

## Progress is a sentence, not a percentage buried in JSON

`unw_get_proposal_progress` said **"0 of 12 parts settled"**, phrase "Just getting started", 0%. Scope, hours, and price were all "Not started."

I marked hours unsure with `unw_mark_part_unsure`. That is the tool for "I don't know, talk to a person," not a way to sneak in a number. The next progress read was **"1 of 12 parts settled, 1 to discuss with us"**, 8%. Hours sat in a group labeled "To discuss with us": "Marked unsure. We will talk it through on the call."

`unw_review_proposal` scored the draft **66**. 4 of 8 sections ready, 4 issues. Scope and the executive summary scored 100. Price scored 80 with one suggestion: "Staff have not set the price yet. Hand pricing to staff; the agent never sets hours or price." Schedule scored 85 because the timeline had no milestones, and the suggestion was that staff add checkpoints while the client says which dates matter.

`unw_recommend_handoff` with reason `client_unsure` and the note "Hours should be a conversation, not a guess" stored a handoff record. The tool's own text says the progress screen then shows "Ready for a call with Unwhelm," even if the draft is incomplete. Reason codes the server documents: `client_unsure`, `scope_unbounded`, `stuck`, `client_asked`.

I previewed a scope change, "Also sync refunds and inventory counts," with `unw_preview_change_impact`. It did not apply the change. It returned: reopens nothing, 8% to 8%, and the sentence "Adding Also sync refunds and inventory counts. reopens nothing else." (The sentence pastes the change text in raw, which is a small rough edge.)

## Submit is allowed. Approving yourself is not.

`unw_get_proposal_status` still said `draft`, review state Draft, nothing locked, no open comments or flags.

`unw_submit_proposal_for_review` succeeded. State became `agent_review`, version 1, not locked. Listing proposals afterward showed status `pending_approval`.

`unw_review_decision` with `approve` came back **409 Conflict**. The tool is on the client list, and the API refuses the transition. Same shape as `unw_list_agent_traces`: the tool is visible, the call returns **403 Forbidden**. Visibility and permission are not the same thing. Hidden tools fail in the MCP server (`disabled`). Staff-only tools fail in the API (403 or 409). A client should read the error and stop, not retry with a different argument.

## Chat, and the empty rooms past the sale

`unw_create_chat_session` opened a proposal chat tied to that proposal id. `unw_send_chat_message` asked, "What is still open before this can go to review?" The stored assistant reply was: "I couldn't finish that draft, so I asked a person at Unwhelm to take it from here." In this sandbox that is the whole reply. The message and the reply are both rows, with ids and timestamps. There is no separate model bill on the Unwhelm side of that call.

`unw_list_projects` returned an empty page. There is no contract yet, so there is nothing to sign. `unw_list_payment_terms` still answered: Due on receipt, Net 15, and Net 30 (the default). `unw_list_consult_offerings` returned one row: Free consult, $0, 30 minutes, one per client. "A free conversation about one workflow. We listen, ask questions, and suggest a next step."

## What I would hand a client

Paste this into the MCP client. The token comes from Try me and expires with the sandbox (30 minutes unless the setting says otherwise). It is shown once.

```json
{ "mcpServers": { "unwhelm": { "url": "https://mcp.unwhelm.net/mcp", "headers": { "Authorization": "Bearer <token>" } } } }
```

Then tell the assistant to follow the server instructions: catalog for any number, narrative without hours or price, `unw_mark_part_unsure` when the client would rather talk, `unw_recommend_handoff` when a person should take it, and stop when a tool returns disabled, 403, or 409. Offer a tickler only when the client pauses.

That session was one proposal, one preference, one section, one handoff, one refused approval, and a chat reply that handed the draft to a person. The tools did the record-keeping. The assistant only decided which tool to call.
