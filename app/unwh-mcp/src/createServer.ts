import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ENGAGEMENT_KINDS,
  StoredEngagementPricingSchema,
  StoredPricingSchema,
} from "../../packages/shapes/src/pricing.js";
import { getApiHealth, requestApi, type ApiEnvelope } from "./apiClient.js";
import { MCP_SCOPES } from "./scopes.js";
import { toolsHiddenForScopes, toolsHiddenForClients, type HiddenTool } from "./toolAccess.js";
import { apiTraceSink, traceTools, type TraceSink } from "./trace.js";
import { annotateTools } from "./toolAnnotations.js";
import { registerSearchFetch } from "./searchFetch.js";
import { ANONYMOUS_TOOLS, DEFAULT_RESOURCE_METADATA_URL, applyToolAuth, authChallenge } from "./anonymousAccess.js";
import { registerDraftProposal } from "./anonymousDraft.js";
import { TOOL_SCOPES } from "./toolAccess.js";
import { toolRisk, type ToolRisk } from "./toolCatalogue.js";

const pricingRules = "A proposal has exactly one pricing model. Amounts, floors, hours, and currency are the active catalog from GET /api/v1/catalog (unw_get_catalog): workflow_check, capped_hours (a published hours tier), fixed_price at or above the fixed floor, or hourly at the published rate.";
const billingDefaults = "The first sign generates billing entries from the proposal's one pricing model, and signing again does not add entries. Splits, labels, and triggers are the active catalog from GET /api/v1/catalog. A signed contract keeps the catalog version that produced its entries.";

const uuid = z.string().uuid();
const page = { cursor: uuid.optional(), limit: z.number().int().min(1).max(100).optional() };
const envelope = { ok: z.boolean(), entity: z.unknown(), warnings: z.array(z.unknown()), links: z.record(z.string(), z.string()).optional(), code: z.string().optional(), message: z.string().optional(), details: z.unknown().optional() };
// changed is false when the API reports a no-op (repeat resolve, unlock of an unlocked part, same template, and so on).
const writeEnvelope = { ...envelope, changed: z.boolean() };

function queryString(input: { cursor?: string; limit?: number; agent?: string; format?: string }) {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.agent) query.set("agent", input.agent);
  if (input.format) query.set("format", input.format);
  return query.size ? `?${query}` : "";
}

function portalLinks(entity: unknown, publicBaseUrl?: string) {
  if (!entity || typeof entity !== "object") return {};
  const record = entity as { id?: unknown; scope?: unknown; timeline?: unknown };
  if (typeof record.id !== "string" || (record.scope === undefined && record.timeline === undefined)) return {};
  const base = (publicBaseUrl ?? "https://unwhelm.net").replace(/\/$/, "");
  return { portal: `${base}/portal?proposal=${encodeURIComponent(record.id)}` };
}

function toolResult(result: ApiEnvelope, changed?: boolean, publicBaseUrl?: string) {
  const links = (result as ApiEnvelope & { links?: Record<string, string> }).links;
  const resolvedLinks = links && Object.keys(links).length ? links : portalLinks(result.entity, publicBaseUrl);
  // A write tool passes changed: true, but the API's explicit changed: false (a no-op) wins.
  const apiChanged = (result as { changed?: unknown }).changed;
  const resolvedChanged = typeof changed === "boolean" ? changed && apiChanged !== false : undefined;
  const structured = { ok: result.ok, entity: result.entity, warnings: Array.isArray(result.warnings) ? result.warnings : [], ...(Object.keys(resolvedLinks).length ? { links: resolvedLinks } : {}), ...(typeof resolvedChanged === "boolean" ? { changed: resolvedChanged } : {}), ...(!result.ok && typeof result.code === "string" ? { code: result.code } : {}), ...(!result.ok && typeof result.message === "string" ? { message: result.message } : {}), ...(!result.ok && result.details !== undefined ? { details: result.details } : {}) };
  return { content: [{ type: "text" as const, text: JSON.stringify(structured) }], structuredContent: structured };
}

export const ATTACHMENT_INSTRUCTIONS = "You cannot upload a PDF you generated. unw_attach_proposal_document and unw_upsert_proposal_document take base64 text that you must write out yourself, and a few hundred KB of PDF becomes about half a million characters, which will be cut off. You also have no bearer token and your shell cannot reach Unwhelm, so you cannot curl the file. Attach the writeup as a .md file through unw_attach_proposal_document. A person who has the PDF on their own machine uploads that file. Then call unw_list_proposal_attachments to confirm it. Do not retry by inlining the PDF.";

export const REMINDER_INSTRUCTIONS = `Do not call unw_create_proposal until the client agrees to save a proposal in Unwhelm. Until then, keep working in the conversation. When the picture is clear enough to save, ask whether to save it to Unwhelm and keep editing the saved document, or keep chatting without creating one. After it is saved, say that editing continues; saving only means the document exists. When the client pauses or wants to finish later, offer a tickler (tomorrow at 9am, every few days, a weekday and time, or a snooze such as in 3 days) and save it with unw_set_tickler. ${ATTACHMENT_INSTRUCTIONS}`;

/** Seeded proposal_review_comment_type codes (migration 0019). The API validates against the table and lists the configured codes when one is rejected. */
const REVIEW_COMMENT_TYPES = ["question", "pushback", "clarification", "needs_bounding"] as const;
const proposalFields = new Set(["scope", "timeline", "pricing", "title"]);
export function createServer(options: { apiOrigin: string; bearer?: string; scopes?: readonly string[]; staff?: boolean; traceSink?: TraceSink | null; anonymous?: boolean; resourceMetadataUrl?: string; publicBaseUrl?: string }) {
  const anonymous = options.anonymous === true;
  const resourceMetadataUrl = options.resourceMetadataUrl ?? DEFAULT_RESOURCE_METADATA_URL;
  const publicBaseUrl = options.publicBaseUrl ?? "https://unwhelm.net";
  const withLinks = (result: ApiEnvelope, changed?: boolean) => toolResult(result, changed, publicBaseUrl);
  const server = new McpServer({ name: "unwh-mcp", version: "0.1.0" }, { instructions: REMINDER_INSTRUCTIONS });
  const call = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => requestApi(options.apiOrigin, path, { ...init, bearer: options.bearer });
  let hiddenTools: HiddenTool[] = [];
  annotateTools(server);
  const catalogue: Array<{ name: string; summary: string; inputs: string[]; risk: ToolRisk }> = [];
  const registerTool = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: { description?: string; inputSchema?: object }, handler: Parameters<typeof server.registerTool>[2]) => {
    catalogue.push({
      name,
      summary: typeof config?.description === "string" ? config.description.slice(0, 280) : "",
      inputs: config?.inputSchema ? Object.keys(config.inputSchema) : [],
      risk: toolRisk(name, TOOL_SCOPES[name]),
    });
    return registerTool(name, config as Parameters<typeof registerTool>[1], handler);
  }) as typeof server.registerTool;
  traceTools(server, options.traceSink === null ? undefined : options.traceSink ?? apiTraceSink(options.apiOrigin, options.bearer));
  applyToolAuth(server, { anonymous, resourceMetadataUrl });

  server.registerTool(
    "unw_get_service_info",
    {
      description: "Returns the Unwhelm MCP and database-backed API status, the bearer token's scopes, and tools omitted from tools/list because that token lacks the scope.",
      inputSchema: {},
      outputSchema: {
        ok: z.boolean(),
        service: z.string(),
        connected: z.boolean(),
        scopes: z.array(z.string()).nullable(),
        hiddenTools: z.array(z.object({ name: z.string(), scope: z.string() })),
        api: z.object({ ok: z.boolean(), service: z.string().optional(), mode: z.string().optional(), connected: z.boolean().optional() }).passthrough(),
      },
    },
    async () => {
      const api = await getApiHealth(options.apiOrigin, options.bearer);
      const result = { ok: true, service: "unwh-mcp", connected: true, scopes: options.scopes !== undefined ? [...options.scopes] : null, hiddenTools, api };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    },
  );

  registerSearchFetch(server, { apiOrigin: options.apiOrigin, publicBaseUrl: options.publicBaseUrl, scopes: anonymous ? [] : options.scopes, call, ...(anonymous ? { authChallenge: (scope: string, action: string) => authChallenge(resourceMetadataUrl, scope, action) } : {}) });
  registerDraftProposal(server);
  server.registerTool("unw_list_proposals", { description: "Lists proposals visible to the authenticated Unwhelm API bearer token.", inputSchema: page, outputSchema: envelope }, async (input) => withLinks(await call(`/api/v1/proposals${queryString(input)}`)));
  server.registerTool("unw_ingest_rfp", { description: "Stores an RFP or other source document against a proposal. The agent may then extract confirmed requirements from it. Requires proposals:write.", inputSchema: { proposalId: uuid, fileName: z.string().min(1).max(300), mimeType: z.string().max(150).optional(), content: z.string().min(1).max(2_000_000), metadata: z.record(z.string(), z.unknown()).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/source-documents`, { method: "POST", body }), true));
  server.registerTool("unw_extract_rfp_requirements", { description: "Persists agent-confirmed requirements extracted from a proposal source document. Requirements remain unmapped until explicitly mapped through the compliance matrix. Requires proposals:write.", inputSchema: { proposalId: uuid, sourceDocumentId: uuid.optional(), requirements: z.array(z.object({ text: z.string().min(1), requirementType: z.string().min(1).default("deliverable"), sourceReference: z.string().optional(), mandatory: z.boolean().default(false), confidence: z.number().min(0).max(1).default(1), ownerId: uuid.optional(), dueAt: z.string().datetime().nullable().optional() }).strict()).min(1).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/requirements/extract`, { method: "POST", body }), true));
  server.registerTool("unw_analyze_rfp_requirements", { description: "Reads RFP text into proposed requirements, suggests proposal sections, and flags duplicates. Nothing is approved. Requires proposals:write.", inputSchema: { proposalId: uuid, sourceDocumentId: uuid.optional(), content: z.string().min(1).max(2_000_000).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/requirements/analyze`, { method: "POST", body }), true));
  server.registerTool("unw_list_compliance_requirements", { description: "Lists compliance requirements for a proposal. Requires proposals:read.", inputSchema: { proposalId: uuid, status: z.string().optional(), mandatory: z.boolean().optional() }, outputSchema: envelope }, async ({ proposalId, status, mandatory }) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (mandatory !== undefined) query.set("mandatory", String(mandatory));
    return withLinks(await call(`/api/v1/proposals/${proposalId}/requirements${query.size ? `?${query}` : ""}`));
  });
  server.registerTool("unw_update_compliance_requirement", { description: "Corrects a proposed requirement. Set confirmed when a person accepts the wording. Requires proposals:write.", inputSchema: { proposalId: uuid, requirementId: uuid, text: z.string().min(1).optional(), requirementType: z.enum(["deliverable", "qualification", "format", "commercial", "legal", "security", "schedule", "question"]).optional(), sourceReference: z.string().max(300).optional(), mandatory: z.boolean().optional(), priority: z.enum(["low", "normal", "high", "critical"]).optional(), ownerId: uuid.nullable().optional(), dueAt: z.string().datetime().nullable().optional(), confirmed: z.boolean().optional(), reviewNote: z.string().max(2000).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, requirementId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/requirements/${requirementId}`, { method: "PATCH", body }), true));
  server.registerTool("unw_map_requirement_to_section", { description: "Links a requirement to proposal sections. A mapping is not compliance sign-off. Requires proposals:write.", inputSchema: { proposalId: uuid, requirementId: uuid, nodeKeys: z.array(z.string().min(1)).min(1) }, outputSchema: writeEnvelope }, async ({ proposalId, requirementId, nodeKeys }) => withLinks(await call(`/api/v1/proposals/${proposalId}/requirements/${requirementId}/mapping`, { method: "POST", body: { nodeKeys } }), true));
  server.registerTool("unw_add_requirement_evidence", { description: "Attaches a section, attachment, library item, or note as evidence for a requirement. Requires proposals:write.", inputSchema: { proposalId: uuid, requirementId: uuid, kind: z.enum(["section", "attachment", "library", "note"]), ref: z.string().min(1).max(300), note: z.string().max(2000).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, requirementId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/requirements/${requirementId}/evidence`, { method: "POST", body }), true));
  server.registerTool("unw_get_compliance_matrix", { description: "Returns coverage, mandatory gaps, duplicate conflicts, and low-confidence requirements. Read-only. Requires proposals:read.", inputSchema: { proposalId: uuid }, outputSchema: envelope }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/compliance-matrix`)));
  server.registerTool("unw_sign_off_compliance", { description: "Records a staff compliance sign-off. Refuses while any mandatory requirement lacks an accepted mapping. Requires proposals:write.", inputSchema: { proposalId: uuid, note: z.string().max(2000).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, note }) => withLinks(await call(`/api/v1/proposals/${proposalId}/compliance-signoff`, { method: "POST", body: { note } }), true));
  server.registerTool("unw_draft_proposal_section", { description: "Drafts one proposal section from approved library answers that match its requirements. Unmatched requirements stay as named gaps. Nothing is invented. Requires proposals:write.", inputSchema: { proposalId: uuid, nodeKey: z.string().min(1), apply: z.boolean().optional() }, outputSchema: writeEnvelope }, async ({ proposalId, nodeKey, apply }) => withLinks(await call(`/api/v1/proposals/${proposalId}/sections/${encodeURIComponent(nodeKey)}/draft`, { method: "POST", body: { apply: apply ?? true } }), true));
  server.registerTool("unw_create_go_no_go_assessment", { description: "Creates a weighted go/no-go assessment. The score is advisory; recording a final decision is staff-controlled. Requires proposals:write.", inputSchema: { proposalId: uuid, factors: z.array(z.object({ key: z.string().min(1), score: z.number().min(0).max(5), weight: z.number().positive().default(1), evidence: z.string().optional(), ownerId: uuid.optional(), mitigation: z.string().optional() }).strict()).min(1), decision: z.enum(["go", "no_go", "go_with_conditions"]).optional(), rationale: z.string().max(4000).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/go-no-go`, { method: "POST", body }), true));
  server.registerTool("unw_assign_proposal_task", { description: "Assigns a proposal-manager task. side client is the client's side and needs assigneeName. When the person's name is unknown, put the role there, such as NetSuite admin or Credit Mountain data owner, and omit assigneeEmail. Completing a task does not approve a section. Requires proposals:write.", inputSchema: { proposalId: uuid, title: z.string().min(1).max(300), description: z.string().max(4000).optional(), taskType: z.string().min(1).default("proposal"), priority: z.enum(["low", "normal", "high", "critical"]).default("normal"), ownerId: uuid.nullable().optional(), assigneeName: z.string().min(1).max(200).nullable().optional(), assigneeEmail: z.string().email().nullable().optional(), side: z.enum(["us", "client"]).default("us"), sectionKey: z.string().max(100).nullable().optional(), requirementId: uuid.nullable().optional(), dependsOnTaskId: uuid.nullable().optional(), dueAt: z.string().datetime().nullable().optional() }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/tasks`, { method: "POST", body }), true));
  server.registerTool("unw_invite_proposal_guest", { description: "Adds a coworker to the portal so they can view this proposal. Creates their sign-in account when needed. sent is false: this does not email them. They sign in with the usual email link. Requires proposals:write.", inputSchema: { proposalId: uuid, name: z.string().min(1).max(200), email: z.string().email(), taskTitle: z.string().min(1).max(300).optional(), taskDetail: z.string().max(4000).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/guest-invites`, { method: "POST", body }), true));
  server.registerTool("unw_save_proposal_template", { description: "Saves this proposal's sections, written text, phases, roles, and scope as an inactive template. Staff only. It does not publish the template. Requires proposals:write.", inputSchema: { proposalId: uuid, code: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/), name: z.string().min(1).max(200) }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/save-as-template`, { method: "POST", body }), true));
  server.registerTool("unw_list_proposal_tasks", { description: "Lists proposal-manager tasks, including overdue task ids. Requires proposals:read.", inputSchema: { proposalId: uuid, status: z.string().optional() }, outputSchema: envelope }, async ({ proposalId, status }) => withLinks(await call(`/api/v1/proposals/${proposalId}/tasks${status ? `?status=${encodeURIComponent(status)}` : ""}`)));
  server.registerTool("unw_create_compliance_matrix", { description: "Maps extracted requirements to proposal sections and evidence. A mapping is not automatically a human compliance sign-off. Requires proposals:write.", inputSchema: { proposalId: uuid, mappings: z.array(z.object({ requirementId: uuid, nodeKeys: z.array(z.string().min(1)).default([]), evidence: z.array(z.unknown()).default([]), status: z.enum(["unmapped", "in_progress", "addressed", "partially_addressed", "not_applicable", "accepted_risk"]).optional(), reviewNote: z.string().max(2000).optional() }).strict()).min(1) }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/compliance-matrix`, { method: "POST", body }), true));
  server.registerTool("unw_validate_proposal_readiness", { description: "Checks mandatory requirements, blocked tasks, go/no-go status, and pricing approval state before submission. Read-only. Requires proposals:read.", inputSchema: { proposalId: uuid }, outputSchema: envelope }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/readiness`, { method: "POST", body: {} })));
  const libraryItem = { stableKey: z.string().min(1).max(200).optional(), title: z.string().min(1).max(300), category: z.string().min(1).max(100), body: z.unknown(), tags: z.array(z.string()).optional(), clientLabel: z.string().max(200).nullable().optional(), guidance: z.string().max(4000).optional(), visibility: z.enum(["global", "organization", "client"]).optional(), source: z.string().max(300).nullable().optional(), industry: z.string().max(120).nullable().optional(), product: z.string().max(120).nullable().optional(), effectiveFrom: z.string().datetime().nullable().optional(), expiresAt: z.string().datetime().nullable().optional(), changeSummary: z.string().max(1000).optional(), idempotencyKey: z.string().min(1).max(200).optional() };
  server.registerTool("unw_upsert_content_library_item", { description: "Creates a library item or drafts a new version. An approved item stays insertable until the new version is approved. Client visibility requires a client label. Requires proposals:write.", inputSchema: libraryItem, outputSchema: writeEnvelope }, async (body) => withLinks(await call("/api/v1/content-library/items", { method: "POST", body }), true));
  server.registerTool("unw_get_content_library_item", { description: "Loads one library item and its version history. Requires proposals:read.", inputSchema: { itemId: uuid }, outputSchema: envelope }, async ({ itemId }) => withLinks(await call(`/api/v1/content-library/items/${itemId}`)));
  server.registerTool("unw_submit_content_library_item", { description: "Submits the current draft version for staff review. Requires proposals:write.", inputSchema: { itemId: uuid }, outputSchema: writeEnvelope }, async ({ itemId }) => withLinks(await call(`/api/v1/content-library/items/${itemId}/submit`, { method: "POST", body: {} }), true));
  server.registerTool("unw_approve_content_library_item", { description: "Approves or rejects a library version that is in review. Approval is staff-controlled and makes that version the one inserts copy. Requires proposals:write.", inputSchema: { itemId: uuid, decision: z.enum(["approve", "reject"]).optional(), note: z.string().max(1000).optional() }, outputSchema: writeEnvelope }, async ({ itemId, ...body }) => withLinks(await call(`/api/v1/content-library/items/${itemId}/approve`, { method: "POST", body }), true));
  server.registerTool("unw_archive_content_library_item", { description: "Archives a library item so new inserts cannot use it. History is kept. Staff only. Requires proposals:write.", inputSchema: { itemId: uuid }, outputSchema: writeEnvelope }, async ({ itemId }) => withLinks(await call(`/api/v1/content-library/items/${itemId}/archive`, { method: "POST", body: {} }), true));
  server.registerTool("unw_search_content_library", { description: "Searches library content. Callers see approved, non-expired items in their organization or marked global. Each hit includes why it matched and its approval state. Staff may filter by status. Requires proposals:read.", inputSchema: { query: z.string().max(300).optional(), category: z.string().max(100).optional(), clientLabel: z.string().max(200).optional(), industry: z.string().max(120).optional(), product: z.string().max(120).optional(), status: z.enum(["draft", "in_review", "approved", "rejected", "expired", "archived"]).optional(), tags: z.array(z.string()).optional(), limit: z.number().int().min(1).max(100).optional() }, outputSchema: envelope }, async (body) => withLinks(await call("/api/v1/content-library/search", { method: "POST", body })));
  server.registerTool("unw_insert_approved_content", { description: "Copies approved, non-expired library content into one proposal section and returns its provenance. Requires proposals:write.", inputSchema: { proposalId: uuid, itemId: uuid, nodeKey: z.string().min(1) }, outputSchema: writeEnvelope }, async ({ proposalId, itemId, nodeKey }) => withLinks(await call(`/api/v1/proposals/${proposalId}/content-library/insert`, { method: "POST", body: { itemId, nodeKey } }), true));
  server.registerTool("unw_create_scope_baseline", { description: "Creates an immutable versioned scope baseline with items, assumptions, exclusions, and risks. Requires proposals:write.", inputSchema: { proposalId: uuid, items: z.array(z.unknown()).optional(), assumptions: z.array(z.string()).optional(), exclusions: z.array(z.string()).optional(), risks: z.array(z.unknown()).optional(), status: z.enum(["draft", "baseline", "superseded"]).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/scope-baselines`, { method: "POST", body }), true));
  server.registerTool("unw_create_pricing_model", { description: "Creates a versioned proposal pricing model using server-side integer minor-unit calculations. It does not approve discounts or margins. Requires proposals:write.", inputSchema: { proposalId: uuid, currency: z.string().regex(/^[A-Z]{3}$/), lines: z.array(z.object({ label: z.string().min(1), quantity: z.number().nonnegative().default(1), unitPriceMinor: z.number().int().nonnegative(), costMinor: z.number().int().nonnegative().default(0), unit: z.string().default("item") }).strict()).optional(), options: z.array(z.object({ label: z.string().min(1), priceDeltaMinor: z.number().int(), costDeltaMinor: z.number().int().default(0) }).strict()).optional() }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/pricing-models`, { method: "POST", body }), true));
  server.registerTool("unw_validate_commercial_policy", { description: "Validates a proposal pricing model against supplied margin and discount thresholds. Read-only; it does not approve the price. Requires proposals:read.", inputSchema: { proposalId: uuid, pricingModelId: uuid.optional(), minimumMarginPercent: z.number().min(0).max(100).optional(), maximumDiscountPercent: z.number().min(0).max(100).optional() }, outputSchema: envelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/commercial-validation`, { method: "POST", body })));
  server.registerTool("unw_get_pending_client_decisions", { description: "Lists unresolved requirements, open or blocked tasks, undecided go/no-go state, and unapproved pricing that need client or staff attention. Requires proposals:read.", inputSchema: { proposalId: uuid }, outputSchema: envelope }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/pending-decisions`)));
  server.registerTool("unw_compare_proposal_versions", { description: "Compares two proposal versions using the existing review diff engine. Read-only. Requires proposals:read.", inputSchema: { proposalId: uuid, fromVersion: z.number().int().positive(), toVersion: z.number().int().positive() }, outputSchema: envelope }, async ({ proposalId, fromVersion, toVersion }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/diff?from=${fromVersion}&to=${toVersion}`)));
  server.registerTool("unw_create_delivery_project", { description: "Creates a delivery project from a signed contract. The contract and project route enforce staff and organization rules. Requires projects:write.", inputSchema: { contractId: uuid, title: z.string().min(1).max(300), status: z.enum(["planned", "active", "blocked", "complete"]).optional() }, outputSchema: writeEnvelope }, async (body) => withLinks(await call("/api/v1/projects", { method: "POST", body }), true));
  server.registerTool("unw_get_proposal", { description: "Loads one proposal, including its narrative sections when they exist. Requires proposals:read.", inputSchema: { proposalId: uuid }, outputSchema: envelope }, async ({ proposalId }) => {
    const loaded = await call(`/api/v1/proposals/${proposalId}`);
    if (!loaded.ok) return withLinks(loaded);
    const narrative = await call(`/api/v1/proposals/${proposalId}/narrative`);
    const entity = { ...((loaded.entity ?? {}) as Record<string, unknown>), ...(narrative.ok ? { narrative: narrative.entity } : {}) };
    return withLinks({ ...loaded, entity });
  });
  server.registerTool("unw_get_proposal_status", { description: "Loads the status of one proposal: record status, review state, latest version number, whether the approved version is locked, and counts of open review comments and flags. Requires proposals:read.", inputSchema: { proposalId: uuid }, outputSchema: envelope }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/status`)));
  server.registerTool("unw_list_proposal_sections", { description: "Lists the sections on one proposal in display order, each with its key, title, order, kind, and completion status. Requires proposals:read.", inputSchema: { proposalId: uuid }, outputSchema: envelope }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/sections`)));
  server.registerTool("unw_list_proposal_roles", {
    description: "Lists the project roles on a proposal: name, side (unwhelm or client), responsibility, and heaviestIn (phase ids, all, or gates). Requires proposals:read.",
    inputSchema: { proposalId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/roles`)));
  server.registerTool("unw_set_proposal_roles", {
    description: "Replaces the project roles on a proposal. Each role is { name, side: unwhelm|client, responsibility, heaviestIn: phase ids plus all or gates }. Requires proposals:write.",
    inputSchema: {
      proposalId: uuid,
      roles: z.array(z.object({
        name: z.string().min(1).max(200),
        side: z.enum(["unwhelm", "client"]),
        responsibility: z.string().max(2000).default(""),
        heaviestIn: z.array(z.string().min(1).max(80)).default([]),
      }).strict()).max(50),
    },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, roles }) => withLinks(await call(`/api/v1/proposals/${proposalId}/roles`, { method: "PUT", body: { roles } }), true));
  server.registerTool("unw_export_proposal", { description: "Exports one proposal. format json (default) returns the document plus narrative sections, options, and parked items; markdown returns a readable markdown copy; pdf returns the signed-in download URL for the PDF. links.portal and links.pdf are included. Requires proposals:read.", inputSchema: { proposalId: uuid, format: z.enum(["json", "markdown", "pdf"]).optional() }, outputSchema: envelope }, async ({ proposalId, format }) => withLinks(await call(`/api/v1/proposals/${proposalId}/export${queryString({ format })}`)));
  const attachmentFile = { proposalId: uuid, filename: z.string().min(1).max(200), contentBase64: z.string().min(1) };
  server.registerTool("unw_list_proposal_attachments", {
    description: "Lists PDF and Markdown documents stored on a proposal, in display order, without file bytes. Requires proposals:read.",
    inputSchema: { proposalId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/attachments`)));
  server.registerTool("unw_get_proposal_attachment", {
    description: "Returns the signed-in download path for one stored proposal document. GET that path with the same token. Requires proposals:read.",
    inputSchema: { proposalId: uuid, attachmentId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId, attachmentId }) => withLinks({ ok: true, entity: { downloadPath: `/api/v1/proposals/${proposalId}/attachments/${attachmentId}` }, warnings: [], links: {} }));
  server.registerTool("unw_attach_proposal_document", {
    description: "Uploads a new PDF or Markdown file onto a proposal. Filename must end in .pdf or .md. Decoded file may be up to 10 MB, passed as contentBase64. A generated PDF does not fit in this call: you would have to write out the base64 yourself, and you have no token or network path to upload the file from disk. Attach the writeup as .md instead. Fails if that name already exists. Requires proposals:write.",
    inputSchema: attachmentFile,
    outputSchema: writeEnvelope,
  }, async ({ proposalId, filename, contentBase64 }) => withLinks(await call(`/api/v1/proposals/${proposalId}/attachments`, { method: "POST", body: { filename, contentBase64 } }), true));
  server.registerTool("unw_link_proposal_document", {
    description: "Attaches a PDF or Markdown document by https URL instead of file bytes. Staff open the current document at that link. Requires proposals:write.",
    inputSchema: { proposalId: uuid, filename: z.string().min(1).max(200), sourceUrl: z.string().url() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, filename, sourceUrl }) => withLinks(await call(`/api/v1/proposals/${proposalId}/attachments/link`, { method: "POST", body: { filename, sourceUrl } }), true));
  server.registerTool("unw_fetch_proposal_document", {
    description: "Downloads a public https PDF or Markdown file onto the proposal. The link must not be private, local, or a redirect. Use this once the file has a public https URL. Chunked upload is unw_upload_proposal_part, 12000 base64 characters per call. Requires proposals:write.",
    inputSchema: { proposalId: uuid, filename: z.string().min(1).max(200), sourceUrl: z.string().url() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, filename, sourceUrl }) => withLinks(await call(`/api/v1/proposals/${proposalId}/attachments/fetch`, { method: "POST", body: { filename, sourceUrl } }), true));
  server.registerTool("unw_upload_proposal_part", {
    description: "Uploads one small base64 part of a PDF or Markdown file. partIndex starts at 0. Each contentBase64 is at most 12000 characters. The file is stored when every part has arrived. Requires proposals:write.",
    inputSchema: { proposalId: uuid, filename: z.string().min(1).max(200), partIndex: z.number().int().min(0), partCount: z.number().int().min(1).max(2000), contentBase64: z.string().min(1).max(12000) },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/attachments/parts`, { method: "POST", body }), true));
  server.registerTool("unw_upsert_proposal_document", {
    description: "Creates or replaces a PDF or Markdown file on a proposal by filename. Decoded file may be up to 10 MB, passed as contentBase64. A generated PDF does not fit: you would have to write out the base64 yourself. Pass Markdown, or leave the PDF for a person who has the file. Requires proposals:write.",
    inputSchema: attachmentFile,
    outputSchema: writeEnvelope,
  }, async ({ proposalId, filename, contentBase64 }) => withLinks(await call(`/api/v1/proposals/${proposalId}/attachments`, { method: "PUT", body: { filename, contentBase64 } }), true));
  server.registerTool("unw_replace_proposal_attachment", {
    description: "Replaces one stored proposal document by id. Filename may change. Decoded file may be up to 10 MB, passed as contentBase64. A generated PDF does not fit in this call. Pass Markdown, or leave the PDF for a person who has the file. Requires proposals:write.",
    inputSchema: { proposalId: uuid, attachmentId: uuid, filename: z.string().min(1).max(200).optional(), contentBase64: z.string().min(1) },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, attachmentId, filename, contentBase64 }) => withLinks(await call(`/api/v1/proposals/${proposalId}/attachments/${attachmentId}`, { method: "PUT", body: { ...(filename ? { filename } : {}), contentBase64 } }), true));
  server.registerTool("unw_delete_proposal_attachment", {
    description: "Deletes one stored proposal document. Requires proposals:write.",
    inputSchema: { proposalId: uuid, attachmentId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, attachmentId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/attachments/${attachmentId}`, { method: "DELETE" }), true));
  server.registerTool("unw_reorder_proposal_attachments", {
    description: "Sets the display order of every document on a proposal. ids must list each attachment exactly once. Requires proposals:write.",
    inputSchema: { proposalId: uuid, ids: z.array(uuid) },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, ids }) => withLinks(await call(`/api/v1/proposals/${proposalId}/attachments/order`, { method: "PUT", body: { ids } }), true));
  server.registerTool("unw_export_redline", {
    description: "Returns the download path for a Word document with tracked changes between two proposal version numbers. GET that path with the same token. Requires proposals:read.",
    inputSchema: { proposalId: uuid, from: z.number().int().positive(), to: z.number().int().positive() },
    outputSchema: envelope,
  }, async ({ proposalId, from, to }) => withLinks({ ok: true, entity: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", downloadPath: `/api/v1/proposals/${proposalId}/redline?from=${from}&to=${to}` }, warnings: [], links: {} }));
  server.registerTool("unw_list_proposal_views", {
    description: "Summarizes who opened a proposal and which parts they opened. Requires proposals:read.",
    inputSchema: { proposalId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/views`)));
  server.registerTool("unw_add_approval_step", {
    description: "Adds the next person to a proposal's approval chain. Staff only. An empty chain keeps the single staff approval. Requires proposals:write.",
    inputSchema: { proposalId: uuid, label: z.string().min(1).max(120) },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, label }) => withLinks(await call(`/api/v1/proposals/${proposalId}/approval-steps`, { method: "POST", body: { label } }), true));
  server.registerTool("unw_record_approval", {
    description: "Records that one step of the approval chain is done. Staff only. The proposal can be approved only after every step is recorded. Requires proposals:write.",
    inputSchema: { proposalId: uuid, stepId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, stepId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/approvals`, { method: "POST", body: { stepId } }), true));
  server.registerTool("unw_create_proposal", {
    description: `Creates the saved proposal. Call this only after the client agrees to save it in Unwhelm; until then keep the work in the conversation. Requires proposals:write. scope is { summary: string, deliverables: string[] (at least one), assumptions?: string[] (default []), exclusions?: string[] (default []) }. timeline defaults to { startDate: null, targetDate: null, milestones: [] }; each milestone is a phase: title, description, optional dueDate or weekOffset, optional weeksLow/weeksHigh and gate. Actual dates stay empty unless set. weekOffset becomes a due date when startDate is set. The response includes links.portal. ${pricingRules}`,
    inputSchema: {
      title: z.string().min(1).max(300),
      engagement: z.enum(ENGAGEMENT_KINDS),
      scope: z.object({
        summary: z.string().min(1),
        deliverables: z.array(z.string().min(1)).min(1),
        assumptions: z.array(z.string()).default([]),
        exclusions: z.array(z.string()).default([]),
      }).strict(),
      timeline: z.object({
        startDate: z.string().date().nullable().default(null),
        targetDate: z.string().date().nullable().default(null),
        milestones: z.array(z.object({
          id: uuid.optional(),
          title: z.string().min(1),
          description: z.string().default(""),
          dueDate: z.string().date().nullable().optional(),
          weekOffset: z.number().int().min(0).max(520).optional(),
          weeksLow: z.number().int().min(1).max(104).optional(),
          weeksHigh: z.number().int().min(1).max(104).optional(),
          gate: z.string().max(500).optional(),
          actualStart: z.string().date().nullable().optional(),
          actualEnd: z.string().date().nullable().optional(),
        }).strict()).default([]),
      }).strict().default({ startDate: null, targetDate: null, milestones: [] }),
      pricing: StoredPricingSchema,
    },
    outputSchema: writeEnvelope,
  }, async (input) => {
    const paired = StoredEngagementPricingSchema.safeParse({ engagement: input.engagement, pricing: input.pricing });
    if (!paired.success) {
      const message = paired.error.issues.map((issue) => issue.message).join(" ");
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
    return withLinks(await call("/api/v1/proposals", { method: "POST", body: input }), true);
  });
  server.registerTool("unw_update_proposal_section", {
    description: "Updates one proposal section. Requires proposals:write. sectionId scope, timeline (or schedule/dates), pricing, or title PATCHes the proposal. Timeline phases use dueDate or weekOffset plus optional weeksLow, weeksHigh, and gate; send ids back to keep them. endsWeekLow and endsWeekHigh are computed on read and ignored on write. Bad dates are warnings. Any other sectionId is narrative, a string or { text }, and the part moves to drafted. Never put hours or price in narrative text. Same value again: changed false. Approved or locked parts: 409.",
    inputSchema: { proposalId: uuid, sectionId: z.string().min(1).max(100), value: z.unknown() },
    outputSchema: { ...envelope, changed: z.boolean() },
  }, async ({ proposalId, sectionId, value }) => {
    const aliases: Record<string, string> = { schedule: "timeline", dates: "timeline" };
    let field = aliases[sectionId] ?? sectionId;
    let body: unknown = value;
    if (sectionId === "milestones") {
      field = "timeline";
      body = Array.isArray(value) ? { milestones: value } : value;
    }
    if (proposalFields.has(field)) {
      if (field === "timeline" && (body == null || typeof body !== "object" || Array.isArray(body))) {
        return { isError: true, content: [{ type: "text" as const, text: "The timeline section value must be { startDate, targetDate, milestones }." }] };
      }
      const patched = await call(`/api/v1/proposals/${proposalId}`, { method: "PATCH", body: { [field]: body } });
      return withLinks(patched, patched.ok && (patched as { changed?: unknown }).changed !== false);
    }
    // Narrative accepts plain text or { text }, the shape unw_list_proposal_templates shows for narrative samples.
    const text = typeof value === "string" ? value
      : value && typeof value === "object" && !Array.isArray(value) && typeof (value as { text?: unknown }).text === "string" && Object.keys(value).every((key) => key === "text") ? (value as { text: string }).text
      : undefined;
    if (text === undefined) return { isError: true, content: [{ type: "text" as const, text: `The ${sectionId} section value must be text or { text: string }.` }] };
    const written = await call(`/api/v1/proposals/${proposalId}/narrative/${encodeURIComponent(sectionId)}`, { method: "PUT", body: { text } });
    return withLinks(written, written.ok && (written as { changed?: unknown }).changed !== false);
  });

  server.registerTool("unw_list_proposal_templates", { description: "Lists active proposal templates. Each has its parts (nodes), a suggested pricing model, sample content per part (narrative { text }, scope, and schedule milestones with weekOffset from the start date), and optional option packages without prices. Requires proposals:read.", inputSchema: {}, outputSchema: envelope }, async () => withLinks(await call("/api/v1/proposal-templates")));
  server.registerTool("unw_set_proposal_template", { description: "Chooses the template a proposal is built from. On a draft, a different template rebuilds the parts and keeps written text for parts that exist in both; parts the new template lacks are kept as extra parts when they hold written text (listed in keptWritten), so nothing written is lost when switching through another template. The same template again is a no-op and returns changed: false. Locked or non-draft proposals cannot change template. Never sets hours or price. Requires proposals:write.", inputSchema: { proposalId: uuid, code: z.string().min(1).max(100) }, outputSchema: envelope }, async ({ proposalId, code }) => withLinks(await call(`/api/v1/proposals/${proposalId}/template`, { method: "PUT", body: { code } }), true));
  server.registerTool("unw_list_section_library", { description: "Lists the reusable proposal sections in the section library (such as security, training, data_migration, integrations, app_release, ai_evaluation), each with its title, client label, guidance, and length limits. Read-only. Requires proposals:read.", inputSchema: {}, outputSchema: envelope }, async () => withLinks(await call("/api/v1/proposal-section-library")));
  server.registerTool("unw_list_guidance_events", { description: "Lists recent guidance-playbook turns for a proposal: the signals computed, which rules fired, the suggested moves and their client phrases, and the action taken when one was recorded. Read-only. Never sets hours or price. Requires proposals:read.", inputSchema: { proposalId: uuid, limit: z.number().int().min(1).max(50).optional() }, outputSchema: envelope }, async ({ proposalId, limit }) => withLinks(await call(`/api/v1/proposals/${proposalId}/guidance-events${limit ? `?limit=${limit}` : ""}`)));
  server.registerTool("unw_find_guidance_cases", { description: "Finds staff-approved past cases that resemble this proposal's current situation: what was going on, what the agent did, the lesson, and whether it worked or should be avoided. Use them as examples, not scripts. Optional move narrows to cases about one move. Read-only; never sets hours or price. Requires proposals:read.", inputSchema: { proposalId: uuid, move: z.string().min(1).max(100).optional(), limit: z.number().int().min(1).max(20).optional() }, outputSchema: envelope }, async ({ proposalId, move, limit }) => {
    const query = new URLSearchParams();
    if (move) query.set("move", move);
    if (limit) query.set("limit", String(limit));
    const suffix = query.toString() ? `?${query}` : "";
    return withLinks(await call(`/api/v1/proposals/${proposalId}/guidance-cases${suffix}`));
  });
  server.registerTool("unw_create_custom_section", { description: "Creates a proposal section that is not in the library, with its own title, guidance, and character limit. Use this for a topic such as data governance, reconciliation, or an architecture baseline. A key already on the proposal is left as it is. Requires proposals:write.", inputSchema: { proposalId: uuid, key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/), title: z.string().min(1).max(120), guidance: z.string().min(1).max(2000), maxChars: z.number().int().min(100).max(20000) }, outputSchema: writeEnvelope }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/custom-sections`, { method: "POST", body }), true));
  server.registerTool("unw_add_proposal_section", { description: "Adds one section from the section library to a proposal as a new open part. Adding a section the proposal already has is a no-op, so retries are safe. Never sets hours or price. Requires proposals:write.", inputSchema: { proposalId: uuid, nodeKey: z.string().min(1).max(100) }, outputSchema: envelope }, async ({ proposalId, nodeKey }) => {
    const result = await call(`/api/v1/proposals/${proposalId}/sections`, { method: "POST", body: { nodeKey } });
    // A repeat add is a no-op on the API; report changed:false explicitly instead of claiming a change.
    return withLinks(result, (result as { changed?: unknown }).changed !== false);
  });
  server.registerTool("unw_remove_proposal_section", { description: "Removes one section (part) from a proposal. Removing a section the proposal no longer has is a no-op, so retries are safe. Locked sections and sections with sub-parts are refused. Never sets hours or price. Requires proposals:write.", inputSchema: { proposalId: uuid, nodeKey: z.string().min(1).max(64) }, outputSchema: envelope }, async ({ proposalId, nodeKey }) => {
    const result = await call(`/api/v1/proposals/${proposalId}/sections/${encodeURIComponent(nodeKey)}`, { method: "DELETE" });
    return withLinks(result, (result as { changed?: unknown }).changed !== false);
  });
  server.registerTool("unw_reorder_proposal_sections", { description: "Reorders a proposal's sections. The listed keys move to the front in that order and the rest keep their order after them. Give parentKey to reorder sub-parts of one section; omit it for top-level parts. Returns the new order. Never sets hours or price. Requires proposals:write.", inputSchema: { proposalId: uuid, keys: z.array(z.string().min(1).max(64)).min(1).max(100), parentKey: z.string().min(1).max(64).optional() }, outputSchema: envelope }, async ({ proposalId, keys, parentKey }) => {
    const result = await call(`/api/v1/proposals/${proposalId}/section-order`, { method: "PUT", body: parentKey ? { keys, parentKey } : { keys } });
    return withLinks(result, (result as { changed?: unknown }).changed !== false);
  });
  server.registerTool("unw_review_proposal", { description: "Reviews a proposal's narrative sections against review rules stored in the database and returns structured feedback: an overall score (0-100), ready sections out of total, and per section a score, issues, and suggestions. Read-only; it never changes the proposal or sets hours or price. Requires proposals:read.", inputSchema: { proposalId: uuid }, outputSchema: envelope }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review-feedback`)));

  server.registerTool("unw_create_chat_session", {
    description: "Creates a persisted Unwhelm chat session through the API and PostgreSQL database.",
    inputSchema: { agent: z.enum(["proposal", "contract", "project_manager"]).optional(), proposalId: uuid.nullable().optional() },
    outputSchema: writeEnvelope,
  }, async ({ agent, proposalId }) => withLinks(await call("/api/v1/chat/sessions", { method: "POST", body: { agent: agent ?? "proposal", proposalId: proposalId ?? null } }), true));
  server.registerTool("unw_list_chat_sessions", { description: "Lists chat sessions for the authenticated user.", inputSchema: { ...page, agent: z.enum(["proposal", "contract", "project_manager"]).optional() }, outputSchema: envelope }, async (input) => withLinks(await call(`/api/v1/chat/sessions${queryString(input)}`)));
  server.registerTool("unw_list_chat_messages", { description: "Lists messages in a chat session.", inputSchema: { sessionId: uuid, ...page }, outputSchema: envelope }, async ({ sessionId, cursor, limit }) => withLinks(await call(`/api/v1/chat/sessions/${sessionId}/messages${queryString({ cursor, limit })}`)));
  server.registerTool("unw_send_chat_message", {
    description: "Posts a user message to a chat session and returns the stored assistant reply. Requires proposals:write.",
    inputSchema: { sessionId: uuid, content: z.string().min(1).max(4000) },
    outputSchema: writeEnvelope,
  }, async ({ sessionId, content }) => withLinks(await call(`/api/v1/chat/sessions/${sessionId}/messages`, { method: "POST", body: { role: "user", content } }), true));

  server.registerTool("unw_list_projects", { description: "Lists projects visible to the bearer token. Requires projects:read.", inputSchema: page, outputSchema: envelope }, async (input) => withLinks(await call(`/api/v1/projects${queryString(input)}`)));
  server.registerTool("unw_get_project", { description: "Loads one project. Requires projects:read.", inputSchema: { projectId: uuid }, outputSchema: envelope }, async ({ projectId }) => withLinks(await call(`/api/v1/projects/${projectId}`)));

  server.registerTool("unw_sign_contract", {
    description: `Records an in-portal signature through POST /api/v1/contracts/:id/sign. Requires contracts:write. A client may sign only a contract they are a party to. This does not send SignWell or PandaDoc. Hosted signing is unw_send_esign. ${billingDefaults}`,
    inputSchema: { contractId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ contractId }) => withLinks(await call(`/api/v1/contracts/${contractId}/sign`, { method: "POST", body: {} }), true));
  server.registerTool("unw_send_esign", {
    description: "Sends the locked contract PDF to the configured hosted signer (SignWell or PandaDoc, one at a time, chosen by UNWH_ESIGN_PROVIDER on the server). Requires contracts:write and staff. A repeat send for the same contract is a no-op. Returns 404 when hosted signing is off.",
    inputSchema: { contractId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ contractId }) => withLinks(await call(`/api/v1/contracts/${contractId}/esign/send`, { method: "POST", body: {} }), true));
  server.registerTool("unw_get_esign_status", {
    description: "Loads hosted-signing status for one contract through GET /api/v1/contracts/:id/esign/status. provider is signwell or pandadoc. Requires contracts:read and staff.",
    inputSchema: { contractId: uuid },
    outputSchema: envelope,
  }, async ({ contractId }) => withLinks(await call(`/api/v1/contracts/${contractId}/esign/status`)));
  server.registerTool("unw_cancel_esign", {
    description: "Cancels the open hosted signature request (SignWell or PandaDoc) through POST /api/v1/contracts/:id/esign/cancel. Requires contracts:write and staff. Does not unsign a contract already signed in the portal.",
    inputSchema: { contractId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ contractId }) => withLinks(await call(`/api/v1/contracts/${contractId}/esign/cancel`, { method: "POST", body: {} }), true));
  server.registerTool("unw_get_billing_schedule", {
    description: "Loads the billing schedule for one contract through GET /api/v1/contracts/:id/billing. Requires billing:read.",
    inputSchema: { contractId: uuid },
    outputSchema: envelope,
  }, async ({ contractId }) => withLinks(await call(`/api/v1/contracts/${contractId}/billing`)));
  server.registerTool("unw_list_invoices", {
    description: "Lists invoices visible to the bearer token through GET /api/v1/invoices. Requires billing:read.",
    inputSchema: page,
    outputSchema: envelope,
  }, async (input) => withLinks(await call(`/api/v1/invoices${queryString(input)}`)));
  server.registerTool("unw_get_invoice", {
    description: "Loads one invoice through GET /api/v1/invoices/:id. Requires billing:read.",
    inputSchema: { invoiceId: uuid },
    outputSchema: envelope,
  }, async ({ invoiceId }) => withLinks(await call(`/api/v1/invoices/${invoiceId}`)));

  const invoiceWrite = "Requires billing:write. The call records invoice status only and does not charge a payment processor.";
  server.registerTool("unw_create_invoice", {
    description: `Creates a draft invoice through POST /api/v1/invoices. ${invoiceWrite}`,
    inputSchema: {
      contractId: uuid,
      amount: z.object({ amountMinor: z.number().int().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
      dueDate: z.string().date(),
      entryIds: z.array(uuid).max(100).optional(),
    },
    outputSchema: writeEnvelope,
  }, async (input) => withLinks(await call("/api/v1/invoices", { method: "POST", body: input }), true));
  server.registerTool("unw_send_invoice", {
    description: `Sends a draft invoice through POST /api/v1/invoices/:id/send. ${invoiceWrite}`,
    inputSchema: { invoiceId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ invoiceId }) => withLinks(await call(`/api/v1/invoices/${invoiceId}/send`, { method: "POST", body: {} }), true));
  server.registerTool("unw_pay_invoice", {
    description: `Marks a sent invoice paid through POST /api/v1/invoices/:id/pay. ${invoiceWrite}`,
    inputSchema: { invoiceId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ invoiceId }) => withLinks(await call(`/api/v1/invoices/${invoiceId}/pay`, { method: "POST", body: {} }), true));
  server.registerTool("unw_charge_invoice", {
    description: "Charges a sent invoice through the configured payment processor, then marks it paid. paymentMethodId is a processor id such as pm_card, never a card number. Requires billing:write and STRIPE_SECRET_KEY.",
    inputSchema: { invoiceId: uuid, paymentMethodId: z.string().min(1).max(80) },
    outputSchema: writeEnvelope,
  }, async ({ invoiceId, paymentMethodId }) => withLinks(await call(`/api/v1/invoices/${invoiceId}/charge`, { method: "POST", body: { paymentMethodId } }), true));
  server.registerTool("unw_log_hours", {
    description: "Logs hours on a contract through POST /api/v1/contracts/:id/time-entries. Requires billing:write. The hour cap and rate are the contract catalog price tier. An entry that would pass the cap is rejected.",
    inputSchema: {
      contractId: uuid,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      hours: z.number().positive().max(24),
      description: z.string().min(1).max(2000),
      billable: z.boolean().optional(),
    },
    outputSchema: writeEnvelope,
  }, async ({ contractId, ...body }) => withLinks(await call(`/api/v1/contracts/${contractId}/time-entries`, { method: "POST", body }), true));
  server.registerTool("unw_list_hours", {
    description: "Lists time entries on a contract through GET /api/v1/contracts/:id/time-entries. Requires billing:read.",
    inputSchema: { contractId: uuid },
    outputSchema: envelope,
  }, async ({ contractId }) => withLinks(await call(`/api/v1/contracts/${contractId}/time-entries`)));
  server.registerTool("unw_remaining_hours", {
    description: "Returns the catalog hour cap, hours logged, hours remaining, and the catalog rate through GET /api/v1/contracts/:id/hours-remaining. Requires billing:read.",
    inputSchema: { contractId: uuid },
    outputSchema: envelope,
  }, async ({ contractId }) => withLinks(await call(`/api/v1/contracts/${contractId}/hours-remaining`)));
  server.registerTool("unw_invoice_hours", {
    description: "Creates a draft invoice from unbilled billable hours in a date range through POST /api/v1/contracts/:id/invoice-hours. Requires billing:write. The rate is the contract catalog price tier and the invoice status and due date follow invoice_policy. Does not charge a payment processor.",
    inputSchema: { contractId: uuid, from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
    outputSchema: writeEnvelope,
  }, async ({ contractId, from, to }) => withLinks(await call(`/api/v1/contracts/${contractId}/invoice-hours`, { method: "POST", body: { from, to } }), true));

  server.registerTool("unw_list_credits", {
    description: "Lists Workflow Check credits for the caller's organization through GET /api/v1/credits. Staff only. Requires billing:read. Each credit records when it was issued, when it expires, its amount, and when it was redeemed.",
    inputSchema: {},
    outputSchema: envelope,
  }, async () => withLinks(await call("/api/v1/credits")));
  server.registerTool("unw_apply_credit", {
    description: "Applies one unexpired Workflow Check credit to a draft or sent invoice through POST /api/v1/credits/:id/apply. Staff only. Requires billing:write. The credit becomes a negative line and cannot be applied twice or after it expires.",
    inputSchema: { creditId: uuid, invoiceId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ creditId, invoiceId }) => withLinks(await call(`/api/v1/credits/${creditId}/apply`, { method: "POST", body: { invoiceId } }), true));

  server.registerTool("unw_void_invoice", {
    description: `Voids an unpaid invoice through POST /api/v1/invoices/:id/void. ${invoiceWrite}`,
    inputSchema: { invoiceId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ invoiceId }) => withLinks(await call(`/api/v1/invoices/${invoiceId}/void`, { method: "POST", body: {} }), true));

  const adminScope = "Requires the admin permission.";
  const memberRole = z.enum(["prospect", "client", "staff"]);
  server.registerTool("unw_admin_list_users", { description: `Lists users with their organization (org) and every membership. ${adminScope}`, inputSchema: {}, outputSchema: envelope }, async () => withLinks(await call("/api/v1/admin/users")));
  server.registerTool("unw_admin_create_user", { description: `Creates a user. Pass orgId to join an existing organization, or orgName to join the organization with that name (created if missing). role defaults to the configured default (client). Without an org the user gets 403 ORG_REQUIRED on billing and project routes. Audit-logged. ${adminScope}`, inputSchema: { email: z.string().email(), name: z.string().min(1).max(200), orgId: uuid.optional(), orgName: z.string().min(1).max(200).optional(), role: memberRole.optional() }, outputSchema: writeEnvelope }, async (input) => withLinks(await call("/api/v1/admin/users", { method: "POST", body: input }), true));
  server.registerTool("unw_admin_list_orgs", { description: `Lists organizations and their members. ${adminScope}`, inputSchema: {}, outputSchema: envelope }, async () => withLinks(await call("/api/v1/admin/orgs")));
  server.registerTool("unw_admin_create_org", { description: `Creates a client organization. Audit-logged. ${adminScope}`, inputSchema: { name: z.string().min(1).max(200) }, outputSchema: writeEnvelope }, async ({ name }) => withLinks(await call("/api/v1/admin/orgs", { method: "POST", body: { name } }), true));
  server.registerTool("unw_admin_add_org_member", { description: `Adds a user to an organization with an active membership, or updates the role of an existing one. role defaults to client. Audit-logged. ${adminScope}`, inputSchema: { orgId: uuid, userId: uuid, role: memberRole.optional() }, outputSchema: writeEnvelope }, async ({ orgId, userId, role }) => withLinks(await call(`/api/v1/admin/orgs/${orgId}/members`, { method: "POST", body: role ? { userId, role } : { userId } }), true));
  server.registerTool("unw_admin_list_scope_presets", { description: `Lists token scope presets such as client. ${adminScope}`, inputSchema: {}, outputSchema: envelope }, async () => withLinks(await call("/api/v1/admin/scope-presets")));
  server.registerTool("unw_admin_mint_magic_link", { description: `Mints a sign-in link. ${adminScope} A bearer caller receives the expiry, and the link itself is shown once on /admin.`, inputSchema: { userId: uuid }, outputSchema: writeEnvelope }, async ({ userId }) => withLinks(await call(`/api/v1/admin/users/${userId}/magic-link`, { method: "POST" }), true));
  server.registerTool("unw_admin_list_tokens", { description: `Lists API tokens. ${adminScope}`, inputSchema: {}, outputSchema: envelope }, async () => withLinks(await call("/api/v1/admin/tokens")));
  server.registerTool("unw_admin_mint_token", { description: `Mints an API token from scopes, a preset (e.g. preset: "client"), or both. ${adminScope} A bearer caller receives the expiry, and the token itself is shown once on /admin.`, inputSchema: { userId: uuid, name: z.string().min(1).max(200), scopes: z.array(z.enum(MCP_SCOPES)).min(1).optional(), preset: z.string().min(1).max(100).optional().describe("Scope preset code, e.g. client (proposals:read, proposals:write, contracts:write, billing:read, projects:read). Combined with scopes if both are given."), expiresInDays: z.number().int().min(1).max(365).optional() }, outputSchema: writeEnvelope }, async (input) => withLinks(await call("/api/v1/admin/tokens", { method: "POST", body: input }), true));
  server.registerTool("unw_admin_delete_proposal", { description: `Deletes a proposal and its review, version, completion and option rows in one transaction. Refused if a contract references it. Audit-logged. ${adminScope}`, inputSchema: { proposalId: uuid }, outputSchema: writeEnvelope }, async ({ proposalId }) => withLinks(await call(`/api/v1/admin/proposals/${proposalId}`, { method: "DELETE" }), true));
  server.registerTool("unw_list_follow_up_queue", {
    description: "Lists proposals that need staff action, most urgent first: submitted and waiting on agent review, waiting on staff review, resubmitted, changes requested, review meeting scheduled, and proposals with parked items from the completion tree. Each entry lists its reasons and scores; reasons and weights are rows in follow_up_reason. Proposals do not expire, so a near-expiry reason does not match. Staff only. Requires proposals:read.",
    inputSchema: { limit: z.number().int().min(1).max(500).optional() },
    outputSchema: envelope,
  }, async ({ limit }) => withLinks(await call(`/api/v1/admin/follow-up-queue${limit ? `?limit=${limit}` : ""}`)));
  server.registerTool("unw_admin_delete_mcp_client", { description: `Deletes one registered MCP client (by its row id from GET /auth/mcp/clients) and every token it issued. ${adminScope}`, inputSchema: { clientId: uuid }, outputSchema: writeEnvelope }, async ({ clientId }) => withLinks(await call(`/api/v1/auth/mcp/clients/${clientId}`, { method: "DELETE" }), true));
  server.registerTool("unw_admin_prune_mcp_clients", { description: `Removes self-registered MCP clients that never received a token and are older than the configured unused-client TTL (mcp_client_setting). Staff-created and demo clients are kept. ${adminScope}`, inputSchema: {}, outputSchema: writeEnvelope, annotations: { destructiveHint: true } }, async () => withLinks(await call("/api/v1/auth/mcp/clients/prune", { method: "POST" }), true));
  server.registerTool("unw_admin_revoke_token", { description: `Revokes an API token. ${adminScope}`, inputSchema: { tokenId: uuid }, outputSchema: writeEnvelope   }, async ({ tokenId }) => withLinks(await call(`/api/v1/admin/tokens/${tokenId}`, { method: "DELETE" }), true));

  const catalogWrite = "Requires catalog:write. Published catalog versions are immutable. Edits happen on a draft cloned from the active version, and publish closes the previous version. Signed contracts keep the entries and catalog version from when they were signed. New proposals use the published catalog.";
  server.registerTool("unw_get_catalog", {
    description: "Loads the published catalog through GET /api/v1/catalog. No scope is required. This does not return the open draft; use unw_get_catalog_draft for the editor view.",
    inputSchema: {},
    outputSchema: envelope,
  }, async () => withLinks(await call("/api/v1/catalog")));
  server.registerTool("unw_get_catalog_draft", {
    description: `Loads the active catalog and the open draft through GET /api/v1/catalog/editor. ${catalogWrite}`,
    inputSchema: {},
    outputSchema: envelope,
  }, async () => withLinks(await call("/api/v1/catalog/editor")));
  server.registerTool("unw_create_catalog_draft", {
    description: `Clones the active catalog into a draft through POST /api/v1/catalog/drafts. ${catalogWrite}`,
    inputSchema: {},
    outputSchema: writeEnvelope,
  }, async () => withLinks(await call("/api/v1/catalog/drafts", { method: "POST", body: {} }), true));
  server.registerTool("unw_update_price_tier", {
    description: `Updates one draft price tier through PATCH /api/v1/catalog/drafts/:versionId/price-tiers/:code. ${catalogWrite}`,
    inputSchema: {
      versionId: uuid,
      code: z.string().min(1).max(80),
      amountMinor: z.number().int().nonnegative().optional(),
      hours: z.number().int().positive().nullable().optional(),
      minAmountMinor: z.number().int().nonnegative().nullable().optional(),
      currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    },
    outputSchema: writeEnvelope,
  }, async ({ versionId, code, ...patch }) => withLinks(await call(`/api/v1/catalog/drafts/${versionId}/price-tiers/${encodeURIComponent(code)}`, { method: "PATCH", body: patch }), true));
  server.registerTool("unw_update_billing_schedule_line", {
    description: `Updates one draft billing schedule line through PATCH /api/v1/catalog/drafts/:versionId/billing-schedule-lines/:lineId. ${catalogWrite}`,
    inputSchema: {
      versionId: uuid,
      lineId: uuid,
      sortOrder: z.number().int().positive().optional(),
      label: z.string().min(1).max(300).optional(),
      trigger: z.enum(["contract_signed", "milestone_accepted", "manual"]).optional(),
      percentBasis: z.number().int().nonnegative().optional(),
      amountMinor: z.number().int().nonnegative().nullable().optional(),
      amountRule: z.enum(["percent_of_total", "zero"]).optional(),
      dueOffsetDays: z.number().int().nullable().optional(),
    },
    outputSchema: writeEnvelope,
  }, async ({ versionId, lineId, ...patch }) => withLinks(await call(`/api/v1/catalog/drafts/${versionId}/billing-schedule-lines/${lineId}`, { method: "PATCH", body: patch }), true));
  server.registerTool("unw_update_invoice_policy", {
    description: `Updates the draft invoice policy through PATCH /api/v1/catalog/drafts/:versionId/invoice-policy. ${catalogWrite}`,
    inputSchema: {
      versionId: uuid,
      signingDueOffsetDays: z.number().int().nonnegative().optional(),
      milestoneDueOffsetDays: z.number().int().nonnegative().optional(),
      preferMilestoneDueDate: z.boolean().optional(),
      initialStatus: z.enum(["draft", "sent", "paid", "void"]).optional(),
      unscopedRemainderRule: z.literal("sole_or_final_milestone").optional(),
      retainagePolicy: z.literal("add_on_accept").optional(),
      invoiceOnSign: z.boolean().optional(),
    },
    outputSchema: writeEnvelope,
  }, async ({ versionId, ...patch }) => withLinks(await call(`/api/v1/catalog/drafts/${versionId}/invoice-policy`, { method: "PATCH", body: patch }), true));
  server.registerTool("unw_publish_catalog", {
    description: `Validates a draft and publishes it through POST /api/v1/catalog/drafts/:versionId/publish. Sets effective_from, closes the previous version's effective_to, and reloads the catalog cache. ${catalogWrite}`,
    inputSchema: { versionId: uuid, effectiveFrom: z.string().datetime().optional() },
    outputSchema: writeEnvelope,
  }, async ({ versionId, effectiveFrom }) => withLinks(await call(`/api/v1/catalog/drafts/${versionId}/publish`, { method: "POST", body: effectiveFrom ? { effectiveFrom } : {} }), true));

  const reviewTarget = z.enum(["proposal", "section", "field", "scope", "milestone", "pricing_line", "option"]);
  server.registerTool("unw_list_consult_offerings", {
    description: "Lists active consult offerings (the free consult): label, description, price, duration, and per-client limit. All of these are rows in consult_offering. No scope is required.",
    inputSchema: {},
    outputSchema: envelope,
  }, async () => withLinks(await call("/api/v1/consult-offerings")));
  server.registerTool("unw_request_free_consult", {
    description: "Records a free consult intake and creates a draft proposal for it. Send only the topic and details; the price and pricing model come from the offering row and cannot be set here. Each client gets the configured number of free consults. Scheduling is not handled here. Requires proposals:write.",
    inputSchema: { topic: z.string().min(1).max(200), details: z.string().max(4000).optional(), offeringCode: z.string().min(1).max(80).optional() },
    outputSchema: writeEnvelope,
  }, async (body) => withLinks(await call("/api/v1/consult-intakes", { method: "POST", body }), true));
  server.registerTool("unw_list_consult_intakes", {
    description: "Lists consult intakes visible to the caller, with their draft proposal ids. Staff see all. Requires proposals:read.",
    inputSchema: {},
    outputSchema: envelope,
  }, async () => withLinks(await call("/api/v1/consult-intakes")));
  server.registerTool("unw_list_payment_terms", {
    description: "Lists payment terms such as net 15 and net 30. Requires billing:read. The default term is the one seeded with isDefault.",
    inputSchema: {},
    outputSchema: envelope,
  }, async () => withLinks(await call("/api/v1/payment-terms")));
  server.registerTool("unw_set_contract_billing_terms", {
    description: "Sets a contract's payment term and retainage percent. percent basis uses 1000000 as 100%. Requires contracts:write and staff membership. Does not set prices.",
    inputSchema: { contractId: uuid, paymentTermId: uuid.optional(), retainagePercentBasis: z.number().int().min(0).max(1_000_000).optional() },
    outputSchema: writeEnvelope,
  }, async ({ contractId, ...body }) => withLinks(await call(`/api/v1/contracts/${contractId}/billing-terms`, { method: "PATCH", body }), true));
  server.registerTool("unw_release_retainage", {
    description: "Releases retainage withheld on a contract as an explicit invoice. Requires contracts:write and staff membership. A second call returns the same release invoice.",
    inputSchema: { contractId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ contractId }) => withLinks(await call(`/api/v1/contracts/${contractId}/retainage/release`, { method: "POST", body: {} }), true));
  server.registerTool("unw_select_proposal_options", {
    description: "Selects optional lines and packages a staff member already priced. Single-select groups keep one line. Required lines stay selected. Every id must be a priced option on this proposal; unknown ids are rejected (400), and a proposal whose template packages are not priced yet answers 409 NO_PRICED_OPTIONS. Selecting what is already selected returns changed: false. This tool cannot set or change prices. After the proposal version is locked, the first call returns the completion-tree impact preview and does not save; pass apply true to save and reopen downstream nodes. Requires proposals:write.",
    inputSchema: { proposalId: uuid, optionIds: z.array(uuid), apply: z.boolean().optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, optionIds, apply }) => withLinks(await call(`/api/v1/proposals/${proposalId}/options/selection`, { method: "POST", body: { optionIds, apply } }), true));
  server.registerTool("unw_preview_commitment", {
    description: "Previews the contract terms and first invoice that accept would create. dryRun is true. It does not accept the proposal, sign a contract, or create an invoice. Requires proposals:read.",
    inputSchema: { proposalId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/commitment-preview`)));
  server.registerTool("unw_accept_proposal", {
    description: "Accepts the locked approved proposal version. Creates the contract from that snapshot and the first invoice from the catalog first-invoice rule for its one pricing model. Applies an open Workflow Check credit when the rule allows it. Repeating the call returns the same contract and invoice. Requires proposals:write.",
    inputSchema: { proposalId: uuid, terms: z.string().min(1).max(4000).optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, terms }) => withLinks(await call(`/api/v1/proposals/${proposalId}/accept`, { method: "POST", body: terms ? { terms } : {} }), true));
  server.registerTool("unw_get_proposal_expiry", {
    description: "Reports that a proposal does not expire. validUntil is null and state is none, even if a deadline was stored earlier. Requires proposals:read.",
    inputSchema: { proposalId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/expiry`)));
  server.registerTool("unw_extend_proposal_expiry", {
    description: "Clears any stored proposal deadline. Proposals do not expire, so this does not set a new date. days is accepted and ignored. Staff only. Audit-logged when a date is removed. Requires proposals:write.",
    inputSchema: { proposalId: uuid, days: z.number().int().positive().optional(), reason: z.string().min(1).max(500).optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/expiry/extend`, { method: "POST", body }), true));
  server.registerTool("unw_submit_proposal_for_review", {
    description: "Submits a draft proposal into agent review. Requires proposals:write. Runs the unbounded check and stores a version snapshot. After staff requested changes, the same call resubmits the revision. Open-ended words in scope exclusions are not flagged. The agent does not set hours or price.",
    inputSchema: { proposalId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/transition`, { method: "POST", body: { to: "agent_review" }, headers: { "x-unw-review-actor": "agent" } }), true));
  server.registerTool("unw_add_review_comment", {
    description: "Posts a review comment or reply on a proposal, section, or field. Requires proposals:write. visibility is internal or client. Internal comments are hidden from client callers. targetId is required for section (a part key from unw_list_proposal_sections), field (a path such as scope.summary or scope.deliverables[0]), milestone (a milestone id), option (an option id), and pricing_line, and must exist on the proposal. A reply (parentId) keeps its parent's target, so leave targetKind and targetId out. Format body as plain text a person can scan: one short paragraph per point, separated by a blank line. Put the ask in the first paragraph. Put numbers, ranges, and options on their own lines, one item per line, starting each line with \"- \". Do not send one unbroken paragraph.",
    inputSchema: { proposalId: uuid, body: z.string().min(1).describe("Plain text. First paragraph is the ask. Then a blank line between points. One number, range, or option per line, each line starting with \"- \". Never one unbroken paragraph."), type: z.enum(REVIEW_COMMENT_TYPES).describe(`Comment type: one of ${REVIEW_COMMENT_TYPES.join(", ")}. needs_bounding blocks approval until resolved.`), visibility: z.enum(["client", "internal"]).default("client"), targetKind: reviewTarget.optional().describe("Defaults to proposal on a new comment; replies inherit the parent's target."), targetId: z.string().min(1).optional(), parentId: uuid.optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/comments`, { method: "POST", body, headers: { "x-unw-review-actor": "agent" } }), true));
  server.registerTool("unw_list_review_feedback", {
    description: "Lists review state, comments, and flags visible to the caller. Requires proposals:read. Client callers do not receive internal comments or flags.",
    inputSchema: { proposalId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review`)));
  server.registerTool("unw_resolve_review_comment", {
    description: "Resolves one review comment. Requires proposals:write. Staff and the agent may resolve. Clients may not.",
    inputSchema: { proposalId: uuid, commentId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, commentId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/comments/${commentId}/resolve`, { method: "POST", body: {}, headers: { "x-unw-review-actor": "agent" } }), true));
  server.registerTool("unw_open_change_item", {
    description: "Records a pushback deadline, a formal pushback, or a change request. Each names the approver. Omit dueAt when the deadline date is not known yet; pass itemId later with dueAt to set it. This does not approve the change. Requires proposals:write.",
    inputSchema: { proposalId: uuid, itemId: uuid.optional(), kind: z.enum(["pushback_deadline", "pushback", "change_request"]).optional(), summary: z.string().min(1).max(300).optional(), detail: z.string().max(4000).optional(), approverName: z.string().min(1).max(200).optional(), dueAt: z.string().datetime().nullable().optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, itemId, ...body }) => withLinks(itemId
    ? await call(`/api/v1/proposals/${proposalId}/change-items/${itemId}`, { method: "PATCH", body: { dueAt: body.dueAt ?? null, ...(body.approverName ? { approverName: body.approverName } : {}) } })
    : await call(`/api/v1/proposals/${proposalId}/change-items`, { method: "POST", body }), true));
  server.registerTool("unw_list_change_items", {
    description: "Lists pushback deadlines, formal pushbacks, and change requests for a proposal, including who decided. Requires proposals:read.",
    inputSchema: { proposalId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/change-items`)));
  server.registerTool("unw_decide_change_item", {
    description: "Records the approver decision on an open pushback or change request: approved or declined. A deadline is not decided. Requires proposals:write.",
    inputSchema: { proposalId: uuid, itemId: uuid, decision: z.enum(["approved", "declined"]), note: z.string().max(2000).optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, itemId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/change-items/${itemId}/decision`, { method: "POST", body }), true));
  server.registerTool("unw_update_review_comment", {
    description: "Rewrites the caller's own open review comment, or supersedes it with a new comment and leaves the old one in place. Someone else's comment is refused. Requires proposals:write.",
    inputSchema: { proposalId: uuid, commentId: uuid, body: z.string().min(1), supersede: z.boolean().optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, commentId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/comments/${commentId}`, { method: "PATCH", body, headers: { "x-unw-review-actor": "agent" } }), true));
  server.registerTool("unw_set_phase_estimate", {
    description: "Sets hour and week estimate ranges on existing phases. Pass total once for the whole engagement and the phase ids in order; the server splits that range so the phases add up to it. Remainder goes on the later phases. Per-phase numbers still work when total is omitted. kind is estimate. This does not set staff-committed Hours or the price. Requires proposals:write.",
    inputSchema: { proposalId: uuid, phases: z.array(z.object({ milestoneId: uuid, hoursLow: z.number().int().min(0).optional(), hoursHigh: z.number().int().min(0).optional(), weeksLow: z.number().int().min(1).optional(), weeksHigh: z.number().int().min(1).optional() }).strict()).min(1), total: z.object({ hoursLow: z.number().int().min(0), hoursHigh: z.number().int().min(0), weeksLow: z.number().int().min(1), weeksHigh: z.number().int().min(1) }).strict().optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, phases, total }) => withLinks(await call(`/api/v1/proposals/${proposalId}/phase-estimates`, { method: "POST", body: { phases, ...(total ? { total } : {}) } }), true));
  server.registerTool("unw_review_decision", {
    description: "Staff review decision: approve, reject, or request_changes. Requires proposals:write and a staff membership. Decisions are made from staff review (in_review) or a scheduled review call; move a proposal from agent review or a resubmission into staff review with unw_start_staff_review first. Reject and request_changes require a comment. Reject also requires a reason code (budget, timing, scope, chose_other, other). Approval is refused while a blocking flag is open; resolve flags with unw_resolve_review_flag. A refused decision lists the transitions open from the current state.",
    inputSchema: { proposalId: uuid, decision: z.enum(["approve", "reject", "request_changes"]), comment: z.string().min(1).optional().describe("Plain text when a comment is required. First paragraph is the ask. Blank line between points. One number, range, or option per line, each line starting with \"- \"."), commentType: z.enum(REVIEW_COMMENT_TYPES).optional(), reasonCode: z.string().min(1).optional(), reasonText: z.string().optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, decision, comment, commentType, reasonCode, reasonText }) => {
    const to = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested";
    return withLinks(await call(`/api/v1/proposals/${proposalId}/review/transition`, { method: "POST", body: { to, commentBody: comment, commentType, reasonCode, reasonText } }), true);
  });
  server.registerTool("unw_resubmit_proposal", {
    description: "Resubmits a proposal after staff requested changes, whether or not a revision was started (changes_requested or client_revising to resubmitted). Requires proposals:write. Stores the next numbered version.",
    inputSchema: { proposalId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/transition`, { method: "POST", body: { to: "resubmitted" }, headers: { "x-unw-review-actor": "agent" } }), true));
  const completionGuidance = "Narrate the returned sentence to the client, including what reopens and the percentage before and after. Offer apply, park as a later phase, or swap for a similar size, and steer them back to a bounded shape.";
  server.registerTool("unw_duplicate_proposal", {
    description: "Copies a proposal into a new draft: scope, timeline, options and groups, milestones, and the completion tree. Locked nodes come back unlocked. If you keep the engagement the copy keeps the source price. If you change it the copy has no amount until staff price it (pricing.pendingStaffPrice is true and the copy still reads, lists, and fetches normally). You cannot set the price or hours here. The response includes links.portal for the copy. Requires proposals:write.",
    inputSchema: { proposalId: z.string().uuid(), title: z.string().min(1).max(300).optional(), engagement: z.enum(ENGAGEMENT_KINDS).optional(), reason: z.string().max(1000).optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${encodeURIComponent(proposalId)}/duplicate`, { method: "POST", body }), true));
  server.registerTool("unw_get_completion_tree", {
    description: `Loads the proposal completion tree, dependency edges, percentage, and history. Requires proposals:read. ${completionGuidance}`,
    inputSchema: { proposalId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/completion`)));
  server.registerTool("unw_get_proposal_progress", {
    description: "Loads the client-facing progress summary for a proposal: 'N of M parts settled', a plain-language phrase, the weighted percent, parts grouped by state with what is left on each, the next best step, items saved for later (not counted), and, if progress dropped since this caller last looked, which change reopened which parts. guidance.suggestedMoves lists a few ranked playbook moves with a client phrase; use those to steer collection, parking, a reminder, or a handoff, and never set hours or price from them. Narrate the headline and phrase, explain any drop, then offer the next step. Pass markSeen true after you have told the client, so the next visit compares against now. Requires proposals:read.",
    inputSchema: { proposalId: uuid, markSeen: z.boolean().optional(), recordTurn: z.boolean().optional().describe("Record this read as a conversation turn for the guidance playbook. Plain reads do not write a turn.") },
    outputSchema: envelope,
  }, async ({ proposalId, markSeen, recordTurn }) => {
    const query = new URLSearchParams();
    if (markSeen) query.set("markSeen", "true");
    if (recordTurn) query.set("recordTurn", "true");
    return withLinks(await call(`/api/v1/proposals/${proposalId}/progress${query.size ? `?${query}` : ""}`));
  });
  server.registerTool("unw_mark_part_unsure", {
    description: "Marks one proposal part as 'not sure, talk to a human' when the client does not know or would rather discuss it. It counts as settled for submission and is put on the review-call agenda; it is not a failure. Pass a short client-facing note on what is unclear. Use resolution staff_decides when the client wants Unwhelm to decide, or out_of_scope to set the part aside. Never use this to set prices or hours. Requires proposals:write.",
    inputSchema: { proposalId: uuid, nodeKey: z.string().min(1), note: z.string().max(1000).optional(), resolution: z.enum(["unsure", "staff_decides", "out_of_scope"]).optional() },
    outputSchema: envelope,
  }, async ({ proposalId, nodeKey, note, resolution }) => withLinks(await call(`/api/v1/proposals/${proposalId}/completion/nodes/${encodeURIComponent(nodeKey)}/resolve`, { method: "POST", body: { resolution: resolution ?? "unsure", note, actor: "agent" } })));
  server.registerTool("unw_agree_part", {
    description: "Marks one drafted proposal part as agreed by the client. Agreed counts as settled (completion weight 1) and is the missing step after a part is drafted. Also accepts state open or drafted to move a part back. Locked parts must be unlocked first. Leaving agreed reopens downstream agreed or locked parts to needs review. Never use this to set prices or hours. Requires proposals:write.",
    inputSchema: { proposalId: uuid, nodeKey: z.string().min(1), state: z.enum(["agreed", "drafted", "open"]).optional() },
    outputSchema: envelope,
  }, async ({ proposalId, nodeKey, state }) => withLinks(await call(`/api/v1/proposals/${proposalId}/completion/nodes/${encodeURIComponent(nodeKey)}/state`, { method: "POST", body: { state: state ?? "agreed", actor: "agent" } }), true));
  server.registerTool("unw_recommend_handoff", {
    description: "Recommends a call with a human at Unwhelm. The progress screen then shows 'Ready for a call with Unwhelm' with a send-as-is button, even if the proposal is incomplete. reasonCode is a row in proposal_handoff_reason: client_unsure, scope_unbounded (scope keeps growing or cannot be bounded), stuck (back and forth for about the turn_threshold on that row, 6 by default), client_asked. Add a short client-facing note. Requires proposals:write.",
    inputSchema: { proposalId: uuid, reasonCode: z.enum(["client_unsure", "scope_unbounded", "stuck", "client_asked"]), note: z.string().max(1000).optional() },
    outputSchema: envelope,
  }, async ({ proposalId, reasonCode, note }) => withLinks(await call(`/api/v1/proposals/${proposalId}/handoff`, { method: "POST", body: { reasonCode, note } })));
  server.registerTool("unw_preview_change_impact", {
    description: `Previews which nodes a change would reopen and the completion percentage before and after. Requires proposals:read. Does not apply the change. ${completionGuidance}`,
    inputSchema: { proposalId: uuid, nodeKey: z.string().min(1), change: z.string().min(1) },
    outputSchema: envelope,
  }, async ({ proposalId, nodeKey, change }) => withLinks(await call(`/api/v1/proposals/${proposalId}/completion/preview`, { method: "POST", body: { nodeKey, change } })));
  server.registerTool("unw_lock_node", {
    description: "Locks one completion node against a proposal version snapshot (a version id from unw_list_review_feedback versions[].id). A locked part refuses edits (409 SECTION_LOCKED) and removal until unw_unlock_node. An unknown version returns 404. Requires proposals:write.",
    inputSchema: { proposalId: uuid, nodeKey: z.string().min(1), versionId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, nodeKey, versionId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/completion/nodes/${nodeKey}/lock`, { method: "POST", body: { versionId } }), true));
  server.registerTool("unw_unlock_node", {
    description: `Unlocks a node. The node and any downstream agreed or locked nodes return to needs review; drafted, open, and resolved (such as staff_decides) nodes keep their state. Unlocking a node that is not locked or agreed changes nothing and returns changed: false. Requires proposals:write. ${completionGuidance}`,
    inputSchema: { proposalId: uuid, nodeKey: z.string().min(1) },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, nodeKey }) => withLinks(await call(`/api/v1/proposals/${proposalId}/completion/nodes/${nodeKey}/unlock`, { method: "POST", body: {} }), true));
  server.registerTool("unw_park_change", {
    description: "Parks a change as phase_2 or swap without reopening locked nodes. Swap requires swapSummary. Requires proposals:write.",
    inputSchema: { proposalId: uuid, nodeKey: z.string().min(1), change: z.string().min(1), mode: z.enum(["phase_2", "swap"]), swapSummary: z.string().min(1).optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/completion/park`, { method: "POST", body }), true));
  server.registerTool("unw_park_item", {
    description: "Parks an intake item outside the current proposal, usually a Workflow Check, so it can feed a follow-up proposal. Requires proposals:write. The Workflow Check itself stays the one slice that hurts most or costs the most time.",
    inputSchema: { proposalId: uuid, summary: z.string().min(1) },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, summary }) => withLinks(await call(`/api/v1/proposals/${proposalId}/parked-items`, { method: "POST", body: { summary } }), true));
  server.registerTool("unw_list_parked", {
    description: "Lists everything parked on a proposal: intake items from unw_park_item (kind item) and changes parked with unw_park_change as phase_2 or swap (kind change, with nodeKey, mode, and swapSummary). Requires proposals:read.",
    inputSchema: { proposalId: uuid },
    outputSchema: envelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/parked-items`)));
  server.registerTool("unw_list_reminders", {
    description: "Lists recorded proposal reminders (near expiry, stalled in review, waiting on the client). Rules are rows in reminder_rule. Queued client reminders are sent by unw_deliver_reminders. Staff only. Requires proposals:read.",
    inputSchema: { status: z.enum(["queued", "sent", "cancelled"]).optional(), proposalId: uuid.optional(), limit: z.number().int().min(1).max(200).optional() },
    outputSchema: envelope,
  }, async ({ status, proposalId, limit }) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (proposalId) query.set("proposalId", proposalId);
    if (limit) query.set("limit", String(limit));
    return withLinks(await call(`/api/v1/staff/reminders${query.size ? `?${query}` : ""}`));
  });
  server.registerTool("unw_run_reminders", {
    description: "Computes due reminders from the active reminder_rule rows and records new ones as queued. Repeat runs do not duplicate a reminder for the same deadline or state. dryRun returns what is due without recording. Staff only. Requires proposals:write.",
    inputSchema: { dryRun: z.boolean().optional() },
    outputSchema: envelope,
  }, async ({ dryRun }) => withLinks(await call("/api/v1/staff/reminders/run", { method: "POST", body: dryRun === undefined ? {} : { dryRun } })));
  server.registerTool("unw_get_reminder_options", {
    description: "Lists the reminder channels (email, sms, both, none), tickler schedules, and defaults (quiet hours, timezone, tickler time and limits) to offer the client. All are database rows. Requires proposals:read.",
    inputSchema: {},
    outputSchema: envelope,
  }, async () => withLinks(await call("/api/v1/reminders/options")));
  server.registerTool("unw_set_contact_preference", {
    description: "Saves how the signed-in client wants reminders. channel is a contact_channel code: email, sms, both, or none. Text needs phone in E.164 (+15551234567). email defaults to the account email. Send consent: true only after the client agreed to reminders. quietStart and quietEnd are HH:MM in the client's timezone (IANA, e.g. America/Los_Angeles). optOut: true stops all reminders. Requires proposals:write.",
    inputSchema: { channel: z.string().min(1), email: z.string().email().nullable().optional(), phone: z.string().nullable().optional(), consent: z.boolean().optional(), quietStart: z.string().nullable().optional(), quietEnd: z.string().nullable().optional(), timezone: z.string().nullable().optional(), optOut: z.boolean().optional() },
    outputSchema: writeEnvelope,
  }, async (body) => withLinks(await call("/api/v1/me/contact-preference", { method: "PUT", body: { ...body, consentSource: "mcp" } }), true));
  server.registerTool("unw_set_tickler", {
    description: "Schedules reminders to finish an unfinished proposal (draft or client_revising). Offer it when the client pauses. option is a tickler_option code: tomorrow_at (once, tomorrow at timeOfDay), snooze (once, in intervalDays), every_n_days (repeats every intervalDays), weekly (repeats on weekday 0=Sunday..6 at timeOfDay). timeOfDay is HH:MM in the client's timezone; default 09:00. Each tickler shows the progress summary and a portal link. It stops on submit, opt-out, or the max count. A proposal deadline does not stop it. stop: true turns it off. Needs a contact preference first. Requires proposals:write.",
    inputSchema: { proposalId: uuid, option: z.string().min(1).optional(), intervalDays: z.number().int().min(1).max(365).nullable().optional(), weekday: z.number().int().min(0).max(6).nullable().optional(), timeOfDay: z.string().optional(), stop: z.boolean().optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, stop, ...body }) => withLinks(stop
    ? await call(`/api/v1/proposals/${proposalId}/tickler`, { method: "DELETE" })
    : await call(`/api/v1/proposals/${proposalId}/tickler`, { method: "PUT", body: { option: body.option ?? "tomorrow_at", ...(body.intervalDays !== undefined ? { intervalDays: body.intervalDays } : {}), ...(body.weekday !== undefined ? { weekday: body.weekday } : {}), ...(body.timeOfDay ? { timeOfDay: body.timeOfDay } : {}) } }), true));
  server.registerTool("unw_deliver_reminders", {
    description: "Runs due ticklers, then sends queued client reminders by each client's preference (email via Microsoft Graph, SMS via Azure Communication Services or Twilio, with live delivery explicitly enabled). Skips opted-out clients, defers in quiet hours or past the daily cap, retries failures with backoff, and never sends the same reminder twice. Use dryRun: true to preview queued deliveries without sending or changing reminder state; preview does not run ticklers, and the response says dryRun: true with changed: false. Staff only. Requires proposals:write.",
    inputSchema: { ticklers: z.boolean().optional(), dryRun: z.boolean().optional() },
    outputSchema: envelope,
  }, async (body) => withLinks(await call("/api/v1/staff/reminders/deliver", { method: "POST", body })));
  server.registerTool("unw_list_deliveries", {
    description: "Lists reminder deliveries: channel, destination, provider, status (pending, deferred, sent, failed, skipped), attempts, next attempt, and last error. Staff only. Requires proposals:read.",
    inputSchema: { status: z.enum(["pending", "deferred", "sent", "failed", "skipped"]).optional(), proposalId: uuid.optional(), userId: uuid.optional(), limit: z.number().int().min(1).max(200).optional() },
    outputSchema: envelope,
  }, async ({ status, proposalId, userId, limit }) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (proposalId) query.set("proposalId", proposalId);
    if (userId) query.set("userId", userId);
    if (limit) query.set("limit", String(limit));
    return withLinks(await call(`/api/v1/staff/reminder-deliveries${query.size ? `?${query}` : ""}`));
  });
  server.registerTool("unw_list_agent_traces", {
    description: "Lists recent MCP tool calls from the agent trace store, newest first: tool, agent, caller, redacted input and output, error, and duration in ms. Filter by tool, MCP client id, user id, or errors only; page with before (the previous nextBefore). Staff only. Requires proposals:read.",
    inputSchema: { tool: z.string().min(1).max(200).optional(), clientId: uuid.optional(), userId: uuid.optional(), errorsOnly: z.boolean().optional(), before: z.string().datetime().optional(), limit: z.number().int().min(1).max(200).optional() },
    outputSchema: envelope,
  }, async ({ tool, clientId, userId, errorsOnly, before, limit }) => {
    const query = new URLSearchParams();
    if (tool) query.set("tool", tool);
    if (clientId) query.set("clientId", clientId);
    if (userId) query.set("userId", userId);
    if (errorsOnly) query.set("errors", "true");
    if (before) query.set("before", before);
    if (limit) query.set("limit", String(limit));
    return withLinks(await call(`/api/v1/admin/agent-traces${query.size ? `?${query}` : ""}`));
  });
  server.registerTool("unw_add_review_flag", {
    description: "Sets an unbounded flag on a proposal item. Requires proposals:write. An open unbounded flag blocks approval.",
    inputSchema: { proposalId: uuid, reason: z.string().min(1), visibility: z.string().min(1).default("client"), targetKind: reviewTarget.default("proposal"), targetId: z.string().min(1).optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, ...body }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/flags`, { method: "POST", body: { kind: "unbounded", ...body }, headers: { "x-unw-review-actor": "agent" } }), true));
  server.registerTool("unw_resolve_review_flag", {
    description: "Resolves one review flag, including automatic unbounded flags set by the submit check and flags set with unw_add_review_flag. Requires proposals:write. Staff and the agent may resolve; clients may not. Flag ids are in unw_list_review_feedback (flags[].id). An open blocking flag stops approval, so resolve it once the item is bounded or the flag was a false positive.",
    inputSchema: { proposalId: uuid, flagId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, flagId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/flags/${flagId}/resolve`, { method: "POST", body: {}, headers: { "x-unw-review-actor": "agent" } }), true));
  server.registerTool("unw_start_staff_review", {
    description: "Staff takes a proposal into staff review (state in_review): from agent review (handoff), from a resubmission (take up), or back from a scheduled review call. unw_review_decision approve, reject, and request_changes work from in_review. Requires proposals:write and a staff membership. Does not set hours or price.",
    inputSchema: { proposalId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/transition`, { method: "POST", body: { to: "in_review", actions: ["handoff", "take_up"] } }), true));
  server.registerTool("unw_start_revision", {
    description: "Starts the client's revision after staff requested changes (changes_requested to client_revising). Scope, price, timeline, and narrative parts become editable; then call unw_resubmit_proposal. Requires proposals:write. unw_resubmit_proposal also works straight from changes_requested.",
    inputSchema: { proposalId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/transition`, { method: "POST", body: { to: "client_revising" }, headers: { "x-unw-review-actor": "agent" } }), true));
  server.registerTool("unw_reopen_proposal", {
    description: "Reopens an approved proposal for editing (Edit after approval). This stores a version, clears the approved version, and returns the proposal to staff review, so it must be approved again before acceptance. Only use it when the client asks to change an approved proposal. Requires proposals:write.",
    inputSchema: { proposalId: uuid },
    outputSchema: writeEnvelope,
  }, async ({ proposalId }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/transition`, { method: "POST", body: { to: "in_review", actions: ["reopen"] }, headers: { "x-unw-review-actor": "agent" } }), true));
  server.registerTool("unw_withdraw_proposal", {
    description: "Withdraws a proposal on the client's behalf when the client says they no longer want it. This closes the proposal; it cannot be edited or accepted afterwards. reasonCode is one of the review reason codes for withdraw (budget, timing, scope, chose_other, other; see unw_list_review_feedback reasonCodes). Requires proposals:write. Confirm with the client before calling.",
    inputSchema: { proposalId: uuid, reasonCode: z.string().min(1), reasonText: z.string().max(2000).optional() },
    outputSchema: writeEnvelope,
  }, async ({ proposalId, reasonCode, reasonText }) => withLinks(await call(`/api/v1/proposals/${proposalId}/review/transition`, { method: "POST", body: { to: "withdrawn", reasonCode, reasonText }, headers: { "x-unw-review-actor": "agent" } }), true));

  server.registerTool("unw_list_tools", {
    description: "Lists every Unwhelm tool with its input names and a risk label: read, edit, or commit. Commit means the tool accepts a proposal, signs a contract, or creates, sends, pays, charges, voids, or invoices money. Read-only.",
    inputSchema: {},
    outputSchema: { ok: z.boolean(), tools: z.array(z.object({ name: z.string(), summary: z.string(), inputs: z.array(z.string()), risk: z.enum(["read", "edit", "commit"]) })) },
  }, async () => {
    const result = { ok: true, tools: catalogue };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
  });

  if (anonymous) {
    // Anonymous callers see the anonymous tools plus the client tools that need sign-in (those answer with an OAuth challenge,
    // which is how ChatGPT knows to offer account linking). Staff, admin, and catalog-editing tools stay hidden.
    const registered = (server as unknown as { _registeredTools: Record<string, { enabled: boolean }> })._registeredTools;
    const names = Object.keys(registered);
    const staffOnly = new Set(toolsHiddenForClients(names).map((tool) => tool.name));
    for (const name of names) {
      if (ANONYMOUS_TOOLS.includes(name)) continue;
      const scope = TOOL_SCOPES[name];
      if (staffOnly.has(name) || scope === "admin" || scope === "catalog:write") registered[name]!.enabled = false;
    }
  } else if (options.scopes !== undefined) {
    const registered = (server as unknown as { _registeredTools: Record<string, { enabled: boolean }> })._registeredTools;
    hiddenTools = [...toolsHiddenForScopes(Object.keys(registered), options.scopes), ...(options.staff === false ? toolsHiddenForClients(Object.keys(registered)) : [])];
    for (const tool of hiddenTools) {
      const entry = registered[tool.name];
      if (entry) entry.enabled = false;
    }
  }

  return server;
}
