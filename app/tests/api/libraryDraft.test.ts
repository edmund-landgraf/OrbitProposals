import assert from "node:assert/strict";
import test from "node:test";
import { draftSection } from "../../server/libraryDraft.js";

test("a section draft cites an approved answer and names the gap it cannot fill", () => {
  const draft = draftSection("approach", [
    { id: "r1", text: "The vendor shall migrate the checkout service.", mappedNodeKeys: [], suggestedNodeKeys: ["approach"] },
    { id: "r2", text: "The vendor shall provide a disaster recovery drill.", mappedNodeKeys: ["approach"], suggestedNodeKeys: [] },
    { id: "r3", text: "Unrelated billing question.", mappedNodeKeys: ["price"], suggestedNodeKeys: [] },
  ], [
    { id: "lib", title: "Checkout migration", version: 2, bodyText: "We migrate the checkout service in phases with a tested rollback." },
  ]);
  assert.equal(draft.citations.length, 1);
  assert.equal(draft.citations[0].title, "Checkout migration");
  assert.match(draft.text, /version 2/);
  assert.deepEqual(draft.gaps.map((gap) => gap.requirementId), ["r2"]);
  assert.match(draft.text, /Gap: The vendor shall provide a disaster recovery drill/);
  assert.equal(draft.text.includes("billing"), false);
});
