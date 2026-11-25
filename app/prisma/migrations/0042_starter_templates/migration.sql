-- Starter templates: four ready-made shapes for common engagements, built from the node library.
-- Rows only; staff can edit or deactivate them. 'standard' is unchanged.
INSERT INTO "proposal_template" ("code", "name", "description", "sort_order") VALUES
  ('fixed_bid', 'Fixed-bid project', 'A defined deliverable for an agreed price: scope, hours, price and options, milestones, schedule, terms, and the summary, approach, and success sections.', 20),
  ('tm_retainer', 'Time and materials retainer', 'Ongoing work billed against a block of hours: scope, hours, price, schedule, terms, and the summary, approach, and service levels sections.', 30),
  ('discovery', 'Discovery engagement', 'A short paid study before a larger build: scope, hours, price, schedule, terms, and the summary, background, approach, and success sections.', 40),
  ('data_migration', 'Data migration', 'Moving data between systems: scope, hours, price, milestones, schedule, terms, and the summary, background, approach, data migration, security, and training sections.', 50)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "proposal_template_node" ("template_code", "node_key", "sort_order", "parent_key") VALUES
  ('fixed_bid', 'scope', 10, NULL), ('fixed_bid', 'hours', 20, 'scope'), ('fixed_bid', 'price', 30, 'hours'), ('fixed_bid', 'options', 35, 'price'),
  ('fixed_bid', 'milestones', 40, 'scope'), ('fixed_bid', 'schedule', 50, NULL), ('fixed_bid', 'terms', 60, NULL),
  ('fixed_bid', 'executive_summary', 70, NULL), ('fixed_bid', 'approach', 90, NULL), ('fixed_bid', 'success_metrics', 100, NULL),

  ('tm_retainer', 'scope', 10, NULL), ('tm_retainer', 'hours', 20, 'scope'), ('tm_retainer', 'price', 30, 'hours'),
  ('tm_retainer', 'schedule', 50, NULL), ('tm_retainer', 'terms', 60, NULL),
  ('tm_retainer', 'executive_summary', 70, NULL), ('tm_retainer', 'approach', 90, NULL), ('tm_retainer', 'service_levels', 130, NULL),

  ('discovery', 'scope', 10, NULL), ('discovery', 'hours', 20, 'scope'), ('discovery', 'price', 30, 'hours'),
  ('discovery', 'schedule', 50, NULL), ('discovery', 'terms', 60, NULL),
  ('discovery', 'executive_summary', 70, NULL), ('discovery', 'background', 80, NULL), ('discovery', 'approach', 90, NULL), ('discovery', 'success_metrics', 100, NULL),

  ('data_migration', 'scope', 10, NULL), ('data_migration', 'hours', 20, 'scope'), ('data_migration', 'price', 30, 'hours'),
  ('data_migration', 'milestones', 40, 'scope'), ('data_migration', 'schedule', 50, NULL), ('data_migration', 'terms', 60, NULL),
  ('data_migration', 'executive_summary', 70, NULL), ('data_migration', 'background', 80, NULL), ('data_migration', 'approach', 90, NULL),
  ('data_migration', 'security', 110, NULL), ('data_migration', 'data_migration', 120, NULL), ('data_migration', 'training', 140, NULL)
ON CONFLICT DO NOTHING;