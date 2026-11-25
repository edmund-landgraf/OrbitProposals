import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRfp, complianceMatrix } from "../../server/rfpCompliance.js";

const rfp = [
  "Introduction",
  "1. The vendor shall migrate the checkout service with a tested rollback.",
  "2. Describe your relevant experience with retail platforms.",
  "What is your security certification status?",
  "The vendor shall migrate the checkout service with a tested rollback.",
].join("\n");

test("an RFP becomes proposed requirements with a section hint and a duplicate flag", () => {
  const proposed = analyzeRfp(rfp, [{ key: "scope", title: "Checkout migration", hasContent: true }, { key: "security", title: "Security", hasContent: false }]);
  assert.equal(proposed.length, 4);
  assert.equal(proposed[0].mandatory, true);
  assert.equal(proposed[0].requirementType, "deliverable");
  assert.deepEqual(proposed[0].suggestedNodeKeys, ["scope"]);
  assert.equal(proposed[1].requirementType, "qualification");
  assert.equal(proposed[2].requirementType, "security");
  assert.equal(proposed[3].duplicateOfIndex, 0);
  assert.equal(proposed.every((item) => item.confidence < 1), true);
});

test("mandatory gaps block sign-off until a mapping is accepted", () => {
  const open = complianceMatrix([{ id: "a", text: "Migrate", mandatory: true, confidence: 0.75, status: "unmapped", confirmed: false, mappedNodeKeys: [], suggestedNodeKeys: ["scope"], duplicateOfId: null, evidence: [] }], []);
  assert.equal(open.readyForSignOff, false);
  assert.equal(open.gaps.length, 1);
  assert.deepEqual(open.lowConfidence, ["a"]);
  const closed = complianceMatrix([{ id: "a", text: "Migrate", mandatory: true, confidence: 0.9, status: "addressed", confirmed: true, mappedNodeKeys: ["scope"], suggestedNodeKeys: [], duplicateOfId: null, evidence: [] }], [{ key: "scope", title: "Scope", hasContent: true }]);
  assert.equal(closed.readyForSignOff, true);
});
