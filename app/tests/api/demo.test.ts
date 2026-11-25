// Pure checks always run. The database half runs when UNWH_DB_TEST=1 and DATABASE_URL are set.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { callMcpTool, continueDemo, coveredTools, DemoError, demoRateLimitHeaders, fillArgs, getDemo, listPlans, purgeExpiredDemos, startDemo, stopDemo } from "../../server/demo.js";
import { createServer } from "../../unwh-mcp/src/createServer.js";
import type { TraceSink } from "../../unwh-mcp/src/trace.js";

const registeredTools = () => Object.keys((createServer({ apiOrigin: "http://127.0.0.1:9", traceSink: null }) as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort();

/** A stand-in MCP endpoint that answers every tools/call over SSE. Admin tools are refused, like a client token. */
async function fakeMcp(): Promise<{ url: string; server: Server; calls: string[] }> {
  const calls: string[] = [];
  const id = randomUUID();
  const server = createHttpServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: number; params: { name: string } };
      calls.push(rpc.params.name);
      const refused = rpc.params.name.startsWith("unw_admin_");
      const structuredContent = refused ? { ok: false, code: "FORBIDDEN" } : { ok: true, entity: { id, settled: 3, total: 7 } };
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { isError: refused, structuredContent, content: [{ type: "text", text: JSON.stringify(structuredContent) }] } })}\n\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}/mcp`, server, calls };
}

test("fillArgs substitutes captured values at any depth and refuses unknown ones", () => {
  assert.deepEqual(fillArgs({ proposalId: "{proposalId}", list: ["x-{proposalId}"], n: 2 }, { proposalId: "p1" }), { proposalId: "p1", list: ["x-p1"], n: 2 });
  assert.throws(() => fillArgs({ a: "{missing}" }, {}), /missing/);
});

test("callMcpTool parses an SSE tools/call reply", async () => {
  const fake = await fakeMcp();
  try {
    const out = await callMcpTool(fake.url, "token", "unw_get_catalog", {}, 7);
    assert.equal(out.isError, false);
    assert.equal((out.structured as { entity: { settled: number } }).entity.settled, 3);
    assert.deepEqual(fake.calls, ["unw_get_catalog"]);
  } finally { fake.server.close(); }
});

test("createServer traces tool calls through the sink", async () => {
  const seen: string[] = [];
  const sink: TraceSink = (trace) => { seen.push(trace.toolName); };
  const server = createServer({ apiOrigin: "http://127.0.0.1:9", bearer: "Bearer x", traceSink: sink });
  const tools = (server as unknown as { _registeredTools: Record<string, { handler?: (...a: unknown[]) => Promise<unknown>; callback?: (...a: unknown[]) => Promise<unknown> }> })._registeredTools;
  const tool = tools.unw_get_catalog;
  const run = tool.handler ?? tool.callback;
  assert.ok(run, "unw_get_catalog is registered");
  await run!({}, { signal: new AbortController().signal }).catch(() => undefined);
  assert.deepEqual(seen, ["unw_get_catalog"]);
});

test("the seeded Try me plans call every MCP tool", () => {
  const dir = join(process.cwd(), "prisma", "migrations");
  const seeded = new Set<string>();
  for (const name of readdirSync(dir)) {
    let sql: string;
    try { sql = readFileSync(join(dir, name, "migration.sql"), "utf8"); } catch { continue; }
    if (!sql.includes("try_me_task_call")) continue;
    for (const match of sql.matchAll(/'(unw_[a-z_]+|search|fetch)'/g)) seeded.add(match[1]);
  }
  const missing = registeredTools().filter((tool) => !seeded.has(tool));
  assert.deepEqual(missing, [], `Add try_me_task_call rows for: ${missing.join(", ")}`);
});

test("createServer posts a trace to the API after each tool call by default", async () => {
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ ok: true, entity: {}, warnings: [], links: {} }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const previous = process.env.UNWH_MCP_TRACE;
  delete process.env.UNWH_MCP_TRACE;
  try {
    const server = createServer({ apiOrigin: "http://api.test", bearer: "Bearer x" });
    const tool = (server as unknown as { _registeredTools: Record<string, { handler?: (...a: unknown[]) => Promise<unknown>; callback?: (...a: unknown[]) => Promise<unknown> }> })._registeredTools.unw_get_catalog;
    await (tool.handler ?? tool.callback)!({}, { signal: new AbortController().signal });
    for (let i = 0; i < 20 && !seen.some((s) => s.includes("/agent-traces")); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(seen.some((s) => s === "POST http://api.test/api/v1/agent-traces"), `trace posted: ${seen.join(", ")}`);
  } finally {
    globalThis.fetch = realFetch;
    if (previous === undefined) delete process.env.UNWH_MCP_TRACE; else process.env.UNWH_MCP_TRACE = previous;
  }
});
const dbTest = process.env.UNWH_DB_TEST === "1" && process.env.DATABASE_URL ? test : test.skip;

dbTest("active plan rows cover every MCP tool", async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const covered = new Set(await coveredTools(prisma as never));
    const missing = registeredTools().filter((tool) => !covered.has(tool));
    assert.deepEqual(missing, [], `Add try_me_task_call rows for: ${missing.join(", ")}`);
    const plans = await listPlans(prisma as never);
    assert.ok(plans.length >= 2, "several plans for the dropdown");
  } finally { await prisma.$disconnect(); }
});

dbTest("a run pauses after each task, continues with the token, takes over, rate limits, and purges", async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const fake = await fakeMcp();
  const delay = await prisma.tryMeSetting.findUniqueOrThrow({ where: { code: "step_delay_ms" } });
  await prisma.tryMeSetting.update({ where: { code: "step_delay_ms" }, data: { value: 0 } });
  const ip = `test-${randomUUID()}`;
  try {
    const first = await startDemo(prisma as never, { ip, mcpUrl: fake.url, planCode: "build_submit", wait: true });
    assert.ok(first.token.startsWith("unwh_try_"));
    let demo = await getDemo(prisma as never, first.id);
    assert.equal(demo?.status, "paused", "pauses after the first task");
    assert.equal(demo!.doneTasks, 1);
    assert.deepEqual(fake.calls, ["unw_get_service_info", "unw_get_catalog"]);

    await assert.rejects(continueDemo(prisma as never, { id: first.id, raw: "wrong", mcpUrl: fake.url, wait: true }), (e: unknown) => e instanceof DemoError && e.status === 401);
    await continueDemo(prisma as never, { id: first.id, raw: first.token, mcpUrl: fake.url, wait: true });
    demo = await getDemo(prisma as never, first.id);
    assert.equal(demo!.doneTasks, 2);
    await continueDemo(prisma as never, { id: first.id, raw: first.token, mcpUrl: fake.url, wait: true });
    demo = await getDemo(prisma as never, first.id);
    assert.ok(demo!.proposalId, "the proposal id was captured");

    const stopped = await stopDemo(prisma as never, { id: first.id, raw: first.token });
    assert.equal(stopped.status, "taken_over");
    await assert.rejects(continueDemo(prisma as never, { id: first.id, raw: first.token, mcpUrl: fake.url }), (e: unknown) => e instanceof DemoError && e.status === 409);

    const all = await startDemo(prisma as never, { ip, mcpUrl: fake.url, planCode: "boundaries", wait: true });
    await continueDemo(prisma as never, { id: all.id, raw: all.token, mcpUrl: fake.url, all: true, wait: true });
    demo = await getDemo(prisma as never, all.id);
    assert.equal(demo!.status, "complete");
    assert.equal(demo!.doneCalls, demo!.totalCalls);
    assert.ok(demo!.tasks[0].calls.every((c) => c.status === "refused"), "admin calls show as refused");

    const limit = (await prisma.tryMeSetting.findUniqueOrThrow({ where: { code: "max_starts_per_ip_per_hour" } })).value;
    for (let i = 2; i < limit; i++) await startDemo(prisma as never, { ip, mcpUrl: fake.url, wait: true });
    const oldestStart = (await prisma.tryMeSession.findFirstOrThrow({ where: { id: first.id } })).createdAt;
    const checkedAt = new Date();
    await assert.rejects(startDemo(prisma as never, { ip, mcpUrl: fake.url, now: checkedAt }), (e: unknown) => {
      if (!(e instanceof DemoError) || e.status !== 429) return false;
      const expected = Math.ceil((oldestStart.getTime() + 3_600_000 - checkedAt.getTime()) / 1000);
      assert.equal(Number(e.headers["Retry-After"]), expected, "Retry-After counts down to when the oldest start leaves the window");
      assert.equal(e.headers["RateLimit-Remaining"], "0");
      assert.equal(e.headers["RateLimit-Limit"], String(limit));
      return true;
    });

    const session = await prisma.tryMeSession.findUniqueOrThrow({ where: { id: first.id } });
    const purged = await purgeExpiredDemos(prisma as never, new Date(session.expiresAt.getTime() + 60_000));
    assert.ok(purged >= limit);
    assert.equal(await getDemo(prisma as never, first.id), null);
    assert.equal(await prisma.organization.count({ where: { id: session.organizationId! } }), 0);
    assert.equal(await prisma.user.count({ where: { id: session.userId! } }), 0);
    assert.equal(await prisma.mcpToken.count({ where: { id: session.tokenId! } }), 0);
  } finally {
    await prisma.tryMeSetting.update({ where: { code: "step_delay_ms" }, data: { value: delay.value } });
    fake.server.close();
    await prisma.$disconnect();
  }
});

test("demo rate-limit headers count down from the oldest start in the window", () => {
  const now = new Date("2026-10-29T12:00:00.000Z");
  const headers = demoRateLimitHeaders(new Date("2026-10-29T11:15:00.000Z"), now, 5);
  assert.equal(headers["Retry-After"], "900");
  assert.equal(headers["RateLimit-Reset"], "900");
  assert.equal(headers["X-RateLimit-Reset"], String(Date.parse("2026-10-29T12:15:00.000Z") / 1000));
  assert.equal(demoRateLimitHeaders(new Date("2026-10-29T10:59:00.000Z"), now, 5)["Retry-After"], "1", "never below one second");
});
