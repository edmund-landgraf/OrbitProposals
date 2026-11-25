import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hourTermsFromCatalog, seedCatalogFixture } from "../../server/catalog.js";
import { completionPercent, previewImpact, type CompletionPolicy, type TreeEdge, type TreeNode } from "../../server/completionTree.js";
import { applyChange, lockNode, parkChange, type CompletionStore } from "../../server/proposalCompletion.js";

const migration = readFileSync(new URL("../../prisma/migrations/0020_completion_tree/migration.sql", import.meta.url), "utf8");

test("migration keeps states, weights, labels, and dependency edges in rows", () => {
  assert.match(migration, /'needs_review', 30, 'Needs another look', 0, false, true, false/);
  assert.match(migration, /'locked', 50, 'Locked', 1, true, false, true/);
  assert.match(migration, /'agreed', 40, 'Agreed', 1, true, false, false/);
  assert.match(migration, /'scope', 'hours'/);
  assert.match(migration, /'hours', 'price'/);
  assert.match(migration, /'scope', 'milestones'/);
  assert.doesNotMatch(migration, /'schedule', 'hours'/);
});

const policy: CompletionPolicy = {
  states: [
    { code: "open", sortOrder: 10, clientLabel: "Not started", completionWeight: 0, reopensDownstream: false, isReopenTarget: false, isLock: false },
    { code: "drafted", sortOrder: 20, clientLabel: "Drafted", completionWeight: 0, reopensDownstream: false, isReopenTarget: false, isLock: false },
    { code: "needs_review", sortOrder: 30, clientLabel: "Needs another look", completionWeight: 0, reopensDownstream: false, isReopenTarget: true, isLock: false },
    { code: "agreed", sortOrder: 40, clientLabel: "Agreed", completionWeight: 1, reopensDownstream: true, isReopenTarget: false, isLock: false },
    { code: "locked", sortOrder: 50, clientLabel: "Locked", completionWeight: 1, reopensDownstream: true, isReopenTarget: false, isLock: true },
  ],
  copy: {
    impact_reopen: "Adding {change} reopens {reopened}: {before}% to {after}%; {held} stay locked.",
    impact_clear: "Adding {change} reopens nothing else: {before}% to {after}%; {held} stay locked.",
  },
};

const keys = ["scope", "hours", "price", "milestones", "schedule", "terms"] as const;
const edges: TreeEdge[] = [
  { id: "e1", fromKey: "scope", toKey: "hours" },
  { id: "e2", fromKey: "hours", toKey: "price" },
  { id: "e3", fromKey: "scope", toKey: "milestones" },
];

function nodes(state = "locked"): TreeNode[] {
  return keys.map((key, index) => ({
    id: key,
    key,
    kind: key,
    title: key,
    clientLabel: key === "schedule" ? "dates" : key,
    stateCode: state,
    lockedVersionId: state === "locked" ? "ver-1" : null,
    sortOrder: index,
    parentKey: null,
  }));
}

test("the workflow check catalog tier caps the engagement at 3 hours", () => {
  const cap = readFileSync(new URL("../../prisma/migrations/0021_workflow_check_cap/migration.sql", import.meta.url), "utf8");
  assert.match(cap, /SET "hours" = 3/);
  assert.match(cap, /'workflow_check'/);
  const terms = hourTermsFromCatalog(seedCatalogFixture(), { model: "workflow_check", amountMinor: 25000, currency: "USD" });
  assert.equal(terms.capHours, 3);
});

test("completion is the weighted share of locked and agreed nodes", () => {
  const mixed = nodes("open").map((node) => ["scope", "hours", "price"].includes(node.key) ? { ...node, stateCode: node.key === "price" ? "agreed" : "locked" } : node);
  assert.equal(completionPercent(mixed, policy), 50);
  assert.equal(completionPercent(nodes("locked"), policy), 100);
});

test("scope reopens hours, price, and milestones while dates and terms stay locked", () => {
  const impact = previewImpact(nodes(), edges, policy, "scope", "a weekly report");
  assert.deepEqual(impact.reopened.map((item) => item.key), ["scope", "hours", "price", "milestones"]);
  assert.deepEqual(impact.held.map((item) => item.key), ["schedule", "terms"]);
  assert.equal(impact.percentBefore, 100);
  assert.equal(impact.percentAfter, 33);
  assert.match(impact.sentence, /Adding a weekly report reopens scope, hours, price and milestones: 100% to 33%; dates and terms stay locked\./);
  const dates = previewImpact(nodes(), edges, policy, "schedule", "move the kickoff");
  assert.deepEqual(dates.reopened.map((item) => item.key), ["schedule"]);
  assert.ok(dates.held.every((item) => item.key !== "schedule"));
  assert.equal(dates.held.length, 5);
});

test("a drafted change does not reopen a locked downstream node", () => {
  const drafted = nodes("locked").map((node) => node.key === "scope" ? { ...node, stateCode: "drafted", lockedVersionId: null } : node);
  const impact = previewImpact(drafted, edges, policy, "scope", "wording");
  assert.equal(impact.reopened.length, 0);
  assert.equal(impact.percentBefore, impact.percentAfter);
});

function memory(initial = nodes()): CompletionStore & { rows: TreeNode[]; events: Array<{ reason: string; percentBefore: number; percentAfter: number }>; parked: Array<{ mode: string }> } {
  const bag = { rows: initial.map((node) => ({ ...node })), events: [] as Array<{ reason: string; percentBefore: number; percentAfter: number }>, parked: [] as Array<{ mode: string }>, versions: new Set(["ver-1"]) };
  const store: CompletionStore = {
    policy: async () => ({ ...policy, parkModes: [{ code: "phase_2", clientLabel: "Park as a later phase", reopens: false }, { code: "swap", clientLabel: "Swap for a similar item", reopens: false }] }),
    ensure: async () => undefined,
    nodes: async () => bag.rows,
    edges: async () => edges,
    setNode: async (id, data) => {
      const node = bag.rows.find((item) => item.id === id);
      if (!node) throw new Error("missing");
      if (data.stateCode) node.stateCode = data.stateCode;
      if ("lockedVersionId" in data) node.lockedVersionId = data.lockedVersionId ?? null;
    },
    record: async (row) => { bag.events.push(row); },
    history: async () => [],
    park: async (row) => { bag.parked.push({ mode: row.mode }); return { id: "park-1" }; },
    parked: async () => [],
    addEdge: async () => edges[0]!,
    removeEdge: async () => undefined,
    versionExists: async (id) => bag.versions.has(id),
    parkItem: async (_proposalId, summary) => ({ id: "item-1", summary }),
    listParkedItems: async () => [],
  };
  return Object.assign(store, bag);
}

test("apply reopens only downstream nodes and records the percentage", async () => {
  const store = memory();
  const result = await applyChange(store, "p", "scope", "a weekly report", "user");
  assert.equal(result.applied, true);
  assert.equal(store.rows.find((node) => node.key === "hours")?.stateCode, "needs_review");
  assert.equal(store.rows.find((node) => node.key === "terms")?.stateCode, "locked");
  assert.equal(store.rows.find((node) => node.key === "schedule")?.lockedVersionId, "ver-1");
  assert.equal(store.rows.find((node) => node.key === "scope")?.lockedVersionId, null);
  assert.equal(store.events[0]?.percentBefore, 100);
  assert.equal(store.events[0]?.percentAfter, 33);
  assert.match(store.events[0]?.reason ?? "", /reopens/);
});

test("parked intake items stay out of the check and can be listed", async () => {
  const items: Array<{ id: string; summary: string; createdAt: string }> = [];
  const store = memory();
  store.parkItem = async (_proposalId, summary) => {
    const row = { id: `item-${items.length + 1}`, summary, createdAt: "2026-10-23T00:00:00.000Z" };
    items.push(row);
    return { id: row.id, summary };
  };
  store.listParkedItems = async () => items;
  const parked = await store.parkItem("p", "Inventory sync", "user");
  assert.equal(parked.summary, "Inventory sync");
  assert.deepEqual((await store.listParkedItems("p")).map((item) => item.summary), ["Inventory sync"]);
  assert.equal(store.rows.every((node) => node.stateCode === "locked"), true);
});

test("parking and swapping do not reopen, and a lock cites a version", async () => {
  const store = memory();
  const parked = await parkChange(store, "p", { nodeKey: "scope", change: "a weekly report", mode: "phase_2", actorId: "user" });
  assert.equal(parked.percent, 100);
  assert.equal(store.rows.every((node) => node.stateCode === "locked"), true);
  await parkChange(store, "p", { nodeKey: "scope", change: "a weekly report", mode: "swap", swapSummary: "a monthly report of the same length", actorId: "user" });
  assert.deepEqual(store.parked.map((item) => item.mode), ["phase_2", "swap"]);
  await assert.rejects(() => parkChange(store, "p", { nodeKey: "scope", change: "x", mode: "swap", actorId: "user" }), /similar size/);
  await assert.rejects(() => lockNode(store, "p", "terms", "missing", "user"), /version snapshot/);
  const locked = await lockNode(store, "p", "terms", "ver-1", "user");
  assert.equal(locked.lockedVersionId, "ver-1");
  assert.equal(locked.state, "locked");
});
