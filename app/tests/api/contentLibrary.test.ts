import assert from "node:assert/strict";
import test from "node:test";
import { insertRefusal, matchReason, upsertMode } from "../../server/contentLibrary.js";

const item = { status: "approved", title: "Migration answer", category: "delivery", tags: ["cloud"], clientLabel: "Northwind", industry: "retail", product: "checkout", guidance: "Use for phased cutovers.", expiresAt: null, approvedVersion: 2 };

test("only an approved unexpired item can be inserted", () => {
  assert.equal(insertRefusal(item), null);
  assert.match(insertRefusal({ status: "draft", expiresAt: null }) ?? "", /approved/);
  assert.match(insertRefusal({ status: "archived", expiresAt: null }) ?? "", /Archived/);
  assert.match(insertRefusal({ status: "approved", expiresAt: new Date("2000-01-01") }) ?? "", /expired/);
});

test("a new draft does not replace an approved item, and review blocks another draft", () => {
  assert.equal(upsertMode(null), "create");
  assert.equal(upsertMode({ status: "draft" }), "revise");
  assert.equal(upsertMode({ status: "approved", pending: "draft" }), "revise");
  assert.equal(upsertMode({ status: "approved" }), "next");
  assert.equal(upsertMode({ status: "approved", pending: "in_review" }), "blocked");
  assert.equal(upsertMode({ status: "in_review" }), "blocked");
});

test("search results say why an item matched and whether it is approved", () => {
  const reason = matchReason(item, { query: "migration", industry: "retail", tags: ["cloud"] });
  assert.match(reason, /title/);
  assert.match(reason, /industry/);
  assert.match(reason, /tag cloud/);
  assert.match(reason, /approved version 2/);
});
