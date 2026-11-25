# Governed content library

## Goal

Turn the current read-only section library into a searchable, reusable, and governed source of approved proposal content.

## Proposed tools

- `unw_upsert_content_library_item` — create a new item or draft a new version.
- `unw_get_content_library_item` — load the item and version history.
- `unw_search_content_library` — search by text, category, client label, industry, product, and status.
- `unw_submit_content_library_item` — submit a draft version for review.
- `unw_approve_content_library_item` — approve a version for reuse.
- `unw_archive_content_library_item` — remove an item from new recommendations without deleting history.
- `unw_insert_content_library_item` — copy an approved version into a proposal with provenance.

## Data model

An item has a stable key, title, category, tags, client-facing label, body or structured section value, guidance, owner, source, status, effective dates, and current approved version. Versions are immutable and include author, created time, change summary, approval event, and superseded-by relation.

Statuses are `draft`, `in_review`, `approved`, `rejected`, `expired`, and `archived`.

## Rules

- Only approved, non-expired versions may be inserted automatically.
- Inserting content copies it into the proposal; later library edits must not silently change an existing proposal.
- Recommendations must show why an item matched and its approval/expiry state.
- Client-specific content needs an explicit visibility classification.
- Reuse should record library item, version, proposal, section, and actor for later win/loss analysis.
