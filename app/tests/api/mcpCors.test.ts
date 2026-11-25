import assert from "node:assert/strict";
import test from "node:test";
import { corsHeaders, isPreflight, parseCorsOrigins } from "../../unwh-mcp/src/cors.js";

test("default CORS allows any origin and exposes Mcp-Session-Id", () => {
  const headers = corsHeaders("https://chatgpt.com", parseCorsOrigins(undefined));
  assert.equal(headers["access-control-allow-origin"], "*");
  assert.match(headers["access-control-allow-headers"]!, /Mcp-Session-Id/);
  assert.match(headers["access-control-allow-headers"]!, /Authorization/);
  assert.match(headers["access-control-expose-headers"]!, /Mcp-Session-Id/);
  assert.match(headers["access-control-allow-methods"]!, /OPTIONS/);
});

test("a narrowed origin list reflects allowed origins and refuses others", () => {
  const allowed = parseCorsOrigins("https://chatgpt.com, https://claude.ai");
  assert.equal(corsHeaders("https://claude.ai", allowed)["access-control-allow-origin"], "https://claude.ai");
  assert.equal(corsHeaders("https://evil.example", allowed)["access-control-allow-origin"], undefined);
  assert.equal(corsHeaders(undefined, allowed)["access-control-allow-origin"], undefined);
});

test("OPTIONS is a preflight answered before auth", () => {
  assert.equal(isPreflight("OPTIONS"), true);
  assert.equal(isPreflight("POST"), false);
});
