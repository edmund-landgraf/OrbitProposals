// Pure redaction and wrapper checks always run. The database half runs when UNWH_DB_TEST=1 and DATABASE_URL are set.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { bound, FALLBACK_REDACTION_PATTERNS, listTraces, purgeOldTraces, recordTrace, redact, REDACTED } from "../../server/agentTrace.js";
import { traceTools, type TraceSink } from "../../unwh-mcp/src/trace.js";

test("redact replaces secret-looking keys and bearer strings at any depth", () => {
  const out = redact({
    proposalId: "p1",
    accessToken: "abc",
    nested: { clientSecret: "s", list: [{ password: "x", note: "Authorization: Bearer abcdefghijklmnop" }] },
    content: "keep me",
  }, FALLBACK_REDACTION_PATTERNS) as Record<string, any>;
  assert.equal(out.proposalId, "p1");
  assert.equal(out.accessToken, REDACTED);
  assert.equal(out.nested.clientSecret, REDACTED);
  assert.equal(out.nested.list[0].password, REDACTED);
  assert.equal(out.nested.list[0].note, `Authorization: Bearer ${REDACTED}`);
  assert.equal(out.content, "keep me");
});

test("bound keeps small payloads and previews large ones", () => {
  assert.deepEqual(bound({ a: 1 }, 100), { a: 1 });
  const big = bound({ text: "x".repeat(500) }, 50) as { truncated: boolean; chars: number; preview: string };
  assert.equal(big.truncated, true);
  assert.equal(big.preview.length, 50);
  assert.equal(bound(undefined, 10), null);
});

test("traceTools times each handler and passes results and errors through", async () => {
  const traces: Parameters<TraceSink>[0][] = [];
  const registered: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const fake = {
    server: { getClientVersion: () => ({ name: "test-agent", version: "1.0" }) },
    registerTool(name: string, _config: unknown, handler: (...args: unknown[]) => Promise<unknown>) { registered[name] = handler; },
  };
  traceTools(fake as never, (trace) => traces.push(trace));
  fake.registerTool("ok_tool", {}, async (input: unknown) => ({ content: [], structuredContent: { echo: input } }));
  fake.registerTool("bad_tool", {}, async () => { throw new Error("boom"); });
  fake.registerTool("soft_error", {}, async () => ({ isError: true, content: [{ type: "text", text: "nope" }] }));

  assert.deepEqual(await registered.ok_tool!({ a: 1 }, {}), { content: [], structuredContent: { echo: { a: 1 } } });
  await assert.rejects(() => registered.bad_tool!({ b: 2 }, {}), /boom/);
  await registered.soft_error!({}, {});

  assert.deepEqual(traces.map((trace) => [trace.toolName, trace.isError]), [["ok_tool", false], ["bad_tool", true], ["soft_error", true]]);
  assert.deepEqual(traces[0]?.input, { a: 1 });
  assert.deepEqual(traces[0]?.output, { echo: { a: 1 } });
  assert.equal(traces[1]?.errorMessage, "boom");
  assert.equal(traces[2]?.errorMessage, "nope");
  assert.equal(traces[0]?.agentName, "test-agent@1.0");
  assert.ok(traces.every((trace) => trace.durationMs >= 0));
});

test("traceTools is a no-op without a sink", () => {
  const fake = { registerTool: () => "original" };
  const before = fake.registerTool;
  traceTools(fake as never, undefined);
  assert.equal(fake.registerTool, before);
});

const dbEnabled = process.env.UNWH_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

test("traces are stored redacted, listed newest first, and purged by the retention row", { skip: !dbEnabled }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const tool = `trace_test_${randomUUID().slice(0, 8)}`;
  try {
    const old = await recordTrace(prisma, {}, { toolName: tool, input: { n: 0 }, durationMs: 1, occurredAt: new Date("2000-01-01T00:00:00Z") });
    await recordTrace(prisma, {}, { toolName: tool, input: { n: 1, apiKey: "k" }, output: { ok: true }, durationMs: 12.6 });
    await recordTrace(prisma, {}, { toolName: tool, input: { n: 2 }, isError: true, errorMessage: "failed with Bearer abcdefghijklmnop", durationMs: 3 });

    const page = await listTraces(prisma, { toolName: tool, limit: 2 });
    assert.equal(page.items.length, 2);
    assert.deepEqual(page.items.map((row) => (row.input as { n: number }).n), [2, 1]);
    assert.equal((page.items[1]?.input as Record<string, unknown>).apiKey, REDACTED);
    assert.equal(page.items[1]?.durationMs, 13);
    assert.equal(page.items[0]?.errorMessage, `failed with Bearer ${REDACTED}`);
    assert.ok(page.nextBefore);

    const errors = await listTraces(prisma, { toolName: tool, isError: true });
    assert.equal(errors.items.length, 1);

    const purge = await purgeOldTraces(prisma);
    assert.ok(purge.deleted >= 1);
    assert.equal(await prisma.agentTrace.findUnique({ where: { id: old.id } }), null);
  } finally {
    await prisma.agentTrace.deleteMany({ where: { toolName: tool } });
    await prisma.$disconnect();
  }
});
