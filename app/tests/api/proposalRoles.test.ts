import assert from "node:assert/strict";
import test from "node:test";
import { parseHeaviest, roleView } from "../../server/proposalRoles.js";

const phase = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("parseHeaviest accepts all, gates, and known phase ids", () => {
  const parsed = parseHeaviest(["all", "gates", phase], new Set([phase]));
  assert.ok(!("error" in parsed));
  assert.equal(parsed.heaviestAll, true);
  assert.equal(parsed.heaviestGates, true);
  assert.deepEqual(parsed.phaseIds, [phase]);
});

test("parseHeaviest rejects unknown tokens and foreign phase ids", () => {
  assert.equal((parseHeaviest(["later"], new Set()) as { error: string }).error.includes("Unknown"), true);
  assert.equal((parseHeaviest([phase], new Set()) as { error: string }).error.includes("belong"), true);
});

test("roleView lists sentinels then phase ids", () => {
  const view = roleView({
    id: phase,
    name: "Engagement lead",
    side: "unwhelm",
    responsibility: "Owns gates",
    heaviestAll: true,
    heaviestGates: true,
    phases: [{ milestoneId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }],
  });
  assert.deepEqual(view.heaviestIn, ["all", "gates", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
});
