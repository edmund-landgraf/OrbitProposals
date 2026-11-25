import { expect, test } from "@playwright/test";

const mcpUrl = "https://mcp.unwhelm.net/mcp";

test("/claude: title, diagram, URL copy, Claude Code command, and sign-in help", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/claude");
  await expect(page).toHaveTitle("Connect Claude to Unwhelm — UnwhelmNet");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect Claude to Unwhelm.");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Claude");
  const logo = page.getByRole("img", { name: "Claude logo" });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", "/assets/logos/claude.svg");

  const diagram = page.getByRole("img", { name: /Six numbered steps/ });
  await expect(diagram).toBeVisible();
  await expect(diagram).toHaveAttribute("src", "/assets/claude-connect-diagram.svg");
  await expect(page.locator("main")).toContainText("Sign in now");
  await expect(page.locator("main")).toContainText("Register automatically");
  await expect(page.locator("main")).toContainText("Read-only tools");

  await expect(page.locator("main")).toContainText(mcpUrl);
  await page.getByRole("button", { name: "Copy the Unwhelm MCP server URL" }).click();
  await expect(page.getByRole("button", { name: "Copy the Unwhelm MCP server URL" })).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(mcpUrl);

  await expect(page.locator("main pre")).toHaveText(`claude mcp add --transport http unwhelm ${mcpUrl}`);
  await expect(page.locator("main")).toContainText("Customize, then Connectors");
  await expect(page.locator("main")).toContainText("Needs authentication");
  await expect(page.getByRole("link", { name: "Request access" }).first()).toHaveAttribute("href", "/request-access");
  await expect(page.getByRole("link", { name: "demo account" })).toHaveAttribute("href", "/demo");
  await expect(page.getByRole("link", { name: "How to connect" })).toHaveAttribute("href", "/mcp/connect");
});

test("footer and /demo link to /claude", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("link", { name: "Connect Claude" })).toHaveAttribute("href", "/claude");
  await expect(page.locator('footer a[href="/claude"]')).toHaveText("Claude");
});
