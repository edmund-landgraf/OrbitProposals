import assert from "node:assert/strict";
import test from "node:test";
import { backoffMs, shouldRetryDbOperation, transientDbError, waitUntilReady, withRetry } from "../../shared/retry.js";
import { fetchWithRetry } from "../../unwh-mcp/src/apiClient.js";

const noSleep = async () => {};
const coded = (code: string) => Object.assign(new Error(code), { code });

test("backoff doubles and is capped", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => backoffMs(n, 250, 4000)), [250, 500, 1000, 2000, 4000, 4000]);
});

test("withRetry retries transient failures up to the attempt limit", async () => {
  let calls = 0;
  const value = await withRetry(async () => { calls += 1; if (calls < 3) throw coded("P1001"); return "ok"; }, { sleep: noSleep, shouldRetry: () => true });
  assert.equal(value, "ok");
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw coded("P1001"); }, { attempts: 4, sleep: noSleep, shouldRetry: () => true }));
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw new Error("unique constraint"); }, { sleep: noSleep, shouldRetry: (error) => transientDbError(error) !== null }));
  assert.equal(calls, 1, "a non-transient error is not retried");
});

test("database errors are classified so writes never run twice", () => {
  assert.equal(transientDbError(coded("P1001")), "not_connected");
  assert.equal(transientDbError(Object.assign(new Error("wrapped"), { cause: coded("ECONNREFUSED") })), "not_connected");
  assert.equal(transientDbError(coded("P1017")), "dropped");
  assert.equal(transientDbError(new Error("Connection terminated unexpectedly")), "dropped");
  assert.equal(transientDbError(coded("P2002")), null);
  assert.equal(shouldRetryDbOperation("create", coded("ECONNREFUSED")), true);
  assert.equal(shouldRetryDbOperation("findMany", coded("57P01")), true);
  assert.equal(shouldRetryDbOperation("update", coded("57P01")), false);
  assert.equal(shouldRetryDbOperation("findMany", coded("P2025")), false);
});

test("startup waits for a dependency, then gives up without throwing", async () => {
  const lines: string[] = [];
  let calls = 0;
  assert.equal(await waitUntilReady(async () => { calls += 1; if (calls < 2) throw coded("P1001"); }, { label: "database", sleep: noSleep, log: (line) => lines.push(line) }), true);
  assert.equal(JSON.parse(lines[0]!).event, "startup_retry");
  assert.equal(await waitUntilReady(async () => { throw coded("P1001"); }, { label: "database", attempts: 2, sleep: noSleep, log: (line) => lines.push(line) }), false);
  assert.equal(JSON.parse(lines.at(-1)!).event, "startup_unready");
});

test("MCP API calls retry refused connections, and 503s only for GET", async () => {
  let calls = 0;
  const flaky: typeof fetch = async () => { calls += 1; if (calls < 3) throw new TypeError("fetch failed"); return new Response("{}", { status: 200 }); };
  assert.equal((await fetchWithRetry("http://api/x", { method: "POST" }, { fetcher: flaky, sleep: noSleep })).status, 200);
  assert.equal(calls, 3);
  calls = 0;
  const busy: typeof fetch = async () => { calls += 1; return new Response("{}", { status: calls < 2 ? 503 : 200 }); };
  assert.equal((await fetchWithRetry("http://api/x", { method: "GET" }, { fetcher: busy, sleep: noSleep })).status, 200);
  calls = 0;
  assert.equal((await fetchWithRetry("http://api/x", { method: "POST" }, { fetcher: busy, sleep: noSleep })).status, 503, "a write that got 503 is not replayed");
  assert.equal(calls, 1);
  calls = 0;
  const down: typeof fetch = async () => { calls += 1; return new Response("{}", { status: 503 }); };
  assert.equal((await fetchWithRetry("http://api/x", { method: "GET" }, { fetcher: down, sleep: noSleep, attempts: 3 })).status, 503);
  assert.equal(calls, 3);
});