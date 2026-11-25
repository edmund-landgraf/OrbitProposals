import { expect, test } from "@playwright/test";

// Cleanup batch: /chat redirect (SPA), shared closing CTA on content pages, /insights CTA, /work/code wording.
test("SPA: /chat lands on /try", async ({ page }) => {
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/try$/);
  await expect(page.locator("main h1")).toBeVisible();
});

for (const path of ["/services/ai/economics", "/services/web-design", "/industries/legal", "/industries/healthcare", "/industries/financial", "/insights"]) {
  test(`${path} ends with the shared closing CTA`, async ({ page }) => {
    await page.goto(path);
    const panel = page.locator("main .parity-next-panel");
    await expect(panel).toHaveCount(1);
    const isLast = await panel.evaluate((el) => {
      const visible = [...document.querySelectorAll("main *")].filter((e) => (e as HTMLElement).offsetHeight > 0);
      return el.contains(visible[visible.length - 1]);
    });
    expect(isLast, path).toBe(true);
  });
}

test("/insights CTA points to /try and /pricing, not /contact", async ({ page }) => {
  await page.goto("/insights");
  const panel = page.locator("main .parity-next-panel");
  await expect(panel.getByRole("link", { name: /Try it live/ })).toHaveAttribute("href", "/try");
  await expect(panel.getByRole("link", { name: "See pricing" })).toHaveAttribute("href", "/pricing");
  await expect(panel.locator('a[href="/contact"]')).toHaveCount(0);
});

test("/work/code says code is available on request", async ({ page }) => {
  await page.goto("/work/code");
  await expect(page.locator("main")).toContainText("Code available on request");
  await expect(page.locator("main")).not.toContainText("inspectable code");
});
