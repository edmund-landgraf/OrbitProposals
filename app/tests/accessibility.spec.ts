import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("accessibility smoke checks", () => {
  for (const route of ["/", "/services", "/services/integration", "/services/automation", "/services/ai", "/services/infrastructure", "/services/web-design", "/services/10x-team", "/services/agent-setup", "/services/ai/agents", "/industries", "/industries/real-estate", "/industries/real-estate/institutional-investors", "/industries/real-estate/property-managers", "/industries/real-estate/brokerages", "/industries/legal", "/industries/healthcare", "/industries/financial", "/work", "/work/case-studies", "/work/case-studies/synthetic-data-testing", "/work/case-studies/automated-cma-vacancy-pricing", "/about", "/about/skills", "/about/resume", "/pricing", "/contact", "/privacy", "/terms", "/support", "/services/ai/economics", "/insights", "/insights/who-pays-for-the-ai", "/mcp", "/mcp/connect", "/mcp/getting-started"]) {
    test(`has no automated axe violations on ${route}`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});
