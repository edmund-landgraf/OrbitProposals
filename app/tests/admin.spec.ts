import { expect, test } from "@playwright/test";

test("a signed-out visitor to /admin sees the not-found page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "That page is not here." })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByRole("heading", { name: "Admin" })).toHaveCount(0);
});
