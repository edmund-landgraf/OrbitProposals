import { mkdirSync } from "node:fs";
import { expect, test, type Route } from "@playwright/test";

// A fake secret for the screenshot; it is never a real token.
const FAKE_SECRET = "unw_test_0000000000000000000000000000FAKE";
const clientUser = { id: "11111111-1111-4111-8111-111111111111", email: "grokbot-test-client@example.com", name: "Test client", isAdmin: false, createdAt: "2026-10-01T00:00:00.000Z", org: { id: "o1", name: "Acme Test Org", role: "owner" } };
const staffUser = { id: "22222222-2222-4222-8222-222222222222", email: "ops@unwhelm.example", name: "Ops", isAdmin: true, createdAt: "2026-10-01T00:00:00.000Z", org: null };

async function json(route: Route, entity: unknown, status = 200) { await route.fulfill({ status, json: { ok: true, entity, warnings: [], links: {} } }); }

test("admin mints a token from the Client preset and sees the secret exactly once", async ({ page }) => {
  let mintBody: Record<string, unknown> | null = null;
  const tokens: Array<Record<string, unknown>> = [{ id: "t-other", name: "client-mcp", owner: clientUser.email, scopes: ["proposals:read"], lastUsed: null, expiresAt: null, revokedAt: null }];
  let revoked = "";
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith("/auth/session")) { await json(route, { isAdmin: true, user: { isAdmin: true, roles: ["staff"] } }); return; }
    if (path.endsWith("/admin/users")) { await json(route, { items: [clientUser, staffUser] }); return; }
    if (path.endsWith("/admin/scope-presets")) { await json(route, { items: [{ code: "client", label: "Client", scopes: ["proposals:read", "proposals:write", "contracts:write", "billing:read", "projects:read"] }] }); return; }
    if (path.endsWith("/admin/tokens") && method === "POST") { mintBody = route.request().postDataJSON(); await json(route, { id: "t-new", expiresAt: "2027-01-21T00:00:00.000Z", token: FAKE_SECRET }, 201); return; }
    if (path.endsWith("/admin/tokens")) { await json(route, { items: tokens }); return; }
    if (path.endsWith("/admin/tokens/t-other") && method === "DELETE") { revoked = "t-other"; tokens[0] = { ...tokens[0], revokedAt: "2026-10-23T00:00:00.000Z" }; await json(route, { id: "t-other" }); return; }
    if (path.endsWith("/admin/audit")) { await json(route, { items: [] }); return; }
    if (path.endsWith("/admin/access-requests")) { await json(route, { items: [] }); return; }
    await route.fulfill({ status: 404, json: { ok: false, code: "NOT_FOUND", message: "Not found." } });
  });
  await page.setViewportSize({ width: 1200, height: 1100 });
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Tokens" }).click();
  for (const scope of ["contracts:write", "billing:read", "billing:write", "catalog:write", "admin"]) await expect(page.getByLabel(scope, { exact: true })).toBeVisible();
  await page.getByLabel("User").selectOption({ label: `${clientUser.email} (Acme Test Org)` });
  await page.getByLabel("Name").fill("client-portal-agent");
  await page.getByLabel("Preset").selectOption({ label: "Client" });
  for (const scope of ["proposals:read", "proposals:write", "contracts:write", "billing:read", "projects:read"]) await expect(page.getByLabel(scope, { exact: true })).toBeChecked();
  for (const scope of ["billing:write", "catalog:write", "admin"]) await expect(page.getByLabel(scope, { exact: true })).not.toBeChecked();
  await page.getByRole("button", { name: "Mint token" }).click();
  const reveal = page.getByRole("region", { name: "New token" });
  await expect(reveal).toContainText(FAKE_SECRET);
  await expect(reveal).toContainText("You won't see this token again");
  expect(mintBody).toMatchObject({ userId: clientUser.id, name: "client-portal-agent", scopes: ["proposals:read", "proposals:write", "contracts:write", "billing:read", "projects:read"] });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await reveal.getByRole("button", { name: "Copy token" }).click();
  await expect(reveal.getByRole("button", { name: "Copied" })).toBeVisible();
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  await page.getByRole("tabpanel").screenshot({ path: "/opt/cursor/artifacts/admin-mint.png" });
  if (process.env.MINT_SHOT) await page.getByRole("tabpanel").screenshot({ path: process.env.MINT_SHOT });
  await reveal.getByRole("button", { name: "I've saved it" }).click();
  await expect(page.getByText(FAKE_SECRET)).toHaveCount(0);

  // Revoke a token that belongs to another user (the test client).
  await page.getByRole("row", { name: /client-mcp/ }).getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
  await expect.poll(() => revoked).toBe("t-other");
});
