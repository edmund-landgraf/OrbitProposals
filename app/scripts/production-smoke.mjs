import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const baseUrl = process.env.UNWHELM_BASE_URL ?? "http://127.0.0.1:5194";

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...options });
}

const sitemapResponse = await request("/sitemap.xml");
assert.equal(sitemapResponse.status, 200, "sitemap should load");
const sitemap = await sitemapResponse.text();
const sitemapPaths = [...sitemap.matchAll(/<loc>https:\/\/unwhelm\.net([^<]*)<\/loc>/g)].map((match) => match[1] || "/");
assert.ok(sitemapPaths.length > 0, "sitemap should contain routes");

for (const path of sitemapPaths) {
  const response = await request(path);
  assert.equal(response.status, 200, `${path} should return 200`);
  const html = await response.text();
  assert.match(html, /<link rel="canonical" href="https:\/\/unwhelm\.net/, `${path} should have a canonical URL`);
}

const legacyRedirects = JSON.parse(await readFile(new URL("../shared/redirects.json", import.meta.url), "utf8"));
for (const [from, to] of Object.entries(legacyRedirects)) {
  const response = await request(from);
  assert.equal(response.status, 301, `${from} should redirect`);
  assert.equal(response.headers.get("location"), to, `${from} should redirect to ${to}`);
}

for (const path of ["/does-not-exist", "/README.md", "/UnwhelmNetReplit2.md", "/assets/missing.js"]) {
  const response = await request(path);
  assert.equal(response.status, 404, `${path} should return 404`);
}

const compressed = await request("/", { headers: { "Accept-Encoding": "br" } });
assert.equal(compressed.status, 200);
assert.equal(compressed.headers.get("content-encoding"), "br", "HTML should be Brotli compressed");
assert.ok(compressed.headers.get("content-security-policy"), "CSP should be present");

console.log(`Production smoke passed for ${sitemapPaths.length} sitemap routes.`);
