import { expect, test } from "@playwright/test";
import fs from "node:fs";

// Every interior page's h1 should start on the same left edge as the breadcrumb trail (the standard container).
// Exceptions are deliberate layouts: the About intro sits inside a bordered card, and article routes put their h1 in the Insights reading pane (visually hidden).
const exceptions = new Set(["/about", "/insights/who-pays-for-the-ai"]);
const routes = new Set<string>((JSON.parse(fs.readFileSync("shared/routes.json", "utf8")) as string[][]).map((r) => r[0]));
for (const m of fs.readFileSync("public/sitemap.xml", "utf8").matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)) routes.add(m[1] || "/");

test("h1 lines up with the breadcrumb trail on every interior route", async ({ page }) => {
  test.setTimeout(120_000);
  const off: string[] = [];
  for (const route of [...routes].sort()) {
    if (exceptions.has(route)) continue;
    await page.goto(route);
    await page.locator("main h1").first().waitFor();
    const m = await page.evaluate(() => {
      const crumb = document.querySelector("nav.breadcrumbs .breadcrumbs-inner > *");
      const h1 = document.querySelector("main h1");
      return { crumb: crumb ? crumb.getBoundingClientRect().left : null, h1: h1 ? h1.getBoundingClientRect().left : null };
    });
    if (m.crumb === null || m.h1 === null) continue; // home, admin, and portal have no breadcrumb trail
    if (Math.abs(m.crumb - m.h1) > 2) off.push(`${route}: breadcrumb ${Math.round(m.crumb)}px, h1 ${Math.round(m.h1)}px`);
  }
  expect(off).toEqual([]);
});
