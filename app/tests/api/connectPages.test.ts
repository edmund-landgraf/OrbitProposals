// Build check: /connect and the dedicated client pages are routed, breadcrumbed, sitemapped, and internally consistent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const routes = new Set((JSON.parse(read("shared/routes.json")) as [string, string, string][]).map(([path]) => path));
const breadcrumbs = JSON.parse(read("shared/breadcrumbs.json")) as Record<string, [string, string][]>;
const sitemap = read("public/sitemap.xml");
const internalLinks = (source: string) => [...source.matchAll(/href="(\/[^"#?]*)"/g)].map((match) => match[1]);

const clients: [string, string][] = [
  ["/chatgpt", "ChatGPT"],
  ["/cursor", "Cursor"],
  ["/vscode", "VS Code"],
  ["/windsurf", "Windsurf"],
  ["/gemini-cli", "Gemini CLI"],
  ["/codex", "Codex"],
];

test("/connect is a routed, breadcrumbed, sitemapped hub", () => {
  assert.ok(routes.has("/connect"));
  assert.deepEqual(breadcrumbs["/connect"], [["/", "Home"], ["/connect", "Connect"]]);
  assert.match(sitemap, /<loc>https:\/\/unwhelm\.net\/connect<\/loc>/);
  assert.match(read("src/App.tsx"), /connect: "\/connect"/);
  assert.match(read("scripts/prerender.mjs"), /"\/connect":/);
  assert.match(read("src/App.tsx"), /routeLink\("connect"\)\}>Connect</);
});

test("each dedicated client page is routed, breadcrumbed, and sitemapped under /connect", () => {
  for (const [path, label] of clients) {
    assert.ok(routes.has(path), path);
    assert.deepEqual(breadcrumbs[path], [["/", "Home"], ["/connect", "Connect"], [path, label]], path);
    assert.match(sitemap, new RegExp(`<loc>https://unwhelm\\.net${path}</loc>`));
    assert.match(read("scripts/prerender.mjs"), new RegExp(`"${path}":`));
  }
  assert.deepEqual(breadcrumbs["/claude"], [["/", "Home"], ["/claude", "Claude"]]);
});

test("every internal link on the hub and client pages resolves to a route", () => {
  const sources = [
    "src/connectHub.tsx",
    "src/connectShared.tsx",
    "src/connectClientPages.tsx",
  ];
  for (const source of sources) {
    const links = internalLinks(read(source));
    assert.ok(links.length > 0, source);
    for (const link of links) assert.ok(routes.has(link), `${source} links to ${link}`);
  }
});

test("the hub, demo, footer sources, and existing guides point at /connect", () => {
  assert.match(read("src/connectHub.tsx"), /href: "\/claude"/);
  assert.match(read("src/connectHub.tsx"), /connectGuides/);
  assert.match(read("src/connectClientPages.tsx"), /path: "\/chatgpt"/);
  assert.ok(internalLinks(read("src/connectHub.tsx")).includes("/mcp/connect"));
  assert.ok(internalLinks(read("src/demoPage.tsx")).includes("/connect"));
  assert.ok(internalLinks(read("src/claudePage.tsx")).includes("/connect"));
  assert.ok(internalLinks(read("src/mcpConnect.tsx")).includes("/connect"));
  assert.ok(internalLinks(read("src/mcpConnect.tsx")).includes("/chatgpt"));
  assert.ok(internalLinks(read("src/connectMcpClient.tsx")).includes("/connect"));
  assert.ok(internalLinks(read("src/connectMcpClient.tsx")).includes("/chatgpt"));
  assert.match(read("src/App.tsx"), /Compare setup for each MCP client/);
});

test("client pages point at the public MCP server and documented config fields", () => {
  const pages = read("src/connectClientPages.tsx");
  assert.match(pages, /https:\/\/mcp\.unwhelm\.net\/mcp/);
  assert.match(pages, /"url": "https:\/\/mcp\.unwhelm\.net\/mcp"/);
  assert.match(pages, /"type": "http"/);
  assert.match(pages, /"serverUrl": "https:\/\/mcp\.unwhelm\.net\/mcp"/);
  assert.match(pages, /"httpUrl": "https:\/\/mcp\.unwhelm\.net\/mcp"/);
  assert.match(pages, /gemini mcp add --transport http unwhelm/);
  assert.match(pages, /\[mcp_servers\.unwhelm\]/);
  assert.match(pages, /codex mcp login unwhelm/);
  assert.match(pages, /cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install/);
  assert.match(pages, /\.vscode\/mcp\.json/);
  assert.doesNotMatch(pages, /npx mcp-remote/);
});

test("official client logos are committed with sources", () => {
  const clients = ["claude", "chatgpt", "cursor", "vscode", "windsurf", "gemini-cli", "codex"];
  for (const id of clients) {
    const svg = read(`public/assets/logos/${id}.svg`);
    assert.match(svg, /<svg\b/i, id);
  }
  const sources = read("public/assets/logos/SOURCES.md");
  for (const id of clients) assert.match(sources, new RegExp(`^## ${id}\\.svg`, "m"), id);
  assert.match(sources, /No official Codex-specific logo was found/);
  assert.match(read("src/connectHub.tsx"), /Product names and logos are trademarks of their respective owners/);
  assert.match(read("src/connectShared.tsx"), /alt=\{\`\$\{name\} logo\`\}/);
});
