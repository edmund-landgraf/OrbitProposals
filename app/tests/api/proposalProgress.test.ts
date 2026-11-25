import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CompletionPolicy, TreeEdge } from "../../server/completionTree.js";
import { buildProgress, clientStatuses, type ProgressNode, type ProgressPolicy } from "../../server/proposalProgress.js";

const migration = readFileSync(new URL("../../prisma/migrations/0032_proposal_progress/migration.sql", import.meta.url), "utf8");

test("progress groups, phrases, and copy are rows in the migration", () => {
  assert.match(migration, /\('almost', 75, 'Almost there'\)/);
  assert.match(migration, /\('shaping', 25, 'Taking shape'\)/);
  assert.match(migration, /'headline', '\{settled\} of \{total\} parts settled'/);
  assert.match(migration, /\('needs_review', 'reopened'\)/);
  assert.match(migration, /'parked_heading', 'Saved for later'/);
  assert.match(migration, /CREATE UNIQUE INDEX "proposal_progress_view_proposal_id_viewer_id_key"/);
});

const completion: CompletionPolicy = {
  states: [
    { code: "open", sortOrder: 10, clientLabel: "Not started", completionWeight: 0, reopensDownstream: false, isReopenTarget: false, isLock: false },
    { code: "drafted", sortOrder: 20, clientLabel: "Drafted", completionWeight: 0, reopensDownstream: false, isReopenTarget: false, isLock: false },
    { code: "needs_review", sortOrder: 30, clientLabel: "Needs another look", completionWeight: 0, reopensDownstream: false, isReopenTarget: true, isLock: false },
    { code: "agreed", sortOrder: 40, clientLabel: "Agreed", completionWeight: 1, reopensDownstream: true, isReopenTarget: false, isLock: false },
    { code: "locked", sortOrder: 50, clientLabel: "Locked", completionWeight: 1, reopensDownstream: true, isReopenTarget: false, isLock: true },
  ],
  copy: {},
};

const policy: ProgressPolicy = {
  groups: [
    { code: "locked", clientLabel: "Locked", sortOrder: 10, settled: true, nextStepPriority: null, whatsLeft: "Settled and locked to a version.", nextStep: "" },
    { code: "ready", clientLabel: "Done", sortOrder: 20, settled: true, nextStepPriority: null, whatsLeft: "Agreed.", nextStep: "" },
    { code: "reopened", clientLabel: "Reopened by a change", sortOrder: 30, settled: false, nextStepPriority: 1, whatsLeft: "Needs another look because {reason}.", nextStep: "Take another look at {part}, since {reason}." },
    { code: "needs_input", clientLabel: "Needs your input", sortOrder: 40, settled: false, nextStepPriority: 2, whatsLeft: "We need your input on {part}.", nextStep: "Tell us what you have in mind for {part}." },
    { code: "in_progress", clientLabel: "In progress", sortOrder: 50, settled: false, nextStepPriority: 3, whatsLeft: "Drafted.", nextStep: "Review the draft of {part}." },
  ],
  stateGroups: { locked: "locked", agreed: "ready", needs_review: "reopened", open: "needs_input", drafted: "in_progress" },
  phrases: [
    { code: "starting", minPercent: 0, phrase: "Just getting started" },
    { code: "shaping", minPercent: 25, phrase: "Taking shape" },
    { code: "most", minPercent: 50, phrase: "More than halfway" },
    { code: "almost", minPercent: 75, phrase: "Almost there" },
    { code: "settled", minPercent: 100, phrase: "Everything is settled" },
  ],
  copy: {
    headline: "{settled} of {total} parts settled",
    reopened_by: "{source} changed: {change}",
    reopened_by_unknown: "something it depends on changed",
    delta_down: "Since your last visit this went from {before}% to {after}%. {reasons}",
    delta_reason: "A change to {source} ({change}) reopened {parts}.",
    delta_up: "Since your last visit this went from {before}% to {after}%. Nice progress.",
    next_done: "Everything is settled.",
    parked_heading: "Saved for later",
    parked_note: "Not counted.",
    headline_discuss: "{settled} of {total} parts settled, {discuss} to discuss with us",
    handoff_heading: "Ready for a call with Unwhelm",
    handoff_body: "Send it as it is.",
    handoff_submit: "Send as it is",
    open_for_review: "Still open: {parts}.",
    drafted_for_review: "Drafted, awaiting agreement: {parts}.",
    reopened_for_review: "Needs another look: {parts}.",
  },
};

const edges: TreeEdge[] = [
  { id: "e1", fromKey: "scope", toKey: "hours" },
  { id: "e2", fromKey: "hours", toKey: "price" },
  { id: "e3", fromKey: "scope", toKey: "milestones" },
];

function node(key: string, label: string, stateCode: string, sortOrder: number, body: unknown = {}): ProgressNode {
  return { id: key, key, kind: key, title: key, clientLabel: label, stateCode, lockedVersionId: null, sortOrder, parentKey: null, body };
}

test("a mostly settled proposal reads as N of M with a phrase and groups", () => {
  const nodes = [node("scope", "scope", "locked", 1), node("hours", "hours", "locked", 2), node("price", "price", "agreed", 3), node("milestones", "milestones", "agreed", 4), node("schedule", "dates", "drafted", 5), node("terms", "terms", "open", 6)];
  const view = buildProgress({ nodes, edges, completion, policy, parked: [{ id: "p1", summary: "Mobile app" }], snapshot: null });
  assert.equal(view.headline, "4 of 6 parts settled");
  assert.equal(view.percent, 67);
  assert.equal(view.phrase, "More than halfway");
  assert.deepEqual(view.groups.map((group) => group.code), ["locked", "ready", "needs_input", "in_progress"]);
  assert.equal(view.nextStep.key, "terms");
  assert.equal(view.nextStep.text, "Tell us what you have in mind for terms.");
  assert.equal(view.savedForLater.items.length, 1);
  assert.equal(view.total, 6, "parked items are not counted as parts");
  assert.equal(view.sinceLastVisit, null);
});

test("a drop since the last visit names the change and the parts it reopened", () => {
  const change = { change: "adding a mobile app", sourceKey: "scope" };
  const nodes = [node("scope", "scope", "needs_review", 1, change), node("hours", "hours", "needs_review", 2, change), node("price", "price", "needs_review", 3, change), node("milestones", "milestones", "needs_review", 4, change), node("schedule", "dates", "agreed", 5), node("terms", "terms", "agreed", 6)];
  const snapshot = { percent: 100, states: Object.fromEntries(nodes.map((item) => [item.key, "locked"])), seenAt: "2026-10-20T00:00:00.000Z" };
  const view = buildProgress({ nodes, edges, completion, policy, parked: [], snapshot });
  assert.equal(view.percent, 33);
  assert.equal(view.phrase, "Taking shape");
  assert.equal(view.sinceLastVisit?.direction, "down");
  assert.equal(view.sinceLastVisit?.text, "Since your last visit this went from 100% to 33%. A change to scope (adding a mobile app) reopened Scope, Hours, Price and Milestones.");
  const reopened = view.groups.find((group) => group.code === "reopened");
  assert.equal(reopened?.parts.length, 4);
  assert.deepEqual(reopened?.parts.find((part) => part.key === "price")?.reopenedBy, { source: "scope", change: "adding a mobile app" });
  assert.equal(view.nextStep.key, "scope", "the upstream part comes first because its dependencies are settled");
  assert.equal(view.nextStep.text, "Take another look at scope, since scope changed: adding a mobile app.");
});

test("everything settled gives the done step and the top phrase", () => {
  const nodes = [node("scope", "scope", "locked", 1), node("terms", "terms", "locked", 2)];
  const view = buildProgress({ nodes, edges: [], completion, policy, parked: [], snapshot: { percent: 50, states: {}, seenAt: "2026-10-20T00:00:00.000Z" } });
  assert.equal(view.phrase, "Everything is settled");
  assert.equal(view.nextStep.key, null);
  assert.equal(view.sinceLastVisit?.direction, "up");
});

test("a reopened part says which change reopened it", () => {
  const nodes = [node("scope", "scope", "agreed", 1), node("hours", "hours", "needs_review", 2, { change: "adding a mobile app", sourceKey: "scope" })];
  const view = buildProgress({ nodes, edges, completion, policy, parked: [], snapshot: null });
  assert.equal(view.groups.find((group) => group.code === "reopened")?.parts[0]?.whatsLeft, "Needs another look because scope changed: adding a mobile app.");
});

test("resolutions, handoff reasons, and the discuss headline are rows", () => {
  assert.match(migration, /\('unsure', 'Not sure, talk to a human', 10, true, true, true\)/);
  assert.match(migration, /\('staff_decides', 'staff_decides'\)/);
  assert.match(migration, /\('out_of_scope', 'out_of_scope'\)/);
  assert.match(migration, /\('stuck', 'We have gone back and forth a few times', 30, 6, false\)/);
  assert.match(migration, /'headline_discuss', '\{settled\} of \{total\} parts settled, \{discuss\} to discuss with us'/);
  assert.match(migration, /'handoff_heading', 'Ready for a call with Unwhelm'/);
});

test("unsure parts count as settled, are flagged to discuss, and make the proposal ready for a call while incomplete", () => {
  const extended: CompletionPolicy = { ...completion, states: [...completion.states,
    { code: "unsure", sortOrder: 42, clientLabel: "To talk through with us", completionWeight: 1, reopensDownstream: false, isReopenTarget: false, isLock: false },
    { code: "staff_decides", sortOrder: 44, clientLabel: "Unwhelm will decide", completionWeight: 1, reopensDownstream: false, isReopenTarget: false, isLock: false }] };
  const extendedPolicy: ProgressPolicy = { ...policy,
    groups: [...policy.groups,
      { code: "to_discuss", clientLabel: "To discuss with us", sortOrder: 22, settled: true, toDiscuss: true, nextStepPriority: null, whatsLeft: "Marked unsure.", nextStep: "" },
      { code: "staff_decides", clientLabel: "Unwhelm will decide", sortOrder: 24, settled: true, nextStepPriority: null, whatsLeft: "Left for Unwhelm.", nextStep: "" }],
    stateGroups: { ...policy.stateGroups, unsure: "to_discuss", staff_decides: "staff_decides" } };
  const nodes = [node("scope", "scope", "agreed", 1), node("hours", "hours", "unsure", 2, { resolution: "unsure", note: "No idea how long this takes" }), node("price", "price", "staff_decides", 3), node("milestones", "milestones", "unsure", 4), node("schedule", "dates", "open", 5), node("terms", "terms", "open", 6)];
  const reasons = [{ code: "client_unsure", clientLabel: "Some parts are easier to settle on a call", sortOrder: 10, turnThreshold: null, automatic: true }, { code: "scope_unbounded", clientLabel: "The scope is open-ended", sortOrder: 20, turnThreshold: null, automatic: false }];
  const view = buildProgress({ nodes, edges, completion: extended, policy: extendedPolicy, parked: [], snapshot: null, handoffReasons: reasons,
    handoffs: [{ id: "h1", reasonCode: "scope_unbounded", note: "Integrations list keeps growing", createdAt: "2026-10-23T00:00:00.000Z" }] });
  assert.equal(view.headline, "4 of 6 parts settled, 2 to discuss with us");
  assert.equal(view.toDiscuss, 2);
  assert.equal(view.handoff.ready, true);
  assert.deepEqual(view.handoff.reasons.map((reason) => reason.code), ["client_unsure", "scope_unbounded"]);
  assert.deepEqual(view.handoff.discussParts, ["Hours", "Milestones"]);
  assert.equal(view.handoff.openSummary, "Still open: Dates and Terms.");
  assert.equal(view.groups.find((group) => group.code === "to_discuss")?.parts[0]?.note, "No idea how long this takes");
});

test("no handoff is recommended without a reason or unsure parts", () => {
  const nodes = [node("scope", "scope", "agreed", 1), node("terms", "terms", "open", 2)];
  const view = buildProgress({ nodes, edges: [], completion, policy, parked: [], snapshot: null, handoffReasons: [{ code: "client_unsure", clientLabel: "x", sortOrder: 10, turnThreshold: null, automatic: true }] });
  assert.equal(view.handoff.ready, false);
  assert.equal(view.headline, "1 of 2 parts settled");
});

test("handoff summary separates not-started, drafted, and reopened parts", () => {
  const nodes = [
    node("scope", "scope", "drafted", 1),
    node("hours", "hours", "needs_review", 2, { change: "adding a mobile app", sourceKey: "scope" }),
    node("price", "price", "open", 3),
    node("terms", "terms", "agreed", 4),
  ];
  const view = buildProgress({ nodes, edges, completion, policy, parked: [], snapshot: null });
  assert.deepEqual(view.handoff.openParts, ["Price"]);
  assert.deepEqual(view.handoff.draftedParts, ["Scope"]);
  assert.deepEqual(view.handoff.reopenedParts, ["Hours"]);
  assert.equal(view.handoff.openSummary, "Still open: Price. Drafted, awaiting agreement: Scope. Needs another look: Hours.");
  assert.equal(view.settled, 1);
});

test("client statuses include agreed and omit locked, reopen-target, and resolution states", () => {
  const statuses = clientStatuses([
    ...completion.states,
    { code: "unsure", sortOrder: 42, clientLabel: "To talk through with us", completionWeight: 1, reopensDownstream: false, isReopenTarget: false, isLock: false },
  ], new Set(["unsure"]));
  assert.deepEqual(statuses, [
    { code: "open", label: "Not started" },
    { code: "drafted", label: "Drafted" },
    { code: "agreed", label: "Agreed" },
  ]);
});

test("the terms section spec and drafted handoff copy are rows in migration 0061", () => {
  const later = readFileSync(new URL("../../prisma/migrations/0061_agreed_state_and_terms_section/migration.sql", import.meta.url), "utf8");
  assert.match(later, /'terms', 'Payment, legal, and working terms/);
  assert.match(later, /'drafted_for_review', 'Drafted, awaiting agreement: \{parts\}\.'/);
  assert.match(later, /'reopened_for_review', 'Needs another look: \{parts\}\.'/);
});
