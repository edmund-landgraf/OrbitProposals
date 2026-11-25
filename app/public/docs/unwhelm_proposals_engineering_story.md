# Unwhelm Proposals: From Conversation to Commitment

**Engineering narrative | October 26, 2026**

## From conversation to commitment

*How Unwhelm is turning an AI-assisted proposal into a controlled business workflow, without handing commercial authority to the model.*

---

The original question was simple: could a client use their own AI assistant to work with Unwhelm, describe a problem, and leave with a useful proposal draft? The obvious answer would have been a chatbot that collected requirements and wrote a convincing document. We chose a harder answer: the assistant should operate against real business records, while the business systems—not the model—decide what it is allowed to change.

---

### Why a good-sounding proposal was not enough

---

A proposal is not merely prose. It can imply a price, a delivery date, an obligation, an approval, and sometimes the beginning of a contractual relationship. A language model can draft plausible language, but plausible is not the same as authorized. Asking an assistant to “never invent pricing” helps, yet it does not replace a server-side rule that makes unauthorized pricing impossible. The problem therefore changed from prompt design to product architecture.

---

That reframing shaped Unwhelm’s proposal system. The client should be able to stay in a familiar AI client rather than learning a dedicated sales portal. The assistant needs tools for creating records, adding scope, recording uncertainty, reading progress, and submitting a draft. It does not need staff privileges, permission to bind the firm commercially, or access to internal billing controls. The software should produce an intelligible handoff when the assistant reaches those limits.

---

### The operating principle

---

> The AI handles the conversation. The tools maintain the record. The API enforces the policy. A person makes the commitment.

---

This is a deliberate separation of responsibility. The assistant is useful because it can interpret a client’s goals and decide which supported tool to call next. A proposal remains reliable because typed operations, record ownership, review transitions, and staff-only rules are enforced below the conversation. The same principle applies whether the client uses a hosted model, a desktop MCP client, or a future assistant interface.

---

The result is closer to a controlled intake and review workflow than to an autonomous sales representative. It is intentionally comfortable saying “we need to discuss that.” In fact, that answer becomes a durable part of the proposal rather than an awkward conversational failure.

---

### What this report covers

---

The following pages follow the development logic: a structured proposal data model; an MCP tool surface for outside assistants; commercial and communication guardrails; a review state machine with a human approval boundary; and a real client-side test. The emphasis is on the approach, what was demonstrated, what the code supports, and what still deserves hardening—not a claim that a single test proves the entire system production-ready.

---

## Phase 1 — Build the workflow first

*Before giving an agent a tool, define the business object, the allowed states, and who owns each decision.*

---

Unwhelm began with a familiar public website. A website can describe services, publish examples, and accept contact requests, but it does not by itself give an outside AI an accountable way to prepare business records. The proposal work required a different foundation: persistent proposal entities, reusable templates, structured sections, a pricing catalog, client and staff roles, and explicit transitions between drafting and review.

---

### Records instead of a transcript

---

The key architectural choice was to store the proposal as business data, not treat the chat transcript as the source of truth. Title, scope, deliverables, assumptions, timing, pricing, options, and milestones can be inspected and revised independently. A proposal can have comments, flags, snapshots, and review events. The client can return later without depending on an assistant to reconstruct what everyone supposedly agreed to.

---

The current repository documents a React-facing experience, an Express 5 API, a TypeScript MCP layer, and PostgreSQL accessed through Prisma. The MCP server wraps the API; it is not a second business logic implementation. The backend returns structured success or error results and maintains a trace of agent calls. This gives the browser, the client’s AI, and staff-facing workflows a common enforcement point.

---

```text
Client AI  →  MCP tools  →  Express API  →  PostgreSQL
Browser    →  same API   →  same policies and records
```

---

### Progress is a model, not a percentage decoration

---

Each proposal can copy a template-defined completion tree. Individual parts carry states such as open, drafted, needing review, agreed, or locked. Dependencies matter: changing a settled input can reopen downstream work rather than leaving a stale “complete” badge in place. Progress is assembled from these nodes and translated into client language, with a next step chosen from unresolved work.

---

That design supports a meaningful distinction between a missing answer and a conscious decision to involve a human. A client’s uncertainty can be persisted and displayed as an item to discuss. A proposal may be ready to hand off even while some parts remain unresolved. This is more useful than requiring an assistant to fill every field before anybody can review the work.

---

### Configuration belongs in the system

---

The code loads review transitions, labels, limits, scoring rules, and progress language from policy records. That means a change to review behavior or a client-facing phrase is not merely an adjustment to a prompt. It is an explicit part of the business process. The architectural payoff is consistency: different assistants may speak differently, but they are still operating on the same proposal, governed by the same rules.

---

## Phase 2 — Give outside agents hands

*Model Context Protocol turns the business workflow into discoverable operations, while authentication and scopes determine which operations count.*

---

Rather than building another proprietary chat window and requiring clients to start there, Unwhelm exposes its work through a Model Context Protocol (MCP) server. A normal compatible client can initialize a connection, discover the tools it may use, and call those tools using structured arguments. For the proposal test, that meant the assistant did not need an Unwhelm dashboard or an account-management UI to create and advance a real draft.

---

### A tool list is not a permission grant

---

The test connection returned 64 available tools and identified another 24 outside that token’s visibility. That distinction mattered enough to test directly. A restricted call was attempted anyway, and the MCP server refused it as disabled. The tool surface is tailored to the token, and the backend remains responsible for enforcing the requested action. Merely knowing a hidden tool’s name does not make it callable.

---

That is the first layer of defense. The second sits in the HTTP API and the records it owns. Tokens carry scopes; client and staff roles are not interchangeable; and routes check both the requested operation and its authorization context. Some operations must be denied even when the caller can see an action with a similar name. This is why “hide the button” or “tell the AI not to do it” is not an adequate security model.

---

### A narrow and deliberate division of labor

---

The model should interpret the client’s request, choose the next tool, and explain the returned result. The MCP layer should validate the operation and carry the request to the API. The API should own state changes, pricing authority, ownership checks, review rules, and audit events. Because those are separate duties, the tool surface is usable by different models without transferring Unwhelm’s policy to each model vendor.

---

> The agent chooses actions; it does not get to redefine what an action means.

---

### Auditability is part of usability

---

The code records agent tool calls as traces with timing, inputs, outputs, and errors, subject to configured redaction and retention. This is not just for debugging. If a client questions why a proposal changed, the business needs more than “the assistant said so.” A traceable action sequence supports diagnosis, support, quality review, and eventual operational reporting.

---

The MCP server is therefore less a chatbot extension than an integration boundary. It provides controlled verbs that a client’s assistant can use without receiving direct database access, a staff session, or an unrestricted API credential. External AI becomes another user of the product—not the authority over the product.

---

## Phase 3 — Make uncertainty explicit

*The important guardrails are ordinary business rules: ask permission, use authoritative prices, and stop where a person must decide.*

---

The most valuable design choices were not exotic safety features. They were small, repeatable business rules that prevent a polished conversation from becoming an unauthorized promise. The assistant asks about reminders, quiet hours, timezone, and consent before assuming when or how to contact the client. Preferences are saved as records, not left as informal chat etiquette.

---

### Pricing is a source, not a suggestion

---

The service catalog returns published engagements and pricing data. The assistant is expected to quote that result instead of manufacturing a rate. Narrative proposal sections are deliberately instructed not to declare hours or prices. Those commercial fields have their own owners and checks. If the client wants a scope that falls outside a published engagement, the correct outcome is escalation and clarification, not a confident number produced from the model’s prior knowledge.

---

That matters because language models are very good at completing patterns. Given a half-described project, an assistant can easily produce a tidy statement of work with a plausible schedule and fee. The polished appearance makes the risk harder to notice. Unwhelm’s approach is to stop using fluent prose as evidence of authorization. Commercial commitments are treated as separate decisions.

---

### “I am not sure” becomes productive work

---

The system has an explicit path for unresolved details. In the observed session, progress initially read “0 of 12 parts settled.” After a section was advanced and the hours question was marked uncertain, it reported “1 of 12 parts settled, 1 to discuss with us.” That sentence matters more than the underlying completion percentage. It tells the client what was accomplished and what requires a conversation with staff.

---

The completion tree also understands dependencies. New facts may reopen downstream sections, and a before-and-after progress view can explain why a proposal has moved backward. That is useful behavior in consulting: a discovery call often changes earlier assumptions. It would be misleading to keep an unchanged completion score simply because the AI already wrote text there.

---

### The human handoff is designed, not improvised

---

Handoff reasons can be recorded as first-class data. Open questions and items marked “to discuss” can accompany the proposal into review, along with the current next step. The assistant does not have to pretend the work is final, and a staff member does not have to mine the conversation to find what needs judgment. The goal is a cleaner starting point for the human discussion, not the elimination of that discussion.

---

## Phase 4 — Test the refusal path

*A realistic client-side test is not complete when the happy path succeeds. It is complete when the server also refuses what the client should never be able to do.*

---

The end-to-end exercise used a standard MCP client against Unwhelm’s public server and followed the same sequence an outside assistant would: initialize, discover tools, call tools, read results, and advance the proposal. It produced a draft, saved a communication preference, completed a section, marked an issue for discussion, and handed the draft toward human review. These are small actions, but each created or changed an actual record through the system.

---

### Submission succeeded; self-approval did not

---

The assistant called **unw_submit_proposal_for_review**. That operation succeeded and moved the draft into **agent_review**. Next came the deliberately inappropriate request: approve the draft through **unw_review_decision** using the client context. The API returned **409 Conflict**. The action was visible, but the policy did not permit that transition from that role and state.

---

Other staff-only calls returned **403 Forbidden**. A 403 and a 409 carry different information: one blocks access to an operation, while the other rejects the requested transition under the workflow rules. Both are meaningful boundaries. A well-behaved assistant should report the refusal and stop. It should not vary the arguments until the system accidentally accepts them.

---

### Review produces findings, not a ceremonial score

---

The review returned a score of **66** for this draft, flagged pricing as staff-only, and recommended human scheduling checkpoints while the client identified which dates mattered. The repository implements rule-based section scoring and aggregates section scores into a proposal result. This is a quality signal for the review process, not a free-form AI claim that the proposal is commercially approved.

---

The workflow code separately models review states, transitions, comments, flags, versions, and approval-blocking conditions. It can preserve a snapshot when a transition requires one and distinguish client-visible feedback from internal review matters. These details matter because “approved” must be an accountable record transition, not a persuasive sentence in a conversation.

---

### What the session established—and what it did not

---

In that one session, an outside agent was able to complete ordinary proposal work while the system enforced two kinds of negative boundaries: tool access and review authority. This demonstrates a functioning path and a functioning refusal, not universal security or production reliability. Load behavior, adversarial testing, cross-tenant isolation, token expiration, and operational monitoring still need systematic verification at their own scale.

---

> A rejected approval is not a failed demo. It is evidence that the workflow protected its most important decision.

---

## What this changes—and what comes next

*The outcome is a different division of labor: agents can move business work forward while people retain the decisions that create obligations.*

---

A familiar sales chatbot often ends when it has generated an attractive PDF. The Unwhelm approach begins to pay off after that moment. The proposal is a live, versionable record. Open questions do not disappear into a transcript. A person can see what was settled, what changed, what needs attention, and why the draft was sent for review. The assistant has a useful job without having the final say.

---

### The engineering lessons

---

First, build durable business objects before layering an agent over them. Second, make pricing, review states, and permissions part of the API’s behavior rather than relying on a system prompt. Third, distinguish uncertainty from incompleteness: a recorded “talk to us” item can be a valid outcome. Fourth, make the negative path visible. An explicit refusal is easier to trust, debug, and explain than a silent failure or an improvised workaround.

---

There is also a product lesson. Supporting a client’s existing AI client lowers the friction of starting work, but it increases the importance of stable tool contracts, predictable errors, revocable credentials, and a human-readable handoff. A good agent integration must be understandable to the person who never sees the tools. Its quality is measured partly by what the system will not allow.

---

### The next practical priorities

---

The immediate priorities should be repeatable authorization tests for every role and token scope; regression coverage for pricing and review transitions; adversarial tests around cross-client record access; and clear staff workflows for resolving flagged scope, schedule, and commercial questions. Trace review and redaction policies deserve continuing attention as usage grows. The public sandbox and test plans offer a useful place to exercise both permitted and refused calls without contaminating live client data.

---

Longer term, stronger version comparisons, reminder workflows that respect saved preferences, transparent proposal change histories, and richer human/agent collaboration can reduce the cost of moving from early discovery to a reviewed engagement. Those are opportunities, not claims that this single test already validated all of them.

---

### Where the account is grounded

---

**Observed client session:** MCP tool discovery; 64 available and 24 restricted tools; progress from 0/12 to 1/12 with one discussion item; successful review submission; denied approval (409); staff-only denial (403); review score of 66.

---

**Repository implementation:** UnwhelmNet20, *docs/architecture.md*; *server/proposalProgress.ts*; *server/completionTree.ts*; *server/proposalReview.ts*; *server/proposalReviewAgent.ts*; *server/routes/proposalReview.ts*; *server/agentTrace.ts*; *server/catalog.ts*; *docs/try-me.md* (reviewed October 26, 2026).

---

> The AI does the work it is authorized to do. The software enforces the limits. People make the commitments.
