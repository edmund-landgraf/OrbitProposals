import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createStatusRouter, requestLogger, type LogLine } from "../../server/observability.js";

async function serve(app: express.Express) {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

test("status is ok when every check passes and degraded (503) when one fails", async () => {
  let dbUp = true;
  const app = express();
  app.use("/api/v1", createStatusRouter({ version: "abc123", checks: [{ name: "database", run: async () => { if (!dbUp) throw new Error("connection refused at 10.0.0.5"); } }] }));
  const { server, base } = await serve(app);
  try {
    const up = await fetch(`${base}/api/v1/status`);
    assert.equal(up.status, 200);
    const upBody = await up.json() as { entity: { status: string; version: string; checks: { name: string; ok: boolean }[] } };
    assert.equal(upBody.entity.status, "ok");
    assert.equal(upBody.entity.version, "abc123");
    assert.deepEqual(upBody.entity.checks.map((c) => [c.name, c.ok]), [["database", true]]);
    dbUp = false;
    const down = await fetch(`${base}/api/v1/status`);
    assert.equal(down.status, 503);
    const downBody = await down.json() as { entity: { status: string; checks: { error?: string }[] } };
    assert.equal(downBody.entity.status, "degraded");
    assert.equal(downBody.entity.checks[0].error, "Error");
    assert.ok(!JSON.stringify(downBody).includes("10.0.0.5"));
  } finally { server.close(); }
});

test("request logger writes one JSON line per request with id, status, and no query string", async () => {
  const lines: LogLine[] = [];
  const app = express();
  app.use(requestLogger((line) => lines.push(line)));
  app.get("/x", (_request, response) => { response.status(404).end(); });
  const { server, base } = await serve(app);
  try {
    const response = await fetch(`${base}/x?token=secret`, { headers: { "x-request-id": "req-1" } });
    assert.equal(response.headers.get("x-request-id"), "req-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].requestId, "req-1");
    assert.equal(lines[0].path, "/x");
    assert.equal(lines[0].status, 404);
    assert.equal(lines[0].level, "warn");
    assert.ok(!JSON.stringify(lines).includes("secret"));
  } finally { server.close(); }
});
