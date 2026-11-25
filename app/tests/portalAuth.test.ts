import assert from "node:assert/strict";
import { test } from "node:test";
import { portalApi } from "../src/portal.tsx";

test("portalApi redirects to sign-in on 401", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = (globalThis as any).window;
  try {
    (globalThis as any).window = { location: { href: "", pathname: "/portal", search: "" } };
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, code: "AUTH_REQUIRED", message: "Authentication is required." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    await assert.rejects(() => portalApi("/api/v1/proposals"), (error: any) => {
      assert.equal(error?.code, "AUTH_REQUIRED");
      assert.match((globalThis as any).window.location.href, /^\/api\/v1\/auth\/signin\?next=%2Fportal$/);
      return true;
    });
  } finally {
    globalThis.fetch = previousFetch!;
    (globalThis as any).window = previousWindow;
  }
});

