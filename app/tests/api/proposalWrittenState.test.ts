import assert from "node:assert/strict";
import test from "node:test";
import { keysToMarkDrafted, writtenKeysForPatch, writtenNodeKeys } from "../../server/proposalWrittenState.js";

test("writtenNodeKeys marks scope, schedule, milestones, and price from saved proposal content", () => {
  const keys = writtenNodeKeys({
    scope: { summary: "A law firm website refresh", deliverables: ["WordPress rebuild"] },
    timeline: { startDate: "2026-11-16", targetDate: "2027-01-25", milestones: [{ title: "Launch" }] },
    tableMilestones: 0,
    pricing: { model: "workflow_check", amountMinor: 25000, currency: "USD" },
    optionsCount: 0,
    narrative: [{ key: "executive_summary", text: "A short summary." }, { key: "background", text: "  " }],
  });
  assert.deepEqual(keys.sort(), ["executive_summary", "milestones", "price", "schedule", "scope"]);
});

test("keysToMarkDrafted upgrades only open or reopened parts, never agreed or locked or unsure", () => {
  const keys = keysToMarkDrafted([
    { key: "scope", stateCode: "open" },
    { key: "schedule", stateCode: "needs_review" },
    { key: "price", stateCode: "agreed" },
    { key: "terms", stateCode: "locked" },
    { key: "hours", stateCode: "unsure" },
  ], ["scope", "schedule", "price", "terms", "hours"]);
  assert.deepEqual(keys.sort(), ["schedule", "scope"]);
});

test("a timeline patch with dates and milestones marks schedule and milestones", () => {
  assert.deepEqual(writtenKeysForPatch({
    timeline: { startDate: "2026-11-16", targetDate: null, milestones: [{ title: "Launch" }] },
  }).sort(), ["milestones", "schedule"]);
});
