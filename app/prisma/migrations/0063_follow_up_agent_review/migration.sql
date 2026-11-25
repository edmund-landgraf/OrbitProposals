-- Submitted proposals wait in agent_review before a human looks at them, but the follow-up queue had no reason row for
-- that state, so unw_list_follow_up_queue skipped every freshly submitted proposal. Numbered 0063 to leave 0061-0062 to
-- the open agreed-state PR (#95).
INSERT INTO "follow_up_reason" ("code", "kind", "review_state", "label", "base_weight", "unit_weight", "threshold_days", "sort_order") VALUES
    ('agent_review', 'review_state', 'agent_review', 'Submitted; waiting on review', 45, 10, NULL, 5)
ON CONFLICT ("code") DO NOTHING;
