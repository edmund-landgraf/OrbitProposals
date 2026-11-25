import assert from "node:assert/strict";
import test from "node:test";
import { reviewProposal, type ReviewRule } from "../../server/proposalReviewAgent.js";

const rule = (r: Partial<ReviewRule> & Pick<ReviewRule, "code" | "check">): ReviewRule => ({ nodeKey: "executive_summary", fieldPath: null, minChars: null, minItems: null, pattern: null, severity: "issue", weight: 10, message: r.code, suggestion: `fix ${r.code}`, ...r });
const rules = [
  rule({ code: "missing", check: "missing", weight: 60 }),
  rule({ code: "short", check: "min_chars", minChars: 50, severity: "suggestion", weight: 25 }),
  rule({ code: "price", check: "pattern", pattern: "\\$\\s?\\d", weight: 30 }),
];
const node = (text?: string) => [{ key: "executive_summary", title: "Executive summary", stateCode: text ? "drafted" : "open", body: text === undefined ? {} : { text } }];

test("an empty section fails only the missing rule", () => {
  const review = reviewProposal(node(), rules);
  assert.equal(review.sections[0].score, 40);
  assert.deepEqual(review.sections[0].issues.map((i) => i.code), ["missing"]);
  assert.equal(review.sections[0].suggestions.length, 0);
});

test("short text with a price gets an issue and a suggestion", () => {
  const review = reviewProposal(node("It costs $3000."), rules);
  assert.equal(review.sections[0].score, 45);
  assert.deepEqual(review.sections[0].issues.map((i) => i.code), ["price"]);
  assert.deepEqual(review.sections[0].suggestions.map((i) => i.code), ["short"]);
  assert.equal(review.readySections, 0);
});

test("a clean section scores 100 and parts without rules are skipped", () => {
  const review = reviewProposal([...node("We will map the intake workflow and deliver a sync job with clear error reports."), { key: "scope", title: "Scope", stateCode: "agreed", body: {} }], rules);
  assert.equal(review.totalSections, 1);
  assert.equal(review.score, 100);
  assert.equal(review.readySections, 1);
});

test("structured parts read the proposal's scope, timeline, and pricing json", () => {
  const structured = [
    rule({ code: "deliverables", nodeKey: "scope", check: "missing", fieldPath: "scope.deliverables", weight: 40 }),
    rule({ code: "two_items", nodeKey: "scope", check: "min_items", fieldPath: "scope.deliverables", minItems: 2, severity: "suggestion", weight: 10 }),
    rule({ code: "target", nodeKey: "schedule", check: "missing", fieldPath: "timeline.targetDate", weight: 40 }),
    rule({ code: "staff_price", nodeKey: "price", check: "state_open", severity: "suggestion", weight: 20 }),
  ];
  const nodes = [
    { key: "scope", title: "Scope", stateCode: "drafted", body: {} },
    { key: "schedule", title: "Schedule", stateCode: "open", body: {} },
    { key: "price", title: "Price", stateCode: "open", body: {} },
  ];
  const review = reviewProposal(nodes, structured, { scope: { deliverables: ["Map"] }, timeline: {}, pricing: { model: "fixed_price" } });
  const by = Object.fromEntries(review.sections.map((s) => [s.key, s]));
  assert.equal(by.scope.score, 90);
  assert.deepEqual(by.scope.suggestions.map((s) => s.code), ["two_items"]);
  assert.deepEqual(by.schedule.issues.map((s) => s.code), ["target"]);
  assert.deepEqual(by.price.suggestions.map((s) => s.code), ["staff_price"]);
  assert.equal(review.readySections, 2);
});
