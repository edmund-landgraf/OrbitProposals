export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiOperation = {
  id: string;
  method: ApiMethod;
  path: string;
  area: "system" | "auth" | "chat" | "proposals" | "contracts" | "billing" | "projects" | "staff" | "admin";
  auth: "public" | "session" | "bearer" | "staff";
  scope?: string;
  implemented?: boolean;
};

const operation = (value: ApiOperation): ApiOperation => value;

export const API_SURFACE: readonly ApiOperation[] = [
  operation({ id: "health", method: "GET", path: "/health", area: "system", auth: "public", implemented: true }),
  operation({ id: "system_status", method: "GET", path: "/status", area: "system", auth: "public", implemented: true }),
  operation({ id: "me", method: "GET", path: "/me", area: "auth", auth: "session", implemented: true }),
  operation({ id: "public_mcp_info", method: "GET", path: "/public/mcp-info", area: "system", auth: "public", implemented: true }),
  operation({ id: "public_pricing", method: "GET", path: "/public/pricing", area: "system", auth: "public" }),
  operation({ id: "catalog_get", method: "GET", path: "/catalog", area: "system", auth: "public", implemented: true }),
  operation({ id: "catalog_editor", method: "GET", path: "/catalog/editor", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "catalog_draft_create", method: "POST", path: "/catalog/drafts", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "catalog_draft_validate", method: "POST", path: "/catalog/drafts/:versionId/validate", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "catalog_draft_publish", method: "POST", path: "/catalog/drafts/:versionId/publish", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "catalog_price_tier_update", method: "PATCH", path: "/catalog/drafts/:versionId/price-tiers/:code", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "catalog_billing_line_update", method: "PATCH", path: "/catalog/drafts/:versionId/billing-schedule-lines/:lineId", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "catalog_invoice_policy_update", method: "PATCH", path: "/catalog/drafts/:versionId/invoice-policy", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "catalog_pricing_model_update", method: "PATCH", path: "/catalog/drafts/:versionId/pricing-models/:code", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "catalog_template_update", method: "PATCH", path: "/catalog/drafts/:versionId/billing-schedule-templates/:model", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_list", method: "GET", path: "/staff/proposal-templates", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_create", method: "POST", path: "/staff/proposal-templates", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_update", method: "PATCH", path: "/staff/proposal-templates/:code", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_nodes_replace", method: "PUT", path: "/staff/proposal-templates/:code/nodes", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_sample_put", method: "PUT", path: "/staff/proposal-templates/:code/samples/:nodeKey", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_sample_delete", method: "DELETE", path: "/staff/proposal-templates/:code/samples/:nodeKey", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_options_replace", method: "PUT", path: "/staff/proposal-templates/:code/options", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_rule_create", method: "POST", path: "/staff/proposal-templates/:code/rules", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_rule_update", method: "PATCH", path: "/staff/proposal-templates/:code/rules/:ruleCode", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_template_rule_delete", method: "DELETE", path: "/staff/proposal-templates/:code/rules/:ruleCode", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "catalog_transitions_replace", method: "PUT", path: "/catalog/drafts/:versionId/invoice-status-transitions", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "session_get", method: "GET", path: "/auth/session", area: "auth", auth: "session" }),
  operation({ id: "mfa_setup", method: "POST", path: "/auth/mfa/setup", area: "auth", auth: "session", implemented: true }),
  operation({ id: "mfa_confirm", method: "POST", path: "/auth/mfa/confirm", area: "auth", auth: "session", implemented: true }),
  operation({ id: "mfa_verify", method: "POST", path: "/auth/mfa/verify", area: "auth", auth: "session", implemented: true }),
  operation({ id: "mfa_disable", method: "POST", path: "/auth/mfa/disable", area: "auth", auth: "session", implemented: true }),
  operation({ id: "session_logout", method: "POST", path: "/auth/logout", area: "auth", auth: "session" }),
  operation({ id: "magic_link_request", method: "POST", path: "/auth/magic-link/request", area: "auth", auth: "public" }),
  operation({ id: "access_request_create", method: "POST", path: "/access-requests", area: "auth", auth: "public", implemented: true }),
  operation({ id: "magic_link_consume", method: "GET", path: "/auth/magic-link", area: "auth", auth: "public", implemented: true }),
  operation({ id: "auth_signin_page", method: "GET", path: "/auth/signin", area: "auth", auth: "public", implemented: true }),
  operation({ id: "auth_signin_submit", method: "POST", path: "/auth/signin", area: "auth", auth: "public", implemented: true }),
  operation({ id: "reviewer_signin", method: "POST", path: "/auth/reviewer/signin", area: "auth", auth: "public", implemented: true }),
  operation({ id: "magic_link_verify", method: "POST", path: "/auth/magic-link/verify", area: "auth", auth: "public" }),
  operation({ id: "google_start", method: "GET", path: "/auth/google/start", area: "auth", auth: "public" }),
  operation({ id: "google_callback", method: "GET", path: "/auth/google/callback", area: "auth", auth: "public" }),
  operation({ id: "mcp_register", method: "POST", path: "/auth/mcp/register", area: "auth", auth: "public", implemented: true }),
  operation({ id: "mcp_authorize", method: "GET", path: "/auth/mcp/authorize", area: "auth", auth: "public", implemented: true }),
  operation({ id: "mcp_authorize_resume", method: "GET", path: "/auth/mcp/authorize/resume", area: "auth", auth: "session", implemented: true }),
  operation({ id: "mcp_authorize_decision", method: "POST", path: "/auth/mcp/authorize/decision", area: "auth", auth: "session", implemented: true }),
  operation({ id: "mcp_token", method: "POST", path: "/auth/mcp/token", area: "auth", auth: "public" }),
  operation({ id: "mcp_revoke", method: "POST", path: "/auth/mcp/revoke", area: "auth", auth: "bearer", scope: "tokens:write" }),
  operation({ id: "mcp_clients", method: "GET", path: "/auth/mcp/clients", area: "auth", auth: "staff", scope: "tokens:read" }),
  operation({ id: "mcp_clients_delete", method: "DELETE", path: "/auth/mcp/clients/:id", area: "auth", auth: "staff", scope: "tokens:write" }),
  operation({ id: "mcp_clients_prune", method: "POST", path: "/auth/mcp/clients/prune", area: "auth", auth: "staff", scope: "tokens:write" }),
  operation({ id: "oauth_discovery", method: "GET", path: "/.well-known/oauth-authorization-server", area: "auth", auth: "public", implemented: true }),
  operation({ id: "openid_discovery", method: "GET", path: "/.well-known/openid-configuration", area: "auth", auth: "public", implemented: true }),
  operation({ id: "operation_log_list", method: "GET", path: "/operation-log", area: "system", auth: "staff", scope: "audit:read" }),
  operation({ id: "admin_users_list", method: "GET", path: "/admin/users", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_users_create", method: "POST", path: "/admin/users", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_orgs_list", method: "GET", path: "/admin/orgs", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_orgs_create", method: "POST", path: "/admin/orgs", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_org_members_add", method: "POST", path: "/admin/orgs/:id/members", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_scope_presets_list", method: "GET", path: "/admin/scope-presets", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_magic_link", method: "POST", path: "/admin/users/:id/magic-link", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_user_suspend", method: "POST", path: "/admin/users/:id/suspend", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_user_unsuspend", method: "POST", path: "/admin/users/:id/unsuspend", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_access_requests_list", method: "GET", path: "/admin/access-requests", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_access_request_approve", method: "POST", path: "/admin/access-requests/:id/approve", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_access_request_reject", method: "POST", path: "/admin/access-requests/:id/reject", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_tokens_list", method: "GET", path: "/admin/tokens", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_tokens_create", method: "POST", path: "/admin/tokens", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_tokens_revoke", method: "DELETE", path: "/admin/tokens/:id", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "admin_proposals_delete", method: "DELETE", path: "/admin/proposals/:id", area: "admin", auth: "session", scope: "admin", implemented: true }),
  operation({ id: "agent_trace_record", method: "POST", path: "/agent-traces", area: "system", auth: "bearer", implemented: true }),
  operation({ id: "admin_agent_traces_list", method: "GET", path: "/admin/agent-traces", area: "admin", auth: "staff", scope: "proposals:read", implemented: true }),
  operation({ id: "admin_agent_trace_get", method: "GET", path: "/admin/agent-traces/:traceId", area: "admin", auth: "staff", scope: "proposals:read", implemented: true }),
  operation({ id: "public_demo_session_create", method: "POST", path: "/public/demo/sessions", area: "system", auth: "public", implemented: true }),
  operation({ id: "public_demo_session_get", method: "GET", path: "/public/demo/sessions/:id", area: "system", auth: "public", implemented: true }),
  operation({ id: "public_demo_guide_get", method: "GET", path: "/public/demo/guide", area: "system", auth: "public", implemented: true }),
  operation({ id: "public_demo_plan_list", method: "GET", path: "/public/demo/plans", area: "system", auth: "public", implemented: true }),
  operation({ id: "public_demo_session_continue", method: "POST", path: "/public/demo/sessions/:id/continue", area: "system", auth: "public", implemented: true }),
  operation({ id: "public_demo_session_stop", method: "POST", path: "/public/demo/sessions/:id/stop", area: "system", auth: "public", implemented: true }),
  operation({ id: "admin_follow_up_queue", method: "GET", path: "/admin/follow-up-queue", area: "admin", auth: "staff", scope: "proposals:read", implemented: true }),
  operation({ id: "admin_audit", method: "GET", path: "/admin/audit", area: "admin", auth: "session", scope: "admin", implemented: true }),

  operation({ id: "chat_session_create", method: "POST", path: "/chat/sessions", area: "chat", auth: "public" }),
  operation({ id: "chat_session_list", method: "GET", path: "/chat/sessions", area: "chat", auth: "session" }),
  operation({ id: "chat_session_get", method: "GET", path: "/chat/sessions/:id", area: "chat", auth: "session" }),
  operation({ id: "chat_message_create", method: "POST", path: "/chat/sessions/:id/messages", area: "chat", auth: "session" }),
  operation({ id: "chat_message_list", method: "GET", path: "/chat/sessions/:id/messages", area: "chat", auth: "session" }),
  operation({ id: "chat_escalate", method: "POST", path: "/chat/sessions/:id/escalate", area: "chat", auth: "session" }),
  operation({ id: "chat_takeover", method: "POST", path: "/chat/sessions/:id/takeover", area: "chat", auth: "staff", scope: "chat:write" }),
  operation({ id: "chat_handback", method: "POST", path: "/chat/sessions/:id/handback", area: "chat", auth: "staff", scope: "chat:write" }),
  operation({ id: "public_proposal_session_create", method: "POST", path: "/public/proposal-sessions", area: "chat", auth: "public", implemented: true }),
  operation({ id: "public_proposal_session_get", method: "GET", path: "/public/proposal-sessions", area: "chat", auth: "public", implemented: true }),
  operation({ id: "public_proposal_message_create", method: "POST", path: "/public/proposal-sessions/messages", area: "chat", auth: "public", implemented: true }),
  operation({ id: "public_proposal_submit", method: "POST", path: "/public/proposal-sessions/submit", area: "chat", auth: "public", implemented: true }),

  operation({ id: "proposal_list", method: "GET", path: "/proposals", area: "proposals", auth: "bearer", scope: "proposals:read" }),
  operation({ id: "proposal_create", method: "POST", path: "/proposals", area: "proposals", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_get", method: "GET", path: "/proposals/:id", area: "proposals", auth: "bearer", scope: "proposals:read" }),
  operation({ id: "proposal_update", method: "PATCH", path: "/proposals/:id", area: "proposals", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_delete", method: "DELETE", path: "/proposals/:id", area: "proposals", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_status", method: "GET", path: "/proposals/:id/status", area: "proposals", auth: "bearer", scope: "proposals:read" }),
  operation({ id: "proposal_sections_list", method: "GET", path: "/proposals/:id/sections", area: "proposals", auth: "bearer", scope: "proposals:read" }),
  operation({ id: "proposal_section_update", method: "PUT", path: "/proposals/:id/sections/:sectionId", area: "proposals", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_timeline_update", method: "PUT", path: "/proposals/:id/timeline", area: "proposals", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_roles_list", method: "GET", path: "/proposals/:id/roles", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_roles_replace", method: "PUT", path: "/proposals/:id/roles", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_budget_update", method: "PUT", path: "/proposals/:id/budget", area: "proposals", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_options_update", method: "PUT", path: "/proposals/:id/options", area: "proposals", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_review", method: "POST", path: "/proposals/:id/review", area: "proposals", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_review_queue", method: "GET", path: "/proposals/review-queue", area: "proposals", auth: "staff", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_review_get", method: "GET", path: "/proposals/:id/review", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_review_diff", method: "GET", path: "/proposals/:id/review/diff", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_review_transition", method: "POST", path: "/proposals/:id/review/transition", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_review_comment_create", method: "POST", path: "/proposals/:id/review/comments", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_review_comment_resolve", method: "POST", path: "/proposals/:id/review/comments/:commentId/resolve", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_review_flag_create", method: "POST", path: "/proposals/:id/review/flags", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_review_flag_resolve", method: "POST", path: "/proposals/:id/review/flags/:flagId/resolve", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_duplicate", method: "POST", path: "/proposals/:id/duplicate", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_lineage", method: "GET", path: "/proposals/:id/lineage", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_narrative_list", method: "GET", path: "/proposals/:id/narrative", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_freshness", method: "GET", path: "/proposals/:id/freshness", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_narrative_read", method: "GET", path: "/proposals/:id/narrative/:nodeKey", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_review_feedback", method: "GET", path: "/proposals/:id/review-feedback", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_templates_list", method: "GET", path: "/proposal-templates", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_template_set", method: "PUT", path: "/proposals/:id/template", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_section_library_list", method: "GET", path: "/proposal-section-library", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_guidance_cases", method: "GET", path: "/proposals/:id/guidance-cases", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "staff_guidance_feedback_list", method: "GET", path: "/staff/guidance-feedback", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_guidance_feedback_create", method: "POST", path: "/staff/guidance-feedback", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_guidance_case_list", method: "GET", path: "/staff/guidance-cases", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_guidance_case_create", method: "POST", path: "/staff/guidance-cases", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "staff_guidance_case_update", method: "PATCH", path: "/staff/guidance-cases/:key", area: "system", auth: "staff", scope: "catalog:write", implemented: true }),
  operation({ id: "proposal_section_remove", method: "DELETE", path: "/proposals/:id/sections/:nodeKey", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_section_order", method: "PUT", path: "/proposals/:id/section-order", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_section_add", method: "POST", path: "/proposals/:id/sections", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_narrative_write", method: "PUT", path: "/proposals/:id/narrative/:nodeKey", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_completion_get", method: "GET", path: "/proposals/:id/completion", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_progress_get", method: "GET", path: "/proposals/:id/progress", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_guidance_events", method: "GET", path: "/proposals/:id/guidance-events", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_progress_seen", method: "POST", path: "/proposals/:id/progress/seen", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_part_resolve", method: "POST", path: "/proposals/:id/completion/nodes/:nodeKey/resolve", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_part_state", method: "POST", path: "/proposals/:id/completion/nodes/:nodeKey/state", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_handoff_recommend", method: "POST", path: "/proposals/:id/handoff", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_completion_preview", method: "POST", path: "/proposals/:id/completion/preview", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_completion_apply", method: "POST", path: "/proposals/:id/completion/apply", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_completion_park", method: "POST", path: "/proposals/:id/completion/park", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_completion_lock", method: "POST", path: "/proposals/:id/completion/nodes/:nodeKey/lock", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_completion_unlock", method: "POST", path: "/proposals/:id/completion/nodes/:nodeKey/unlock", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_completion_edge_create", method: "POST", path: "/proposals/:id/completion/edges", area: "proposals", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_completion_edge_delete", method: "DELETE", path: "/proposals/:id/completion/edges/:edgeId", area: "proposals", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_parked_items_list", method: "GET", path: "/proposals/:id/parked-items", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_parked_item_create", method: "POST", path: "/proposals/:id/parked-items", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "staff_reminder_rules_list", method: "GET", path: "/staff/reminder-rules", area: "staff", auth: "staff", scope: "proposals:read", implemented: true }),
  operation({ id: "staff_reminders_run", method: "POST", path: "/staff/reminders/run", area: "staff", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "staff_reminders_list", method: "GET", path: "/staff/reminders", area: "staff", auth: "staff", scope: "proposals:read", implemented: true }),
  operation({ id: "reminder_options", method: "GET", path: "/reminders/options", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "contact_preference_get", method: "GET", path: "/me/contact-preference", area: "auth", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "contact_preference_set", method: "PUT", path: "/me/contact-preference", area: "auth", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "reminder_unsubscribe", method: "GET", path: "/reminders/unsubscribe/:token", area: "system", auth: "public", implemented: true }),
  operation({ id: "reminder_sms_inbound", method: "POST", path: "/reminders/sms-inbound", area: "system", auth: "public", implemented: true }),
  operation({ id: "proposal_tickler_get", method: "GET", path: "/proposals/:id/tickler", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_tickler_set", method: "PUT", path: "/proposals/:id/tickler", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_tickler_stop", method: "DELETE", path: "/proposals/:id/tickler", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "staff_reminders_deliver", method: "POST", path: "/staff/reminders/deliver", area: "staff", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "staff_reminder_deliveries_list", method: "GET", path: "/staff/reminder-deliveries", area: "staff", auth: "staff", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_export", method: "GET", path: "/proposals/:id/export", area: "proposals", auth: "bearer", scope: "proposals:read" }),
  operation({ id: "proposal_redline", method: "GET", path: "/proposals/:id/redline", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_views_record", method: "POST", path: "/proposals/:id/views", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_views_summary", method: "GET", path: "/proposals/:id/views", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_approval_steps", method: "GET", path: "/proposals/:id/approval-steps", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_approval_step_add", method: "POST", path: "/proposals/:id/approval-steps", area: "proposals", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_approval_record", method: "POST", path: "/proposals/:id/approvals", area: "proposals", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_pdf", method: "GET", path: "/proposals/:id/pdf", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_attachments_list", method: "GET", path: "/proposals/:id/attachments", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_attachments_order", method: "PUT", path: "/proposals/:id/attachments/order", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_attachment_create", method: "POST", path: "/proposals/:id/attachments", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_attachment_link", method: "POST", path: "/proposals/:id/attachments/link", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_attachment_fetch", method: "POST", path: "/proposals/:id/attachments/fetch", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_attachment_part", method: "POST", path: "/proposals/:id/attachments/parts", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_custom_section", method: "POST", path: "/proposals/:id/custom-sections", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_change_items_create", method: "POST", path: "/proposals/:id/change-items", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_change_items_list", method: "GET", path: "/proposals/:id/change-items", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_change_item_update", method: "PATCH", path: "/proposals/:id/change-items/:itemId", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_change_item_decision", method: "POST", path: "/proposals/:id/change-items/:itemId/decision", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_commitment_preview", method: "GET", path: "/proposals/:id/commitment-preview", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_guest_invite", method: "POST", path: "/proposals/:id/guest-invites", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_save_template", method: "POST", path: "/proposals/:id/save-as-template", area: "proposals", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_phase_estimates", method: "POST", path: "/proposals/:id/phase-estimates", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_review_comment_revise", method: "PATCH", path: "/proposals/:id/review/comments/:commentId", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_attachment_upsert", method: "PUT", path: "/proposals/:id/attachments", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_attachment_get", method: "GET", path: "/proposals/:id/attachments/:attachmentId", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_attachment_replace", method: "PUT", path: "/proposals/:id/attachments/:attachmentId", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_attachment_delete", method: "DELETE", path: "/proposals/:id/attachments/:attachmentId", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_import", method: "POST", path: "/proposals/import", area: "proposals", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_source_document_create", method: "POST", path: "/proposals/:id/source-documents", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_requirements_extract", method: "POST", path: "/proposals/:id/requirements/extract", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_requirements_analyze", method: "POST", path: "/proposals/:id/requirements/analyze", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_requirements_list", method: "GET", path: "/proposals/:id/requirements", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_requirement_update", method: "PATCH", path: "/proposals/:id/requirements/:requirementId", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_requirement_map", method: "POST", path: "/proposals/:id/requirements/:requirementId/mapping", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_requirement_evidence", method: "POST", path: "/proposals/:id/requirements/:requirementId/evidence", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_compliance_matrix_get", method: "GET", path: "/proposals/:id/compliance-matrix", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_compliance_signoff", method: "POST", path: "/proposals/:id/compliance-signoff", area: "proposals", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_section_draft", method: "POST", path: "/proposals/:id/sections/:nodeKey/draft", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_go_no_go_create", method: "POST", path: "/proposals/:id/go-no-go", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_task_create", method: "POST", path: "/proposals/:id/tasks", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_task_list", method: "GET", path: "/proposals/:id/tasks", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_compliance_matrix_update", method: "POST", path: "/proposals/:id/compliance-matrix", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_readiness_validate", method: "POST", path: "/proposals/:id/readiness", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "content_library_upsert", method: "POST", path: "/content-library/items", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "content_library_get", method: "GET", path: "/content-library/items/:itemId", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "content_library_submit", method: "POST", path: "/content-library/items/:itemId/submit", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "content_library_approve", method: "POST", path: "/content-library/items/:itemId/approve", area: "proposals", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "content_library_archive", method: "POST", path: "/content-library/items/:itemId/archive", area: "proposals", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "content_library_search", method: "POST", path: "/content-library/search", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_content_library_insert", method: "POST", path: "/proposals/:id/content-library/insert", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_scope_baseline_create", method: "POST", path: "/proposals/:id/scope-baselines", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_pricing_model_create", method: "POST", path: "/proposals/:id/pricing-models", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_commercial_validation", method: "POST", path: "/proposals/:id/commercial-validation", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_pending_decisions", method: "GET", path: "/proposals/:id/pending-decisions", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "consult_offerings_list", method: "GET", path: "/consult-offerings", area: "proposals", auth: "public", implemented: true }),
  operation({ id: "consult_intake_create", method: "POST", path: "/consult-intakes", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "consult_intake_list", method: "GET", path: "/consult-intakes", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_public_link_create", method: "POST", path: "/proposals/:id/public-link", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_public_link_revoke", method: "DELETE", path: "/proposals/:id/public-link", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "public_proposal_get", method: "GET", path: "/public/proposals/:token", area: "proposals", auth: "public", implemented: true }),

  operation({ id: "proposal_accept", method: "POST", path: "/proposals/:id/accept", area: "contracts", auth: "bearer", scope: "proposals:write" }),
  operation({ id: "proposal_acceptance_get", method: "GET", path: "/proposals/:id/acceptance", area: "contracts", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_expiry_get", method: "GET", path: "/proposals/:id/expiry", area: "proposals", auth: "bearer", scope: "proposals:read", implemented: true }),
  operation({ id: "proposal_expiry_extend", method: "POST", path: "/proposals/:id/expiry/extend", area: "proposals", auth: "staff", scope: "proposals:write", implemented: true }),
  operation({ id: "proposal_option_selection", method: "POST", path: "/proposals/:id/options/selection", area: "proposals", auth: "bearer", scope: "proposals:write", implemented: true }),
  operation({ id: "payment_terms_list", method: "GET", path: "/payment-terms", area: "billing", auth: "bearer", scope: "billing:read", implemented: true }),
  operation({ id: "contract_billing_terms", method: "PATCH", path: "/contracts/:id/billing-terms", area: "contracts", auth: "staff", scope: "contracts:write", implemented: true }),
  operation({ id: "contract_retainage_release", method: "POST", path: "/contracts/:id/retainage/release", area: "contracts", auth: "staff", scope: "contracts:write", implemented: true }),
  operation({ id: "contract_list", method: "GET", path: "/contracts", area: "contracts", auth: "bearer", scope: "contracts:read" }),
  operation({ id: "contract_create", method: "POST", path: "/contracts", area: "contracts", auth: "staff", scope: "contracts:write" }),
  operation({ id: "contract_get", method: "GET", path: "/contracts/:id", area: "contracts", auth: "bearer", scope: "contracts:read" }),
  operation({ id: "contract_pdf", method: "GET", path: "/contracts/:id/pdf", area: "contracts", auth: "bearer", scope: "contracts:read", implemented: true }),
  operation({ id: "contract_update", method: "PATCH", path: "/contracts/:id", area: "contracts", auth: "staff", scope: "contracts:write" }),
  operation({ id: "contract_sign", method: "POST", path: "/contracts/:id/sign", area: "contracts", auth: "bearer", scope: "contracts:write" }),
  operation({ id: "contract_esign_send", method: "POST", path: "/contracts/:id/esign/send", area: "contracts", auth: "staff", scope: "contracts:write", implemented: true }),
  operation({ id: "contract_esign_status", method: "GET", path: "/contracts/:id/esign/status", area: "contracts", auth: "staff", scope: "contracts:read", implemented: true }),
  operation({ id: "contract_esign_artifact_download", method: "GET", path: "/contracts/:id/esign/artifacts/:kind", area: "contracts", auth: "staff", scope: "contracts:read", implemented: true }),
  operation({ id: "contract_esign_cancel", method: "POST", path: "/contracts/:id/esign/cancel", area: "contracts", auth: "staff", scope: "contracts:write", implemented: true }),
  operation({ id: "contract_cancel", method: "POST", path: "/contracts/:id/cancel", area: "contracts", auth: "staff", scope: "contracts:write" }),
  operation({ id: "contract_handoff", method: "GET", path: "/contracts/:id/handoff", area: "contracts", auth: "bearer", scope: "contracts:read" }),

  operation({ id: "signwell_webhook", method: "POST", path: "/esign/signwell/webhook", area: "system", auth: "public", implemented: true }),
  operation({ id: "signwell_callback", method: "GET", path: "/esign/signwell/callback", area: "system", auth: "public", implemented: true }),
  operation({ id: "pandadoc_webhook", method: "POST", path: "/esign/pandadoc/webhook", area: "system", auth: "public", implemented: true }),
  operation({ id: "pandadoc_callback", method: "GET", path: "/esign/pandadoc/callback", area: "system", auth: "public", implemented: true }),

  operation({ id: "invoice_list", method: "GET", path: "/invoices", area: "billing", auth: "bearer", scope: "billing:read" }),
  operation({ id: "invoice_create", method: "POST", path: "/invoices", area: "billing", auth: "staff", scope: "billing:write" }),
  operation({ id: "invoice_get", method: "GET", path: "/invoices/:id", area: "billing", auth: "bearer", scope: "billing:read" }),
  operation({ id: "invoice_send", method: "POST", path: "/invoices/:id/send", area: "billing", auth: "staff", scope: "billing:write" }),
  operation({ id: "invoice_pay", method: "POST", path: "/invoices/:id/pay", area: "billing", auth: "bearer", scope: "billing:write" }),
  operation({ id: "invoice_charge", method: "POST", path: "/invoices/:id/charge", area: "billing", auth: "bearer", scope: "billing:write", implemented: true }),
  operation({ id: "invoice_void", method: "POST", path: "/invoices/:id/void", area: "billing", auth: "staff", scope: "billing:write" }),
  operation({ id: "billing_schedule", method: "GET", path: "/contracts/:id/billing", area: "billing", auth: "bearer", scope: "billing:read" }),
  operation({ id: "time_entry_list", method: "GET", path: "/contracts/:id/time-entries", area: "billing", auth: "bearer", scope: "billing:read", implemented: true }),
  operation({ id: "time_entry_create", method: "POST", path: "/contracts/:id/time-entries", area: "billing", auth: "staff", scope: "billing:write", implemented: true }),
  operation({ id: "time_entry_get", method: "GET", path: "/time-entries/:id", area: "billing", auth: "bearer", scope: "billing:read", implemented: true }),
  operation({ id: "time_entry_update", method: "PATCH", path: "/time-entries/:id", area: "billing", auth: "staff", scope: "billing:write", implemented: true }),
  operation({ id: "time_entry_delete", method: "DELETE", path: "/time-entries/:id", area: "billing", auth: "staff", scope: "billing:write", implemented: true }),
  operation({ id: "hours_remaining", method: "GET", path: "/contracts/:id/hours-remaining", area: "billing", auth: "bearer", scope: "billing:read", implemented: true }),
  operation({ id: "invoice_hours", method: "POST", path: "/contracts/:id/invoice-hours", area: "billing", auth: "staff", scope: "billing:write", implemented: true }),
  operation({ id: "credit_list", method: "GET", path: "/credits", area: "billing", auth: "staff", scope: "billing:read", implemented: true }),
  operation({ id: "credit_apply", method: "POST", path: "/credits/:id/apply", area: "billing", auth: "staff", scope: "billing:write", implemented: true }),
  operation({ id: "credit_void", method: "POST", path: "/credits/:id/void", area: "billing", auth: "staff", scope: "billing:write", implemented: true }),
  operation({ id: "change_order_create", method: "POST", path: "/change-orders", area: "billing", auth: "bearer", scope: "change_orders:write" }),

  operation({ id: "project_list", method: "GET", path: "/projects", area: "projects", auth: "bearer", scope: "projects:read" }),
  operation({ id: "project_create", method: "POST", path: "/projects", area: "projects", auth: "staff", scope: "projects:write" }),
  operation({ id: "project_get", method: "GET", path: "/projects/:id", area: "projects", auth: "bearer", scope: "projects:read" }),
  operation({ id: "project_update", method: "PATCH", path: "/projects/:id", area: "staff", auth: "staff", scope: "projects:write" }),
  operation({ id: "milestone_list", method: "GET", path: "/projects/:id/milestones", area: "projects", auth: "bearer", scope: "projects:read" }),
  operation({ id: "milestone_create", method: "POST", path: "/projects/:id/milestones", area: "projects", auth: "staff", scope: "projects:write" }),
  operation({ id: "milestone_update", method: "PATCH", path: "/milestones/:id", area: "projects", auth: "staff", scope: "projects:write" }),
  operation({ id: "milestone_accept", method: "POST", path: "/milestones/:id/accept", area: "projects", auth: "bearer", scope: "projects:write" }),
  operation({ id: "task_list", method: "GET", path: "/projects/:id/tasks", area: "projects", auth: "bearer", scope: "projects:read" }),
  operation({ id: "task_update", method: "PATCH", path: "/tasks/:id", area: "projects", auth: "staff", scope: "projects:write" }),

  operation({ id: "staff_escalation_list", method: "GET", path: "/staff/escalations", area: "staff", auth: "staff", scope: "staff:read" }),
  operation({ id: "staff_escalation_get", method: "GET", path: "/staff/escalations/:id", area: "staff", auth: "staff", scope: "staff:read" }),
  operation({ id: "staff_escalation_claim", method: "POST", path: "/staff/escalations/:id/claim", area: "staff", auth: "staff", scope: "staff:write" }),
  operation({ id: "staff_escalation_resolve", method: "POST", path: "/staff/escalations/:id/resolve", area: "staff", auth: "staff", scope: "staff:write" }),
  operation({ id: "staff_approval_list", method: "GET", path: "/staff/approvals", area: "staff", auth: "staff", scope: "staff:read" }),
  operation({ id: "staff_approval_get", method: "GET", path: "/staff/approvals/:id", area: "staff", auth: "staff", scope: "staff:read" }),
  operation({ id: "staff_approval_approve", method: "POST", path: "/staff/approvals/:id/approve", area: "staff", auth: "staff", scope: "staff:write" }),
  operation({ id: "staff_approval_reject", method: "POST", path: "/staff/approvals/:id/reject", area: "staff", auth: "staff", scope: "staff:write" }),
  operation({ id: "staff_hold", method: "POST", path: "/staff/records/:type/:id/hold", area: "staff", auth: "staff", scope: "staff:write" }),
  operation({ id: "staff_release", method: "POST", path: "/staff/records/:type/:id/release", area: "staff", auth: "staff", scope: "staff:write" }),
  operation({ id: "staff_conversation_list", method: "GET", path: "/staff/conversations", area: "staff", auth: "staff", scope: "staff:read" }),
  operation({ id: "staff_conversation_get", method: "GET", path: "/staff/conversations/:id", area: "staff", auth: "staff", scope: "staff:read" }),
];

type RouteShape = {
  path?: string | string[];
  methods?: Record<string, boolean>;
};

const routeKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function registeredRoutes(router: { stack?: readonly unknown[] }): { method: ApiMethod; path: string }[] {
  const found: { method: ApiMethod; path: string }[] = [];
  const visit = (layers: readonly unknown[] | undefined) => {
    for (const layer of layers ?? []) {
      if (!isRecord(layer)) continue;
      const route = isRecord(layer.route) ? layer.route as RouteShape : undefined;
      const methods = route?.methods;
      if (route?.path !== undefined && methods) {
        const paths = Array.isArray(route.path) ? route.path : [route.path];
        for (const path of paths) {
          for (const [method, enabled] of Object.entries(methods)) {
            if (!enabled) continue;
            const upper = method.toUpperCase();
            if (upper === "HEAD" && methods.get) continue;
            if (upper !== "GET" && upper !== "POST" && upper !== "PUT" && upper !== "PATCH" && upper !== "DELETE") continue;
            found.push({ method: upper, path });
          }
        }
      } else if (isRecord(layer.handle) && Array.isArray(layer.handle.stack)) {
        visit(layer.handle.stack);
      }
    }
  };
  visit(router.stack);
  return found;
}

export function assertApiSurface(
  operations: readonly ApiOperation[] = API_SURFACE,
  routes?: readonly { method: string; path: string }[],
): void {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const operation of operations) {
    if (ids.has(operation.id)) throw new Error(`Duplicate API operation id ${operation.id}`);
    ids.add(operation.id);
    const key = routeKey(operation.method, operation.path);
    if (keys.has(key)) throw new Error(`Duplicate API route ${key}`);
    keys.add(key);
  }
  if (!routes) return;
  const missing = routes.filter((route) => !keys.has(routeKey(route.method, route.path)));
  if (missing.length > 0) {
    const listed = missing.map((route) => routeKey(route.method, route.path)).join(", ");
    throw new Error(`Registered routes missing from API_SURFACE: ${listed}`);
  }
}

assertApiSurface();
