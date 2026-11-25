import { expect, test } from "@playwright/test";

// Desktop primary navigation is hidden at 760px and below (styles.css), where the mobile menu takes over.
const DESKTOP_NAV_MIN = 761;

const expectedVideos = [
  "https://unwhelm.net/assets/VectorDB.mp4",
  "https://unwhelm.net/assets/UnwhelmNetChatRAG.mp4",
  "https://unwhelm.net/assets/unwhelmNodeNet_ContactUs.mp4",
  "https://unwhelm.net/assets/net-core-api-full.mp4",
];

test("homepage is a focused route entry point", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < DESKTOP_NAV_MIN, "desktop navigation only");
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: /Build the system between the systems/i })
  ).toBeVisible();

  await expect(page.getByRole("button", { name: /Watch proof of work/i })).toBeVisible();
  const heroClip = page.locator(".hero-clip video");
  await expect(heroClip).toHaveAttribute("src", "/assets/clip-live-boundary-map.mp4");
  await expect(heroClip).toHaveAttribute("poster", "/assets/video-poster-live-boundary-map.jpg");
  await expect(heroClip).toHaveAttribute("aria-label", /When the workflow is real, but the system is scattered/);
  await expect(page.getByRole("heading", { level: 2, name: "When the workflow is real, but the system is scattered." })).toHaveCount(1);
  await expect(page.locator(".system-map, .signal-feed, .operator-panel")).toHaveCount(0);
  await expect(page.getByText("SOFTWARE • AI • AUTOMATION • CLOUD", { exact: true })).toBeVisible();
  await expect(page.getByText(/The gaps between them are where people still copy/i)).toBeVisible();
  await expect(page.getByText("Cloud + on-prem deployment")).toBeVisible();
  await expect(page.getByText("Working software")).toBeVisible();
  await expect(page.getByText("AI under application controls")).toBeVisible();
  await expect(page.getByText("Real code")).toBeVisible();
  await expect(page.getByText("Truth lives somewhere")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose the evidence trail you want to inspect." })).toHaveCount(0);
  await expect(page.getByText(/The site now behaves like the work/)).toHaveCount(0);
  const principles = page.getByRole("region", { name: "Operating principles" });
  const teaser = page.getByRole("region", { name: "Pricing" });
  await expect(principles).toBeVisible();
  await expect(teaser).toContainText("Workflow Check $250");
  await expect(teaser).toContainText("$550");
  await expect(teaser.locator(".pricing-small-print")).toContainText("$175/hr");
  await expect(teaser).not.toContainText("$650");
  await expect(teaser).not.toContainText(/off the hourly rate/);
  await expect(teaser.getByRole("button", { name: /See pricing/ })).toBeVisible();
  await expect(teaser.getByRole("button", { name: /Scope an integration/ })).toBeVisible();
  const order = await page.evaluate(() => {
    const els = ["section.scoreboard", "section.principles-section", "section.pricing-teaser"].map((q) => document.querySelector(q));
    return els.every(Boolean) && els[0]!.nextElementSibling === els[1] && els[1]!.nextElementSibling === els[2];
  });
  expect(order).toBe(true);

  await expect(page.getByRole("heading", { name: "Watch the engineering, then judge the fit." })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Case studies with the problem left in." })).toHaveCount(0);

  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNav.getByRole("link", { name: "Industries" })).toHaveAttribute("href", "/industries");
  await expect(primaryNav.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
  await expect(primaryNav.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
  await expect(primaryNav.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
  await expect(primaryNav.getByRole("link", { name: "Work" })).toHaveAttribute("href", "/work");
  await expect(primaryNav.getByRole("link", { name: "Services" })).toHaveAttribute("href", "/services");
  await expect(primaryNav.locator('a[href="/about/approach"]')).toHaveText("Approach");

  await page.screenshot({ path: "test-results/home-desktop.png", fullPage: true });
});

test("primary navigation opens separate pages instead of anchors", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < DESKTOP_NAV_MIN, "desktop navigation only");
  await page.goto("/");
  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });

  await primaryNav.getByRole("link", { name: "Work" }).click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.getByRole("heading", { level: 1, name: "Selected work with the problem left in." })).toBeVisible();
  await page.locator(".hub-links").getByRole("link", { name: /^Videos/ }).click();
  await expect(page).toHaveURL(/\/work\/videos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Watch the engineering, then judge the fit." })).toBeVisible();

  await primaryNav.getByRole("link", { name: "Services" }).click();
  await expect(page).toHaveURL(/\/services$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Home");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Services");
  await expect(page.getByRole("heading", { level: 1, name: "Not a stack. A set of boundary problems." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI works best like a junior team with precise instructions." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "“Build me a house.”" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "“Build me a joist.”" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "LLMs are excellent at some work and unreliable at other work." })).toBeVisible();
  await expect(page.getByText("PRIMARY WEAKNESSES")).toBeVisible();
  await expect(page.getByText("Why businesses feel this immediately")).toBeVisible();
  await expect(page.getByText(/a model that is merely plausible is not reliable enough/i)).toBeVisible();
  await expect(page.getByText("Retrieval supplies evidence.")).toBeVisible();
  await expect(page.locator(".services-grid, .agent-service-feature, .team-service-feature")).toHaveCount(0);
  const tenXCard = page.locator('.hub-links a[href="/services/10x-team"]');
  await expect(tenXCard).toContainText("Senior builders directing agent work");
  await tenXCard.click();
  await expect(page).toHaveURL(/\/services\/10x-team$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Services");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("10x team");
  await expect(page.getByRole("heading", { level: 1, name: "Pick the team that knows how to use coding agents." })).toBeVisible();
  await expect(page.getByText("Three groups are looking for the same kind of leverage.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The shiny demo gets you most of the way to a conversation." })).toBeVisible();
  await expect(page.getByText("It has to survive the business.")).toBeVisible();
  await expect(page.getByText("One senior group across the whole path.")).toBeVisible();

  await page.goto("/work/documents");
  await expect(page.getByRole("heading", { level: 1, name: "Document library." })).toBeVisible();
  await expect(page.getByText("Sheet to Propertyware Building Create")).toBeVisible();

  await page.goto("/about");
  const technicalDocuments = page.getByRole("link", { name: "Technical documents" });
  await expect(technicalDocuments).toHaveAttribute("href", "/work/documents");
  await technicalDocuments.click();
  await expect(page).toHaveURL(/\/work\/documents$/);
  await expect(page.getByRole("heading", { level: 1, name: "Document library." })).toBeVisible();

  await page.goto("/work/code");
  await expect(page.getByRole("heading", { level: 1, name: "Code samples, selected for inspection." })).toBeVisible();
  await expect(page.getByText("UnwhelmNet 2.0")).toBeVisible();
  await expect(page.getByText("AMBA to Owlbear Rodeo")).toHaveCount(0);
  const openWork = page.getByRole("link", { name: "Open selected work" });
  await expect(openWork).toHaveAttribute("href", "/work");
  await openWork.click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.getByRole("heading", { name: "Property-management systems integration" })).toBeVisible();

  await page.goto("/about");
  await page.locator(".hub-links").getByRole("link", { name: /^Approach/ }).click();
  await expect(page).toHaveURL(/\/about\/approach$/);
  await expect(page.getByRole("heading", { level: 1, name: "Clarity before custom work gets expensive." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The first engagement should leave you with more than a slide deck." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keep the expensive surprises visible." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with a conversation, then make the commitment concrete." })).toBeVisible();
  await expect(page.getByText("Start with a free 30-minute consult.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start with the workflow that keeps getting deferred." })).toBeVisible();
  await expect(page.getByText("Explain it at the right altitude")).toBeVisible();
});

test("work and git stay on the industry path", async ({ page }) => {
  await page.goto("/work");

  await expect(page.getByText("AMBA to Owlbear Rodeo")).toHaveCount(0);
  const headings = page.locator(".work-card h2");
  await expect(headings.nth(0)).toHaveText("Property-management systems integration");
  await expect(headings.nth(1)).toHaveText("Legal operations and matter workflows");
  await expect(headings.nth(2)).toHaveText("Healthcare operations and records workflows");

  const realEstate = page.getByRole("link", { name: "Real estate solutions" });
  await expect(realEstate).toHaveAttribute("href", "/industries/real-estate");
  await realEstate.click();
  await expect(page).toHaveURL(/\/industries\/real-estate$/);

  await page.goto("/services");
  const selectedWork = page.getByRole("link", { name: /Review selected work/i });
  await expect(selectedWork).toHaveAttribute("href", "/work");
  await selectedWork.click();
  await expect(page).toHaveURL(/\/work$/);

  await page.goto("/work/code");
  await expect(page.locator('a[href*="github.com/edmund-landgraf/UnwhelmNet20"]')).toHaveCount(0);
  await expect(page.locator(".git-grid")).toContainText("Private repo");
});

test("video demo selector swaps the working source", async ({ page }) => {
  await page.goto("/work/videos");

  const video = page.locator("video").first();
  await expect(video).toHaveAttribute("src", expectedVideos[0]);
  await expect(video).toHaveAttribute("poster", "/assets/video-poster-vector.svg");
  await page.getByRole("tab", { name: /Building a local RAG application/i }).click();
  await expect(video).toHaveAttribute("src", expectedVideos[1]);
  await expect(video).toHaveAttribute("poster", "/assets/video-poster-rag.svg");

  await page.getByRole("tab", { name: /Website-to-inbox engagement flow/i }).click();
  await expect(video).toHaveAttribute("src", expectedVideos[2]);
  await expect(video).toHaveAttribute("poster", "/assets/video-poster-contact.svg");

  await page.getByRole("tab", { name: /.NET Core API integration/i }).click();
  await expect(video).toHaveAttribute("src", expectedVideos[3]);
  await expect(video).toHaveAttribute("poster", "/assets/video-poster-dotnet.svg");
});

test("proof videos defer loading and use the branded poster", async ({ page }) => {
  await page.goto("/work/videos");
  const video = page.locator("video").first();
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).toHaveAttribute("poster", "/assets/video-poster-vector.svg");
});

test("mobile navigation routes to separate pages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Toggle navigation" }).click();
  const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
  for (const name of ["Services", "Industries", "Work", "About", "Pricing", "Contact"]) {
    await expect(mobileNav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(mobileNav.getByRole("link", { name: "Case studies", exact: true })).toHaveAttribute("href", "/work/case-studies");

  await mobileNav.getByRole("link", { name: "Work", exact: true }).click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.getByRole("heading", { level: 1, name: "Selected work with the problem left in." })).toBeVisible();

  await page.screenshot({ path: "test-results/work-mobile.png", fullPage: true });
});

test("rebuilt parity routes avoid old-site page links", async ({ page }) => {
  for (const route of ["/", "/services", "/services/integration", "/services/ai", "/services/ai/agents", "/services/ai/economics", "/services/automation", "/services/infrastructure", "/services/web-design", "/services/10x-team", "/industries", "/industries/real-estate", "/work", "/work/case-studies", "/work/videos", "/work/code", "/work/documents", "/about", "/about/approach", "/about/skills", "/about/resume", "/pricing", "/contact"]) {
    await page.goto(route);
    const oldSitePageLinks = page.locator('a[href^="https://unwhelm.net"]:not([href*="/assets/"])');
    await expect(oldSitePageLinks).toHaveCount(0);
  }
});
test("agents offering is linked from services and proof", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < DESKTOP_NAV_MIN, "desktop navigation only");
  await page.goto("/");
  const primary = page.getByRole("navigation", { name: "Primary navigation" });
  await primary.getByRole("button", { name: "Services pages" }).click();
  const servicesAgents = primary.locator('.nav-submenu a[href="/services/ai/agents"]');
  await expect(servicesAgents).toHaveText("AI agents");
  await servicesAgents.click();

  await expect(page).toHaveURL(/\/services\/ai\/agents$/);
  await expect(page).toHaveTitle("Build AI agents that do real work — UnwhelmNet");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Custom GPTs, Grok agents, and MCP integrations, connected to your systems with real guardrails."
  );
  await expect(page.getByRole("heading", { level: 1, name: "Build AI agents that do real work." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we build" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "One business workflow. One MCP surface. Any client." })).toBeVisible();
  await expect(page.getByText("Develop over stdio. Deploy HTTP when the workflow earns it.")).toBeVisible();
  await expect(page.getByText("The contract stays stable.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "ChatGPT" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Grok" }).click();
  await expect(page.getByRole("tab", { name: "Grok" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/Which lease renewals should my team call first/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live proof: the AMBA MCP control plane" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Services" })).toHaveClass(/active/);

  const startProject = page.locator(".agent-cta").getByRole("link", { name: "Start a project" });
  await expect(startProject).toHaveAttribute("href", "/contact");
  await startProject.click();
  await expect(page).toHaveURL(/\/contact$/);

  await page.goto("/work/videos");
  const ambaLink = page.getByRole("link", { name: "AI agents" });
  await expect(ambaLink).toHaveAttribute("href", "/services/ai/agents");
  await ambaLink.click();
  await expect(page).toHaveURL(/\/services\/ai\/agents$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { level: 1, name: "Build AI agents that do real work." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Toggle navigation" })).toBeVisible();
  await expect(page.locator(".desktop-nav")).toBeHidden();
});

test("industry and capability routes have buyer-facing page titles", async ({ page }) => {
  const routes = [
    ["/industries/real-estate", "Property-management integrations that remove manual reconciliation."],
    ["/industries/real-estate/institutional-investors", "Make portfolio data usable across the business."],
    ["/industries/real-estate/property-managers", "Automate the work around AppFolio or Propertyware."],
    ["/industries/real-estate/brokerages", "Make buyer and seller workflows agree with the listing data."],
    ["/industries/legal", "Connect matter workflows without losing control of the record."],
    ["/industries/healthcare", "Connect the operational work around the record."],
    ["/industries/financial", "Make the GL inspectable, then put the exceptions on a list."],
    ["/services/ai", "AI under application controls."],
    ["/services/ai/economics", "Make the cost model visible before the build gets expensive."],
    ["/services/web-design", "Modern web applications that fit the workflow."],
    ["/services/infrastructure", "Platform boundaries made explicit."],
    ["/work/case-studies", "Case studies with the problem left in."],
    ["/about/skills", "Senior implementation across software, data, AI, and infrastructure."],
  ] as const;

  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText("Rebuilt route")).toHaveCount(0);
  }

  // Merged pages keep the absorbed content as a second section.
  await page.goto("/work/case-studies");
  await expect(page.getByRole("heading", { level: 2, name: "Built for businesses with real workflows and limited patience for theater." })).toBeVisible();
  await page.goto("/about/skills");
  await expect(page.getByRole("heading", { level: 2, name: "Architecture diagrams that clarify ownership." })).toBeVisible();
});

test("real estate has dedicated industry paths", async ({ page }) => {
  await page.goto("/industries/real-estate");
  await expect(page.getByRole("link", { name: "See the property-manager path" }).first()).toHaveAttribute("href", "/industries/real-estate/property-managers");
  await expect(page.getByRole("link", { name: "See the institutional path" }).first()).toHaveAttribute("href", "/industries/real-estate/institutional-investors");
  await expect(page.getByRole("link", { name: "See the brokerage path" }).first()).toHaveAttribute("href", "/industries/real-estate/brokerages");

  await page.goto("/industries/real-estate/institutional-investors");
  await expect(page.getByRole("heading", { level: 1, name: "Make portfolio data usable across the business." })).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("src", "https://unwhelm.net/assets/VectorDB.mp4");
  await expect(page.getByText("PROPERTY MANAGEMENT / RENTFINDER")).toBeVisible();
  await expect(page.getByText(/3–6 hours to 10–20 minutes/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Real estate");

  await page.goto("/industries/real-estate/property-managers");
  await expect(page.getByRole("heading", { level: 1, name: "Automate the work around AppFolio or Propertyware." })).toBeVisible();
  await page.goto("/industries/real-estate/brokerages");
  await expect(page.getByRole("heading", { level: 1, name: "Make buyer and seller workflows agree with the listing data." })).toBeVisible();
});

test("hierarchy drives breadcrumbs, hub pages, and new routes", async ({ page }) => {
  const crumbs = [
    ["/services/ai/agents", ["Home", "Services", "AI", "AI agents"]],
    ["/services/ai/economics", ["Home", "Services", "AI", "AI economics"]],
    ["/industries/real-estate/property-managers", ["Home", "Industries", "Real estate", "Property managers"]],
    ["/work/code", ["Home", "Work", "Code"]],
    ["/about/resume", ["Home", "About", "Resume"]],
    ["/pricing", ["Home", "Pricing"]],
  ] as const;
  for (const [route, labels] of crumbs) {
    await page.goto(route);
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.locator("a, [aria-current=page]")).toHaveText([...labels]);
  }

  const hubs = [
    ["/services", ["/services/integration", "/services/ai", "/services/automation", "/services/infrastructure", "/services/web-design", "/services/10x-team"]],
    ["/industries", ["/industries/real-estate", "/industries/financial", "/industries/legal", "/industries/healthcare"]],
    ["/work", ["/work/case-studies", "/work/videos", "/work/code", "/work/documents"]],
    ["/about", ["/about/approach", "/about/skills", "/about/resume"]],
    ["/services/ai", ["/services/ai/agents", "/services/ai/economics"]],
  ] as const;
  for (const [route, children] of hubs) {
    await page.goto(route);
    const hub = page.locator(".hub-links").first();
    for (const child of children) {
      await expect(hub.locator(`a[href="${child}"]`)).toBeVisible();
    }
  }

  await page.goto("/services/integration");
  await expect(page.getByRole("heading", { level: 1, name: "Systems integration with clear ownership." })).toBeVisible();
  await page.goto("/services/automation");
  await expect(page.getByRole("heading", { level: 1, name: "Data and workflow automation around the systems you already use." })).toBeVisible();
  await page.goto("/about/resume");
  await expect(page.getByRole("heading", { level: 1, name: "Principal AI & Systems Integration Architect" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Multi-state property-management firm — Business Software Architect" })).toBeVisible();
  for (const name of ["Propertyware ETL warehouse", "Document Intake & Identity Automation", "Context-Indexed Knowledge & RAG"]) await expect(page.getByRole("heading", { level: 3, name })).toBeVisible();
  await expect(page.getByText("Structured logs (Serilog), trace IDs, correlation")).toBeVisible();
  await expect(page.getByText("Founder and technical owner")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "RentFinder CMA & Operational Intelligence" })).toBeVisible();
  await expect(page.getByRole("link", { name: /download/i })).toHaveCount(0);

  await page.goto("/markdown-viewer?file=SheetToPropertywareBuildingCreate.md");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Documents");
  await expect(page.getByText("A multi-state property-management firm").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/northpoint/i);
});

test("desktop sub-menus open from the keyboard and close on Escape", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < DESKTOP_NAV_MIN, "desktop navigation only");
  await page.goto("/");
  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  const toggle = primaryNav.getByRole("button", { name: "Industries pages" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const legal = primaryNav.getByRole("link", { name: "Legal" });
  await expect(legal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await legal.click();
  await expect(page).toHaveURL(/\/industries\/legal$/);
  await expect(primaryNav.getByRole("link", { name: "Industries" })).toHaveClass(/active/);
});

test("old URLs resolve to the new pages in the client", async ({ page }) => {
  await page.goto("/proof");
  await expect(page).toHaveURL(/\/work\/videos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Watch the engineering, then judge the fit." })).toBeVisible();
  await page.goto("/real-estate/property-managers");
  await expect(page).toHaveURL(/\/industries\/real-estate\/property-managers$/);
});

test("canonical and og:url follow the new URL", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < DESKTOP_NAV_MIN, "desktop navigation only");
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://unwhelm.net/pricing");
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", "https://unwhelm.net/pricing");
});

test("Escape inside a desktop sub-menu closes it and returns focus to its toggle", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  const toggle = primaryNav.getByRole("button", { name: "Work pages" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const codeLink = primaryNav.getByRole("link", { name: "Code" });
  await codeLink.focus();
  await expect(codeLink).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await expect(primaryNav.locator("#nav-menu-work")).toBeHidden();
});

test("Escape closes the mobile menu and returns focus to the menu button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Toggle navigation" });
  await menuButton.click();
  const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobileNav).toBeVisible();
  await mobileNav.getByRole("link", { name: "Pricing", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(mobileNav).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
});

test("mobile menu keeps Pricing reachable above the Contact button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  const mobileNav = page.getByRole("navigation", { name: "Mobile navigation" });
  const pricing = mobileNav.getByRole("link", { name: "Pricing", exact: true });
  await pricing.scrollIntoViewIfNeeded();
  const pricingBox = await pricing.boundingBox();
  const contactBox = await mobileNav.getByRole("link", { name: "Contact", exact: true }).boundingBox();
  expect(pricingBox && contactBox && pricingBox.y + pricingBox.height <= contactBox.y).toBeTruthy();
  await pricing.click();
  await expect(page).toHaveURL(/\/pricing$/);
});

test("BreadcrumbList JSON-LD matches the visible breadcrumbs", async ({ page }) => {
  for (const route of ["/services/ai/agents", "/industries/real-estate/property-managers", "/work/code", "/about/resume", "/pricing"]) {
    await page.goto(route);
    const visible = await page.getByRole("navigation", { name: "Breadcrumb" }).locator("a, [aria-current=page]").allTextContents();
    const scripts = page.locator('script[type="application/ld+json"]#breadcrumb-jsonld');
    await expect(scripts).toHaveCount(1);
    const data = JSON.parse((await scripts.textContent()) ?? "{}");
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement.map((item: { name: string }) => item.name)).toEqual(visible.map((text) => text.trim()));
    expect(data.itemListElement.at(-1).item).toBe(`https://unwhelm.net${route}`);
  }
  await page.goto("/");
  await expect(page.locator("#breadcrumb-jsonld")).toHaveCount(0);
});
test("home boundary-map clip plays once and holds its last frame; other clips loop", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator(".hero-clip video");
  await expect(hero).not.toHaveAttribute("loop", /.*/);
  expect(await hero.evaluate((video: HTMLVideoElement) => ({ autoplay: video.autoplay, muted: video.muted, playsInline: video.playsInline, loop: video.loop }))).toEqual({ autoplay: true, muted: true, playsInline: true, loop: false });
  await hero.evaluate(async (video: HTMLVideoElement) => {
    video.muted = true;
    video.preload = "auto";
    video.playbackRate = 8;
    await video.play();
  });
  await expect.poll(() => hero.evaluate((video: HTMLVideoElement) => video.ended), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(500);
  const state = await hero.evaluate((video: HTMLVideoElement) => ({ paused: video.paused, ended: video.ended, time: video.currentTime, duration: video.duration }));
  expect(state.paused).toBe(true);
  expect(state.ended).toBe(true);
  expect(state.duration - state.time).toBeLessThan(0.1);

  await page.goto("/services/ai/agents");
  await expect(page.locator(".motion-clip-card video")).toHaveAttribute("loop", /.*/);
});

test("reduced-motion users see the hero poster instead of the clip", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(".hero-clip video")).toHaveCount(0);
  await expect(page.locator(".hero-clip img")).toHaveAttribute("src", "/assets/video-poster-live-boundary-map.jpg");
  await context.close();
});
test("route board lives at the bottom of /work", async ({ page }) => {
  await page.goto("/work");
  await expect(page.getByRole("heading", { name: "Choose the evidence trail you want to inspect." })).toBeVisible();
  for (const label of ["Real Estate Solutions", "AI Solutions", "Technical Skills", "Videos"]) {
    await expect(page.locator(".directory-card").filter({ hasText: label })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /^Documents/ })).toBeVisible();
  await expect(page.getByText(/The site now behaves like the work/)).toHaveCount(0);
});

test("home pricing teaser buttons navigate", async ({ page }) => {
  await page.goto("/");
  const teaser = page.getByRole("region", { name: "Pricing" });
  await teaser.getByRole("button", { name: /See pricing/ }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await page.goto("/");
  await page.getByRole("region", { name: "Pricing" }).getByRole("button", { name: /Scope an integration/ }).click();
  await expect(page).toHaveURL(/\/contact$/);
});

test("industry pages share the IndustryHero with clip or placeholder", async ({ page }) => {
  await page.goto("/industries/real-estate");
  const hero = page.locator(".industry-hero");
  await expect(hero.getByRole("heading", { level: 1 })).toBeVisible();
  const video = hero.locator("video");
  await expect(video).toHaveAttribute("src", "/assets/clip-vacancy-turnover.mp4");
  await expect(video).toHaveAttribute("poster", "/assets/video-poster-vacancy-turnover-end.jpg");
  expect(await video.evaluate((v: HTMLVideoElement) => v.loop || !v.muted)).toBe(false);
  await expect(hero.locator("figcaption")).toHaveText("Move-out to move-in: one slipped dependency, every downstream date updates.");
  await expect(hero.getByRole("button", { name: /Scope an integration/ })).toBeVisible();
  await expect(hero.getByRole("button", { name: /See pricing/ })).toBeVisible();

  for (const path of ["/industries/legal", "/industries/healthcare", "/industries/financial", "/industries/real-estate/institutional-investors", "/industries/real-estate/brokerages"]) {
    await page.goto(path);
    await expect(page.locator(".industry-hero .industry-hero-diagram")).toBeVisible();
    await expect(page.locator(".industry-hero video")).toHaveCount(0);
  }

  await page.goto("/industries/real-estate/property-managers");
  await expect(page.locator('video[src="/assets/clip-vacancy-turnover.mp4"]')).toHaveCount(1);
});

test("next-step banner copy follows the route and keeps the button", async ({ page }) => {
  await page.goto("/services/ai");
  const panel = page.locator(".parity-next-panel");
  await expect(panel).toContainText("Ready to put AI to work under real rules?");
  await expect(panel.getByRole("button", { name: /Start a project/ })).toBeVisible();
  await page.goto("/industries/legal");
  await expect(page.locator(".parity-next-panel")).toContainText("Where do matter details get typed twice?");
});

const caseSlugs = ["propertyware-rently-integration", "synthetic-data-testing", "zillow-reso-platform", "institutional-data-repository", "automated-cma-vacancy-pricing"];

test("case-study hub cards link to detail pages and PDFs", async ({ page }) => {
  await page.goto("/work/case-studies");
  const reads = page.getByRole("link", { name: /Read the case study/ });
  await expect(reads).toHaveCount(caseSlugs.length);
  for (const slug of caseSlugs) {
    await expect(page.locator(`a[href="/work/case-studies/${slug}"]`)).toHaveCount(1);
    await expect(page.locator(`a[href="/case-studies/${slug}.pdf"]`)).toHaveText(/Download PDF/);
    await expect(page.locator(`a[href="/case-studies/${slug}.pdf"]`)).toHaveAttribute("download", `${slug}.pdf`);
  }
  await reads.nth(1).click();
  await expect(page).toHaveURL(/\/work\/case-studies\/synthetic-data-testing$/);
});

test("case-study detail pages follow the fixed template", async ({ page }) => {
  for (const slug of caseSlugs) {
    await page.goto(`/work/case-studies/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const term of ["Client type", "Problem", "Stack", "Outcome"]) await expect(page.locator(".case-glance dt", { hasText: term })).toBeVisible();
    const headings = await page.locator(".case-study-page h2").allTextContents();
    expect(headings.slice(0, 5)).toEqual(["Challenge", "Solution", "Results", "Benefits", "Technical highlights"]);
    await expect(page.locator(".case-benefits > div")).toHaveCount(4);
    await expect(page.locator(".case-conclusion")).toBeVisible();
    await expect(page.locator(".parity-next-panel").getByRole("button", { name: /Start a project/ })).toBeVisible();
    await expect(page.locator(".breadcrumbs")).toContainText("Case studies");
  }
  await page.goto("/work/case-studies/synthetic-data-testing");
  await expect(page.locator(".case-table")).toContainText(["faker, pandas, pyodbc"]);
  await page.goto("/work/case-studies/automated-cma-vacancy-pricing");
  await expect(page.locator(".case-study-page")).not.toContainText("Northpoint");
});

test("Resume is listed under About in the menus and the route stays live", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < DESKTOP_NAV_MIN, "desktop navigation only");
  await page.goto("/");
  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNav.locator('#nav-menu-about a[href="/about/resume"]')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(page.locator('.mobile-nav a[href="/about/resume"]')).toBeVisible();
  await page.goto("/about/resume");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("pricing page shows the options, one small-print rate line, then the agent callout", async ({ page }) => {
  await page.goto("/pricing");
  for (const [title, price] of [["Workflow Check", "$250 fixed"], ["Capped Hours, 4", "$550"], ["Capped Hours, 8", "$900"], ["Fixed Price", "from $3K"]]) {
    const card = page.locator(".pricing-option-grid .contract-type-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await expect(card).toContainText(price);
  }
  await expect(page.locator(".agent-callout")).toContainText("Get a free AI agent for comms.");
  await expect(page.locator(".agent-callout")).toContainText("not locked inside someone else's system.");
  await expect(page.locator(".engagement-pricing-note")).toHaveCount(0);
  await expect(page.getByText("Typical starting points", { exact: false })).toHaveCount(0);
  await expect(page.locator(".pricing-option-grid .contract-type-card").first()).toContainText("Up to 3 hours on one workflow you pick.");
  await expect(page.locator(".pricing-big-project")).toHaveText("Big project? We'll check the most valuable slice first and scope the rest into a proposal.");
  const smallPrint = page.locator(".engagement-options-section .pricing-small-print:not(.pricing-big-project)");
  await expect(smallPrint).toHaveText("Standard hourly rate: $175/hr. These are starting points, not a substitute for scope; the free 30-minute consult makes the assumptions visible before any paid commitment.");
  await expect(page.locator(".engagement-options-section .container > :not(.pricing-option-grid)").getByText(/\$175\/hr/)).toHaveCount(1);
  const order = await page.locator(".engagement-options-section .container > *").evaluateAll((els) => els.map((el) => el.className));
  const grid = order.findIndex((c) => c.includes("pricing-option-grid"));
  expect(order[grid + 1]).toContain("pricing-examples");
  expect(order[grid + 2]).toContain("pricing-big-project");
  expect(order[grid + 3]).toContain("pricing-small-print");
  expect(order[grid + 4]).toContain("agent-callout");
  await expect(page.locator("main")).not.toContainText(/prepaid|\$650/i);
});

test("services cards carry lazy play-once clips and sub-pages reuse the hero", async ({ page }) => {
  await page.goto("/services");
  const clips = page.locator(".hub-links video.hub-card-clip");
  await expect(clips).toHaveCount(7);
  for (const v of await clips.all()) {
    expect(await v.evaluate((el: HTMLVideoElement) => ({ loop: el.loop, muted: el.muted, inline: el.playsInline, preload: el.preload, autoplay: el.autoplay }))).toEqual({ loop: false, muted: true, inline: true, preload: "none", autoplay: false });
    await expect(v).toHaveAttribute("poster", /\.(jpg|png)$/);
  }
  for (const [path, src] of [["/services/integration", "clip-svc-integration"], ["/services/ai", "clip-ai-rules-gate"], ["/services/automation", "clip-svc-automation-v2"], ["/services/infrastructure", "clip-svc-infrastructure-v2"], ["/services/web-design", "clip-svc-web"], ["/services/10x-team", "clip-svc-10x-team-v2"]]) {
    await page.goto(path);
    await expect(page.locator(`.industry-hero video[src="/assets/${src}.mp4"]`)).toHaveCount(1);
    await expect(page.locator(`video[src="/assets/${src}.mp4"]`)).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  }
  await page.goto("/services/ai/agents");
  await expect(page.locator('video[src="/assets/clip-ai-rules-gate.mp4"]')).toHaveCount(1);
});

test("reduced motion shows service card posters only", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/services");
  await expect(page.locator(".hub-links video")).toHaveCount(0);
  await expect(page.locator(".hub-links img.hub-card-clip")).toHaveCount(7);
});

test("agent setup page has the hero, steps, connect guide, FAQ, and banner", async ({ page }) => {
  await page.goto("/services/agent-setup");
  await expect(page.getByRole("heading", { level: 1, name: "Your AI agent, connected to our team." })).toBeVisible();
  const video = page.locator('.industry-hero video[src="/assets/clip-svc-agent-setup.mp4"]');
  await expect(video).toHaveCount(1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.loop)).toBe(false);
  await expect(video).toHaveAttribute("poster", "/assets/video-poster-svc-agent-setup.jpg");
  await expect(page.locator('video[src="/assets/clip-live-boundary-map.mp4"]')).toHaveCount(0);
  await expect(page.locator(".agent-steps li")).toHaveCount(3);
  for (const name of ["Proposal agent", "Contract agent", "Project manager agent"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.locator(".agent-connect-steps li")).toHaveCount(3);
  await expect(page.locator(".agent-connect")).toContainText("any MCP-capable app");
  await expect(page.locator(".agent-connect")).toContainText("https://mcp.unwhelm.net/mcp Ready for Grok.");
  await expect(page.locator("#agent-pay + p")).toContainText("Model and API usage stays on your account.");
  await expect(page.locator(".agent-connect")).toContainText("https://mcp.unwhelm.net/mcp Ready for Grok.");
  await expect(page.locator(".agent-setup-page")).not.toContainText("example.invalid");
  await page.locator(".parity-faq summary", { hasText: "Do I need a paid plan?" }).click();
  await expect(page.locator(".parity-faq details[open] p").first()).toHaveText("Usually yes. ChatGPT needs Plus, Claude Free allows one connector (Pro is $20/mo), Gemini needs Google AI Pro, Grok and Mistral work on any plan.");
  await page.locator(".parity-faq summary", { hasText: "Do I need a paid plan?" }).click();
  await expect(page.locator(".agent-setup-page")).not.toContainText("at least $20");
  await expect(page.locator(".parity-faq details")).toHaveCount(3);
  await expect(page.locator(".agent-steps")).toContainText("Our people step in whenever needed.");
  await expect(page.locator(".parity-next-panel")).toContainText("Tell us which AI you use.");
  await expect(page.locator(".parity-next-panel").getByRole("button", { name: /Start a project/ })).toBeVisible();
  await expect(page.locator(".breadcrumbs")).toContainText("Agent setup");
});

test("agent setup is listed under Services and linked from the pricing callout", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < DESKTOP_NAV_MIN, "desktop navigation only");
  await page.goto("/services");
  await expect(page.locator('.hub-links a[href="/services/agent-setup"]')).toHaveCount(1);
  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(primaryNav.locator('a[href="/services/agent-setup"]')).toHaveCount(1);
  await page.goto("/pricing");
  const callout = page.locator(".agent-callout");
  await expect(callout).toContainText("Workflow Check, Capped Hours, or Fixed Price");
  await expect(callout).not.toContainText("4- or 8-hour");
  await callout.getByRole("link", { name: /agent setup/ }).click();
  await expect(page).toHaveURL(/\/services\/agent-setup$/);
});

test("cleanup: anonymized, consistent pricing names, CMA figure", async ({ page }) => {
  for (const path of ["/", "/about/resume", "/industries/real-estate/institutional-investors", "/work/case-studies", "/work/case-studies/automated-cma-vacancy-pricing", "/pricing"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText(/northpoint/i);
  }
  await page.goto("/work/case-studies/automated-cma-vacancy-pricing");
  await expect(page.locator(".case-table").first()).toContainText("10–20 minutes");
  await expect(page.locator(".case-study-page")).not.toContainText("3–4 days");
  await page.goto("/pricing");
  await expect(page.locator("main")).not.toContainText(/Statement of Work \/|Workflow check|capped hours/);
  await expect(page.locator("main")).toContainText("Standard hourly rate: $175/hr.");
  await expect(page.locator("main")).toContainText("If you go ahead within 30 days, the $250 is credited back.");
  await expect(page.locator("main")).toContainText("Up to 4 hours for the whole job, from statement of work to finished deliverable, never billed past the cap. Plus a free 30 minutes: use it for a consult, or skip the consult and get 4.5 hours of work.");
  await expect(page.locator("main")).toContainText("Up to 8 hours for the whole job, from statement of work to finished deliverable, never billed past the cap. Plus a free 30 minutes: use it for a consult, or skip the consult and get 8.5 hours of work.");
  await expect(page.locator("main")).not.toContainText(/counts toward the project|toward a written statement of work|Same terms, up to/);
  await page.goto("/work/case-studies/zillow-reso-platform");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Zillow + RESO buyer–seller data platform");
  expect(await page.title()).toContain("buyer–seller");
});

test("insights article renders verbatim with tables, links, and meta", async ({ page }) => {
  await page.goto("/insights/who-pays-for-the-ai");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Who Pays for the AI? Four Ways to Add AI to Your Business, and What Each One Costs.");
  await expect(page).toHaveTitle("Who Pays for the AI? Four Ways to Add AI to Your Business, and What Each One Costs. — UnwhelmNet");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Who pays for the AI?");
  await expect(page.locator(".article-body table")).toHaveCount(6);
  await expect(page.locator(".article-body")).toContainText("Before \"which model?\", ask:");
  await expect(page.locator(".article-body")).not.toContainText("author: UnwhelmNet");
  await expect(page.locator('.article-body a[href="/services/ai/economics"]')).toHaveCount(1);
  await expect(page.locator('.article-body a[href="https://www.runpod.io/pricing"]')).toHaveCount(1);
  await page.locator('.article-body a[href="/pricing"]').click();
  await expect(page).toHaveURL(/\/pricing$/);
  for (const path of ["/services/agent-setup", "/services/ai/economics"]) {
    await page.goto(path);
    await page.locator('.article-teaser a[href="/insights/who-pays-for-the-ai"]').click();
    await expect(page).toHaveURL(/\/insights\/who-pays-for-the-ai$/);
  }
});

test("insights article tables scroll inside their wrapper on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/insights/who-pays-for-the-ai");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("home agent banner sits directly below the hero", async ({ page }) => {
  for (const width of [1600, 1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const banner = page.locator("section.agent-banner");
    await expect(banner).toHaveCount(1);
    expect(await page.evaluate(() => { const b = document.querySelector("section.agent-banner"); return !b?.previousElementSibling && b?.nextElementSibling?.classList.contains("hero"); })).toBe(true);
    const header = (await page.locator("header").first().boundingBox())!;
    expect(Math.abs((await banner.boundingBox())!.y - (header.y + header.height))).toBeLessThan(2);
    await expect(banner.getByRole("heading", { level: 2 })).toHaveText("Run your business on Grok or ChatGPT. We'll connect it to the software you already use.");
    await expect(banner.locator(".agent-banner-note")).toHaveText("Not affiliated with OpenAI or xAI.");
    await expect(banner.locator("img, svg[aria-label], picture")).toHaveCount(0);
    await expect(banner).not.toContainText(/official|partner|powered by/i);
    const box = (await banner.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(width - 1);
    const link = banner.getByRole("link", { name: "Set up my agent" });
    await expect(link).toHaveAttribute("href", "/services/agent-setup");
    await link.click();
    await expect(page).toHaveURL(/\/services\/agent-setup$/);
  }
});

test("case-study PDFs are real files served as application/pdf", async ({ page, request }) => {
  for (const slug of caseSlugs) {
    const response = await request.get(`/case-studies/${slug}.pdf`);
    expect(response.status(), slug).toBe(200);
    expect(response.headers()["content-type"], slug).toContain("application/pdf");
    expect((await response.body()).subarray(0, 5).toString(), slug).toBe("%PDF-");
    await page.goto(`/work/case-studies/${slug}`);
    const link = page.locator("header .case-study-print");
    await expect(link).toHaveAttribute("href", `/case-studies/${slug}.pdf`);
    await expect(link).toHaveAttribute("download", `${slug}.pdf`);
  }
  await page.goto("/work/case-studies/synthetic-data-testing?print=1");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("about page layout: intro band, capability row, hub row, proof banner", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Direct technical ownership.");
  await expect(page.getByText("Senior implementation across web applications, APIs, data, AI")).toHaveCount(0);
  const heading = (await page.locator(".about-intro-band .about-heading-block").boundingBox())!;
  const copy = (await page.locator(".about-intro-copy").boundingBox())!;
  expect(Math.abs(heading.y - copy.y)).toBeLessThan(4);
  expect(copy.x).toBeGreaterThan(heading.x + heading.width - 1);
  await expect(page.locator(".about-intro-copy")).toContainText(/Reno.Tahoe region/);
  const tiles = page.locator(".about-capability-grid > div");
  await expect(tiles).toHaveCount(3);
  const tileBoxes = await Promise.all([0, 1, 2].map(async (i) => (await tiles.nth(i).boundingBox())!));
  expect(new Set(tileBoxes.map((b) => Math.round(b.y))).size).toBe(1);
  expect(new Set(tileBoxes.map((b) => Math.round(b.height))).size).toBe(1);
  const signal = (await page.locator(".about-signal-panel").boundingBox())!;
  expect(signal.y).toBeLessThan(tileBoxes[0].y);
  const hubCards = page.locator(".hub-links .hub-link-card");
  await expect(hubCards).toHaveCount(3);
  const hubBoxes = await Promise.all([0, 1, 2].map(async (i) => (await hubCards.nth(i).boundingBox())!));
  expect(new Set(hubBoxes.map((b) => Math.round(b.y))).size).toBe(1);
  expect(new Set(hubBoxes.map((b) => Math.round(b.height))).size).toBe(1);
  const isLast = await page.evaluate(() => { const strip = document.querySelector(".about-proof-strip"); return strip?.parentElement?.lastElementChild === strip; });
  expect(isLast).toBe(true);
  const strip = (await page.locator(".about-proof-strip").boundingBox())!;
  const band = (await page.locator(".about-intro-band").boundingBox())!;
  expect(Math.abs(strip.width - band.width)).toBeLessThan(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/about");
  const mHeading = (await page.locator(".about-intro-band .about-heading-block").boundingBox())!;
  const mCopy = (await page.locator(".about-intro-copy").boundingBox())!;
  expect(mCopy.y).toBeGreaterThan(mHeading.y + mHeading.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

const whoPaysShort = "Who Pays for the AI? Four Ways to Add AI to Your Business";
const whoPaysFull = "Who Pays for the AI? Four Ways to Add AI to Your Business, and What Each One Costs.";

test("insights hub lists articles and the article breadcrumb goes through Insights", async ({ page }) => {
  await page.goto("/insights");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Insights.");
  await expect(page).toHaveTitle("Insights — UnwhelmNet");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Insights");
  await expect(page.locator(".hub-links")).toHaveCount(0);
  const rows = page.getByRole("listbox", { name: /Insights articles/ }).getByRole("option");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(whoPaysShort);
  await expect(page.locator('footer a[href="/insights"]')).toHaveText("Insights");
  await rows.first().click();
  await expect(page).toHaveURL(/\/insights\/who-pays-for-the-ai$/);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Insights" })).toHaveAttribute("href", "/insights");
  const jsonLd = JSON.parse((await page.locator("#breadcrumb-jsonld").textContent()) ?? "{}");
  expect(jsonLd.itemListElement.map((item: { name: string }) => item.name)).toEqual(["Home", "Insights", "Who pays for the AI?"]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/insights");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("insights selects the newest article by default and shows its full body with no repeated title", async ({ page }) => {
  await page.goto("/insights");
  const rows = page.locator(".list-detail-rows [role=option]");
  const first = rows.first();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(first).toHaveClass(/is-selected/);
  await expect(first.locator("time")).toHaveAttribute("datetime", "2026-10-21");
  const dates = await rows.locator("time").evaluateAll((els) => els.map((el) => el.getAttribute("datetime") ?? ""));
  expect(dates).toEqual([...dates].sort().reverse());
  const pane = page.locator(".list-detail-detail");
  await expect(first).toHaveAttribute("aria-controls", (await pane.getAttribute("id"))!);
  // One small meta line, then the whole article.
  await expect(pane.locator(".list-detail-meta time")).toHaveAttribute("datetime", "2026-10-21");
  await expect(pane.locator(".list-detail-meta time")).toHaveText("October 21, 2026");
  await expect(pane.locator(".list-detail-meta")).toContainText(/\d+ min read/);
  await expect(pane.locator(".article-body")).toContainText('Before "which model?", ask:');
  await expect(pane.locator(".article-body")).toContainText("The short version");
  await expect(pane.locator(".article-body table")).toHaveCount(6);
  await expect(pane.getByRole("link", { name: "Open", exact: true })).toHaveCount(0);
  await expect(pane.locator(".list-detail-action")).toHaveCount(0);
  // The pane's heading exists for assistive tech (h2 under the page h1) but is visually hidden; the row is the only visible title.
  const heading = pane.getByRole("heading", { level: 2, name: whoPaysFull });
  await expect(heading).toHaveClass(/visually-hidden/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const visibleTitles = await page.locator("main *").evaluateAll((els, short) => els.filter((el) => {
    const text = (el as HTMLElement).innerText?.trim() ?? "";
    const box = el.getBoundingClientRect();
    return el.children.length === 0 && text.startsWith(short as string) && box.width > 2 && box.height > 2;
  }).length, whoPaysShort);
  expect(visibleTitles).toBe(1);
  // Article sections sit one level below the pane heading on /insights.
  await expect(pane.locator(".article-body h3.article-h2").first()).toBeVisible();
});

test("insights article deep link opens the list-detail with that article selected and its own meta", async ({ page }) => {
  await page.goto("/insights/who-pays-for-the-ai");
  await expect(page.locator(".list-detail-rows [role=option]").first()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(whoPaysFull);
  await expect(page.locator(".section-heading-title")).toHaveText("Insights.");
  await expect(page).toHaveTitle(`${whoPaysFull} — UnwhelmNet`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://unwhelm.net/insights/who-pays-for-the-ai");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /who pays each time someone uses the AI/);
  await expect(page.locator(".list-detail-detail .article-body h2.article-h2").first()).toBeVisible();
});

test("insights row click puts the article in the URL, keeps focus on the row, and Back returns to /insights", async ({ page }) => {
  await page.goto("/insights");
  const row = page.locator(".list-detail-rows [role=option]").first();
  await row.click();
  await expect(page).toHaveURL(/\/insights\/who-pays-for-the-ai$/);
  await expect(page).toHaveTitle(`${whoPaysFull} — UnwhelmNet`);
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(row).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Insights.");
  await expect(page.locator(".list-detail-rows [role=option]").first()).toHaveAttribute("aria-selected", "true");
});

test("insights list stays sticky beside the article on desktop and stacks above it on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/insights");
  const list = page.locator(".list-detail-list");
  const pane = page.locator(".list-detail-detail");
  const [listBox, paneBox] = [await list.boundingBox(), await pane.boundingBox()];
  expect(paneBox!.width).toBeGreaterThan(listBox!.width * 1.7);
  await page.evaluate(() => window.scrollTo(0, 1800));
  await expect.poll(async () => (await list.boundingBox())!.y).toBeLessThan(40);
  expect((await list.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const [mList, mPane] = [await list.boundingBox(), await pane.boundingBox()];
  expect(mPane!.y).toBeGreaterThan(mList!.y + mList!.height - 1);
  await page.evaluate(() => window.scrollTo(0, 1800));
  expect((await list.boundingBox())!.y).toBeLessThan(0);
});

test("home free-guide banner promotes the insights article right after the hero", async ({ page }) => {
  await page.goto("/");
  const banner = page.locator("section.guide-banner");
  await expect(banner).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector("section.hero")?.nextElementSibling?.classList.contains("guide-banner"))).toBe(true);
  await expect(banner).toContainText("FREE GUIDE");
  await expect(banner).not.toContainText(/white paper/i);
  await expect(banner.getByRole("heading", { level: 2 })).toHaveText("Who Pays for the AI? Four Ways to Add AI to Your Business, and What Each One Costs.");
  await expect(banner.locator("p")).toHaveText("The same 40 tasks a month can cost about $0.01 or $60, depending on how the AI is wired. Real numbers for all four approaches.");
  const link = banner.getByRole("link", { name: "Read the guide" });
  await expect(link).toHaveAttribute("href", "/insights/who-pays-for-the-ai");
  await link.click();
  await expect(page).toHaveURL(/\/insights\/who-pays-for-the-ai$/);
});

test("batch: nav lists Insights, Resume, AI agents and AI economics", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav.locator(".nav-list > li > a")).toHaveText(["Services", "Industries", "Work", "About", "Insights", "Pricing", "Contact"]);
  await expect(nav.locator('#nav-menu-services a[href="/services/ai/agents"]')).toHaveText("AI agents");
  await expect(nav.locator('#nav-menu-services a[href="/services/ai/economics"]')).toHaveText("AI economics");
  await expect(nav.locator('#nav-menu-insights a[href="/insights/who-pays-for-the-ai"]')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  for (const href of ["/insights", "/about/resume", "/services/ai/agents", "/services/ai/economics"]) await expect(page.locator(`.mobile-nav a[href="${href}"]`)).toBeVisible();
});

test("batch: real estate links its three audience pages and home links all five case studies", async ({ page }) => {
  await page.goto("/industries/real-estate");
  for (const href of ["/industries/real-estate/institutional-investors", "/industries/real-estate/property-managers", "/industries/real-estate/brokerages"]) await expect(page.locator(`.hub-links a[href="${href}"]`)).toBeVisible();
  await page.goto("/");
  const cases = page.locator(".home-case-grid a");
  await expect(cases).toHaveCount(5);
  for (const slug of ["propertyware-rently-integration", "synthetic-data-testing", "zillow-reso-platform", "institutional-data-repository", "automated-cma-vacancy-pricing"]) await expect(page.locator(`.home-case-grid a[href="/work/case-studies/${slug}"]`)).toHaveCount(1);
});

test("batch: no Cursor claims; any MCP-capable app instead", async ({ page }) => {
  for (const path of ["/", "/services/ai/agents", "/services/agent-setup"]) {
    await page.goto(path);
    await expect(page.locator("main")).not.toContainText("Cursor");
    const labels = await page.locator("main [aria-label]").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? "").join(" "));
    expect(labels, path).not.toContain("Cursor");
  }
});

test("batch: Capped Hours savings and the price-signal strip", async ({ page }) => {
  await page.goto("/pricing");
  const card4 = page.locator(".contract-type-card").filter({ has: page.getByRole("heading", { name: "Capped Hours, 4", exact: true }) });
  const card8 = page.locator(".contract-type-card").filter({ has: page.getByRole("heading", { name: "Capped Hours, 8", exact: true }) });
  await expect(card4.locator(".pricing-option-saving")).toHaveText("Save $237.50 vs. $787.50 for 4.5 hrs at $175/hr");
  await expect(card8.locator(".pricing-option-saving")).toHaveText("Save $587.50 vs. $1,487.50 for 8.5 hrs at $175/hr");
  await expect(page.locator("main")).not.toContainText(/first 30 minutes|No upfront fee/);
  for (const path of ["/contact", "/about/approach"]) {
    await page.goto(path);
    await expect(page.locator("main")).not.toContainText(/first 30 minutes|No upfront fee|30 minutes are free/);
    await expect(page.locator("main")).toContainText("free 30-minute consult");
    await expect(page.locator("main")).not.toContainText(/4\.5 hours|8\.5 hours/);
  }
});

test("batch: /services shows 9 cards as three rows of 3, last row centered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/services");
  const cards = page.locator(".hub-links-grid > li");
  await expect(cards).toHaveCount(9);
  const boxes = await cards.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: Math.round(r.y), w: r.width }; }));
  const rows = [...new Set(boxes.map((b) => b.y))];
  expect(rows).toHaveLength(3);
  for (const row of rows) expect(boxes.filter((b) => b.y === row)).toHaveLength(3);
  const last = boxes.filter((b) => b.y === rows[2]);
  expect(last).toHaveLength(3);
  const grid = (await page.locator(".hub-links-grid").boundingBox())!;
  const leftGap = last[0].x - grid.x;
  const rightGap = grid.x + grid.width - (last[2].x + last[2].w);
  expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("v2 service clips: cards and detail pages play once, hold the last frame, and use the final-frame poster", async ({ page }) => {
  const clips = [["automation", "/services/automation"], ["infrastructure", "/services/infrastructure"], ["10x-team", "/services/10x-team"]];
  await page.goto("/services");
  for (const [name] of clips) {
    const card = page.locator(`video.hub-card-clip[src="/assets/clip-svc-${name}-v2.mp4"]`);
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("poster", `/assets/video-poster-svc-${name}-v2.png`);
    await expect(card).toHaveAttribute("preload", "none");
    await expect(card).not.toHaveAttribute("loop", /.*/);
    await expect(card).not.toHaveAttribute("autoplay", /.*/);
  }
  await expect(page.locator('video[src="/assets/clip-svc-automation.mp4"], video[src="/assets/clip-svc-infrastructure.mp4"], video[src="/assets/clip-svc-10x-team.mp4"]')).toHaveCount(0);
  for (const [name, path] of clips) {
    await page.goto(path);
    const hero = page.locator(`video[src="/assets/clip-svc-${name}-v2.mp4"]`);
    await expect(hero).toHaveCount(1);
    await expect(hero).toHaveAttribute("poster", `/assets/video-poster-svc-${name}-v2.png`);
    await expect(hero).not.toHaveAttribute("loop", /.*/);
    const res = await page.request.get(`/assets/video-poster-svc-${name}-v2.png`);
    expect(res.status()).toBe(200);
  }
});

test("title-card clips rest on the final image before the title, on cards and detail heroes", async ({ page }) => {
  test.setTimeout(120_000); // ten clips, each plays about 5s before resting
  const clips: [string, string, string][] = [
    ["integration", "/services/integration", "/assets/clip-svc-integration.mp4"],
    ["automation", "/services/automation", "/assets/clip-svc-automation-v2.mp4"],
    ["platforms", "/services/infrastructure", "/assets/clip-svc-infrastructure-v2.mp4"],
    ["10x-team", "/services/10x-team", "/assets/clip-svc-10x-team-v2.mp4"],
    ["agent-setup", "/services/agent-setup", "/assets/clip-svc-agent-setup.mp4"],
  ];
  const settle = (src: string) => page.locator(`video[src="${src}"]`).first().evaluate((el: HTMLVideoElement) => new Promise<{ t: number; paused: boolean; rested: string | undefined; loop: boolean }>((resolve) => {
    const done = () => resolve({ t: el.currentTime, paused: el.paused, rested: el.dataset.rested, loop: el.loop });
    if (el.dataset.rested === "true") return setTimeout(done, 300);
    const iv = setInterval(() => { if (el.dataset.rested === "true") { clearInterval(iv); setTimeout(done, 300); } }, 100);
    el.play().catch(() => undefined);
    setTimeout(() => { clearInterval(iv); done(); }, 12000);
  }));
  for (const [, path, src] of clips) {
    await page.goto(path);
    const s = await settle(src);
    expect(s.rested).toBe("true");
    expect(s.paused).toBe(true);
    expect(s.loop).toBe(false);
    expect(s.t).toBeGreaterThan(4.7);
    expect(s.t).toBeLessThan(5.0);
  }
  await page.goto("/services");
  for (const [, , src] of clips) {
    const v = page.locator(`.hub-links video.hub-card-clip[src="${src}"]`);
    await expect(v).toHaveAttribute("preload", "none");
    await v.scrollIntoViewIfNeeded();
    const s = await settle(src);
    expect(s.rested).toBe("true");
    expect(s.t).toBeGreaterThan(4.7);
    expect(s.t).toBeLessThan(5.0);
    // Scrolling away and back must not replay a rested clip.
    await page.evaluate(() => window.scrollTo(0, 0));
    await v.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    expect(await v.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  }
});

test("draft /mcp page: one H1, breadcrumb, cards, connect steps, FAQ, CTAs, home teaser", async ({ page }) => {
  await page.goto("/mcp");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unwhelm's MCP server.");
  await expect(page).toHaveTitle("MCP server \u2014 UnwhelmNet");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Home");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("MCP");
  const main = page.locator("main");
  for (const name of ["Proposal Manager", "Contract Manager", "Project Manager"]) await expect(main.getByRole("heading", { level: 3, name })).toBeVisible();
  await expect(main).toContainText("https://mcp.unwhelm.net/mcp Ready for Grok.");
  await expect(main).not.toContainText("Server address coming soon");
  await expect(main.locator("#mcp-apps + p")).toHaveText("Grok is ready, Claude is ready, and ChatGPT works on supported plans.");
  await expect(main).not.toContainText("Until web chat is live");
  await expect(main).not.toContainText(/cursor|copilot/i);
  await expect(main.getByRole("link", { name: "Not sure how? We'll set your agent up for free." })).toHaveAttribute("href", "/services/agent-setup");
  await expect(main.getByRole("link", { name: /Set up my agent/ }).first()).toHaveAttribute("href", "/services/agent-setup");
  const talk = main.getByRole("link", { name: "Talk to the Proposal Manager with your own AI client" });
  await expect(talk).toHaveCount(2);
  for (const link of await talk.all()) await expect(link).toHaveAttribute("href", "/mcp/connect");
  await expect(main.getByRole("link", { name: "Full steps for Grok, Claude and your own client" })).toHaveAttribute("href", "/mcp/connect");
  await expect(main.locator('a[href="/contact"]')).toHaveCount(0);
  await expect(main.locator(".mcp-chat-fallback")).toHaveCount(0);
  await expect(main.getByRole("link", { name: /Proposal Manager/ })).toHaveCount(2);
  for (const link of await main.getByRole("link", { name: /Proposal Manager/ }).all()) await expect(link).not.toHaveAttribute("href", "/contact");
  await expect(main.locator("#how-to-connect")).toContainText("How to connect");
  const chat = main.getByRole("button", { name: /Use our web-based chat/ });
  await expect(chat).toHaveCount(2);
  for (const c of await chat.all()) {
    await expect(c).toHaveAttribute("aria-disabled", "true");
    await expect(c).toContainText("Coming soon");
    expect(await c.evaluate((el) => el.tagName)).not.toBe("A");
    expect(await c.getAttribute("href")).toBeNull();
  }
  await talk.first().click();
  await expect(page).toHaveURL(/\/mcp\/connect$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to connect");
  await page.goBack();
  await expect(main.locator("details summary")).toHaveText(["Do I need MCP to work with you?", "What does it cost?"]);
  await expect(main.locator("details p").first()).toHaveText("No. The free 30-minute consult works too.");
  await expect(main).not.toContainText("The web chat and the consult work too");
  await page.goto("/");
  const teaser = page.locator("section.agent-banner").getByRole("link", { name: /How our MCP server works/ });
  await expect(teaser).toHaveAttribute("href", "/mcp");
  await teaser.click();
  await expect(page).toHaveURL(/\/mcp$/);
});

test("interior heroes beside a video start the same distance below the breadcrumb as other pages", async ({ page }) => {
  const gap = async (path: string) => {
    await page.goto(path);
    return page.evaluate(() => {
      const bc = document.querySelector(".breadcrumbs")!.getBoundingClientRect().bottom;
      const h1 = document.querySelector("main h1")!;
      const eyebrow = (h1.closest("section")?.querySelector(".eyebrow") || h1) as HTMLElement;
      return eyebrow.getBoundingClientRect().top - bc;
    });
  };
  const reference = await gap("/services");
  for (const path of ["/services/integration", "/services/automation", "/services/agent-setup", "/industries/real-estate"]) {
    expect(Math.abs((await gap(path)) - reference), path).toBeLessThan(8);
  }
});

test("pricing shows three example cards under the price cards", async ({ page }) => {
  await page.goto("/pricing");
  const section = page.locator(".pricing-examples");
  await expect(section.getByRole("heading", { level: 2, name: "What each option can look like" })).toBeVisible();
  const cards = section.locator(".pricing-example-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.locator(".card-eyebrow")).toHaveText(["Example", "Example", "Example"]);
  await expect(cards.locator("h3")).toHaveText(["Workflow Check, $250", "Capped Hours, 8 hrs for $900", "Fixed Price, from $3K"]);
  for (const [name, href] of [["Automation", "/services/automation"], ["AI agents & MCP", "/services/ai/agents"], ["Integration & web", "/services/integration"]]) {
    await expect(section.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  await expect(cards.nth(1)).toContainText("permission-checked tools on their database and connect it to their AI app.");
});
