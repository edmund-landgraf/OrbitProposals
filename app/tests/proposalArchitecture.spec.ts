import { readFileSync } from "node:fs";
import { TOOL_SCOPES } from "../unwh-mcp/src/toolAccess";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Proposal Architecture shows the entity diagram and all 155 MCP tools", async ({ page }) => {
  await page.goto("/proposal-architecture");
  await expect(page.getByRole("heading", { name: "Proposal Architecture", exact: true })).toBeVisible();
  const diagram = page.getByRole("img", { name: /entity relationship diagram/i });
  await expect(diagram).toBeVisible();
  await expect(diagram).toHaveJSProperty("complete", true);
  await expect(page.getByText("155 registered tools")).toBeVisible();
  await expect(page.getByText("155 of 155 tools shown")).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search tools" });
  await search.fill("unw_create_proposal");
  await expect(page.getByText("1 of 155 tools shown")).toBeVisible();
  await expect(page.getByRole("heading", { name: "unw_create_proposal" })).toBeVisible();
  await expect(page.getByText(/Create a proposal with scope, deliverables/)).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("155 of 155 tools shown")).toBeVisible();

  await page.getByRole("combobox", { name: "Permission" }).selectOption("admin");
  await expect(page.getByRole("heading", { name: "unw_admin_delete_mcp_client" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.getByRole("heading", { name: "unw_admin_mint_token" })).not.toBeVisible();
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByRole("heading", { name: "unw_admin_mint_token" })).toBeVisible();
});

test("Proposal Architecture has no automated axe violations", async ({ page }) => {
  await page.goto("/proposal-architecture");
  await expect(page.getByText("155 registered tools")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});


test("inventory and standalone explorer match the registered tools and scopes", () => {
  const inventory = JSON.parse(readFileSync("public/assets/proposal-arch/tools.json", "utf8"));
  const source = readFileSync("unwh-mcp/src/createServer.ts", "utf8");
  const registered = Array.from(source.matchAll(/registerTool\(\s*"([^"]+)"/g), match => match[1]).sort();
  expect(inventory.count).toBe(inventory.tools.length);
  expect(inventory.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(registered);
  for (const tool of inventory.tools) expect(tool.scope).toBe(TOOL_SCOPES[tool.name] ?? "Not scope-gated in MCP listing");
  const standalone = readFileSync("public/proposal-arch-tool-map.html", "utf8");
  const groups = JSON.parse(standalone.match(/<script>const groups=([\s\S]*?);const all=/)![1]);
  expect(groups.flatMap((group: { tools: unknown[] }) => group.tools).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)))
    .toEqual([...inventory.tools].sort((a, b) => a.name.localeCompare(b.name)));
});
