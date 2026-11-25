import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { formatLogLine } from "../../shared/log.js";

test("log lines are one JSON object with ts, level, msg, and fields", () => {
  const line = formatLogLine("info", "listening", { service: "unwh-mcp", url: "http://127.0.0.1:3202/mcp" }, new Date("2026-10-29T08:00:00.000Z"));
  assert.ok(!line.includes("\n"));
  assert.deepEqual(JSON.parse(line), { ts: "2026-10-29T08:00:00.000Z", level: "info", msg: "listening", service: "unwh-mcp", url: "http://127.0.0.1:3202/mcp" });
});

test("unwh-mcp server code logs through the structured logger, not plain console text", () => {
  const dir = new URL("../../unwh-mcp/src/", import.meta.url);
  // smoke.ts is a CLI check whose output is read by a person, so it may print plain text.
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && name !== "smoke.ts")) {
    const source = readFileSync(new URL(file, dir), "utf8");
    assert.doesNotMatch(source, /console\.(log|info|warn|error)\(/, `${file} should use logEvent`);
  }
});
