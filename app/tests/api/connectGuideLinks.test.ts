// Build check: every internal link on the Connect your MCP client guide, and the guide's own link from /try/help, resolves to a real route.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const routes = new Set((JSON.parse(read("shared/routes.json")) as [string, string, string][]).map(([path]) => path));
const breadcrumbs = JSON.parse(read("shared/breadcrumbs.json")) as Record<string, [string, string][]>;
const sitemap = read("public/sitemap.xml");
const internalLinks = (source: string) => [...source.matchAll(/href="(\/[^"#?]*)"/g)].map((match) => match[1]);

test("/try/connect is a routed, breadcrumbed, sitemapped page", () => {
  assert.ok(routes.has("/try/connect"));
  assert.deepEqual(breadcrumbs["/try/connect"].map(([path]) => path), ["/", "/try", "/try/help", "/try/connect"]);
  assert.match(sitemap, /<loc>https:\/\/unwhelm\.net\/try\/connect<\/loc>/);
  assert.match(read("src/App.tsx"), /"try-connect": "\/try\/connect"/);
});

test("every internal link on the connect guide resolves to a route", () => {
  const links = internalLinks(read("src/connectMcpClient.tsx"));
  assert.ok(links.length > 0);
  for (const link of links) assert.ok(routes.has(link), `${link} is not a route`);
});

test("the Try me help guide links to the connect guide", () => {
  assert.ok(internalLinks(read("src/tryMeHelp.tsx")).includes("/try/connect"));
});

test("the guide points at the public MCP server that advertises PKCE and dynamic registration", () => {
  const guide = read("src/connectMcpClient.tsx");
  assert.match(guide, /https:\/\/mcp\.unwhelm\.net\/mcp/);
  const discovery = read("server/routes/systemAuth.ts");
  assert.match(discovery, /registration_endpoint/);
  assert.match(discovery, /code_challenge_methods_supported: \["S256"\]/);
});
