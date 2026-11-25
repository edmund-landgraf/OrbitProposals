import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdirSync } from "node:fs";

const proposalId = "11111111-1111-4111-8111-111111111111";

function envelope(entity: unknown) {
  return { ok: true, changed: true, entity, warnings: [], links: {} };
}

const transitions = {
  request: { to: "changes_requested", action: "request_changes", label: "Request changes", requiresComment: true, requiresReason: false },
  revise: { to: "client_revising", action: "start_revision", label: "Start revision", requiresComment: false, requiresReason: false },
  resubmit: { to: "resubmitted", action: "resubmit", label: "Resubmit", requiresComment: false, requiresReason: false },
};

function workspace(state: string, clientLabel: string, staffLabel: string, allowed: object[], comments: object[]) {
  return {
    proposalId,
    state,
    clientLabel,
    staffLabel,
    clientEditable: state === "client_revising" || state === "draft",
    approvedVersionId: null,
    meeting: null,
    comments,
    flags: [{ id: "flag-1", targetKind: "scope", targetId: null, kind: "unbounded", reason: "Support described as ongoing.", status: "open", visibility: "client", authorRole: "agent", blocksApproval: true, automatic: true }],
    events: [],
    versions: [{ id: "ver-1", number: 1, locked: false, createdAt: "2026-10-02T00:00:00.000Z", reason: "submit" }],
    allowedTransitions: allowed,
    commentTypes: [{ code: "pushback", blocksApproval: false }, { code: "clarification", blocksApproval: false }],
    reasonCodes: [{ code: "budget", label: "Budget", actions: ["reject", "withdraw"] }, { code: "scope", label: "Scope", actions: ["reject", "withdraw"] }],
    visibilities: ["internal", "client"],
  };
}

const comment = { id: "comment-1", parentId: null, targetKind: "scope", targetId: null, type: "pushback", status: "open", visibility: "client", authorRole: "staff", body: "Please bound the ongoing support.", createdAt: "2026-10-02T00:00:00.000Z" };

async function fulfillJson(route: Route, entity: unknown) {
  await route.fulfill({ json: envelope(entity) });
}

test("staff request changes from the admin review queue", async ({ page }) => {
  let state = "in_review";
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) { await fulfillJson(route, { isAdmin: true, user: { isAdmin: true, roles: ["staff"] } }); return; }
    if (path.endsWith("/admin/users")) { await fulfillJson(route, { items: [] }); return; }
    if (path.endsWith("/admin/tokens")) { await fulfillJson(route, { items: [] }); return; }
    if (path.endsWith("/admin/audit")) { await fulfillJson(route, { items: [] }); return; }
    if (path.endsWith("/admin/access-requests")) { await fulfillJson(route, { items: [] }); return; }
    if (path.endsWith("/proposals/review-queue")) {
      await fulfillJson(route, { states: [{ code: "in_review", staffLabel: "Staff review" }, { code: "changes_requested", staffLabel: "Changes requested" }], items: [{ id: proposalId, title: "Field mapping", state, clientLabel: "In review", staffLabel: state === "changes_requested" ? "Changes requested" : "Staff review", updatedAt: "2026-10-02T00:00:00.000Z" }] });
      return;
    }
    if (path.endsWith(`/proposals/${proposalId}/review/transition`) && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { commentBody?: string };
      expect(body.commentBody).toContain("bound");
      state = "changes_requested";
      await fulfillJson(route, { state, version: null });
      return;
    }
    if (path.endsWith(`/proposals/${proposalId}/review`)) {
      await fulfillJson(route, workspace(state, "In review", state === "changes_requested" ? "Changes requested" : "Staff review", state === "in_review" ? [transitions.request] : [], state === "changes_requested" ? [comment] : []));
      return;
    }
    await route.fulfill({ status: 404, json: { ok: false, code: "NOT_FOUND", message: "Not found." } });
  });
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Reviews" }).click();
  await page.getByRole("button", { name: "Field mapping" }).click();
  await expect(page.getByRole("heading", { name: "Field mapping" })).toBeVisible();
  const requestChanges = page.getByRole("button", { name: "Request changes" });
  await expect(requestChanges).toBeDisabled();
  await page.getByLabel("Comment").fill("Please bound the ongoing support.");
  await requestChanges.click();
  await expect(page.getByRole("cell", { name: "Changes requested" })).toBeVisible();
  await saveShot(page, "admin-review");
});

test("a client sees feedback, replies, and resubmits", async ({ page }) => {
  let phase: "requested" | "revising" | "resubmitted" = "requested";
  const proposal = {
    id: proposalId,
    title: "Field mapping",
    engagement: "workflow_check",
    status: "draft",
    scope: { summary: "Map the intake.", deliverables: ["Map"], assumptions: [], exclusions: [] },
    timeline: { startDate: null, targetDate: null, milestones: [] },
    pricing: { model: "fixed", amountMinor: 100000, currency: "USD" },
    options: [],
    version: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) { await fulfillJson(route, { user: { roles: ["client"] }, isAdmin: false }); return; }
    if (path.endsWith("/proposals") && route.request().method() === "GET") { await fulfillJson(route, { items: [proposal] }); return; }
    if (path.endsWith(`/proposals/${proposalId}`) && route.request().method() === "GET") { await fulfillJson(route, proposal); return; }
    if (path.endsWith(`/proposals/${proposalId}/review/comments`) && route.request().method() === "POST") { await fulfillJson(route, { id: "reply-1", visibility: "client", status: "open" }); return; }
    if (path.endsWith(`/proposals/${proposalId}/review/transition`) && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { to: string };
      phase = body.to === "client_revising" ? "revising" : "resubmitted";
      await fulfillJson(route, { state: phase === "revising" ? "client_revising" : "resubmitted", version: phase === "resubmitted" ? { id: "ver-2", number: 2, locked: false } : null });
      return;
    }
    if (path.endsWith(`/proposals/${proposalId}/review`)) {
      const allowed = phase === "requested" ? [transitions.revise] : phase === "revising" ? [transitions.resubmit] : [];
      const label = phase === "resubmitted" ? "Resubmitted" : phase === "revising" ? "Revising" : "Changes requested";
      const state = phase === "resubmitted" ? "resubmitted" : phase === "revising" ? "client_revising" : "changes_requested";
      await fulfillJson(route, { ...workspace(state, label, label, allowed, [comment]), visibilities: ["client"] });
      return;
    }
    await route.fulfill({ status: 404, json: { ok: false, code: "NOT_FOUND", message: "Not found." } });
  });
  await page.goto("/portal");
  await page.getByRole("button", { name: "Field mapping" }).click();
  await expect(page.locator(".review-list").getByText("Please bound the ongoing support.")).toBeVisible();
  await expect(page.locator(".review-list").getByText("Support described as ongoing.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Reply" }).fill("We can cap this at forty hours.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await page.getByRole("button", { name: "Start revision" }).click();
  await page.getByRole("button", { name: "Resubmit" }).click();
  await expect(page.locator(".portal-proposal-document .portal-status-badge").first()).toHaveText("Resubmitted");
  await saveShot(page, "client-feedback");
});

async function saveShot(page: Page, name: string) {
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  await page.screenshot({ path: `/opt/cursor/artifacts/${name}.png`, fullPage: true });
}
