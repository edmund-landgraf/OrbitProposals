import { expect, test, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";

const proposalId = "11111111-1111-4111-8111-111111111111";
const proposal = {
  id: proposalId,
  title: "Intake automation",
  engagement: "capped_hours_4",
  status: "draft",
  scope: { summary: "Automate the client intake workflow.", deliverables: ["Intake form", "CRM sync"], assumptions: [], exclusions: [] },
  timeline: { startDate: null, targetDate: null, milestones: [] },
  pricing: { model: "fixed", amountMinor: 100000, currency: "USD" },
  options: [],
  version: 3,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};

const reopenedBy = { source: "scope", change: "adding a mobile app" };
const progress = {
  settled: 4,
  toDiscuss: 1,
  total: 6,
  headline: "4 of 6 parts settled, 1 to discuss with us",
  phrase: "Taking shape",
  percent: 50,
  groups: [
    { code: "locked", label: "Locked", settled: true, parts: [{ key: "terms", label: "Terms", state: "locked", stateLabel: "Locked", group: "locked", settled: true, whatsLeft: "Settled and locked to a version.", reopenedBy: null, dependsOn: [] }] },
    { code: "ready", label: "Done", settled: true, parts: [
      { key: "schedule", label: "Dates", state: "agreed", stateLabel: "Agreed", group: "ready", settled: true, whatsLeft: "Agreed. It locks when the proposal is approved.", reopenedBy: null, dependsOn: [] },
      { key: "milestones", label: "Milestones", state: "agreed", stateLabel: "Agreed", group: "ready", settled: true, whatsLeft: "Agreed. It locks when the proposal is approved.", reopenedBy: null, dependsOn: ["scope"] },
    ] },
    { code: "to_discuss", label: "To discuss with us", settled: true, parts: [
      { key: "hours", label: "Hours", state: "unsure", stateLabel: "To talk through with us", group: "to_discuss", settled: true, toDiscuss: true, note: "Not sure how much support we need after launch", whatsLeft: "Marked unsure. We will talk it through on the call.", reopenedBy: null, dependsOn: ["scope"] },
    ] },
    { code: "reopened", label: "Reopened by a change", settled: false, parts: [
      { key: "scope", label: "Scope", state: "needs_review", stateLabel: "Needs another look", group: "reopened", settled: false, whatsLeft: "Needs another look because scope changed: adding a mobile app.", reopenedBy, dependsOn: [] },
    ] },
    { code: "in_progress", label: "In progress", settled: false, parts: [{ key: "price", label: "Price", state: "drafted", stateLabel: "Drafted", group: "in_progress", settled: false, whatsLeft: "Drafted. Review it and agree, or ask for changes.", reopenedBy: null, dependsOn: ["hours"] }] },
  ],
  nextStep: { key: "scope", text: "Take another look at scope, since scope changed: adding a mobile app." },
  savedForLater: { heading: "Saved for later", note: "These ideas are kept for a follow-up and do not count toward progress.", items: [{ id: "p1", summary: "Customer portal, phase 2" }] },
  sinceLastVisit: { direction: "down", before: 83, after: 50, text: "Since your last visit this went from 83% to 50%. A change to scope (adding a mobile app) reopened Scope." },
  lastSeenAt: "2026-10-20T00:00:00.000Z",
  resolutions: [{ code: "unsure", label: "Not sure, talk to a human", flagsForCall: true }, { code: "staff_decides", label: "Let Unwhelm decide", flagsForCall: false }, { code: "out_of_scope", label: "Out of scope / save for later", flagsForCall: false }],
  statuses: [{ code: "open", label: "Not started" }, { code: "drafted", label: "Drafted" }, { code: "agreed", label: "Agreed" }],
  handoff: {
    ready: true,
    heading: "Ready for a call with Unwhelm",
    body: "You do not need to finish everything. Send it as it is, and we will work through anything open or unsure together on the call.",
    submitLabel: "Send as it is",
    reasons: [{ code: "client_unsure", label: "Some parts are easier to settle on a call", note: null }, { code: "scope_unbounded", label: "The scope is open-ended and needs a human to bound it", note: null }],
    openParts: [],
    draftedParts: ["Price"],
    reopenedParts: ["Scope"],
    discussParts: ["Hours"],
    openSummary: "Drafted, awaiting agreement: Price. Needs another look: Scope.",
  },
};

async function json(route: Route, entity: unknown) { await route.fulfill({ json: { ok: true, entity, warnings: [], links: {} } }); }

test("a client sees how complete the proposal is and why it moved", async ({ page }) => {
  let seen = false;
  let resolved: unknown = null;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) { await json(route, { user: { roles: ["client"] }, isAdmin: false }); return; }
    if (path.endsWith("/proposals") && route.request().method() === "GET") { await json(route, { items: [proposal] }); return; }
    if (path.endsWith(`/proposals/${proposalId}`)) { await json(route, proposal); return; }
    if (path.endsWith(`/proposals/${proposalId}/progress/seen`)) { seen = true; await json(route, { percent: 50 }); return; }
    if (path.endsWith(`/proposals/${proposalId}/progress`)) { await json(route, progress); return; }
    if (path.endsWith(`/proposals/${proposalId}/completion/nodes/price/resolve`)) { resolved = route.request().postDataJSON(); await json(route, { key: "price", state: "unsure" }); return; }
    if (path.endsWith(`/proposals/${proposalId}/narrative`)) { await json(route, []); return; }
    await route.fulfill({ status: 404, json: { ok: false, code: "NOT_FOUND", message: "Not found." } });
  });
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto("/portal");
  await page.getByRole("button", { name: "Intake automation" }).click();
  const panel = page.getByRole("region", { name: "Proposal progress" });
  await expect(panel.getByRole("heading", { name: "4 of 6 parts settled, 1 to discuss with us" })).toBeVisible();
  await expect(panel.getByRole("progressbar", { name: "Drafted, 1 of 6" })).toHaveAttribute("aria-valuenow", "17");
  await expect(panel.getByRole("progressbar", { name: "Complete, 4 of 6" })).toHaveAttribute("aria-valuenow", "67");
  await expect(panel.getByText("Taking shape")).toBeVisible();
  await expect(panel.getByRole("status")).toContainText("reopened Scope");
  await expect(panel.getByLabel("Next best step")).toContainText("Take another look at scope");
  await expect(panel.getByRole("heading", { name: /Reopened by a change/ })).toBeVisible();
  await expect(panel.getByText("Customer portal, phase 2")).toBeVisible();
  await expect.poll(() => seen).toBe(true);
  await expect(panel.getByRole("region", { name: "Ready for a call with Unwhelm" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Send as it is" })).toBeVisible();
  await expect(panel.getByText("Not sure how much support we need after launch")).toBeVisible();
  const priceStatus = panel.getByLabel("Status of Price");
  await expect(priceStatus).toHaveValue("drafted");
  await expect(priceStatus.getByRole("option", { name: "Not started" })).toHaveCount(1);
  await expect(priceStatus.getByRole("option", { name: "Drafted" })).toHaveCount(1);
  await expect(priceStatus.getByRole("option", { name: "Agreed" })).toHaveCount(1);
  await expect(priceStatus.getByRole("option", { name: "Not sure, talk to a human" })).toHaveCount(1);
  await panel.getByRole("button", { name: "Scope" }).click();
  await expect(page.getByRole("region", { name: "Scope details" })).toContainText("Automate the client intake workflow.");
  await priceStatus.selectOption("unsure");
  await expect.poll(() => resolved).toEqual({ resolution: "unsure" });
  try {
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    await panel.screenshot({ path: "/opt/cursor/artifacts/proposal-progress.png" });
  } catch { /* artifact path is optional outside CI */ }
  if (process.env.PROGRESS_SHOT) await panel.screenshot({ path: process.env.PROGRESS_SHOT });
});
