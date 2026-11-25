import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

// Runs the production request handler from server.mjs against the built dist/ folder and
// checks /docs serves files only: PDFs as application/pdf, no listing, no dotfiles, no traversal.
let server: Server;
let port = 0;

function get(path: string): Promise<{ status: number; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    // Raw request so the path is sent exactly as written (no client-side ../ normalisation).
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test.beforeAll(async () => {
  process.env.UNWHELM_SERVER_NO_LISTEN = "1";
  const { handleRequest } = await import("../server.mjs");
  server = createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("serves the engineering story PDF as application/pdf", async () => {
  const res = await get("/docs/unwhelm_proposals_engineering_story.pdf");
  expect(res.status).toBe(200);
  expect(res.type).toBe("application/pdf");
  expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
});

test("serves the engineering story markdown as text/markdown", async () => {
  const res = await get("/docs/unwhelm_proposals_engineering_story.md");
  expect(res.status).toBe(200);
  expect(res.type).toBe("text/markdown; charset=utf-8");
  expect(res.body.length).toBeGreaterThan(1000);
  expect(res.body.toString()).not.toMatch(/<!doctype html/i);
});

for (const path of ["/docs", "/docs/", "/docs/missing.pdf", "/docs/missing.md", "/docs/.%2e/README.md", "/docs/.env", "/docs/%2e%2e/package.json", "/docs/..%2fpackage.json", "/docs/..%5cpackage.json", "/docs/../server.mjs", "/docs%2f..%2fpackage.json", "/docs/%2e%2e%2f%2e%2e%2fpackage.json"]) {
  test(`refuses ${path}`, async () => {
    const res = await get(path);
    expect([403, 404]).toContain(res.status);
    expect(res.body.subarray(0, 5).toString()).not.toBe("%PDF-");
    expect(res.body.toString()).not.toContain("\"name\"");
  });
}

test("SPA routes still answer 200", async () => {
  for (const path of ["/", "/try", "/try/help"]) {
    expect((await get(path)).status, path).toBe(200);
  }
});
