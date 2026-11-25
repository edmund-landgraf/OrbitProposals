import assert from "node:assert/strict";
import test from "node:test";
import {
  TimelineMilestoneInputSchema,
  addWeeksToDate,
  resolveTimelineMilestones,
  splitEngagementRange,
  withEndWeeks,
} from "../../server/proposalTimeline.js";

test("one engagement range splits across phases and still adds up", () => {
  const phases = splitEngagementRange({ hoursLow: 60, hoursHigh: 110, weeksLow: 7, weeksHigh: 11 }, 5);
  assert.equal(phases.length, 5);
  assert.equal(phases.reduce((sum, phase) => sum + phase.hoursLow, 0), 60);
  assert.equal(phases.reduce((sum, phase) => sum + phase.hoursHigh, 0), 110);
  assert.equal(phases.reduce((sum, phase) => sum + phase.weeksLow, 0), 7);
  assert.equal(phases.reduce((sum, phase) => sum + phase.weeksHigh, 0), 11);
  assert.ok(phases.every((phase) => phase.hoursHigh >= phase.hoursLow && phase.weeksHigh >= phase.weeksLow && phase.weeksLow >= 1));
});

test("addWeeksToDate counts whole weeks from a date-only start", () => {
  assert.equal(addWeeksToDate("2026-11-16", 0), "2026-11-16");
  assert.equal(addWeeksToDate("2026-11-16", 1), "2026-11-23");
  assert.equal(addWeeksToDate("2026-11-16", 10), "2027-01-25");
});

test("weekOffset milestones become due dates when a start date is present", () => {
  const result = resolveTimelineMilestones([
    { title: "Kickoff", description: "Start", weekOffset: 1 },
    { title: "Launch", description: "Go live", weekOffset: 10 },
  ], "2026-11-16");
  assert.equal(result.warnings.length, 0);
  assert.equal(result.milestones.length, 2);
  assert.equal(result.milestones[0]?.dueDate, "2026-11-23");
  assert.equal(result.milestones[1]?.dueDate, "2027-01-25");
  assert.equal(result.milestones[0]?.title, "Kickoff");
  assert.match(result.milestones[0]?.id ?? "", /^[0-9a-f-]{36}$/i);
});

test("weekOffset without a start date is kept and warned, not dropped", () => {
  const result = resolveTimelineMilestones([
    { title: "Launch", description: "Go live", weekOffset: 10 },
  ], null);
  assert.equal(result.milestones.length, 1);
  assert.equal(result.milestones[0]?.dueDate, null);
  assert.equal(result.milestones[0]?.title, "Launch");
  assert.equal(result.warnings[0]?.code, "MILESTONE_WEEK_OFFSET_UNRESOLVED");
});

test("an explicit due date wins when it disagrees with weekOffset, with a warning", () => {
  const result = resolveTimelineMilestones([
    { title: "Launch", description: "Go live", dueDate: "2027-02-01", weekOffset: 10 },
  ], "2026-11-16");
  assert.equal(result.milestones[0]?.dueDate, "2027-02-01");
  assert.equal(result.warnings[0]?.code, "MILESTONE_DATE_MISMATCH");
});

test("null due dates without weekOffset are kept", () => {
  const result = resolveTimelineMilestones([
    { id: "11111111-1111-4111-8111-111111111111", title: "Kickoff", description: "Start", dueDate: null },
  ], null);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.milestones[0]?.dueDate, null);
  assert.equal(result.milestones[0]?.id, "11111111-1111-4111-8111-111111111111");
});

test("a milestone with neither dueDate nor weekOffset is rejected", () => {
  const parsed = TimelineMilestoneInputSchema.safeParse({ title: "Launch", description: "Go live" });
  assert.equal(parsed.success, false);
});

test("a write that echoes computed end weeks is accepted and the values are dropped", () => {
  const parsed = TimelineMilestoneInputSchema.safeParse({
    title: "Align",
    description: "ARR definitions",
    weeksLow: 1,
    weeksHigh: 2,
    endsWeekLow: 1,
    endsWeekHigh: 2,
  });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal("endsWeekLow" in parsed.data, false);
  assert.equal("endsWeekHigh" in parsed.data, false);
  assert.equal(parsed.data.weeksLow, 1);
});

test("an unknown milestone key is still rejected", () => {
  const parsed = TimelineMilestoneInputSchema.safeParse({ title: "Align", weeksLow: 1, weeksHigh: 2, madeUp: true });
  assert.equal(parsed.success, false);
});

test("week estimates are enough without a due date", () => {
  const parsed = TimelineMilestoneInputSchema.safeParse({ title: "Align", description: "ARR definitions", weeksLow: 1, weeksHigh: 2, gate: "Finance signs." });
  assert.equal(parsed.success, true);
});

test("end weeks accumulate from phase durations", () => {
  const rows = withEndWeeks([
    { title: "Align", weeksLow: 1, weeksHigh: 2 },
    { title: "Connect", weeksLow: 2, weeksHigh: 3 },
    { title: "Model", weeksLow: 2, weeksHigh: 3 },
  ]);
  assert.equal(rows[0]?.endsWeekLow, 1);
  assert.equal(rows[0]?.endsWeekHigh, 2);
  assert.equal(rows[1]?.endsWeekLow, 3);
  assert.equal(rows[1]?.endsWeekHigh, 5);
  assert.equal(rows[2]?.endsWeekLow, 5);
  assert.equal(rows[2]?.endsWeekHigh, 8);
});
