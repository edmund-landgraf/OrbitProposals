import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { samplePlans } from "../src/tryChatSamples";
import { describeResult } from "../shared/tryFormat";

type CallStatus = "pending" | "running" | "ok" | "refused" | "error";
const call = (seq: number, toolName: string, status: CallStatus, summary: string | null = null) => ({
  seq, toolName, note: null, expect: "ok", status, summary, durationMs: status === "pending" || status === "running" ? null : 40,
  trace: status === "pending" || status === "running" ? null : { id: `t${seq}`, occurredAt: "2026-10-26T00:00:00Z", durationMs: 40, isError: status === "error", errorMessage: null, input: "{}", output: "{}" },
});
const task = (seq: number, status: string, calls: ReturnType<typeof call>[]) => ({ seq, title: `Task ${seq}`, narration: `Narration ${seq}`, status, calls });
const P = (n: number) => [call(1, `tool_${n}_a`, "pending"), call(2, `tool_${n}_b`, "pending")];
const demo = (status: string, nextTaskSeq: number | null, tasks: ReturnType<typeof task>[]) => ({
  id: "demo1", plan: { code: "p1", title: "Plan one", description: "d" }, status, nextTaskSeq, errorMessage: null, expiresAt: "2026-10-26T23:00:00Z",
  doneTasks: tasks.filter((t) => t.status === "done" || t.status === "attention").length, totalTasks: tasks.length, doneCalls: 0, totalCalls: tasks.length * 2, tasks,
});

// Successive poll replies: task 1 mid-flight, task 1 done and task 2 running, then paused before task 3, then task 3 failing.
const states = [
  demo("running", null, [task(1, "running", [call(1, "unw_get_service_info", "ok"), call(2, "unw_get_catalog", "running")]), task(2, "pending", P(2)), task(3, "pending", P(3)), task(4, "pending", P(4))]),
  demo("running", null, [task(1, "done", [call(1, "unw_get_service_info", "ok"), call(2, "unw_get_catalog", "ok")]), task(2, "running", [call(1, "tool_2_a", "running"), call(2, "tool_2_b", "pending")]), task(3, "pending", P(3)), task(4, "pending", P(4))]),
  demo("paused", 3, [task(1, "done", [call(1, "unw_get_service_info", "ok"), call(2, "unw_get_catalog", "ok")]), task(2, "done", [call(1, "tool_2_a", "ok"), call(2, "tool_2_b", "refused")]), task(3, "pending", P(3)), task(4, "pending", P(4))]),
];

async function mock(page: Page, replies: unknown[]) {
  let n = 0;
  await page.route("**/api/v1/public/demo/plans", (r) => r.fulfill({ json: { ok: true, entity: [{ code: "p1", title: "Plan one", description: "d", taskCount: 4, callCount: 8, tasks: [] }] } }));
  await page.route("**/api/v1/public/demo/sessions", (r) => r.fulfill({ status: 201, json: { ok: true, entity: { id: "demo1", token: "tok", mcpUrl: "http://x/mcp", expiresAt: "2026-10-26T23:00:00Z", scopes: [] } } }));
  await page.route("**/api/v1/public/demo/sessions/demo1", (r) => r.fulfill({ json: { ok: true, entity: replies[Math.min(n++, replies.length - 1)] } }));
  await page.route("**/api/v1/public/demo/sessions/demo1/continue", (r) => r.fulfill({ status: 202, json: { ok: true, entity: {} } }));
  // Watch every DOM change: record the most open chunks ever shown, and whether a third opened while a call was running.
  await page.addInitScript(() => {
    const w = window as unknown as { maxOpen: number; thirdWhileRunning: boolean };
    w.maxOpen = 0; w.thirdWhileRunning = false;
    new MutationObserver(() => {
      const open = document.querySelectorAll(".try-me-chunk.is-open").length;
      w.maxOpen = Math.max(w.maxOpen, open);
      if (open > 2 && document.querySelector('.try-me-call[data-check="running"]')) w.thirdWhileRunning = true;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
}

test("run view opens at most two chunks and never a third while a call is in flight", async ({ page }) => {
  await mock(page, states);
  await page.goto("/try");
  await page.getByRole("button", { name: "Start" }).click();
  const open = page.locator(".try-me-chunk.is-open");
  // State 0: task 1 is current with one call checked and one spinning; task 2 is the read-ahead; tasks 3 and 4 stay closed.
  await expect(open).toHaveCount(2);
  await expect(open.nth(0)).toHaveAttribute("data-seq", "1");
  await expect(open.nth(1)).toHaveAttribute("data-seq", "2");
  await expect(page.locator('.try-me-call[data-check="done"] code', { hasText: "unw_get_service_info" })).toBeVisible();
  await expect(page.locator('.try-me-call[data-check="running"] code', { hasText: "unw_get_catalog" })).toBeVisible();
  await expect(page.locator('.try-me-chunk[data-seq="3"]')).toHaveCount(0);
  // State 1: task 1 collapses, task 2 becomes current, task 3 loads as next.
  await expect(open.nth(0)).toHaveAttribute("data-seq", "2");
  await expect(open.nth(1)).toHaveAttribute("data-seq", "3");
  await expect(page.locator('.try-me-chunk[data-seq="4"]')).toHaveCount(0);
  // State 2: paused before task 3.
  await expect(page.getByRole("button", { name: "Run the next task" })).toBeVisible();
  await expect(open).toHaveCount(2);
  const stats = await page.evaluate(() => { const w = window as unknown as { maxOpen: number; thirdWhileRunning: boolean }; return { maxOpen: w.maxOpen, thirdWhileRunning: w.thirdWhileRunning }; });
  expect(stats.maxOpen).toBeLessThanOrEqual(2);
  expect(stats.thirdWhileRunning).toBe(false);
});

test("finished chunks collapse to one checked line that still opens by keyboard", async ({ page }) => {
  await mock(page, [states[2]]);
  await page.goto("/try");
  await page.getByRole("button", { name: "Start" }).click();
  const done = page.locator(".try-me-chunk.is-done");
  await expect(done).toHaveCount(2);
  await expect(done.locator('summary [data-state="done"]')).toHaveCount(2);
  await expect(done.first().locator(".try-me-call").first()).toBeHidden();
  // Collapsed lines sit above the open chunks.
  const order = await page.locator(".try-me-chunks > li").evaluateAll((els) => els.map((e) => e.className.includes("is-done") ? "d" : e.className.includes("is-open") ? "o" : "x").join(""));
  expect(order.startsWith("ddoo")).toBe(true);
  await done.first().locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(done.first().locator(".try-me-call").first()).toBeVisible();
  for (const name of ["Run the next task", "Run the rest", "Stop and take over"]) await expect(page.getByRole("button", { name })).toBeEnabled();
  const axe = await new AxeBuilder({ page }).include(".try-me").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test("a failed call shows an error box and its reason", async ({ page }) => {
  const failed = demo("failed", null, [task(1, "attention", [call(1, "unw_get_service_info", "error", "Could not reach Unwhelm's MCP server at 127.0.0.1:3202/mcp (ECONNREFUSED).")]), task(2, "pending", P(2))]);
  await mock(page, [failed]);
  await page.goto("/try");
  await page.getByRole("button", { name: "Start" }).click();
  const line = page.locator(".try-me-chunk.is-done").first();
  await expect(line.locator('summary [data-state="error"]')).toBeVisible();
  await line.locator("summary").click();
  await expect(line.locator('.try-me-call[data-check="error"] [role="img"]')).toHaveAttribute("aria-label", /Failed/);
  await expect(line.getByText(/ECONNREFUSED/)).toBeVisible();
});

// ---- View toggle and Chat view ----

test("the toggle defaults to Live run, saves the choice, and both views render", async ({ page }) => {
  await mock(page, states);
  await page.goto("/try");
  const group = page.getByRole("group", { name: "View" });
  await expect(group.getByRole("button", { name: "Live run" })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: "Chat view" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await group.getByRole("button", { name: "Chat view" }).click();
  await expect(page.getByTestId("sample-tag")).toHaveText("Sample data");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "Chat view" })).toHaveClass(/button button-primary/);
  await expect(group.getByRole("button", { name: "Live run" })).toHaveClass(/button button-secondary/);
  expect(await page.evaluate(() => localStorage.getItem("unwh.try.view"))).toBe("chat");
  await page.reload();
  await expect(page.getByRole("group", { name: "View" }).getByRole("button", { name: "Chat view" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Continue in web chat (coming soon)" })).toBeDisabled();
  await page.getByRole("button", { name: "Live run" }).click();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("unwh.try.view"))).toBe("live");
});

test("the live run never loads the chat sample script", async ({ page }) => {
  const loaded: string[] = [];
  page.on("request", (r) => { if (r.url().includes("tryChatSamples")) loaded.push(r.url()); });
  await mock(page, states);
  await page.goto("/try");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".try-me-chunk.is-open").first()).toBeVisible();
  expect(loaded).toEqual([]);
});

// The real plan list, as the API serves it: the Chat view uses the same cards as the Live run.
async function mockPlans(page: Page) {
  await page.route("**/api/v1/public/demo/plans", (r) => r.fulfill({ json: { ok: true, entity: samplePlans.map((p) => ({ code: p.code, title: p.title, description: p.description, taskCount: p.sections.length, callCount: p.sections.reduce((n, x) => n + x.calls.length, 0), tasks: [] })) } }));
}
async function chatStart(page: Page, code: string) {
  await page.addInitScript(() => localStorage.setItem("unwh.try.view", "chat"));
  await mockPlans(page);
  await page.goto("/try");
  await page.locator("label.try-me-plan", { hasText: samplePlans.find((p) => p.code === code)!.title }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
}

test("both views show the same seven plan cards and the same Start button", async ({ page }) => {
  await mockPlans(page);
  await page.goto("/try");
  const titles = samplePlans.map((p) => p.title);
  expect(titles).toHaveLength(7);
  await expect(page.locator("label.try-me-plan")).toHaveCount(7);
  await expect(page.locator("label.try-me-plan .try-me-plan-title")).toHaveText(titles);
  await page.getByRole("button", { name: "Chat view" }).click();
  await expect(page.locator("label.try-me-plan")).toHaveCount(7);
  await expect(page.locator("label.try-me-plan .try-me-plan-title")).toHaveText(titles);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveClass(/button-primary/);
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("chat view reveals bubbles in order at a readable pace, ticks each call, and stays on the last frame", async ({ page }) => {
  const plan = samplePlans.find((p) => p.code === "review_loop")!;
  await page.clock.install();
  await chatStart(page, plan.code);
  await expect(page.getByText("A recorded sample conversation, not a live run.")).toBeVisible();
  const shown = () => page.locator(".try-chat").getAttribute("data-shown").then(Number);
  const total = plan.sections.reduce((n, s) => n + s.calls.length * 2, 0);
  // All bubbles are in the DOM up front, hidden until their turn.
  await expect(page.locator(".try-chat [data-step]")).toHaveCount(total);
  expect(await shown()).toBe(0);
  await expect(page.locator('[data-step="1"]')).toBeHidden();
  await expect(page.locator('.try-chat-call[data-check="pending"]').first()).toBeVisible();
  // Readable: nothing new for at least REVEAL_MS (2.6 s).
  await page.clock.runFor(2500);
  expect(await shown()).toBe(0);
  const advance = async (to: number) => { for (let i = 0; i < 40 && (await shown()) < to; i++) await page.clock.runFor(250); expect(await shown()).toBe(to); };
  await advance(1);
  const first = plan.sections[0].calls[0];
  await expect(page.locator('[data-step="1"] .try-chat-answer')).toHaveText(describeResult(first.tool, first.result).text);
  await expect(page.locator(".try-chat-section.is-current .try-chat-call").first()).toHaveAttribute("data-check", "done");
  for (let i = 2; i < total; i++) {
    await advance(i);
    if (i < total - 1) expect(await page.locator(".try-chat-section:not(.is-done):not([hidden])").count()).toBeLessThanOrEqual(2);
  }
  await expect(page.getByText("That's the whole sample conversation.")).toBeVisible();
  // The last frame stays: every section and bubble visible, nothing collapsed, nothing pending, even much later.
  await page.clock.runFor(60_000);
  expect(await shown()).toBe(total - 1);
  await expect(page.locator(".try-chat-section.is-done")).toHaveCount(0);
  await expect(page.locator(".try-chat-section.is-final")).toHaveCount(plan.sections.length);
  for (let i = 0; i < total; i++) await expect(page.locator(`[data-step="${i}"]`)).toBeVisible();
  await expect(page.locator('.try-chat-call[data-check="pending"]')).toHaveCount(0);
});

test("chat view with reduced motion shows everything at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await chatStart(page, "after_sale");
  await expect(page.getByText("That's the whole sample conversation.")).toBeVisible();
  await expect(page.locator('.try-chat-call[data-check="pending"]')).toHaveCount(0);
  await expect(page.locator(".try-chat-answer").first()).toHaveText("No projects yet. Accepted work will show up here.");
});

test("chat results stack at 390 with show more and raw JSON, and pass axe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await chatStart(page, "build_submit");
  const ex = page.locator(".try-chat-exchange").first();
  const left = await ex.locator(".is-left").boundingBox(); const right = await ex.locator(".is-right").boundingBox();
  expect(right!.y).toBeGreaterThan(left!.y + left!.height - 1);
  expect(right!.x + right!.width).toBeLessThanOrEqual(390);
  const more = page.getByRole("button", { name: /Show more/ }).first();
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole("button", { name: "Show less" }).first()).toBeVisible();
  await page.locator(".try-chat-raw summary").first().click();
  await expect(page.locator(".try-chat-raw .try-me-json").first()).toContainText(/ok\W+true/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const axe = await new AxeBuilder({ page }).include(".try-me").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("every sample call formats to a real sentence, never a thin line", () => {
  for (const plan of samplePlans) for (const s of plan.sections) for (const c of s.calls) {
    if (c.status !== "ok") { expect(c.error, `${plan.code} ${c.tool}`).toBeTruthy(); continue; }
    const d = describeResult(c.tool, c.result);
    expect(d.text, `${plan.code} ${c.tool}`).not.toMatch(/^(Done\.|Nothing yet\.|status \w+|\d+ items?)$/);
    expect(d.text.length + d.facts.join(" ").length, `${plan.code} ${c.tool}`).toBeGreaterThanOrEqual(12);
  }
  // Only the boundaries plan refuses.
  expect(samplePlans.filter((p) => p.code !== "boundaries").flatMap((p) => p.sections.flatMap((s) => s.calls)).filter((c) => c.status !== "ok")).toEqual([]);
});
