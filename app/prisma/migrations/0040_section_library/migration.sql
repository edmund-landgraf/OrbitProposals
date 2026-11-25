-- Reusable section library: optional narrative sections (security, data migration, SLA, training)
-- that staff or the agent add to a proposal when the engagement needs them. Each is a node template
-- with its own section spec (guidance, length) and review rules; the library row says it is offered.
-- They are not part of any template, so existing proposals and 'standard' are unchanged.
CREATE TABLE "proposal_section_library" (
  "node_key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "proposal_section_library_pkey" PRIMARY KEY ("node_key"),
  CONSTRAINT "proposal_section_library_node_key_fkey" FOREIGN KEY ("node_key") REFERENCES "proposal_node_template"("key") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "proposal_node_template" ("key", "kind", "title", "client_label", "sort_order", "parent_key") VALUES
  ('security', 'section', 'Security and access', 'security and access', 110, NULL),
  ('data_migration', 'section', 'Data migration', 'data migration', 120, NULL),
  ('service_levels', 'section', 'Service levels and support', 'service levels and support', 130, NULL),
  ('training', 'section', 'Training and handover', 'training and handover', 140, NULL)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "proposal_section_spec" ("node_key", "guidance", "max_chars", "written_state") VALUES
  ('security', 'How client systems and data are protected: what access is needed, who holds it, how credentials and sensitive data are handled, and any compliance the client must meet. Never state hours or price.', 4000, 'drafted'),
  ('data_migration', 'What data moves from where to where: sources, rough volume, cleanup and mapping, how it is verified, and how the cutover and rollback work. Never state hours or price.', 5000, 'drafted'),
  ('service_levels', 'What support looks like once the work is live: response times, hours of coverage, how issues are reported, and what counts as urgent. Never state hours or price.', 3000, 'drafted'),
  ('training', 'How the client''s people learn the result: who is trained, in what format, what documentation they receive, and when ownership passes to them. Never state hours or price.', 3000, 'drafted')
ON CONFLICT ("node_key") DO NOTHING;

INSERT INTO "proposal_section_library" ("node_key", "category", "description", "sort_order") VALUES
  ('security', 'risk', 'For work that touches client systems, credentials, or sensitive data.', 10),
  ('data_migration', 'delivery', 'For engagements that move data between systems.', 20),
  ('service_levels', 'support', 'For engagements with ongoing support after delivery.', 30),
  ('training', 'delivery', 'For work the client''s staff will run themselves afterward.', 40)
ON CONFLICT ("node_key") DO NOTHING;

INSERT INTO "proposal_review_rule" ("code","node_key","check","min_chars","pattern","severity","weight","message","suggestion","sort") VALUES
  ('security_missing','security','missing',NULL,NULL,'issue',60,'The security section is empty.','Say what access is needed, who holds it, and how sensitive data is handled.',210),
  ('security_short','security','min_chars',200,NULL,'suggestion',25,'The security section is very short.','Add how credentials are stored and revoked when the work ends.',220),
  ('security_price','security','pattern',NULL,'(\$\s?\d|\b\d+\s?(hours|hrs)\b)','issue',30,'The security section mentions price or hours.','Remove hours and price; staff set those in the pricing part.',230),
  ('migration_missing','data_migration','missing',NULL,NULL,'issue',60,'The data migration section is empty.','Name the data sources, the destination, and how the move is verified.',240),
  ('migration_short','data_migration','min_chars',250,NULL,'suggestion',25,'The data migration section is very short.','Add how cutover works and how to roll back if something goes wrong.',250),
  ('migration_price','data_migration','pattern',NULL,'(\$\s?\d|\b\d+\s?(hours|hrs)\b)','issue',30,'The data migration section mentions price or hours.','Remove hours and price; staff set those in the pricing part.',260),
  ('sla_missing','service_levels','missing',NULL,NULL,'issue',60,'The service levels section is empty.','State response times, coverage hours, and how issues are reported.',270),
  ('sla_short','service_levels','min_chars',150,NULL,'suggestion',25,'The service levels section is very short.','Say what counts as urgent and how fast it gets a response.',280),
  ('sla_price','service_levels','pattern',NULL,'(\$\s?\d|\b\d+\s?(hours|hrs)\b)','issue',30,'The service levels section mentions price or hours.','Remove hours and price; staff set those in the pricing part.',290),
  ('training_missing','training','missing',NULL,NULL,'issue',60,'The training section is empty.','Say who is trained, how, and what documentation they keep.',300),
  ('training_short','training','min_chars',150,NULL,'suggestion',25,'The training section is very short.','Add when ownership passes to the client''s team.',310),
  ('training_price','training','pattern',NULL,'(\$\s?\d|\b\d+\s?(hours|hrs)\b)','issue',30,'The training section mentions price or hours.','Remove hours and price; staff set those in the pricing part.',320)
ON CONFLICT ("code") DO NOTHING;