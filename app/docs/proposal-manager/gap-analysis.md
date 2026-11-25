# Proposal manager gap analysis

## Existing strengths

The existing surface covers creation and editing, section ordering, review comments and flags, staff review, approvals, attachments, proposal lifecycle actions, exports, billing/invoicing, and chat collaboration. `unw_list_section_library` provides read-only reusable-section discovery, and templates can be selected for a draft.

## Cross-reference with mainstream proposal software

The comparison in the supplied notes uses Loopio, Responsive/RFPIO, Qvidian, RFP360, and Proposify as reference points. Across those products, the recurring differentiators are content reuse, contributor orchestration, requirement compliance, bid decisions, pricing, and outcome reporting.

| Capability | Current state | Priority | Proposed surface |
|---|---|---:|---|
| Contributor tasks and deadlines | Generic reminders exist; no proposal task model | High | `unw_assign_proposal_task`, task list/update/complete tools |
| Content library governance | List-only section library | High | `unw_upsert_content_library_item`, version/review/archive tools |
| RFP extraction and compliance | Absent | High | `unw_analyze_rfp_requirements`, matrix mapping tools |
| Go/no-go decision | Absent | High | `unw_create_go_no_go_assessment`, decision tool |
| Pricing build-up | Price tiers exist, but no proposal model | High | `unw_build_pricing_model`, pricing approval tools |
| Win/loss and pipeline analytics | Absent | High | `unw_get_win_loss_analytics`, pipeline and cycle-time reports |
| Template governance | Select/list only | Medium | template create/update/publish/archive tools |
| Portal/browser integration | Absent | Medium | later integration work; not part of this document set |
| AI first draft generation | Absent | Medium | later AI capability; must respect approved library content |

## Shared design rules

- Keep proposal state and pricing authority separate. Agents may draft and organize; staff-controlled rules should govern rates, margin floors, discounts, and final price.
- Every write returns the standard response envelope and records actor, timestamp, request ID, and before/after state where practical.
- Writes must be safe to retry. Use stable idempotency keys for extraction jobs, task assignment, decisions, and pricing recalculation.
- Scope access by proposal, project, organization, and role. A visible proposal does not automatically make its pricing, margin, or contributor notes visible.
- Preserve history. Prefer immutable versions and decision events over destructive updates.
- Treat AI extraction and recommendations as drafts requiring human confirmation; never mark a requirement compliant or a bid approved solely from model output.
