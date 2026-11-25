import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

// Spins up the production request handler from server.mjs (without binding its port)
// and checks every legacy URL answers with a single 301 hop to its final target.
const redirects: Record<string, string> = JSON.parse(readFileSync(new URL("../shared/redirects.json", import.meta.url), "utf8"));
const routes: [string, string, string][] = JSON.parse(readFileSync(new URL("../shared/routes.json", import.meta.url), "utf8"));
const livePaths = new Set(routes.map(([path]) => path));
const clientOnlyPaths = new Set(["/admin", "/portal"]);
const publicPaths = new Set([...livePaths].filter((path) => !clientOnlyPaths.has(path)));

const expected: Record<string, string> = {
  "/ai-solutions": "/services/ai",
  "/services/agents": "/services/ai/agents",
  "/agents": "/services/ai/agents",
  "/ai-economics": "/services/ai/economics",
  "/cost-of-ownership": "/services/ai/economics",
  "/platforms": "/services/infrastructure",
  "/web-design": "/services/web-design",
  "/10x-team": "/services/10x-team",
  "/real-estate": "/industries/real-estate",
  "/real-estate/institutional-investors": "/industries/real-estate/institutional-investors",
  "/real-estate/property-managers": "/industries/real-estate/property-managers",
  "/real-estate/brokerages": "/industries/real-estate/brokerages",
  "/legal": "/industries/legal",
  "/healthcare": "/industries/healthcare",
  "/financial": "/industries/financial",
  "/case-studies": "/work/case-studies",
  "/case-study": "/work/case-studies",
  "/clients": "/work/case-studies",
  "/videos": "/work/videos",
  "/proof": "/work/videos",
  "/git": "/work/code",
  "/documents": "/work/documents",
  "/approach": "/about/approach",
  "/technical-skills": "/about/skills",
  "/diagramming": "/about/skills",
  "/resume": "/about/resume",
  "/resume2": "/about/resume",
  "/resume3": "/about/resume",
  "/engagement": "/pricing",
  "/chat": "/try",
};

let server: Server;
let base = "";

test.beforeAll(async () => {
  process.env.UNWHELM_SERVER_NO_LISTEN = "1";
  const { handleRequest } = await import("../server.mjs");
  server = createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("the redirect map covers every old URL with its intended target", () => {
  for (const [from, to] of Object.entries(expected)) {
    expect(redirects[from], from).toBe(to);
  }
});

test("every redirect target is a live route, so there are no chains", () => {
  for (const [from, to] of Object.entries(redirects)) {
    expect(livePaths.has(to), `${from} -> ${to}`).toBe(true);
    expect(redirects[to], `${to} must not redirect again`).toBeUndefined();
  }
});

test("every old URL returns a single-hop 301 from server.mjs", async () => {
  for (const [from, to] of Object.entries(redirects)) {
    for (const variant of [from, `${from}/`]) {
      const response = await fetch(`${base}${variant}`, { redirect: "manual" });
      expect(response.status, variant).toBe(301);
      expect(response.headers.get("location"), variant).toBe(to);
    }
  }
  const withQuery = await fetch(`${base}/proof?demo=rag`, { redirect: "manual" });
  expect(withQuery.headers.get("location")).toBe("/work/videos?demo=rag");
});

test("every route in shared/routes.json returns 200 from server.mjs", async () => {
  for (const [path] of routes) {
    for (const variant of [path, path === "/" ? "/" : `${path}/`]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(`${base}${variant}`, { method, redirect: "manual" });
        expect(response.status, `${method} ${variant}`).toBe(200);
      }
    }
  }
  expect((await fetch(`${base}/no-such-page`)).status).toBe(404);
});

test("/try and /try/help raw HTML link to each other with real hrefs", async () => {
  const tryHtml = await (await fetch(`${base}/try`)).text();
  expect(tryHtml).toContain('href="/try/help"');
  const helpHtml = await (await fetch(`${base}/try/help`)).text();
  expect(helpHtml).toContain('href="/try"');
});

test("sitemap lists only new URLs", () => {
  const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
  const paths = [...sitemap.matchAll(/<loc>https:\/\/unwhelm\.net([^<]*)<\/loc>/g)].map((match) => match[1] || "/");
  expect(paths.sort()).toEqual([...publicPaths].sort());
  expect(paths).not.toContain("/admin");
  expect(paths).not.toContain("/portal");
  expect(paths).not.toContain("/chat");
  for (const path of paths) expect(redirects[path], path).toBeUndefined();
});

test("prerendered pages carry BreadcrumbList JSON-LD that matches shared/breadcrumbs.json and passes the CSP", async ({ page }) => {
  const trails: Record<string, [string, string][]> = JSON.parse(readFileSync(new URL("../shared/breadcrumbs.json", import.meta.url), "utf8"));
  for (const [path] of routes) {
    const html = await (await fetch(`${base}${path}`)).text();
    const match = html.match(/<script type="application\/ld\+json" id="breadcrumb-jsonld">(.*?)<\/script>/);
    if (path === "/" || clientOnlyPaths.has(path)) {
      expect(match, path).toBeNull();
      continue;
    }
    expect(match, path).not.toBeNull();
    const data = JSON.parse(match![1]);
    expect(data.itemListElement.map((item: { name: string }) => item.name), path).toEqual(trails[path].map(([, name]) => name));
  }
  const violations: string[] = [];
  page.on("console", (message) => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto(`${base}/work/code`);
  await expect(page.locator("#breadcrumb-jsonld")).toHaveCount(1);
  const csp = (await (await fetch(`${base}/work/code`)).headers.get("content-security-policy")) ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(violations).toEqual([]);
});
