import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyOptionSelection, totalWithOptions } from "../../server/optionPackages.js";

const migration = readFileSync(new URL("../../prisma/migrations/0024_option_packages/migration.sql", import.meta.url), "utf8");

test("packages and the options completion edge are database rows", () => {
  assert.match(migration, /'required', 'optional', 'preselected'/);
  assert.match(migration, /'single', 'multi'/);
  assert.match(migration, /'options', 'price'/);
});

test("a single-select package keeps one line, required lines stay on, and the total follows the selection", () => {
  const options = [
    { id: "good", selection: "optional", groupId: "pkg", priceDeltaMinor: 0, selected: true },
    { id: "better", selection: "preselected", groupId: "pkg", priceDeltaMinor: 20_000, selected: false },
    { id: "best", selection: "optional", groupId: "pkg", priceDeltaMinor: 50_000, selected: false },
    { id: "support", selection: "required", groupId: "adds", priceDeltaMinor: 5_000, selected: true },
    { id: "training", selection: "optional", groupId: "adds", priceDeltaMinor: 8_000, selected: false },
  ];
  const groups = [{ id: "pkg", mode: "single" }, { id: "adds", mode: "multi" }];
  const next = applyOptionSelection(options, groups, ["best", "training"]);
  assert.deepEqual(next.filter((option) => option.selected).map((option) => option.id).sort(), ["best", "support", "training"]);
  assert.equal(totalWithOptions(300_000, next), 363_000);
  const cleared = applyOptionSelection(options, groups, []);
  assert.equal(cleared.find((option) => option.id === "better")?.selected, true);
  assert.equal(cleared.find((option) => option.id === "support")?.selected, true);
});

test("the selection tool description does not let the agent set a price", () => {
  const source = readFileSync(new URL("../../unwh-mcp/src/createServer.ts", import.meta.url), "utf8");
  assert.match(source, /unw_select_proposal_options/);
  assert.match(source, /cannot set or change prices/);
  assert.doesNotMatch(source.slice(source.indexOf("unw_select_proposal_options"), source.indexOf("unw_accept_proposal")), /amountMinor/);
});
