import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// /downloads serves one flat folder and only the exact directory entry, including case.
let server: Server;
let port = 0;
const downloadsDir = join("dist", "downloads");
const exactName = "Exact-Name.txt";

function get(path: string): Promise<{ status: number; type: string; disposition: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        type: String(res.headers["content-type"] ?? ""),
        disposition: String(res.headers["content-disposition"] ?? ""),
        body: Buffer.concat(chunks),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

test.beforeAll(async () => {
  mkdirSync(downloadsDir, { recursive: true });
  writeFileSync(join(downloadsDir, exactName), "download-ok");
  process.env.UNWHELM_SERVER_NO_LISTEN = "1";
  const { handleRequest } = await import("../server.mjs");
  server = createServer(handleRequest);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(join(downloadsDir, exactName), { force: true });
});

test("serves the exact download name", async () => {
  const res = await get(`/downloads/${exactName}`);
  expect(res.status).toBe(200);
  expect(res.type).toBe("text/plain; charset=utf-8");
  expect(res.disposition).toBe(`attachment; filename="${exactName}"`);
  expect(res.body.toString()).toBe("download-ok");
});

test("refuses a name that differs only by case", async () => {
  const res = await get("/downloads/exact-name.txt");
  expect(res.status).toBe(404);
  expect(res.body.toString()).not.toContain("download-ok");
});

for (const path of ["/downloads", "/downloads/", "/downloads/missing.txt", "/downloads/.env", "/downloads/%2e%2e/package.json", "/downloads/../server.mjs", "/downloads%2f..%2fpackage.json"]) {
  test(`refuses ${path}`, async () => {
    const res = await get(path);
    expect([403, 404]).toContain(res.status);
    expect(res.body.toString()).not.toContain("download-ok");
  });
}
