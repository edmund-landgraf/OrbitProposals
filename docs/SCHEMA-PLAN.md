# Unwhelm API schema plan

Status: relational design implemented locally and deployed to production, v0.3 (2026-10-20).

This document defines the runtime and JSON schema contract for the 75
operations listed in [`BUILD-PLAN.md`](./BUILD-PLAN.md). It is intentionally a
Markdown design artifact: implementation should not begin until the shapes,
envelopes, and invariants below are approved.

## 1. Schema rules

- JSON uses `camelCase` names.
- IDs are opaque UUID strings. Clients must not infer meaning from an ID.
- Dates and times are RFC 3339 UTC strings, for example
  `2026-10-20T18:30:00Z`.
- Money is integer minor units plus an ISO 4217 currency code; never a float.
- Percentages are decimal strings with a maximum of four decimal places and
  must sum exactly to `100.00` where stated.
- Unknown input properties are rejected. Unknown response properties may be
  ignored by clients.
- Every mutating request accepts an optional `requestId` for idempotency.
- Pagination uses an opaque `cursor`, not page numbers.
- Records returned to a client are scoped to the authenticated organization;
  an inaccessible record is returned as `404`.

## 2. Common envelopes

### Success

```json
{
  "ok": true,
  "changed": false,
  "entity": {},
  "warnings": [],
  "links": { "self": "/api/v1/..." },
  "requestId": "uuid"
}
```

Rules:

- `changed` is required for writes and omitted or `false` for reads.
- `entity` is the primary object, list, or export document.
- `warnings` is always an array of `{code, message, path?}`.
- `links` is an object of relation names to absolute-or-origin-relative URLs.

### Error

```json
{
  "ok": false,
  "code": "VALIDATION_FAILED",
  "message": "The request is not valid.",
  "retryable": false,
  "details": [{ "path": "scope.deliverables", "code": "too_small", "message": "At least one deliverable is required." }],
  "requestId": "uuid"
}
```

The stable error-code set is:

`AUTH_REQUIRED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`,
`CONFLICT`, `IDEMPOTENCY_REPLAY`, `HELD_FOR_HUMAN`, `SCOPE_REQUIRED`,
`RATE_LIMITED`, `OAUTH_INVALID_GRANT`, `OAUTH_INVALID_CLIENT`,
`NOT_IMPLEMENTED`, `UPSTREAM_UNAVAILABLE`, and `INTERNAL_ERROR`.

### Collection

```json
{
  "ok": true,
  "entity": { "items": [], "nextCursor": null, "totalEstimate": null },
  "warnings": [],
  "links": {},
  "requestId": "uuid"
}
```

## 3. Shared primitive shapes

```text
Id                 string, UUID format, min 1
Timestamp          string, RFC 3339 UTC
Currency           string, /^[A-Z]{3}$/
Money              { amountMinor: integer >= 0, currency: Currency }
Percent            string, decimal 0.0000–100.0000
Email              normalized lowercase email string
Slug               lowercase URL-safe string
RequestId          string, UUID format
Warning            { code: string, message: string, path?: string }
Page               { items: T[], nextCursor: string|null, totalEstimate: number|null }
```

## 4. Identity and authorization shapes

```text
Role               "prospect" | "client" | "staff"
AuthMode           "public" | "session" | "bearer"
MembershipStatus   "invited" | "active" | "suspended"

User {
  id: Id,
  email: Email,
  displayName: string,
  roles: Role[],
  createdAt: Timestamp
}

Organization {
  id: Id,
  name: string,
  slug: Slug,
  createdAt: Timestamp
}

Membership {
  id: Id,
  userId: Id,
  organizationId: Id,
  role: Role,
  status: MembershipStatus,
  permissions: string[]
}

CurrentIdentity {
  user: User|null,
  organization: Organization|null,
  membership: Membership|null,
  authMode: AuthMode
}
```

MCP tokens never appear in a response. Token creation returns the opaque token
once; storage and later records contain only a hash.

## 5. Proposal and conversation shapes

```text
EngagementKind  "workflow_check" | "capped_hours_4" | "capped_hours_8" | "fixed_price"
RecordStatus    "draft" | "pending_approval" | "active" | "on_hold" | "closed"

ProposalDocument {
  schemaVersion: 1,
  id: Id,
  organizationId: Id|null,
  ownerId: Id,
  title: string,
  engagement: EngagementKind,
  status: RecordStatus,
  scope: {
    summary: string,
    deliverables: string[1..],
    assumptions: string[],
    exclusions: string[]
  },
  timeline: Timeline,
  budget: Budget,
  options: ProposalOption[],
  price: Money|null,
  version: integer >= 1,
  createdAt: Timestamp,
  updatedAt: Timestamp
}

Timeline {
  startDate: date|null,
  targetDate: date|null,
  milestones: TimelineMilestone[]
}

TimelineMilestone { id: Id, title: string, description: string, dueDate: date|null }

Budget {
  estimate: Money|null,
  capHours: number|null,
  assumptions: string[],
  approved: boolean
}

ProposalOption { id: Id, label: string, description: string, priceDelta: Money, selected: boolean }

ChatSession {
  id: Id,
  ownerId: Id|null,
  agent: "proposal" | "contract" | "project_manager",
  status: "open" | "human_held" | "closed",
  proposalId: Id|null,
  createdAt: Timestamp,
  updatedAt: Timestamp
}

ChatMessage {
  id: Id,
  sessionId: Id,
  role: "user" | "assistant" | "human" | "system",
  content: string,
  toolCallId: Id|null,
  createdAt: Timestamp
}
```

Proposal import/export must validate the complete `ProposalDocument`, preserve
unknown IDs only as metadata, and reject a schema version other than `1` until
an explicit migration exists.

## 6. Contract, billing, and project shapes

```text
Contract {
  id: Id,
  proposalId: Id,
  organizationId: Id,
  status: "draft" | "sent" | "signed" | "cancelled",
  terms: string,
  billing: BillingSchedule,
  signedAt: Timestamp|null,
  createdAt: Timestamp,
  updatedAt: Timestamp
}

BillingSchedule {
  total: Money,
  entries: BillingEntry[]
}

BillingEntry {
  id: Id,
  label: string,
  percent: Percent,
  amount: Money,
  dueOn: date|null,
  trigger: "contract_signed" | "milestone_accepted" | "manual",
  milestoneId: Id|null,
  invoiceId: Id|null
}

`milestoneId` names the milestone that invoices a `milestone_accepted` entry. Null is unassigned. Signing creates the fixed-price remainder unassigned. Accepting the contract's only milestone invoices it. When the contract has several milestones, the final one invoices it: the latest due date, or the greatest id when none are dated. An entry that already names a milestone is invoiced only for that milestone.

Invoice {
  id: Id,
  contractId: Id,
  amount: Money,
  status: "draft" | "sent" | "paid" | "void",
  dueDate: date,
  paidAt: Timestamp|null,
  createdAt: Timestamp
}

Project {
  id: Id,
  contractId: Id,
  organizationId: Id,
  title: string,
  status: "planned" | "active" | "blocked" | "complete",
  milestones: Milestone[],
  createdAt: Timestamp,
  updatedAt: Timestamp
}

Milestone {
  id: Id,
  projectId: Id,
  title: string,
  description: string,
  dueDate: date|null,
  status: "planned" | "in_progress" | "submitted" | "accepted" | "blocked",
  retainage: Money|null
}

Task {
  id: Id,
  projectId: Id,
  milestoneId: Id|null,
  title: string,
  description: string,
  status: "todo" | "in_progress" | "blocked" | "done",
  assigneeId: Id|null,
  dueDate: date|null
}

ChangeOrder {
  id: Id,
  contractId: Id,
  requestedBy: Id,
  summary: string,
  priceDelta: Money|null,
  status: "pending" | "approved" | "rejected"
}
```

Billing invariants:

1. Entry percentages sum exactly to `100.0000`.
2. Entry amounts sum exactly to the schedule total in the same currency.
3. A milestone cannot be accepted twice.
4. A held record rejects all agent writes with `HELD_FOR_HUMAN`.
5. Accepting a proposal, creating its handoffs, and creating its contract is
   one transaction or no change is committed.

## 7. Staff and audit shapes

```text
Escalation {
  id: Id,
  sessionId: Id,
  reason: string,
  status: "open" | "claimed" | "resolved",
  assigneeId: Id|null,
  createdAt: Timestamp,
  resolvedAt: Timestamp|null
}

Approval {
  id: Id,
  kind: "pricing" | "change_order",
  recordId: Id,
  status: "pending" | "approved" | "rejected",
  decidedBy: Id|null,
  reason: string|null,
  decidedAt: Timestamp|null
}

AuditEvent {
  id: Id,
  organizationId: Id|null,
  actorUserId: Id|null,
  tokenId: Id|null,
  operation: string,
  method: string,
  path: string,
  recordType: string|null,
  recordId: Id|null,
  requestId: RequestId,
  inputRedacted: object,
  statusCode: integer,
  previousHash: string|null,
  hash: string,
  createdAt: Timestamp
}
```

Audit input is redacted before persistence. Passwords, magic-link secrets,
bearer tokens, authorization codes, and raw client prompts containing secrets
must never be stored.

## 8. Operation-to-schema map

The 75 operation rows use these request/response families:

| Operation family | Request schema | Success entity | Main errors |
|---|---|---|---|
| health, public info, pricing | none/query | service info or public config | `UPSTREAM_UNAVAILABLE` |
| me, session | none | `CurrentIdentity` | `AUTH_REQUIRED` |
| magic-link and Google auth | provider-specific validated input | session/redirect metadata | `VALIDATION_FAILED`, `OAUTH_INVALID_GRANT` |
| MCP authorize/token/revoke/clients | OAuth 2.1 + PKCE shapes | redirect/token/client metadata | `OAUTH_INVALID_CLIENT`, `OAUTH_INVALID_GRANT` |
| operation log | `CursorQuery` + filters | `Page<AuditEvent>` | `FORBIDDEN` |
| chat sessions/messages | `CreateSession`, `CreateMessage`, `CursorQuery` | `ChatSession`, `Page<ChatMessage>` | `AUTH_REQUIRED`, `HELD_FOR_HUMAN` |
| proposals | `CreateProposal`, `PatchProposal`, section/timeline/budget/options inputs | `ProposalDocument`, `Page<ProposalDocument>` | `VALIDATION_FAILED`, `CONFLICT` |
| proposal review/accept/import/export | review/accept/import documents | proposal, handoff, or export document | `CONFLICT`, `HELD_FOR_HUMAN` |
| contracts | contract create/patch/sign inputs | `Contract`, `Page<Contract>` | `FORBIDDEN`, `CONFLICT` |
| invoices and billing | invoice/change-order inputs | `Invoice`, `BillingSchedule`, `Page<Invoice>` | `CONFLICT`, `VALIDATION_FAILED` |
| projects, milestones, tasks | project/milestone/task inputs | `Project`, `Milestone`, `Task`, or pages | `NOT_FOUND`, `HELD_FOR_HUMAN` |
| staff queues and decisions | cursor, claim, resolve, approval, hold inputs | `Escalation`, `Approval`, or pages | `FORBIDDEN`, `CONFLICT` |

Every operation also accepts the common `RequestId` header or body field and
returns the common success/error envelope. Exact field-level schemas are to be
generated from the approved domain shapes; hand-written route-specific types
are not permitted.

## 9. Approval gates before implementation

1. Confirm whether prospects are represented by `ownerId: Id|null` or a
   separate anonymous identity record.
2. Confirm whether `Money` supports only USD or all ISO currencies.
3. Confirm whether contracts require immutable version snapshots before signing.
4. Confirm the allowed MCP scopes and whether staff may mint client tokens.
5. Confirm retention periods for `ChatMessage.inputRedacted` and `AuditEvent`.
6. Approve this document, then implement `packages/shapes` from it before
   wiring the API handlers or MCP tools.

## 10. Relational Prisma implementation

The PostgreSQL database stores normalized ownership, workflow, billing, and
audit records. Flexible document sections remain JSON so the API can preserve
the versioned `ProposalDocument` contract without putting presentation-shaped
data into dozens of columns.

### 10.1 Build order

The migration is applied in this order:

1. Create enum types and the identity tables: `User`, `Organization`, and
   `Membership`.
2. Create authentication tables: `McpClient`, `McpToken`, and
   `IdempotencyKey`.
3. Create proposal and conversation tables: `Proposal`, `ProposalOption`,
   `TimelineMilestone`, `ChatSession`, and `ChatMessage`.
4. Create commercial tables: `Contract`, `BillingEntry`, and `Invoice`.
5. Create delivery tables: `Project`, `Milestone`, `Task`, and `ChangeOrder`.
6. Create staff-control tables: `Escalation` and `Approval`.
7. Create append-only `AuditEvent` last, after all actor and record IDs exist.
8. Add ownership, status, lookup, and uniqueness indexes.
9. Apply application-level transaction checks for money/percentage totals,
   held-record writes, and proposal-to-contract acceptance.

### 10.2 Mapping rules

- Every business record has an opaque UUID primary key and UTC timestamps.
- Organization-owned records carry `organizationId`; proposal drafts may be
  organization-null while a prospect is unauthenticated.
- Money is persisted as integer minor units plus a three-letter currency code.
- Structured proposal scope, timeline, budget, billing snapshots, and redacted
  audit input use PostgreSQL `jsonb` fields and are validated by the Zod
  schemas in `packages/shapes` before persistence.
- Token secrets are never persisted; `McpToken.tokenHash` is the only token
  material stored.
- `AuditEvent` is append-only. `previousHash` and `hash` form the audit chain.
- Deletes are restricted for business records; status transitions represent
  closure, cancellation, or archival.

### 10.3 Local-to-production database sequence

```text
prisma validate
  -> prisma migrate dev --name init_unwhelm
  -> application/API smoke tests
  -> prisma migrate deploy on vps-unwh
  -> prisma generate
  -> service restart and health check
```

`prisma db push` is reserved for disposable development databases. Production
uses the checked-in migration generated from this schema.

The initial baseline is checked in at
`prisma/migrations/0001_init_unwhelm/migration.sql`. It was derived from the
isolated local `unwhelm_local` database after schema validation and contains
only the 21 Unwhelm tables.

For local development, use the isolated `unwhelm_local` database. The existing
Docker `appdb` database contains unrelated Django tables and must not receive
this schema. Keep the real password in the local `.env` only; the repository
contains only the placeholder in `.env.example`.
