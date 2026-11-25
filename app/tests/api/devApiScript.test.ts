import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("dev:api loads .env and the production start script does not", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["dev:api"], /tsx\s+--env-file=\.env\s+server\/index\.ts/);
  assert.equal(pkg.scripts["start:api"], "node dist-api/server/index.js");
});
