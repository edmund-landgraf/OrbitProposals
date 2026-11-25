import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const draft = /Draft — not legal advice/;

test("privacy, terms, and support are routed, breadcrumbed, and in the sitemap", () => {
  const routes = new Set((JSON.parse(readFileSync("shared/routes.json", "utf8")) as [string, string, string][]).map(([path]) => path));
  const crumbs = JSON.parse(readFileSync("shared/breadcrumbs.json", "utf8")) as Record<string, [string, string][]>;
  const sitemap = readFileSync("public/sitemap.xml", "utf8");
  for (const [path, label] of [["/privacy", "Privacy"], ["/terms", "Terms"], ["/support", "Support"]] as const) {
    expect(routes.has(path)).toBe(true);
    expect(crumbs[path]).toEqual([["/", "Home"], [path, label]]);
    expect(sitemap).toContain(`<loc>https://unwhelm.net${path}</loc>`);
  }
});

test("policy pages show the draft notice and the MCP data, retention, and deletion points", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page).toHaveTitle("Privacy — UnwhelmNet");
  await expect(page.getByRole("heading", { level: 1, name: "How we handle your information." })).toBeVisible();
  await expect(page.getByRole("note")).toContainText(draft);
  await expect(page.getByRole("note")).toContainText("Edmund's review");
  await expect(page.getByRole("note")).toContainText("has not been reviewed by counsel");
  const privacy = page.locator("main");
  await expect(privacy.getByRole("heading", { name: "Proposals, contracts, and invoices" })).toBeVisible();
  await expect(privacy.getByRole("heading", { name: "ChatGPT, Claude, and other MCP connectors" })).toBeVisible();
  await expect(privacy.getByRole("heading", { name: "Retention" })).toBeVisible();
  await expect(privacy.getByRole("heading", { name: "How to request deletion" })).toBeVisible();
  await expect(privacy).toContainText("contact@unwhelm.com");
  await expect(privacy.getByRole("link", { name: "Terms", exact: true })).toHaveAttribute("href", "/terms");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Privacy");

  await privacy.getByRole("link", { name: "Terms", exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page).toHaveTitle("Terms — UnwhelmNet");
  await expect(page.getByRole("heading", { level: 1, name: "Terms of service." })).toBeVisible();
  await expect(page.getByRole("note")).toContainText(draft);
  const terms = page.locator("main");
  await expect(terms.getByRole("heading", { name: "MCP connectors" })).toBeVisible();
  await expect(terms).toContainText("ChatGPT");
  await expect(terms).toContainText("Claude");
  await expect(terms).toContainText("not a signed statement of work");
  await expect(terms.getByRole("link", { name: "Support", exact: true })).toHaveAttribute("href", "/support");

  await terms.getByRole("link", { name: "Support", exact: true }).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page).toHaveTitle("Support — UnwhelmNet");
  await expect(page.getByRole("heading", { level: 1, name: "How to get help." })).toBeVisible();
  await expect(page.getByRole("note")).toContainText(draft);
  const support = page.locator("main");
  await expect(support.getByRole("link", { name: "contact@unwhelm.com" }).first()).toHaveAttribute("href", "mailto:contact@unwhelm.com");
  await expect(support.getByRole("link", { name: "866-209-4787" })).toHaveAttribute("href", "tel:+18662094787");
  await expect(support.getByRole("link", { name: "contact form" })).toHaveAttribute("href", "/contact");
  await expect(support.getByRole("link", { name: "How to connect" })).toHaveAttribute("href", "/mcp/connect");
  await support.getByRole("link", { name: "Contact us", exact: true }).click();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.locator(".intake-form").getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  await expect(page.locator(".intake-form").getByRole("link", { name: "Support" })).toHaveAttribute("href", "/support");
});

test("policy pages stay on screen at a phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path, heading] of [
    ["/privacy", "How we handle your information."],
    ["/terms", "Terms of service."],
    ["/support", "How to get help."],
  ] as const) {
    await page.goto(path);
    const note = page.getByRole("note");
    const h1 = page.getByRole("heading", { level: 1, name: heading });
    await expect(note).toBeVisible();
    await expect(h1).toBeVisible();
    const box = await h1.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    const noteBox = await note.boundingBox();
    expect((noteBox?.x ?? 0) + (noteBox?.width ?? 0)).toBeLessThanOrEqual(390);
  }
});

test("the footer links to privacy, terms, and support", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  await expect(footer.getByRole("link", { name: "Support" })).toHaveAttribute("href", "/support");
});
