// Build check: /claude is routed, breadcrumbed, sitemapped, and its internal links resolve.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const routes = new Set((JSON.parse(read("shared/routes.json")) as [string, string, string][]).map(([path]) => path));
const breadcrumbs = JSON.parse(read("shared/breadcrumbs.json")) as Record<string, [string, string][]>;
const sitemap = read("public/sitemap.xml");
const internalLinks = (source: string) => [...source.matchAll(/href="(\/[^"#?]*)"/g)].map((match) => match[1]);

test("/claude is a routed, breadcrumbed, sitemapped page", () => {
  assert.ok(routes.has("/claude"));
  assert.deepEqual(breadcrumbs["/claude"], [["/", "Home"], ["/claude", "Claude"]]);
  assert.match(sitemap, /<loc>https:\/\/unwhelm\.net\/claude<\/loc>/);
  assert.match(read("src/App.tsx"), /claude: "\/claude"/);
  assert.match(read("scripts/prerender.mjs"), /"\/claude":/);
});

test("every internal link on the Claude page resolves to a route", () => {
  const links = internalLinks(read("src/claudePage.tsx"));
  assert.ok(links.length > 0);
  for (const link of links) assert.ok(routes.has(link), `${link} is not a route`);
});

test("the demo, MCP connect, and Try me connect guides link to /claude", () => {
  assert.ok(internalLinks(read("src/demoPage.tsx")).includes("/claude"));
  assert.ok(internalLinks(read("src/mcpConnect.tsx")).includes("/claude"));
  assert.ok(internalLinks(read("src/connectMcpClient.tsx")).includes("/claude"));
});

test("the Claude page points at the public MCP server and the documented Claude Code command", () => {
  const page = read("src/claudePage.tsx");
  assert.match(page, /https:\/\/mcp\.unwhelm\.net\/mcp/);
  assert.match(page, /claude mcp add --transport http unwhelm/);
  assert.match(page, /\/mcp/);
});
