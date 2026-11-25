/**
 * The /try Chat view's sample script: a canned, internally consistent conversation per plan, recorded once from a
 * sandbox run and stored here. Only the Chat view imports this file. The Live run view never reads it: it shows
 * real MCP results from /api/v1/public/demo.
 */
export type SampleCall = { request: string; tool: string; args: unknown; status: "ok" | "refused"; result?: unknown; error?: string | null; errorRaw?: string | null };
export type SampleSection = { title: string; narration: string; calls: SampleCall[] };
export type SamplePlan = { code: string; title: string; description: string; sections: SampleSection[] };

export const samplePlans: SamplePlan[] = [
 {
  "code": "build_submit",
  "title": "Build and submit a proposal",
  "description": "An agent drafts a small fixed-price integration proposal, hands hours, milestones, and terms to staff, looks it over, and submits it for review.",
  "sections": [
   {
    "title": "Get oriented",
    "narration": "The agent asks the MCP server what it is and what it may do, then reads the engagement types and pricing models from the database, so it never invents an offer.",
    "calls": [
     {
      "request": "What is this server?",
      "tool": "unw_get_service_info",
      "args": {},
      "status": "ok",
      "result": {
       "ok": true,
       "api": {
        "ok": true,
        "links": {},
        "entity": {
         "mode": "database",
         "scopes": [
          "proposals:read",
          "proposals:write",
          "contracts:write",
          "billing:read",
          "projects:read"
         ],
         "service": "unwh-api",
         "connected": true
        },
        "warnings": [],
        "requestId": "cfafffb1-c8a2-41f0-b4b3-bb94c641a802"
       },
       "scopes": [
        "proposals:read",
        "proposals:write",
        "contracts:write",
        "billing:read",
        "projects:read"
       ],
       "service": "unwh-mcp",
       "connected": true,
       "hiddenTools": [
        {
         "name": "unw_create_invoice",
         "scope": "billing:write"
        },
        {
         "name": "unw_send_invoice",
         "scope": "billing:write"
        },
        {
         "name": "unw_pay_invoice",
         "scope": "billing:write"
        },
        {
         "name": "unw_log_hours",
         "scope": "billing:write"
        },
        {
         "name": "unw_invoice_hours",
         "scope": "billing:write"
        },
        {
         "name": "unw_apply_credit",
         "scope": "billing:write"
        },
        {
         "name": "unw_void_invoice",
         "scope": "billing:write"
        },
        {
         "name": "unw_admin_list_users",
         "scope": "admin"
        },
        {
         "name": "unw_admin_create_user",
         "scope": "admin"
        },
        {
         "name": "unw_admin_list_orgs",
         "scope": "admin"
        },
        {
         "name": "unw_admin_create_org",
         "scope": "admin"
        },
        {
         "name": "unw_admin_add_org_member",
         "scope": "admin"
        },
        {
         "name": "unw_admin_list_scope_presets",
         "scope": "admin"
        },
        {
         "name": "unw_admin_mint_magic_link",
         "scope": "admin"
        },
        {
         "name": "unw_admin_list_tokens",
         "scope": "admin"
        },
        {
         "name": "unw_admin_mint_token",
         "scope": "admin"
        },
        {
         "name": "unw_admin_delete_proposal",
         "scope": "admin"
        },
        {
         "name": "unw_admin_revoke_token",
         "scope": "admin"
        },
        {
         "name": "unw_get_catalog_draft",
         "scope": "catalog:write"
        },
        {
         "name": "unw_create_catalog_draft",
         "scope": "catalog:write"
        },
        {
         "name": "unw_update_price_tier",
         "scope": "catalog:write"
        },
        {
         "name": "unw_update_billing_schedule_line",
         "scope": "catalog:write"
        },
        {
         "name": "unw_update_invoice_policy",
         "scope": "catalog:write"
        },
        {
         "name": "unw_publish_catalog",
         "scope": "catalog:write"
        }
       ]
      }
     },
     {
      "request": "Engagement types and pricing models",
      "tool": "unw_get_catalog",
      "args": {},
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "00000000-0000-4000-8000-000000000001",
        "plans": [
         {
          "id": "workflow_check",
          "name": "Workflow Check",
          "hours": 3,
          "model": "workflow_check",
          "price": {
           "currency": "USD",
           "amountMinor": 25000
          },
          "priceKind": "exact"
         },
         {
          "id": "capped_hours_4",
          "name": "Capped Hours, 4",
          "hours": 4,
          "model": "capped_hours",
          "price": {
           "currency": "USD",
           "amountMinor": 55000
          },
          "priceKind": "exact"
         },
         {
          "id": "capped_hours_8",
          "name": "Capped Hours, 8",
          "hours": 8,
          "model": "capped_hours",
          "price": {
           "currency": "USD",
           "amountMinor": 90000
          },
          "priceKind": "exact"
         },
         {
          "id": "fixed_price",
          "name": "Fixed Price",
          "hours": null,
          "model": "fixed_price",
          "price": {
           "currency": "USD",
           "amountMinor": 300000
          },
          "priceKind": "minimum"
         },
         {
          "id": "hourly",
          "name": "Hourly",
          "hours": null,
          "model": "hourly",
          "price": {
           "currency": "USD",
           "amountMinor": 17500
          },
          "priceKind": "rate"
         }
        ],
        "capped4": {
         "hours": 4,
         "price": 550
        },
        "capped8": {
         "hours": 8,
         "price": 900
        },
        "currency": "USD",
        "fixedFrom": "$3K",
        "hourlyRate": 175,
        "effectiveTo": null,
        "effectiveFrom": "2026-01-01T00:00:00.000Z",
        "workflowCheck": 250,
        "fixedFromDollars": 3000
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Ask about reminders",
    "narration": "Intake starts by asking how the client wants reminders. The demo picks none, so nothing is ever sent.",
    "calls": [
     {
      "request": "No reminders for a demo",
      "tool": "unw_set_contact_preference",
      "args": {
       "channel": "none",
       "consent": false,
       "timezone": "America/Los_Angeles"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "preference": {
         "email": null,
         "phone": null,
         "channel": "none",
         "optedOut": false,
         "quietEnd": null,
         "timezone": "America/Los_Angeles",
         "consentAt": null,
         "updatedAt": "2026-10-27T03:49:27.023Z",
         "optedOutAt": null,
         "quietStart": null
        }
       },
       "changed": true,
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Draft the proposal",
    "narration": "It turns the conversation into a structured draft (scope, deliverables, assumptions, exclusions, timeline, and the client's stated budget), then checks progress. A proposal is a tree of parts, so progress reads as parts settled out of the total.",
    "calls": [
     {
      "request": "Create the draft",
      "tool": "unw_create_proposal",
      "args": {
       "scope": {
        "summary": "Sync rental listings from a property management system to a public listings site every hour.",
        "exclusions": [
         "Changes to either vendor system"
        ],
        "assumptions": [
         "The client provides API credentials for both systems"
        ],
        "deliverables": [
         "Hourly listing sync job",
         "Field mapping document",
         "Error report email"
        ]
       },
       "title": "Try me: rental listing sync",
       "pricing": {
        "model": "fixed_price",
        "currency": "USD",
        "amountMinor": 300000
       },
       "timeline": {
        "startDate": "2026-11-02",
        "milestones": [],
        "targetDate": "2026-11-30"
       },
       "engagement": "fixed_price"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "f886e653-0d49-4583-adb0-06b008c02629",
        "scope": {
         "summary": "Sync rental listings from a property management system to a public listings site every hour.",
         "exclusions": [
          "Changes to either vendor system"
         ],
         "assumptions": [
          "The client provides API credentials for both systems"
         ],
         "deliverables": [
          "Hourly listing sync job",
          "Field mapping document",
          "Error report email"
         ]
        },
        "title": "Try me: rental listing sync",
        "status": "draft",
        "options": [],
        "ownerId": "bfedcb43-d44c-4da3-bf71-1a132e771ab7",
        "pricing": {
         "model": "fixed_price",
         "currency": "USD",
         "amountMinor": 300000
        },
        "version": 1,
        "timeline": {
         "startDate": "2026-11-02",
         "milestones": [],
         "targetDate": "2026-11-30"
        },
        "createdAt": "2026-10-27T03:49:27.087Z",
        "updatedAt": "2026-10-27T03:49:27.087Z",
        "engagement": "fixed_price",
        "schemaVersion": 1,
        "organizationId": "c5958e81-4f3c-48e7-a370-19211067a5e1"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "See the proposal templates",
      "tool": "unw_list_proposal_templates",
      "args": {},
      "status": "ok",
      "result": {
       "ok": true,
       "entity": [
        {
         "code": "standard",
         "name": "Standard proposal",
         "description": "Every part: scope, hours, price and options, milestones, schedule, terms, and the narrative sections.",
         "suggestedPricingModel": null
        },
        {
         "code": "fixed_bid",
         "name": "Fixed-bid project",
         "description": "A defined deliverable for an agreed price: scope, hours, price and options, milestones, schedule, terms, and the summary, approach, and success sections.",
         "suggestedPricingModel": null
        },
        {
         "code": "tm_retainer",
         "name": "Time and materials retainer",
         "description": "Ongoing work billed against a block of hours: scope, hours, price, schedule, terms, and the summary, approach, and service levels sections.",
         "suggestedPricingModel": null
        },
        {
         "code": "discovery",
         "name": "Discovery engagement",
         "description": "A short paid study before a larger build: scope, hours, price, schedule, terms, and the summary, background, approach, and success sections.",
         "suggestedPricingModel": null
        },
        {
         "code": "data_migration",
         "name": "Data migration",
         "description": "Moving data between systems: scope, hours, price, milestones, schedule, terms, and the summary, background, approach, data migration, security, and training sections.",
         "suggestedPricingModel": null
        },
        {
         "code": "web_app",
         "name": "Custom web or SaaS application",
         "description": "A new web application or SaaS product: discovery, design, build, launch, and support, with security and service levels.",
         "suggestedPricingModel": "fixed_price"
        },
        {
         "code": "mobile_app",
         "name": "Mobile app",
         "description": "An iOS and Android app, usually cross-platform, with its backend, store release, and support.",
         "suggestedPricingModel": "fixed_price"
        },
        {
         "code": "ai_solution",
         "name": "AI or machine learning solution",
         "description": "A machine learning or generative AI feature taken from proof of concept to production, with evaluation, safety, and training.",
         "suggestedPricingModel": "hourly"
        },
        {
         "code": "modernization",
         "name": "Legacy modernization and integration",
         "description": "Moving a legacy system to a modern platform and connecting it to the systems around it, with data migration and cutover.",
         "suggestedPricingModel": "fixed_price"
        }
       ],
       "warnings": [],
       "note": "Template parts are omitted here."
      }
     },
     {
      "request": "Build it from the web app template",
      "tool": "unw_set_proposal_template",
      "args": {
       "code": "web_app",
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "code": "web_app",
        "name": "Custom web or SaaS application",
        "nodes": [
         {
          "key": "scope",
          "kind": "scope",
          "title": "Scope",
          "parentKey": null,
          "sortOrder": 10
         },
         {
          "key": "hours",
          "kind": "hours",
          "title": "Hours",
          "parentKey": "scope",
          "sortOrder": 20
         },
         {
          "key": "price",
          "kind": "price",
          "title": "Price",
          "parentKey": "hours",
          "sortOrder": 30
         },
         {
          "key": "options",
          "kind": "option",
          "title": "Options",
          "parentKey": "price",
          "sortOrder": 35
         },
         {
          "key": "milestones",
          "kind": "milestone",
          "title": "Milestones",
          "parentKey": "scope",
          "sortOrder": 40
         },
         {
          "key": "schedule",
          "kind": "schedule",
          "title": "Schedule",
          "parentKey": null,
          "sortOrder": 50
         },
         {
          "key": "terms",
          "kind": "terms",
          "title": "Terms",
          "parentKey": null,
          "sortOrder": 60
         },
         {
          "key": "executive_summary",
          "kind": "section",
          "title": "Executive summary",
          "parentKey": null,
          "sortOrder": 70
         },
         {
          "key": "background",
          "kind": "section",
          "title": "Problem and background",
          "parentKey": null,
          "sortOrder": 80
         },
         {
          "key": "approach",
          "kind": "section",
          "title": "Approach",
          "parentKey": null,
          "sortOrder": 90
         },
         {
          "key": "success_metrics",
          "kind": "section",
          "title": "Success metrics",
          "parentKey": null,
          "sortOrder": 100
         },
         {
          "key": "security",
          "kind": "section",
          "title": "Security and access",
          "parentKey": null,
          "sortOrder": 110
         },
         {
          "key": "service_levels",
          "kind": "section",
          "title": "Service levels and support",
          "parentKey": null,
          "sortOrder": 130
         }
        ],
        "options": [
         {
          "code": "mvp",
          "label": "MVP launch",
          "selection": "optional",
          "description": "The smallest product that proves the idea with real users; later features move to a second phase."
         },
         {
          "code": "sso",
          "label": "Single sign-on",
          "selection": "optional",
          "description": "Sign-in through the client's identity provider, such as Microsoft Entra ID or Google Workspace."
         },
         {
          "code": "support_plan",
          "label": "Post-launch support plan",
          "selection": "optional",
          "description": "Ongoing fixes, updates, and monitoring after launch under the service levels section."
         }
        ],
        "samples": {
         "scope": {
          "summary": "Design, build, and launch a custom web application that replaces spreadsheets and email with one shared system for the client's staff and customers.",
          "exclusions": [
           "Native mobile apps",
           "Migration of more than one legacy data source"
          ],
          "assumptions": [
           "The client names one product owner who can make decisions within two business days.",
           "The client provides access to existing data and brand assets in the first week."
          ],
          "deliverables": [
           "Discovery report and clickable prototype",
           "Production web application with role-based access",
           "Admin tools for managing users and content",
           "Launch, handover documentation, and a recorded walkthrough"
          ]
         },
         "approach": {
          "text": "We work in four phases. Discovery maps the workflow with the people who do it and ends with a clickable prototype. Design settles the screens and the data model, and the product owner signs off before build starts. Build runs in short iterations with a demo at the end of each one, so you see progress and can change priorities early. Launch covers a beta in staging, fixes from your testing, the pr…"
         },
         "schedule": {
          "milestones": [
           {
            "title": "Discovery complete",
            "weekOffset": 2,
            "description": "Workflows mapped and the prototype approved."
           },
           {
            "title": "Design sign-off",
            "weekOffset": 4,
            "description": "Screens and data model approved by the product owner."
           },
           {
            "title": "Beta release",
            "weekOffset": 10,
            "description": "Working application in a staging environment for client testing."
           },
           {
            "title": "Launch",
            "weekOffset": 14,
            "description": "Production release and handover."
           }
          ]
         },
         "security": {
          "text": "The application uses role-based access so staff and customers only see what they should. We work in client-owned hosting and source control accounts, keep credentials in a secrets manager rather than in code, encrypt data in transit and at rest, and remove our access when the engagement ends. Any compliance needs, such as data residency, are confirmed in discovery."
         },
         "background": {
          "text": "Today the work is tracked in shared spreadsheets and email threads. Requests get lost, two people sometimes update the same record, and nobody can see the full status without asking around. Off-the-shelf tools were tried but did not fit how the team actually works, so a custom application built around the real process is the better path."
         },
         "service_levels": {
          "text": "After launch, issues are reported through a shared support channel. Anything that stops users from working is treated as urgent and gets a response the same business day; other issues are triaged within two business days and scheduled into the next release."
         },
         "success_metrics": {
          "text": "Success means every request in the workflow is tracked in the application instead of spreadsheets, staff can see the status of any record in one screen, and the product owner accepts the beta against the agreed deliverables before launch."
         },
         "executive_summary": {
          "text": "Your team runs a core workflow across spreadsheets, inboxes, and memory, which makes it slow to serve customers and hard to see what is happening. We will design and build a custom web application that puts that workflow in one place, with the right access for staff and customers. You get a working product in staged releases, so you can test it with real users before launch and steer what comes n…"
         }
        },
        "description": "A new web application or SaaS product: discovery, design, build, launch, and support, with security and service levels.",
        "suggestedPricingModel": "fixed_price"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "See the reusable sections",
      "tool": "unw_list_section_library",
      "args": {},
      "status": "ok",
      "result": {
       "ok": true,
       "entity": [
        {
         "key": "security",
         "title": "Security and access",
         "category": "risk",
         "guidance": "How client systems and data are protected: what access is needed, who holds it, how credentials and sensitive data are handled, and any compliance the client must meet. Never state hours or price.",
         "maxChars": 4000,
         "clientLabel": "security and access",
         "description": "For work that touches client systems, credentials, or sensitive data."
        },
        {
         "key": "data_migration",
         "title": "Data migration",
         "category": "delivery",
         "guidance": "What data moves from where to where: sources, rough volume, cleanup and mapping, how it is verified, and how the cutover and rollback work. Never state hours or price.",
         "maxChars": 5000,
         "clientLabel": "data migration",
         "description": "For engagements that move data between systems."
        },
        {
         "key": "service_levels",
         "title": "Service levels and support",
         "category": "support",
         "guidance": "What support looks like once the work is live: response times, hours of coverage, how issues are reported, and what counts as urgent. Never state hours or price.",
         "maxChars": 3000,
         "clientLabel": "service levels and support",
         "description": "For engagements with ongoing support after delivery."
        },
        {
         "key": "training",
         "title": "Training and handover",
         "category": "delivery",
         "guidance": "How the client's people learn the result: who is trained, in what format, what documentation they receive, and when ownership passes to them. Never state hours or price.",
         "maxChars": 3000,
         "clientLabel": "training and handover",
         "description": "For work the client's staff will run themselves afterward."
        },
        {
         "key": "integrations",
         "title": "Systems and integrations",
         "category": "delivery",
         "guidance": "Which systems connect and how: each system, the direction data flows, the API or file method, who owns each side, and how failures are retried and reported. Never state hours or price.",
         "maxChars": 5000,
         "clientLabel": "systems and integrations",
         "description": "For work that connects two or more systems through APIs or files."
        },
        {
         "key": "app_release",
         "title": "App store release",
         "category": "delivery",
         "guidance": "How the app reaches users: target platforms and OS versions, developer accounts, store review, beta testing, and who owns the store listings afterward. Never state hours or price.",
         "maxChars": 3000,
         "clientLabel": "app store release",
         "description": "For mobile apps published to the App Store or Google Play."
        },
        {
         "key": "ai_evaluation",
         "title": "Model evaluation and safety",
         "category": "risk",
         "guidance": "How the model is judged good enough and kept safe: the evaluation set, target metrics, human review, handling of sensitive data, and monitoring for drift after launch. Never state hours or price.",
         "maxChars": 5000,
         "clientLabel": "model evaluation and safety",
         "description": "For work that ships a machine learning or generative AI model."
        }
       ],
       "warnings": []
      }
     },
     {
      "request": "Add the integrations section",
      "tool": "unw_add_proposal_section",
      "args": {
       "nodeKey": "integrations",
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "key": "integrations",
        "title": "Systems and integrations",
        "category": "delivery",
        "guidance": "Which systems connect and how: each system, the direction data flows, the API or file method, who owns each side, and how failures are retried and reported. Never state hours or price.",
        "maxChars": 5000,
        "clientLabel": "systems and integrations",
        "description": "For work that connects two or more systems through APIs or files."
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Progress at the start",
      "tool": "unw_get_proposal_progress",
      "args": {
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "total": 14,
        "groups": [
         {
          "code": "needs_input",
          "label": "Needs your input",
          "parts": [
           {
            "key": "scope",
            "note": null,
            "group": "needs_input",
            "label": "Scope",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on scope.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "hours",
            "note": null,
            "group": "needs_input",
            "label": "Hours",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on hours.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "price",
            "note": null,
            "group": "needs_input",
            "label": "Price",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "hours",
             "options"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on price.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "options",
            "note": null,
            "group": "needs_input",
            "label": "Options",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on options.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "milestones",
            "note": null,
            "group": "needs_input",
            "label": "Milestones",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on milestones.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "schedule",
            "note": null,
            "group": "needs_input",
            "label": "Dates",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on dates.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "terms",
            "note": null,
            "group": "needs_input",
            "label": "Terms",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on terms.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "executive_summary",
            "note": null,
            "group": "needs_input",
            "label": "Executive summary",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on executive summary.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "background",
            "note": null,
            "group": "needs_input",
            "label": "Problem and background",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on problem and background.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "approach",
            "note": null,
            "group": "needs_input",
            "label": "Approach",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on approach.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "success_metrics",
            "note": null,
            "group": "needs_input",
            "label": "Success metrics",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on success metrics.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "security",
            "note": null,
            "group": "needs_input",
            "label": "Security and access",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on security and access.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "service_levels",
            "note": null,
            "group": "needs_input",
            "label": "Service levels and support",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on service levels and support.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "integrations",
            "note": null,
            "group": "needs_input",
            "label": "Systems and integrations",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on systems and integrations.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           }
          ],
          "settled": false
         }
        ],
        "phrase": "Just getting started",
        "handoff": {
         "body": "You do not need to finish everything. Send it as it is, and we will work through anything open or unsure together on the call.",
         "ready": false,
         "heading": "Ready for a call with Unwhelm",
         "reasons": [],
         "openParts": [
          "Scope",
          "Hours",
          "Price",
          "Options",
          "Milestones",
          "Dates",
          "Terms",
          "Executive summary",
          "Problem and background",
          "Approach",
          "Success metrics",
          "Security and access",
          "Service levels and support",
          "Systems and integrations"
         ],
         "openSummary": "Still open: Scope, Hours, Price, Options, Milestones, Dates, Terms, Executive summary, Problem and background, Approach, Success metrics, Security and access, Service levels and support and Systems and integrations.",
         "submitLabel": "Send as it is",
         "discussParts": []
        },
        "percent": 0,
        "settled": 0,
        "headline": "0 of 14 parts settled",
        "nextStep": {
         "key": "scope",
         "text": "Tell us what you have in mind for scope."
        },
        "toDiscuss": 0,
        "lastSeenAt": null,
        "resolutions": [
         {
          "code": "unsure",
          "label": "Not sure, talk to a human",
          "flagsForCall": true
         },
         {
          "code": "staff_decides",
          "label": "Let Unwhelm decide",
          "flagsForCall": false
         },
         {
          "code": "out_of_scope",
          "label": "Out of scope / save for later",
          "flagsForCall": false
         }
        ],
        "savedForLater": {
         "note": "These ideas are kept for a follow-up and do not count toward progress.",
         "items": [],
         "heading": "Saved for later"
        },
        "sinceLastVisit": null
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Hand off what is not the agent's call",
    "narration": "Hours and billing milestones are set by a person, and the client is unsure about terms, so each part is handed off instead of guessed. Handing off settles a part, so the count goes up.",
    "calls": [
     {
      "request": "Hours: staff decides",
      "tool": "unw_mark_part_unsure",
      "args": {
       "note": "The agent never estimates hours.",
       "nodeKey": "hours",
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
       "resolution": "staff_decides"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "key": "hours",
        "label": "Let Unwhelm decide",
        "state": "staff_decides",
        "percent": 7,
        "flagsForCall": false
       },
       "warnings": []
      }
     },
     {
      "request": "Milestones: staff decides",
      "tool": "unw_mark_part_unsure",
      "args": {
       "note": "Staff will set billing milestones.",
       "nodeKey": "milestones",
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
       "resolution": "staff_decides"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "key": "milestones",
        "label": "Let Unwhelm decide",
        "state": "staff_decides",
        "percent": 14,
        "flagsForCall": false
       },
       "warnings": []
      }
     },
     {
      "request": "Terms: client unsure",
      "tool": "unw_mark_part_unsure",
      "args": {
       "note": "Client wants to talk terms with a human.",
       "nodeKey": "terms",
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
       "resolution": "unsure"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "key": "terms",
        "label": "Not sure, talk to a human",
        "state": "unsure",
        "percent": 21,
        "flagsForCall": true
       },
       "warnings": []
      }
     },
     {
      "request": "Progress after handing off",
      "tool": "unw_get_proposal_progress",
      "args": {
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "total": 14,
        "groups": [
         {
          "code": "to_discuss",
          "label": "To discuss with us",
          "parts": [
           {
            "key": "terms",
            "note": "Client wants to talk terms with a human.",
            "group": "to_discuss",
            "label": "Terms",
            "state": "unsure",
            "settled": true,
            "dependsOn": [],
            "toDiscuss": true,
            "whatsLeft": "Marked unsure. We will talk it through on the call.",
            "reopenedBy": null,
            "stateLabel": "To talk through with us"
           }
          ],
          "settled": true
         },
         {
          "code": "staff_decides",
          "label": "Unwhelm will decide",
          "parts": [
           {
            "key": "hours",
            "note": "The agent never estimates hours.",
            "group": "staff_decides",
            "label": "Hours",
            "state": "staff_decides",
            "settled": true,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Left for Unwhelm to decide during review.",
            "reopenedBy": null,
            "stateLabel": "Unwhelm will decide"
           },
           {
            "key": "milestones",
            "note": "Staff will set billing milestones.",
            "group": "staff_decides",
            "label": "Milestones",
            "state": "staff_decides",
            "settled": true,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Left for Unwhelm to decide during review.",
            "reopenedBy": null,
            "stateLabel": "Unwhelm will decide"
           }
          ],
          "settled": true
         },
         {
          "code": "needs_input",
          "label": "Needs your input",
          "parts": [
           {
            "key": "scope",
            "note": null,
            "group": "needs_input",
            "label": "Scope",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on scope.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "price",
            "note": null,
            "group": "needs_input",
            "label": "Price",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "hours",
             "options"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on price.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "options",
            "note": null,
            "group": "needs_input",
            "label": "Options",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on options.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "schedule",
            "note": null,
            "group": "needs_input",
            "label": "Dates",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on dates.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "executive_summary",
            "note": null,
            "group": "needs_input",
            "label": "Executive summary",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on executive summary.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "background",
            "note": null,
            "group": "needs_input",
            "label": "Problem and background",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on problem and background.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "approach",
            "note": null,
            "group": "needs_input",
            "label": "Approach",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on approach.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "success_metrics",
            "note": null,
            "group": "needs_input",
            "label": "Success metrics",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on success metrics.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "security",
            "note": null,
            "group": "needs_input",
            "label": "Security and access",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on security and access.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "service_levels",
            "note": null,
            "group": "needs_input",
            "label": "Service levels and support",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on service levels and support.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "integrations",
            "note": null,
            "group": "needs_input",
            "label": "Systems and integrations",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on systems and integrations.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           }
          ],
          "settled": false
         }
        ],
        "phrase": "Just getting started",
        "handoff": {
         "body": "You do not need to finish everything. Send it as it is, and we will work through anything open or unsure together on the call.",
         "ready": true,
         "heading": "Ready for a call with Unwhelm",
         "reasons": [
          {
           "code": "client_unsure",
           "note": null,
           "label": "Some parts are easier to settle on a call"
          }
         ],
         "openParts": [
          "Scope",
          "Price",
          "Options",
          "Dates",
          "Executive summary",
          "Problem and background",
          "Approach",
          "Success metrics",
          "Security and access",
          "Service levels and support",
          "Systems and integrations"
         ],
         "openSummary": "Still open: Scope, Price, Options, Dates, Executive summary, Problem and background, Approach, Success metrics, Security and access, Service levels and support and Systems and integrations.",
         "submitLabel": "Send as it is",
         "discussParts": [
          "Terms"
         ]
        },
        "percent": 21,
        "settled": 3,
        "headline": "3 of 14 parts settled, 1 to discuss with us",
        "nextStep": {
         "key": "scope",
         "text": "Tell us what you have in mind for scope."
        },
        "toDiscuss": 1,
        "lastSeenAt": null,
        "resolutions": [
         {
          "code": "unsure",
          "label": "Not sure, talk to a human",
          "flagsForCall": true
         },
         {
          "code": "staff_decides",
          "label": "Let Unwhelm decide",
          "flagsForCall": false
         },
         {
          "code": "out_of_scope",
          "label": "Out of scope / save for later",
          "flagsForCall": false
         }
        ],
        "savedForLater": {
         "note": "These ideas are kept for a follow-up and do not count toward progress.",
         "items": [],
         "heading": "Saved for later"
        },
        "sinceLastVisit": null
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Look it over",
    "narration": "Before submitting, the agent reads the draft back the way a client would: the list, the full proposal, its sections, the completion tree, and an export.",
    "calls": [
     {
      "request": "Your proposals",
      "tool": "unw_list_proposals",
      "args": {
       "limit": 5
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "items": [
         {
          "id": "f886e653-0d49-4583-adb0-06b008c02629",
          "scope": {
           "summary": "Sync rental listings from a property management system to a public listings site every hour.",
           "exclusions": [
            "Changes to either vendor system"
           ],
           "assumptions": [
            "The client provides API credentials for both systems"
           ],
           "deliverables": [
            "Hourly listing sync job",
            "Field mapping document",
            "Error report email"
           ]
          },
          "title": "Try me: rental listing sync",
          "status": "draft",
          "options": [],
          "ownerId": "bfedcb43-d44c-4da3-bf71-1a132e771ab7",
          "pricing": {
           "model": "fixed_price",
           "currency": "USD",
           "amountMinor": 300000
          },
          "version": 1,
          "timeline": {
           "startDate": "2026-11-02",
           "milestones": [],
           "targetDate": "2026-11-30"
          },
          "createdAt": "2026-10-27T03:49:27.087Z",
          "updatedAt": "2026-10-27T03:49:27.183Z",
          "engagement": "fixed_price",
          "schemaVersion": 1,
          "organizationId": "c5958e81-4f3c-48e7-a370-19211067a5e1"
         }
        ],
        "nextCursor": null,
        "totalEstimate": null
       },
       "warnings": []
      }
     },
     {
      "request": "The full draft",
      "tool": "unw_get_proposal",
      "args": {
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "f886e653-0d49-4583-adb0-06b008c02629",
        "scope": {
         "summary": "Sync rental listings from a property management system to a public listings site every hour.",
         "exclusions": [
          "Changes to either vendor system"
         ],
         "assumptions": [
          "The client provides API credentials for both systems"
         ],
         "deliverables": [
          "Hourly listing sync job",
          "Field mapping document",
          "Error report email"
         ]
        },
        "title": "Try me: rental listing sync",
        "status": "draft",
        "options": [],
        "ownerId": "bfedcb43-d44c-4da3-bf71-1a132e771ab7",
        "pricing": {
         "model": "fixed_price",
         "currency": "USD",
         "amountMinor": 300000
        },
        "version": 1,
        "timeline": {
         "startDate": "2026-11-02",
         "milestones": [],
         "targetDate": "2026-11-30"
        },
        "createdAt": "2026-10-27T03:49:27.087Z",
        "updatedAt": "2026-10-27T03:49:27.183Z",
        "engagement": "fixed_price",
        "schemaVersion": 1,
        "organizationId": "c5958e81-4f3c-48e7-a370-19211067a5e1"
       },
       "warnings": []
      }
     },
     {
      "request": "Its sections",
      "tool": "unw_list_proposal_sections",
      "args": {
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "sections": [
         {
          "id": "scope",
          "status": "available"
         },
         {
          "id": "timeline",
          "status": "available"
         },
         {
          "id": "pricing",
          "status": "available"
         },
         {
          "id": "options",
          "status": "available"
         }
        ],
        "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
       },
       "warnings": []
      }
     },
     {
      "request": "Every part and its state",
      "tool": "unw_get_completion_tree",
      "args": {
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "edges": [
         {
          "id": "dbcd9e2d-8516-4b32-8579-375fbe3e3725",
          "toKey": "hours",
          "fromKey": "scope"
         },
         {
          "id": "02aefb1f-3589-43fe-be30-dc3cd3433aaf",
          "toKey": "price",
          "fromKey": "hours"
         },
         {
          "id": "c7e71485-74fd-4f31-b19a-a435f7d31346",
          "toKey": "milestones",
          "fromKey": "scope"
         },
         {
          "id": "41478afd-195d-4f50-a82e-026620850fbc",
          "toKey": "price",
          "fromKey": "options"
         }
        ],
        "nodes": [
         {
          "id": "a7a5c4d6-b5b8-408e-b821-2e3cad271295",
          "key": "scope",
          "body": {},
          "kind": "scope",
          "title": "Scope",
          "createdAt": "2026-10-27T03:49:27.196Z",
          "parentKey": null,
          "sortOrder": 10,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.196Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "scope",
          "lockedVersionId": null
         },
         {
          "id": "b3be9385-1d75-481a-8461-93f425a0a83f",
          "key": "hours",
          "body": {
           "note": "The agent never estimates hours.",
           "resolution": "staff_decides"
          },
          "kind": "hours",
          "title": "Hours",
          "createdAt": "2026-10-27T03:49:27.200Z",
          "parentKey": "scope",
          "sortOrder": 20,
          "stateCode": "staff_decides",
          "updatedAt": "2026-10-27T03:49:27.445Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Unwhelm will decide",
          "clientLabel": "hours",
          "lockedVersionId": null
         },
         {
          "id": "0f14192a-99ff-4a9c-9cfa-6a54c16be7d4",
          "key": "price",
          "body": {},
          "kind": "price",
          "title": "Price",
          "createdAt": "2026-10-27T03:49:27.205Z",
          "parentKey": "hours",
          "sortOrder": 30,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.205Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "price",
          "lockedVersionId": null
         },
         {
          "id": "0585ef57-2e06-41e0-9165-deee2847fd07",
          "key": "options",
          "body": {},
          "kind": "option",
          "title": "Options",
          "createdAt": "2026-10-27T03:49:27.210Z",
          "parentKey": "price",
          "sortOrder": 35,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.210Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "options",
          "lockedVersionId": null
         },
         {
          "id": "a0e883a8-bb56-4b32-8b32-85db8b90f60a",
          "key": "milestones",
          "body": {
           "note": "Staff will set billing milestones.",
           "resolution": "staff_decides"
          },
          "kind": "milestone",
          "title": "Milestones",
          "createdAt": "2026-10-27T03:49:27.214Z",
          "parentKey": "scope",
          "sortOrder": 40,
          "stateCode": "staff_decides",
          "updatedAt": "2026-10-27T03:49:27.484Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Unwhelm will decide",
          "clientLabel": "milestones",
          "lockedVersionId": null
         },
         {
          "id": "12bed8d5-a47f-47d9-a8b9-6f2e41a1a676",
          "key": "schedule",
          "body": {},
          "kind": "schedule",
          "title": "Schedule",
          "createdAt": "2026-10-27T03:49:27.218Z",
          "parentKey": null,
          "sortOrder": 50,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.218Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "dates",
          "lockedVersionId": null
         },
         {
          "id": "074e72af-872a-4713-9cb3-d8c069602ce8",
          "key": "terms",
          "body": {
           "note": "Client wants to talk terms with a human.",
           "resolution": "unsure"
          },
          "kind": "terms",
          "title": "Terms",
          "createdAt": "2026-10-27T03:49:27.222Z",
          "parentKey": null,
          "sortOrder": 60,
          "stateCode": "unsure",
          "updatedAt": "2026-10-27T03:49:27.525Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "To talk through with us",
          "clientLabel": "terms",
          "lockedVersionId": null
         },
         {
          "id": "7aac1f8a-9598-4176-9eb2-4cebdf4c394f",
          "key": "executive_summary",
          "body": {},
          "kind": "section",
          "title": "Executive summary",
          "createdAt": "2026-10-27T03:49:27.226Z",
          "parentKey": null,
          "sortOrder": 70,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.226Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "executive summary",
          "lockedVersionId": null
         },
         {
          "id": "472fcb77-7136-43c0-a780-684b088dcbac",
          "key": "background",
          "body": {},
          "kind": "section",
          "title": "Problem and background",
          "createdAt": "2026-10-27T03:49:27.230Z",
          "parentKey": null,
          "sortOrder": 80,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.230Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "problem and background",
          "lockedVersionId": null
         },
         {
          "id": "173e0fe3-6b54-4de1-a97d-daf0cf21c3ad",
          "key": "approach",
          "body": {},
          "kind": "section",
          "title": "Approach",
          "createdAt": "2026-10-27T03:49:27.234Z",
          "parentKey": null,
          "sortOrder": 90,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.234Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "approach",
          "lockedVersionId": null
         },
         {
          "id": "8a7950bb-32b0-41e6-9413-02d851a6cbfb",
          "key": "success_metrics",
          "body": {},
          "kind": "section",
          "title": "Success metrics",
          "createdAt": "2026-10-27T03:49:27.239Z",
          "parentKey": null,
          "sortOrder": 100,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.239Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "success metrics",
          "lockedVersionId": null
         },
         {
          "id": "09d68348-5171-4222-ad1c-cbf625415941",
          "key": "security",
          "body": {},
          "kind": "section",
          "title": "Security and access",
          "createdAt": "2026-10-27T03:49:27.242Z",
          "parentKey": null,
          "sortOrder": 110,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.242Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "security and access",
          "lockedVersionId": null
         },
         {
          "id": "a5a27dfb-ce6d-4e91-a06c-2df051627433",
          "key": "service_levels",
          "body": {},
          "kind": "section",
          "title": "Service levels and support",
          "createdAt": "2026-10-27T03:49:27.246Z",
          "parentKey": null,
          "sortOrder": 130,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.246Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "service levels and support",
          "lockedVersionId": null
         },
         {
          "id": "492c8b5f-6629-4e88-bedd-4cdca049e279",
          "key": "integrations",
          "body": {},
          "kind": "section",
          "title": "Systems and integrations",
          "createdAt": "2026-10-27T03:49:27.334Z",
          "parentKey": null,
          "sortOrder": 150,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:27.334Z",
          "proposalId": "f886e653-0d49-4583-adb0-06b008c02629",
          "stateLabel": "Not started",
          "clientLabel": "systems and integrations",
          "lockedVersionId": null
         }
        ],
        "parked": [],
        "states": [
         {
          "code": "open",
          "clientLabel": "Not started",
          "completionWeight": 0
         },
         {
          "code": "drafted",
          "clientLabel": "Drafted",
          "completionWeight": 0
         },
         {
          "code": "needs_review",
          "clientLabel": "Needs another look",
          "completionWeight": 0
         },
         {
          "code": "agreed",
          "clientLabel": "Agreed",
          "completionWeight": 1
         },
         {
          "code": "unsure",
          "clientLabel": "To talk through with us",
          "completionWeight": 1
         },
         {
          "code": "staff_decides",
          "clientLabel": "Unwhelm will decide",
          "completionWeight": 1
         },
         {
          "code": "out_of_scope",
          "clientLabel": "Out of scope for now",
          "completionWeight": 1
         },
         {
          "code": "locked",
          "clientLabel": "Locked",
          "completionWeight": 1
         }
        ],
        "history": [
         {
          "id": "69e3726e-585f-4f44-8149-3dc95aae8a7e",
          "reason": "hours: Let Unwhelm decide (The agent never estimates hours.).",
          "createdAt": "2026-10-27T03:49:27.450Z",
          "percentAfter": 7,
          "percentBefore": 0
         },
         {
          "id": "739c81f2-0278-4195-922f-54abacf23c65",
          "reason": "milestones: Let Unwhelm decide (Staff will set billing milestones.).",
          "createdAt": "2026-10-27T03:49:27.488Z",
          "percentAfter": 14,
          "percentBefore": 7
         },
         {
          "id": "1b808717-d6a8-4b88-ba71-75d848d99e3d",
          "reason": "terms: Not sure, talk to a human (Client wants to talk terms with a human.).",
          "createdAt": "2026-10-27T03:49:27.528Z",
          "percentAfter": 21,
          "percentBefore": 14
         }
        ],
        "percent": 21,
        "parkModes": [
         {
          "code": "phase_2",
          "reopens": false,
          "clientLabel": "Park as a later phase"
         },
         {
          "code": "swap",
          "reopens": false,
          "clientLabel": "Swap for a similar item"
         }
        ]
       },
       "warnings": []
      }
     },
     {
      "request": "Export it",
      "tool": "unw_export_proposal",
      "args": {
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "f886e653-0d49-4583-adb0-06b008c02629",
        "scope": {
         "summary": "Sync rental listings from a property management system to a public listings site every hour.",
         "exclusions": [
          "Changes to either vendor system"
         ],
         "assumptions": [
          "The client provides API credentials for both systems"
         ],
         "deliverables": [
          "Hourly listing sync job",
          "Field mapping document",
          "Error report email"
         ]
        },
        "title": "Try me: rental listing sync",
        "status": "draft",
        "options": [],
        "ownerId": "bfedcb43-d44c-4da3-bf71-1a132e771ab7",
        "pricing": {
         "model": "fixed_price",
         "currency": "USD",
         "amountMinor": 300000
        },
        "version": 1,
        "timeline": {
         "startDate": "2026-11-02",
         "milestones": [],
         "targetDate": "2026-11-30"
        },
        "createdAt": "2026-10-27T03:49:27.087Z",
        "updatedAt": "2026-10-27T03:49:27.183Z",
        "engagement": "fixed_price",
        "schemaVersion": 1,
        "organizationId": "c5958e81-4f3c-48e7-a370-19211067a5e1"
       },
       "warnings": []
      }
     },
     {
      "request": "Review the draft section by section",
      "tool": "unw_review_proposal",
      "args": {
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "score": 52,
        "sections": [
         {
          "key": "scope",
          "score": 70,
          "state": "open",
          "title": "Scope",
          "issues": [
           {
            "code": "web_scope_deliverables",
            "message": "A web application scope should list at least four deliverables.",
            "severity": "issue",
            "suggestion": "List design, the application itself, its admin tools, and launch as separate deliverables."
           }
          ],
          "suggestions": []
         },
         {
          "key": "price",
          "score": 80,
          "state": "open",
          "title": "Price",
          "issues": [],
          "suggestions": [
           {
            "code": "price_staff_open",
            "message": "Staff have not set the price yet.",
            "severity": "suggestion",
            "suggestion": "Hand pricing to staff; the agent never sets hours or price."
           }
          ]
         },
         {
          "key": "schedule",
          "score": 85,
          "state": "open",
          "title": "Schedule",
          "issues": [],
          "suggestions": [
           {
            "code": "timeline_milestones_missing",
            "message": "The timeline has no milestones.",
            "severity": "suggestion",
            "suggestion": "Staff can add checkpoints; the client can say which dates matter."
           }
          ]
         },
         {
          "key": "executive_summary",
          "score": 40,
          "state": "open",
          "title": "Executive summary",
          "issues": [
           {
            "code": "exec_missing",
            "message": "The executive summary is empty.",
            "severity": "issue",
            "suggestion": "Write two or three short paragraphs: the need, what will be delivered, and why this engagement fits."
           }
          ],
          "suggestions": []
         },
         {
          "key": "background",
          "score": 40,
          "state": "open",
          "title": "Problem and background",
          "issues": [
           {
            "code": "bg_missing",
            "message": "The problem and background section is empty.",
            "severity": "issue",
            "suggestion": "Describe the current situation, what it costs the client, and what has been tried."
           }
          ],
          "suggestions": []
         },
         {
          "key": "approach",
          "score": 40,
          "state": "open",
          "title": "Approach",
          "issues": [
           {
            "code": "approach_missing",
            "message": "The approach section is empty.",
            "severity": "issue",
            "suggestion": "Explain the method, phases, and how the client stays involved."
           }
          ],
          "suggestions": []
         },
         {
          "key": "success_metrics",
          "score": 40,
          "state": "open",
          "title": "Success metrics",
          "issues": [
           {
            "code": "metrics_missing",
            "message": "There are no success metrics.",
            "severity": "issue",
            "suggestion": "List measurable outcomes or acceptance signals the client agrees with."
           }
          ],
          "suggestions": []
         },
         {
          "key": "security",
          "score": 40,
          "state": "open",
          "title": "Security and access",
          "issues": [
           {
            "code": "security_missing",
            "message": "The security section is empty.",
            "severity": "issue",
            "suggestion": "Say what access is needed, who holds it, and how sensitive data is handled."
           }
          ],
          "suggestions": []
         },
         {
          "key": "service_levels",
          "score": 40,
          "state": "open",
          "title": "Service levels and support",
          "issues": [
           {
            "code": "sla_missing",
            "message": "The service levels section is empty.",
            "severity": "issue",
            "suggestion": "State response times, coverage hours, and how issues are reported."
           }
          ],
          "suggestions": []
         },
         {
          "key": "integrations",
          "score": 40,
          "state": "open",
          "title": "Systems and integrations",
          "issues": [
           {
            "code": "integrations_missing",
            "message": "The systems and integrations section is empty.",
            "severity": "issue",
            "suggestion": "List each system, which way data flows, and how failures are handled."
           }
          ],
          "suggestions": []
         }
        ],
        "issueCount": 8,
        "readySections": 2,
        "totalSections": 10
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Submit and confirm",
    "narration": "The draft goes to agent review and then to Unwhelm staff, and the agent reads the status back so the client hears exactly where things stand.",
    "calls": [
     {
      "request": "Submit for review",
      "tool": "unw_submit_proposal_for_review",
      "args": {
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "state": "agent_review",
        "version": {
         "id": "3d004b16-6ccc-464c-85b0-0cc8adb7c1c7",
         "locked": false,
         "number": 1
        }
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Read the status back",
      "tool": "unw_get_proposal_status",
      "args": {
       "proposalId": "f886e653-0d49-4583-adb0-06b008c02629"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "f886e653-0d49-4583-adb0-06b008c02629",
        "review": {
         "state": "agent_review",
         "locked": false,
         "terminal": false,
         "openFlags": 0,
         "staffLabel": "Agent review",
         "clientLabel": "With Unwhelm",
         "openComments": 0,
         "versionNumber": 1,
         "approvedVersionId": null,
         "openBlockingFlags": 0,
         "openBlockingComments": 0
        },
        "status": "pending_approval",
        "version": 1,
        "updatedAt": "2026-10-27T03:49:27.855Z"
       },
       "warnings": []
      }
     }
    ]
   }
  ]
 },
 {
  "code": "scope_creep",
  "title": "Scope creep, handled gently",
  "description": "A client keeps adding to a small project. The agent shows what each addition would cost in progress, parks ideas for later, and offers a fresh start or a human.",
  "sections": [
   {
    "title": "Start small",
    "narration": "A tight draft first, and a look at progress.",
    "calls": [
     {
      "request": "Create the draft",
      "tool": "unw_create_proposal",
      "args": {
       "scope": {
        "summary": "Sync rental listings from a property management system to a public listings site every hour.",
        "exclusions": [
         "Changes to either vendor system"
        ],
        "assumptions": [
         "The client provides API credentials for both systems"
        ],
        "deliverables": [
         "Hourly listing sync job",
         "Field mapping document",
         "Error report email"
        ]
       },
       "title": "Try me: listing sync, small",
       "pricing": {
        "model": "fixed_price",
        "currency": "USD",
        "amountMinor": 300000
       },
       "timeline": {
        "startDate": "2026-11-02",
        "milestones": [],
        "targetDate": "2026-11-30"
       },
       "engagement": "fixed_price"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
        "scope": {
         "summary": "Sync rental listings from a property management system to a public listings site every hour.",
         "exclusions": [
          "Changes to either vendor system"
         ],
         "assumptions": [
          "The client provides API credentials for both systems"
         ],
         "deliverables": [
          "Hourly listing sync job",
          "Field mapping document",
          "Error report email"
         ]
        },
        "title": "Try me: listing sync, small",
        "status": "draft",
        "options": [],
        "ownerId": "89601bf7-290e-4f39-80ff-bf3d0ad83351",
        "pricing": {
         "model": "fixed_price",
         "currency": "USD",
         "amountMinor": 300000
        },
        "version": 1,
        "timeline": {
         "startDate": "2026-11-02",
         "milestones": [],
         "targetDate": "2026-11-30"
        },
        "createdAt": "2026-10-27T03:49:28.094Z",
        "updatedAt": "2026-10-27T03:49:28.094Z",
        "engagement": "fixed_price",
        "schemaVersion": 1,
        "organizationId": "21c29f89-9b84-46db-b93c-c74249a5b257"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Where we start",
      "tool": "unw_get_proposal_progress",
      "args": {
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "total": 11,
        "groups": [
         {
          "code": "needs_input",
          "label": "Needs your input",
          "parts": [
           {
            "key": "scope",
            "note": null,
            "group": "needs_input",
            "label": "Scope",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on scope.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "hours",
            "note": null,
            "group": "needs_input",
            "label": "Hours",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on hours.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "price",
            "note": null,
            "group": "needs_input",
            "label": "Price",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "hours",
             "options"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on price.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "options",
            "note": null,
            "group": "needs_input",
            "label": "Options",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on options.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "milestones",
            "note": null,
            "group": "needs_input",
            "label": "Milestones",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on milestones.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "schedule",
            "note": null,
            "group": "needs_input",
            "label": "Dates",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on dates.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "terms",
            "note": null,
            "group": "needs_input",
            "label": "Terms",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on terms.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "executive_summary",
            "note": null,
            "group": "needs_input",
            "label": "Executive summary",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on executive summary.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "background",
            "note": null,
            "group": "needs_input",
            "label": "Problem and background",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on problem and background.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "approach",
            "note": null,
            "group": "needs_input",
            "label": "Approach",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on approach.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "success_metrics",
            "note": null,
            "group": "needs_input",
            "label": "Success metrics",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on success metrics.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           }
          ],
          "settled": false
         }
        ],
        "phrase": "Just getting started",
        "handoff": {
         "body": "You do not need to finish everything. Send it as it is, and we will work through anything open or unsure together on the call.",
         "ready": false,
         "heading": "Ready for a call with Unwhelm",
         "reasons": [],
         "openParts": [
          "Scope",
          "Hours",
          "Price",
          "Options",
          "Milestones",
          "Dates",
          "Terms",
          "Executive summary",
          "Problem and background",
          "Approach",
          "Success metrics"
         ],
         "openSummary": "Still open: Scope, Hours, Price, Options, Milestones, Dates, Terms, Executive summary, Problem and background, Approach and Success metrics.",
         "submitLabel": "Send as it is",
         "discussParts": []
        },
        "percent": 0,
        "settled": 0,
        "headline": "0 of 11 parts settled",
        "nextStep": {
         "key": "scope",
         "text": "Tell us what you have in mind for scope."
        },
        "toDiscuss": 0,
        "lastSeenAt": null,
        "resolutions": [
         {
          "code": "unsure",
          "label": "Not sure, talk to a human",
          "flagsForCall": true
         },
         {
          "code": "staff_decides",
          "label": "Let Unwhelm decide",
          "flagsForCall": false
         },
         {
          "code": "out_of_scope",
          "label": "Out of scope / save for later",
          "flagsForCall": false
         }
        ],
        "savedForLater": {
         "note": "These ideas are kept for a follow-up and do not count toward progress.",
         "items": [],
         "heading": "Saved for later"
        },
        "sinceLastVisit": null
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "The client asks for more",
    "narration": "Before changing anything, the agent previews what the addition would undo, so the client sees why progress would drop.",
    "calls": [
     {
      "request": "What would this change undo?",
      "tool": "unw_preview_change_impact",
      "args": {
       "change": "Also sync guest reviews and photos from a second listings site.",
       "nodeKey": "scope",
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "held": [],
        "reopened": [],
        "sentence": "Adding Also sync guest reviews and photos from a second listings site. reopens nothing else: 0% to 0%; nothing stay locked.",
        "percentAfter": 0,
        "percentBefore": 0
       },
       "warnings": []
      }
     },
     {
      "request": "Progress is unchanged until they decide",
      "tool": "unw_get_proposal_progress",
      "args": {
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "total": 11,
        "groups": [
         {
          "code": "needs_input",
          "label": "Needs your input",
          "parts": [
           {
            "key": "scope",
            "note": null,
            "group": "needs_input",
            "label": "Scope",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on scope.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "hours",
            "note": null,
            "group": "needs_input",
            "label": "Hours",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on hours.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "price",
            "note": null,
            "group": "needs_input",
            "label": "Price",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "hours",
             "options"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on price.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "options",
            "note": null,
            "group": "needs_input",
            "label": "Options",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on options.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "milestones",
            "note": null,
            "group": "needs_input",
            "label": "Milestones",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on milestones.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "schedule",
            "note": null,
            "group": "needs_input",
            "label": "Dates",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on dates.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "terms",
            "note": null,
            "group": "needs_input",
            "label": "Terms",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on terms.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "executive_summary",
            "note": null,
            "group": "needs_input",
            "label": "Executive summary",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on executive summary.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "background",
            "note": null,
            "group": "needs_input",
            "label": "Problem and background",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on problem and background.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "approach",
            "note": null,
            "group": "needs_input",
            "label": "Approach",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on approach.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "success_metrics",
            "note": null,
            "group": "needs_input",
            "label": "Success metrics",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on success metrics.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           }
          ],
          "settled": false
         }
        ],
        "phrase": "Just getting started",
        "handoff": {
         "body": "You do not need to finish everything. Send it as it is, and we will work through anything open or unsure together on the call.",
         "ready": false,
         "heading": "Ready for a call with Unwhelm",
         "reasons": [],
         "openParts": [
          "Scope",
          "Hours",
          "Price",
          "Options",
          "Milestones",
          "Dates",
          "Terms",
          "Executive summary",
          "Problem and background",
          "Approach",
          "Success metrics"
         ],
         "openSummary": "Still open: Scope, Hours, Price, Options, Milestones, Dates, Terms, Executive summary, Problem and background, Approach and Success metrics.",
         "submitLabel": "Send as it is",
         "discussParts": []
        },
        "percent": 0,
        "settled": 0,
        "headline": "0 of 11 parts settled",
        "nextStep": {
         "key": "scope",
         "text": "Tell us what you have in mind for scope."
        },
        "toDiscuss": 0,
        "lastSeenAt": null,
        "resolutions": [
         {
          "code": "unsure",
          "label": "Not sure, talk to a human",
          "flagsForCall": true
         },
         {
          "code": "staff_decides",
          "label": "Let Unwhelm decide",
          "flagsForCall": false
         },
         {
          "code": "out_of_scope",
          "label": "Out of scope / save for later",
          "flagsForCall": false
         }
        ],
        "savedForLater": {
         "note": "These ideas are kept for a follow-up and do not count toward progress.",
         "items": [],
         "heading": "Saved for later"
        },
        "sinceLastVisit": null
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Park it for later",
    "narration": "Instead of growing this proposal, the idea is parked as a change and as a note for a follow-up project.",
    "calls": [
     {
      "request": "Park the change",
      "tool": "unw_park_change",
      "args": {
       "mode": "phase_2",
       "change": "Sync guest reviews and photos too.",
       "nodeKey": "scope",
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "d596b489-fb70-442b-9c4b-ae6269660167",
        "percent": 0,
        "reopened": []
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Park a note",
      "tool": "unw_park_item",
      "args": {
       "summary": "Phase 2 idea: reviews and photos sync.",
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "a226ec43-215d-4000-a614-031cf62bf02f",
        "summary": "Phase 2 idea: reviews and photos sync."
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "What is parked",
      "tool": "unw_list_parked",
      "args": {
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "items": [
         {
          "id": "a226ec43-215d-4000-a614-031cf62bf02f",
          "summary": "Phase 2 idea: reviews and photos sync.",
          "createdAt": "2026-10-27T03:49:28.569Z"
         }
        ]
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Tighten the draft",
    "narration": "A clearer title, then the agent submits the draft, which snapshots a version. It locks the scope against that version, so progress moves, shows that unlocking puts it back, and locks it again.",
    "calls": [
     {
      "request": "Rename it",
      "tool": "unw_update_proposal_section",
      "args": {
       "value": "Try me: hourly listing sync (phase 1)",
       "sectionId": "title",
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
        "scope": {
         "summary": "Sync rental listings from a property management system to a public listings site every hour.",
         "exclusions": [
          "Changes to either vendor system"
         ],
         "assumptions": [
          "The client provides API credentials for both systems"
         ],
         "deliverables": [
          "Hourly listing sync job",
          "Field mapping document",
          "Error report email"
         ]
        },
        "title": "Try me: hourly listing sync (phase 1)",
        "status": "draft",
        "options": [],
        "ownerId": "89601bf7-290e-4f39-80ff-bf3d0ad83351",
        "pricing": {
         "model": "fixed_price",
         "currency": "USD",
         "amountMinor": 300000
        },
        "version": 2,
        "timeline": {
         "startDate": "2026-11-02",
         "milestones": [],
         "targetDate": "2026-11-30"
        },
        "createdAt": "2026-10-27T03:49:28.094Z",
        "updatedAt": "2026-10-27T03:49:28.634Z",
        "engagement": "fixed_price",
        "schemaVersion": 1,
        "organizationId": "21c29f89-9b84-46db-b93c-c74249a5b257"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Submit, which snapshots a version",
      "tool": "unw_submit_proposal_for_review",
      "args": {
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "state": "agent_review",
        "version": {
         "id": "0e60b783-2bc2-47b5-83cb-3dc0a7ee963e",
         "locked": false,
         "number": 1
        }
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Lock the scope on that version",
      "tool": "unw_lock_node",
      "args": {
       "nodeKey": "scope",
       "versionId": "0e60b783-2bc2-47b5-83cb-3dc0a7ee963e",
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "key": "scope",
        "state": "locked",
        "percent": 9,
        "lockedVersionId": "0e60b783-2bc2-47b5-83cb-3dc0a7ee963e"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Progress with the scope locked",
      "tool": "unw_get_proposal_progress",
      "args": {
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "total": 11,
        "groups": [
         {
          "code": "locked",
          "label": "Locked",
          "parts": [
           {
            "key": "scope",
            "note": null,
            "group": "locked",
            "label": "Scope",
            "state": "locked",
            "settled": true,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Settled and locked to a version.",
            "reopenedBy": null,
            "stateLabel": "Locked"
           }
          ],
          "settled": true
         },
         {
          "code": "needs_input",
          "label": "Needs your input",
          "parts": [
           {
            "key": "hours",
            "note": null,
            "group": "needs_input",
            "label": "Hours",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on hours.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "price",
            "note": null,
            "group": "needs_input",
            "label": "Price",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "hours",
             "options"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on price.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "options",
            "note": null,
            "group": "needs_input",
            "label": "Options",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on options.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "milestones",
            "note": null,
            "group": "needs_input",
            "label": "Milestones",
            "state": "open",
            "settled": false,
            "dependsOn": [
             "scope"
            ],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on milestones.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "schedule",
            "note": null,
            "group": "needs_input",
            "label": "Dates",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on dates.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "terms",
            "note": null,
            "group": "needs_input",
            "label": "Terms",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on terms.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "executive_summary",
            "note": null,
            "group": "needs_input",
            "label": "Executive summary",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on executive summary.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "background",
            "note": null,
            "group": "needs_input",
            "label": "Problem and background",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on problem and background.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "approach",
            "note": null,
            "group": "needs_input",
            "label": "Approach",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on approach.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           },
           {
            "key": "success_metrics",
            "note": null,
            "group": "needs_input",
            "label": "Success metrics",
            "state": "open",
            "settled": false,
            "dependsOn": [],
            "toDiscuss": false,
            "whatsLeft": "Not started yet. We need your input on success metrics.",
            "reopenedBy": null,
            "stateLabel": "Not started"
           }
          ],
          "settled": false
         }
        ],
        "phrase": "Just getting started",
        "handoff": {
         "body": "You do not need to finish everything. Send it as it is, and we will work through anything open or unsure together on the call.",
         "ready": false,
         "heading": "Ready for a call with Unwhelm",
         "reasons": [],
         "openParts": [
          "Hours",
          "Price",
          "Options",
          "Milestones",
          "Dates",
          "Terms",
          "Executive summary",
          "Problem and background",
          "Approach",
          "Success metrics"
         ],
         "openSummary": "Still open: Hours, Price, Options, Milestones, Dates, Terms, Executive summary, Problem and background, Approach and Success metrics.",
         "submitLabel": "Send as it is",
         "discussParts": []
        },
        "percent": 9,
        "settled": 1,
        "headline": "1 of 11 parts settled",
        "nextStep": {
         "key": "hours",
         "text": "Tell us what you have in mind for hours."
        },
        "toDiscuss": 0,
        "lastSeenAt": null,
        "resolutions": [
         {
          "code": "unsure",
          "label": "Not sure, talk to a human",
          "flagsForCall": true
         },
         {
          "code": "staff_decides",
          "label": "Let Unwhelm decide",
          "flagsForCall": false
         },
         {
          "code": "out_of_scope",
          "label": "Out of scope / save for later",
          "flagsForCall": false
         }
        ],
        "savedForLater": {
         "note": "These ideas are kept for a follow-up and do not count toward progress.",
         "items": [
          {
           "id": "d596b489-fb70-442b-9c4b-ae6269660167",
           "nodeKey": "scope",
           "summary": "Sync guest reviews and photos too."
          },
          {
           "id": "a226ec43-215d-4000-a614-031cf62bf02f",
           "nodeKey": null,
           "summary": "Phase 2 idea: reviews and photos sync."
          }
         ],
         "heading": "Saved for later"
        },
        "sinceLastVisit": null
       },
       "warnings": []
      }
     },
     {
      "request": "Unlock it",
      "tool": "unw_unlock_node",
      "args": {
       "nodeKey": "scope",
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "held": [],
        "applied": true,
        "reopened": [
         {
          "to": "needs_review",
          "key": "scope",
          "from": "locked",
          "clientLabel": "scope"
         },
         {
          "to": "needs_review",
          "key": "hours",
          "from": "open",
          "clientLabel": "hours"
         },
         {
          "to": "needs_review",
          "key": "price",
          "from": "open",
          "clientLabel": "price"
         },
         {
          "to": "needs_review",
          "key": "milestones",
          "from": "open",
          "clientLabel": "milestones"
         }
        ],
        "sentence": "Adding unlock scope reopens scope, hours, price and milestones: 9% to 0%; nothing stay locked.",
        "percentAfter": 0,
        "percentBefore": 9
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Lock the scope again",
      "tool": "unw_lock_node",
      "args": {
       "nodeKey": "scope",
       "versionId": "0e60b783-2bc2-47b5-83cb-3dc0a7ee963e",
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "key": "scope",
        "state": "locked",
        "percent": 9,
        "lockedVersionId": "0e60b783-2bc2-47b5-83cb-3dc0a7ee963e"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "The tree now",
      "tool": "unw_get_completion_tree",
      "args": {
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "edges": [
         {
          "id": "e4e27b8d-e8f9-4cc5-91ba-13c23b968085",
          "toKey": "hours",
          "fromKey": "scope"
         },
         {
          "id": "27b3045f-c0ea-4257-85ca-7fe170ff6ad1",
          "toKey": "price",
          "fromKey": "hours"
         },
         {
          "id": "03c7eb57-b05b-42d8-9852-5ced5bae2028",
          "toKey": "milestones",
          "fromKey": "scope"
         },
         {
          "id": "ec15957d-4dcc-4b29-b046-e31298bc3be0",
          "toKey": "price",
          "fromKey": "options"
         }
        ],
        "nodes": [
         {
          "id": "61a59608-7cf1-452d-b0f1-e94c386888d5",
          "key": "scope",
          "body": {
           "change": "unlock scope",
           "sourceKey": "scope"
          },
          "kind": "scope",
          "title": "Scope",
          "createdAt": "2026-10-27T03:49:28.130Z",
          "parentKey": null,
          "sortOrder": 10,
          "stateCode": "locked",
          "updatedAt": "2026-10-27T03:49:28.838Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Locked",
          "clientLabel": "scope",
          "lockedVersionId": "0e60b783-2bc2-47b5-83cb-3dc0a7ee963e"
         },
         {
          "id": "f2cb7efc-0410-4e3a-b1e0-599f8e3f152b",
          "key": "hours",
          "body": {
           "change": "unlock scope",
           "sourceKey": "scope"
          },
          "kind": "hours",
          "title": "Hours",
          "createdAt": "2026-10-27T03:49:28.133Z",
          "parentKey": "scope",
          "sortOrder": 20,
          "stateCode": "needs_review",
          "updatedAt": "2026-10-27T03:49:28.796Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Needs another look",
          "clientLabel": "hours",
          "lockedVersionId": null
         },
         {
          "id": "02786c71-1b41-46ab-859f-a1fc9d01088c",
          "key": "price",
          "body": {
           "change": "unlock scope",
           "sourceKey": "scope"
          },
          "kind": "price",
          "title": "Price",
          "createdAt": "2026-10-27T03:49:28.137Z",
          "parentKey": "hours",
          "sortOrder": 30,
          "stateCode": "needs_review",
          "updatedAt": "2026-10-27T03:49:28.799Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Needs another look",
          "clientLabel": "price",
          "lockedVersionId": null
         },
         {
          "id": "f7eb3e48-cc09-4201-b002-d17a961fc680",
          "key": "options",
          "body": {},
          "kind": "option",
          "title": "Options",
          "createdAt": "2026-10-27T03:49:28.140Z",
          "parentKey": "price",
          "sortOrder": 35,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:28.140Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Not started",
          "clientLabel": "options",
          "lockedVersionId": null
         },
         {
          "id": "221219db-fcea-4273-b559-8c47f4458aa2",
          "key": "milestones",
          "body": {
           "change": "unlock scope",
           "sourceKey": "scope"
          },
          "kind": "milestone",
          "title": "Milestones",
          "createdAt": "2026-10-27T03:49:28.144Z",
          "parentKey": "scope",
          "sortOrder": 40,
          "stateCode": "needs_review",
          "updatedAt": "2026-10-27T03:49:28.803Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Needs another look",
          "clientLabel": "milestones",
          "lockedVersionId": null
         },
         {
          "id": "f8e0cfae-51a0-43a7-8383-20e5d06c3238",
          "key": "schedule",
          "body": {},
          "kind": "schedule",
          "title": "Schedule",
          "createdAt": "2026-10-27T03:49:28.147Z",
          "parentKey": null,
          "sortOrder": 50,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:28.147Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Not started",
          "clientLabel": "dates",
          "lockedVersionId": null
         },
         {
          "id": "2fb1c9aa-0c29-4972-b174-f663b59702a2",
          "key": "terms",
          "body": {},
          "kind": "terms",
          "title": "Terms",
          "createdAt": "2026-10-27T03:49:28.151Z",
          "parentKey": null,
          "sortOrder": 60,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:28.151Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Not started",
          "clientLabel": "terms",
          "lockedVersionId": null
         },
         {
          "id": "ed1865ea-17b1-4d19-8861-e82fe51ebd71",
          "key": "executive_summary",
          "body": {},
          "kind": "section",
          "title": "Executive summary",
          "createdAt": "2026-10-27T03:49:28.155Z",
          "parentKey": null,
          "sortOrder": 70,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:28.155Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Not started",
          "clientLabel": "executive summary",
          "lockedVersionId": null
         },
         {
          "id": "5a6c2bbb-1dd4-41fa-bc49-4f88ec54f024",
          "key": "background",
          "body": {},
          "kind": "section",
          "title": "Problem and background",
          "createdAt": "2026-10-27T03:49:28.160Z",
          "parentKey": null,
          "sortOrder": 80,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:28.160Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Not started",
          "clientLabel": "problem and background",
          "lockedVersionId": null
         },
         {
          "id": "05743141-1fef-4bac-8179-594510000588",
          "key": "approach",
          "body": {},
          "kind": "section",
          "title": "Approach",
          "createdAt": "2026-10-27T03:49:28.164Z",
          "parentKey": null,
          "sortOrder": 90,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:28.164Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Not started",
          "clientLabel": "approach",
          "lockedVersionId": null
         },
         {
          "id": "d1a76134-0708-4fd6-8217-29ccd396daad",
          "key": "success_metrics",
          "body": {},
          "kind": "section",
          "title": "Success metrics",
          "createdAt": "2026-10-27T03:49:28.167Z",
          "parentKey": null,
          "sortOrder": 100,
          "stateCode": "open",
          "updatedAt": "2026-10-27T03:49:28.167Z",
          "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
          "stateLabel": "Not started",
          "clientLabel": "success metrics",
          "lockedVersionId": null
         }
        ],
        "parked": [
         {
          "id": "d596b489-fb70-442b-9c4b-ae6269660167",
          "mode": "phase_2",
          "nodeKey": "scope",
          "summary": "Sync guest reviews and photos too.",
          "swapSummary": null
         }
        ],
        "states": [
         {
          "code": "open",
          "clientLabel": "Not started",
          "completionWeight": 0
         },
         {
          "code": "drafted",
          "clientLabel": "Drafted",
          "completionWeight": 0
         },
         {
          "code": "needs_review",
          "clientLabel": "Needs another look",
          "completionWeight": 0
         },
         {
          "code": "agreed",
          "clientLabel": "Agreed",
          "completionWeight": 1
         },
         {
          "code": "unsure",
          "clientLabel": "To talk through with us",
          "completionWeight": 1
         },
         {
          "code": "staff_decides",
          "clientLabel": "Unwhelm will decide",
          "completionWeight": 1
         },
         {
          "code": "out_of_scope",
          "clientLabel": "Out of scope for now",
          "completionWeight": 1
         },
         {
          "code": "locked",
          "clientLabel": "Locked",
          "completionWeight": 1
         }
        ],
        "history": [
         {
          "id": "7211dd33-7384-4af0-a891-bbee40374c11",
          "reason": "Locked scope on version 0e60b783-2bc2-47b5-83cb-3dc0a7ee963e.",
          "createdAt": "2026-10-27T03:49:28.726Z",
          "percentAfter": 9,
          "percentBefore": 0
         },
         {
          "id": "8482f152-d527-4365-9f3d-b09425ad4226",
          "reason": "Adding unlock scope reopens scope, hours, price and milestones: 9% to 0%; nothing stay locked.",
          "createdAt": "2026-10-27T03:49:28.806Z",
          "percentAfter": 0,
          "percentBefore": 9
         },
         {
          "id": "43384fba-cff1-465e-b40e-86ef4d740d5f",
          "reason": "Locked scope on version 0e60b783-2bc2-47b5-83cb-3dc0a7ee963e.",
          "createdAt": "2026-10-27T03:49:28.841Z",
          "percentAfter": 9,
          "percentBefore": 0
         }
        ],
        "percent": 9,
        "parkModes": [
         {
          "code": "phase_2",
          "reopens": false,
          "clientLabel": "Park as a later phase"
         },
         {
          "code": "swap",
          "reopens": false,
          "clientLabel": "Swap for a similar item"
         }
        ]
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Fresh start or a human",
    "narration": "When the shape stops working, the agent can copy the draft into a new one, or recommend a person.",
    "calls": [
     {
      "request": "Copy into a phase 2 draft",
      "tool": "unw_duplicate_proposal",
      "args": {
       "title": "Try me: listing sync, phase 2",
       "reason": "Split the extra scope into its own proposal.",
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "copied": {
         "nodes": 11,
         "groups": 0,
         "options": 0,
         "milestones": 0
        },
        "proposal": {
         "id": "56950ce5-449c-4494-880a-78799d2a99cb",
         "title": "Try me: listing sync, phase 2",
         "status": "draft",
         "pricing": {
          "model": "fixed_price",
          "currency": "USD",
          "amountMinor": 300000
         },
         "engagement": "fixed_price",
         "reviewState": "draft",
         "pricingModel": "fixed_price"
        },
        "sourceProposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
        "pendingStaffPrice": false
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Recommend a human",
      "tool": "unw_recommend_handoff",
      "args": {
       "note": "Client keeps widening scope; a human should help shape it.",
       "proposalId": "be3bd24d-a640-4f1a-b4c2-565371cf74ed",
       "reasonCode": "scope_unbounded"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "d1936c0d-5562-4e57-9b9f-6fca3f08e8b5",
        "note": "Client keeps widening scope; a human should help shape it.",
        "createdAt": "2026-10-27T03:49:28.982Z",
        "reasonCode": "scope_unbounded"
       },
       "warnings": []
      }
     }
    ]
   }
  ]
 },
 {
  "code": "reminders",
  "title": "Reminders and ticklers",
  "description": "How the client picks a reminder channel and timing, and how the agent schedules and stops a nudge. Nothing is sent from the demo.",
  "sections": [
   {
    "title": "Pick a channel",
    "narration": "The agent reads the reminder options from the database and records the client's choice: email, with consent. Delivery is a staff job, so the demo never sends anything.",
    "calls": [
     {
      "request": "Channels and timings on offer",
      "tool": "unw_get_reminder_options",
      "args": {},
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "channels": [
         {
          "code": "email",
          "label": "Email",
          "sendsSms": false,
          "sortOrder": 10,
          "sendsEmail": true
         },
         {
          "code": "sms",
          "label": "Text message",
          "sendsSms": true,
          "sortOrder": 20,
          "sendsEmail": false
         },
         {
          "code": "both",
          "label": "Email and text",
          "sendsSms": true,
          "sortOrder": 30,
          "sendsEmail": true
         },
         {
          "code": "none",
          "label": "Please don't remind me",
          "sendsSms": false,
          "sortOrder": 40,
          "sendsEmail": false
         }
        ],
        "defaults": {
         "quietEnd": "08:00",
         "timezone": "America/Los_Angeles",
         "quietStart": "21:00",
         "ticklerTime": "09:00",
         "maxIntervalDays": 30,
         "minIntervalDays": 1,
         "ticklerMaxCount": 5
        },
        "ticklerOptions": [
         {
          "code": "tomorrow_at",
          "label": "Tomorrow at a time I pick",
          "active": true,
          "repeats": false,
          "sortOrder": 10,
          "defaultDays": 1
         },
         {
          "code": "snooze",
          "label": "In a few days",
          "active": true,
          "repeats": false,
          "sortOrder": 20,
          "defaultDays": 3
         },
         {
          "code": "every_n_days",
          "label": "Every few days until I finish",
          "active": true,
          "repeats": true,
          "sortOrder": 30,
          "defaultDays": 3
         },
         {
          "code": "weekly",
          "label": "Once a week on a day I pick",
          "active": true,
          "repeats": true,
          "sortOrder": 40,
          "defaultDays": 7
         }
        ]
       },
       "warnings": []
      }
     },
     {
      "request": "Email, with consent",
      "tool": "unw_set_contact_preference",
      "args": {
       "email": "demo.client@example.com",
       "channel": "email",
       "consent": true,
       "timezone": "America/Los_Angeles"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "preference": {
         "email": "demo.client@example.com",
         "phone": null,
         "channel": "email",
         "optedOut": false,
         "quietEnd": null,
         "timezone": "America/Los_Angeles",
         "consentAt": "2026-10-27T03:49:29.209Z",
         "updatedAt": "2026-10-27T03:49:29.210Z",
         "optedOutAt": null,
         "quietStart": null
        }
       },
       "changed": true,
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Start a draft",
    "narration": "Reminders are tied to an unfinished proposal.",
    "calls": [
     {
      "request": "Create the draft",
      "tool": "unw_create_proposal",
      "args": {
       "scope": {
        "summary": "Sync rental listings from a property management system to a public listings site every hour.",
        "exclusions": [
         "Changes to either vendor system"
        ],
        "assumptions": [
         "The client provides API credentials for both systems"
        ],
        "deliverables": [
         "Hourly listing sync job",
         "Field mapping document",
         "Error report email"
        ]
       },
       "title": "Try me: tickler demo",
       "pricing": {
        "model": "fixed_price",
        "currency": "USD",
        "amountMinor": 300000
       },
       "timeline": {
        "startDate": "2026-11-02",
        "milestones": [],
        "targetDate": "2026-11-30"
       },
       "engagement": "fixed_price"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "0444d58b-70e9-4ad5-bb2a-54ed15b082cc",
        "scope": {
         "summary": "Sync rental listings from a property management system to a public listings site every hour.",
         "exclusions": [
          "Changes to either vendor system"
         ],
         "assumptions": [
          "The client provides API credentials for both systems"
         ],
         "deliverables": [
          "Hourly listing sync job",
          "Field mapping document",
          "Error report email"
         ]
        },
        "title": "Try me: tickler demo",
        "status": "draft",
        "options": [],
        "ownerId": "facb4929-3c37-4b73-98e0-b8e55f8af871",
        "pricing": {
         "model": "fixed_price",
         "currency": "USD",
         "amountMinor": 300000
        },
        "version": 1,
        "timeline": {
         "startDate": "2026-11-02",
         "milestones": [],
         "targetDate": "2026-11-30"
        },
        "createdAt": "2026-10-27T03:49:29.523Z",
        "updatedAt": "2026-10-27T03:49:29.523Z",
        "engagement": "fixed_price",
        "schemaVersion": 1,
        "organizationId": "37d4ebc2-eb64-434e-8bb3-58c8b1fbeda7"
       },
       "changed": true,
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Schedule a nudge, then stop it",
    "narration": "The client asks for a nudge every three days. They chose email, so the server schedules it. Then the agent stops it, which always works.",
    "calls": [
     {
      "request": "Every 3 days at 9am",
      "tool": "unw_set_tickler",
      "args": {
       "option": "every_n_days",
       "timeOfDay": "09:00",
       "proposalId": "0444d58b-70e9-4ad5-bb2a-54ed15b082cc",
       "intervalDays": 3
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "tickler": {
         "id": "b688dd78-0404-4345-a046-91c479aeeda9",
         "nextAt": "2026-10-29T16:00:00.000Z",
         "userId": "facb4929-3c37-4b73-98e0-b8e55f8af871",
         "weekday": null,
         "createdAt": "2026-10-27T03:49:29.571Z",
         "sentCount": 0,
         "stoppedAt": null,
         "timeOfDay": "09:00",
         "updatedAt": "2026-10-27T03:49:29.571Z",
         "optionCode": "every_n_days",
         "proposalId": "0444d58b-70e9-4ad5-bb2a-54ed15b082cc",
         "stopReason": null,
         "intervalDays": 3
        },
        "timezone": "America/Los_Angeles"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Stop the tickler",
      "tool": "unw_set_tickler",
      "args": {
       "stop": true,
       "proposalId": "0444d58b-70e9-4ad5-bb2a-54ed15b082cc"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "stopped": 1
       },
       "changed": true,
       "warnings": []
      }
     }
    ]
   }
  ]
 },
 {
  "code": "review_loop",
  "title": "Review, comments, and acceptance",
  "description": "A submitted proposal goes through comments and flags. The agent shows where the review stands and when the proposal expires.",
  "sections": [
   {
    "title": "Draft and submit",
    "narration": "A draft goes straight to review.",
    "calls": [
     {
      "request": "Create the draft",
      "tool": "unw_create_proposal",
      "args": {
       "scope": {
        "summary": "Sync rental listings from a property management system to a public listings site every hour.",
        "exclusions": [
         "Changes to either vendor system"
        ],
        "assumptions": [
         "The client provides API credentials for both systems"
        ],
        "deliverables": [
         "Hourly listing sync job",
         "Field mapping document",
         "Error report email"
        ]
       },
       "title": "Try me: review demo",
       "pricing": {
        "model": "fixed_price",
        "currency": "USD",
        "amountMinor": 300000
       },
       "timeline": {
        "startDate": "2026-11-02",
        "milestones": [],
        "targetDate": "2026-11-30"
       },
       "engagement": "fixed_price"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "0b186ead-e02a-4cbd-9649-8588f991d14e",
        "scope": {
         "summary": "Sync rental listings from a property management system to a public listings site every hour.",
         "exclusions": [
          "Changes to either vendor system"
         ],
         "assumptions": [
          "The client provides API credentials for both systems"
         ],
         "deliverables": [
          "Hourly listing sync job",
          "Field mapping document",
          "Error report email"
         ]
        },
        "title": "Try me: review demo",
        "status": "draft",
        "options": [],
        "ownerId": "88eb5836-19c5-45f4-b677-b8537a478cce",
        "pricing": {
         "model": "fixed_price",
         "currency": "USD",
         "amountMinor": 300000
        },
        "version": 1,
        "timeline": {
         "startDate": "2026-11-02",
         "milestones": [],
         "targetDate": "2026-11-30"
        },
        "createdAt": "2026-10-27T03:49:29.885Z",
        "updatedAt": "2026-10-27T03:49:29.885Z",
        "engagement": "fixed_price",
        "schemaVersion": 1,
        "organizationId": "38e0ac52-ca38-4778-a038-b4dc616e622d"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Submit",
      "tool": "unw_submit_proposal_for_review",
      "args": {
       "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "state": "agent_review",
        "version": {
         "id": "7a639b14-892b-4380-a0ba-3858ebbb2062",
         "locked": false,
         "number": 1
        }
       },
       "changed": true,
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Comment and flag",
    "narration": "The client asks a question, reads the feedback, resolves it, and flags a concern.",
    "calls": [
     {
      "request": "Ask a question",
      "tool": "unw_add_review_comment",
      "args": {
       "body": "Does the hourly sync include deleted listings?",
       "type": "question",
       "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e",
       "targetKind": "proposal",
       "visibility": "client"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "ad9136fe-9b2e-4edf-8832-179323f86ef0",
        "status": "open",
        "visibility": "client"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "All feedback",
      "tool": "unw_list_review_feedback",
      "args": {
       "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "flags": [],
        "state": "agent_review",
        "events": [
         {
          "id": "917d5633-6b5a-45d0-bbbd-dbd6bad950ca",
          "to": "agent_review",
          "from": "draft",
          "actorId": "88eb5836-19c5-45f4-b677-b8537a478cce",
          "actorRole": "agent",
          "createdAt": "2026-10-27T03:49:29.938Z",
          "reasonCode": null,
          "reasonText": null
         }
        ],
        "meeting": null,
        "comments": [
         {
          "id": "ad9136fe-9b2e-4edf-8832-179323f86ef0",
          "body": "Does the hourly sync include deleted listings?",
          "type": "question",
          "status": "open",
          "parentId": null,
          "targetId": null,
          "createdAt": "2026-10-27T03:49:30.238Z",
          "authorRole": "agent",
          "targetKind": "proposal",
          "visibility": "client"
         }
        ],
        "versions": [
         {
          "id": "7a639b14-892b-4380-a0ba-3858ebbb2062",
          "locked": false,
          "number": 1,
          "reason": "submit",
          "createdAt": "2026-10-27T03:49:29.933Z"
         }
        ],
        "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e",
        "staffLabel": "Agent review",
        "clientLabel": "With Unwhelm",
        "reasonCodes": [
         {
          "code": "budget",
          "label": "Budget",
          "actions": [
           "reject",
           "withdraw"
          ]
         },
         {
          "code": "timing",
          "label": "Timing",
          "actions": [
           "reject",
           "withdraw"
          ]
         },
         {
          "code": "scope",
          "label": "Scope",
          "actions": [
           "reject",
           "withdraw"
          ]
         },
         {
          "code": "chose_other",
          "label": "Chose someone else",
          "actions": [
           "reject",
           "withdraw"
          ]
         },
         {
          "code": "other",
          "label": "Other",
          "actions": [
           "reject",
           "withdraw"
          ]
         }
        ],
        "commentTypes": [
         {
          "code": "question",
          "blocksApproval": false
         },
         {
          "code": "pushback",
          "blocksApproval": false
         },
         {
          "code": "clarification",
          "blocksApproval": false
         },
         {
          "code": "needs_bounding",
          "blocksApproval": true
         }
        ],
        "visibilities": [
         "client"
        ],
        "clientEditable": false,
        "approvedVersionId": null,
        "allowedTransitions": [
         {
          "to": "withdrawn",
          "label": "Withdraw",
          "action": "withdraw",
          "requiresReason": true,
          "requiresComment": false
         }
        ]
       },
       "warnings": []
      }
     },
     {
      "request": "Resolve it",
      "tool": "unw_resolve_review_comment",
      "args": {
       "commentId": "ad9136fe-9b2e-4edf-8832-179323f86ef0",
       "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "ad9136fe-9b2e-4edf-8832-179323f86ef0",
        "status": "resolved"
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Flag a concern",
      "tool": "unw_add_review_flag",
      "args": {
       "reason": "Client wants a second look at timeline.",
       "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e",
       "targetKind": "proposal",
       "visibility": "client"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "cdc4776e-02c7-4588-8fed-8729d5d45b37",
        "status": "open",
        "blocksApproval": true
       },
       "changed": true,
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Where it stands",
    "narration": "Approving is a staff decision, so the agent reads the review status and the feedback back to the client instead.",
    "calls": [
     {
      "request": "Where the review stands",
      "tool": "unw_get_proposal_status",
      "args": {
       "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "0b186ead-e02a-4cbd-9649-8588f991d14e",
        "review": {
         "state": "agent_review",
         "locked": false,
         "terminal": false,
         "openFlags": 1,
         "staffLabel": "Agent review",
         "clientLabel": "With Unwhelm",
         "openComments": 0,
         "versionNumber": 1,
         "approvedVersionId": null,
         "openBlockingFlags": 1,
         "openBlockingComments": 0
        },
        "status": "pending_approval",
        "version": 1,
        "updatedAt": "2026-10-27T03:49:29.934Z"
       },
       "warnings": []
      }
     },
     {
      "request": "Feedback after resolving",
      "tool": "unw_list_review_feedback",
      "args": {
       "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "flags": [
         {
          "id": "cdc4776e-02c7-4588-8fed-8729d5d45b37",
          "kind": "unbounded",
          "reason": "Client wants a second look at timeline.",
          "status": "open",
          "targetId": null,
          "automatic": false,
          "createdAt": "2026-10-27T03:49:30.344Z",
          "authorRole": "agent",
          "targetKind": "proposal",
          "visibility": "client",
          "blocksApproval": true
         }
        ],
        "state": "agent_review",
        "events": [
         {
          "id": "917d5633-6b5a-45d0-bbbd-dbd6bad950ca",
          "to": "agent_review",
          "from": "draft",
          "actorId": "88eb5836-19c5-45f4-b677-b8537a478cce",
          "actorRole": "agent",
          "createdAt": "2026-10-27T03:49:29.938Z",
          "reasonCode": null,
          "reasonText": null
         }
        ],
        "meeting": null,
        "comments": [
         {
          "id": "ad9136fe-9b2e-4edf-8832-179323f86ef0",
          "body": "Does the hourly sync include deleted listings?",
          "type": "question",
          "status": "resolved",
          "parentId": null,
          "targetId": null,
          "createdAt": "2026-10-27T03:49:30.238Z",
          "authorRole": "agent",
          "targetKind": "proposal",
          "visibility": "client"
         }
        ],
        "versions": [
         {
          "id": "7a639b14-892b-4380-a0ba-3858ebbb2062",
          "locked": false,
          "number": 1,
          "reason": "submit",
          "createdAt": "2026-10-27T03:49:29.933Z"
         }
        ],
        "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e",
        "staffLabel": "Agent review",
        "clientLabel": "With Unwhelm",
        "reasonCodes": [
         {
          "code": "budget",
          "label": "Budget",
          "actions": [
           "reject",
           "withdraw"
          ]
         },
         {
          "code": "timing",
          "label": "Timing",
          "actions": [
           "reject",
           "withdraw"
          ]
         },
         {
          "code": "scope",
          "label": "Scope",
          "actions": [
           "reject",
           "withdraw"
          ]
         },
         {
          "code": "chose_other",
          "label": "Chose someone else",
          "actions": [
           "reject",
           "withdraw"
          ]
         },
         {
          "code": "other",
          "label": "Other",
          "actions": [
           "reject",
           "withdraw"
          ]
         }
        ],
        "commentTypes": [
         {
          "code": "question",
          "blocksApproval": false
         },
         {
          "code": "pushback",
          "blocksApproval": false
         },
         {
          "code": "clarification",
          "blocksApproval": false
         },
         {
          "code": "needs_bounding",
          "blocksApproval": true
         }
        ],
        "visibilities": [
         "client"
        ],
        "clientEditable": false,
        "approvedVersionId": null,
        "allowedTransitions": [
         {
          "to": "withdrawn",
          "label": "Withdraw",
          "action": "withdraw",
          "requiresReason": true,
          "requiresComment": false
         }
        ]
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Expiry and options",
    "narration": "The agent checks when the proposal expires and which add-on options it carries. Extending and accepting need staff, so they live in the boundaries plan.",
    "calls": [
     {
      "request": "When does it expire?",
      "tool": "unw_get_proposal_expiry",
      "args": {
       "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "label": "Open",
        "state": "active",
        "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e",
        "validUntil": "2026-11-26T03:49:29.885Z",
        "daysRemaining": 30,
        "nearExpiryDays": 7
       },
       "warnings": []
      }
     },
     {
      "request": "Options on offer (none on this draft)",
      "tool": "unw_select_proposal_options",
      "args": {
       "optionIds": [],
       "proposalId": "0b186ead-e02a-4cbd-9649-8588f991d14e"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "options": [],
        "totalMinor": 300000,
        "needsImpact": false
       },
       "changed": true,
       "warnings": []
      }
     }
    ]
   }
  ]
 },
 {
  "code": "consult_chat",
  "title": "Free consult and chat",
  "description": "The client books a free consult and talks to the proposal agent in a chat session.",
  "sections": [
   {
    "title": "Free consult",
    "narration": "Offerings come from the database. The request lands in the staff intake queue.",
    "calls": [
     {
      "request": "What's on offer",
      "tool": "unw_list_consult_offerings",
      "args": {},
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "items": [
         {
          "code": "free_consult",
          "label": "Free consult",
          "price": {
           "currency": "USD",
           "amountMinor": 0
          },
          "description": "A free conversation about one workflow. We listen, ask questions, and suggest a next step.",
          "perClientLimit": 1,
          "durationMinutes": 30
         }
        ]
       },
       "warnings": []
      }
     },
     {
      "request": "Request a consult",
      "tool": "unw_request_free_consult",
      "args": {
       "topic": "Try me: listing sync questions",
       "details": "Demo request; safe to ignore."
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "intake": {
         "id": "1d92ae04-ae36-420e-8552-0140cdd4e147",
         "topic": "Try me: listing sync questions",
         "createdAt": "2026-10-27T03:49:30.649Z",
         "scheduledAt": null,
         "offeringCode": "free_consult",
         "bookingReference": null
        },
        "offering": {
         "code": "free_consult",
         "label": "Free consult",
         "price": {
          "currency": "USD",
          "amountMinor": 0
         },
         "description": "A free conversation about one workflow. We listen, ask questions, and suggest a next step.",
         "perClientLimit": 1,
         "durationMinutes": 30
        },
        "proposal": {
         "id": "55fd5960-58bc-4ae7-a826-0aa66944089c",
         "title": "Free consult: Try me: listing sync questions",
         "status": "draft",
         "pricing": {
          "model": "fixed_price",
          "currency": "USD",
          "offering": "free_consult",
          "amountMinor": 0
         },
         "reviewState": "draft"
        },
        "remaining": 0
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "My consult requests",
      "tool": "unw_list_consult_intakes",
      "args": {},
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "items": [
         {
          "id": "1d92ae04-ae36-420e-8552-0140cdd4e147",
          "topic": "Try me: listing sync questions",
          "userId": "9fbe39c3-c5de-4caf-90ba-655f71f0f0a0",
          "details": "Demo request; safe to ignore.",
          "createdAt": "2026-10-27T03:49:30.649Z",
          "proposalId": "55fd5960-58bc-4ae7-a826-0aa66944089c",
          "scheduledAt": null,
          "offeringCode": "free_consult",
          "organizationId": "8cebe474-715d-4264-ad5b-a5605d835896",
          "bookingReference": null
         }
        ]
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Chat with the proposal agent",
    "narration": "A chat session holds the conversation behind a proposal.",
    "calls": [
     {
      "request": "Open a chat",
      "tool": "unw_create_chat_session",
      "args": {
       "agent": "proposal"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "id": "48da5fc5-f4f4-4e4d-b487-767695eb369a",
        "agent": "proposal",
        "status": "open",
        "ownerId": "9fbe39c3-c5de-4caf-90ba-655f71f0f0a0",
        "createdAt": "2026-10-27T03:49:30.969Z",
        "updatedAt": "2026-10-27T03:49:30.969Z",
        "proposalId": null
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "Say hello",
      "tool": "unw_send_chat_message",
      "args": {
       "content": "Hi, I want to sync rental listings to my website every hour.",
       "sessionId": "48da5fc5-f4f4-4e4d-b487-767695eb369a"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "reply": {
         "id": "5da63764-a412-470c-b7d6-14f4f1ff3fcf",
         "role": "assistant",
         "content": "Stored. No proposal model is connected yet, so this reply only confirms: Hi, I want to sync rental listings to my website every hour.",
         "createdAt": "2026-10-27T03:49:31.004Z",
         "sessionId": "48da5fc5-f4f4-4e4d-b487-767695eb369a",
         "toolCallId": null
        },
        "message": {
         "id": "16a03306-b138-4e14-9efc-a1d678851ac1",
         "role": "user",
         "content": "Hi, I want to sync rental listings to my website every hour.",
         "createdAt": "2026-10-27T03:49:30.999Z",
         "sessionId": "48da5fc5-f4f4-4e4d-b487-767695eb369a",
         "toolCallId": null
        }
       },
       "changed": true,
       "warnings": []
      }
     },
     {
      "request": "The conversation",
      "tool": "unw_list_chat_messages",
      "args": {
       "sessionId": "48da5fc5-f4f4-4e4d-b487-767695eb369a"
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "items": [
         {
          "id": "16a03306-b138-4e14-9efc-a1d678851ac1",
          "role": "user",
          "content": "Hi, I want to sync rental listings to my website every hour.",
          "createdAt": "2026-10-27T03:49:30.999Z",
          "sessionId": "48da5fc5-f4f4-4e4d-b487-767695eb369a",
          "toolCallId": null
         },
         {
          "id": "5da63764-a412-470c-b7d6-14f4f1ff3fcf",
          "role": "assistant",
          "content": "Stored. No proposal model is connected yet, so this reply only confirms: Hi, I want to sync rental listings to my website every hour.",
          "createdAt": "2026-10-27T03:49:31.004Z",
          "sessionId": "48da5fc5-f4f4-4e4d-b487-767695eb369a",
          "toolCallId": null
         }
        ],
        "nextCursor": null,
        "totalEstimate": null
       },
       "warnings": []
      }
     },
     {
      "request": "My chats",
      "tool": "unw_list_chat_sessions",
      "args": {
       "limit": 5
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "items": [
         {
          "id": "48da5fc5-f4f4-4e4d-b487-767695eb369a",
          "agent": "proposal",
          "status": "open",
          "ownerId": "9fbe39c3-c5de-4caf-90ba-655f71f0f0a0",
          "createdAt": "2026-10-27T03:49:30.969Z",
          "updatedAt": "2026-10-27T03:49:30.969Z",
          "proposalId": null
         }
        ],
        "nextCursor": null,
        "totalEstimate": null
       },
       "warnings": []
      }
     }
    ]
   }
  ]
 },
 {
  "code": "after_sale",
  "title": "After the sale: contracts and billing",
  "description": "What a client can read once a proposal becomes a contract: projects, payment terms and invoices. Contract-only and staff tools are in the boundaries plan.",
  "sections": [
   {
    "title": "Projects",
    "narration": "Accepted work shows up as a project. A fresh sandbox has none yet, so the list starts empty.",
    "calls": [
     {
      "request": "My projects",
      "tool": "unw_list_projects",
      "args": {
       "limit": 5
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "items": [],
        "nextCursor": null,
        "totalEstimate": 0
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Payment terms",
    "narration": "The payment terms a contract can use come straight from the database.",
    "calls": [
     {
      "request": "Payment terms on offer",
      "tool": "unw_list_payment_terms",
      "args": {},
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "items": [
         {
          "id": "00000000-0000-4000-8000-0000000000b1",
          "code": "due_on_receipt",
          "days": 0,
          "label": "Due on receipt",
          "isDefault": false,
          "sortOrder": 10
         },
         {
          "id": "00000000-0000-4000-8000-0000000000b2",
          "code": "net_15",
          "days": 15,
          "label": "Net 15",
          "isDefault": false,
          "sortOrder": 20
         },
         {
          "id": "00000000-0000-4000-8000-0000000000b3",
          "code": "net_30",
          "days": 30,
          "label": "Net 30",
          "isDefault": true,
          "sortOrder": 30
         }
        ]
       },
       "warnings": []
      }
     }
    ]
   },
   {
    "title": "Invoices",
    "narration": "Clients can read their invoices. A fresh sandbox has none yet.",
    "calls": [
     {
      "request": "My invoices",
      "tool": "unw_list_invoices",
      "args": {
       "limit": 5
      },
      "status": "ok",
      "result": {
       "ok": true,
       "entity": {
        "items": [],
        "nextCursor": null,
        "totalEstimate": 0
       },
       "warnings": []
      }
     }
    ]
   }
  ]
 },
 {
  "code": "boundaries",
  "title": "What a client agent can't do",
  "description": "Every admin, catalog, staff and contract-only tool, called with a fresh client token. Every call here is meant to be refused, and the refusal is the lesson.",
  "sections": [
   {
    "title": "Admin tools",
    "narration": "Users, orgs, tokens, and deletes are admin only.",
    "calls": [
     {
      "request": "List users",
      "tool": "unw_admin_list_users",
      "args": {},
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Create a user",
      "tool": "unw_admin_create_user",
      "args": {
       "name": "Nobody",
       "email": "nobody@demo.unwhelm.invalid"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "List orgs",
      "tool": "unw_admin_list_orgs",
      "args": {},
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Create an org",
      "tool": "unw_admin_create_org",
      "args": {
       "name": "Nope"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Add a member",
      "tool": "unw_admin_add_org_member",
      "args": {
       "orgId": "{zeroId}",
       "userId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Scope presets",
      "tool": "unw_admin_list_scope_presets",
      "args": {},
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Mint a magic link",
      "tool": "unw_admin_mint_magic_link",
      "args": {
       "userId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "List tokens",
      "tool": "unw_admin_list_tokens",
      "args": {},
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Mint a token",
      "tool": "unw_admin_mint_token",
      "args": {
       "name": "nope",
       "userId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Revoke a token",
      "tool": "unw_admin_revoke_token",
      "args": {
       "tokenId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Delete a proposal",
      "tool": "unw_admin_delete_proposal",
      "args": {
       "proposalId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     }
    ]
   },
   {
    "title": "Catalog tools",
    "narration": "Prices and billing rules are staff-edited rows.",
    "calls": [
     {
      "request": "Read the draft catalog",
      "tool": "unw_get_catalog_draft",
      "args": {},
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Start a draft",
      "tool": "unw_create_catalog_draft",
      "args": {},
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Change a price",
      "tool": "unw_update_price_tier",
      "args": {
       "code": "x",
       "versionId": "{zeroId}",
       "amountMinor": 1
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Change a billing line",
      "tool": "unw_update_billing_schedule_line",
      "args": {
       "label": "x",
       "lineId": "{zeroId}",
       "versionId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Change invoice policy",
      "tool": "unw_update_invoice_policy",
      "args": {
       "versionId": "{zeroId}",
       "invoiceOnSign": true
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Publish",
      "tool": "unw_publish_catalog",
      "args": {
       "versionId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     }
    ]
   },
   {
    "title": "Staff queues",
    "narration": "The follow-up queue, agent traces, review decisions, expiry extensions and credits are staff views. A client token is refused.",
    "calls": [
     {
      "request": "Follow-up queue",
      "tool": "unw_list_follow_up_queue",
      "args": {
       "limit": 5
      },
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     },
     {
      "request": "Agent traces",
      "tool": "unw_list_agent_traces",
      "args": {
       "limit": 5
      },
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     },
     {
      "request": "Try to approve (staff only)",
      "tool": "unw_review_decision",
      "args": {
       "decision": "approve",
       "proposalId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "nothing to act on yet. unwh-api request failed: 404 NOT_FOUND",
      "errorRaw": "unwh-api request failed: 404 NOT_FOUND"
     },
     {
      "request": "Extend it a week (staff only)",
      "tool": "unw_extend_proposal_expiry",
      "args": {
       "days": 7,
       "reason": "Client needs another week.",
       "proposalId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     },
     {
      "request": "Credits (staff view)",
      "tool": "unw_list_credits",
      "args": {},
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     }
    ]
   },
   {
    "title": "Staff billing",
    "narration": "Invoices, credits and hours are staff work. Each call below is refused, and that refusal is the point.",
    "calls": [
     {
      "request": "Log hours",
      "tool": "unw_log_hours",
      "args": {
       "date": "2026-11-03",
       "hours": 1,
       "contractId": "{zeroId}",
       "description": "Demo"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Create an invoice",
      "tool": "unw_create_invoice",
      "args": {
       "amount": 100,
       "dueDate": "2026-12-01",
       "contractId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Send it",
      "tool": "unw_send_invoice",
      "args": {
       "invoiceId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Mark paid",
      "tool": "unw_pay_invoice",
      "args": {
       "invoiceId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Void it",
      "tool": "unw_void_invoice",
      "args": {
       "invoiceId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Invoice hours",
      "tool": "unw_invoice_hours",
      "args": {
       "to": "2026-11-30",
       "from": "2026-11-01",
       "contractId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     },
     {
      "request": "Apply a credit",
      "tool": "unw_apply_credit",
      "args": {
       "creditId": "{zeroId}",
       "invoiceId": "{zeroId}"
      },
      "status": "refused",
      "error": "this tool is hidden from a client token.",
      "errorRaw": null
     }
    ]
   },
   {
    "title": "Needs a contract or staff first",
    "narration": "These client tools only work once staff approve a proposal or a contract exists. A fresh sandbox has neither, so the server says no, as it should.",
    "calls": [
     {
      "request": "Resubmit",
      "tool": "unw_resubmit_proposal",
      "args": {
       "proposalId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "nothing to act on yet. unwh-api request failed: 404 NOT_FOUND",
      "errorRaw": "unwh-api request failed: 404 NOT_FOUND"
     },
     {
      "request": "Try to accept before approval",
      "tool": "unw_accept_proposal",
      "args": {
       "proposalId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "nothing to act on yet. unwh-api request failed: 404 NOT_FOUND",
      "errorRaw": "unwh-api request failed: 404 NOT_FOUND"
     },
     {
      "request": "Open one that doesn't exist",
      "tool": "unw_get_project",
      "args": {
       "projectId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "nothing to act on yet. unwh-api request failed: 404 NOT_FOUND",
      "errorRaw": "unwh-api request failed: 404 NOT_FOUND"
     },
     {
      "request": "Sign",
      "tool": "unw_sign_contract",
      "args": {
       "contractId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "nothing to act on yet. unwh-api request failed: 404 NOT_FOUND",
      "errorRaw": "unwh-api request failed: 404 NOT_FOUND"
     },
     {
      "request": "Choose terms (staff only)",
      "tool": "unw_set_contract_billing_terms",
      "args": {
       "contractId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     },
     {
      "request": "Billing schedule",
      "tool": "unw_get_billing_schedule",
      "args": {
       "contractId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "nothing to act on yet. unwh-api request failed: 404 NOT_FOUND",
      "errorRaw": "unwh-api request failed: 404 NOT_FOUND"
     },
     {
      "request": "Release retainage (staff only)",
      "tool": "unw_release_retainage",
      "args": {
       "contractId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     },
     {
      "request": "Open one",
      "tool": "unw_get_invoice",
      "args": {
       "invoiceId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "nothing to act on yet. unwh-api request failed: 404 NOT_FOUND",
      "errorRaw": "unwh-api request failed: 404 NOT_FOUND"
     },
     {
      "request": "Hours logged",
      "tool": "unw_list_hours",
      "args": {
       "contractId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "nothing to act on yet. unwh-api request failed: 404 NOT_FOUND",
      "errorRaw": "unwh-api request failed: 404 NOT_FOUND"
     },
     {
      "request": "Hours left",
      "tool": "unw_remaining_hours",
      "args": {
       "contractId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "nothing to act on yet. unwh-api request failed: 404 NOT_FOUND",
      "errorRaw": "unwh-api request failed: 404 NOT_FOUND"
     }
    ]
   },
   {
    "title": "Staff reminders",
    "narration": "Reading reminder queues and sending reminders are staff jobs. The client token cannot do either.",
    "calls": [
     {
      "request": "Scheduled reminders (staff view)",
      "tool": "unw_list_reminders",
      "args": {
       "proposalId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     },
     {
      "request": "Deliveries (staff view)",
      "tool": "unw_list_deliveries",
      "args": {
       "proposalId": "00000000-0000-0000-0000-000000000000"
      },
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     },
     {
      "request": "Run reminders (staff)",
      "tool": "unw_run_reminders",
      "args": {
       "dryRun": true
      },
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     },
     {
      "request": "Deliver reminders (staff)",
      "tool": "unw_deliver_reminders",
      "args": {},
      "status": "refused",
      "error": "the client token lacks the scope. unwh-api request failed: 403 FORBIDDEN",
      "errorRaw": "unwh-api request failed: 403 FORBIDDEN"
     }
    ]
   }
  ]
 }
];
