import { createContext, useContext, type FormEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { TryMePage } from "./tryMe";
import { TryMeHelpPage } from "./tryMeHelp";
import { ProposalArchitecturePage } from "./proposalArchitecture";
import { ConnectMcpClientPage } from "./connectMcpClient";
import { McpGettingStartedPage } from "./mcpGettingStarted";
import { McpExplainedPage } from "./mcpExplained";
import { McpExplainedBPage } from "./mcpExplainedB";
import { McpConnectPage } from "./mcpConnect";
import { PrivacyPage, SupportPage, TermsPage } from "./policyPages";
import { DemoPage } from "./demoPage";
import { RequestAccessPage } from "./requestAccess";
import { ClaudePage } from "./claudePage";
import { ConnectHubPage } from "./connectHub";
import { ChatGptPage, CodexConnectPage, CursorConnectPage, GeminiCliConnectPage, VsCodeConnectPage, WindsurfConnectPage } from "./connectClientPages";
import { AdminRoute } from "./admin";
import { PortalRoute } from "./portal";
import { documentFromSearch, DocumentsPage, MarkdownViewer } from "./documents";
import legacyRedirects from "../shared/redirects.json";
import { pricing as pricingCopy } from "../shared/pricing";

type CatalogPrices = {
  workflowCheck: number;
  hourlyRate: number;
  capped4: { hours: number; price: number };
  capped8: { hours: number; price: number };
  fixedFrom: string;
};

const CatalogPriceContext = createContext<CatalogPrices | null>(null);

function useCatalogPrices(): CatalogPrices | null {
  return useContext(CatalogPriceContext);
}
import { caseStudies, type CaseStudy, type CaseStudyPage } from "./caseStudies";
import { ListDetail } from "./ListDetail";
import { findInsightsArticle, formatArticleDate, insightsArticles } from "./insightsArticles";
import { ArticleBody } from "./ArticleBody";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudCog,
  Code2,
  DatabaseZap,
  ExternalLink,
  FileText,
  FileSearch,
  Github,
  Layers3,
  Mail,
  Menu,
  MessageSquareCode,
  Network,
  Phone,
  Play,
  Route,
  ServerCog,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Video,
  Workflow,
  X,
} from "lucide-react";

type Page = "home" | "services" | "integration" | "ai-solutions" | "agents" | "ai-economics" | "automation" | "platforms" | "web-design" | "10x-team" | "agent-setup" | "supabase" | "vibe-coded" | "industries" | "real-estate" | "real-estate-institutional-investors" | "real-estate-property-managers" | "real-estate-brokerages" | "legal" | "healthcare" | "financial" | "work" | "case-studies" | CaseStudyPage | "videos" | "git" | "documents" | "markdown-viewer" | "about" | "approach" | "technical-skills" | "resume" | "engagement" | "privacy" | "terms" | "support" | "demo" | "request-access" | "claude" | "connect" | "chatgpt" | "cursor" | "vscode" | "windsurf" | "gemini-cli" | "codex" | "not-found" | "contact" | "article-who-pays" | "insights" | "mcp" | "admin" | "portal" | "chat" | "try" | "try-help" | "try-connect" | "mcp-connect" | "mcp-getting-started" | "mcp-explained" | "mcp-explained-b" | "proposal-architecture";

type Demo = {
  id: string;
  kicker: string;
  title: string;
  description: string;
  source: string;
  poster: string;
  captions: string;
  duration: string;
  bullets: string[];
};

type WorkItem = {
  eyebrow: string;
  title: string;
  summary: string;
  problem: string;
  shipped: string[];
  proof: string;
  links: { label: string; href: string; icon?: "github" | "external" }[];
};

type PageLink = {
  page: Page;
  label: string;
  text: string;
  icon: typeof Video;
};

type ParityContent = {
  eyebrow: string;
  title: string;
  intro: string;
  cards: { title: string; text: string; bullets: string[]; link?: { page: Page; label: string }; pdf?: Page }[];
  proof?: { title: string; text: string };
  clip?: MotionClipProps;
  more?: { eyebrow: string; title: string; intro: string; cards: ParityContent["cards"] }[];
  faq?: { question: string; answer: string }[];
};

const routeByPage: Record<Page, string> = {
  home: "/",
  services: "/services",
  integration: "/services/integration",
  "ai-solutions": "/services/ai",
  agents: "/services/ai/agents",
  "ai-economics": "/services/ai/economics",
  automation: "/services/automation",
  platforms: "/services/infrastructure",
  "web-design": "/services/web-design",
  "10x-team": "/services/10x-team",
  "agent-setup": "/services/agent-setup",
  supabase: "/services/supabase",
  "vibe-coded": "/services/vibe-coded",
  industries: "/industries",
  "real-estate": "/industries/real-estate",
  "real-estate-institutional-investors": "/industries/real-estate/institutional-investors",
  "real-estate-property-managers": "/industries/real-estate/property-managers",
  "real-estate-brokerages": "/industries/real-estate/brokerages",
  legal: "/industries/legal",
  healthcare: "/industries/healthcare",
  financial: "/industries/financial",
  work: "/work",
  "case-studies": "/work/case-studies",
  "case-propertyware-rently": "/work/case-studies/propertyware-rently-integration",
  "case-synthetic-data": "/work/case-studies/synthetic-data-testing",
  "case-zillow-reso": "/work/case-studies/zillow-reso-platform",
  "case-data-repository": "/work/case-studies/institutional-data-repository",
  "case-cma-pricing": "/work/case-studies/automated-cma-vacancy-pricing",
  videos: "/work/videos",
  git: "/work/code",
  documents: "/work/documents",
  "markdown-viewer": "/markdown-viewer",
  about: "/about",
  approach: "/about/approach",
  "technical-skills": "/about/skills",
  resume: "/about/resume",
  engagement: "/pricing",
  privacy: "/privacy",
  terms: "/terms",
  support: "/support",
  demo: "/demo",
  "request-access": "/request-access",
  claude: "/claude",
  connect: "/connect",
  chatgpt: "/chatgpt",
  cursor: "/cursor",
  vscode: "/vscode",
  windsurf: "/windsurf",
  "gemini-cli": "/gemini-cli",
  codex: "/codex",
  "not-found": "/404",
  contact: "/contact",
  chat: "/chat",
  try: "/try",
  "try-help": "/try/help",
  "proposal-architecture": "/proposal-architecture",
  "try-connect": "/try/connect",
  "mcp-getting-started": "/mcp/getting-started",
  "mcp-explained": "/mcp/explained",
  // Local draft: direct URL only, not linked or in sitemap.
  "mcp-explained-b": "/mcp/explained-b",
  "mcp-connect": "/mcp/connect",
  "article-who-pays": "/insights/who-pays-for-the-ai",
  insights: "/insights",
  mcp: "/mcp",
  admin: "/admin",
  portal: "/portal",
};

const breadcrumbLabels: Partial<Record<Page, string>> = {
  services: "Services",
  integration: "Integration",
  "ai-solutions": "AI",
  agents: "AI agents",
  "ai-economics": "AI economics",
  automation: "Automation",
  platforms: "Infrastructure",
  "web-design": "Web design",
  "10x-team": "10x team",
  "agent-setup": "Agent setup",
  supabase: "Supabase",
  "vibe-coded": "Vibe-coded apps",
  industries: "Industries",
  "real-estate": "Real estate",
  "real-estate-institutional-investors": "Institutional investors",
  "real-estate-property-managers": "Property managers",
  "real-estate-brokerages": "Brokerages",
  legal: "Legal",
  healthcare: "Healthcare",
  financial: "Financial",
  work: "Work",
  "case-studies": "Case studies",
  "case-propertyware-rently": "PropertyWare + Rently",
  "case-synthetic-data": "Synthetic data",
  "case-zillow-reso": "Zillow + RESO",
  "case-data-repository": "Data repository + API",
  "case-cma-pricing": "CMA vacancy pricing",
  videos: "Videos",
  git: "Code",
  documents: "Documents",
  "markdown-viewer": "Document viewer",
  about: "About",
  approach: "Approach",
  "technical-skills": "Skills",
  resume: "Resume",
  engagement: "Pricing",
  privacy: "Privacy",
  terms: "Terms",
  support: "Support",
  demo: "Demo",
  "request-access": "Request access",
  claude: "Claude",
  connect: "Connect",
  chatgpt: "ChatGPT",
  cursor: "Cursor",
  vscode: "VS Code",
  windsurf: "Windsurf",
  "gemini-cli": "Gemini CLI",
  codex: "Codex",
  "not-found": "Page not found",
  contact: "Contact",
  chat: "Chat",
  try: "Try me",
  "try-help": "Help guide",
  "proposal-architecture": "Proposal Architecture",
  "try-connect": "Connect your MCP client",
  "mcp-getting-started": "Getting started",
  "mcp-explained": "Explained",
  "mcp-explained-b": "Explained B",
  "mcp-connect": "How to connect",
  "article-who-pays": "Who pays for the AI?",
  insights: "Insights",
  mcp: "MCP",
  admin: "Admin",
  portal: "Portal",
};

// Site hierarchy: each page's parent drives breadcrumbs, active nav state, and hub listings.
const parentPage: Partial<Record<Page, Page>> = {
  "try-help": "try",
  "proposal-architecture": "work",
  "try-connect": "try-help",
  "mcp-getting-started": "mcp",
  "mcp-explained": "mcp",
  "mcp-explained-b": "mcp",
  "mcp-connect": "mcp",
  integration: "services",
  "ai-solutions": "services",
  agents: "ai-solutions",
  "ai-economics": "ai-solutions",
  automation: "services",
  platforms: "services",
  "web-design": "services",
  "10x-team": "services",
  "agent-setup": "services",
  supabase: "services",
  "vibe-coded": "services",
  "real-estate": "industries",
  "real-estate-institutional-investors": "real-estate",
  "real-estate-property-managers": "real-estate",
  "real-estate-brokerages": "real-estate",
  legal: "industries",
  healthcare: "industries",
  financial: "industries",
  "case-studies": "work",
  "case-propertyware-rently": "case-studies",
  "case-synthetic-data": "case-studies",
  "case-zillow-reso": "case-studies",
  "case-data-repository": "case-studies",
  "case-cma-pricing": "case-studies",
  videos: "work",
  git: "work",
  documents: "work",
  "markdown-viewer": "documents",
  approach: "about",
  "technical-skills": "about",
  resume: "about",
  "article-who-pays": "insights",
  chatgpt: "connect",
  cursor: "connect",
  vscode: "connect",
  windsurf: "connect",
  "gemini-cli": "connect",
  codex: "connect",
};

const hubChildren: Partial<Record<Page, Page[]>> = {
  services: ["integration", "ai-solutions", "automation", "platforms", "web-design", "10x-team", "agent-setup", "supabase", "vibe-coded"],
  "ai-solutions": ["agents", "ai-economics"],
  industries: ["real-estate", "financial", "legal", "healthcare"],
  "real-estate": ["real-estate-institutional-investors", "real-estate-property-managers", "real-estate-brokerages"],
  work: ["case-studies", "videos", "git", "documents", "proposal-architecture"],
  about: ["approach", "technical-skills", "resume"],
  // Insights hub lists every article; add new article pages here and they appear on /insights automatically.
  insights: ["article-who-pays"],
};

function breadcrumbJsonLd(trail: [string, string][]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([path, name], index) => ({ "@type": "ListItem", position: index + 1, name, item: `https://unwhelm.net${path}` })),
  };
}

function pageAncestry(page: Page): Page[] {
  const chain: Page[] = [];
  let current: Page | undefined = page;
  while (current) {
    chain.unshift(current);
    current = parentPage[current];
  }
  return chain;
}

const navItems: { page: Page; label: string; children?: Page[] }[] = [
  // AI agents and AI economics live under /services/ai but are listed directly in the Services menu.
  { page: "services", label: "Services", children: [...(hubChildren.services ?? []), "agents", "ai-economics"] },
  { page: "industries", label: "Industries", children: hubChildren.industries },
  { page: "work", label: "Work", children: hubChildren.work },
  { page: "about", label: "About", children: hubChildren.about },
  { page: "insights", label: "Insights", children: hubChildren.insights },
  { page: "engagement", label: "Pricing" },
];

const navChildLabels: Partial<Record<Page, string>> = {
  "ai-solutions": "AI solutions",
  "10x-team": "10x team",
  "technical-skills": "Skills",
};

const demos: Demo[] = [
  {
    id: "vector",
    kicker: "AI + DATA",
    title: "Vector search with SQL Server",
    description:
      "A practical walkthrough of embeddings, semantic retrieval, cosine similarity, and a hybrid SQL + Python implementation built around real structured data.",
    source: "https://unwhelm.net/assets/VectorDB.mp4",
    poster: "/assets/video-poster-vector.svg",
    captions: "/assets/captions-vector.vtt",
    duration: "Technical walkthrough",
    bullets: [
      "Store and query high-dimensional embeddings",
      "Use semantic retrieval where exact SQL filters break down",
      "Bridge database capabilities with Python when platform features are incomplete",
      "Keep deterministic SQL filters beside semantic retrieval",
      "Normalize source records before creating vectors",
      "Compare cosine similarity with structured filter results",
      "Inspect retrieval quality instead of treating search as magic",
      "Keep the data path explainable for the person using it",
    ],
  },
  {
    id: "rag",
    kicker: "AI + APPLICATION ARCHITECTURE",
    title: "Building a local RAG application",
    description:
      "A working retrieval-augmented chatbot: source ingestion, embeddings, nearest-neighbor retrieval, routing, prompt construction, and locally hosted models.",
    source: "https://unwhelm.net/assets/UnwhelmNetChatRAG.mp4",
    poster: "/assets/video-poster-rag.svg",
    captions: "/assets/captions-rag.vtt",
    duration: "Architecture + demo",
    bullets: [
      "Treat source content and retrieval as explicit application layers",
      "Keep local and commercial model options behind a controlled boundary",
      "Show the limits of underpowered infrastructure instead of hiding them",
      "Separate source content, retrieval, model choice, and response construction",
      "Ingest and chunk documents for repeatable retrieval",
      "Route questions through a predictable application flow",
      "Return context that can be inspected before the model answers",
      "Make the local setup useful for testing architecture decisions",
    ],
  },
  {
    id: "contact",
    kicker: "FULL-STACK INTEGRATION",
    title: "Website-to-inbox engagement flow",
    description:
      "A public form moving through validation, Node/Express, environment-specific deployment, and Microsoft Graph message delivery.",
    source: "https://unwhelm.net/assets/unwhelmNodeNet_ContactUs.mp4",
    poster: "/assets/video-poster-contact.svg",
    captions: "/assets/captions-contact.vtt",
    duration: "End-to-end demo",
    bullets: [
      "Production-oriented form handling, validation, and error handling",
      "Credential boundaries and environment separation",
      "Microsoft Graph integration for reliable delivery",
      "Capture a contact ID that ties the inquiry to follow-up work",
      "Move structured form data through a Node and Express boundary",
      "Keep scheduling separate from the initial intake submission",
      "Return useful success and failure states to the person submitting",
      "Deploy the same workflow across environment-specific settings",
    ],
  },
  {
    id: "dotnet",
    kicker: ".NET + APIs",
    title: ".NET Core API integration",
    description:
      "A long-form implementation walkthrough covering REST services, authentication, databases, and enterprise integration patterns.",
    source: "https://unwhelm.net/assets/net-core-api-full.mp4",
    poster: "/assets/video-poster-dotnet.svg",
    captions: "/assets/captions-dotnet.vtt",
    duration: "51:52",
    bullets: [
      "REST API design, service contracts, and integration boundaries",
      "Authentication and database connectivity",
      "Practical automation patterns for business systems",
      "Translate business operations into stable API resources",
      "Keep validation close to the service boundary",
      "Connect application logic to persistent data safely",
      "Separate credentials, configuration, and deployment concerns",
      "Document the decisions that make a handoff supportable",
    ],
  },
];

const work: WorkItem[] = [
  {
    eyebrow: "REAL ESTATE",
    title: "Property-management systems integration",
    summary:
      "API, ETL, reporting, document, and workflow automation around property-management operations and line-of-business data.",
    problem:
      "Operational teams often live between Propertyware, AppFolio, spreadsheets, forms, email, documents, SQL reports, and manual reconciliation.",
    shipped: [
      "Propertyware / AppFolio integration patterns",
      "JotForm, document, leasing, and operational workflow automation",
      "SQL Server, ETL, reporting, and data cleanup pipelines",
      "Business processes translated into maintainable software",
    ],
    proof: "Property-management integration notes and the real-estate solutions page.",
    links: [
      { label: "Real estate solutions", href: "/industries/real-estate" },
      { label: "Technical documents", href: "/work/documents" },
    ],
  },
  {
    eyebrow: "LAW",
    title: "Legal operations and matter workflows",
    summary:
      "Intake, document, and reporting integrations for firms that work across practice software, email, forms, and shared files.",
    problem:
      "Matter files, client intake, billing exports, and document review sit in separate tools, so staff re-enter the same facts and lose the handoff.",
    shipped: [
      "Intake and document workflows with an explicit review step",
      "API and file integrations around practice systems and shared storage",
      "Reporting that reconciles time, billing, and matter status",
      "Access boundaries so client data stays in the system of record",
    ],
    proof: "The same ownership model as the property work: map the workflow, keep one source of truth, and automate the handoff.",
    links: [
      { label: "Start a project", href: "/contact" },
    ],
  },
  {
    eyebrow: "HEALTHCARE",
    title: "Healthcare operations and records workflows",
    summary:
      "Scheduling, referral, billing, and document workflows connected without copying the clinical record into a side system.",
    problem:
      "Scheduling, referrals, billing, and clinical documents move through portals, spreadsheets, and staff inboxes with no single operational view.",
    shipped: [
      "Scheduling, referral, and billing handoffs with a clear system of record",
      "Document and form automation with staff review before anything is filed",
      "Reporting across operational exports without copying records into a side system",
      "Permission and audit boundaries around patient and billing data",
    ],
    proof: "Built for operators who need the workflow connected while the record stays in the system that owns it.",
    links: [
      { label: "Start a project", href: "/contact" },
    ],
  },
];

const gitSelections = [
  {
    eyebrow: "THIS SITE",
    title: "UnwhelmNet 2.0",
    summary:
      "The source for this site: industry work pages, technical documents, contact intake, and the production server.",
    repo: "edmund-landgraf/UnwhelmNet20",
    // Private repository: no outbound link (do not change repo visibility from here).
    href: null as string | null,
    details: ["React, TypeScript, and Vite", "Real estate, finance, law, and healthcare work pages", "Document library and contact API"],
  },
];

const agentOfferings = [
  {
    icon: MessageSquareCode,
    title: "ChatGPT apps and custom GPTs",
    text: "ChatGPT connectors and GPTs that answer from your live business data.",
  },
  {
    icon: Network,
    title: "MCP servers",
    text: "Typed, permission-checked tools that expose your systems to any MCP client.",
  },
  {
    icon: Workflow,
    title: "Grok Bot agents and teams",
    text: "Scheduled agents that watch inboxes and repos and hand work to each other.",
  },
  {
    icon: ShieldCheck,
    title: "Agent-ready backends",
    text: "APIs, schemas, and authorization that keep the model within clear limits.",
  },
];

const agentExamples = [
  {
    title: "Live proof: the AMBA MCP control plane",
    text: "An MCP server with typed tool handlers over local and HTTP transports, authenticated identity, and module-level authorization. ChatGPT used it to build a 23-part adventure module end to end.",
  },
  {
    title: "A pricing analyst GPT",
    text: "A custom GPT reads pricing and portfolio data, flags outliers, and drafts an auditable recommendation, the pattern behind a workflow that cut pricing decisions from 3–6 hours to 10–20 minutes.",
  },
  {
    title: "An operations agent team",
    text: "One Grok agent watches requests, a second pulls records through MCP, and a third drafts the reply for a person to approve.",
  },
  {
    title: "A knowledge assistant",
    text: "RAG over your documents and SQL data that cites its sources and respects who's allowed to see what.",
  },
  {
    title: "A job-search agent",
    text: "Reads a posting, matches it to a resume, and drafts a cover letter for review. Built on Grok Bot; it drafted this page.",
  },
];

const agentSteps = [
  {
    mark: "01",
    title: "Map the workflow.",
    text: "Systems, data owners, and the decisions the agent should and shouldn't make.",
  },
  {
    mark: "02",
    title: "Define the tools.",
    text: "Typed schemas, validation, and authorization checks at the service boundary.",
  },
  {
    mark: "03",
    title: "Build and connect.",
    text: "An MCP server, a GPT action, or a Grok agent, whichever fits your team.",
  },
  {
    mark: "04",
    title: "Verify.",
    text: "Tests, audit trails, and metrics that show what the agent did and why.",
  },
];

const mcpFlow = [
  {
    mark: "01",
    title: "Operator asks",
    text: "A property manager asks ChatGPT or Grok which renewals need attention this week.",
    tone: "client",
  },
  {
    mark: "02",
    title: "Client selects a tool",
    text: "The model sees the same typed tool list and picks get_renewals_needing_review.",
    tone: "client",
  },
  {
    mark: "03",
    title: "Your MCP surface runs it",
    text: "The server validates inputs, checks identity, and calls the system of record.",
    tone: "server",
  },
  {
    mark: "04",
    title: "Person reviews the result",
    text: "The client summarizes the exceptions; a person approves any consequential action.",
    tone: "human",
  },
];

const mcpClients = {
  ChatGPT: {
    label: "ChatGPT / custom GPT",
    prompt: '"Show renewals needing review this week."',
    detail: "A GPT or ChatGPT app discovers the same tools through its connector boundary.",
  },
  Grok: {
    label: "Grok / Grok bot",
    prompt: '"Which lease renewals should my team call first?"',
    detail: "A Grok bot can use the same server and tool contracts when its MCP connection is configured.",
  },
};

const compatibleAiClients = [
  { name: "OpenAI", mark: "◉" },
  { name: "GPT", mark: "✦" },
  { name: "Grok", mark: "G" },
  { name: "xAI", mark: "x" },
  { name: "Claude", mark: "A" },
  { name: "Gemini", mark: "✧" },
];

const tenXGroups = [
  {
    eyebrow: "PRODUCT COMPANIES",
    title: "Replace the parts that slow the product down.",
    text: "A senior outside team adds a workflow, integration, AI boundary, or operational system without a two-year rewrite.",
    fit: "Best when you own the product and need focused capacity around the seams.",
    bullets: ["Legacy replacement in slices", "Workflow and data boundaries"],
  },
  {
    eyebrow: "LARGE CUSTOM / INTEGRATION FIRMS",
    title: "Bring a smaller senior team to the hard middle.",
    text: "Large firms bring reach, but custom work can get slow and expensive before the first working proof. We take a defined integration, prototype, or recovery lane and make it inspectable quickly.",
    fit: "Best when a larger program needs experienced implementation without another management layer.",
    bullets: ["Architecture-to-working-proof handoff", "A compact technical lead layer"],
  },
  {
    eyebrow: "SMALL COMPANIES",
    title: "Get seasoned judgment without building a department.",
    text: "Small teams know the workflow but lack senior engineers who have seen the failure modes. You need the right few, connected to the work.",
    fit: "Best when real operational pain needs a practical path to working software.",
    bullets: ["Clear cost and ownership boundaries", "A system your team can continue"],
  },
];

const tenXCoverage = [
  ["Understand the business", "Workflow mapping, system ownership, process constraints"],
  ["Build the product surface", "Web apps, APIs, dashboards, forms, and internal tools"],
  ["Connect the systems", "SaaS integrations, databases, ETL, documents, and identity"],
  ["Add AI where it earns its keep", "RAG, MCP, agents, classification, drafting, and review"],
  ["Run it in the real world", "Cloud, Linux, Windows, on-prem handoff, troubleshooting, and proof"],
];

const siteTitle = "UnwhelmNet — Software, AI, Automation & Integration";
const siteDescription =
  "UnwhelmNet — senior software, API integration, AI-assisted applications, automation, and cloud infrastructure.";

function trackEvent(name: string, props?: Record<string, string>) {
  const plausible = (window as Window & { plausible?: (event: string, options?: { props: Record<string, string> }) => void }).plausible;
  plausible?.(name, props ? { props } : undefined);
}

const pageMeta: Partial<Record<Page, { title: string; description: string }>> = {
  "proposal-architecture": {
    title: "Proposal Architecture | UnwhelmNet",
    description: "Explore Unwhelm proposal entities, the MCP tool tree, and server-enforced permissions behind AI-generated proposals.",
  },
  "mcp-explained-b": {
    title: "Two sentences to a proposal | UnwhelmNet",
    description: "Say what you need in plain English. The Proposals agent asks a few follow-ups and builds the draft with you.",
  },
  "mcp-explained": {
    title: "Two sentences to a proposal | UnwhelmNet",
    description: "Type what you need in plain words and Unwhelm's Proposals agent builds a scoped proposal with you. See why it's different and how it works.",
  },
  "mcp-getting-started": {
    title: "Getting started | UnwhelmNet",
    description: "Copy-paste prompts for your connected AI app: scope a proposal, compare pricing models, and submit it for review.",
  },
  "mcp-connect": {
    title: "How to connect | UnwhelmNet",
    description: "Connect Grok, Claude, or your own MCP client to Unwhelm's MCP server with OAuth sign-in.",
  },
  "try-connect": {
    title: "Connect your MCP client | UnwhelmNet",
    description: "Set up Claude, ChatGPT, or Grok against Unwhelm's MCP server with OAuth sign-in.",
  },
  "try-help": {
    title: "Try me help guide | UnwhelmNet",
    description: "Hands-on exercises for your own agent against the Unwhelm MCP sandbox.",
  },
  try: {
    title: "Try me | UnwhelmNet",
    description: "Watch an agent build a real proposal through the MCP server, with every tool call traced.",
  },
  admin: {
    title: "Admin — UnwhelmNet",
    description: "Account administration.",
  },
  portal: {
    title: "Client portal — UnwhelmNet",
    description: "Review and edit your Unwhelm proposals.",
  },
  "vibe-coded": {
    title: "Vibe-coded apps to real production — UnwhelmNet",
    description: "Built an app in Lovable, Bolt, Base44, Replit, or v0? We review it, secure it, and take it to real production, often on Supabase.",
  },
  supabase: {
    title: "Supabase development and migration — UnwhelmNet",
    description: "Postgres with auth, storage, and pgvector in one backend: new Supabase projects, migrations, RAG, and row-level security.",
  },
  "agent-setup": {
    title: "AI agent setup — UnwhelmNet",
    description: "Every client gets a free AI agent. We set up the one you already use and connect it to our MCP server.",
  },
  "case-propertyware-rently": {
    title: "PropertyWare + Rently leasing integration — UnwhelmNet",
    description: "How a property-management firm owned the integration between PropertyWare and Rently for listings, self-tours, and live vacancy data.",
  },
  "case-synthetic-data": {
    title: "Synthetic data environments for pre-integration testing — UnwhelmNet",
    description: "Schema-accurate synthetic data built with Python Faker so prospective clients could test integrations without real tenant or financial records.",
  },
  "case-zillow-reso": {
    title: "Zillow + RESO buyer–seller data platform — UnwhelmNet",
    description: "A self-hosted buyer–seller platform on the Zillow MLS API and RESO Web API, with Python ETL, SQL Server, .NET Core, and Power BI.",
  },
  "case-data-repository": {
    title: "Institutional client data repository and API — UnwhelmNet",
    description: "Consolidating upstream property systems into one SQL Server repository with a filtered, token-secured API for institutional clients.",
  },
  "case-cma-pricing": {
    title: "Automated CMA vacancy pricing — UnwhelmNet",
    description: "A CMA pipeline joining vacancy data with RentFinder and Rentometer to flag pricing outliers and alert marketing the same day.",
  },
  work: {
    title: "Selected work — UnwhelmNet",
    description: "Case studies and implementation work across property management, AI, data, and business systems.",
  },
  services: {
    title: "Software, AI, and automation services — UnwhelmNet",
    description: "Modern software, AI-assisted applications, automation, integrations, and cloud infrastructure for real workflows.",
  },
  agents: {
    title: "Build AI agents that do real work — UnwhelmNet",
    description:
      "Custom GPTs, Grok agents, and MCP integrations, connected to your systems with real guardrails.",
  },
  "10x-team": {
    title: "The 10x Team — UnwhelmNet",
    description:
      "A small team that knows how to use coding agents to cover product, integration, automation, AI, and infrastructure work with greater leverage.",
  },
  "real-estate": {
    title: "Property-management integrations — UnwhelmNet",
    description: "AppFolio, Propertyware, reporting, leasing, maintenance, documents, and workflow automation.",
  },
  "real-estate-institutional-investors": {
    title: "Institutional real-estate data systems — UnwhelmNet",
    description: "Unify property data, warehouse workflows, APIs, and dashboards for institutional real-estate teams.",
  },
  "real-estate-property-managers": {
    title: "Property-management automation — UnwhelmNet",
    description: "Practical AppFolio and Propertyware automation for property-management teams without dedicated IT staff.",
  },
  "real-estate-brokerages": {
    title: "Brokerage data and workflow integrations — UnwhelmNet",
    description: "Connect Zillow, RESO, MLS, buyer, and seller workflows around clear data ownership.",
  },
  legal: {
    title: "Legal operations workflows — UnwhelmNet",
    description: "Connect intake, documents, billing, and reporting workflows while keeping matter data governed.",
  },
  healthcare: {
    title: "Healthcare operations workflows — UnwhelmNet",
    description: "Connect scheduling, referrals, billing, and operational documents around clear ownership and review.",
  },
  financial: {
    title: "GL exploration, warehouse exceptions, and money-path mappings — UnwhelmNet",
    description: "Read a GL, warehouse the repeats, and map charts of accounts across platforms. Earlier university, disbursement, and TANF systems sit behind that work.",
  },
  "ai-solutions": {
    title: "AI under application controls — UnwhelmNet",
    description: "Retrieval, semantic search, local models, and AI workflows with deterministic business state.",
  },
  "ai-economics": {
    title: "AI economics and cost of ownership — UnwhelmNet",
    description: "Make inference, hosting, review time, maintenance, and automation value visible before a build.",
  },
  "web-design": {
    title: "Modern web applications — UnwhelmNet",
    description: "React applications, APIs, dashboards, internal tools, and field-ready interfaces.",
  },
  platforms: {
    title: "Platform integrations and boundaries — UnwhelmNet",
    description: "SaaS, database, cloud, and internal systems connected around clear ownership.",
  },
  "case-studies": {
    title: "Case studies — UnwhelmNet",
    description: "Working examples show the problem, systems involved, measurable outcomes, and remaining risk.",
  },
  "technical-skills": {
    title: "Skills and diagramming — UnwhelmNet",
    description: "Senior implementation across software, data, AI, infrastructure, and integration, plus the architecture diagrams behind it.",
  },
  videos: {
    title: "Videos: proof before claims — UnwhelmNet",
    description: "Working technical walkthroughs for AI, data, integrations, APIs, and deployment.",
  },
  integration: {
    title: "Systems integration — UnwhelmNet",
    description: "Connect APIs, databases, and SaaS platforms with clear ownership, translation, and failure boundaries.",
  },
  automation: {
    title: "Data and workflow automation — UnwhelmNet",
    description: "Practical ETL, reporting, document workflows, and scheduled automation around existing business systems.",
  },
  industries: {
    title: "Industries — UnwhelmNet",
    description: "Real estate, financial, legal, and healthcare operations connected around clear data ownership.",
  },
  approach: {
    title: "Approach — UnwhelmNet",
    description: "A practical engagement model from discovery to demonstrable software.",
  },
  resume: {
    title: "Resume: Principal AI & Systems Integration Architect — UnwhelmNet",
    description: "Edmund Landgraf, Principal AI & Systems Integration Architect for a multi-state property-management firm: RentFinder CMA, document automation, RAG, and the Propertyware ETL warehouse.",
  },
  mcp: {
    title: "MCP server — UnwhelmNet",
    description: "Unwhelm's MCP server lets your own AI app (Grok, ChatGPT, Claude) talk directly to our agents.",
  },
  insights: {
    title: "Insights — UnwhelmNet",
    description: "Articles from UnwhelmNet on adding AI to your business and what it costs.",
  },
  "article-who-pays": {
    title: "Who Pays for the AI? Four Ways to Add AI to Your Business, and What Each One Costs. — UnwhelmNet",
    description: "API keys, your own model, vendor bundles, or bring-your-own-client MCP: who pays each time someone uses the AI, and what each approach costs.",
  },
  "markdown-viewer": {
    title: "Document viewer — UnwhelmNet",
    description: "Read public technical documents from the UnwhelmNet document library.",
  },
  documents: {
    title: "Technical documents — UnwhelmNet",
    description: "Public technical documents and implementation notes from UnwhelmNet.",
  },
  git: {
    title: "Source and implementation notes — UnwhelmNet",
    description: "The repository and selected implementation work behind UnwhelmNet.",
  },
  about: {
    title: "Direct technical ownership — UnwhelmNet",
    description: "Senior implementation across web applications, APIs, data, AI, infrastructure, and operations.",
  },
  contact: {
    title: "Start a project — UnwhelmNet",
    description: "Tell us about one workflow, system, or decision that keeps getting stuck.",
  },
  privacy: {
    title: "Privacy — UnwhelmNet",
    description: "Draft for Edmund's review, not legal advice. How UnwhelmNet handles contact information, proposals, contracts, invoices, and use through ChatGPT or Claude MCP connectors.",
  },
  terms: {
    title: "Terms — UnwhelmNet",
    description: "Draft for Edmund's review, not legal advice. Terms for the UnwhelmNet website, client portal, and MCP connectors such as ChatGPT and Claude.",
  },
  support: {
    title: "Support — UnwhelmNet",
    description: "Draft for Edmund's review. How to reach UnwhelmNet about the website, client portal, proposals, and ChatGPT or Claude MCP connectors.",
  },
  demo: {
    title: "Try the demo account — UnwhelmNet",
    description: "Sign in as the client demo account to open a sample proposal in ChatGPT or the client portal. Ask for the password; it is not published.",
  },
  "request-access": {
    title: "Request access — UnwhelmNet",
    description: "Unwhelm is invite-only during preview. Ask for an account. Sign-in is a passwordless email link after the request is reviewed.",
  },
  claude: {
    title: "Connect Claude to Unwhelm — UnwhelmNet",
    description: "Add Unwhelm as a custom connector in Claude. Sign in with an email link, then list proposals and draft work from chat.",
  },
  connect: {
    title: "Connect an MCP client — UnwhelmNet",
    description: "Compare setup for Claude, ChatGPT, Cursor, VS Code, Windsurf, Gemini CLI, and Codex against Unwhelm's remote MCP server.",
  },
  chatgpt: {
    title: "Connect ChatGPT to Unwhelm — UnwhelmNet",
    description: "Add Unwhelm as a custom MCP server in ChatGPT. Sign in with an email link, then list proposals and draft work from chat.",
  },
  cursor: {
    title: "Connect Cursor to Unwhelm — UnwhelmNet",
    description: "Add Unwhelm to Cursor with mcp.json or a one-click install link. Sign in with an email link, then list proposals from Agent chat.",
  },
  vscode: {
    title: "Connect VS Code to Unwhelm — UnwhelmNet",
    description: "Add Unwhelm in VS Code and GitHub Copilot with MCP: Add Server or a portable mcp.json. Sign in with an email link, then use it in Copilot chat.",
  },
  windsurf: {
    title: "Connect Windsurf to Unwhelm — UnwhelmNet",
    description: "Add Unwhelm in Windsurf or Devin Desktop Cascade with mcp_config.json and serverUrl. Sign in with an email link, then use it in Cascade.",
  },
  "gemini-cli": {
    title: "Connect Gemini CLI to Unwhelm — UnwhelmNet",
    description: "Add Unwhelm to Gemini CLI with httpUrl in settings.json or gemini mcp add. Authenticate with /mcp auth and an email link.",
  },
  codex: {
    title: "Connect Codex to Unwhelm — UnwhelmNet",
    description: "Add Unwhelm to Codex with a Streamable HTTP url in config.toml, then run codex mcp login and sign in with an email link.",
  },
  chat: {
    title: "Chat — UnwhelmNet",
    description: "Prospect chat is coming soon. Use the Contact page to reach us.",
  },
  "not-found": {
    title: "Page not found — UnwhelmNet",
    description: "The requested page could not be found.",
  },
  engagement: {
    title: "Pricing and engagement options — UnwhelmNet",
    description:
      "Choose a practical software consulting engagement: a Workflow Check, Capped Hours, or a Fixed Price build.",
  },
};

const projectGoals = [
  "API Integration & Workflow Automation",
  "Data Migration / System Consolidation",
  "Custom Reporting & Analytics Dashboards",
  "AI / LLM Implementation (Search / Automation)",
  "Process Optimization & SOP Standardization",
  "Other (describe in message)",
];

const cloudProviders = [
  "Amazon Web Services (AWS)",
  "Microsoft Azure",
  "Google Cloud Platform (GCP)",
  "Oracle Cloud Infrastructure (OCI)",
  "IBM Cloud",
  "DigitalOcean",
  "Vercel",
  "Cloudflare",
];

const realEstateSystems = {
  "Property Management": ["AppFolio", "Propertyware", "Buildium", "Yardi Breeze / Voyager", "Rent Manager", "Other"],
  "Leasing / Showings": ["Rently", "Tenant Turner", "ShowMojo", "Zillow Rentals / Apartments.com", "Avail", "Other"],
  Maintenance: ["PropertyMeld", "zInspector", "Latchel", "Fexa", "UpKeep", "Other"],
  "Document & e-Sign": ["DocuSign", "Dotloop", "Adobe Sign", "JotForm", "Formstack", "Other"],
  "Database / Reporting": ["Microsoft SQL Server", "Power BI", "Tableau", "Snowflake", "Excel (Advanced Modeling)", "Other"],
};
const capabilities = [
  "Working software",
  "API integrations",
  "AI under application controls",
  "SQL + data pipelines",
  "Linux + Windows deployment",
];

const operatingPrinciples = [
  {
    icon: Code2,
    title: "Real code",
    text: "Not slideware",
  },
  {
    icon: Layers3,
    title: "Clear ownership",
    text: "Truth lives somewhere",
  },
  {
    icon: BrainCircuit,
    title: "AI where useful",
    text: "State stays deterministic",
  },
];

const outcomes = [
  { kicker: "Proof", label: "Working walkthroughs", detail: "Recorded demos show the architecture while it runs, not teaser clips." },
  { kicker: "Industries", label: "Real estate, finance, law, healthcare", detail: "The same boundary problems, already worked through in four lanes." },
  { kicker: "Ownership", label: "The same team ships it", detail: "Discovery, architecture, and implementation stay with the people who scoped the work." },
];

const engagement = [
  {
    mark: "look",
    title: "Discover the real workflow",
    text: "Start with the business process, source systems, ownership rules, and constraints before choosing technology.",
  },
  {
    mark: "fence",
    title: "Design the boundary",
    text: "Define what each system owns, how data is translated, where authentication lives, and what happens when dependencies fail.",
  },
  {
    mark: "prove",
    title: "Build something demonstrable",
    text: "Move from architecture to a working integration, application, or prototype that stakeholders can actually inspect.",
  },
  {
    mark: "brief",
    title: "Explain it at the right altitude",
    text: "Discuss outcomes with business leaders, contracts with architects, and implementation details with engineers.",
  },
];

const competitorLessons = [
  "Working demos and measured outcomes should appear before broad claims.",
  "Security, ownership, and approval points should be explicit before production work begins.",
  "A small first engagement should have a clear scope, timeline, and price signal.",
  "The client should leave with source code, documentation, and a system the team can operate.",
];

const approachDeliverables = [
  {
    mark: "01",
    title: "A shared map",
    text: "The workflow, systems, owners, constraints, and failure points are visible to the people making the decision.",
  },
  {
    mark: "02",
    title: "A bounded first build",
    text: "The first implementation proves one valuable path instead of pretending the whole system can be solved in one pass.",
  },
  {
    mark: "03",
    title: "A decision you can defend",
    text: "You know what works, what needs hardening, what it costs to operate, and what should happen next.",
  },
];

const approachGates = [
  {
    title: "Before the build",
    text: "Agree on the business outcome, source of truth, users, permissions, and the smallest useful proof.",
  },
  {
    title: "During the build",
    text: "Review working slices, test the boundary cases, and keep architectural decisions visible while they are still cheap to change.",
  },
  {
    title: "Before the handoff",
    text: "Demonstrate the workflow, document the operating assumptions, and make ownership clear for the next person.",
  },
];

const clientRelationship = [
  {
    mark: "01",
    title: "Tell us what is getting stuck",
    text: "Use the contact form or email a plain description of the workflow, systems, deadline, and what the team is doing manually today.",
  },
  {
    mark: "02",
    title: "Take a free 30-minute consult",
    text: "We ask questions, identify the real boundary problem, and tell you what we can see from the first conversation.",
  },
  {
    mark: "03",
    title: "Choose the right first engagement",
    text: "If the problem is a fit, we agree on paid discovery, a fixed-scope build, or an implementation plan before work begins.",
  },
  {
    mark: "04",
    title: "Review working software together",
    text: "You see progress in working slices, make decisions while they are still inexpensive, and receive a clear handoff at the end.",
  },
];

// Capped Hours savings against the standard hourly rate, computed from the shared pricing values.
// The free consult time is included: skipping the consult adds it to the block's working hours.
function cappedSaving(hourlyRate: number, block: { hours: number; price: number }) {
  const hours = block.hours + pricingCopy.freeConsultMinutes / 60;
  const list = hours * hourlyRate;
  const money = (n: number) => n.toLocaleString("en-US", Number.isInteger(n) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Save $${money(list - block.price)} vs. $${money(list)} for ${hours} hrs at $${hourlyRate}/hr`;
}

function pricingExamplesFor(prices: CatalogPrices): { key: string; tier: string; price: string; service: string; page: Page; text: string; accent: string }[] {
  return [
    {
      key: "workflow-check",
      tier: "Workflow Check",
      price: `$${prices.workflowCheck}`,
      service: "Automation",
      page: "automation",
      text: "An office manager rebuilds the same month-end report in Excel every month from two systems. In under 3 hours we map the current steps, pick the top fixes, and prototype a SQL query that pulls both sources into one sheet. They leave with a scoped plan to schedule it.",
      accent: "teal",
    },
    {
      key: "capped-8",
      tier: "Capped Hours",
      price: `${prices.capped8.hours} hrs for $${prices.capped8.price}`,
      service: "AI agents & MCP",
      page: "agents",
      text: "A small firm wants its team to ask ChatGPT or Claude questions about live project data instead of digging through spreadsheets. In one capped block we stand up an MCP server with a few read-only, permission-checked tools on their database and connect it to their AI app.",
      accent: "orange",
    },
    {
      key: "fixed",
      tier: "Fixed Price",
      price: `from ${prices.fixedFrom}`,
      service: "Integration & web",
      page: "integration",
      text: "A services company enters each new customer three times: in its web form, its CRM and its billing system. For one scoped price we build the integration with clear ownership and error handling, plus a small internal dashboard showing what synced and what failed.",
      accent: "gold",
    },
  ];
}

function pricingOptionsFor(prices: CatalogPrices): { key: string; title: string; price: string; saving?: string; text: string; accent: string }[] {
  return [
    {
      key: "workflow-check",
      title: "Workflow Check",
      price: `$${prices.workflowCheck} fixed`,
      text: `Up to ${pricingCopy.workflowCheckMinutes / 60} hours on one workflow you pick. You get a map of how it works today, the top fixes, and a working prototype or a scoped build plan. If you go ahead within ${pricingCopy.workflowCheckCreditDays} days, the $${prices.workflowCheck} is credited back.`,
      accent: "teal",
    },
    {
      key: "capped-4",
      title: `Capped Hours, ${prices.capped4.hours}`,
      price: `$${prices.capped4.price}`,
      saving: cappedSaving(prices.hourlyRate, prices.capped4),
      text: `Up to ${prices.capped4.hours} hours for the whole job, from statement of work to finished deliverable, never billed past the cap. Plus a free ${pricingCopy.freeConsultMinutes} minutes: use it for a consult, or skip the consult and get ${prices.capped4.hours + pricingCopy.freeConsultMinutes / 60} hours of work.`,
      accent: "orange",
    },
    {
      key: "capped-8",
      title: `Capped Hours, ${prices.capped8.hours}`,
      price: `$${prices.capped8.price}`,
      saving: cappedSaving(prices.hourlyRate, prices.capped8),
      text: `Up to ${prices.capped8.hours} hours for the whole job, from statement of work to finished deliverable, never billed past the cap. Plus a free ${pricingCopy.freeConsultMinutes} minutes: use it for a consult, or skip the consult and get ${prices.capped8.hours + pricingCopy.freeConsultMinutes / 60} hours of work.`,
      accent: "orange",
    },
    {
      key: "fixed",
      title: "Fixed Price",
      price: `from ${prices.fixedFrom}`,
      text: "A defined deliverable at one set price, quoted per statement of work.",
      accent: "gold",
    },
  ];
}

const agentCallout =
  "Every client gets one, whether you start with a Workflow Check, Capped Hours, or Fixed Price. Our customer service runs on AI agents, with a human always available. We build your first AI agent and show you how to use it. You talk to your agent, it talks to ours, and our people step in whenever needed. Because the agent is yours, every conversation history and decision stays with you, not locked inside someone else's system.";

const parityPageSource: Record<string, ParityContent> = {
  "real-estate": {
    eyebrow: "REAL ESTATE SOLUTIONS",
    title: "Property-management integrations that remove manual reconciliation.",
    intro:
      "Connect AppFolio, Propertyware, Buildium, PropertyMeld, Rently, DocuSign, DotLoop, Zillow, RESO, leasing, maintenance, documents, reporting, and the spreadsheets your team still depends on. Start with the workflow that costs people time every week.",
    cards: [
      {
        title: "Leasing and lead routing",
        text: "Connect Propertyware, AppFolio, Rently, forms, email, and showing tools without duplicating ownership.",
        bullets: ["PropertyWare + Rently leasing automation", "Lead-to-lease handoffs", "Clear source-of-truth boundaries"],
        link: { page: "real-estate-property-managers", label: "See the property-manager path" },
      },
      {
        title: "Vacancy Lifecycle Automation",
        text: "Move a unit from notice through pricing, marketing, showing, application, and lease-up with fewer manual handoffs.",
        bullets: ["Vacancy status transitions", "Pricing and availability checks", "Review points for staff"],
        link: { page: "real-estate-property-managers", label: "See the property-manager path" },
      },
      {
        title: "Financial & Ledger Alignment",
        text: "Align operational events with the financial records and reports that managers use to make decisions.",
        bullets: ["Ledger-aware workflows", "Reconciliation and exception queues", "Reporting that preserves ownership"],
        link: { page: "real-estate-institutional-investors", label: "See the institutional path" },
      },
      {
        title: "Data and reporting",
        text: "Turn exports, spreadsheets, SQL data, and platform reports into an operating view people can trust.",
        bullets: ["SQL Server reporting", "Data cleanup pipelines", "Exception-focused dashboards"],
        link: { page: "real-estate-institutional-investors", label: "See the institutional path" },
      },
      {
        title: "Documents and compliance",
        text: "Keep documents, forms, signatures, and operational evidence attached to the workflow that produced them.",
        bullets: ["DocuSign and DotLoop handoffs", "Document generation", "Traceable approvals"],
        link: { page: "real-estate-brokerages", label: "See the brokerage path" },
      },
      {
        title: "AI-assisted operations",
        text: "Use retrieval, drafting, and classification where they reduce search and reconciliation without becoming the source of truth.",
        bullets: ["Source-aware assistants", "Human review before consequential actions", "Deterministic application controls"],
        link: { page: "real-estate-institutional-investors", label: "See the institutional path" },
      },
    ],
    proof: {
      title: "A practical result to start from.",
      text: "One pricing workflow cut decision time from 3–6 hours to 10–20 minutes by putting the right data, retrieval, and review steps in one controlled path.",
    },
    faq: [
      { question: "How much does an integration cost?", answer: "A small workflow can start with a short paid mapping session or a fixed first build. Larger AppFolio and Propertyware integrations are scoped after we understand the systems, access, and acceptance criteria." },
      { question: "How long does a first build take?", answer: "A bounded workflow commonly takes one to three weeks after access and requirements are clear. A larger multi-system build gets a written timeline and milestones." },
      { question: "What access do you need?", answer: "We start with the least privilege needed for discovery and testing, keep credentials separate from source code, and define production access and approval points before deployment." },
    ],
  },
  "real-estate-property-managers": {
    eyebrow: "REAL ESTATE / PROPERTY MANAGERS",
    title: "Automate the work around AppFolio or Propertyware.",
    clip: {
      src: "/assets/clip-vacancy-turnover.mp4",
      poster: "/assets/video-poster-vacancy-turnover.jpg",
      label: "Animated move-out turnover timeline for Unit 4B: financial, inspection, turnover and marketing tracks run in parallel. Flooring slips four days, the ready date moves from 12/5 to 12/9, and the automation layer recalculates dependent dates and notifies vendors.",
      eyebrow: "MOVE-OUT TURNOVER, AUTOMATED",
      title: "One slipped task. Every dependent date updates.",
      caption: "Unit 4B: financial, inspection, turnover and marketing tracks share one timeline. When flooring slips +4 days, Ready moves from 12/5 to 12/9, and the warehouse + automation layer recalculates downstream dates and notifies vendors.",
    },
    intro: "Small property-management teams know exactly where the work gets stuck: leasing, showings, maintenance, documents, and reporting all cross system boundaries. We connect the workflow without asking you to hire a full IT department or replace the platforms you already use.",
    cards: [
      {
        title: "Leasing and showing handoffs",
        text: "Move leads, availability, showings, applications, and follow-up through one visible operating path.",
        bullets: ["AppFolio and Propertyware workflows", "Rently and showing handoffs", "Review queues for exceptions"],
      },
      {
        title: "Vacancy and pricing operations",
        text: "Keep vacancy status, market context, pricing decisions, and approvals aligned as a unit moves toward lease-up.",
        bullets: ["Vacancy lifecycle states", "CMA and comparable data", "Human approval before publication"],
      },
      {
        title: "Documents, maintenance, and reporting",
        text: "Reduce the re-entry between forms, signatures, maintenance tools, spreadsheets, and the reports owners actually need.",
        bullets: ["PropertyMeld and maintenance handoffs", "DocuSign, DotLoop, and forms", "Exception-focused dashboards"],
      },
      {
        title: "A practical first build",
        text: "Start with one workflow that is repeated often enough to pay back the work, then leave the team with a system they can operate.",
        bullets: ["Least-privilege access", "Working proof before expansion", "Clear ownership and handoff"],
      },
    ],
    proof: {
      title: "The measure that matters.",
      text: "A pricing workflow for a multi-state property-management firm, built on the RentFinder CMA platform, reduced decision time from 3–6 hours to 10–20 minutes.",
    },
    faq: [
      { question: "Do we need dedicated IT staff?", answer: "No. We start from the operations team, document the boundary, and build a maintainable path around the platforms you already own." },
      { question: "Can we keep AppFolio or Propertyware?", answer: "Yes. The first question is what each platform owns and where a controlled integration removes duplicate work." },
      { question: "What should we bring to the first conversation?", answer: "Bring one workflow, the systems it touches, what people re-enter today, and the result you need to see sooner." },
    ],
  },
  "real-estate-brokerages": {
    eyebrow: "REAL ESTATE / BROKERAGES",
    title: "Make buyer and seller workflows agree with the listing data.",
    intro: "Brokerages often have a strong listing source and still lose time at the handoffs: search, inquiry, buyer and seller intake, status changes, and reporting. We build the application and integration path around the data standards and systems that already matter to the business.",
    cards: [
      {
        title: "Zillow and listing flows",
        text: "Connect listing data to the buyer and seller experiences without turning every downstream screen into a second source of truth.",
        bullets: ["Listing ingestion and normalization", "Inquiry and lead routing", "Status-aware user experiences"],
      },
      {
        title: "RESO and MLS boundaries",
        text: "Translate external listing standards into application contracts that the product team can actually build against.",
        bullets: ["RESO-aligned data flows", "Field mapping and validation", "Explicit ownership of updates"],
      },
      {
        title: "Buyer and seller workflows",
        text: "Give agents and operators a consistent path from interest to action, with review points when the record or permission changes.",
        bullets: ["Buyer and seller handoffs", "Agent and staff views", "Permission-aware actions"],
      },
      {
        title: "A platform that can evolve",
        text: "Keep the integration boundary understandable so a brokerage can add tools, reporting, or automation without rewriting the whole product.",
        bullets: ["API-backed application surfaces", "Operational reporting", "Documented handoff contracts"],
      },
    ],
  },
  legal: {
    eyebrow: "LEGAL OPERATIONS",
    title: "Connect matter workflows without losing control of the record.",
    intro: "Legal teams move between intake, documents, email, practice systems, billing exports, and shared files. The work is to make those handoffs visible and dependable while keeping client and matter data under the right permissions.",
    cards: [
      { title: "Intake and matter setup", text: "Turn forms, email, and review steps into a reliable path from new inquiry to matter ownership.", bullets: ["Structured intake", "Conflict and review checkpoints", "Clear matter ownership"] },
      { title: "Documents and approvals", text: "Connect document generation, signatures, shared storage, and filing steps around the work that created them.", bullets: ["Document templates", "Signature handoffs", "Traceable approvals"] },
      { title: "Billing and reporting", text: "Reconcile operational exports and reports without copying the authoritative record into a side system.", bullets: ["Billing exports", "Matter status views", "Exception reporting"] },
    ],
  },
  healthcare: {
    eyebrow: "HEALTHCARE OPERATIONS",
    title: "Connect the operational work around the record.",
    intro: "Scheduling, referrals, billing, portals, forms, and documents often live in separate operational paths. We connect the work around the system that owns the clinical or patient record, with explicit permissions and staff review.",
    cards: [
      { title: "Scheduling and referrals", text: "Make referral status and scheduling handoffs visible across portals, staff queues, and the system of record.", bullets: ["Referral intake", "Scheduling handoffs", "Exception queues"] },
      { title: "Billing and operations", text: "Connect billing and operational exports so teams can act on the same current context without duplicating sensitive records.", bullets: ["Billing workflows", "Operational dashboards", "Source-of-truth boundaries"] },
      { title: "Documents and access", text: "Keep forms, documents, permissions, and approvals attached to the workflow that produced them.", bullets: ["Role-aware access", "Audit-friendly handoffs", "Human review before filing"] },
    ],
  },
  financial: {
    eyebrow: "FINANCIAL OPERATIONS",
    title: "Make the GL inspectable, then put the exceptions on a list.",
    intro: "We do not live only in finance. We keep getting called where operations and the books disagree: a GL nobody can peek into, card spend that does not match the sub-account, two property platforms with different charts of accounts.",
    cards: [
      {
        title: "GL explorer and warehouse",
        text: "A tool to look into the general ledger, plus a warehouse pull of that GL, so ops can see the same books the accountants see — without becoming a second set of books.",
        bullets: ["Explorer built to learn how the GL was actually set up", "GL copied into the warehouse for daily review", "Finance still owns the close; we own the view"],
      },
      {
        title: "Recurring exceptions",
        text: "Department cards tied to sub-accounts are clean until spend and the account stop matching. One workaround is an ops problem; the same mismatch every week is a process problem.",
        bullets: ["Daily exception lists from the warehouse", "Assign someone until the item is actually closed", "We built the tracking, not the desk that posts the GL"],
      },
      {
        title: "Chart-of-accounts mapping",
        text: "Propertyware to AppFolio GL work: research and mappings so the two charts can talk. We laid out the map; we did not run the cutover.",
        bullets: ["Account-to-account mappings", "Where the two GLs do not line up", "Handoff a real integration team can build from"],
      },
      {
        title: "Earlier money systems",
        text: "Proof we have stood next to a system of record before, not a claim that we only do banks.",
        bullets: ["IU FIS — Uniface + Sybase finance rebuild", "Amerix — creditor payments on early Mastercard RPPS and Visa ePay", "DC TANF — new stack beside the AS/400, two people, District-wide", "Also: Crestar/SunTrust, TransactPlus, Wells small-business SharePoint, iCommerce"],
      },
    ],
  },
  "ai-solutions": {
    eyebrow: "AI SOLUTIONS",
    title: "AI under application controls.",
    intro:
      "Use retrieval, semantic search, local models, commercial model boundaries, and deterministic business state where they fit.",
    cards: [
      {
        title: "Retrieval and RAG",
        text: "Source-aware assistants where documents, embeddings, prompts, and citations stay visible.",
        bullets: ["Source ingestion", "Embedding search"],
        link: { page: "supabase", label: "pgvector RAG on Supabase" },
      },
      {
        title: "AI workflow support",
        text: "Models draft, classify, search, and review; authoritative records stay outside the model.",
        bullets: ["Human review", "Structured outputs"],
      },
      {
        title: "Local and private options",
        text: "Local, hosted, or commercial models, chosen by risk and infrastructure.",
        bullets: ["Local model demos", "Commercial model adapters"],
      },
    ],
  },
  "ai-economics": {
    eyebrow: "AI ECONOMICS",
    title: "Make the cost model visible before the build gets expensive.",
    intro:
      "What to automate, what to review, where inference cost lives, and when a simpler system wins.",
    cards: [
      {
        title: "Cost of ownership",
        text: "Operating cost across infrastructure, model calls, review time, and maintenance.",
        bullets: ["Inference and hosting cost", "Human review cost"],
      },
      {
        title: "Value triggers",
        text: "AI where it cuts search, reconciliation, drafting, or routing in repeated work.",
        bullets: ["High-volume knowledge lookup", "Classification and routing"],
      },
      {
        title: "Risk boundaries",
        text: "Price in errors, privacy exposure, and unclear ownership before rollout.",
        bullets: ["Permission boundaries", "Audit trails"],
      },
    ],
  },
  "web-design": {
    eyebrow: "WEB APP DESIGN",
    title: "Modern web applications that fit the workflow.",
    intro:
      "React applications, APIs, dashboards, and internal tools built around the real work.",
    cards: [
      {
        title: "Application surfaces",
        text: "Design screens around repeated work, dense information, and clear next actions.",
        bullets: ["React and TypeScript", "Form-heavy internal tools"],
      },
      {
        title: "Integration-first UI",
        text: "Treat the interface as the visible edge of APIs, permissions, validation, and data ownership.",
        bullets: ["API-backed views", "Role-aware workflows"],
      },
      {
        title: "Deployment-ready builds",
        text: "Ship applications that can live behind real domains, servers, logs, and production handoffs.",
        bullets: ["Vite and Node hosting", "Cloud or VPS deployment"],
      },
    ],
  },
  platforms: {
    eyebrow: "PLATFORMS",
    title: "Platform boundaries made explicit.",
    intro:
      "Group SaaS, database, cloud, and internal systems by what they own and how they exchange data.",
    cards: [
      {
        title: "SaaS adapters",
        text: "Connect business platforms without pretending every system owns the same state.",
        bullets: ["Propertyware and AppFolio", "JotForm and document systems", "GitHub and workflow tools"],
      },
      {
        title: "Data platforms",
        text: "SQL, spreadsheets, files, and warehouse-style flows where they fit.",
        bullets: ["SQL Server", "ETL and cleanup jobs"],
      },
      {
        title: "Infrastructure",
        text: "Linux, Windows, VPS, cloud, or hybrid, with a clear handoff model.",
        bullets: ["Reverse proxies", "Environment separation"],
      },
    ],
  },
  "case-studies": {
    eyebrow: "CASE STUDIES",
    title: "Case studies with the problem left in.",
      intro:
      "Working examples show the problem, the systems involved, what changed, and where human review still belongs.",
    cards: [
      {
        title: "PropertyWare + Rently leasing automation",
        text: "Connected leasing, showing, and property-management workflows so teams could move from lead to lease with less duplicate entry.",
        bullets: ["PropertyWare workflows", "Rently handoffs", "Operational review points"],
        link: { page: "case-propertyware-rently", label: "Read the case study" },
        pdf: "case-propertyware-rently",
      },
      {
        title: "Synthetic data test environments",
        text: "Created realistic test data and repeatable environments so integration work could be exercised without relying on production records.",
        bullets: ["Repeatable fixtures", "Safer integration testing", "Faster development feedback"],
        link: { page: "case-synthetic-data", label: "Read the case study" },
        pdf: "case-synthetic-data",
      },
      {
        title: "Zillow + RESO buyer-seller platform",
        text: "Built the application and integration path between real-estate listing data, buyer and seller workflows, and the systems that owned each record.",
        bullets: ["RESO-aligned data flows", "Buyer and seller handoffs", "Explicit platform boundaries"],
        link: { page: "case-zillow-reso", label: "Read the case study" },
        pdf: "case-zillow-reso",
      },
      {
        title: "Institutional client data repository and API",
        text: "Turned institutional property data into a governed repository and API that downstream applications could use consistently.",
        bullets: ["Structured data repository", "API contracts", "Access and reporting boundaries"],
        link: { page: "case-data-repository", label: "Read the case study" },
        pdf: "case-data-repository",
      },
      {
        title: "Automated CMA vacancy pricing",
        text: "A RentFinder CMA workflow reduced pricing decision time from 3–6 hours to 10–20 minutes with retrieval, structured data, and human review.",
        bullets: ["Comparable-market analysis", "Vacancy pricing workflow", "Measured human review step"],
        link: { page: "case-cma-pricing", label: "Read the case study" },
        pdf: "case-cma-pricing",
      },
    ],
    proof: {
      title: "A multi-state property-management firm / RentFinder CMA",
      text: "This is the source of the pricing result: Business Software Architect work for a multi-state property-management firm from 2022–2025, including the RentFinder CMA platform.",
    },
  },
  clients: {
    eyebrow: "CLIENTS",
    title: "Built for businesses with real workflows and limited patience for theater.",
    intro:
      "Work with small and mid-sized teams that need direct engineering ownership across software, data, AI, and infrastructure.",
    cards: [
      {
        title: "Property-management operators",
        text: "Teams living between leasing, maintenance, documents, accounting, portals, spreadsheets, and reporting.",
        bullets: ["Operational clarity", "Reduced duplicate entry", "Cleaner reporting"],
      },
      {
        title: "Technical founders and owners",
        text: "People who need someone to reason through architecture and then build the working system.",
        bullets: ["Direct collaboration", "Prototype to production", "Practical tradeoffs"],
      },
      {
        title: "Internal operations teams",
        text: "Groups that need their existing tools to cooperate without buying a giant platform first.",
        bullets: ["Workflow mapping", "System integration", "Supportable automation"],
      },
    ],
  },
  diagramming: {
    eyebrow: "DIAGRAMMING",
    title: "Architecture diagrams that clarify ownership.",
    intro:
      "Use diagrams to explain API flows, data movement, AI boundaries, and deployment topology.",
    cards: [
      {
        title: "System maps",
        text: "Show which systems own which records and where handoffs happen.",
        bullets: ["Source-of-truth maps", "Failure points", "Credential boundaries"],
      },
      {
        title: "API and data flows",
        text: "Document contracts, transformations, queues, schedules, and reconciliation paths.",
        bullets: ["Request flows", "ETL diagrams", "Sync and retry behavior"],
      },
      {
        title: "AI architecture",
        text: "Make retrieval, prompts, model choices, and review boundaries visible before implementation.",
        bullets: ["RAG pipelines", "Human review loops", "Deterministic state"],
      },
    ],
  },
  "technical-skills": {
    eyebrow: "TECHNICAL SKILLS",
    title: "Senior implementation across software, data, AI, and infrastructure.",
    intro:
      "The tools and judgment behind the work span application engineering, data, AI, and infrastructure.",
    cards: [
      {
        title: "Application engineering",
        text: "Build usable systems with TypeScript, React, Node, APIs, validation, and deployment discipline.",
        bullets: ["React and TypeScript", "Node and Express", "REST API design"],
      },
      {
        title: "Data and integration",
        text: "Move between SQL, SaaS APIs, spreadsheets, documents, files, and reporting systems.",
        bullets: ["SQL Server", "ETL workflows", "SaaS integration"],
      },
      {
        title: "AI and infrastructure",
        text: "Use LLMs, retrieval, local models, VPS hosting, Linux, Windows, and cloud services where they fit.",
        bullets: ["RAG and embeddings", "Linux and Windows", "Cloud and VPS hosting"],
      },
    ],
  },
};
const { clients: clientsContent, diagramming: diagrammingContent, ...parityPageRest } = parityPageSource;

const parityPages: Partial<Record<Page, ParityContent>> = {
  ...parityPageRest,
  "case-studies": { ...parityPageRest["case-studies"], more: [clientsContent] },
  "technical-skills": { ...parityPageRest["technical-skills"], more: [diagrammingContent] },
  integration: {
    eyebrow: "SERVICES / INTEGRATION",
    title: "Systems integration with clear ownership.",
    intro: "The focus is not selling a stack; it is making independently designed systems cooperate reliably enough to support the business workflow.",
    cards: [
      {
        title: "API contracts",
        text: "Requests, responses, and validation each system can rely on before data moves.",
        bullets: ["Typed boundaries", "Validation at the edge"],
        link: { page: "supabase", label: "Moving a database onto Supabase" },
      },
      {
        title: "SaaS adapters",
        text: "Connect the platforms you depend on without duplicating ownership of the record.",
        bullets: ["Source-of-truth boundaries", "Translation between systems"],
        link: { page: "real-estate", label: "See property-management integrations" },
      },
      {
        title: "Identity, permissions, and failure handling",
        text: "Credentials, retries, and reconciliation stay explicit, so a failed sync is visible.",
        bullets: ["Failure handling", "Audit trails"],
      },
    ],
  },
  "vibe-coded": {
    eyebrow: "SERVICES / VIBE-CODED APPS",
    title: "From vibe-coded app to real production.",
    intro: "AI app builders get you to a working app fast. Real users, real data, and real payments need more: tight security, your own repo and hosting, backups, and someone who knows the database.",
    cards: [
      {
        title: "Code and security review",
        text: "We read what the builder generated and check for exposed keys, open tables, and missing sign-in rules, then list what has to change before launch.",
        bullets: ["Secrets and API keys", "Auth and row-level security"],
      },
      {
        title: "Production setup",
        text: "Move from the builder's preview to your own GitHub repo, staging and production environments, backups, and monitoring, so a bad deploy can be rolled back.",
        bullets: ["Git, staging, and production", "Backups and monitoring"],
      },
      {
        title: "Keep building",
        text: "Keep using the builder you like for new screens while we handle the database, integrations, payments, and the parts AI tools tend to get wrong.",
        bullets: ["Database tuning", "Integrations and payments"],
        link: { page: "supabase", label: "See Supabase work" },
      },
    ],
    more: [
      {
        eyebrow: "WHERE YOUR APP STARTED",
        title: "Each builder leaves a different starting point.",
        intro: "We start from what you have; no rewrite unless the code really needs one.",
        cards: [
          {
            title: "Lovable and Bolt",
            text: "Both give your app a Supabase backend, so your data, sign-in, and files already live on Postgres. We take over that project, lock down its security rules, and tune it for real traffic.",
            bullets: ["Supabase underneath", "Code synced to GitHub"],
          },
          {
            title: "Replit and Base44",
            text: "Apps run on the builder's own hosting and database. We can harden the app where it is, or move it and its data to Supabase or another Postgres host.",
            bullets: ["Builder-hosted database", "Keep it or move it"],
          },
          {
            title: "v0 and other tools",
            text: "Tools that hand you the code leave the backend up to you. We review the code, set up the database and sign-in, and deploy it.",
            bullets: ["Your code, your repo", "Backend and deployment"],
          },
        ],
      },
    ],
  },
  supabase: {
    eyebrow: "SERVICES / SUPABASE",
    title: "Supabase: one Postgres backend for AI apps.",
    intro: "Supabase is a Postgres database with sign-in, file storage, and pgvector vector search built in, so an AI app can run its data, users, files, and embeddings on one backend.",
    cards: [
      {
        title: "New projects and migrations",
        text: "Set up a new Supabase project, or move an existing SQL Server or Postgres database onto it.",
        bullets: ["Schema and data migration", "Auth and storage setup"],
        link: { page: "vibe-coded", label: "Built it in Lovable or Bolt?" },
      },
      {
        title: "pgvector search and RAG",
        text: "Store embeddings next to the records they describe and add retrieval for AI features.",
        bullets: ["Semantic search", "Source-aware RAG"],
        link: { page: "ai-solutions", label: "See AI under application controls" },
      },
      {
        title: "Security, tuning, and agents",
        text: "Row-level security rules decide who sees which rows; then we tune queries and connect the database to MCP servers and AI agents.",
        bullets: ["Row-level security", "Performance tuning", "MCP and agent access"],
        link: { page: "agent-setup", label: "See agent setup" },
      },
    ],
    more: [
      {
        eyebrow: "WHEN SUPABASE GETS LARGE",
        title: "Two new options for two different scaling problems.",
        intro: "A project uses one or the other, not both. Neither is production-ready yet.",
        cards: [
          {
            title: "OrioleDB: storage under heavy updates",
            text: "Replaces Postgres's default heap storage, so busy tables don't bloat, VACUUM isn't needed, and transaction-ID wraparound stops being a risk. Throughput holds up better under high concurrency.",
            bullets: ["Public beta", "Chosen per table or at project creation"],
          },
          {
            title: "Multigres: connections and uptime",
            text: "From the team behind Vitess. Built-in connection pooling lets far more clients connect, and automated failover across availability zones keeps every committed write. App code doesn't change.",
            bullets: ["Private alpha", "Realtime not yet supported"],
          },
        ],
      },
    ],
  },
  automation: {
    eyebrow: "SERVICES / AUTOMATION",
    title: "Data and workflow automation around the systems you already use.",
    intro: "Practical ETL, reporting, and workflow automation, so people stop doing manual work between platforms.",
    cards: [
      {
        title: "SQL pipelines",
        text: "Move data between SQL, SaaS APIs, spreadsheets, and files on a schedule the business can trust.",
        bullets: ["ETL workflows", "Repeatable fixtures"],
      },
      {
        title: "Document workflows",
        text: "Route forms, signatures, and documents through one visible path instead of inboxes.",
        bullets: ["Reduced duplicate entry", "Human review points"],
        link: { page: "real-estate-property-managers", label: "See the property-manager path" },
      },
      {
        title: "Scheduled jobs and dashboards",
        text: "Run the recurring work automatically and surface exceptions where operators already look.",
        bullets: ["Operational dashboards", "Exception reporting"],
      },
    ],
  },
};

const pageLinks: PageLink[] = [
  { page: "real-estate", label: "Real Estate Solutions", text: "Property-management integration, reporting, documents, leasing, maintenance, and automation.", icon: DatabaseZap },
  { page: "ai-solutions", label: "AI Solutions", text: "RAG, semantic search, local and commercial model boundaries, and AI-enabled workflows.", icon: BrainCircuit },
  { page: "ai-economics", label: "AI Economics", text: "Cost, risk, review, and infrastructure tradeoffs before AI gets expensive.", icon: BadgeCheck },
  { page: "web-design", label: "Web App Design", text: "Modern web applications, dashboards, forms, and internal tools built around real workflows.", icon: Code2 },
  { page: "platforms", label: "Platforms", text: "SaaS, database, cloud, VPS, and internal platform boundaries made explicit.", icon: Layers3 },
  { page: "case-studies", label: "Case Studies", text: "Real estate, law, and healthcare operations with measurable outcomes.", icon: FileSearch },
  { page: "industries", label: "Industries", text: "Real estate, financial, legal, and healthcare operations connected around clear data ownership.", icon: Network },
  { page: "integration", label: "Integration", text: "API contracts, SaaS adapters, identity, permissions, and failure handling.", icon: Route },
  { page: "automation", label: "Automation", text: "SQL pipelines, document workflows, scheduled jobs, and operational dashboards.", icon: Workflow },
  { page: "technical-skills", label: "Technical Skills", text: "Application, integration, AI, data, cloud, Linux, Windows, and VPS capability map.", icon: TerminalSquare },
  { page: "videos", label: "Videos", text: "Technical walkthroughs for AI, data, integrations, APIs, and deployment.", icon: Video },
  { page: "documents", label: "Documents", text: "Technical documents for property management, AI, APIs, and deployment.", icon: FileSearch },
  { page: "git", label: "Git", text: "A curated in-app view of code samples, architecture notes, and inspectable implementation evidence.", icon: Github },
  { page: "contact", label: "Contact Us", text: "Tell us about one workflow, system, or decision that keeps getting stuck.", icon: Mail },
];

const routeGroups: { label: string; text: string; icon: PageLink["icon"]; pages: Page[] }[] = [
  {
    label: "Solutions",
    text: "What gets built: integrations, AI, economics, automation, web apps, and infrastructure.",
    icon: Layers3,
    pages: ["integration", "ai-solutions", "ai-economics", "automation", "web-design", "platforms"],
  },
  {
    label: "Evidence",
    text: "Proof you can inspect: case studies, videos, documents, and code samples.",
    icon: FileSearch,
    pages: ["try", "case-studies", "videos", "documents", "git"],
  },
  {
    label: "Practice",
    text: "The industries it fits and the skills behind the work.",
    icon: Route,
    pages: ["real-estate", "industries", "technical-skills"],
  },
  {
    label: "Start",
    text: "Scope the work and start the intake.",
    icon: Mail,
    pages: ["contact"],
  },
];

const redirectMap = legacyRedirects as Record<string, string>;

/* Pages that use the compact layout primitives (.compact-page, .split-layout, --compact-* tokens in styles.css). */
const compactPages = new Set<Page>(["integration", "ai-solutions", "agents", "ai-economics", "automation", "platforms", "web-design", "10x-team", "agent-setup", "supabase", "vibe-coded", "approach",
  "services", "industries", "real-estate", "real-estate-institutional-investors", "real-estate-property-managers", "real-estate-brokerages", "legal", "healthcare", "financial",
  "work", "case-studies", "case-propertyware-rently", "case-synthetic-data", "case-zillow-reso", "case-data-repository", "case-cma-pricing", "videos", "git", "documents",
  "about", "technical-skills", "engagement", "contact", "privacy", "terms", "support", "demo", "request-access", "claude", "connect", "chatgpt", "cursor", "vscode", "windsurf", "gemini-cli", "codex", "mcp", "insights", "article-who-pays", "try", "try-help", "try-connect", "mcp-connect", "mcp-getting-started", "mcp-explained", "mcp-explained-b", "proposal-architecture"]);

function normalizePath(pathname: string) {
  return pathname.replace(/\/+$/, "") || "/";
}

function pageFromPath(pathname: string): Page {
  const normalized = normalizePath(pathname);
  const target = redirectMap[normalized] ?? normalized;
  const match = Object.entries(routeByPage).find(([, path]) => path === target);
  return (match?.[0] as Page | undefined) ?? "not-found";
}

function App() {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));
  const [openMenu, setOpenMenu] = useState<Page | null>(null);
  const [catalogPrices, setCatalogPrices] = useState<CatalogPrices | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/catalog")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("catalog")) )
      .then((body: { entity?: CatalogPrices }) => {
        const prices = body.entity ?? (body as unknown as CatalogPrices);
        if (!cancelled && typeof prices.workflowCheck === "number") setCatalogPrices(prices);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // The production server answers old URLs with a 301; the dev server and client-side history land here instead.
    const target = redirectMap[normalizePath(window.location.pathname)];
    if (target) window.history.replaceState(null, "", `${target}${window.location.search}${window.location.hash}`);
  }, [page]);

  useEffect(() => {
    if (!openMenu) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const toggle = document.querySelector<HTMLButtonElement>(`[aria-controls="nav-menu-${openMenu}"]`);
      const focusInside = toggle?.closest(".nav-group")?.contains(document.activeElement);
      setOpenMenu(null);
      if (focusInside) toggle?.focus();
    };
    const handleClick = (event: globalThis.MouseEvent) => {
      if (!(event.target as HTMLElement).closest?.(".nav-group")) setOpenMenu(null);
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("click", handleClick);
    };
  }, [openMenu]);
  const [locationSearch, setLocationSearch] = useState(() => window.location.search);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      document.querySelector<HTMLButtonElement>(".menu-button")?.focus();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mobileOpen]);
  const [activeDemoId, setActiveDemoId] = useState(demos[0].id);
  const activeDemo = useMemo(
    () => demos.find((demo) => demo.id === activeDemoId) ?? demos[0],
    [activeDemoId]
  );

  useEffect(() => {
    const handlePopState = () => {
      setPage(pageFromPath(window.location.pathname));
      setLocationSearch(window.location.search);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const meta = pageMeta[page];
    document.title = meta?.title ?? siteTitle;
    document.querySelector('meta[name="description"]')?.setAttribute("content", meta?.description ?? siteDescription);
    const canonicalUrl = `https://unwhelm.net${routeByPage[page]}`;
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", canonicalUrl);
    document.querySelector('meta[property="og:url"]')?.setAttribute("content", canonicalUrl);
    // BreadcrumbList JSON-LD mirrors the visible breadcrumbs (same builder as the prerender script).
    document.getElementById("breadcrumb-jsonld")?.remove();
    if (page !== "home" && page !== "not-found" && page !== "admin" && page !== "portal") {
      const trail: [string, string][] = [["/", "Home"], ...pageAncestry(page).map((item) => [routeByPage[item], breadcrumbLabels[item] ?? item] as [string, string])];
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = "breadcrumb-jsonld";
      script.textContent = JSON.stringify(breadcrumbJsonLd(trail));
      document.head.appendChild(script);
    }
    let robots = document.querySelector('meta[name="robots"]');
    if (page === "not-found" || page === "admin" || page === "portal") {
      if (!robots) {
        robots = document.createElement("meta");
        robots.setAttribute("name", "robots");
        document.head.appendChild(robots);
      }
      robots.setAttribute("content", "noindex, nofollow");
    } else if (robots) {
      robots.remove();
    }
  }, [page]);

  // Move focus to <main> on page changes, except when switching articles inside the /insights
  // list-detail (focus stays on the selected row there).
  const previousPage = useRef(page);
  useEffect(() => {
    const from = previousPage.current;
    previousPage.current = page;
    const inInsights = (target: Page) => target === "insights" || Boolean(findInsightsArticle(target));
    if (from !== page && inInsights(from) && inInsights(page)) return;
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [page]);

  const navigate = (nextPage: Page, search = "", options: { scroll?: boolean } = {}) => {
    const query = search ? (search.startsWith("?") ? search : `?${search}`) : "";
    const nextPath = `${routeByPage[nextPage]}${query}`;
    if (`${window.location.pathname}${window.location.search}` !== nextPath) {
      window.history.pushState({ page: nextPage }, "", nextPath);
    }
    setPage(nextPage);
    setLocationSearch(query);
    setMobileOpen(false);
    setOpenMenu(null);
    if (options.scroll !== false) window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const routeLink = (nextPage: Page) => ({
    href: routeByPage[nextPage],
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      navigate(nextPage);
    },
  });

  const isNavActive = (itemPage: Page) => pageAncestry(page).includes(itemPage);

  return (
    <CatalogPriceContext.Provider value={catalogPrices}>
    <div className="site-shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="topbar">
        <div className="container nav-inner">
          <a className="brand" aria-label="UnwhelmNet home" {...routeLink("home")}>
            <span>Unwhelm</span><strong>Net</strong>
          </a>

          <nav className="desktop-nav" aria-label="Primary navigation">
            <ul className="nav-list">
              {navItems.map((item) => (
                <li
                  key={item.page}
                  className={`nav-group ${item.children ? "has-children" : ""} ${openMenu === item.page ? "open" : ""}`}
                >
                  <a className={isNavActive(item.page) ? "active" : ""} aria-current={page === item.page ? "page" : undefined} {...routeLink(item.page)}>
                    {item.label}
                  </a>
                  {item.children && (
                    <>
                      <button
                        type="button"
                        className="nav-submenu-toggle"
                        aria-expanded={openMenu === item.page}
                        aria-controls={`nav-menu-${item.page}`}
                        aria-label={`${item.label} pages`}
                        onClick={() => setOpenMenu((current) => (current === item.page ? null : item.page))}
                      >
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                      <ul className="nav-submenu" id={`nav-menu-${item.page}`}>
                        {item.children.map((child) => (
                          <li key={child}>
                            <a className={isNavActive(child) ? "active" : ""} aria-current={page === child ? "page" : undefined} {...routeLink(child)}>
                              {navChildLabels[child] ?? breadcrumbLabels[child]}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </li>
              ))}
              <li className="nav-group">
                <a className={`nav-cta ${page === "contact" ? "active" : ""}`} aria-current={page === "contact" ? "page" : undefined} {...routeLink("contact")}>
                  Contact
                </a>
              </li>
            </ul>
          </nav>

          <button
            className="menu-button"
            onClick={() => setMobileOpen((value) => !value)}
            aria-expanded={mobileOpen}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {mobileOpen && (
          <nav className="mobile-nav" aria-label="Mobile navigation">
            <ul>
              {navItems.map((item) => (
                <li key={item.page}>
                  <a className={isNavActive(item.page) ? "active" : ""} aria-current={page === item.page ? "page" : undefined} {...routeLink(item.page)}>
                    {item.label}
                  </a>
                  {item.children && (
                    <ul className="mobile-subnav" aria-label={`${item.label} pages`}>
                      {item.children.map((child) => (
                        <li key={child}>
                          <a className={isNavActive(child) ? "active" : ""} aria-current={page === child ? "page" : undefined} {...routeLink(child)}>
                            {navChildLabels[child] ?? breadcrumbLabels[child]}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              <li>
                <a className={`mobile-nav-cta ${page === "contact" ? "active" : ""}`} {...routeLink("contact")}>Contact</a>
              </li>
            </ul>
          </nav>
        )}
      </header>

      <main id="main" tabIndex={-1} aria-live="polite" className={`page-main page-${page}${compactPages.has(page) ? " compact-page" : ""}`}>
        {page !== "home" && page !== "not-found" && page !== "admin" && page !== "portal" && <Breadcrumbs page={page} routeLink={routeLink} />}
        {page === "home" && <HomePage navigate={navigate} routeLink={routeLink} />}
        {page === "real-estate-institutional-investors" && <InstitutionalInvestorsPage routeLink={routeLink} navigate={navigate} />}
        {parityPages[page] && <ParityPage page={page} navigate={navigate} />}
        {page === "videos" && (
          <ProofPage
            activeDemo={activeDemo}
            setActiveDemoId={setActiveDemoId}
            eyebrow="VIDEOS / PROOF BEFORE CLAIMS"
            agentLink={routeLink("agents")}
          />
        )}
        {page === "industries" && <IndustriesPage routeLink={routeLink} navigate={navigate} />}
        {page in caseStudies && <CaseStudyDetail study={caseStudies[page as CaseStudyPage]} navigate={navigate} />}
        {(page === "insights" || findInsightsArticle(page)) && <InsightsPage page={page} routeLink={routeLink} navigate={navigate} />}
        {page === "mcp" && <McpPage navigate={navigate} />}
        {page === "proposal-architecture" && <ProposalArchitecturePage />}
        {page === "agent-setup" && <AgentSetupPage navigate={navigate} />}
        {page === "work" && <WorkPage navigate={navigate} hub={<HubLinks parent="work" routeLink={routeLink} />} />}
        {page === "services" && <ServicesPage navigate={navigate} routeLink={routeLink} />}
        {page === "agents" && <AgentsPage routeLink={routeLink} />}
        {page === "10x-team" && <TenXTeamPage routeLink={routeLink} navigate={navigate} />}
        {page === "documents" && (
          <DocumentsPage onOpen={(filename) => navigate("markdown-viewer", `file=${encodeURIComponent(filename)}`)} />
        )}
        {page === "markdown-viewer" && (
          <MarkdownViewer
            initialFilename={documentFromSearch(locationSearch).filename}
            onSelect={(filename) => navigate("markdown-viewer", `file=${encodeURIComponent(filename)}`)}
          />
        )}
        {page === "git" && <GitPage navigate={navigate} />}
        {page === "approach" && <ApproachPage routeLink={routeLink} />}
        {page === "about" && <AboutPage navigate={navigate} hub={<HubLinks parent="about" routeLink={routeLink} />} />}
        {page === "resume" && <ResumePage routeLink={routeLink} />}
        {page === "engagement" && <EngagementPage routeLink={routeLink} />}
        {page === "privacy" && <PrivacyPage routeLink={routeLink} />}
        {page === "terms" && <TermsPage routeLink={routeLink} />}
        {page === "support" && <SupportPage routeLink={routeLink} />}
        {page === "demo" && <DemoPage />}
        {page === "request-access" && <RequestAccessPage />}
        {page === "claude" && <ClaudePage />}
        {page === "connect" && <ConnectHubPage />}
        {page === "chatgpt" && <ChatGptPage />}
        {page === "cursor" && <CursorConnectPage />}
        {page === "vscode" && <VsCodeConnectPage />}
        {page === "windsurf" && <WindsurfConnectPage />}
        {page === "gemini-cli" && <GeminiCliConnectPage />}
        {page === "codex" && <CodexConnectPage />}
        {page === "not-found" && <NotFoundPage routeLink={routeLink} />}
        {page === "admin" && <AdminRoute denied={<NotFoundPage routeLink={routeLink} />} />}
        {page === "portal" && <PortalRoute denied={<NotFoundPage routeLink={routeLink} />} />}
        {page === "contact" && <ContactPage routeLink={routeLink} />}
        {page === "chat" && <ChatComingSoonPage routeLink={routeLink} />}
        {page === "try" && <TryMePage />}
        {page === "try-help" && <TryMeHelpPage />}
        {page === "try-connect" && <ConnectMcpClientPage />}
        {page === "mcp-getting-started" && <McpGettingStartedPage />}
        {page === "mcp-explained" && <McpExplainedPage />}
        {page === "mcp-explained-b" && <McpExplainedBPage />}
        {page === "mcp-connect" && <McpConnectPage />}
      </main>

      <footer>
        <div className="container footer-inner">
          <div>
            <a className="brand footer-brand" {...routeLink("home")}><span>Unwhelm</span><strong>Net</strong></a>
            <p>Custom Software • AI • Automation • Cloud Infrastructure</p>
          </div>
          <div className="footer-links">
            <a {...routeLink("git")}>Code</a>
            <a {...routeLink("work")}>Work</a>
            <a {...routeLink("videos")}>Videos</a>
            <a {...routeLink("documents")}>Documents</a>
            <a {...routeLink("insights")}>Insights</a>
            <a {...routeLink("engagement")}>Pricing</a>
            <a {...routeLink("privacy")}>Privacy</a>
            <a {...routeLink("terms")}>Terms</a>
            <a {...routeLink("support")}>Support</a>
            <a {...routeLink("demo")}>Demo</a>
            <a {...routeLink("request-access")}>Request access</a>
            <a {...routeLink("connect")}>Connect</a>
            <a {...routeLink("claude")}>Claude</a>
            <a {...routeLink("contact")}>Contact</a>
          </div>
          <small>© {new Date().getFullYear()} UnwhelmNet</small>
        </div>
      </footer>
    </div>
    </CatalogPriceContext.Provider>
  );
}

function Breadcrumbs({
  page,
  routeLink,
}: {
  page: Page;
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  const items = pageAncestry(page).map((item) => ({ page: item, label: breadcrumbLabels[item] ?? item }));

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <div className="container breadcrumbs-inner">
        <a {...routeLink("home")}>Home</a>
        {items.map((item, index) => (
          <span className="breadcrumb-item" key={item.page}>
            <ChevronRight size={14} aria-hidden="true" />
            {index === items.length - 1 ? (
              <span aria-current="page">{item.label}</span>
            ) : (
              <a {...routeLink(item.page)}>{item.label}</a>
            )}
          </span>
        ))}
      </div>
    </nav>
  );
}

function HomePage({
  navigate,
  routeLink,
}: {
  navigate: (page: Page) => void;
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  const prices = useCatalogPrices();
  return (
    <>
      <section className="agent-banner" aria-labelledby="agent-banner-title">
        <div className="container agent-banner-inner">
          <h2 id="agent-banner-title">Run your business on Grok or ChatGPT. We'll connect it to the software you already use.</h2>
          <div className="agent-banner-action">
            <a className="button agent-banner-button" {...routeLink("agent-setup")}>
              Set up my agent
              <ArrowRight size={17} />
            </a>
            <p className="agent-banner-note">Not affiliated with OpenAI or xAI.</p>
            <a className="agent-banner-teaser" {...routeLink("mcp")}>How our MCP server works <ArrowRight size={14} /></a>
          </div>
        </div>
      </section>

      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" />
              SOFTWARE • AI • AUTOMATION • CLOUD
            </div>
            <h1>Build the system between the systems.</h1>
            <p className="hero-lead">
              Senior software and integration engineering for businesses that need APIs,
              automation, AI-assisted applications, and infrastructure to work as one
              coherent system.
            </p>
            <p className="hero-support">
              Your platforms already work. The gaps between them are where people still copy,
              paste, and chase. I connect those systems, automate the handoffs, and stay close
              through deployment, with or without an IT team.
            </p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={() => navigate("videos")}>
                <Play size={17} fill="currentColor" />
                Watch proof of work
              </button>
              <a className="button button-secondary" href="/try" onClick={(event) => { event.preventDefault(); navigate("try"); }}>
                Try the proposal agent
                <ArrowRight size={17} />
              </a>
              <button className="button button-secondary" onClick={() => navigate("contact")}>
                Scope an integration
                <ArrowRight size={17} />
              </button>
            </div>
            <div className="hero-notes">
              <span><ShieldCheck size={16} /> Deterministic guardrails around AI</span>
              <span><Workflow size={16} /> Integration-first architecture</span>
              <span><ServerCog size={16} /> Cloud + on-prem deployment</span>
            </div>
          </div>

          <div className="hero-clip">
            <MotionClip
              src="/assets/clip-live-boundary-map.mp4"
              poster="/assets/video-poster-live-boundary-map.jpg"
              label="Live boundary map animation: SaaS, SQL, AI and deploy nodes connect through a central API. When the workflow is real, but the system is scattered: translate, so APIs, files, forms, and databases agree on meaning; govern, so AI assists the work without becoming the source of truth; ship, so automation survives credentials, failures, logs, and deployment. It ends on an MCP layer: your software, operable by any AI. Same rules. Same logs. Any client: Grok Bot, ChatGPT, Claude, or any MCP-capable app."
              eyebrow="LIVE BOUNDARY MAP"
              title="When the workflow is real, but the system is scattered."
              caption="Translate: APIs, files, forms, and databases agree on meaning. Govern: AI assists the work without becoming the source of truth. Ship: automation survives credentials, failures, logs, and deployment. Your software, operable by any AI. Same rules. Same logs. Any client: Grok Bot, ChatGPT, Claude, or any MCP-capable app."
              captionHidden
              loop={false}
            />
          </div>
        </div>
      </section>

      <section className="guide-banner" aria-labelledby="guide-banner-title">
        <div className="container guide-banner-inner">
          <div className="guide-banner-copy">
            <div className="eyebrow eyebrow-dark"><FileText size={15} /> FREE GUIDE</div>
            <h2 id="guide-banner-title">{whoPaysTitle}</h2>
            <p>The same 40 tasks a month can cost about $0.01 or $60, depending on how the AI is wired. Real numbers for all four approaches.</p>
          </div>
          <a className="button button-primary guide-banner-button" {...routeLink("article-who-pays")}>
            Read the guide
            <ArrowRight size={17} />
          </a>
        </div>
      </section>

      <section className="capability-strip" aria-label="Capabilities">
        <div className="container capability-grid">
          {capabilities.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
        </div>
      </section>

      <section className="scoreboard" aria-label="Proof summary">
        <div className="container score-grid">
          {outcomes.map((item) => (
            <div className="score-card" key={item.label}>
              <strong>{item.kicker}</strong>
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="principles-section" aria-label="Operating principles">
        <div className="container principles-grid">
          <div className="section-heading">
            <div className="eyebrow eyebrow-dark">OPERATING PRINCIPLES</div>
            <h2>How the work is approached.</h2>
            <p>
              The original promise still matters: practical engineering, explicit
              ownership, and AI bounded by application rules.
            </p>
          </div>
          <div className="principle-list">
            {operatingPrinciples.map((principle) => (
              <article key={principle.title}>
                <principle.icon size={19} />
                <div>
                  <h3>{principle.title}</h3>
                  <p>{principle.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="pricing-teaser" aria-label="Pricing">
        <div className="container pricing-teaser-inner">
          <div className="pricing-teaser-copy">
            <div className="eyebrow eyebrow-dark">PRICING</div>
            <h2>Start small, with a clear price.</h2>
            {prices && <p>
              Workflow Check ${prices.workflowCheck} fixed, or Capped Hours from ${prices.capped4.price}.
              {" "}Fixed Price builds from {prices.fixedFrom}.
            </p>}
            {prices && <p className="workflow-check-note">{`$${prices.workflowCheck} gets you a Workflow Check: up to ${pricingCopy.workflowCheckMinutes / 60} hours on one workflow you pick. You get a map of how it works today, the top fixes, and a working prototype or a scoped build plan. If you go ahead within ${pricingCopy.workflowCheckCreditDays} days, the $${prices.workflowCheck} is credited back.`} Big project? We'll check the most valuable slice first and scope the rest into a proposal.</p>}
            {prices && <p className="pricing-small-print">Standard hourly rate: ${prices.hourlyRate}/hr.</p>}
          </div>
          <div className="pricing-teaser-actions">
            <button className="button button-primary" onClick={() => navigate("engagement")}>
              See pricing
              <ArrowRight size={17} />
            </button>
            <button className="button button-secondary" onClick={() => navigate("contact")}>
              Scope an integration
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>

      <section className="home-case-row" aria-labelledby="home-case-row-title">
        <div className="container">
          <div className="eyebrow eyebrow-dark">CASE STUDIES</div>
          <h2 id="home-case-row-title">Selected case studies.</h2>
          <ul className="home-case-grid">
            {(Object.keys(caseStudies) as CaseStudyPage[]).map((key) => (
              <li key={key}>
                <a className="hub-link-card" {...routeLink(key)}>
                  <strong>{caseStudies[key].title}</strong>
                  <span>{pageMeta[key]?.description}</span>
                  <span className="hub-link-cta" aria-hidden="true">Read the case study <ArrowRight size={15} /></span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

type MotionClipProps = { src: string; poster: string; label: string; eyebrow: string; title: string; caption: string; captionHidden?: boolean; loop?: boolean };

function MotionClip({ src, poster, label, eyebrow, title, caption, captionHidden, loop = true }: MotionClipProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReducedMotion(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (reducedMotion) {
      video.pause();
      return;
    }
    video.play().catch(() => undefined);
  }, [reducedMotion]);

  return (
    <figure className={`motion-clip-card ${captionHidden ? "motion-clip-bare" : ""}`}>
      {reducedMotion ? (
        <img className="motion-clip-media" src={poster} alt={label} loading="lazy" />
      ) : (
        <video ref={ref} className="motion-clip-media" autoPlay muted loop={loop} playsInline preload="none" poster={poster} src={src} aria-label={label} />
      )}
      <figcaption className={captionHidden ? "visually-hidden" : "motion-clip-copy"}>
        <span className="card-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{caption}</p>
      </figcaption>
    </figure>
  );
}

type IndustryHeroConfig = {
  eyebrow: string;
  headline: string;
  pain: string;
  caption: string;
  clip?: { src: string; poster: string; label: string };
  diagram?: string[];
  image?: { src: string; alt: string; full?: string };
};

// Shared 40/60 page hero config for industry and service pages.
const industryHeroes: Partial<Record<Page, IndustryHeroConfig>> = {
  "agent-setup": {
    eyebrow: "SERVICES / AGENT SETUP",
    headline: "Your AI agent, connected to our team.",
    pain: "Every client gets a free AI agent. We set up the one you already use and connect it to our MCP server.",
    caption: "Your AI connects over MCP to our Proposal agent, which hands off to the Contract and Project manager agents. Your data stays with you.",
    clip: { src: "/assets/clip-svc-agent-setup.mp4", poster: "/assets/video-poster-svc-agent-setup.jpg", label: "Agent setup animation: ChatGPT, Claude, Grok, Gemini or Mistral on the client side connect over MCP to the Proposal agent, which hands off to the Contract agent (terms, billing) and the Project manager agent (milestones, tasks), ending on: Your AI. Our agents. Your data." },
  },
  "integration": {
    eyebrow: "SERVICES / INTEGRATION",
    headline: "Systems integration with clear ownership.",
    pain: "Your APIs, databases, and SaaS platforms each work on their own, but people still carry data between them. We connect them with clear ownership and failure boundaries.",
    caption: "Connect the systems, then the AI works: one matched record turns scattered data into a work order.",
    clip: { src: "/assets/clip-svc-integration.mp4", poster: "/assets/video-poster-svc-integration.jpg", label: "Integration animation: machine, ERP, and maintenance data on Line 3 are matched, an AI copilot explains why the line is behind, a rules check passes, and work order WO-1042 is created." },
  },
  "vibe-coded": {
    eyebrow: "SERVICES / VIBE-CODED APPS",
    headline: "You vibe-coded it. Now let's ship it for real.",
    pain: "You built something great in Lovable, Bolt, Base44, Replit, or v0. Now it needs to hold up for real users, real data, and real payments. We take it to production without starting over.",
    caption: "Where the app runs today, what we fix, and where it ends up: your repo, CI, staging, production, and a database you control.",
    image: { src: "/assets/vibe-to-production.svg", alt: "Before and after. Today, on the builder: Lovable or Bolt apps on builder hosting with a Supabase project the builder made, or Replit and Base44 apps with the database on their platform; common gaps are keys in the code, tables open to any user, no staging or tests, and backups you don't control. We review and harden secrets, security rules, tests, and the migration. In production, yours: your GitHub repo, CI build and tests, staging, production on a VPS or cloud host, a Supabase or Postgres database you own, and backups with monitoring and rollback." },
  },
  supabase: {
    eyebrow: "SERVICES / SUPABASE",
    headline: "Supabase: one Postgres backend for AI apps.",
    pain: "Sign-in, files, data, and vector search often end up in four services. Supabase puts them on one Postgres database; we set it up, migrate to it, and secure it.",
    caption: "The Supabase stack: one gateway in front of REST, Auth, Realtime, Edge Functions, and Storage, all on Postgres.",
    image: { src: "/assets/supabase-stack-hero.svg", full: "/assets/supabase-stack.svg", alt: "Supabase stack: your frontend and AI agents call one API gateway (Kong or Envoy), which routes to REST with GraphQL, Auth, Realtime, Edge Functions, and Storage. Those reach Postgres, with pgvector and row-level security, through the Supavisor connection pooler; Storage keeps files in S3 with metadata in Postgres; the Studio dashboard manages it all." },
  },
  "ai-solutions": {
    eyebrow: "SERVICES / AI",
    headline: "AI under application controls.",
    pain: "AI is useful until it starts acting as the source of truth. We put retrieval and models to work behind deterministic rules and review.",
    caption: "AI proposes, rules decide: an over-limit refund is rejected, revised, and logged.",
    clip: { src: "/assets/clip-ai-rules-gate.mp4", poster: "/assets/video-poster-ai-rules-gate-end.jpg", label: "Rules gate animation: an AI agent proposes a $1,200 refund, the gate rejects it as over the limit, the revised $450 refund passes, and both decisions are logged." },
  },
  "automation": {
    eyebrow: "SERVICES / AUTOMATION",
    headline: "Data and workflow automation around the systems you already use.",
    pain: "Reports, exports, and handoffs still run on someone's afternoon. We automate them around the platforms you already depend on.",
    caption: "From demo to production: retries, auth, logging, evals, and deploy.",
    clip: { src: "/assets/clip-svc-automation-v2.mp4", poster: "/assets/video-poster-svc-automation-v2.png", label: "Automation animation: the demo pipeline runs, but production is not ready until the checklist (retries, auth, logging, evals, deploy) is complete, ending on: From demo to production." },
  },
  "platforms": {
    eyebrow: "SERVICES / INFRASTRUCTURE",
    headline: "Platform boundaries made explicit.",
    pain: "Cloud, database, and on-prem systems drift when nobody owns the boundary. We make ownership and data flow explicit.",
    caption: "Runs on infrastructure you own: git push, Docker build, TLS reverse proxy, VPS.",
    clip: { src: "/assets/clip-svc-infrastructure-v2.mp4", poster: "/assets/video-poster-svc-infrastructure-v2.png", label: "Infrastructure animation: a deploy path from git push through Docker build and a TLS reverse proxy to a VPS, with health checks passing, ending on: Runs on infrastructure you own." },
  },
  "web-design": {
    eyebrow: "SERVICES / WEB DESIGN",
    headline: "Modern web applications that fit the workflow.",
    pain: "The spreadsheet that runs the business has outgrown itself. We build the application around the work people actually do.",
    caption: "From spreadsheet to production app: a modern stack, shipped and running.",
    clip: { src: "/assets/clip-svc-web.mp4", poster: "/assets/video-poster-svc-web.jpg", label: "Web app animation: a spreadsheet becomes a live production dashboard showing revenue, active users, and uptime across web, mobile, and cloud." },
  },
  "10x-team": {
    eyebrow: "SERVICES / 10X TEAM",
    headline: "Pick the team that knows how to use coding agents.",
    pain: "Ten times the coverage only works when seasoned builders direct the agents, review the output, and keep the system coherent.",
    caption: "Proposal accepted. Your team, spun up: persistent agents pick up the work and ship it.",
    clip: { src: "/assets/clip-svc-10x-team-v2.mp4", poster: "/assets/video-poster-svc-10x-team-v2.png", label: "10x team animation: a proposal is accepted and a team of persistent agents (developers, a PM, a graphic designer, QA) picks up tasks and ships them, ending on: Proposal accepted. Your team, spun up." },
  },
  "real-estate": {
    eyebrow: "INDUSTRIES / REAL ESTATE",
    headline: "Property-management integrations that remove manual reconciliation.",
    pain: "Your team already pays for AppFolio or Propertyware, yet move-outs, vendors, and reports still get reconciled by hand. One slipped date should not mean five manual updates.",
    caption: "Move-out to move-in: one slipped dependency, every downstream date updates.",
    clip: { src: "/assets/clip-vacancy-turnover.mp4", poster: "/assets/video-poster-vacancy-turnover-end.jpg", label: "Move-out turnover timeline animation" },
  },
  "real-estate-property-managers": {
    eyebrow: "REAL ESTATE / PROPERTY MANAGERS",
    headline: "Automate the work around AppFolio or Propertyware.",
    pain: "Leasing, maintenance, documents, and reporting all cross system boundaries, and small teams fill the gaps by hand.",
    caption: "Move-out to move-in: one slipped dependency, every downstream date updates.",
    clip: { src: "/assets/clip-vacancy-turnover.mp4", poster: "/assets/video-poster-vacancy-turnover-end.jpg", label: "Move-out turnover timeline animation" },
  },
  "real-estate-brokerages": {
    eyebrow: "REAL ESTATE / BROKERAGES",
    headline: "Make buyer and seller workflows agree with the listing data.",
    pain: "Listing data, buyer and seller workflows, and documents drift apart across Zillow, MLS, and your own tools.",
    caption: "MLS and RESO listing data feeding buyer and seller workflows from one source.",
    diagram: ["MLS + RESO", "Listing data", "Buyer + seller workflows"],
  },
  "real-estate-institutional-investors": {
    eyebrow: "REAL ESTATE / INSTITUTIONAL INVESTORS",
    headline: "Make portfolio data usable across the business.",
    pain: "Portfolio data sits in property systems that do not agree, so every new dashboard becomes another reconciliation job.",
    caption: "Property systems feed a governed warehouse and API, which feeds portfolio dashboards.",
    diagram: ["Property systems", "Warehouse + API", "Portfolio dashboards"],
  },
  legal: {
    eyebrow: "INDUSTRIES / LEGAL",
    headline: "Connect matter workflows without losing control of the record.",
    pain: "Intake, documents, billing, and reporting live in different tools, so staff retype the same matter details. We connect them while the record stays governed.",
    caption: "Intake, documents, and billing connected around one governed matter record.",
    diagram: ["Intake", "Matter record", "Billing + reporting"],
  },
  healthcare: {
    eyebrow: "INDUSTRIES / HEALTHCARE",
    headline: "Connect the operational work around the record.",
    pain: "Scheduling, referrals, billing, and documents cross systems, and every handoff is a chance for something to be missed.",
    caption: "Scheduling, referrals, and billing handoffs connected with review built in.",
    diagram: ["Scheduling", "Referrals", "Billing + documents"],
  },
  financial: {
    eyebrow: "INDUSTRIES / FINANCIAL",
    headline: "Make the GL inspectable, then put the exceptions on a list.",
    pain: "The books already exist. Ops still cannot see why card spend, sub-accounts, and two property GLs do not agree.",
    caption: "Mainframe and GL stay; the new money path and the console sit beside them.",
    diagram: ["AS/400 + GL", "SQL + rails", "Console + exceptions"],
  },
};

type NextStepCopy = { eyebrow: string; headline: string; body: string };
const defaultNextStep: NextStepCopy = {
  eyebrow: "NEXT STEP",
  headline: "Start with the workflow that costs people time.",
  body: "Bring the process, the systems it touches, and the decision you want to make faster. We will help define the smallest useful build.",
};
const nextStepCopy: Partial<Record<Page, NextStepCopy>> = {
  "agent-setup": { eyebrow: "Next step", headline: "Tell us which AI you use.", body: "We'll confirm the right plan before setup." },
  "ai-solutions": { eyebrow: "Next step: an AI fit check", headline: "Ready to put AI to work under real rules?", body: "Bring one workflow; we'll show where AI helps and where rules must decide." },
  "vibe-coded": { eyebrow: "Next step: a production review", headline: "Built it with AI? Let's get it production-ready.", body: "Send the app link or the repo; we'll list what's ready, what's risky, and the shortest path to launch." },
  supabase: { eyebrow: "Next step: a database review", headline: "Moving to Supabase or starting fresh?", body: "Bring the current schema or the app idea; we'll map the migration, the security rules, and the smallest useful build." },
  integration: { eyebrow: "Next step: map one integration", headline: "Which two systems should finally agree?", body: "Bring the two systems; we'll sketch the boundary and the smallest useful build." },
  "ai-economics": { eyebrow: "Next step: a cost-and-value check", headline: "Want to know whether the AI spend pays off?", body: "Bring one workflow; we'll show where AI earns its keep." },
  automation: { eyebrow: "Next step: pick the first handoff", headline: "Which manual step should stop being manual?", body: "Bring the repetitive task your team dreads; we'll show what can run on rules and what still needs a person." },
  "web-design": { eyebrow: "Next step: a screen-by-screen walk", headline: "Need an app people can actually use?", body: "Bring the workflow and the people who do it; we'll sketch the screens around the real work." },
  platforms: { eyebrow: "Next step: a platform fit check", headline: "How does this fit the platforms you already run?", body: "Bring the tools you use today; we'll show where an integration helps and where it adds nothing." },
  "real-estate": { eyebrow: "Next step: a property-ops walkthrough", headline: "Where does your team still re-key data?", body: "Bring the AppFolio or Propertyware workflow that slows you down; we'll map the smallest fix." },
  legal: { eyebrow: "Next step: a matter-workflow review", headline: "Where do matter details get typed twice?", body: "Bring one intake, document, or billing handoff; we'll show how to connect it without loosening control of the record." },
  healthcare: { eyebrow: "Next step: an operations handoff review", headline: "Which handoff around the record keeps slipping?", body: "Bring one scheduling, referral, or billing step; we'll show what can be connected and where review belongs." },
  financial: { eyebrow: "Next step: a GL walkthrough", headline: "Which mismatch shows up every week?", body: "Bring the GL, the card feed, or the two charts of accounts. We will sketch the explorer, the warehouse pull, or the mapping — not a second set of books." },
  "case-studies": { eyebrow: "Next step: compare it to your problem", headline: "Seen a case that looks like yours?", body: "Bring the workflow it reminded you of; we'll talk through what carries over and what doesn't." },
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function IndustryHero({ page, navigate }: { page: Page; navigate: (page: Page) => void }) {
  const config = industryHeroes[page];
  const ref = useRef<HTMLVideoElement>(null);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (reducedMotion) { video.pause(); return; }
    video.play().catch(() => undefined);
  }, [reducedMotion, page]);
  useClipRest(ref, config?.clip?.src, !reducedMotion);
  if (!config) return null;
  const captionId = `industry-hero-caption-${page}`;

  return (
    <section className="hero industry-hero" aria-label={config.eyebrow}>
      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="eyebrow eyebrow-dark">{config.eyebrow}</div>
          <h1>{config.headline}</h1>
          <p className="hero-lead">{config.pain}</p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={() => navigate("contact")}>
              Scope an integration
              <ArrowRight size={17} />
            </button>
            <button className="button button-secondary" onClick={() => navigate("engagement")}>
              See pricing
            </button>
          </div>
        </div>
        <div className="hero-clip">
          <figure className="motion-clip-card motion-clip-bare industry-hero-figure">
            {config.clip && !reducedMotion ? (
              <video
                key={config.clip.src}
                ref={ref}
                className="motion-clip-media"
                autoPlay
                muted
                playsInline
                loop={false}
                preload="metadata"
                poster={config.clip.poster}
                src={config.clip.src}
                aria-label={config.clip.label}
                aria-describedby={captionId}
              />
            ) : config.clip ? (
              <img className="motion-clip-media" src={config.clip.poster} alt={config.clip.label} aria-describedby={captionId} />
            ) : config.image ? (
              <a href={config.image.full ?? config.image.src} target="_blank" rel="noopener" aria-label="Open the full diagram">
                <img className="motion-clip-media" src={config.image.src} alt={config.image.alt} aria-describedby={captionId} />
              </a>
            ) : (
              <div className="motion-clip-media industry-hero-diagram" role="img" aria-label={config.diagram?.join(" to ")} aria-describedby={captionId}>
                {config.diagram?.map((node, index) => (
                  <span className="industry-hero-node-wrap" key={node}>
                    {index > 0 && <ArrowRight size={18} aria-hidden="true" />}
                    <span className="industry-hero-node">{node}</span>
                  </span>
                ))}
              </div>
            )}
            <figcaption id={captionId} className="industry-hero-caption">{config.caption}</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}

function CaseTableView({ table, caption }: { table: CaseStudy["results"]; caption: string }) {
  return (
    <div className="case-table-wrap" role="region" aria-label={`${caption} table`} tabIndex={0}>
      <table className="case-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>{table.columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => index === 0 ? <th scope="row" key={index}>{cell}</th> : <td key={index}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Real PDF briefs live in public/case-studies/<slug>.pdf (the @media print styles still cover manual printing).
function caseStudyPdfPath(slug: string) {
  return `/case-studies/${slug}.pdf`;
}

function CaseStudyDetail({ study, navigate }: { study: CaseStudy; navigate: (page: Page) => void }) {
  const glance: [string, string][] = [
    ["Client type", study.glance.clientType],
    ["Problem", study.glance.problem],
    ["Stack", study.glance.stack],
    ["Outcome", study.glance.outcome],
  ];

  return (
    <article className="section case-study-page route-section">
      <div className="container">
        <header className="case-study-header">
          <div className="eyebrow eyebrow-dark"><FileSearch size={15} /> {study.eyebrow}</div>
          <h1>{study.title}</h1>
          <p className="case-study-lead">{study.lead}</p>
          <a className="button button-secondary case-study-print" href={caseStudyPdfPath(study.slug)} download={`${study.slug}.pdf`}>
            <FileText size={16} /> Download PDF
          </a>
        </header>

        <dl className="case-glance" aria-label="At a glance">
          {glance.map(([term, value]) => (
            <div key={term}><dt>{term}</dt><dd>{value}</dd></div>
          ))}
        </dl>

        <section className="case-block split-layout split-layout--narrow" aria-labelledby="case-challenge">
          <h2 className="split-aside" id="case-challenge">Challenge</h2>
          <div className="split-main">
          <ul className="case-list">
            {study.challenge.map((item) => <li key={item}><CheckCircle2 size={16} /> {item}</li>)}
          </ul>
          </div>
        </section>

        <section className="case-block split-layout split-layout--narrow" aria-labelledby="case-solution">
          <h2 className="split-aside" id="case-solution">Solution</h2>
          <div className="split-main">
          <div className="case-solution-grid">
            {study.solution.map((part) => (
              <div className="case-solution-part" key={part.title}>
                <h3>{part.title}</h3>
                {part.intro && <p>{part.intro}</p>}
                <ul className="case-list">
                  {part.bullets.map((bullet) => <li key={bullet}><CheckCircle2 size={16} /> {bullet}</li>)}
                </ul>
              </div>
            ))}
          </div>
          </div>
        </section>

        <section className="case-block split-layout split-layout--narrow" aria-labelledby="case-results">
          <h2 className="split-aside" id="case-results">Results</h2>
          <div className="split-main">
          <CaseTableView table={study.results} caption="Results before and after" />
          {study.resultsNote && <p className="case-note">{study.resultsNote}</p>}
          </div>
        </section>

        <section className="case-block split-layout split-layout--narrow" aria-labelledby="case-benefits">
          <h2 className="split-aside" id="case-benefits">Benefits</h2>
          <div className="split-main">
          <div className="case-benefits">
            {study.benefits.map((benefit) => (
              <div key={benefit.title}><h3>{benefit.title}</h3><p>{benefit.text}</p></div>
            ))}
          </div>
          </div>
        </section>

        <section className="case-block split-layout split-layout--narrow" aria-labelledby="case-tech">
          <h2 className="split-aside" id="case-tech">Technical highlights</h2>
          <div className="split-main">
          <CaseTableView table={study.tech} caption="Technical highlights" />
          </div>
        </section>

        <p className="case-conclusion">{study.conclusion}</p>

        <div className="parity-next-panel">
          <div>
            <span className="card-eyebrow">{study.cta.eyebrow}</span>
            <h2>{study.cta.headline}</h2>
            <p>{study.cta.body}</p>
          </div>
          <button className="button button-primary" onClick={() => navigate("contact")}>Start a project <ArrowRight size={16} /></button>
        </div>
      </div>
    </article>
  );
}

// The banner reuses the article's full title from the Insights registry.
const whoPaysTitle = findInsightsArticle("article-who-pays")!.fullTitle;

const agentSetupFaq = [
  { question: "Which agents work?", answer: "ChatGPT, Claude, Grok, Gemini or Mistral. ChatGPT Plus and Grok are tested; Claude, Gemini and Mistral connect on supported plans. You can also connect from any MCP-capable app." },
  { question: "Do I need a paid plan?", answer: "Usually yes. ChatGPT needs Plus, Claude Free allows one connector (Pro is $20/mo), Gemini needs Google AI Pro, Grok and Mistral work on any plan." },
  { question: "Will I get an API bill?", answer: "Model and API usage stays on your account, with your AI provider." },
];

function AgentSetupPage({ navigate }: { navigate: (page: Page) => void }) {
  const nextStep = nextStepCopy["agent-setup"] ?? defaultNextStep;
  return (
    <>
      <IndustryHero page="agent-setup" navigate={navigate} />
      <section className="section agent-setup-page route-section">
        <div className="container">
          <section className="agent-block" aria-labelledby="agent-how">
            <h2 id="agent-how">How it works</h2>
            <ol className="agent-steps">
              <li><strong>You use your agent.</strong><span>The AI you already use, set up for you.</span></li>
              <li><strong>It talks to ours.</strong><span>Connected to our MCP server.</span></li>
              <li><strong>Our people step in whenever needed.</strong><span>A human is always available.</span></li>
            </ol>
          </section>

          <section className="agent-block" aria-labelledby="agent-ours">
            <h2 id="agent-ours">Our agents</h2>
            <p className="agent-lead">Chat with our proposal agent first to make the most of your time with our people.</p>
            <div className="agent-cards">
              <article><h3>Proposal agent</h3><p>Drafts your proposal with you, anytime, before or after the free 30-minute consult.</p></article>
              <article><h3>Contract agent</h3><p>When you accept a proposal, it handles the contract, terms and billing.</p></article>
              <article><h3>Project manager agent</h3><p>When you accept a proposal, it turns it into a project.</p></article>
            </div>
            <p className="case-note">Once work is underway, you can talk to either agent.</p>
          </section>

          <section className="agent-block" aria-labelledby="agent-why">
            <h2 id="agent-why">Why your own agent</h2>
            <p>You keep the full conversation history and control of your data, not locked inside someone else's system.</p>
          </section>

          <section className="agent-block agent-connect" aria-labelledby="agent-connect">
            <h2 id="agent-connect">Already know MCP? Here's how to connect to our agent.</h2>
            <ol className="agent-connect-steps">
              <li>Add a custom MCP connector in your AI app.</li>
              <li>Enter our server address: <code>https://mcp.unwhelm.net/mcp</code> <strong className="agent-ready">Ready for Grok.</strong></li>
              <li>Complete the OAuth sign-in.</li>
            </ol>
            <p className="case-note">You can also connect from any MCP-capable app.</p>
          </section>

          <div className="agent-two-col">
            <section className="agent-block" aria-labelledby="agent-included">
              <h2 id="agent-included">What's included</h2>
              <ul className="case-list">
                <li><CheckCircle2 size={16} /> One agent configured</li>
                <li><CheckCircle2 size={16} /> The MCP connection installed</li>
                <li><CheckCircle2 size={16} /> A walkthrough</li>
              </ul>
            </section>
            <section className="agent-block" aria-labelledby="agent-pay">
              <h2 id="agent-pay">What you pay for</h2>
              <p>You bring your own AI plan (see the FAQ below for which plans work). We'll confirm the right plan before setup. Model and API usage stays on your account.</p>
              <p className="article-teaser">Weighing who pays for the AI? Read <a {...routeLink("article-who-pays", navigate)}>Who Pays for the AI? Four ways to add AI, and what each costs</a>.</p>
            </section>
          </div>

          <div className="parity-faq" aria-labelledby="agent-setup-faq-title">
            <div className="section-heading">
              <div>
                <div className="eyebrow eyebrow-dark"><MessageSquareCode size={15} /> QUESTIONS</div>
                <h2 id="agent-setup-faq-title">Agent setup FAQ</h2>
              </div>
            </div>
            <div className="parity-faq-grid">
              {agentSetupFaq.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}<ChevronRight size={17} /></summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>

          <div className="parity-next-panel">
            <div>
              <span className="card-eyebrow">{nextStep.eyebrow}</span>
              <h2>{nextStep.headline}</h2>
              <p>{nextStep.body}</p>
            </div>
            <button className="button button-primary" onClick={() => navigate("contact")}>Start a project <ArrowRight size={16} /></button>
          </div>
        </div>
      </section>
    </>
  );
}

function ParityPage({ page, navigate }: { page: Page; navigate: (page: Page) => void }) {
  const content = parityPages[page];
  if (!content) return null;

  const hero = industryHeroes[page];
  const nextStep = nextStepCopy[page] ?? defaultNextStep;
  const showClip = !!content.clip && !(hero?.clip && hero.clip.src === content.clip.src);
  const split = compactPages.has(page) && !!hero;

  return (
    <>
    {hero && <IndustryHero page={page} navigate={navigate} />}
    <section className="section parity-section route-section">
      <div className={split ? "container split-layout" : "container"}>
        {hero ? (
          <p className={split ? "industry-intro split-aside" : "industry-intro"}>{content.intro}</p>
        ) : (
          <div className="section-heading heading-split">
            <div>
              <div className="eyebrow eyebrow-dark"><Route size={15} /> {content.eyebrow}</div>
              <h1>{content.title}</h1>
            </div>
            <p>{content.intro}</p>
          </div>
        )}

        {page === "ai-economics" && (
          <p className="article-teaser">New article: <a {...routeLink("article-who-pays", navigate)}>Who Pays for the AI? Four ways to add AI to your business, and what each one costs</a>.</p>
        )}

        {showClip && <MotionClip {...content.clip!} />}

        <div className={`parity-grid parity-grid-${content.cards.length}${split && !showClip && page !== "ai-economics" ? " split-main" : ""}`}>
          {content.cards.map((card) => (
            <article className="parity-card" key={card.title}>
              <h2>{card.title}</h2>
              <p>{card.text}</p>
              <ul>
                {card.bullets.map((bullet) => (
                  <li key={bullet}><CheckCircle2 size={16} /> {bullet}</li>
                ))}
              </ul>
              {card.link && (
                <a className="parity-card-link" {...routeLink(card.link.page, navigate)}>
                  {card.link.label} <ArrowRight size={15} />
                </a>
              )}
              {card.pdf && (
                <a className="parity-card-link parity-card-pdf" href={caseStudyPdfPath(routeByPage[card.pdf].split("/").pop()!)} download={`${routeByPage[card.pdf].split("/").pop()}.pdf`}>
                  Download PDF <FileText size={15} />
                </a>
              )}
            </article>
          ))}
        </div>

        {content.more?.map((section) => (
          <section className="parity-more" key={section.title} aria-label={section.title}>
            <div className="section-heading heading-split">
              <div>
                <div className="eyebrow eyebrow-dark"><Route size={15} /> {section.eyebrow}</div>
                <h2>{section.title}</h2>
              </div>
              <p>{section.intro}</p>
            </div>
            <div className={`parity-grid parity-grid-${section.cards.length}`}>
              {section.cards.map((card) => (
                <article className="parity-card" key={card.title}>
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                  <ul>
                    {card.bullets.map((bullet) => (
                      <li key={bullet}><CheckCircle2 size={16} /> {bullet}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        ))}

        {hubChildren[page] && <HubLinks parent={page} routeLink={(target) => routeLink(target, navigate)} />}

        {content.proof && (
          <div className="parity-proof-panel">
            <span className="card-eyebrow">MEASURED OUTCOME</span>
            <h2>{content.proof.title}</h2>
            <p>{content.proof.text}</p>
          </div>
        )}

        {content.faq && (
          <div className="parity-faq" aria-labelledby={`${page}-faq-title`}>
            <div className="section-heading">
              <div>
                <div className="eyebrow eyebrow-dark"><MessageSquareCode size={15} /> QUESTIONS WE ANSWER EARLY</div>
                <h2 id={`${page}-faq-title`}>What buyers usually need to know.</h2>
              </div>
            </div>
            <div className="parity-faq-grid">
              {content.faq.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}<ChevronRight size={17} /></summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        )}

        <div className="parity-next-panel">
          <div>
            <span className="card-eyebrow">{nextStep.eyebrow}</span>
            <h2>{nextStep.headline}</h2>
            <p>{nextStep.body}</p>
          </div>
          <button className="button button-primary" onClick={() => navigate("contact")}>Start a project <ArrowRight size={16} /></button>
        </div>
      </div>
    </section>
    </>
  );
}

function routeLink(page: Page, navigate: (page: Page) => void) {
  return {
    href: routeByPage[page],
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(page);
    },
  };
}

function InstitutionalInvestorsPage({
  routeLink,
  navigate,
}: {
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
  navigate: (page: Page) => void;
}) {
  return (
    <>
    <IndustryHero page="real-estate-institutional-investors" navigate={navigate} />
    <section className="section institutional-page route-section">
      <div className="container">
        <div className="industry-intro-block">
          <p className="industry-intro">
            Institutional teams rarely need another isolated dashboard. They need a dependable path between property systems, a governed data repository, APIs, and the people making portfolio decisions.
          </p>
        </div>

        <div className="institutional-proof-grid">
          <div className="institutional-video-card">
            <div className="institutional-video-label">TECHNICAL WALKTHROUGH</div>
            <video controls preload="none" poster="/assets/video-poster-vector.svg" playsInline src={demos[0].source} aria-label="Vector search with SQL Server">
              <track kind="captions" src={demos[0].captions} srcLang="en" label="English captions" default />
              Your browser does not support the video tag.
            </video>
            <div className="institutional-video-copy">
              <span className="card-eyebrow">VECTOR SEARCH WITH SQL SERVER</span>
              <h2>See the repository and retrieval path while it runs.</h2>
              <p>Embeddings, semantic retrieval, deterministic filters, and a hybrid SQL + Python implementation built around structured data.</p>
            </div>
          </div>

          <div className="institutional-flow-panel">
            <span className="card-eyebrow">TWO-WAY DATA FLOW</span>
            <h2>One operating view, with ownership kept visible.</h2>
            <div className="institutional-flow">
              <div><strong>Property systems</strong><span>Leasing, accounting, maintenance, and source records</span></div>
              <ArrowRight size={18} />
              <div><strong>Repository + API</strong><span>Normalized data, contracts, permissions, and retrieval</span></div>
              <ArrowRight size={18} />
              <div><strong>Dashboards + actions</strong><span>Portfolio views, exceptions, decisions, and approved updates</span></div>
            </div>
            <p className="institutional-flow-note">The same boundary carries approved changes back to the system that owns the record, so a dashboard does not quietly become a second ledger.</p>
          </div>
        </div>

        <div className="institutional-results">
          <div>
            <span className="card-eyebrow">PROPERTY MANAGEMENT / RENTFINDER</span>
            <h2>A measurable workflow is better proof than a platform promise.</h2>
          </div>
          <p>Business Software Architect work for a multi-state property-management firm from 2022–2025 included the RentFinder CMA platform. One automated vacancy-pricing workflow reduced decision time from 3–6 hours to 10–20 minutes with structured data, retrieval, and human review.</p>
        </div>

        <div className="institutional-next-grid">
          <article><span className="card-eyebrow">UNIFIED DASHBOARDS</span><h2>Give operators the context they need.</h2><p>Bring current portfolio data together around questions people already ask, with exceptions and source ownership visible beside the answer.</p></article>
          <article><span className="card-eyebrow">GOVERNED INTEGRATION</span><h2>Keep actions inside the right system.</h2><p>Authentication, permissions, validation, and audit trails belong at the service boundary before an update is allowed through.</p></article>
        </div>

        <div className="parity-next-panel">
          <div>
            <span className="card-eyebrow">REAL ESTATE PATHS</span>
            <h2>Choose the workflow closest to the pressure.</h2>
            <p>Start with institutional data, property-management automation, or brokerage workflows. The first conversation narrows the boundary before custom work gets expensive.</p>
          </div>
          <div className="institutional-actions">
            <a className="button button-secondary" {...routeLink("real-estate-property-managers")}>Property managers <ArrowRight size={16} /></a>
            <a className="button button-secondary" {...routeLink("real-estate-brokerages")}>Brokerages <ArrowRight size={16} /></a>
            <button className="button button-primary" onClick={() => navigate("contact")}>Start a project <ArrowRight size={16} /></button>
          </div>
        </div>
      </div>
    </section>
    </>
  );
}


function ProofPage({
  activeDemo,
  setActiveDemoId,
  eyebrow = "PROOF BEFORE CLAIMS",
  title = "Watch the engineering, then judge the fit.",
  description = "Working technical walkthroughs expose the architecture while it runs: AI, data, integration, APIs, and deployment details instead of a vague services pitch.",
  agentLink,
}: {
  activeDemo: Demo;
  setActiveDemoId: (id: string) => void;
  eyebrow?: string;
  title?: string;
  description?: string;
  agentLink?: { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  return (
    <section className="section proof-section route-section">
      <div className="container">
        <div className="section-heading heading-split">
          <div>
            <div className="eyebrow eyebrow-dark"><Video size={15} /> {eyebrow}</div>
            <h1>{title}</h1>
          </div>
          <p>
            {description}
          </p>
        </div>

        <div className="demo-browser">
          <div className="demo-list" role="tablist" aria-label="Technical demonstrations">
            {demos.map((demo) => (
              <button
                key={demo.id}
                className={demo.id === activeDemo.id ? "demo-tab active" : "demo-tab"}
                onClick={() => setActiveDemoId(demo.id)}
                role="tab"
                aria-selected={demo.id === activeDemo.id}
              >
                <span className="demo-kicker">{demo.kicker}</span>
                <strong>{demo.title}</strong>
                <span>{demo.description}</span>
                <small>{demo.duration}</small>
              </button>
            ))}
          </div>

          <div className="demo-player-card">
            <div className="player-frame">
              <video
                key={activeDemo.source}
                controls
                preload="none"
                poster={activeDemo.poster}
                playsInline
                src={activeDemo.source}
                aria-label={activeDemo.title}
                onPlay={() => trackEvent("Video Played", { video: activeDemo.id })}
              >
                <track kind="captions" src={activeDemo.captions} srcLang="en" label="English captions" default />
                Your browser does not support the video tag.
              </video>
            </div>
            <div className="player-copy">
              <ul>
                {activeDemo.bullets.map((bullet) => (
                  <li key={bullet}><CheckCircle2 size={17} /> {bullet}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="section-footnote">
          <span>
            These players stream the existing UnwhelmNet MP4 assets while local
            copies are staged for the replacement deployment.
          </span>
          {agentLink && (
            <a href={agentLink.href} onClick={agentLink.onClick}>
              AI agents
              <ArrowRight size={16} />
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function RouteBoard({ navigate }: { navigate: (page: Page) => void }) {
  return (
    <section className="home-directory" aria-label="Site sections">
      <div className="container">
        <div className="section-heading">
          <div className="eyebrow eyebrow-dark">ROUTE BOARD</div>
          <h2>Choose the evidence trail you want to inspect.</h2>
        </div>
        <div className="directory-grid">
          {routeGroups.map((group) => (
            <article className="directory-card" key={group.label}>
              <span className="directory-icon"><group.icon size={22} /></span>
              <span className="directory-copy">
                <strong>{group.label}</strong>
                <span>{group.text}</span>
              </span>
              <ul className="directory-routes">
                {group.pages.map((pageId) => {
                  const link = pageLinks.find((item) => item.page === pageId);
                  if (!link) return null;
                  return (
                    <li key={link.page}>
                      <button type="button" onClick={() => navigate(link.page)}>
                        <link.icon size={15} />
                        {link.label}
                        <ArrowRight size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkPage({ navigate, hub }: { navigate: (page: Page) => void; hub?: ReactNode }) {
  return (
    <>
    <section className="section work-section route-section">
      <div className="container">
        <div className="section-heading">
          <div className="eyebrow eyebrow-dark"><Sparkles size={15} /> SELECTED WORK</div>
          <h1>Selected work with the problem left in.</h1>
          <p>
            Selected work is ordered by where the practice is deepest: real estate,
            then law, then healthcare. Each case keeps the messy middle visible:
            what was broken, what shipped, and what a buyer can inspect.
          </p>
        </div>

        {hub}

        <div className="work-grid case-file-grid">
          {work.map((item, index) => (
            <article className={index === 0 ? "work-card work-card-featured" : "work-card"} key={item.title}>
              <div className="case-rail" aria-label="Case file metadata">
                <FileSearch size={18} />
                <span>Case file</span>
                <strong>{item.links.length} {item.links.length === 1 ? "ref" : "refs"}</strong>
              </div>
              <div className="work-content">
                <div className="case-file-header">
                  <span className="card-eyebrow">{item.eyebrow}</span>
                  <span className="case-status">Inspectable artifact</span>
                </div>
                <h2>{item.title}</h2>
                <p className="work-summary">{item.summary}</p>
                <div className="work-matrix">
                  <div>
                    <h3>Boundary problem</h3>
                    <p>{item.problem}</p>
                  </div>
                  <div>
                    <h3>Evidence</h3>
                    <p>{item.proof}</p>
                  </div>
                </div>
                <div className="shipped-panel">
                  <h3>What shipped</h3>
                  <ul>
                    {item.shipped.map((detail) => (
                      <li key={detail}><CheckCircle2 size={16} /> {detail}</li>
                    ))}
                  </ul>
                </div>
                <div className="work-links">
                  {item.links.map((link) => {
                    const linkedPage = (Object.entries(routeByPage).find(([, path]) => path === link.href)?.[0] ?? undefined) as Page | undefined;
                    return (
                      <a
                        href={link.href}
                        target={linkedPage ? undefined : "_blank"}
                        rel={linkedPage ? undefined : "noreferrer"}
                        key={link.label}
                        onClick={(event) => {
                          if (!linkedPage || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                            return;
                          }

                          event.preventDefault();
                          navigate(linkedPage);
                        }}
                      >
                        {link.icon === "github" ? <Github size={16} /> : <ExternalLink size={16} />}
                        {link.label}
                      </a>
                    );
                  })}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
    <RouteBoard navigate={navigate} />
    </>
  );
}

function ServicesPage({
  navigate,
  routeLink,
}: {
  navigate: (page: Page) => void;
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  return (
    <section className="section services-section route-section">
      <div className="container">
        <div className="section-heading heading-split">
          <div>
            <div className="eyebrow eyebrow-dark">SERVICES</div>
            <h1>Not a stack. A set of boundary problems.</h1>
          </div>
          <p>
            Technical capability, stated plainly. The focus is not selling a stack;
            it is making independently designed systems cooperate reliably enough
            to support the business workflow.
          </p>
        </div>

        <HubLinks parent="services" routeLink={routeLink} />

                <section className="ai-guidance" aria-labelledby="ai-guidance-title">
          <div className="ai-guidance-heading">
            <div>
              <span className="card-eyebrow">HOW WE USE AI</span>
              <h2 id="ai-guidance-title">AI works best like a junior team with precise instructions.</h2>
            </div>
            <p>
              The leverage comes from knowing how to describe software: the interface, the materials, the constraints, the tests, and where each piece belongs. We guide each creation and assembly step, then review the result like engineers.
            </p>
          </div>
          <div className="ai-build-compare">
            <article className="ai-build-card vague">
              <span className="ai-build-label">VAGUE REQUEST</span>
              <h3>“Build me a house.”</h3>
              <p>The builder has to invent the floor plan, materials, load ratings, sequence, and definition of done. You see the mistakes late, when they are expensive to change.</p>
            </article>
            <div className="ai-build-arrow" aria-hidden="true"><ArrowRight size={22} /></div>
            <article className="ai-build-card precise">
              <span className="ai-build-label">ENGINEERED REQUEST</span>
              <h3>“Build me a joist.”</h3>
              <p>Use this specification, this wood, these ratings, and place ten of them in these three spots. Inspect each component, then assemble the structure against the plan.</p>
            </article>
          </div>
          <div className="ai-software-translation">
            <strong>In software, that means:</strong>
            <span>define the schema</span><i>→</i><span>generate one bounded module</span><i>→</i><span>run the tests</span><i>→</i><span>review the assembly</span>
          </div>
        </section>

        <section className="llm-fit-panel" aria-labelledby="llm-fit-title">
          <div className="llm-fit-heading">
            <div>
              <span className="card-eyebrow">WHERE LLMS FIT</span>
              <h2 id="llm-fit-title">LLMs are excellent at some work and unreliable at other work.</h2>
            </div>
            <p>
              A lot of the industry’s effort and investment has gone into closing that gap: give the model better context, better tools, structured outputs, tests, and boundaries so its strengths are useful without asking it to be the system of record.
            </p>
          </div>
          <div className="llm-fit-grid">
            <article className="llm-fit-card strength">
              <span className="llm-fit-label">NATURAL STRENGTHS</span>
              <h3>Language, patterns, and possibilities.</h3>
              <ul>
                <li>Draft, summarize, classify, translate, and rephrase</li>
                <li>Find patterns across messy text and explain alternatives</li>
                <li>Generate many plausible starting points quickly</li>
                <li>Turn a clear specification into code, queries, or test cases</li>
              </ul>
            </article>
            <article className="llm-fit-card boundary">
              <span className="llm-fit-label">PRIMARY WEAKNESSES</span>
              <h3>Reliable state, facts, and long chains of action.</h3>
              <ul>
                <li>They can sound certain while being wrong or under-specified</li>
                <li>They do not own permissions, transactions, or business truth</li>
                <li>Long multi-step plans can drift without checkpoints and tests</li>
                <li>They need current context instead of assuming memory is enough</li>
              </ul>
            </article>
          </div>
          <div className="llm-business-impact">
            <strong>Why businesses feel this immediately</strong>
            <p>
              A wrong sentence in a brainstorm is cheap. A wrong answer in a pricing recommendation, a missing permission check, a duplicate transaction, or a stale customer record is an operational problem. Business workflows carry money, commitments, private data, and audit obligations, so a model that is merely plausible is not reliable enough to run the process by itself.
            </p>
          </div>
          <p className="llm-fit-close"><strong>That is why the surrounding system matters.</strong> Retrieval supplies evidence. Tools perform actions. Schemas constrain the shape. Evaluations expose failure. Authentication, state, and human review keep the result accountable.</p>
        </section>


        <div className="specialty-panel">
          <div>
            <span className="card-eyebrow">DEEP DOMAIN EXPERIENCE</span>
            <h2>Property-management technology</h2>
            <p>
              Substantial hands-on work around Propertyware, AppFolio, leasing,
              maintenance, documents, SQL reporting, ETL, and operational automation.
              That specialty becomes a wedge, not a cage.
            </p>
          </div>
          <a className="text-link" href={routeByPage.work} onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate("work");
          }}>
            Review selected work <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}


function AgentsPage({
  routeLink,
}: {
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  const [selectedClient, setSelectedClient] = useState<keyof typeof mcpClients>("ChatGPT");
  const client = mcpClients[selectedClient];

  return (
    <section className="section agents-section route-section">
      <div className="container split-layout split-layout--narrow">
        <div className="section-heading heading-split">
          <div>
            <div className="eyebrow eyebrow-dark"><Bot size={15} /> AI AGENTS</div>
            <h1>Build AI agents that do real work.</h1>
          </div>
          <p>Custom GPTs, Grok agents, and MCP integrations, connected to your systems with real guardrails.</p>
        </div>

        <div className="agent-client-strip" aria-label="AI clients that can connect to the same MCP tools">
          <div>
            <div className="card-eyebrow">CLIENT-AGNOSTIC BY DESIGN</div>
            <p>Build one dependable tool surface, then let the client fit the moment.</p>
          </div>
          <div className="agent-client-logos">
            {compatibleAiClients.map((clientLogo) => (
              <div className="agent-client-logo" key={clientLogo.name} title={`${clientLogo.name} client`}>
                <span className="agent-client-logo-mark" aria-hidden="true">{clientLogo.mark}</span>
                <span>{clientLogo.name}</span>
              </div>
            ))}
          </div>
        </div>

        <section className="mcp-case-study" aria-labelledby="mcp-case-study-title">
          <div className="mcp-case-copy">
            <div className="card-eyebrow">REAL-WORLD PATTERN</div>
            <h2 id="mcp-case-study-title">One business workflow. One MCP surface. Any client.</h2>
            <p>
              A property-management team wants an assistant that finds renewal exceptions and prepares
              a call list. The durable work is the typed tool boundary; Grok or ChatGPT is a small choice at the edge.
            </p>
            <a className="mcp-reference" href="https://x.com/Sabrina_Ramonov/article/2094833331183759612" target="_blank" rel="noreferrer">
              Personal organization reference <ExternalLink size={14} />
            </a>
          </div>

          <div className="mcp-client-panel">
            <div className="mcp-client-label">Try the client choice</div>
            <div className="mcp-client-tabs" role="tablist" aria-label="Choose an AI client">
              {(Object.keys(mcpClients) as Array<keyof typeof mcpClients>).map((name) => (
                <button
                  key={name}
                  className={selectedClient === name ? "active" : ""}
                  role="tab"
                  aria-selected={selectedClient === name}
                  onClick={() => setSelectedClient(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="mcp-prompt">
              <span className="mcp-prompt-dot" />
              <strong>{client.prompt}</strong>
            </div>
            <p>{client.detail}</p>
            <div className="mcp-client-footer">
              <span>{client.label}</span>
              <span><CheckCircle2 size={15} /> same tools</span>
            </div>
          </div>

          <div className="mcp-flow" aria-label="MCP request flow">
            {mcpFlow.map((step, index) => (
              <div className={`mcp-flow-step ${step.tone}`} key={step.mark}>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
                {index < mcpFlow.length - 1 && <ArrowRight className="mcp-flow-arrow" size={18} aria-hidden="true" />}
              </div>
            ))}
          </div>
        </section>

        <section className="mcp-transport" aria-labelledby="mcp-transport-title">
          <div className="section-heading compact-heading">
            <div>
              <div className="eyebrow eyebrow-dark"><TerminalSquare size={15} /> BUILD THE CHEAP PART FIRST</div>
              <h2 id="mcp-transport-title">Develop over stdio. Deploy HTTP when the workflow earns it.</h2>
            </div>
            <p>
              Test the tool surface locally at a fraction of the cost of a hosted integration. Move to HTTP MCP when multiple users, remote clients, and production identity need to meet.
            </p>
          </div>
          <div className="mcp-transport-grid">
            <article className="mcp-transport-card local">
              <span className="mcp-transport-tag">START HERE</span>
              <h3>stdio MCP</h3>
              <p>Run the server locally; an MCP client talks to it over standard input and output.</p>
              <ul>
                <li>Cheaper to build and faster to change</li>
                <li>Client can test real tool calls on a laptop</li>
              </ul>
            </article>
            <article className="mcp-transport-card remote">
              <span className="mcp-transport-tag">WHEN IT NEEDS TO TRAVEL</span>
              <h3>HTTP MCP</h3>
              <p>Expose the same tool contracts as a reachable service for remote clients.</p>
              <ul>
                <li>Authenticate users and mint or validate access tokens</li>
                <li>Handle tenant boundaries, rate limits, logs, and uptime</li>
              </ul>
            </article>
          </div>
          <p className="mcp-transport-note"><strong>The contract stays stable.</strong> Build the handlers once, prove them locally, then add HTTP when it earns its place.</p>
        </section>

        <section className="agents-guardrails" aria-labelledby="agents-guardrails-title">
          <div className="section-heading compact-heading">
            <div>
              <div className="eyebrow eyebrow-dark"><ShieldCheck size={15} /> GUARDRAILS</div>
              <h2 id="agents-guardrails-title">AI proposes. Rules decide.</h2>
            </div>
            <p>Every proposed action passes a deterministic rules gate before it touches a real system, and lands in an audit log.</p>
          </div>
          <MotionClip
            src="/assets/clip-ai-rules-gate.mp4"
            poster="/assets/video-poster-ai-rules-gate.jpg"
            label="Animated rules gate: an AI agent proposes a 1,200 dollar refund, the gate checks permission, data validity and policy, rejects it as over the limit, the agent revises it to 450 dollars, it passes, and the decision is written to the audit log."
            eyebrow="RULES GATE IN ACTION"
            title="Over limit? Rejected, revised, and logged."
            caption="The agent proposes a $1,200 refund. The gate checks Permission, Data valid and Within policy, rejects it as over limit, accepts the revised $450, and records both decisions in the audit log."
          />
        </section>

        <h2 className="agents-subhead split-aside">What we build</h2>
        <div className="agents-offer-grid split-main">
          {agentOfferings.map((offering) => (
            <article className="agents-offer-card" key={offering.title}>
              <span className="agents-offer-icon" aria-hidden="true"><offering.icon size={20} /></span>
              <h3>{offering.title}</h3>
              <p>{offering.text}</p>
            </article>
          ))}
        </div>

        <h2 className="agents-subhead split-aside">Examples</h2>
        <div className="agents-example-list split-main">
          {agentExamples.map((example) => (
            <article className="agents-example" key={example.title}>
              <h3>{example.title}</h3>
              <p>{example.text}</p>
            </article>
          ))}
        </div>

        <h2 className="agents-subhead split-aside">How we work</h2>
        <div className="engagement-list split-main">
          {agentSteps.map((step) => (
            <article key={step.mark}>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="parity-next-panel agent-cta">
          <div>
            <span className="card-eyebrow">NEXT STEP</span>
            <h2>Let's build your first agent.</h2>
            <p>Tell us one workflow that eats your team's time; we'll show what an agent for it looks like.</p>
          </div>
          <a className="button button-primary" {...routeLink("contact")}>
            Start a project
            <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}

function TenXTeamPage({
  routeLink,
  navigate,
}: {
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
  navigate: (page: Page) => void;
}) {
  return (
    <>
    <IndustryHero page="10x-team" navigate={navigate} />
    <section className="section tenx-section route-section">
      <div className="container">
        <div className="tenx-thesis">
          <div>
            <span className="card-eyebrow">THE ARGUMENT</span>
            <h2>10x is a way of working, not a claim about headcount.</h2>
          </div>
          <p>
            A few people who understand the business make agents useful: specify the work, give each agent a bounded assignment, test the result, and decide what gets assembled. The agent is the multiplier; the team supplies direction and judgment.
          </p>
        </div>

        <section className="tenx-last-mile" aria-labelledby="tenx-last-mile-title">
          <div className="tenx-last-mile-heading">
            <div>
              <span className="card-eyebrow">THE LAST MILE</span>
              <h2 id="tenx-last-mile-title">The shiny demo gets you most of the way to a conversation.</h2>
            </div>
            <p>
              It is tempting to buy a Claude Max plan and build it ourselves. The tools are real and the first result can be good. The trap is treating it as the finished system.
            </p>
          </div>
          <div className="tenx-last-mile-grid">
            <article>
              <span className="tenx-mile-label">THE 80% DEMO</span>
              <h3>It looks like the workflow.</h3>
              <p>Marketing videos show the happy path: a screen, a generated feature, a quick result.</p>
            </article>
            <article className="tenx-mile-final">
              <span className="tenx-mile-label">THE LAST 20%</span>
              <h3>It has to survive the business.</h3>
              <p>Permissions, edge cases, migrations, retries, tests, deployment, observability, and handoff often take most of the effort.</p>
            </article>
          </div>
          <p className="tenx-last-mile-close"><strong>That is where the team matters.</strong> Agents for throughput; experience to finish, integrate, and own the result.</p>
        </section>

        <h2 className="tenx-subhead">Three groups are looking for the same kind of leverage.</h2>
        <div className="tenx-groups">
          {tenXGroups.map((group, index) => (
            <article className={`tenx-group-card tenx-group-${index + 1}`} key={group.eyebrow}>
              <span className="card-eyebrow">{group.eyebrow}</span>
              <h3>{group.title}</h3>
              <p>{group.text}</p>
              <div className="tenx-fit"><strong>Fit:</strong> {group.fit}</div>
              <ul>
                {group.bullets.map((bullet) => <li key={bullet}><CheckCircle2 size={16} /> {bullet}</li>)}
              </ul>
            </article>
          ))}
        </div>

        <section className="tenx-coverage" aria-labelledby="tenx-coverage-title">
          <div className="tenx-coverage-heading">
            <div>
              <span className="card-eyebrow">WHAT THE TEAM CAN COVER</span>
              <h2 id="tenx-coverage-title">One senior group across the whole path.</h2>
            </div>
            <p>The point is continuity: the same people take a messy process to a working system and leave a clear handoff.</p>
          </div>
          <div className="tenx-coverage-list">
            {tenXCoverage.map(([title, text], index) => (
              <article key={title}>
                <div><h3>{title}</h3><p>{text}</p></div>
              </article>
            ))}
          </div>
        </section>

        <div className="parity-next-panel tenx-cta">
          <div>
            <span className="card-eyebrow">START WITH THE WORK</span>
            <h2>Bring one hard workflow.</h2>
            <p>We will map the boundary, show the smallest credible build, and tell you what deserves a larger team, if anything.</p>
          </div>
          <a className="button button-primary" {...routeLink("contact")}>Scope the first problem <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>
    </>
  );
}


function GitPage({ navigate }: { navigate: (page: Page) => void }) {
  return (
    <section className="section git-section route-section">
      <div className="container">
        <div className="section-heading heading-split">
          <div>
            <div className="eyebrow eyebrow-dark"><Github size={15} /> CURATED GIT</div>
            <h1>Code samples, selected for inspection.</h1>
          </div>
          <p>
            Source you can inspect. Client property, legal, and healthcare systems
            stay private. Code available on request; the work page is the
            industry record.
          </p>
        </div>

        <div className="work-grid git-grid">
          {gitSelections.map((repo, index) => (
            <article className={index === 0 ? "work-card work-card-featured" : "work-card"} key={repo.repo}>
              <div className="case-rail" aria-label="Repository metadata">
                <Github size={18} />
                <span>Repo</span>
                <strong>{repo.href ? "Public" : "Private"}</strong>
              </div>
              <div className="work-content">
                <div className="case-file-header">
                  <span className="card-eyebrow">{repo.eyebrow}</span>
                  <span className="case-status">{repo.href ? "Public repo" : "Private repo"}</span>
                </div>
                <h2>{repo.title}</h2>
                <p className="work-summary">{repo.summary}</p>
                <div className="shipped-panel">
                  <h3>Positioning notes</h3>
                  <ul>
                    {repo.details.map((detail) => (
                      <li key={detail}><CheckCircle2 size={16} /> {detail}</li>
                    ))}
                  </ul>
                </div>
                {repo.href && (
                  <div className="work-links">
                    <a href={repo.href} target="_blank" rel="noreferrer">
                      <Github size={16} /> {repo.repo}
                    </a>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="parity-next-panel">
          <div>
            <span className="card-eyebrow">INDUSTRY WORK</span>
            <h2>Real estate, then law, then healthcare.</h2>
            <p>The selected-work page is the buyer-facing record. This repository is the code behind the site.</p>
          </div>
          <a className="button button-primary" href="/work" onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate("work");
          }}>
            Open selected work <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}
function ApproachPage({
  routeLink,
}: {
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  return (
    <>
      <section className="section approach-section route-section">
        <div className="container approach-grid split-layout">
          <div className="section-heading split-aside">
            <div>
              <div className="eyebrow"><Route size={15} /> ENGAGEMENT MODEL</div>
              <h1>Clarity before custom work gets expensive.</h1>
            </div>
            <p>
              From discovery to demo, the work has to move between business requirements,
              architecture, implementation, and explanation without losing the thread.
            </p>
          </div>

          <div className="engagement-list split-main">
            {engagement.map((step) => (
              <article key={step.mark}>
                <div>
                  <h2>{step.title}</h2>
                  <p>{step.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section approach-delivery-section">
        <div className="container">
          <div className="section-heading heading-split">
            <div>
              <div className="eyebrow eyebrow-dark"><BadgeCheck size={15} /> WHAT YOU GET</div>
              <h2>The first engagement should leave you with more than a slide deck.</h2>
            </div>
            <p>
              The work produces something people can use to make the next decision: a shared model of the problem, a working proof, and an honest account of the remaining risk.
            </p>
          </div>
          <div className="approach-delivery-grid">
            {approachDeliverables.map((item) => (
              <article key={item.mark}>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section approach-gates-section">
        <div className="container">
          <div className="approach-gates-heading">
            <div>
              <div className="eyebrow"><Route size={15} /> DELIVERY CHECKPOINTS</div>
              <h2>Keep the expensive surprises visible.</h2>
            </div>
            <p>Good process is not ceremony for its own sake. Each checkpoint answers a practical question before the next layer of work makes the answer harder to change.</p>
          </div>
          <div className="approach-gates-list">
            {approachGates.map((gate, index) => (
              <article key={gate.title}>
                <div><h3>{gate.title}</h3><p>{gate.text}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section client-relationship-section">
        <div className="container">
          <div className="section-heading heading-split">
            <div>
              <div className="eyebrow eyebrow-dark"><MessageSquareCode size={15} /> WORKING TOGETHER</div>
              <h2>Start with a conversation, then make the commitment concrete.</h2>
            </div>
            <p>
              The first step is simple: contact us or email what you need. Start with a free 30-minute consult. After that, you should know what the next step is, what it will produce, and what it will cost before you commit.
            </p>
          </div>
          <div className="client-fee-note client-fee-note-top">
            <div>
              <span className="card-eyebrow">FEES AND COMMITMENT</span>
              <strong>Start with a free 30-minute consult.</strong>
            </div>
            <p>We use the first conversation to understand the problem. Any paid work is defined afterward with its scope, assumptions, deliverable, and price.</p>
          </div>
          <div className="client-relationship-grid">
            {clientRelationship.map((step) => (
              <article key={step.mark}>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section intelligence-section approach-intelligence-section">
        <div className="container intelligence-grid">
          <div>
            <div className="eyebrow eyebrow-dark"><BadgeCheck size={15} /> COMPETITIVE UPGRADE</div>
            <h2>What you should be able to see before you commit.</h2>
          </div>
          <div className="lesson-list">
            {competitorLessons.map((lesson) => (
              <div key={lesson}>
                <MessageSquareCode size={18} />
                <p>{lesson}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section approach-next-section">
        <div className="container">
          <div className="parity-next-panel approach-next-panel">
            <div>
              <span className="card-eyebrow">NEXT STEP</span>
              <h2>Start with the workflow that keeps getting deferred.</h2>
              <p>We will help you decide whether it needs an integration, a new application, an AI layer, or a clearer boundary first.</p>
            </div>
            <div className="approach-next-actions">
              <a className="button button-secondary" {...routeLink("engagement")}>See contract options <ArrowRight size={16} /></a>
              <a className="button button-primary" {...routeLink("contact")}>Scope the work <ArrowRight size={16} /></a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function AboutPage({ navigate, hub }: { navigate: (page: Page) => void; hub?: ReactNode }) {
  const handleGitClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    navigate("git");
  };

  const handleDocumentsClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    navigate("documents");
  };

  return (
    <section className="section about-section route-section">
      <div className="container about-shell">
        <div className="about-intro-band">
          <div className="about-heading-block">
            <div className="eyebrow eyebrow-dark">EDMUND LANDGRAF / UNWHELMNET</div>
            <h1>Direct technical ownership.</h1>
          </div>

          <div className="about-intro-copy">
          <p className="about-lead">
            UnwhelmNet is built around direct access to the engineer doing the
            discovery, architecture, and implementation. Based in the Reno–Tahoe region,
            we work with teams wherever the workflow lives.
          </p>
          <p>
            The work spans modern web applications, APIs, SQL and data pipelines,
            third-party SaaS integration, AI-assisted systems, Linux and Windows
            infrastructure, and the operational details required to get those systems
            deployed.
          </p>
          <p>
            The promise is deliberately practical: understand the workflow, build the
            right boundary, demonstrate what works, and be explicit about what still
            needs hardening.
          </p>
          </div>
        </div>

        <div className="about-capabilities">
          <div className="about-signal-panel" aria-label="About summary">
            <span className="card-eyebrow">WORKING MODEL</span>
            <strong>Discovery to deployed system</strong>
            <p>
              One technical owner stays close to the workflow, models the boundary,
              builds the path, and keeps the remaining risk visible.
            </p>
          </div>

          <div className="about-capability-grid" aria-label="Core technical lanes">
            <div>
              <DatabaseZap size={18} />
              <span>Data + workflow systems</span>
              <p>Turn exports, spreadsheets, SQL data, and platform reports into an operating view people can trust.</p>
            </div>
            <div>
              <BrainCircuit size={18} />
              <span>AI under application controls</span>
              <p>Retrieval, semantic search, local models, and AI workflows with deterministic business state.</p>
            </div>
            <div>
              <CloudCog size={18} />
              <span>Cloud, VPS, and hybrid deployment</span>
              <p>Deploy across Linux, Windows, VPS, cloud, and hybrid environments with a clear handoff model.</p>
            </div>
          </div>
        </div>

        {hub}

          <div className="about-proof-strip">
            <div>
              <span className="card-eyebrow">INSPECT THE WORK</span>
              <p>Review curated repos or browse the technical documents.</p>
            </div>
            <div className="about-links">
              <a href={routeByPage.git} onClick={handleGitClick}>
                <Github size={17} /> Git portfolio
              </a>
              <a href={routeByPage.documents} onClick={handleDocumentsClick}>
                <FileSearch size={17} /> Technical documents
              </a>
            </div>
          </div>
      </div>
    </section>
  );
}
type RouteLinkFn = (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };

const serviceCardClips: Partial<Record<Page, { src: string; poster: string; label: string; caption: string }>> = {
  "agent-setup": { src: "/assets/clip-svc-agent-setup.mp4", poster: "/assets/video-poster-svc-agent-setup.jpg", label: "Agent setup animation: your AI connects over MCP to the Proposal agent, which hands off to the Contract and Project manager agents.", caption: "Your AI. Our agents. Your data." },
  "integration": { src: "/assets/clip-svc-integration.mp4", poster: "/assets/video-poster-svc-integration.jpg", label: "Integration animation: machine, ERP, and maintenance data on Line 3 are matched, an AI copilot explains why the line is behind, a rules check passes, and work order WO-1042 is created.", caption: "Connect the systems, then the AI works: one matched record turns scattered data into a work order." },
  "ai-solutions": { src: "/assets/clip-ai-rules-gate.mp4", poster: "/assets/video-poster-ai-rules-gate-end.jpg", label: "Rules gate animation: an AI agent proposes a $1,200 refund, the gate rejects it as over the limit, the revised $450 refund passes, and both decisions are logged.", caption: "AI proposes, rules decide: an over-limit refund is rejected, revised, and logged." },
  "automation": { src: "/assets/clip-svc-automation-v2.mp4", poster: "/assets/video-poster-svc-automation-v2.png", label: "Automation animation: the demo pipeline runs, but production is not ready until the checklist (retries, auth, logging, evals, deploy) is complete, ending on: From demo to production.", caption: "From demo to production: retries, auth, logging, evals, and deploy." },
  "platforms": { src: "/assets/clip-svc-infrastructure-v2.mp4", poster: "/assets/video-poster-svc-infrastructure-v2.png", label: "Infrastructure animation: a deploy path from git push through Docker build and a TLS reverse proxy to a VPS, with health checks passing, ending on: Runs on infrastructure you own.", caption: "Runs on infrastructure you own: git push, Docker build, TLS reverse proxy, VPS." },
  "web-design": { src: "/assets/clip-svc-web.mp4", poster: "/assets/video-poster-svc-web.jpg", label: "Web app animation: a spreadsheet becomes a live production dashboard showing revenue, active users, and uptime across web, mobile, and cloud.", caption: "From spreadsheet to production app: a modern stack, shipped and running." },
  "10x-team": { src: "/assets/clip-svc-10x-team-v2.mp4", poster: "/assets/video-poster-svc-10x-team-v2.png", label: "10x team animation: a proposal is accepted and a team of persistent agents (developers, a PM, a graphic designer, QA) picks up tasks and ships them, ending on: Proposal accepted. Your team, spun up.", caption: "Proposal accepted. Your team, spun up: persistent agents pick up the work and ship it." },
};

// These clips end on a title card. Each one stops just before its title fades in, so it rests on the
// final image. The posters are extracted with ffmpeg -ss at the same timestamp, so the poster matches the resting frame.
const clipRestAt: Record<string, number> = {
  "/assets/clip-svc-integration.mp4": 4.9,
  "/assets/clip-svc-automation-v2.mp4": 4.9,
  "/assets/clip-svc-infrastructure-v2.mp4": 4.9,
  "/assets/clip-svc-10x-team-v2.mp4": 4.9,
  "/assets/clip-svc-agent-setup.mp4": 4.9,
};

type FrameCallbackVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number; cancelVideoFrameCallback?: (handle: number) => void };

// Pauses the clip at its rest time (timeupdate, a frame callback where supported, and ended as a fallback),
// then marks it data-rested so lazy playback never replays it.
function useClipRest(ref: React.RefObject<HTMLVideoElement | null>, src: string | undefined, active: boolean) {
  useEffect(() => {
    const video = ref.current as FrameCallbackVideo | null;
    const restAt = src ? clipRestAt[src] : undefined;
    if (!video || restAt === undefined || !active) return;
    let frameHandle: number | undefined;
    const hold = () => {
      video.dataset.rested = "true";
      if (!video.paused) video.pause();
      if (Math.abs(video.currentTime - restAt) > 0.04) video.currentTime = restAt;
    };
    const check = () => { if (video.currentTime >= restAt) hold(); };
    const watchFrames = () => {
      if (!video.requestVideoFrameCallback) return;
      frameHandle = video.requestVideoFrameCallback((_now, meta) => {
        if (meta.mediaTime >= restAt - 0.034) hold();
        else watchFrames();
      });
    };
    const onPlay = () => { if (video.dataset.rested === "true") hold(); else watchFrames(); };
    video.addEventListener("timeupdate", check);
    video.addEventListener("ended", hold);
    video.addEventListener("play", onPlay);
    if (!video.paused) onPlay();
    return () => {
      video.removeEventListener("timeupdate", check);
      video.removeEventListener("ended", hold);
      video.removeEventListener("play", onPlay);
      if (frameHandle !== undefined) video.cancelVideoFrameCallback?.(frameHandle);
    };
  }, [ref, src, active]);
}

// Plays once when at least half visible, then holds its last frame. Reduced motion shows the poster only.
function LazyClip({ src, poster, label, captionId }: { src: string; poster: string; label: string; captionId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reducedMotion = useReducedMotion();
  useClipRest(ref, src, !reducedMotion);
  useEffect(() => {
    const video = ref.current;
    if (!video || reducedMotion || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (!video.ended && video.dataset.rested !== "true") video.play().catch(() => undefined);
        } else if (!video.paused) {
          video.pause();
        }
      }
    }, { threshold: 0.5 });
    observer.observe(video);
    return () => observer.disconnect();
  }, [reducedMotion]);
  if (reducedMotion) return <img className="hub-card-clip" src={poster} alt={label} aria-describedby={captionId} loading="lazy" />;
  return <video ref={ref} className="hub-card-clip" muted playsInline preload="none" poster={poster} src={src} aria-label={label} aria-describedby={captionId} />;
}

// Lines folded in from the removed /services banners, shown on the matching service card.
const serviceCardNotes: Partial<Record<Page, string>> = {
  "ai-solutions": "Custom GPTs, Grok agents, and MCP integrations, connected to your systems with real guardrails.",
  "10x-team": "Senior builders directing agent work, reviewing the output, and covering more of the path with fewer people.",
};

function HubLinks({ parent, routeLink }: { parent: Page; routeLink: RouteLinkFn }) {
  const children = hubChildren[parent] ?? [];
  if (!children.length) return null;
  const headingId = `hub-${parent}-title`;
  return (
    <section className="hub-links" aria-labelledby={headingId}>
      <h2 id={headingId} className="hub-links-title">Explore {(breadcrumbLabels[parent] ?? parent).toLowerCase()}</h2>
      <ul className="hub-links-grid">
        {children.map((child) => (
          <li key={child}>
            {parent === "services" && serviceCardClips[child] && (
              <figure className="hub-card-figure">
                <LazyClip src={serviceCardClips[child]!.src} poster={serviceCardClips[child]!.poster} label={serviceCardClips[child]!.label} captionId={`hub-clip-${child}`} />
                <figcaption id={`hub-clip-${child}`} className="visually-hidden">{serviceCardClips[child]!.caption}</figcaption>
              </figure>
            )}
            <a className="hub-link-card" {...routeLink(child)}>
              <strong>{navChildLabels[child] ?? breadcrumbLabels[child]}</strong>
              <span>{pageMeta[child]?.description}</span>
              {parent === "services" && serviceCardNotes[child] && <span className="hub-link-note">{serviceCardNotes[child]}</span>}
              <span className="hub-link-cta" aria-hidden="true">Open <ArrowRight size={15} /></span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// DRAFT: /mcp explains the MCP server using only approved copy.
const mcpFaq = [
  { question: "Do I need MCP to work with you?", answer: "No. The free 30-minute consult works too." },
  { question: "What does it cost?", answer: "The connection is free. You pay only for your own AI plan." },
];

function McpPage({ navigate }: { navigate: (page: Page) => void }) {
  return (
    <section className="section route-section mcp-page">
      <div className="container">
        <div className="section-heading heading-split mcp-hero">
          <div>
            <div className="eyebrow eyebrow-dark"><Workflow size={15} /> MCP SERVER</div>
            <h1>Unwhelm's MCP server.</h1>
          </div>
          <div>
            <p>Unwhelm's MCP server lets your own AI app (Grok, ChatGPT, Claude) talk directly to our agents. Your agent, your plan, your data; we supply the connection and the rules.</p>
            <div className="hero-actions mcp-actions">
              <a className="button button-primary" {...routeLink("agent-setup", navigate)}>Set up my agent <ArrowRight size={16} /></a>
              <a className="button button-secondary" {...routeLink("mcp-connect", navigate)}>Talk to the Proposal Manager with your own AI client <ArrowRight size={16} /></a>
              <span className="button button-secondary mcp-cta-disabled" role="button" aria-disabled="true">Use our web-based chat <span className="mcp-coming-soon">Coming soon</span></span>
            </div>
          </div>
        </div>

        <p className="case-note"><a {...routeLink("proposal-architecture", navigate)}>Explore the Proposal Architecture diagram and all registered MCP tools.</a></p>
        <section className="agent-block" aria-labelledby="mcp-how">
          <h2 id="mcp-how">How it works</h2>
          <div className="agent-cards">
            <article><span className="card-eyebrow">Before a contract</span><h3>Proposal Manager</h3><p>Scope the work, ask questions, and get a proposal: Workflow Check, Capped Hours or Fixed Price. Use it before or after the free 30-minute consult.</p></article>
            <article><span className="card-eyebrow">After signing</span><h3>Contract Manager</h3><p>Terms, changes and approvals.</p></article>
            <article><span className="card-eyebrow">After signing</span><h3>Project Manager</h3><p>Status, tasks and deliverables while the team works.</p></article>
          </div>
        </section>

        <section id="how-to-connect" className="agent-block agent-connect" aria-labelledby="mcp-connect">
          <h2 id="mcp-connect">How to connect</h2>
          <ol className="agent-connect-steps">
            <li>Add a custom MCP connector in your AI app.</li>
            <li>Enter the server address: <code>https://mcp.unwhelm.net/mcp</code> <strong className="agent-ready">Ready for Grok.</strong></li>
            <li>Sign in with OAuth.</li>
          </ol>
          <p className="case-note"><a {...routeLink("mcp-connect", navigate)}>Full steps for Grok, Claude and your own client</a></p>
          <p className="case-note"><a {...routeLink("claude", navigate)}>Connect Claude, step by step, with a diagram</a></p>
          <p className="case-note"><a {...routeLink("connect", navigate)}>Compare setup for each MCP client</a></p>
          <p className="case-note"><a {...routeLink("agent-setup", navigate)}>Not sure how? We'll set your agent up for free.</a></p>
        </section>

        <div className="agent-two-col">
          <section className="agent-block" aria-labelledby="mcp-apps">
            <h2 id="mcp-apps">Which apps work</h2>
            <p>Grok is ready, Claude is ready, and ChatGPT works on supported plans.</p>
          </section>
          <section className="agent-block" aria-labelledby="mcp-yours">
            <h2 id="mcp-yours">What stays yours</h2>
            <p>Usage runs on your own AI plan, and we never see your keys. Every action is logged and guardrailed.</p>
          </section>
        </div>

        <div className="parity-faq" aria-labelledby="mcp-faq-title">
          <div className="section-heading">
            <div>
              <div className="eyebrow eyebrow-dark"><MessageSquareCode size={15} /> QUESTIONS</div>
              <h2 id="mcp-faq-title">MCP FAQ</h2>
            </div>
          </div>
          <div className="parity-faq-grid">
            {mcpFaq.map((item) => (
              <details key={item.question}>
                <summary>{item.question}<ChevronRight size={17} /></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>

        <div className="parity-next-panel">
          <div>
            <span className="card-eyebrow">Next step</span>
            <h2>Your agent, your plan, your data.</h2>
          </div>
          <div className="hero-actions mcp-actions">
            <a className="button button-primary" {...routeLink("agent-setup", navigate)}>Set up my agent <ArrowRight size={16} /></a>
            <a className="button button-secondary" {...routeLink("mcp-connect", navigate)}>Talk to the Proposal Manager with your own AI client <ArrowRight size={16} /></a>
              <span className="button button-secondary mcp-cta-disabled" role="button" aria-disabled="true">Use our web-based chat <span className="mcp-coming-soon">Coming soon</span></span>
          </div>
        </div>
      </div>
    </section>
  );
}

// /insights and each article route (/insights/<slug>) share this page: the list names every article and
// the pane shows the selected article in full. The URL is the selection, so article links are shareable.
function InsightsPage({ page, routeLink, navigate }: { page: Page; routeLink: RouteLinkFn; navigate: (page: Page, search?: string, options?: { scroll?: boolean }) => void }) {
  const routeArticle = findInsightsArticle(page);
  const selected = routeArticle ?? insightsArticles[0];
  return (
    <section className="section route-section insights-section">
      <div className="container">
        <div className="section-heading heading-split">
          <div>
            <div className="eyebrow eyebrow-dark"><FileText size={15} /> INSIGHTS</div>
            {/* On an article route the article title is the page's h1 (in the pane), so "Insights." is not a heading there. */}
            {routeArticle ? <p className="section-heading-title">Insights.</p> : <h1>Insights.</h1>}
          </div>
          <p>{pageMeta.insights?.description}</p>
        </div>
        <ListDetail
          className="insights-list-detail"
          layout="reader"
          label="Insights articles, newest first"
          selectedId={selected.page}
          onSelect={(id) => {
            const article = findInsightsArticle(id);
            if (article) navigate(article.page, "", { scroll: false });
          }}
          items={insightsArticles.map((article) => ({
            id: article.page,
            title: article.title,
            date: article.published,
            dateLabel: formatArticleDate(article.published, "short"),
          }))}
          renderDetail={(item, { headingId }) => {
            const article = findInsightsArticle(item.id)!;
            const Heading = routeArticle ? "h1" : "h2";
            return (
              <article className="insights-article">
                {/* The selected list row names the article visually; this heading carries it for assistive tech and SEO. */}
                <Heading id={headingId} className="visually-hidden">{article.fullTitle}</Heading>
                <p className="article-meta list-detail-meta">
                  <time dateTime={article.published}>{formatArticleDate(article.published)}</time>
                  <span>{article.readingMinutes} min read</span>
                </p>
                <ArticleBody
                  source={article.source}
                  nested={!routeArticle}
                  onInternalLink={(href) => {
                    const target = pageFromPath(href);
                    if (target === "not-found") return false;
                    navigate(target);
                    return true;
                  }}
                />
              </article>
            );
          }}
        />

        <div className="parity-next-panel insights-cta">
          <div>
            <span className="card-eyebrow">NEXT STEP</span>
            <h2>See it work on a real request.</h2>
            <p>Run a live proposal in the sandbox, or check what each contract type costs.</p>
          </div>
          <div className="institutional-actions">
            <a className="button button-primary" {...routeLink("try")}>Try it live <ArrowRight size={16} /></a>
            <a className="button button-secondary" {...routeLink("engagement")}>See pricing</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function IndustriesPage({ routeLink, navigate }: { routeLink: RouteLinkFn; navigate: (page: Page) => void }) {
  return (
    <section className="section parity-section route-section">
      <div className="container">
        <div className="section-heading heading-split">
          <div>
            <div className="eyebrow eyebrow-dark"><Network size={15} /> INDUSTRIES</div>
            <h1>Industries where the workflow crosses systems.</h1>
          </div>
          <p>
            Selected work is ordered by where the practice is deepest: real estate, then financial, then law, then healthcare. Each industry page starts with the systems people already use and the handoffs that still happen by hand.
          </p>
        </div>

        <HubLinks parent="industries" routeLink={routeLink} />

        <section className="hub-links" aria-labelledby="hub-real-estate-paths-title">
          <h2 id="hub-real-estate-paths-title" className="hub-links-title">Real estate paths</h2>
          <ul className="hub-links-grid">
            {(hubChildren["real-estate"] ?? []).map((child) => (
              <li key={child}>
                <a className="hub-link-card" {...routeLink(child)}>
                  <strong>{breadcrumbLabels[child]}</strong>
                  <span>{pageMeta[child]?.description}</span>
                  <span className="hub-link-cta" aria-hidden="true">Open <ArrowRight size={15} /></span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <div className="parity-next-panel">
          <div>
            <span className="card-eyebrow">NEXT STEP</span>
            <h2>Start with the workflow that costs people time.</h2>
            <p>Bring the process, the systems it touches, and the decision you want to make faster. We will help define the smallest useful build.</p>
          </div>
          <button className="button button-primary" onClick={() => navigate("contact")}>Start a project <ArrowRight size={16} /></button>
        </div>
      </div>
    </section>
  );
}

// Resume content comes from the legacy UnwhelmNetReplit2 resume pages (Resume.tsx / ResumeMD.tsx).
// The Propertyware warehouse story uses legacy wording ("Portfolio Data Warehouse Integration",
// "Institutional Reporting API Development") plus the scope Edmund described. Do not add facts here.
const resumeSummaryProblems = [
  "Gaps between systems and duplicated effort",
  "Inconsistent decisions across different teams",
  "Difficulty retaining institutional knowledge as staff change or scale",
  "Breakdowns in communication between departments, tools, and roles",
  "Difficulty onboarding new personnel into complex internal systems",
];

const resumeSummaryApproach = [
  ["Modeling actual workflows", "Designing systems based on how teams really work, not just how the tools are \"supposed\" to behave."],
  ["Structuring institutional knowledge", "Turning fragmented notes and tribal knowledge into a searchable, AI-ready foundation."],
  ["Automating department hand-offs", "Building the systems of coordination that manage the complete lifecycle of tasks across different tools."],
  ["Designing for durability", "Ensuring workflows stay simple and manageable even as user count and data volume increase."],
] as const;

const resumePrinciples = [
  ["Integration First", "Design platforms as ecosystems. Favor contract-driven integration over ad-hoc connectors, with typed contracts and schemas under versioning discipline."],
  ["Definitional Models", "Consolidate definitions (entity semantics, status machines, policy rules) and tie data lineage to decision lineage."],
  ["Guardrails by Design", "Security, privacy, and governance embedded in orchestration paths: least privilege, tamper-proof logs, and progressive disclosure of sensitive information."],
  ["Coordination > Automation", "Automate hand-offs, clarify responsibilities, and surface exceptions early, with human-in-the-loop approvals and rationale capture."],
  ["Layered Architecture", "Clean separation across presentation, application, domain, and infrastructure, with dependency boundaries and testing seams for evolvability."],
  ["Performance & Observability", "Treat performance as behavioral truth. Instrument latency budgets and business SLIs such as time-to-approval and pricing cycle time."],
] as const;

const resumeSkills = [
  ["Languages", ["C#", "Python", "T-SQL / SQL", "TypeScript", "PowerShell"]],
  ["Frameworks", ["FastAPI", "ASP.NET Core / Razor", "EF Core", "React / Vite"]],
  ["Data engineering", ["SQL Server schema, indexing & performance", "Python ETL with audit trails", "SSIS (CozyRoc) + hybrid-task orchestration", "Historical reconciliation + forward modeling"]],
  ["Operations", ["Structured logs (Serilog), trace IDs, correlation", "Policy & claims-based auth with JWT", "Roll-forward / roll-backable migrations", "Task orchestration & schedulers"]],
  ["AI & knowledge", ["RAG / semantic retrieval for operations decisions", "Context-indexing for team decision patterns", "Generative messaging over deterministic logic"]],
  ["Real-estate SaaS", ["AppFolio: API + export intelligence", "Propertyware: API sync, normalization, ledger alignment", "Tenant Turner, PropertyMeld, Rentometer", "Box, OneDrive, Google Drive, DocuSign, DotLoop"]],
] as const;

const resumeSystems = [
  {
    eyebrow: "PROPERTY MANAGEMENT / KEY SYSTEM",
    title: "RentFinder CMA & Operational Intelligence",
    text: "Unified AppFolio + Propertyware portfolio data into a canonical operational model, designed the internal Razor-based portal, and implemented a transparent pricing recommendation engine with full auditability.",
    bullets: [
      "Incremental ETL with schema mapping, reconciliation logs, and quality gates",
      "Rule-weighted comp selection with defensible rationale and explainability artifacts",
      "Approval workflows with leadership checkpoints and time-to-decision SLIs",
      "Outcome: pricing cycle time 3–6 hours → 10–20 minutes",
    ],
  },
  {
    eyebrow: "PROPERTY MANAGEMENT / DATA PLATFORM",
    title: "Propertyware ETL warehouse",
    text: "Portfolio Data Warehouse Integration and Institutional Reporting API Development: an ETL warehouse that brought about 10 systems together around Propertyware.",
    bullets: [
      "Started as reporting, then grew into QA over the combined data",
      "Then into automated fixes and writes back to the source systems",
      "Institutional client data flowing both ways through the warehouse",
    ],
  },
  {
    eyebrow: "PROPERTY MANAGEMENT / AUTOMATION",
    title: "Document Intake & Identity Automation",
    text: "Replaced manual leasing document handling with an orchestrated flow that manages upload, routing, classification, assignment, storage, and confirmation loops with human oversight where needed.",
    bullets: [
      "Template recognition with fallback manual type assignment",
      "Role-based queues, escalations, and a trail of custody",
      "Claims-based view/edit and immutable audit: who accessed what and why",
    ],
  },
  {
    eyebrow: "PROPERTY MANAGEMENT / AI",
    title: "Context-Indexed Knowledge & RAG",
    text: "Built retrieval layers tuned to state policies, asset categories, neighborhood heuristics, and internal operational guidelines, enabling repeatable reasoning across markets and users.",
    bullets: [
      "Indexers that respect definitional models and policy scoping",
      "Hybrid ranking: semantic + rules, with source attribution",
      "“Decision memos” that capture context for later discovery",
    ],
  },
];

const resumeRoles = [
  {
    period: "2005 – Present",
    title: "Unwhelm Inc. — Principal",
    text: "Architecture practice focused on transforming high-friction workflows into structured platforms, designing internal knowledge systems for operational repeatability, and building automation infrastructure around organizational intent.",
  },
  {
    period: "2017 – 2018",
    title: "Pearl Law Group — Senior Software Architect",
    text: "Designed a SharePoint Online + on-prem hybrid architecture for a global law firm, integrated the Tracker API to unify legal, liaison, and vendor workflows, built a contact/rolodex discovery tool, and authored the Master System Integration Strategy.",
  },
  {
    period: "2007 – 2013",
    title: "GearSorter LLC — Co-Founder & Chief Architect",
    text: "Built a platform supporting large-group consensus decision-making for shared resource planning: weighted preference bidding, constraint modeling, and consensus stabilization loops.",
  },
  {
    period: "2007 – 2015",
    title: "NorCal Beach Ultimate Association — Co-Founder",
    text: "Founded the first permitted league on Ocean Beach (NPS federal land) and designed frameworks coordinating recreation and environmental stewardship.",
  },
];

const resumeEarlier = [
  "Prostate Cancer Foundation — Architect/Manager",
  "Parkinson’s Disease Foundation — Architect/Manager/Developer (pdtrials.org)",
  "Stentor Inc — Senior Database Architect (HL7 ingestion, large-volume ETL)",
  "ARIA Software — Senior Consultant",
  "Wireless Generation — Data Integration Specialist",
  "Rentals.com — Chief Architect",
  "Also: Odopod, Primus Knowledge Solutions, ICommerce, Amerix, DC Human Services, HCIA, Crestar/SunTrust, Philip Morris, American Management Systems, Sybase (intern)",
];

const resumeEducation = [
  ["Cornell University", "B.S., Computer Science (College of Engineering). Specializations: Database Theory & Applied Artificial Intelligence. Minors: Psychology, Operations Research, Asian Studies."],
  ["University of California, Berkeley", "Computer Science coursework: systems, data structures, and software engineering."],
  ["George Mason University", "Graduate-level Computer Science."],
] as const;

function ResumePage({ routeLink }: { routeLink: RouteLinkFn }) {
  return (
    <section className="section parity-section route-section resume-page">
      <div className="container">
        <div className="section-heading heading-split">
          <div>
            <div className="eyebrow eyebrow-dark"><BadgeCheck size={15} /> EDMUND LANDGRAF / RESUME</div>
            <h1>Principal AI &amp; Systems Integration Architect</h1>
            <p className="resume-location">Reno–Tahoe Region (Home) · Remote Available</p>
          </div>
          <p>
            I architect and implement AI-augmented internal platforms that solve deep data fragmentation: systems that automatically pull, reconcile, and analyze data across multiple platforms to drive real-time business decisions.
          </p>
        </div>

        <div className="resume-summary-grid">
          <article className="parity-card">
            <span className="card-eyebrow">WHERE I HELP</span>
            <h2>Organizations that have grown beyond informal workflows.</h2>
            <ul>{resumeSummaryProblems.map((item) => <li key={item}><CheckCircle2 size={16} /> {item}</li>)}</ul>
          </article>
          <article className="parity-card">
            <span className="card-eyebrow">HOW I SOLVE IT</span>
            <h2>Model the work, then automate the hand-offs.</h2>
            <ul>{resumeSummaryApproach.map(([title, text]) => <li key={title}><CheckCircle2 size={16} /> <span><strong>{title}</strong> — {text}</span></li>)}</ul>
          </article>
        </div>

        <section className="parity-more" aria-labelledby="resume-experience-title">
          <div className="section-heading heading-split">
            <div>
              <div className="eyebrow eyebrow-dark"><Workflow size={15} /> 2022 – 2025</div>
              <h2 id="resume-experience-title">Multi-state property-management firm — Business Software Architect</h2>
            </div>
            <p>The firm operates across multiple states with distinct leasing environments, pricing dynamics, and operational pipelines. My work established systemic consistency without forcing local nuance to disappear.</p>
          </div>
          <div className="parity-grid parity-grid-4">
            {resumeSystems.map((system) => (
              <article className="parity-card" key={system.title}>
                <span className="card-eyebrow">{system.eyebrow}</span>
                <h3>{system.title}</h3>
                <p>{system.text}</p>
                <ul>{system.bullets.map((bullet) => <li key={bullet}><CheckCircle2 size={16} /> {bullet}</li>)}</ul>
              </article>
            ))}
          </div>
          <div className="parity-proof-panel">
            <span className="card-eyebrow">BUSINESS RESULTS</span>
            <h2>Pricing workflows: 3–6 hours → 10–20 minutes.</h2>
            <p>Reduced decision variance and improved yield alignment, expansion to new markets without linear staffing increases, and institutional knowledge that became searchable and structured.</p>
          </div>
        </section>

        <section className="parity-more" aria-labelledby="resume-skills-title">
          <h2 id="resume-skills-title" className="hub-links-title">Skills stack</h2>
          <div className="parity-grid">
            {resumeSkills.map(([title, items]) => (
              <article className="parity-card resume-skill-card" key={title}>
                <h3>{title}</h3>
                <ul>{items.map((item) => <li key={item}><CheckCircle2 size={16} /> {item}</li>)}</ul>
              </article>
            ))}
          </div>
        </section>

        <section className="parity-more" aria-labelledby="resume-principles-title">
          <h2 id="resume-principles-title" className="hub-links-title">Architecture principles</h2>
          <div className="parity-grid">
            {resumePrinciples.map(([title, text]) => (
              <article className="parity-card resume-skill-card" key={title}>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="parity-more" aria-labelledby="resume-roles-title">
          <h2 id="resume-roles-title" className="hub-links-title">Other experience</h2>
          <div className="resume-list">
            {resumeRoles.map((role) => (
              <article className="parity-card resume-role" key={role.title}>
                <span className="card-eyebrow">{role.period}</span>
                <h3>{role.title}</h3>
                <p>{role.text}</p>
              </article>
            ))}
            <article className="parity-card resume-role">
              <span className="card-eyebrow">EARLIER CAREER</span>
              <h3>Architecture, data engineering, and high-scale systems across healthcare, finance, and civic programs</h3>
              <ul>{resumeEarlier.map((item) => <li key={item}><CheckCircle2 size={16} /> {item}</li>)}</ul>
            </article>
          </div>
        </section>

        <section className="parity-more" aria-labelledby="resume-education-title">
          <h2 id="resume-education-title" className="hub-links-title">Education</h2>
          <div className="parity-grid">
            {resumeEducation.map(([school, text]) => (
              <article className="parity-card resume-skill-card" key={school}>
                <h3>{school}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <div className="parity-proof-panel">
          <span className="card-eyebrow">PHILOSOPHY</span>
          <h2>Unwhelm: a system succeeds when it creates space for clarity and movement.</h2>
          <p>Systems should reduce cognitive load. Decision-making should become easier, not more complex. Strong bias toward maintainable architectures, explainable automation, and plain, durable, clear code.</p>
        </div>

        <div className="parity-next-panel">
          <div>
            <span className="card-eyebrow">MORE DETAIL</span>
            <h2>See the skills and the work behind them.</h2>
            <p>The skills page maps the tools and diagrams; the case studies show the problems they were used on.</p>
          </div>
          <div className="institutional-actions">
            <a className="button button-secondary" {...routeLink("technical-skills")}>Skills <ArrowRight size={16} /></a>
            <a className="button button-secondary" {...routeLink("case-studies")}>Case studies <ArrowRight size={16} /></a>
            <a className="button button-primary" {...routeLink("contact")}>Contact <ArrowRight size={16} /></a>
          </div>
        </div>
      </div>
    </section>
  );
}

// Prospect chat UI is not live yet. The chat API (server/routes/chatProposalRead.ts, server/proposalAgent.ts)
// stays in place; flip this flag only once a client chat UI exists and the model backend is configured.
const prospectChatEnabled = false;

function ChatComingSoonPage({
  routeLink,
}: {
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  if (prospectChatEnabled) return null;
  return (
    <section className="section not-found-section route-section">
      <div className="container not-found-shell">
        <div className="eyebrow eyebrow-dark">CHAT</div>
        <h1>Prospect chat is coming soon.</h1>
        <p>Until then, tell us about your project on the Contact page.</p>
        <div className="hero-actions"><a className="button button-primary" {...routeLink("contact")}>Contact us <ArrowRight size={16} /></a></div>
      </div>
    </section>
  );
}

function NotFoundPage({
  routeLink,
}: {
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  return (
    <section className="section not-found-section route-section">
      <div className="container not-found-shell">
        <div className="eyebrow eyebrow-dark">PAGE NOT FOUND</div>
        <h1>That page is not here.</h1>
        <p>The address may have changed, or the link may be incomplete. Start from the home page or go directly to the project intake.</p>
        <div className="hero-actions"><a className="button button-primary" {...routeLink("home")}>Back home <ArrowRight size={16} /></a><a className="button button-secondary" {...routeLink("contact")}>Start a project <ArrowRight size={16} /></a></div>
      </div>
    </section>
  );
}

function EngagementPage({
  routeLink,
}: {
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  const prices = useCatalogPrices();
  const pricingOptions = prices ? pricingOptionsFor(prices) : [];
  return (
    <section className="section engagement-options-section route-section">
      <div className="container">
        <div className="section-heading heading-split engagement-options-heading">
          <div>
            <div className="eyebrow eyebrow-dark"><BadgeCheck size={15} /> CONTRACT TYPES</div>
            <h1>Choose the shape that fits the work.</h1>
          </div>
          <p>
            Start with a free 30-minute consult. After that, we choose a contract around the uncertainty, urgency, and outcome instead of forcing every project into the same billing model.
          </p>
        </div>

        <div className="contract-type-grid pricing-option-grid">
          {pricingOptions.map((option) => (
            <article className={`contract-type-card contract-type-${option.accent}`} key={option.key}>
              <h2>{option.title}</h2>
              <p className="pricing-option-price">{option.price}</p>
              {option.saving && <p className="pricing-option-saving">{option.saving}</p>}
              <p className="contract-type-summary">{option.text}</p>
            </article>
          ))}
        </div>

        {prices && (
          <section className="pricing-examples" aria-labelledby="pricing-examples-title">
            <h2 id="pricing-examples-title">What each option can look like</h2>
            <div className="pricing-example-grid">
              {pricingExamplesFor(prices).map((example) => (
                <article className={`pricing-example-card contract-type-${example.accent}`} key={example.key}>
                  <span className="card-eyebrow">Example</span>
                  <h3>{example.tier}, {example.price}</h3>
                  <a className="pricing-example-tag" {...routeLink(example.page)}>{example.service}</a>
                  <p>{example.text}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        <p className="pricing-small-print pricing-big-project">Big project? We'll check the most valuable slice first and scope the rest into a proposal.</p>

        {prices && <p className="pricing-small-print">Standard hourly rate: ${prices.hourlyRate}/hr. These are starting points, not a substitute for scope; the free 30-minute consult makes the assumptions visible before any paid commitment.</p>}

        <aside className="agent-callout" aria-labelledby="agent-callout-title">
          <h2 id="agent-callout-title">Get a free AI agent for comms.</h2>
          <p>{agentCallout}</p>
          <a className="parity-card-link" {...routeLink("agent-setup")}>See how agent setup works <ArrowRight size={15} /></a>
        </aside>

        <div className="engagement-trust-panel">
          <div>
            <span className="card-eyebrow">OWNERSHIP AND CONTROL</span>
            <h2>Your system should remain yours.</h2>
          </div>
          <ul>
            <li><CheckCircle2 size={16} /> Client-owned source code, configuration, documentation, and runbooks.</li>
            <li><CheckCircle2 size={16} /> Least-privilege access with credentials kept outside the codebase.</li>
            <li><CheckCircle2 size={16} /> Audit logs and human approval points for consequential actions.</li>
          </ul>
        </div>

        <div className="engagement-options-note">
          <div>
            <span className="card-eyebrow">HOW WE START</span>
            <h2>Bring the problem. We will make the next step concrete.</h2>
          </div>
          <p>
            Tell us what is stuck, what systems are involved, and what you can invest. We will use the free session to decide whether the work needs a Workflow Check, Capped Hours, or a Fixed Price.
          </p>
          <a className="button button-primary" {...routeLink("contact")}>Start with the free session <ArrowRight size={16} /></a>
        </div>
      </div>
    </section>
  );
}

const emptyContactForm = {
  name: "",
  email: "",
  phone: "",
  company: "",
  title: "",
  website: "",
  message: "",
  software: [] as string[],
  goals: [] as string[],
  softwareOther: "",
  goalsOther: "",
  onPremise: "",
  cloudProviders: [] as string[],
  cloudOther: "",
  sendCC: false,
};

function ContactPage({
  routeLink,
}: {
  routeLink: (page: Page) => { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  const [formData, setFormData] = useState(emptyContactForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [scheduleData, setScheduleData] = useState({ budget: "", date: "", time: "", notes: "" });
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const setField = (field: keyof typeof emptyContactForm, value: string | boolean) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const toggleChoice = (field: "software" | "goals" | "cloudProviders", value: string) => {
    setFormData((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value],
    }));
  };

  const submitContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = {
      ...formData,
      software: [...formData.software, formData.softwareOther].filter(Boolean),
      goals: [...formData.goals, formData.goalsOther].filter(Boolean),
      cloudProviders: [...formData.cloudProviders, formData.cloudOther].filter(Boolean),
      sendCC: formData.sendCC,
    };

    setIsSubmitting(true);
    setStatus(null);

    try {
      const response = await fetch("/api/contact/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (response.ok && result.success) {
        trackEvent("Contact Submitted");
        setStatus({ tone: "ok", text: "Message Sent! We'll get back to you within 24 hours." });
        setContactId(result.contactId ?? null);
        setFormData(emptyContactForm);
      } else {
        setStatus({
          tone: "error",
          text: result.error || "There was a problem submitting your form.",
        });
      }
    } catch (error) {
      console.error("Submission error:", error);
      setStatus({ tone: "error", text: "Unable to reach the server. Please try again later." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contactId) return;
    setIsScheduling(true);
    setScheduleStatus(null);
    try {
      const response = await fetch("/api/session/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, ...scheduleData }),
      });
      const result = await response.json();
      if (response.ok && result.success) {
        trackEvent("Session Scheduled", { budget: scheduleData.budget });
        setScheduleStatus({ tone: "ok", text: "Session request received. We will confirm the time by email." });
      } else {
        setScheduleStatus({ tone: "error", text: result.error || "There was a problem requesting the session." });
      }
    } catch (error) {
      console.error("Schedule submission error:", error);
      setScheduleStatus({ tone: "error", text: "Unable to reach the scheduler. Please try again later." });
    } finally {
      setIsScheduling(false);
    }
  };

  const setScheduleField = (field: keyof typeof scheduleData, value: string) => {
    setScheduleData((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="contact-section contact-page">
      <div className="container contact-page-grid">
        <div className="contact-hero-copy">
          <div className="eyebrow">START WITH THE PROBLEM</div>
          <h1>Let's talk about your project.</h1>
          <p>
            Tell us about the workflow, systems, and outcome you have in mind. The first conversation is designed to establish fit and define the smallest useful next step.
          </p>
          <div className="contact-proof-strip" aria-label="Contact workflow summary">
            <span><CheckCircle2 size={16} /> Workflow and system context</span>
            <span><CheckCircle2 size={16} /> Cloud, VPS, and data ownership</span>
            <span><CheckCircle2 size={16} /> Property-management platform detail</span>
          </div>
          <div className="contact-fee-banner">
            <span className="card-eyebrow">FEES AND COMMITMENT</span>
            <strong>Start with a free 30-minute consult.</strong>
            <p>We use the first conversation to understand the problem. Any paid work is defined afterward with its scope, assumptions, deliverable, and price.</p>
          </div>
        </div>

        <aside className="contact-card contact-sidebar" aria-label="Contact information">
          <h2>Contact information</h2>
          <div className="contact-info-row">
            <Mail size={20} />
            <span>
              <small>Email</small>
              <a href="mailto:contact@unwhelm.com">contact@unwhelm.com</a>
            </span>
          </div>
          <div className="contact-info-row">
            <Phone size={20} />
            <span>
              <small>Voice / Fax</small>
              <a href="tel:+18662094787">866-209-4787</a>
            </span>
          </div>
          <div className="contact-info-row">
            <ServerCog size={20} />
            <span>
              <small>Availability</small>
              <strong>Mon-Fri, 8am-5pm PT</strong>
            </span>
          </div>
        </aside>
      </div>

      <div className="container contact-form-layout">
        <form className="intake-form" aria-label="Project intake form" onSubmit={submitContact}>
          <div className="form-action-bar">
            <div>
              <span className="card-eyebrow">PROJECT INTAKE</span>
              <h2>Contact Us</h2>
            </div>
            <div className="form-action-buttons">
              <a className="privacy-form-link" {...routeLink("privacy")}>Privacy</a>
              <a className="privacy-form-link" {...routeLink("terms")}>Terms</a>
              <a className="privacy-form-link" {...routeLink("support")}>Support</a>
              <button className="button button-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send Message"}
              </button>
            </div>
          </div>
          {status && (
            <p className={status.tone === "error" ? "form-status error" : "form-status"} role={status.tone === "error" ? "alert" : "status"}>
              {status.text}
            </p>
          )}

          <section className="form-section">
            <h3>Customer information</h3>
            <div className="form-grid-two">
              <label>Name *<input required autoComplete="name" value={formData.name} onChange={(event) => setField("name", event.target.value)} /></label>
              <label>Email *<input required type="email" autoComplete="email" value={formData.email} onChange={(event) => setField("email", event.target.value)} /></label>
              <label>Phone<input type="tel" autoComplete="tel" value={formData.phone} onChange={(event) => setField("phone", event.target.value)} /></label>
              <label>Company *<input required autoComplete="organization" value={formData.company} onChange={(event) => setField("company", event.target.value)} /></label>
              <label>Title / Role<input autoComplete="organization-title" value={formData.title} onChange={(event) => setField("title", event.target.value)} /></label>
              <label>Website<input type="url" autoComplete="url" placeholder="https://" value={formData.website} onChange={(event) => setField("website", event.target.value)} /></label>
            </div>
          </section>

          <section className="form-section">
            <h3>Tell us more about your project</h3>
            <textarea required rows={6} placeholder="Describe your current challenges..." value={formData.message} onChange={(event) => setField("message", event.target.value)} />
          </section>

          <details className="form-section form-section-collapsible">
            <summary><span>Project goals</span><ChevronRight size={19} /></summary>
            <div className="form-section-content">
              <div className="choice-grid">
                {projectGoals.map((goal) => (
                  <label className="choice-pill" key={goal}>
                    <input type="checkbox" checked={formData.goals.includes(goal)} onChange={() => toggleChoice("goals", goal)} />
                    <span>{goal}</span>
                  </label>
                ))}
              </div>
              <input className="full-input" placeholder="Other goals..." value={formData.goalsOther} onChange={(event) => setField("goalsOther", event.target.value)} />
            </div>
          </details>

          <details className="form-section form-section-collapsible">
            <summary><span>On-premise / VPS systems</span><ChevronRight size={19} /></summary>
            <div className="form-section-content">
              <p>If you host any applications or databases on your own servers or a VPS, describe them below.</p>
              <textarea rows={4} placeholder="Example: SQL Server on Windows VPS, Docker on Ubuntu, internal IIS apps..." value={formData.onPremise} onChange={(event) => setField("onPremise", event.target.value)} />
            </div>
          </details>

          <details className="form-section form-section-collapsible">
            <summary><span>Cloud systems</span><ChevronRight size={19} /></summary>
            <div className="form-section-content">
              <div className="choice-grid">
                {cloudProviders.map((provider) => (
                  <label className="choice-pill" key={provider}>
                    <input type="checkbox" checked={formData.cloudProviders.includes(provider)} onChange={() => toggleChoice("cloudProviders", provider)} />
                    <span>{provider}</span>
                  </label>
                ))}
              </div>
              <input className="full-input" placeholder="Other cloud systems..." value={formData.cloudOther} onChange={(event) => setField("cloudOther", event.target.value)} />
            </div>
          </details>

          <details className="form-section form-section-collapsible">
            <summary><span>Real estate systems</span><ChevronRight size={19} /></summary>
            <div className="form-section-content">
              <div className="platform-group-grid">
                {Object.entries(realEstateSystems).map(([group, systems]) => (
                  <div className="platform-group" key={group}>
                    <h4>{group}</h4>
                    {systems.map((system) => (
                      <label className="choice-pill compact" key={`${group}-${system}`}>
                        <input type="checkbox" checked={formData.software.includes(system)} onChange={() => toggleChoice("software", system)} />
                        <span>{system}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              <input className="full-input" placeholder="Other platforms..." value={formData.softwareOther} onChange={(event) => setField("softwareOther", event.target.value)} />
            </div>
          </details>

          <label className="send-copy-row">
            <input type="checkbox" checked={formData.sendCC} onChange={(event) => setField("sendCC", event.target.checked)} />
            <span>Email me a copy of this inquiry</span>
          </label>

          <button className="button button-primary form-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send Message"}
          </button>
        </form>

        <aside className="contact-side-stack" aria-label="Session scheduling and next steps">
          <div className="scheduler-card">
            <span className="card-eyebrow">SESSION SCHEDULER</span>
            <h2>Ready to schedule your session now?</h2>
            <p>Submit Contact Us first. We will create a contact ID and use it to tie your session request to the right inquiry.</p>
            {contactId ? (
              <form className="scheduler-form" onSubmit={submitSchedule}>
                <div className="scheduler-contact-id">Contact ID <strong>{contactId}</strong></div>
                <label>Budget for the next step *
                  <select required value={scheduleData.budget} onChange={(event) => setScheduleField("budget", event.target.value)}>
                    <option value="">Choose a range</option>
                    <option>$500–$1,500</option>
                    <option>$1,500–$5,000</option>
                    <option>$5,000–$15,000</option>
                    <option>$15,000+</option>
                    <option>Not sure yet</option>
                  </select>
                </label>
                <label>Date *<input required type="date" value={scheduleData.date} onChange={(event) => setScheduleField("date", event.target.value)} /></label>
                <label>Preferred time *<input required type="time" value={scheduleData.time} onChange={(event) => setScheduleField("time", event.target.value)} /></label>
                <label>Anything we should prepare?<textarea rows={3} value={scheduleData.notes} onChange={(event) => setScheduleField("notes", event.target.value)} /></label>
                <button className="button button-primary" type="submit" disabled={isScheduling}>{isScheduling ? "Requesting..." : "Request the session"}</button>
                {scheduleStatus && <p className={scheduleStatus.tone === "error" ? "form-status error" : "form-status"} role={scheduleStatus.tone === "error" ? "alert" : "status"}>{scheduleStatus.text}</p>}
              </form>
            ) : (
              <div className="scheduler-locked">
                <strong>Send the project details first.</strong>
                <p>The scheduler opens as soon as the contact form is accepted.</p>
                <a className="text-link" {...routeLink("engagement")}>Review contract options <ArrowRight size={15} /></a>
              </div>
            )}
          </div>
          <div className="contact-side-note">
            <span className="card-eyebrow">AFTER THE CONVERSATION</span>
            <h3>We make the next decision easier.</h3>
            <ul>
              <li><CheckCircle2 size={16} /> Start with a Workflow Check, then choose Capped Hours or a Fixed Price project.</li>
              <li><CheckCircle2 size={16} /> Define the scope, assumptions, and deliverable.</li>
              <li><CheckCircle2 size={16} /> Start only when the next step makes sense.</li>
            </ul>
          </div>
          <div className="contact-side-note light">
            <span className="card-eyebrow">USEFUL TO BRING</span>
            <h3>Bring the real constraints.</h3>
            <p>A workflow that is stuck, the systems it touches, the deadline, and what the team is doing manually today are enough to begin.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
export default App;
