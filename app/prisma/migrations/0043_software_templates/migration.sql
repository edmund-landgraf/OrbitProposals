-- End-to-end software templates: the four most requested software engagements (custom web or SaaS app,
-- mobile app, AI or machine learning solution, legacy modernization and integration). Each template ships
-- its parts, sample content (narrative, scope, milestones), optional option packages without prices,
-- a suggested pricing model, and its own review rules. All rows; staff can edit or deactivate them.
-- Hours and price are never in sample content: staff set them in the pricing part.

ALTER TABLE "proposal_template" ADD COLUMN "suggested_pricing_model" TEXT;

-- Review rules can be scoped to one template; NULL keeps a rule global.
ALTER TABLE "proposal_review_rule" ADD COLUMN "template_code" TEXT;
ALTER TABLE "proposal_review_rule" ADD CONSTRAINT "proposal_review_rule_template_code_fkey" FOREIGN KEY ("template_code") REFERENCES "proposal_template"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sample content for one part of a template. Narrative sections hold { "text" }; scope holds the scope
-- object; schedule holds { "milestones": [{ "title", "description", "weekOffset" }] } relative to the start.
CREATE TABLE "proposal_template_sample" (
  "template_code" TEXT NOT NULL,
  "node_key" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  CONSTRAINT "proposal_template_sample_pkey" PRIMARY KEY ("template_code", "node_key"),
  CONSTRAINT "proposal_template_sample_template_code_fkey" FOREIGN KEY ("template_code") REFERENCES "proposal_template"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "proposal_template_sample_node_key_fkey" FOREIGN KEY ("node_key") REFERENCES "proposal_node_template"("key") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Option packages a template suggests. No prices: staff price an option when they add it to a proposal.
CREATE TABLE "proposal_template_option" (
  "template_code" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "selection" TEXT NOT NULL DEFAULT 'optional',
  CONSTRAINT "proposal_template_option_pkey" PRIMARY KEY ("template_code", "code"),
  CONSTRAINT "proposal_template_option_template_code_fkey" FOREIGN KEY ("template_code") REFERENCES "proposal_template"("code") ON DELETE CASCADE ON UPDATE CASCADE
);

-- New library sections the software templates need.
INSERT INTO "proposal_node_template" ("key", "kind", "title", "client_label", "sort_order", "parent_key") VALUES
  ('integrations', 'section', 'Systems and integrations', 'systems and integrations', 150, NULL),
  ('app_release', 'section', 'App store release', 'app store release', 160, NULL),
  ('ai_evaluation', 'section', 'Model evaluation and safety', 'model evaluation and safety', 170, NULL)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "proposal_section_spec" ("node_key", "guidance", "max_chars", "written_state") VALUES
  ('integrations', 'Which systems connect and how: each system, the direction data flows, the API or file method, who owns each side, and how failures are retried and reported. Never state hours or price.', 5000, 'drafted'),
  ('app_release', 'How the app reaches users: target platforms and OS versions, developer accounts, store review, beta testing, and who owns the store listings afterward. Never state hours or price.', 3000, 'drafted'),
  ('ai_evaluation', 'How the model is judged good enough and kept safe: the evaluation set, target metrics, human review, handling of sensitive data, and monitoring for drift after launch. Never state hours or price.', 5000, 'drafted')
ON CONFLICT ("node_key") DO NOTHING;

INSERT INTO "proposal_section_library" ("node_key", "category", "description", "sort_order") VALUES
  ('integrations', 'delivery', 'For work that connects two or more systems through APIs or files.', 50),
  ('app_release', 'delivery', 'For mobile apps published to the App Store or Google Play.', 60),
  ('ai_evaluation', 'risk', 'For work that ships a machine learning or generative AI model.', 70)
ON CONFLICT ("node_key") DO NOTHING;

INSERT INTO "proposal_review_rule" ("code","node_key","check","min_chars","pattern","severity","weight","message","suggestion","sort") VALUES
  ('integrations_missing','integrations','missing',NULL,NULL,'issue',60,'The systems and integrations section is empty.','List each system, which way data flows, and how failures are handled.',330),
  ('integrations_short','integrations','min_chars',250,NULL,'suggestion',25,'The systems and integrations section is very short.','Add who owns each side of every connection.',340),
  ('integrations_price','integrations','pattern',NULL,'(\$\s?\d|\b\d+\s?(hours|hrs)\b)','issue',30,'The systems and integrations section mentions price or hours.','Remove hours and price; staff set those in the pricing part.',350),
  ('release_missing','app_release','missing',NULL,NULL,'issue',60,'The app store release section is empty.','Name the platforms, store accounts, and how beta testing works.',360),
  ('release_short','app_release','min_chars',150,NULL,'suggestion',25,'The app store release section is very short.','Say who owns the store listings after launch.',370),
  ('release_price','app_release','pattern',NULL,'(\$\s?\d|\b\d+\s?(hours|hrs)\b)','issue',30,'The app store release section mentions price or hours.','Remove hours and price; staff set those in the pricing part.',380),
  ('ai_eval_missing','ai_evaluation','missing',NULL,NULL,'issue',60,'The model evaluation and safety section is empty.','Say how the model is measured, who reviews its output, and how sensitive data is handled.',390),
  ('ai_eval_short','ai_evaluation','min_chars',250,NULL,'suggestion',25,'The model evaluation and safety section is very short.','Add the target metrics and how drift is watched after launch.',400),
  ('ai_eval_price','ai_evaluation','pattern',NULL,'(\$\s?\d|\b\d+\s?(hours|hrs)\b)','issue',30,'The model evaluation and safety section mentions price or hours.','Remove hours and price; staff set those in the pricing part.',410)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "proposal_template" ("code", "name", "description", "sort_order", "suggested_pricing_model") VALUES
  ('web_app', 'Custom web or SaaS application', 'A new web application or SaaS product: discovery, design, build, launch, and support, with security and service levels.', 60, 'fixed_price'),
  ('mobile_app', 'Mobile app', 'An iOS and Android app, usually cross-platform, with its backend, store release, and support.', 70, 'fixed_price'),
  ('ai_solution', 'AI or machine learning solution', 'A machine learning or generative AI feature taken from proof of concept to production, with evaluation, safety, and training.', 80, 'hourly'),
  ('modernization', 'Legacy modernization and integration', 'Moving a legacy system to a modern platform and connecting it to the systems around it, with data migration and cutover.', 90, 'fixed_price')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "proposal_template_node" ("template_code", "node_key", "sort_order", "parent_key")
SELECT t.code, n.key, n.sort, n.parent FROM (VALUES ('web_app'), ('mobile_app'), ('ai_solution'), ('modernization')) AS t(code)
CROSS JOIN (VALUES ('scope', 10, NULL), ('hours', 20, 'scope'), ('price', 30, 'hours'), ('options', 35, 'price'), ('milestones', 40, 'scope'),
  ('schedule', 50, NULL), ('terms', 60, NULL), ('executive_summary', 70, NULL), ('background', 80, NULL), ('approach', 90, NULL), ('success_metrics', 100, NULL)) AS n(key, sort, parent)
ON CONFLICT DO NOTHING;

INSERT INTO "proposal_template_node" ("template_code", "node_key", "sort_order", "parent_key") VALUES
  ('web_app', 'security', 110, NULL), ('web_app', 'service_levels', 130, NULL),
  ('mobile_app', 'security', 110, NULL), ('mobile_app', 'service_levels', 130, NULL), ('mobile_app', 'app_release', 160, NULL),
  ('ai_solution', 'security', 110, NULL), ('ai_solution', 'training', 140, NULL), ('ai_solution', 'ai_evaluation', 170, NULL),
  ('modernization', 'security', 110, NULL), ('modernization', 'data_migration', 120, NULL), ('modernization', 'training', 140, NULL), ('modernization', 'integrations', 150, NULL)
ON CONFLICT DO NOTHING;

-- Template-scoped review rules for scope, timeline, and pricing.
INSERT INTO "proposal_review_rule" ("code","node_key","check","field_path","min_items","pattern","severity","weight","message","suggestion","sort","template_code") VALUES
  ('web_scope_deliverables','scope','min_items','scope.deliverables',4,NULL,'issue',30,'A web application scope should list at least four deliverables.','List design, the application itself, its admin tools, and launch as separate deliverables.',500,'web_app'),
  ('web_milestones','schedule','min_items','timeline.milestones',4,NULL,'issue',30,'A web application timeline should have at least four milestones.','Add discovery, design sign-off, beta, and launch checkpoints.',510,'web_app'),
  ('web_pricing_check','price','pattern','pricing.model',NULL,'^workflow_check$','suggestion',20,'A workflow check is too small for a full web application.','Use a fixed price for a defined build, or hourly while scope is still moving.',520,'web_app'),
  ('mobile_scope_platforms','scope','pattern','scope.summary',NULL,'^(?!.*(ios|android|cross-platform)).*$','issue',30,'The mobile scope does not say which platforms are covered.','Say whether the app targets iOS, Android, or both.',530,'mobile_app'),
  ('mobile_scope_deliverables','scope','min_items','scope.deliverables',4,NULL,'issue',30,'A mobile app scope should list at least four deliverables.','List design, the app, its backend, and store release separately.',540,'mobile_app'),
  ('mobile_milestones','schedule','min_items','timeline.milestones',4,NULL,'issue',30,'A mobile app timeline should have at least four milestones.','Add design sign-off, beta, store submission, and launch checkpoints.',550,'mobile_app'),
  ('mobile_pricing_check','price','pattern','pricing.model',NULL,'^workflow_check$','suggestion',20,'A workflow check is too small for a mobile app.','Use a fixed price for a defined app, or hourly while scope is still moving.',560,'mobile_app'),
  ('ai_scope_exclusions','scope','min_items','scope.exclusions',1,NULL,'issue',30,'An AI scope must say what the model will not do.','List decisions that stay with people and data the model never sees.',570,'ai_solution'),
  ('ai_milestones','schedule','min_items','timeline.milestones',3,NULL,'issue',30,'An AI timeline should have at least three milestones.','Add proof of concept, evaluation sign-off, and production launch.',580,'ai_solution'),
  ('ai_pricing_check','price','pattern','pricing.model',NULL,'^workflow_check$','suggestion',20,'A workflow check is too small for an AI build.','Use hourly for exploratory model work, or a fixed price once the proof of concept is signed off.',590,'ai_solution'),
  ('mod_scope_assumptions','scope','min_items','scope.assumptions',2,NULL,'issue',30,'A modernization scope should state at least two assumptions.','Note access to the legacy system and who knows its data.',600,'modernization'),
  ('mod_milestones','schedule','min_items','timeline.milestones',4,NULL,'issue',30,'A modernization timeline should have at least four milestones.','Add assessment, first integration, trial migration, and cutover.',610,'modernization'),
  ('mod_pricing_check','price','pattern','pricing.model',NULL,'^workflow_check$','suggestion',20,'A workflow check is too small for a modernization.','Use a fixed price per phase, or hourly for the assessment.',620,'modernization')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "proposal_template_option" ("template_code", "code", "sort_order", "label", "description", "selection") VALUES
  ('web_app', 'mvp', 10, 'MVP launch', 'The smallest product that proves the idea with real users; later features move to a second phase.', 'optional'),
  ('web_app', 'sso', 20, 'Single sign-on', 'Sign-in through the client''s identity provider, such as Microsoft Entra ID or Google Workspace.', 'optional'),
  ('web_app', 'support_plan', 30, 'Post-launch support plan', 'Ongoing fixes, updates, and monitoring after launch under the service levels section.', 'optional'),
  ('mobile_app', 'second_platform', 10, 'Second platform', 'Ship on both iOS and Android instead of one platform first.', 'optional'),
  ('mobile_app', 'offline_mode', 20, 'Offline mode', 'The app keeps working without a connection and syncs when it is back online.', 'optional'),
  ('mobile_app', 'support_plan', 30, 'Post-launch support plan', 'OS updates, store compliance, and fixes after launch.', 'optional'),
  ('ai_solution', 'poc_only', 10, 'Proof of concept only', 'Stop after the proof of concept and its evaluation report, before a production build.', 'optional'),
  ('ai_solution', 'human_review', 20, 'Human review console', 'A screen where staff approve or correct model output before it reaches customers.', 'optional'),
  ('ai_solution', 'monitoring', 30, 'Model monitoring', 'Ongoing drift and quality monitoring with a monthly report.', 'optional'),
  ('modernization', 'phased_cutover', 10, 'Phased cutover', 'Move one module or region at a time instead of a single cutover weekend.', 'optional'),
  ('modernization', 'extra_integration', 20, 'Additional integration', 'Connect one more system beyond those named in the scope.', 'optional'),
  ('modernization', 'archive', 30, 'Legacy data archive', 'A read-only archive of the old system for audit and lookup after cutover.', 'optional')
ON CONFLICT DO NOTHING;
-- Sample content. The agent or staff copy it into a proposal and then tailor it to the client.
INSERT INTO "proposal_template_sample" ("template_code", "node_key", "content") VALUES
('web_app', 'scope', $j${"summary": "Design, build, and launch a custom web application that replaces spreadsheets and email with one shared system for the client's staff and customers.", "deliverables": ["Discovery report and clickable prototype", "Production web application with role-based access", "Admin tools for managing users and content", "Launch, handover documentation, and a recorded walkthrough"], "assumptions": ["The client names one product owner who can make decisions within two business days.", "The client provides access to existing data and brand assets in the first week."], "exclusions": ["Native mobile apps", "Migration of more than one legacy data source"]}$j$),
('web_app', 'schedule', $j${"milestones": [{"title": "Discovery complete", "description": "Workflows mapped and the prototype approved.", "weekOffset": 2}, {"title": "Design sign-off", "description": "Screens and data model approved by the product owner.", "weekOffset": 4}, {"title": "Beta release", "description": "Working application in a staging environment for client testing.", "weekOffset": 10}, {"title": "Launch", "description": "Production release and handover.", "weekOffset": 14}]}$j$),
('web_app', 'executive_summary', $j${"text": "Your team runs a core workflow across spreadsheets, inboxes, and memory, which makes it slow to serve customers and hard to see what is happening. We will design and build a custom web application that puts that workflow in one place, with the right access for staff and customers. You get a working product in staged releases, so you can test it with real users before launch and steer what comes next."}$j$),
('web_app', 'background', $j${"text": "Today the work is tracked in shared spreadsheets and email threads. Requests get lost, two people sometimes update the same record, and nobody can see the full status without asking around. Off-the-shelf tools were tried but did not fit how the team actually works, so a custom application built around the real process is the better path."}$j$),
('web_app', 'approach', $j${"text": "We work in four phases. Discovery maps the workflow with the people who do it and ends with a clickable prototype. Design settles the screens and the data model, and the product owner signs off before build starts. Build runs in short iterations with a demo at the end of each one, so you see progress and can change priorities early. Launch covers a beta in staging, fixes from your testing, the production release, and a handover with documentation and a recorded walkthrough."}$j$),
('web_app', 'success_metrics', $j${"text": "Success means every request in the workflow is tracked in the application instead of spreadsheets, staff can see the status of any record in one screen, and the product owner accepts the beta against the agreed deliverables before launch."}$j$),
('web_app', 'security', $j${"text": "The application uses role-based access so staff and customers only see what they should. We work in client-owned hosting and source control accounts, keep credentials in a secrets manager rather than in code, encrypt data in transit and at rest, and remove our access when the engagement ends. Any compliance needs, such as data residency, are confirmed in discovery."}$j$),
('web_app', 'service_levels', $j${"text": "After launch, issues are reported through a shared support channel. Anything that stops users from working is treated as urgent and gets a response the same business day; other issues are triaged within two business days and scheduled into the next release."}$j$),

('mobile_app', 'scope', $j${"summary": "Design and build a cross-platform mobile app for iOS and Android, with the backend it needs, and publish it to the App Store and Google Play.", "deliverables": ["UX design and an interactive prototype", "Cross-platform mobile app for iOS and Android", "Backend API and admin console", "App Store and Google Play release with store listings"], "assumptions": ["The client owns or creates Apple and Google developer accounts.", "The client provides brand assets and store listing copy approval."], "exclusions": ["Wearable or tablet-specific layouts", "Ongoing marketing of the app"]}$j$),
('mobile_app', 'schedule', $j${"milestones": [{"title": "Design sign-off", "description": "Prototype and screen designs approved.", "weekOffset": 4}, {"title": "Beta build", "description": "TestFlight and Play internal testing build for client users.", "weekOffset": 10}, {"title": "Store submission", "description": "Release builds submitted for store review.", "weekOffset": 13}, {"title": "Public launch", "description": "App live in both stores and handed over.", "weekOffset": 15}]}$j$),
('mobile_app', 'executive_summary', $j${"text": "Your customers want to reach you from their phones, and a mobile site alone is not giving them a fast, reliable experience. We will design and build one cross-platform app for iOS and Android, with the backend it needs, and take it through store review to launch. Beta builds reach your own users early so the app is shaped by real feedback before it goes public."}$j$),
('mobile_app', 'background', $j${"text": "Customers currently use a mobile web page that is slow on poor connections and cannot send notifications. Support hears the same complaints every week, and competitors already offer an app. The client wants one codebase for both platforms so that features ship to every customer at the same time."}$j$),
('mobile_app', 'approach', $j${"text": "We start with UX design and an interactive prototype that your team can tap through on a phone. After design sign-off we build the app and its backend in short iterations, sharing a TestFlight and Google Play internal testing build at the end of each one. Before submission we run device testing across supported OS versions, prepare store listings with you, and handle store review feedback through to public launch and handover."}$j$),
('mobile_app', 'success_metrics', $j${"text": "Success means the app is approved and live in both stores, beta users complete the core task without help, crash-free sessions stay above the target agreed in design, and the product owner accepts the release against the deliverables."}$j$),
('mobile_app', 'security', $j${"text": "The app stores tokens in the platform keychain, never in plain storage, and talks to the backend only over encrypted connections. Signing keys and store credentials stay in client-owned accounts. Personal data collected by the app is listed in the store privacy disclosures, and our access is removed when the engagement ends."}$j$),
('mobile_app', 'service_levels', $j${"text": "After launch we watch crash reports and store reviews. A crash affecting many users is urgent and gets a response the same business day; other issues are triaged within two business days. Required OS and store policy updates are scheduled ahead of their deadlines."}$j$),
('mobile_app', 'app_release', $j${"text": "The app targets current and previous major versions of iOS and Android. Releases are published from the client's Apple and Google developer accounts. We run beta testing through TestFlight and Google Play internal testing, respond to store review feedback, and hand over store listing ownership at launch."}$j$),

('ai_solution', 'scope', $j${"summary": "Take an AI feature from proof of concept to production: prove it works on the client's own data, then build it into their workflow with evaluation, human review, and monitoring.", "deliverables": ["Proof of concept on a sample of client data", "Evaluation report against agreed metrics", "Production integration of the model into the client workflow", "Monitoring dashboard and staff training"], "assumptions": ["The client provides a representative, de-identified data sample in the first two weeks.", "A subject matter expert reviews model output during evaluation."], "exclusions": ["Fully automated decisions without human review", "Training a foundation model from scratch"]}$j$),
('ai_solution', 'schedule', $j${"milestones": [{"title": "Proof of concept", "description": "Model working on the sample data with a first evaluation.", "weekOffset": 4}, {"title": "Evaluation sign-off", "description": "Client accepts the evaluation report and go-live criteria.", "weekOffset": 7}, {"title": "Production launch", "description": "Model live in the workflow with monitoring and trained staff.", "weekOffset": 12}]}$j$),
('ai_solution', 'executive_summary', $j${"text": "Your team spends a large share of its day reading, sorting, and summarizing documents by hand. We will prove that an AI model can do the first pass on your own data, measure it honestly, and only then build it into your workflow with people reviewing its output. You decide at the proof of concept whether the results justify going to production."}$j$),
('ai_solution', 'background', $j${"text": "Incoming documents are triaged manually, which creates a backlog at busy times and inconsistent results between reviewers. Generic AI tools were tried, but they could not use the client's data safely or explain their answers well enough to be trusted, so a purpose-built, evaluated solution is needed."}$j$),
('ai_solution', 'approach', $j${"text": "We begin with a proof of concept on a de-identified sample of your data and agree the metrics that define good enough. An evaluation report compares the model to your current process, and you decide whether to continue. In production we integrate the model behind a human review step, add monitoring for quality and drift, and train your staff to read its output, correct it, and escalate when it is unsure."}$j$),
('ai_solution', 'success_metrics', $j${"text": "Success means the model meets the agreed accuracy target on the held-out evaluation set, reviewers accept most of its first-pass output without changes, the backlog at peak times falls, and every automated suggestion can be traced to its source document."}$j$),
('ai_solution', 'security', $j${"text": "Client data stays in client-controlled storage and is de-identified before any experimentation. We use model providers that do not train on submitted data, keep keys in a secrets manager, log every model call for audit, and remove our access when the engagement ends. Regulatory requirements are confirmed before any real data is used."}$j$),
('ai_solution', 'training', $j${"text": "Reviewers and their managers get a live session on how the model works, what its confidence means, and how to correct or escalate its output, plus a short written guide. Ownership of the monitoring dashboard passes to the client's team at launch."}$j$),
('ai_solution', 'ai_evaluation', $j${"text": "We build an evaluation set from labeled client examples and hold part of it back so results are not overstated. Target metrics, such as accuracy and the share of items needing correction, are agreed before the proof of concept. A subject matter expert reviews samples by hand, sensitive fields are masked, and after launch a dashboard tracks quality and drift with alerts when results fall below target."}$j$),

('modernization', 'scope', $j${"summary": "Move a legacy business system to a modern, supported platform and connect it to the systems around it, without disrupting daily operations.", "deliverables": ["Assessment of the legacy system and a migration plan", "Modern application on a supported platform", "Integrations with the named surrounding systems", "Data migration, cutover, and rollback plan"], "assumptions": ["The client provides read access to the legacy system and its database.", "Someone who knows the legacy data is available to answer questions during mapping."], "exclusions": ["Redesigning business processes beyond what the migration needs", "Integrations with systems not named in the plan"]}$j$),
('modernization', 'schedule', $j${"milestones": [{"title": "Assessment complete", "description": "Legacy system mapped and the migration plan approved.", "weekOffset": 3}, {"title": "First integration live", "description": "The new platform exchanges data with the first connected system.", "weekOffset": 8}, {"title": "Trial migration", "description": "Full data migration rehearsed and verified in staging.", "weekOffset": 12}, {"title": "Cutover", "description": "Production cutover with the rollback plan on standby.", "weekOffset": 15}]}$j$),
('modernization', 'executive_summary', $j${"text": "Your business depends on a legacy system that is hard to change, hard to staff, and disconnected from the tools around it. We will move it to a modern, supported platform and connect it to your other systems, rehearsing the data migration before cutover so daily operations keep running. You end up with a system your team can maintain and extend."}$j$),
('modernization', 'background', $j${"text": "The current system runs on an unsupported platform, only one or two people understand it, and staff re-key data between it and other systems every day. Each change is slow and risky. The client wants to modernize without a disruptive big-bang rewrite, keeping the business running throughout."}$j$),
('modernization', 'approach', $j${"text": "We start with an assessment of the legacy system, its data, and its connections, and agree a migration plan with you. We then build the modern application and its integrations in stages, connecting one surrounding system at a time. The data migration is rehearsed in staging and verified record by record before a planned production cutover with a tested rollback. Your team is trained to run the new system before we hand it over."}$j$),
('modernization', 'success_metrics', $j${"text": "Success means every in-scope record is migrated and reconciled against the legacy system, the named integrations run without manual re-keying, staff complete their daily tasks on the new platform, and the legacy system can be retired or archived."}$j$),
('modernization', 'security', $j${"text": "Legacy credentials are rotated at the start and stored in a secrets manager. Data moves only over encrypted connections, production data is masked in non-production environments, and access for each integration uses the least privilege it needs. Our access is removed after handover, and compliance needs are confirmed in the assessment."}$j$),
('modernization', 'data_migration', $j${"text": "Data moves from the legacy database to the new platform through a repeatable migration script. We profile the source data, agree mapping and cleanup rules with your data expert, and rehearse the full migration in staging. Each run is verified with record counts and spot checks, cutover happens in a planned window, and a rollback plan restores the legacy system if verification fails."}$j$),
('modernization', 'training', $j${"text": "Daily users get hands-on sessions on the new platform before cutover, and administrators get a deeper session on configuration and the integrations. Both receive written guides, and ownership passes to the client's team after a short supported period following cutover."}$j$),
('modernization', 'integrations', $j${"text": "Each surrounding system named in the plan is connected through its API where one exists, or through scheduled file exchange where it does not. For every connection we document which way data flows, who owns each side, and what happens when a call fails: failed exchanges are retried, logged, and reported to the client's administrator."}$j$)
ON CONFLICT DO NOTHING;
-- Try me exercise that builds a proposal end to end from one of these templates.
INSERT INTO "try_me_exercise" ("code", "sort", "title", "goal", "prompt") VALUES
  ('software_template', 25, 'Build from a software template', 'Pick a software template and take it to a proposal that passes review.', 'List the Unwhelm proposal templates and pick the mobile app template. Create a new proposal for a cross-platform iOS and Android app, apply the mobile app template, then fill scope, timeline (with a start date, a target date, and the template''s milestones), and every narrative section from the template samples, tailored to my app. Never set hours or price yourself. Review the proposal and fix anything the review calls an issue until it reports zero issues, then show me the score and progress.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "try_me_exercise_tool" ("exercise_code", "tool_name") VALUES
  ('software_template', 'unw_list_proposal_templates'),
  ('software_template', 'unw_create_proposal'),
  ('software_template', 'unw_set_proposal_template'),
  ('software_template', 'unw_update_proposal_section'),
  ('software_template', 'unw_review_proposal'),
  ('software_template', 'unw_get_proposal_progress')
ON CONFLICT DO NOTHING;
-- Seeded Try me plan: choose a template right after the draft is created, before reading progress.
UPDATE "try_me_task_call" SET "seq" = 4 WHERE "task_id" = '7d0f0001-0000-4000-8000-000000000003' AND "seq" = 2;
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0001-0000-4000-8000-000000000003', 2, 'unw_list_proposal_templates', '{}', '{}', 'ok', 'See the proposal templates'),
  ('7d0f0001-0000-4000-8000-000000000003', 3, 'unw_set_proposal_template', '{"proposalId": "{proposalId}", "code": "web_app"}', '{}', 'either', 'Build it from the web app template')
ON CONFLICT ("task_id", "seq") DO NOTHING;