import assert from "node:assert/strict";
import test from "node:test";
import { versionStampText } from "../../src/versionStamp.tsx";

test("the version stamp names the revision, the update time, and the build", () => {
  const text = versionStampText(3, "2026-10-02T17:30:00.000Z", "15be847");
  assert.match(text, /^Version 3 \u00b7 Updated .+ \u00b7 Build 15be847$/);
});

test("the version stamp leaves the build out when the server does not know it", () => {
  assert.doesNotMatch(versionStampText(1, "2026-10-02T17:30:00.000Z", null), /Build/);
  assert.doesNotMatch(versionStampText(1, "2026-10-02T17:30:00.000Z", "unknown"), /Build/);
});
