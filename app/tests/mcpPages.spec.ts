import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const routes = new Set((JSON.parse(read("shared/routes.json")) as [string, string, string][]).map(([path]) => path));

test("/mcp/connect: one H1, breadcrumb, the four client sections and their statuses", async ({ page }) => {
  await page.goto("/mcp/connect");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to connect");
  await expect(page).toHaveTitle("How to connect | UnwhelmNet");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toContainText("MCP");
  await expect(crumbs).toContainText("How to connect");
  const main = page.locator("main");
  await expect(main.locator("#grok h2")).toHaveText("Grok Ready");
  await expect(main.locator("#chatgpt h2")).toHaveText("ChatGPT Ready on supported plans");
  await expect(main.locator("#chatgpt")).toContainText("Add custom MCP server");
  await expect(main.getByRole("link", { name: "Connect ChatGPT" })).toHaveAttribute("href", "/chatgpt");
  await expect(main.getByRole("link", { name: "connect hub" })).toHaveAttribute("href", "/connect");
  await expect(main.locator("#claude h2")).toHaveText("Claude Beta");
  await expect(main.locator("#claude")).toContainText("Settings, then Connectors");
  await expect(main.locator("#claude pre")).toHaveText("claude mcp add --transport http unwhelm https://mcp.unwhelm.net/mcp");
  const own = main.locator("#your-own-client");
  for (const text of ["https://mcp.unwhelm.net/mcp", "dynamic client registration", "PKCE (S256 only)", "magic-link email", "unw_create_chat_session"]) await expect(own).toContainText(text);
  await expect(main.locator('a[href="/contact"]')).toHaveCount(0);
  await expect(main.getByRole("link", { name: "Next: sample prompts to get started" })).toHaveAttribute("href", "/mcp/getting-started");
});

test("/mcp/getting-started: sample prompts, each with one line on what the agent does", async ({ page }) => {
  await page.goto("/mcp/getting-started");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Getting started");
  const items = page.locator(".mcp-prompts li");
  await expect(items).toHaveCount(7);
  for (const item of await items.all()) {
    await expect(item.locator("pre")).toHaveCount(1);
    await expect(item.locator("p")).toHaveCount(1);
  }
  await expect(items.first().locator("pre")).toContainText("Example: I run a 10-person law firm");
  await expect(page.locator(".mcp-prompts")).toContainText("Capped Hours");
  await expect(page.locator("main").getByRole("link", { name: "connected" })).toHaveAttribute("href", "/mcp/connect");
});

test("Proposal Manager CTAs on /mcp go to /mcp/connect, never /contact", async ({ page }) => {
  await page.goto("/mcp");
  const talk = page.locator("main").getByRole("link", { name: /Proposal Manager/ });
  await expect(talk).toHaveCount(2);
  for (const link of await talk.all()) await expect(link).toHaveAttribute("href", "/mcp/connect");
  await talk.last().click();
  await expect(page).toHaveURL(/\/mcp\/connect$/);
});

test("the new pages are routed, breadcrumbed, prerendered and in the sitemap", () => {
  const sitemap = read("public/sitemap.xml");
  const crumbs = JSON.parse(read("shared/breadcrumbs.json")) as Record<string, [string, string][]>;
  const prerender = read("scripts/prerender.mjs");
  for (const path of ["/mcp/connect", "/mcp/getting-started"]) {
    expect(routes.has(path)).toBe(true);
    expect(crumbs[path].map(([p]) => p)).toEqual(["/", "/mcp", path]);
    expect(sitemap).toContain(`<loc>https://unwhelm.net${path}</loc>`);
    expect(prerender).toContain(`"${path}":`);
  }
});

test("no page or source file links to the private AdventureMakerByAct repo", async ({ page }) => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(join(root, dir))) { const rel = `${dir}/${name}`; if (statSync(join(root, rel)).isDirectory()) walk(rel); else if (/\.(tsx?|mjs|json|xml|html|md)$/.test(name)) files.push(rel); } };
  for (const dir of ["src", "public", "shared", "scripts"]) walk(dir);
  for (const file of files) expect(read(file), file).not.toMatch(/github\.com\/edmund-landgraf\/AdventureMakerByAct/i);
  for (const path of ["/mcp", "/mcp/connect", "/mcp/getting-started", "/services/agent-setup"]) {
    await page.goto(path);
    await expect(page.locator('a[href*="AdventureMakerByAct" i]')).toHaveCount(0);
  }
});
