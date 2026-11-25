# Template governance

## Goal

Allow authorized staff to create, revise, publish, and retire proposal templates without destabilizing proposals already in progress.

## Proposed tools

- `unw_create_proposal_template` — create a draft template with ordered nodes and defaults.
- `unw_update_proposal_template` — edit draft metadata, nodes, sample content, and policy references.
- `unw_validate_proposal_template` — check duplicate keys, missing required nodes, invalid section types, and pricing references.
- `unw_publish_proposal_template` — publish a validated immutable version.
- `unw_archive_proposal_template` — prevent new use while retaining history.
- `unw_get_proposal_template_versions` — inspect changes and adoption.

## Rules

- Published versions are immutable; editing creates a new draft version.
- Existing proposals remain pinned to their selected template version unless a manager explicitly migrates them.
- A template declares required sections, suggested sections, section limits, default review rules, pricing model, and optional package definitions.
- Publishing requires a policy owner and validation result.
- Archive is non-destructive and must not remove a template from historical proposal reads or exports.

## Policy configuration

Template governance should eventually support organization-level rules for required approvals, compliance sign-off, pricing approval thresholds, expiry windows, and allowed client-facing sections. Policy versions must be referenced by the proposal and decision audit events.
