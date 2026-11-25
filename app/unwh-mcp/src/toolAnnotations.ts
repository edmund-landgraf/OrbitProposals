import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// MCP tool annotations are hints for clients (for example, ChatGPT skips confirmations for read-only tools
// and asks before a destructive one). The API still enforces every scope and staff check.
// openWorldHint is false unless the tool reaches outside Unwhelm (email, SMS, or a connected model).
const READ_ONLY = /^unw_(?:admin_)?(?:get|list|find|export|preview|remaining)_|^unw_(?:draft_proposal|review_proposal)$/;
const DESTRUCTIVE = /^unw_(?:admin_)?(?:remove|publish|delete|revoke|void)_|^unw_(?:sign_contract|cancel_esign|pay_invoice|charge_invoice|withdraw_proposal)$|^unw_admin_prune_mcp_clients$/;

/** Same arguments again do not create another record or send another message. */
const IDEMPOTENT = new Set([
  "unw_accept_proposal",
  "unw_agree_part",
  "unw_add_proposal_section",
  "unw_admin_add_org_member",
  "unw_admin_revoke_token",
  "unw_deliver_reminders",
  "unw_release_retainage",
  "unw_remove_proposal_section",
  "unw_reorder_proposal_sections",
  "unw_reorder_proposal_attachments",
  "unw_resolve_review_flag",
  "unw_run_reminders",
  "unw_select_proposal_options",
  "unw_set_contact_preference",
  "unw_set_contract_billing_terms",
  "unw_set_proposal_roles",
  "unw_set_proposal_template",
  "unw_set_tickler",
  "unw_sign_contract",
  "unw_send_esign",
  "unw_cancel_esign",
  "unw_update_billing_schedule_line",
  "unw_update_invoice_policy",
  "unw_update_price_tier",
  "unw_update_proposal_section",
]);

/** Sends mail or SMS, or can call a model outside this API. */
const OPEN_WORLD = new Set(["unw_deliver_reminders", "unw_send_chat_message", "unw_charge_invoice", "unw_send_esign"]);

export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export function toolAnnotations(name: string): ToolAnnotations | undefined {
  if (READ_ONLY.test(name)) return { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  if (!name.startsWith("unw_")) return undefined;
  const annotations: ToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: DESTRUCTIVE.test(name),
    openWorldHint: OPEN_WORLD.has(name),
  };
  if (IDEMPOTENT.has(name)) annotations.idempotentHint = true;
  return annotations;
}

/** Wraps registerTool so every tool registered afterward carries its annotations; explicit ones win. */
export function annotateTools(server: McpServer): void {
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (name: unknown, config: unknown, ...rest: unknown[]) => {
    const hints = typeof name === "string" ? toolAnnotations(name) : undefined;
    if (!hints || !config || typeof config !== "object") return original(name, config, ...rest);
    const existing = (config as { annotations?: ToolAnnotations }).annotations;
    return original(name, { ...config, annotations: { ...hints, ...existing } }, ...rest);
  };
}
