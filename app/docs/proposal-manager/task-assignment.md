# Proposal task assignment

## Goal

Give proposal managers a single orchestration layer for assigning section owners and reviewers, tracking due dates, and seeing whether a proposal can meet its deadline.

## Proposed tools

- `unw_assign_proposal_task` — create or reassign a task for a proposal, section, or compliance requirement.
- `unw_list_proposal_tasks` — filter by proposal, owner, status, due date, or overdue state.
- `unw_update_proposal_task` — change owner, due date, status, priority, or dependency.
- `unw_complete_proposal_task` — complete with an optional note and evidence link.
- `unw_get_proposal_workload` — summarize assignments by contributor and time window.

## Required fields

`proposalId`, `title`, `taskType`, `ownerId`, `createdBy`, `status`, `priority`, `dueAt`, `sectionId?`, `requirementId?`, `dependsOnTaskId?`, `completedAt?`, and `note?`.

Statuses should be `open`, `in_progress`, `blocked`, `submitted`, `completed`, and `cancelled`. A task must not be completed on behalf of another contributor without an auditable actor identity.

## Rules

- One active task may own a section at a time, but multiple reviewers may be assigned.
- Due dates are proposal-local and must display in the user’s timezone.
- Reassignment preserves the prior owner and reason in task history.
- Overdue notifications are reminders, not automatic status changes.
- Completing a task does not automatically approve or lock a section.
- Dependencies should surface blockers without preventing a manager from making an explicit override.
