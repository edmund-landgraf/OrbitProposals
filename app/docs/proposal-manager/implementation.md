# MVP implementation status

The proposal-manager MVP is implemented as a vertical slice rather than one PR per tool.

## Implemented in this slice

| MCP tool | API implementation |
|---|---|
| `unw_ingest_rfp` | Stores a source document against a proposal. |
| `unw_extract_rfp_requirements` | Persists agent-confirmed requirements with confidence and source references. |
| `unw_analyze_rfp_requirements` | Proposes requirements from RFP text, suggests sections, and returns gaps. Sign-off stays staff-controlled. |
| `unw_create_go_no_go_assessment` | Stores weighted factors and an advisory score; final decisions are staff-controlled. |
| `unw_assign_proposal_task` | Creates proposal-specific tasks with owner, priority, dependency, and deadline. |
| `unw_list_proposal_tasks` | Lists tasks and overdue ids. |
| `unw_create_compliance_matrix` | Maps requirements to sections and evidence. |
| `unw_validate_proposal_readiness` | Finds mandatory requirement, blocked-task, go/no-go, and pricing gaps. |
| `unw_search_content_library` | Searches approved, non-expired organization/global content. |
| `unw_insert_approved_content` | Copies approved content into a proposal section with provenance. |
| `unw_create_scope_baseline` | Creates immutable, versioned scope snapshots. |
| `unw_create_pricing_model` | Creates versioned pricing snapshots with server-side minor-unit arithmetic. |
| `unw_validate_commercial_policy` | Checks a pricing snapshot against supplied margin thresholds. |
| `unw_get_pending_client_decisions` | Aggregates unresolved requirements, tasks, go/no-go, and pricing decisions. |
| `unw_compare_proposal_versions` | Reuses the existing proposal review diff engine. |
| `unw_create_delivery_project` | Reuses the existing signed-contract project creation route. |

## Deliberate MVP boundaries

- RFP analysis reads stored or pasted text into proposed requirements. It does not perform OCR or model inference. A section draft copies approved library answers onto the requirements that point at that section and names a gap when none match. Human confirmation and staff sign-off stay separate.
- Content-library items can be drafted, submitted, approved, rejected, archived, and expired. Search explains the match. Insert copies the approved version and records reuse. Semantic search is not included. Staff template/catalog governance remains separate.
- Pricing validation reports warnings; it does not approve discounts, margin exceptions, or nonstandard terms.
- Readiness is advisory and does not replace the existing proposal review/approval state machine.
- Scope and pricing snapshots are additive records and do not silently mutate the existing proposal JSON.

The next safe slices are policy-backed commercial approval and delivery handoff transfer from the approved proposal version.
