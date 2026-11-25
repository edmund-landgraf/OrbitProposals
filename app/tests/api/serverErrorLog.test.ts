// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { apiErrorHandler, logFinishedServerFailure } from "../../server/apiErrorHandler.js";

const requestId = "11111111-1111-4111-8111-111111111111";

test("a 5xx response logs the request id and stack to stderr", async () => {
  const app = express();
  const lines: string[] = [];
  const original = console.error;
  console.error = (message?: unknown) => { lines.push(String(message)); };
  app.use(logFinishedServerFailure);
  app.get("/boom", (_request, _response, next) => next(new Error("catalog draft exploded")));
  app.get("/missing", (_request, response) => response.status(404).json({ ok: false }));
  app.use(apiErrorHandler);
  const server = await listen(app);
  try {
    const failed = await fetch(`${server.origin}/boom`, { headers: { "x-request-id": requestId } });
    const body = await failed.json() as { code: string; requestId: string };
    assert.equal(failed.status, 500);
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.equal(body.requestId, requestId);
    assert.equal(lines.length, 1);
    assert.match(lines[0], new RegExp(requestId));
    assert.match(lines[0], /catalog draft exploded/);
    assert.match(lines[0], /serverErrorLog\.test\.ts/);

    lines.length = 0;
    const missing = await fetch(`${server.origin}/missing`, { headers: { "x-request-id": requestId } });
    assert.equal(missing.status, 404);
    assert.equal(lines.length, 0);
  } finally {
    console.error = original;
    await server.close();
  }
});

async function listen(app: express.Express): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
