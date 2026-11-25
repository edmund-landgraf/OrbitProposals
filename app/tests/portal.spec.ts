import { expect, test, type Page, type Route } from "@playwright/test";

test("a signed-out visitor to /portal sees the not-found page", async ({ page }) => {
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1, name: "That page is not here." })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByRole("heading", { name: "Work with your proposal." })).toHaveCount(0);
});

function ok(entity: unknown) {
  return { ok: true, entity, warnings: [], links: {} };
}

const proposal = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Field mapping",
  engagement: "workflow_check",
  status: "accepted",
  scope: { summary: "Map the intake.", deliverables: ["Map"], assumptions: [], exclusions: [] },
  timeline: { startDate: null, targetDate: null, milestones: [] },
  pricing: { model: "fixed", amountMinor: 100000, currency: "USD" },
  options: [],
  version: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

async function clientPortal(page: Page, fulfill: (path: string, route: Route) => Promise<boolean>) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) {
      await route.fulfill({ json: ok({ user: { roles: ["client"] }, isAdmin: false }) });
      return;
    }
    if (await fulfill(path, route)) return;
    await route.fulfill({ status: 404, json: { ok: false, code: "NOT_FOUND", message: "Not found." } });
  });
  await page.goto("/portal");
  await expect(page.getByRole("heading", { name: "Work with your proposal." })).toBeVisible();
}

test("a client can move from a proposal to its contract, invoices, and milestones", async ({ page }) => {
  await clientPortal(page, async (path, route) => {
    if (path.endsWith("/proposals")) { await route.fulfill({ json: ok({ items: [proposal] }) }); return true; }
    if (path.endsWith(`/proposals/${proposal.id}`)) { await route.fulfill({ json: ok(proposal) }); return true; }
    if (path.endsWith("/contracts") && !path.includes("/billing")) {
      await route.fulfill({ json: ok({ items: [{ id: "22222222-2222-4222-8222-222222222222", proposalId: proposal.id, status: "signed", terms: "Field mapping agreement", signedAt: "2026-10-03T00:00:00.000Z", createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" }] }) });
      return true;
    }
    if (path.endsWith("/billing")) {
      await route.fulfill({ json: ok({ total: { amountMinor: 100000, currency: "USD" }, entries: [{ id: "33333333-3333-4333-8333-333333333333", label: "On signature", percent: "1", amount: { amountMinor: 100000, currency: "USD" }, trigger: "contract_signed", invoiceId: "44444444-4444-4444-8444-444444444444" }] }) });
      return true;
    }
    if (path.endsWith("/invoices")) {
      await route.fulfill({ json: ok({ items: [{ id: "44444444-4444-4444-8444-444444444444", contractId: "22222222-2222-4222-8222-222222222222", amount: { amountMinor: 100000, currency: "USD" }, status: "sent", dueDate: "2026-11-01", createdAt: "2026-10-03T00:00:00.000Z" }] }) });
      return true;
    }
    if (path.endsWith("/projects")) {
      await route.fulfill({ json: ok({ items: [{ id: "55555555-5555-4555-8555-555555555555", contractId: "22222222-2222-4222-8222-222222222222", title: "Mapping project", status: "active", milestones: [{ id: "66666666-6666-4666-8666-666666666666", title: "Kickoff", description: "Start the map.", dueDate: "2026-10-15", status: "done" }] }] }) });
      return true;
    }
    return false;
  });

  await expect(page.getByRole("button", { name: "Field mapping" })).toBeVisible();
  await page.getByRole("tab", { name: "Contracts" }).click();
  await page.getByRole("button", { name: "Field mapping agreement" }).click();
  await expect(page.getByRole("heading", { name: "Billing schedule" })).toBeVisible();
  await expect(page.getByText("On signature")).toBeVisible();
  await page.getByRole("tab", { name: "Invoices" }).click();
  await expect(page.getByText("sent")).toBeVisible();
  await page.getByRole("tab", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Mapping project" })).toBeVisible();
  await expect(page.getByText("Kickoff")).toBeVisible();
  await expect(page.getByRole("button", { name: /create|edit|pay|send|void/i })).toHaveCount(0);
});

test("delivery tabs show empty states and authorization errors", async ({ page }) => {
  await clientPortal(page, async (path, route) => {
    if (path.endsWith("/proposals")) { await route.fulfill({ json: ok({ items: [] }) }); return true; }
    if (path.endsWith("/contracts")) { await route.fulfill({ json: ok({ items: [] }) }); return true; }
    if (path.endsWith("/invoices")) { await route.fulfill({ status: 403, json: { ok: false, code: "SCOPE_REQUIRED", message: "The billing:read scope is required." } }); return true; }
    if (path.endsWith("/projects")) { await route.fulfill({ json: ok({ items: [] }) }); return true; }
    return false;
  });
  await page.getByRole("tab", { name: "Contracts" }).click();
  await expect(page.getByText("No contracts yet.")).toBeVisible();
  await page.getByRole("tab", { name: "Invoices" }).click();
  await expect(page.getByRole("alert")).toHaveText("The billing:read scope is required.");
  await page.getByRole("tab", { name: "Projects" }).click();
  await expect(page.getByText("No projects yet.")).toBeVisible();
});

test("an open proposal shows its version stamp with the app build", async ({ page }) => {
  await clientPortal(page, async (path, route) => {
    if (path.endsWith("/status")) { await route.fulfill({ json: ok({ status: "ok", checks: [], version: "15be847", uptimeSeconds: 1, checkedAt: "2026-10-02T00:00:00.000Z" }) }); return true; }
    if (path.endsWith("/proposals")) { await route.fulfill({ json: ok({ items: [{ ...proposal, version: 4 }] }) }); return true; }
    if (path.endsWith(`/proposals/${proposal.id}`)) { await route.fulfill({ json: ok({ ...proposal, version: 4 }) }); return true; }
    return false;
  });
  await page.getByRole("button", { name: "Field mapping" }).click();
  const stamp = page.getByTestId("proposal-version-stamp");
  await expect(stamp).toContainText("Version 4");
  await expect(stamp).toContainText("Updated");
  await expect(stamp).toContainText("Build 15be847");
});

type LiveSection = { key: string; title: string; clientLabel: string; state: string; text: string; guidance: string; maxChars: number; updatedAt: string };
const liveSection = (key: string, text: string, updatedAt = "2026-10-02T00:00:00.000Z"): LiveSection => ({ key, title: key === "terms" ? "Terms" : key, clientLabel: key, state: "drafted", text, guidance: "", maxChars: 5000, updatedAt });
async function livePortal(page: Page) {
  const state = { proposal: { ...proposal }, sections: [liveSection("terms", "Original terms"), liveSection("approach", "Original approach")], failures: 0, reads: [] as string[], polls: 0, hold: null as null | Promise<void> };
  await page.clock.install();
  await clientPortal(page, async (path, route) => {
    if (path.endsWith("/proposals")) { await route.fulfill({ json: ok({ items: [state.proposal] }) }); return true; }
    if (path.endsWith(`/proposals/${proposal.id}`)) { await route.fulfill({ json: ok(state.proposal) }); return true; }
    if (path.endsWith("/narrative")) { await route.fulfill({ json: ok(state.sections) }); return true; }
    if (path.endsWith("/freshness")) {
      state.polls++;
      const entity = { record: { version: state.proposal.version, updatedAt: state.proposal.updatedAt }, parts: state.sections.map(({ key, updatedAt }) => ({ key, updatedAt })) };
      if (state.hold) await state.hold;
      await route.fulfill({ json: ok(entity) }).catch(() => {}); return true;
    }
    const match = path.match(/\/narrative\/([^/]+)$/);
    if (match) {
      state.reads.push(match[1]);
      if (state.failures > 0) { state.failures--; await route.fulfill({ status: 503, json: { ok: false, code: "UNAVAILABLE" } }); return true; }
      const section = state.sections.find(item => item.key === match[1]);
      await route.fulfill({ status: section ? 200 : 404, json: section ? ok(section) : { ok: false, code: "NOT_FOUND" } }); return true;
    }
    return false;
  });
  await page.getByRole("button", { name: "Field mapping", exact: true }).click();
  await expect(page.locator("#part-terms")).toContainText("Original terms");
  return state;
}

test("live proposal refresh retries failed parts, removes deleted parts, and fetches only changes", async ({ page }) => {
  const state = await livePortal(page);
  state.sections[0] = liveSection("terms", "Updated terms", "2026-10-03T00:00:00.000Z");
  state.failures = 1;
  await page.clock.runFor(8100);
  await expect.poll(() => state.reads.length).toBe(1);
  await expect(page.locator("#part-terms")).toContainText("Original terms");
  await page.clock.runFor(8100);
  await expect(page.locator("#part-terms")).toContainText("Updated terms");
  expect(state.reads).toEqual(["terms", "terms"]);
  state.sections = [state.sections[0]];
  await page.clock.runFor(8100);
  await expect(page.locator("#part-approach")).toHaveCount(0);
  expect(state.reads).toEqual(["terms", "terms"]);
  state.proposal = { ...state.proposal, title: "Updated mapping", version: 2, updatedAt: "2026-10-04T00:00:00.000Z" };
  await page.clock.runFor(8100);
  await expect(page.getByRole("heading", { name: "Updated mapping", exact: true })).toBeVisible();
});

test("opening the proposal editor cancels in-flight refreshes and pauses polling", async ({ page }) => {
  const state = await livePortal(page);
  let release!: () => void;
  state.hold = new Promise(resolve => { release = resolve; });
  state.sections[0] = liveSection("terms", "Remote terms", "2026-10-03T00:00:00.000Z");
  await page.clock.runFor(8100);
  await expect.poll(() => state.polls).toBe(1);
  await page.getByRole("button", { name: "Edit proposal", exact: true }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("My unsaved title");
  release();
  await page.clock.runFor(24000);
  await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("My unsaved title");
  expect(state.polls).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("#part-terms")).toContainText("Original terms");
  await page.clock.runFor(8100);
  await expect(page.locator("#part-terms")).toContainText("Remote terms");
});

test("live narrative updates preserve unsaved part text", async ({ page }) => {
  const state = await livePortal(page);
  await page.goto(`/portal?proposal=${proposal.id}&part=terms`);
  const editor = page.getByRole("textbox", { name: "Wording", exact: true });
  await expect(editor).toHaveValue("Original terms");
  await editor.fill("My unsaved terms");
  state.sections[0] = liveSection("terms", "Remote terms", "2026-10-03T00:00:00.000Z");
  await page.clock.runFor(8100);
  await expect(page.locator("#part-terms")).toContainText("Remote terms");
  await expect(editor).toHaveValue("My unsaved terms");
});
