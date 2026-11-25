-- Proposal review agent: data-driven checks that turn a proposal's parts (narrative text, or a
-- field_path into the proposal's scope, timeline, or pricing json) into
-- per-section scores, issues, and suggestions. Each failed rule subtracts its weight from 100.
CREATE TABLE "proposal_review_rule" (
  "code" TEXT NOT NULL,
  "node_key" TEXT NOT NULL,
  "check" TEXT NOT NULL,
  "field_path" TEXT,
  "min_chars" INTEGER,
  "min_items" INTEGER,
  "pattern" TEXT,
  "severity" TEXT NOT NULL,
  "weight" INTEGER NOT NULL,
  "message" TEXT NOT NULL,
  "suggestion" TEXT NOT NULL,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "proposal_review_rule_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "proposal_review_rule_node_key_fkey" FOREIGN KEY ("node_key") REFERENCES "proposal_node_template"("key") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "proposal_review_rule_check_check" CHECK ("check" IN ('missing', 'min_chars', 'min_items', 'pattern', 'state_open')),
  CONSTRAINT "proposal_review_rule_severity_check" CHECK ("severity" IN ('issue', 'suggestion')),
  CONSTRAINT "proposal_review_rule_weight_check" CHECK ("weight" BETWEEN 0 AND 100)
);

INSERT INTO "proposal_review_rule" ("code","node_key","check","min_chars","pattern","severity","weight","message","suggestion","sort") VALUES
  ('exec_missing','executive_summary','missing',NULL,NULL,'issue',60,'The executive summary is empty.','Write two or three short paragraphs: the need, what will be delivered, and why this engagement fits.',10),
  ('exec_short','executive_summary','min_chars',200,NULL,'suggestion',25,'The executive summary is very short.','Add what will be delivered and why it matters to the client.',20),
  ('exec_price','executive_summary','pattern',NULL,'(\$\s?\d|\b\d+\s?(hours|hrs)\b)','issue',30,'The executive summary mentions price or hours.','Remove hours and price; staff set those in the pricing part.',30),
  ('bg_missing','background','missing',NULL,NULL,'issue',60,'The problem and background section is empty.','Describe the current situation, what it costs the client, and what has been tried.',40),
  ('bg_short','background','min_chars',200,NULL,'suggestion',25,'The background is very short.','Add what the problem costs the client today.',50),
  ('approach_missing','approach','missing',NULL,NULL,'issue',60,'The approach section is empty.','Explain the method, phases, and how the client stays involved.',60),
  ('approach_short','approach','min_chars',300,NULL,'suggestion',25,'The approach is very short.','Describe each phase and how the client reviews the work.',70),
  ('approach_price','approach','pattern',NULL,'(\$\s?\d|\b\d+\s?(hours|hrs)\b)','issue',30,'The approach mentions price or hours.','Describe the work, not the schedule or price.',80),
  ('metrics_missing','success_metrics','missing',NULL,NULL,'issue',60,'There are no success metrics.','List measurable outcomes or acceptance signals the client agrees with.',90),
  ('metrics_short','success_metrics','min_chars',150,NULL,'suggestion',25,'The success metrics are very thin.','Add at least one measurable outcome.',100)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "proposal_review_rule" ("code","node_key","check","field_path","min_chars","min_items","severity","weight","message","suggestion","sort") VALUES
  ('scope_summary_missing','scope','missing','scope.summary',NULL,NULL,'issue',50,'The scope has no summary.','Say in a sentence or two what the engagement will deliver.',110),
  ('scope_summary_short','scope','min_chars','scope.summary',80,NULL,'suggestion',15,'The scope summary is very short.','Add who uses the result and what changes for them.',120),
  ('scope_deliverables_missing','scope','missing','scope.deliverables',NULL,NULL,'issue',40,'The scope lists no deliverables.','List each thing the client will receive.',130),
  ('scope_assumptions_missing','scope','missing','scope.assumptions',NULL,NULL,'suggestion',15,'The scope states no assumptions.','Note what the client provides, such as access or credentials.',140),
  ('scope_exclusions_missing','scope','missing','scope.exclusions',NULL,NULL,'suggestion',15,'The scope states no exclusions.','Say what is out of scope so both sides agree on the edges.',150),
  ('timeline_start_missing','schedule','missing','timeline.startDate',NULL,NULL,'issue',30,'The timeline has no start date.','Add a proposed start date.',160),
  ('timeline_target_missing','schedule','missing','timeline.targetDate',NULL,NULL,'issue',40,'The timeline has no target date.','Add the date the client needs the work done by.',170),
  ('timeline_milestones_missing','schedule','missing','timeline.milestones',NULL,NULL,'suggestion',15,'The timeline has no milestones.','Staff can add checkpoints; the client can say which dates matter.',180),
  ('pricing_model_missing','price','missing','pricing.model',NULL,NULL,'issue',50,'No pricing model is chosen.','Pick one pricing model from the catalog; staff set the amount.',190),
  ('price_staff_open','price','state_open',NULL,NULL,NULL,'suggestion',20,'Staff have not set the price yet.','Hand pricing to staff; the agent never sets hours or price.',200)
ON CONFLICT ("code") DO NOTHING;

-- Try me: the build_submit plan reviews the draft before submitting, so the review tool stays covered.
INSERT INTO "try_me_task_call" ("task_id","seq","tool_name","arguments","capture","expect","note") VALUES
  ('7d0f0001-0000-4000-8000-000000000005', 6, 'unw_review_proposal', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Review the draft section by section')
ON CONFLICT DO NOTHING;
