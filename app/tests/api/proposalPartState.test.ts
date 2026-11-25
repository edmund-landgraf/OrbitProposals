import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionPolicy, TreeEdge, TreeNode } from "../../server/completionTree.js";
import type { CompletionStore } from "../../server/proposalCompletion.js";
import { setPartState, type ProgressStore } from "../../server/proposalProgress.js";

const policy: CompletionPolicy & { parkModes: [] } = {
  states: [
    { code: "open", sortOrder: 10, clientLabel: "Not started", completionWeight: 0, reopensDownstream: false, isReopenTarget: false, isLock: false },
    { code: "drafted", sortOrder: 20, clientLabel: "Drafted", completionWeight: 0, reopensDownstream: false, isReopenTarget: false, isLock: false },
    { code: "needs_review", sortOrder: 30, clientLabel: "Needs another look", completionWeight: 0, reopensDownstream: false, isReopenTarget: true, isLock: false },
    { code: "agreed", sortOrder: 40, clientLabel: "Agreed", completionWeight: 1, reopensDownstream: true, isReopenTarget: false, isLock: false },
    { code: "locked", sortOrder: 50, clientLabel: "Locked", completionWeight: 1, reopensDownstream: true, isReopenTarget: false, isLock: true },
  ],
  copy: { impact_reopen: "Adding {change} reopens {reopened}: {before}% to {after}%; {held} stay locked.", impact_clear: "Adding {change} reopens nothing else: {before}% to {after}%; {held} stay locked." },
  parkModes: [],
};

const edges: TreeEdge[] = [
  { id: "e1", fromKey: "scope", toKey: "hours" },
  { id: "e2", fromKey: "hours", toKey: "price" },
];

function node(key: string, stateCode: string, sortOrder: number, lockedVersionId: string | null = null): TreeNode {
  return { id: key, key, kind: key, title: key, clientLabel: key, stateCode, lockedVersionId, sortOrder, parentKey: null };
}

function memoryStore(nodes: TreeNode[]): CompletionStore & { historyRows: Array<{ percentBefore: number; percentAfter: number; reason: string }> } {
  const historyRows: Array<{ percentBefore: number; percentAfter: number; reason: string }> = [];
  const store: CompletionStore & { historyRows: typeof historyRows } = {
    historyRows,
    policy: async () => policy,
    ensure: async () => undefined,
    nodes: async () => nodes,
    edges: async () => edges,
    setNode: async (id, data) => {
      const item = nodes.find((node) => node.id === id);
      if (!item) return;
      if (data.stateCode !== undefined) item.stateCode = data.stateCode;
      if (data.lockedVersionId !== undefined) item.lockedVersionId = data.lockedVersionId;
    },
    record: async (row) => { historyRows.push({ percentBefore: row.percentBefore, percentAfter: row.percentAfter, reason: row.reason }); },
    history: async () => [],
    park: async () => ({ id: "park" }),
    parked: async () => [],
    addEdge: async () => edges[0]!,
    removeEdge: async () => undefined,
    versionExists: async () => true,
    parkItem: async () => ({ id: "item", summary: "" }),
    listParkedItems: async () => [],
  };
  return store;
}

const progress: ProgressStore = {
  policy: async () => ({ groups: [], stateGroups: {}, phrases: [], copy: {} }),
  nodeBodies: async () => ({}),
  snapshot: async () => null,
  saveSnapshot: async () => undefined,
  resolutions: async () => [],
  handoffReasons: async () => [],
  handoffs: async () => [],
  addHandoff: async (row) => ({ id: "h", reasonCode: row.reasonCode, note: row.note, createdAt: "2026-11-13T00:00:00.000Z" }),
};

test("agreeing a drafted part settles it, records history, and raises the percent", async () => {
  const nodes = [node("scope", "drafted", 1), node("hours", "open", 2), node("price", "open", 3)];
  const completion = memoryStore(nodes);
  const result = await setPartState(completion, progress, "proposal", { nodeKey: "scope", state: "agreed", actorId: "user", actor: "client" });
  assert.equal(result.state, "agreed");
  assert.equal(result.label, "Agreed");
  assert.equal(result.percent, 33);
  assert.equal(nodes[0]?.stateCode, "agreed");
  assert.equal(completion.historyRows.length, 1);
  assert.equal(completion.historyRows[0]?.percentBefore, 0);
  assert.equal(completion.historyRows[0]?.percentAfter, 33);
  assert.match(completion.historyRows[0]?.reason ?? "", /Agreed/);
});

test("a locked part cannot be agreed without unlocking first", async () => {
  const completion = memoryStore([node("scope", "locked", 1, "version")]);
  await assert.rejects(
    () => setPartState(completion, progress, "proposal", { nodeKey: "scope", state: "agreed", actorId: "user", actor: "client" }),
    /locked/i,
  );
});

test("leaving agreed reopens downstream agreed and locked parts to needs review", async () => {
  const nodes = [node("scope", "agreed", 1), node("hours", "agreed", 2), node("price", "locked", 3, "version")];
  const completion = memoryStore(nodes);
  const result = await setPartState(completion, progress, "proposal", { nodeKey: "scope", state: "drafted", actorId: "user", actor: "client" });
  assert.equal(result.state, "drafted");
  assert.equal(nodes[0]?.stateCode, "drafted");
  assert.equal(nodes[1]?.stateCode, "needs_review");
  assert.equal(nodes[2]?.stateCode, "needs_review");
  assert.equal(nodes[2]?.lockedVersionId, null);
  assert.equal(result.percent, 0);
});

test("agreeing a part does not reopen downstream parts", async () => {
  const nodes = [node("scope", "drafted", 1), node("hours", "agreed", 2), node("price", "open", 3)];
  const completion = memoryStore(nodes);
  await setPartState(completion, progress, "proposal", { nodeKey: "scope", state: "agreed", actorId: "user", actor: "client" });
  assert.equal(nodes[0]?.stateCode, "agreed");
  assert.equal(nodes[1]?.stateCode, "agreed");
  assert.equal(nodes[2]?.stateCode, "open");
});
