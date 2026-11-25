# RFP requirements and compliance matrix

## Goal

Convert an RFP or solicitation into traceable requirements and show how each requirement is addressed in the proposal.

## Proposed tools

- `unw_analyze_rfp_requirements` — create an extraction job from supplied text or attachment.
- `unw_list_compliance_requirements` — list requirements with filters and confidence.
- `unw_update_compliance_requirement` — correct wording, type, priority, source location, or due date.
- `unw_map_requirement_to_section` — link a requirement to one or more proposal sections.
- `unw_add_requirement_evidence` — attach a section, attachment, library item, or note as evidence.
- `unw_get_compliance_matrix` — return coverage, gaps, conflicts, and unresolved low-confidence items.
- `unw_sign_off_compliance` — record a human compliance review.

## Requirement fields

`requirementId`, `proposalId`, `sourceReference`, `text`, `requirementType`, `priority`, `mandatory`, `ownerId`, `dueAt`, `status`, `confidence`, `mappedSectionIds`, `evidenceIds`, and `reviewNote`.

Requirement types include `deliverable`, `qualification`, `format`, `commercial`, `legal`, `security`, `schedule`, and `question`.

Statuses are `unmapped`, `in_progress`, `addressed`, `partially_addressed`, `not_applicable`, and `accepted_risk`.

## Rules

- Extraction creates proposed requirements; it never creates an approved compliance result.
- Preserve source page, paragraph, or attachment coordinates when available.
- Mandatory requirements with no accepted mapping block a compliance sign-off.
- A section mapping is not evidence until the section has content and the reviewer confirms it.
- Conflicting or duplicated requirements should be flagged, not silently merged.
