-- Follow-up queue reasons and their urgency weights are rows.
-- score = base_weight + unit_weight * units. units: days waiting (review_state), days inside the window (near_expiry), parked item count (parked_items).
CREATE TABLE "follow_up_reason" (
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "review_state" TEXT,
    "label" TEXT NOT NULL,
    "base_weight" INTEGER NOT NULL,
    "unit_weight" INTEGER NOT NULL DEFAULT 0,
    "threshold_days" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "follow_up_reason_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "follow_up_reason_kind_check" CHECK ("kind" IN ('review_state', 'near_expiry', 'parked_items')),
    CONSTRAINT "follow_up_reason_state_check" CHECK ("kind" <> 'review_state' OR "review_state" IS NOT NULL),
    CONSTRAINT "follow_up_reason_threshold_check" CHECK ("kind" <> 'near_expiry' OR "threshold_days" IS NOT NULL)
);

INSERT INTO "follow_up_reason" ("code", "kind", "review_state", "label", "base_weight", "unit_weight", "threshold_days", "sort_order") VALUES
    ('in_review', 'review_state', 'in_review', 'Waiting on staff review', 50, 10, NULL, 10),
    ('resubmitted', 'review_state', 'resubmitted', 'Resubmitted by the client', 50, 10, NULL, 20),
    ('changes_requested', 'review_state', 'changes_requested', 'Changes requested; check in with the client', 20, 3, NULL, 30),
    ('review_meeting_scheduled', 'review_state', 'review_meeting_scheduled', 'Review meeting scheduled', 30, 5, NULL, 40),
    ('near_expiry', 'near_expiry', NULL, 'Expires soon', 40, 8, 7, 50),
    ('parked_items', 'parked_items', NULL, 'Parked items for a follow-up proposal', 10, 5, NULL, 60)
ON CONFLICT ("code") DO NOTHING;
