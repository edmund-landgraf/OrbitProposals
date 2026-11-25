import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("playwright collects spec files only, not the node:test suite", () => {
  const source = readFileSync(new URL("../../playwright.config.ts", import.meta.url), "utf8");
  assert.match(source, /testMatch:\s*"\*\*\/\*\.spec\.ts"/);
});
