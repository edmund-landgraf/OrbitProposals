import { z } from "zod";
import { EngagementKindSchema, engagementMatchesDocumentPricing, PricingSchema, ProposalDocumentPricingSchema, StoredPricingSchema } from "./pricing.js";

export {
  pricing,
  ENGAGEMENT_KINDS,
  PRICING_MODELS,
  WORKFLOW_CHECK_AMOUNT_MINOR,
  HOURLY_RATE_AMOUNT_MINOR,
  CAPPED_HOURS_4_AMOUNT_MINOR,
  CAPPED_HOURS_8_AMOUNT_MINOR,
  CAPPED_HOURS_4_FLOOR_MINOR,
  CAPPED_HOURS_8_FLOOR_MINOR,
  FIXED_PRICE_FLOOR_MINOR,
  SINGLE_PRICING_MODEL_MESSAGE,
  EngagementKindSchema,
  PricingModelSchema,
  PricingSchema,
  StoredPricingSchema,
  PendingStaffPricingSchema,
  ProposalDocumentPricingSchema,
  isPendingStaffPricing,
  engagementMatchesStoredPricing,
  engagementMatchesDocumentPricing,
  EngagementPricingSchema,
  engagementMatchesPricing,
  publicPricingPlans,
} from "./pricing.js";
export type { EngagementKind, PricingModel, ProposalPricing, PublicPricingPlan, PendingStaffPricing, ProposalDocumentPricing } from "./pricing.js";

export {
  BILLING_SCHEDULE_DEFAULTS,
  BillingScheduleError,
  basisToPercent,
  billingScheduleFromPricing,
  contractSignedInvoiceAmount,
  entriesForMilestoneAcceptance,
  formatBillingPercent,
  milestoneAcceptanceInvoiceAmount,
  milestoneThatOwnsUnscopedEntries,
  percentToBasis,
  reconcileBillingSchedule,
} from "./billingSchedule.js";
export type { BillingScheduleDraft, BillingScheduleDraftEntry, BillingTriggerName, MilestoneBillingTarget } from "./billingSchedule.js";

export const IdSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime({ offset: true });
export const DateSchema = z.string().date();
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
// Normalization belongs at the input boundary; keeping this schema transform-free
// makes the runtime contract exportable to JSON Schema without loss.
export const EmailSchema = z.string().email();
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const RequestIdSchema = IdSchema;
export const MoneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: CurrencySchema,
}).strict();
export const PercentSchema = z.string().regex(/^\d{1,3}(?:\.\d{1,4})?$/).refine((value) => Number(value) >= 0 && Number(value) <= 100, "Percent must be between 0 and 100");
export const WarningSchema = z.object({ code: z.string().min(1), message: z.string().min(1), path: z.string().min(1).optional() }).strict();
export const LinkMapSchema = z.record(z.string(), z.string().url().or(z.string().startsWith("/")));

export const SuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
  changed: z.boolean().optional(),
  entity: z.unknown(),
  warnings: z.array(WarningSchema),
  links: LinkMapSchema,
  requestId: RequestIdSchema,
}).strict();

export const ErrorDetailSchema = z.object({ path: z.string().optional(), code: z.string(), message: z.string() }).strict();
export const ErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  code: z.enum([
    "AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND", "VALIDATION_FAILED", "CONFLICT",
    "IDEMPOTENCY_REPLAY", "HELD_FOR_HUMAN", "SCOPE_REQUIRED", "RATE_LIMITED",
    "OAUTH_INVALID_GRANT", "OAUTH_INVALID_CLIENT", "NOT_IMPLEMENTED",
    "UPSTREAM_UNAVAILABLE", "INTERNAL_ERROR",
  ]),
  message: z.string(),
  retryable: z.boolean(),
  details: z.array(ErrorDetailSchema).optional(),
  requestId: RequestIdSchema,
}).strict();

export const CursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const PageSchema = z.object({ items: z.array(z.unknown()), nextCursor: z.string().nullable(), totalEstimate: z.number().int().nonnegative().nullable() }).strict();

export const RoleSchema = z.enum(["prospect", "client", "staff"]);
export const AuthModeSchema = z.enum(["public", "session", "bearer"]);
export const RecordStatusSchema = z.enum(["draft", "pending_approval", "active", "on_hold", "closed"]);

export const UserSchema = z.object({
  id: IdSchema, email: EmailSchema, displayName: z.string().min(1), roles: z.array(RoleSchema), createdAt: TimestampSchema,
}).strict();
export const OrganizationSchema = z.object({ id: IdSchema, name: z.string().min(1), slug: SlugSchema, createdAt: TimestampSchema }).strict();
export const MembershipSchema = z.object({
  id: IdSchema, userId: IdSchema, organizationId: IdSchema, role: RoleSchema,
  status: z.enum(["invited", "active", "suspended"]), permissions: z.array(z.string()),
}).strict();
export const CurrentIdentitySchema = z.object({ user: UserSchema.nullable(), organization: OrganizationSchema.nullable(), membership: MembershipSchema.nullable(), authMode: AuthModeSchema }).strict();

export const TimelineMilestoneSchema = z.object({
  id: IdSchema,
  title: z.string().min(1),
  description: z.string(),
  dueDate: DateSchema.nullable(),
  weekOffset: z.number().int().min(0).optional(),
  weeksLow: z.number().int().nullable().optional(),
  weeksHigh: z.number().int().nullable().optional(),
  hoursLow: z.number().int().nullable().optional(),
  hoursHigh: z.number().int().nullable().optional(),
  endsWeekLow: z.number().int().nullable().optional(),
  endsWeekHigh: z.number().int().nullable().optional(),
  gate: z.string().optional(),
  actualStart: DateSchema.nullable().optional(),
  actualEnd: DateSchema.nullable().optional(),
}).strict();
export const ProposalRoleSideSchema = z.enum(["unwhelm", "client"]);
export const ProposalRoleSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  side: ProposalRoleSideSchema,
  responsibility: z.string(),
  heaviestIn: z.array(z.string().min(1)),
}).strict();
export const TimelineSchema = z.object({ startDate: DateSchema.nullable(), targetDate: DateSchema.nullable(), milestones: z.array(TimelineMilestoneSchema) }).strict();
export const ProposalScopeSchema = z.object({
  summary: z.string().min(1),
  deliverables: z.array(z.string().min(1)).min(1),
  assumptions: z.array(z.string()),
  exclusions: z.array(z.string()),
}).strict();
export const ProposalOptionSchema = z.object({ id: IdSchema, label: z.string().min(1), description: z.string(), priceDelta: MoneySchema, selected: z.boolean(), selection: z.string().min(1).optional(), groupId: IdSchema.nullable().optional(), groupName: z.string().nullable().optional(), groupMode: z.string().nullable().optional() }).strict();

export const ProposalDocumentSchema = z.object({
  schemaVersion: z.literal(1), id: IdSchema, organizationId: IdSchema.nullable(), ownerId: IdSchema,
  title: z.string().min(1), engagement: EngagementKindSchema, status: RecordStatusSchema,
  scope: ProposalScopeSchema,
  timeline: TimelineSchema, pricing: ProposalDocumentPricingSchema, options: z.array(ProposalOptionSchema),
  version: z.number().int().min(1), createdAt: TimestampSchema, updatedAt: TimestampSchema,
}).strict().superRefine((document, ctx) => {
  if (!engagementMatchesDocumentPricing(document.engagement, document.pricing)) {
    ctx.addIssue({ code: "custom", path: ["engagement"], message: "A proposal has exactly one pricing model, and the engagement must match it." });
  }
});

export const ChatSessionSchema = z.object({
  id: IdSchema, ownerId: IdSchema.nullable(), agent: z.enum(["proposal", "contract", "project_manager"]),
  status: z.enum(["open", "human_held", "closed"]), proposalId: IdSchema.nullable(), createdAt: TimestampSchema, updatedAt: TimestampSchema,
}).strict();
export const ChatMessageSchema = z.object({
  id: IdSchema, sessionId: IdSchema, role: z.enum(["user", "assistant", "human", "system"]),
  content: z.string(), toolCallId: IdSchema.nullable(), createdAt: TimestampSchema,
}).strict();

export const BillingEntrySchema = z.object({
  id: IdSchema, label: z.string().min(1), percent: PercentSchema, amount: MoneySchema, dueOn: DateSchema.nullable(),
  trigger: z.enum(["contract_signed", "milestone_accepted", "manual"]), milestoneId: IdSchema.nullable(), invoiceId: IdSchema.nullable(),
}).strict();
export const BillingScheduleSchema = z.object({ total: MoneySchema, entries: z.array(BillingEntrySchema) }).strict();
export const ContractSchema = z.object({
  id: IdSchema, proposalId: IdSchema, organizationId: IdSchema,
  status: z.enum(["draft", "sent", "signed", "cancelled"]), terms: z.string(), billing: BillingScheduleSchema,
  signedAt: TimestampSchema.nullable(), createdAt: TimestampSchema, updatedAt: TimestampSchema,
}).strict();
export const InvoiceSchema = z.object({
  id: IdSchema, contractId: IdSchema, amount: MoneySchema,
  status: z.enum(["draft", "sent", "paid", "void", "overdue"]), dueDate: DateSchema, paidAt: TimestampSchema.nullable(), createdAt: TimestampSchema,
  gross: MoneySchema.optional(), retainage: MoneySchema.optional(), kind: z.string().optional(),
}).strict();
export const MilestoneSchema = z.object({
  id: IdSchema, projectId: IdSchema, title: z.string().min(1), description: z.string(), dueDate: DateSchema.nullable(),
  status: z.enum(["planned", "in_progress", "submitted", "accepted", "blocked"]), retainage: MoneySchema.nullable(),
}).strict();
export const TaskSchema = z.object({
  id: IdSchema, projectId: IdSchema, milestoneId: IdSchema.nullable(), title: z.string().min(1), description: z.string(),
  status: z.enum(["todo", "in_progress", "blocked", "done"]), assigneeId: IdSchema.nullable(), dueDate: DateSchema.nullable(),
}).strict();
export const ProjectSchema = z.object({
  id: IdSchema, contractId: IdSchema, organizationId: IdSchema, title: z.string().min(1),
  status: z.enum(["planned", "active", "blocked", "complete"]), milestones: z.array(MilestoneSchema), createdAt: TimestampSchema, updatedAt: TimestampSchema,
}).strict();
export const ChangeOrderSchema = z.object({
  id: IdSchema, contractId: IdSchema, requestedBy: IdSchema, summary: z.string().min(1), priceDelta: MoneySchema.nullable(),
  status: z.enum(["pending", "approved", "rejected"]),
}).strict();

export const EscalationSchema = z.object({
  id: IdSchema, sessionId: IdSchema, reason: z.string().min(1), status: z.enum(["open", "claimed", "resolved"]),
  assigneeId: IdSchema.nullable(), createdAt: TimestampSchema, resolvedAt: TimestampSchema.nullable(),
}).strict();
export const ApprovalSchema = z.object({
  id: IdSchema, kind: z.enum(["pricing", "change_order"]), recordId: IdSchema,
  status: z.enum(["pending", "approved", "rejected"]), decidedBy: IdSchema.nullable(), reason: z.string().nullable(), decidedAt: TimestampSchema.nullable(),
}).strict();
export const AuditEventSchema = z.object({
  id: IdSchema, organizationId: IdSchema.nullable(), actorUserId: IdSchema.nullable(), tokenId: IdSchema.nullable(),
  operation: z.string().min(1), method: z.string().min(1), path: z.string().min(1), recordType: z.string().nullable(), recordId: IdSchema.nullable(),
  requestId: RequestIdSchema, inputRedacted: z.record(z.string(), z.unknown()), statusCode: z.number().int(), previousHash: z.string().nullable(), hash: z.string(), createdAt: TimestampSchema,
}).strict();

export const SchemaCatalog = {
  id: IdSchema, timestamp: TimestampSchema, money: MoneySchema, percent: PercentSchema,
  successEnvelope: SuccessEnvelopeSchema, errorEnvelope: ErrorEnvelopeSchema, page: PageSchema,
  user: UserSchema, organization: OrganizationSchema, membership: MembershipSchema, currentIdentity: CurrentIdentitySchema,
  proposal: ProposalDocumentSchema, pricing: PricingSchema, chatSession: ChatSessionSchema, chatMessage: ChatMessageSchema,
  contract: ContractSchema, billingSchedule: BillingScheduleSchema, invoice: InvoiceSchema,
  project: ProjectSchema, milestone: MilestoneSchema, task: TaskSchema, changeOrder: ChangeOrderSchema,
  escalation: EscalationSchema, approval: ApprovalSchema, auditEvent: AuditEventSchema,
} as const;

export type ProposalDocument = z.infer<typeof ProposalDocumentSchema>;
export type CurrentIdentity = z.infer<typeof CurrentIdentitySchema>;
export type Contract = z.infer<typeof ContractSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
