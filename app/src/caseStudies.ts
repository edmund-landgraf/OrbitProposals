// Case-study detail pages. Source: legacy UnwhelmNetReplit2 client/src/pages/CaseStudies/cases/*.tsx.
// The CMA client is kept anonymized. Metrics marked TODO need Edmund's confirmation before they are treated as verified.

export type CaseTable = { columns: string[]; rows: string[][] };
export type CaseStudy = {
  slug: string;
  eyebrow: string;
  title: string;
  lead: string;
  glance: { clientType: string; problem: string; stack: string; outcome: string };
  challenge: string[];
  solution: { title: string; intro?: string; bullets: string[] }[];
  results: CaseTable;
  resultsNote?: string;
  benefits: { title: string; text: string }[];
  tech: CaseTable;
  conclusion: string;
  cta: { eyebrow: string; headline: string; body: string };
};

export const caseStudies = {
  "case-propertyware-rently": {
    slug: "propertyware-rently-integration",
    eyebrow: "CASE STUDY / PROPERTY MANAGEMENT",
    title: "PropertyWare + Rently leasing integration",
    lead: "A property-management firm kept PropertyWare for accounting and maintenance, added Rently for listings and self-tours, and owned the integration layer between them.",
    glance: {
      // TODO(Edmund): confirm "3,500+ units".
      clientType: "Regional property-management firm, 3,500+ units across multiple states",
      problem: "PropertyWare's built-in listing and leasing tools could not keep up with syndication, self-showing, and live vacancy reporting.",
      stack: ".NET, Python, SQL Server, Power BI, PropertyWare, Rently, SharePoint / Box",
      // TODO(Edmund): confirm listing update lag 24–48 hours to < 30 minutes.
      outcome: "Listing update lag cut from 24–48 hours to under 30 minutes",
    },
    challenge: [
      "Faster and broader listing syndication to rental marketplaces",
      "Self-showing automation to reduce leasing staff workload",
      "Real-time vacancy data for analytics and institutional investors",
      "One consistent dataset between marketing (Rently) and accounting (PropertyWare)",
      "Each platform defines property, unit, and availability differently, so consistency is the operator's job",
    ],
    solution: [
      {
        title: "API orchestration",
        bullets: [
          "Custom middleware pulled property and listing data nightly from Rently's API into normalized SQL tables: Properties, PropertyPictures, FloorPlans, VacancyCodes",
          "Each record cross-matched to its PropertyWare property ID, creating one dataset across both systems",
          "CSV import automation bridged gaps where APIs were incomplete",
          "Logging and reconciliation through Serilog in a dedicated .NET microservice for full audit visibility",
        ],
      },
      {
        title: "Operational oversight",
        intro: "The client kept ownership of data integrity through:",
        bullets: [
          "A master property directory defining the source-of-truth system per field",
          "Nightly reconciliation reports highlighting discrepancies",
          "Automated alerts for missing or outdated listings",
          "Token and credential management for every vendor integration",
        ],
      },
      {
        title: "Analytics integration",
        intro: "Power BI merged Rently leasing activity with PropertyWare operational and financial data:",
        bullets: [
          "Leasing velocity and conversion rates",
          "Regional rent performance",
          "Active vacancies and turnover costs",
          "System-level data-quality metrics",
        ],
      },
    ],
    // TODO(Edmund): confirm every row: 24–48h → <30 min (96% faster), lead-to-tour 19% → 34% (+79%), weekly sync errors 40–50 → <5 (90%), vacancy reporting 2–3 days → 30-min refresh.
    results: {
      columns: ["Metric", "Before", "After", "Improvement"],
      rows: [
        ["Listing update lag", "24–48 hours", "< 30 minutes", "96% faster"],
        ["Lead-to-tour conversion", "19%", "34%", "+79%"],
        ["Weekly sync errors", "40–50", "< 5", "90% reduction"],
        ["Vacancy reporting latency", "2–3 days", "Real-time (30-minute refresh)", "Near-instant"],
      ],
    },
    benefits: [
      { title: "Listings move faster", text: "Listing updates reach marketplaces in minutes instead of days." },
      { title: "Fewer sync errors", text: "Nightly reconciliation catches discrepancies before they reach tenants." },
      { title: "Live vacancy view", text: "Vacancy reporting refreshes every 30 minutes for operators and investors." },
      { title: "No vendor lock-in", text: "Owning the integration layer means tools can be swapped or upgraded." },
    ],
    tech: {
      columns: ["Layer", "Platform", "Purpose"],
      rows: [
        ["Core operations", "PropertyWare", "Leases, tenants, maintenance, and GL accounting"],
        ["Marketing and leasing", "Rently", "Listings, self-tours, applications, and syndication"],
        ["Integration layer", ".NET + Python", "API-driven data sync between Rently and PropertyWare"],
        ["Data warehouse", "SQL Server + Power BI", "Unified analytics, reporting, and operational insight"],
        ["Document management", "SharePoint / Box", "Central storage for leases, inspections, and financial documents"],
      ],
    },
    conclusion: "Your vendors provide the tools. Your team provides the integration discipline.",
    cta: { eyebrow: "Next step: map your platform handoffs", headline: "Do your listing and accounting systems disagree?", body: "Bring the sync that keeps breaking; we'll show where the source of truth should live." },
  },
  "case-synthetic-data": {
    slug: "synthetic-data-testing",
    eyebrow: "CASE STUDY / REAL ESTATE TECHNOLOGY",
    title: "Synthetic data environments for pre-integration testing",
    lead: "A schema-accurate replica of production, filled with realistic data generated by Python Faker, let prospective clients test integrations without touching a real tenant or financial record.",
    glance: {
      clientType: "Real estate technology provider",
      problem: "Prospective clients could not test integrations against live data because of PII, long security reviews, and data-access constraints.",
      stack: "Python 3.x, Faker, pandas, pyodbc, SQL Server, SQLite",
      // TODO(Edmund): confirm 4–6 weeks → < 7 days.
      outcome: "Integration-pilot onboarding from 4–6 weeks to under 7 days",
    },
    challenge: [
      "Partners needed to validate API compatibility and test endpoints under real-world data volume before contracts or data-sharing agreements",
      "Live systems held regulated PII and sensitive financial data, so sandbox access was impractical",
      "Static demo datasets lacked relational depth, variability, and scale",
      "Clients needed to test against their own systems: AppFolio, PropertyWare, Yardi",
    ],
    solution: [
      {
        title: "A. Schema mirroring",
        intro: "Production SQL structures were exported and recreated in isolated test environments:",
        bullets: [
          "Properties, Tenants, Units, Leases, MaintenanceRequests, and Transactions tables",
          "All relational keys preserved to mimic real entity linkages",
          "Table-by-table parity with production so client code drops in unchanged",
        ],
      },
      {
        title: "B. Faker-based data generation",
        bullets: [
          "Names, addresses, phone numbers, and emails from locale-specific patterns",
          "Rents, deposits, and payments randomized within realistic ranges per market",
          "Lease start/end dates and maintenance timestamps distributed to match property lifecycles",
          "Linked entities (tenants → leases → properties) generated with seeded referential logic",
          "Optional noise injection (missing fields, outliers) for stress testing",
        ],
      },
      {
        title: "C. Automation and refresh",
        bullets: [
          "Scripts rebuild full test databases nightly or on demand",
          "Each test instance isolates client credentials and API tokens",
          "Synthetic pipelines mirror production ETL, so clients test the same path used in deployment",
        ],
      },
    ],
    // TODO(Edmund): confirm onboarding 4–6 weeks → < 7 days, "zero" data-access risk, and the +38% client conversion improvement.
    results: {
      columns: ["Metric", "Before", "After"],
      rows: [
        ["Onboarding time for integration pilots", "4–6 weeks", "< 7 days"],
        ["Data-access risk", "High (PII exposure potential)", "Zero (synthetic only)"],
        ["Demo realism", "Limited, generic samples", "Full lifecycle simulation"],
        ["Client conversion rate (post-test)", "—", "+38%"],
      ],
    },
    resultsNote: "Prospective clients could connect APIs, run CRUD operations, generate analytics, and preview dashboards on data that behaved like real operational data.",
    benefits: [
      { title: "Shorter evaluations", text: "Endpoints and data models validated within a week." },
      { title: "No real data exposed", text: "Sandbox access stays inside compliance rules." },
      { title: "Reusable engineering", text: "Code and stored procedures move to production with minimal changes." },
      { title: "Continuous validation", text: "Rebuilds keep test data in step as the schema evolves." },
    ],
    tech: {
      columns: ["Component", "Description"],
      rows: [
        ["Language", "Python 3.x"],
        ["Libraries", "faker, pandas, pyodbc, uuid, random, datetime"],
        ["Database targets", "SQL Server (test/prod mirror), optional SQLite for local demos"],
        // TODO(Edmund): confirm data volume 5K–250K records per tenant group.
        ["Data volume", "5K–250K property and lease records per tenant group"],
        ["Deployment", "Scheduled task or CI/CD job to refresh datasets"],
        ["Output formats", "Direct SQL inserts, JSON payloads for API testing, CSV exports"],
      ],
    },
    conclusion: "Realistic doesn't have to mean real: clients integrated and tested at full fidelity before formal onboarding.",
    cta: { eyebrow: "Next step: scope a test environment", headline: "Need to test integrations without touching real records?", body: "Bring the schema and the systems it must talk to; we'll outline a synthetic environment that mirrors it." },
  },
  "case-zillow-reso": {
    slug: "zillow-reso-platform",
    eyebrow: "CASE STUDY / BROKERAGE",
    title: "Zillow + RESO buyer–seller data platform",
    lead: "A real estate firm replaced subscription listing and transaction tools with its own platform built on the Zillow MLS API and the RESO Web API.",
    glance: {
      clientType: "Regional real estate firm",
      problem: "Listing, client, and financing workflows ran on subscription platforms with per-seat fees, limited data access, and lock-in.",
      stack: "Zillow MLS API, RESO Web API (OData 4.0), Python ETL, SQL Server, .NET Core, Power BI",
      // TODO(Edmund): confirm $1,200–$3,000/month → < $100 VPS.
      outcome: "Monthly SaaS cost from $1,200–$3,000 to under $100 fixed VPS hosting",
    },
    challenge: [
      "Per-user, per-transaction, or per-lead fees",
      "Restricted data access and portability",
      "Only basic integration with internal databases and financial tools",
      "Long-term vendor lock-in",
      "Needed live MLS data from multiple regions, a RESO-compliant hub for agents, lenders, and title partners, and one dashboard on a fixed-cost VPS",
    ],
    solution: [
      {
        title: "1. Zillow MLS API integration",
        bullets: [
          "Property details (address, price, type, status)",
          "Photos and virtual tour links",
          "Agent and office metadata",
          "Historical listing changes and price trends",
          "Stored in SQL Server tables MLS_Property, MLS_PriceHistory, MLS_Photos, and MLS_Agent",
        ],
      },
      {
        title: "2. RESO Web API pipeline",
        bullets: [
          "Listing updates published in RESO-compliant format (OData 4.0)",
          "Bidirectional sync between internal systems and external MLS feeds",
          "Fine-grained access control for brokers, lenders, and title officers",
        ],
      },
      {
        title: "3. Data normalization and storage",
        bullets: [
          "Python ETL deduplicated listings across MLS sources",
          "RESO fields mapped to Zillow schemas",
          "GUID-based identifiers for properties and agents",
          "Scheduled delta loads for pricing, status, and days-on-market",
          "Exposed through a .NET Core REST API and visualized in Power BI",
        ],
      },
      {
        title: "4. End-to-end buyer–seller workflow",
        bullets: [
          "Buy side: property discovery, lead capture, mortgage prequalification, offer tracking",
          "Sell side: listing management, document automation, market performance analytics",
          "Financing: secure API hooks into lender systems for rate and approval status",
          "Legal: title and document verification with the DocuSign API and SharePoint workflows",
        ],
      },
    ],
    // TODO(Edmund): confirm SaaS $1,200–$3,000 → < $100 and "real-time" sync.
    results: {
      columns: ["Metric", "Before", "After"],
      rows: [
        ["Data source dependence", "External SaaS tools (subscription)", "Self-hosted APIs"],
        ["Monthly SaaS cost", "$1,200–$3,000", "< $100 fixed VPS hosting"],
        ["Update frequency", "Manual / vendor-dependent", "Real-time (Zillow and RESO feed sync)"],
        ["Data ownership", "Limited (view-only APIs)", "Full database control"],
        ["Integration flexibility", "Minimal (locked)", "Extensible with Python and .NET"],
      ],
    },
    benefits: [
      { title: "Own the data", text: "Property and market data live in the firm's own database." },
      { title: "Standards-based", text: "RESO compliance keeps pipelines compatible with future MLS systems." },
      { title: "Hybrid stack", text: "Python ETL, .NET Core APIs, and Power BI on modest infrastructure." },
      // TODO(Edmund): confirm VPS hosting ~$40–$80/month.
      { title: "Predictable cost", text: "VPS hosting (~$40–$80/month) and bandwidth, with no per-transaction billing." },
    ],
    tech: {
      columns: ["Component", "Description"],
      rows: [
        ["Listing source", "Zillow MLS Listings API"],
        ["Standards hub", "RESO Web API, OData 4.0"],
        ["Storage", "SQL Server: MLS_Property, MLS_PriceHistory, MLS_Photos, MLS_Agent"],
        ["ETL", "Python: deduplication, field mapping, GUID identifiers, scheduled delta loads"],
        ["Access", ".NET Core REST API"],
        ["Reporting", "Power BI"],
        ["Documents", "DocuSign API, SharePoint workflows"],
        ["Hosting", "Fixed-cost VPS"],
      ],
    },
    conclusion: "Real estate technology no longer has to be rented; it can be owned.",
    cta: { eyebrow: "Next step: map your listing data", headline: "Paying per seat for data you could own?", body: "Bring the listing feeds and workflows you rely on; we'll show what a self-hosted path would involve." },
  },
  "case-data-repository": {
    slug: "institutional-data-repository",
    eyebrow: "CASE STUDY / INSTITUTIONAL CLIENTS",
    title: "Institutional client data repository and API",
    lead: "Upstream property systems were consolidated into one SQL Server repository, then exposed to institutional clients through a filtered, token-secured downstream API.",
    glance: {
      clientType: "Real estate operator serving institutional clients and investors",
      // TODO(Edmund): confirm "5–8 SaaS platforms".
      problem: "Operational data was fragmented across 5–8 SaaS platforms, and client reporting meant manual exports and shared spreadsheets.",
      stack: "Python ETL, SSIS, REST APIs, SQL Server, ASP.NET Core / Flask, JWT",
      // TODO(Edmund): confirm new-client integration 4–6 weeks → 2–5 days.
      outcome: "New-client integration time from 4–6 weeks to 2–5 days",
    },
    challenge: [
      "Data siloed across AppFolio, PropertyWare, Rently, zInspector, Findigs, and others",
      "No control over vendor API access or data retention; bulk and historical exports cost extra",
      "Reporting bottlenecks and vendor dependency",
      "Client reporting by manual export/import, shared spreadsheets, and email",
    ],
    solution: [
      {
        title: "A. Own the repository",
        bullets: [
          "Consolidated leasing, maintenance, and accounting data",
          "Normalized into one consistent schema in SQL Server (test and prod)",
          "Preserved ownership of operational and historical records",
        ],
      },
      {
        title: "B. Controlled data exposure",
        intro: ".NET or Python Flask endpoints query filtered SQL views, enforce authentication and role-based authorization, and return JSON. Each client sees only:",
        bullets: [
          "The properties, regions, or portfolios they are authorized to view",
          "Aggregated metrics: occupancy, rent roll, maintenance KPIs",
          "Sanitized records with PII removed",
          "Read-only REST endpoints aligned with institutional reporting templates",
        ],
      },
      {
        title: "C. Architecture",
        bullets: [
          "Upstream integrations: Rently, AppFolio, Findigs, zInspector",
          "SQL repository (prod database)",
          "Property groups and filtered views (client-specific partitions)",
          "Downstream REST API secured with token-based access",
          "Institutional client dashboards and analytics tools",
        ],
      },
      {
        title: "D. What the API serves",
        bullets: [
          "Institutional dashboards (Power BI or Tableau on API endpoints)",
          "Automated investor reports: lease renewals, financial summaries",
          "Cross-platform sync for clients integrating their own CRM or ERP",
        ],
      },
    ],
    // TODO(Edmund): confirm 5–8 platforms, SaaS $1,500+ → < $100, and integration time 4–6 weeks → 2–5 days.
    results: {
      columns: ["Metric", "Before", "After"],
      rows: [
        ["Data access", "Fragmented across 5–8 SaaS platforms", "Unified under one SQL schema"],
        ["Client reporting", "Manual export/import", "Real-time via downstream API"],
        ["Security risk", "Shared spreadsheets and emails", "Controlled, token-based API"],
        ["Monthly SaaS cost", "$1,500+", "< $100 fixed VPS hosting"],
        ["Integration time for new clients", "4–6 weeks", "2–5 days"],
      ],
    },
    resultsNote: "Institutional clients gained direct visibility into portfolio metrics while the company kept control of permissions, versions, and data cadence.",
    benefits: [
      { title: "Ownership creates leverage", text: "Every later integration gets easier once the data is yours." },
      { title: "APIs as client portals", text: "Clients get the data they value without a custom dashboard each." },
      { title: "Fixed cost, high reuse", text: "Self-hosted SQL + API serves many integrations cheaply." },
      { title: "Controlled access", text: "Token-based endpoints replace spreadsheets and email." },
    ],
    tech: {
      columns: ["Component", "Technology / method", "Purpose"],
      rows: [
        ["Data ingestion", "Python ETL, SSIS, REST APIs", "Pull upstream data from Rently, AppFolio, Findigs, and others"],
        ["Repository layer", "SQL Server (test + prod)", "Normalized storage and synchronization"],
        ["Property group partitioning", "SQL views and security roles", "Client-level data separation"],
        ["Downstream API", "ASP.NET Core / Flask", "Tokenized REST API serving JSON"],
        ["Authentication", "JWT + OrgGuid", "Role-based client access"],
        ["Hosting", "IIS / VPS", "Predictable, fixed-cost environment"],
      ],
    },
    conclusion: "Owning the repository turns internal systems into a secure data service for every stakeholder.",
    cta: { eyebrow: "Next step: sketch your repository", headline: "Which client report still starts with a manual export?", body: "Bring the systems and the reports clients ask for; we'll outline the repository and the API boundary." },
  },
  "case-cma-pricing": {
    slug: "automated-cma-vacancy-pricing",
    eyebrow: "CASE STUDY / ASSET MANAGEMENT",
    title: "Automated CMA vacancy pricing",
    lead: "A comparative market analysis pipeline joined internal vacancy data with RentFinder and Rentometer, flagged pricing outliers, and alerted marketing the same day.",
    glance: {
      clientType: "Property and asset management firm",
      problem: "CMAs were compiled by hand, so mispriced vacant units were caught late or not at all.",
      stack: "PropertyWare / AppFolio, RentFinder API, Rentometer API, Google Static Maps API, SQL Server, Python",
      // TODO(Edmund): confirm 3–6 hours → 10–20 minutes (current site figure; the legacy page said 3–4 days per region → 1 hour).
      outcome: "Pricing decision time from 3–6 hours to 10–20 minutes",
    },
    challenge: [
      "CMA compilation was manual and slow",
      "Vacancy data lived in the property-management platform, apart from external rent intelligence",
      "Underpriced units were found manually, if at all",
      "Marketing reacted to pricing problems instead of getting ahead of them",
    ],
    solution: [
      {
        title: "Extract, transform, load",
        bullets: [
          "Extract unit vacancy data from AppFolio / PropertyWare (API or nightly export)",
          "Pull RentFinder and Rentometer data for each property's coordinates",
          "Normalize and merge by propertyAddress and formattedAddress",
          "Enrich with RentFinderEstimate, RentometerMedian, current rent, CompCount, AvgCompRent, AvgSqFt, CompRadiusMiles",
          "Load into the CMA repository; persist [RentFinderPropertyListings] and Rentometer comparables",
        ],
      },
      {
        title: "CMA analysis engine",
        bullets: [
          "Rent gap: current rent minus the RentFinder estimate, alongside the Rentometer median by ZIP",
          "Categorize: gap above $400 is Overpriced, below −$400 Underpriced, otherwise In Range",
          "Google Static Maps image per property with comparable markers",
          "Heatmap of over/under variance by region or ZIP (folium or plotly)",
        ],
      },
      {
        title: "Alerts and reporting",
        bullets: [
          "Email alert when a unit is $1,400 or more off the RentFinder or Rentometer figure",
          "Heatmap dashboard: green underpriced, red overpriced, gray in range",
          "Excel / Power BI reports with property image, static map, RentFinder and Rentometer data, and variance metrics",
          "Daily summary email aggregated by region and manager for review",
        ],
      },
    ],
    // TODO(Edmund): confirm CMA time 3–4 days per region → 1 hour, pricing deviation ±15% → ±4%; the legacy page also claimed 96% less CMA time and 73% more accurate pricing (not shown here).
    results: {
      columns: ["Metric", "Before", "After"],
      rows: [
        // TODO(Edmund): standardized to the site-wide 3–6 hours → 10–20 minutes figure (legacy table said 3–4 days per region → 1 hour). Confirm.
        ["Pricing decision time", "3–6 hours", "10–20 minutes"],
        ["Pricing accuracy", "±15% deviation", "±4% deviation"],
        ["Underpriced units identified", "Manual", "Automatic email alerts"],
        ["Marketing turnaround", "Reactive", "Proactive (same-day alerts)"],
      ],
    },
    benefits: [
      { title: "Time back", text: "Manual CMA compilation is replaced by a scheduled pipeline." },
      { title: "Tighter pricing", text: "Outliers surface against two independent rent sources." },
      { title: "Same-day action", text: "Marketing hears about mispriced units the day they appear." },
      { title: "People still decide", text: "Daily summaries by region and manager keep review with the team." },
    ],
    tech: {
      columns: ["Source", "Description", "Example tables / endpoints"],
      rows: [
        ["Unit vacancy report", "From PropertyWare or AppFolio: vacant and upcoming units", "[UnitVacancyHistory], [UnitDirectory]"],
        ["RentFinder API", "Rental estimate and comparable listings", "/getEstimate, /getComparables"],
        ["Rentometer API", "Neighborhood-level rent trends", "/api/v1/summary, /api/v1/comparables"],
        ["Google Static Maps API", "Static map overlays with comparable markers", "/maps/api/staticmap"],
        ["SQL Server repository", "Normalized RentFinder, Rentometer, and CMA data", "[RentFinderProperty], [CMA_Results]"],
      ],
    },
    conclusion: "Automating the CMA pipeline turned manual compilation into same-day, reviewable pricing signals.",
    cta: { eyebrow: "Next step: a pricing-workflow review", headline: "How long does a vacancy wait for a price?", body: "Bring your vacancy report and comp sources; we'll show what can be automated and where review stays." },
  },
} satisfies Record<string, CaseStudy>;

export type CaseStudyPage = keyof typeof caseStudies;
