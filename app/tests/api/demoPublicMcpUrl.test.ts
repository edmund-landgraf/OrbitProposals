import test from "node:test";
import assert from "node:assert/strict";
import { demoPublicMcpUrl } from "../../server/routes/demo.js";

test("demo sessions point local clients at the local MCP server and others at prod", () => {
  assert.equal(demoPublicMcpUrl("localhost:5192", {}), "http://localhost:3202/mcp");
  assert.equal(demoPublicMcpUrl("127.0.0.1:3201", {}), "http://localhost:3202/mcp");
  assert.equal(demoPublicMcpUrl("[::1]:3201", {}), "http://localhost:3202/mcp");
  assert.equal(demoPublicMcpUrl("localhost", { UNWH_DEMO_LOCAL_MCP_URL: "http://localhost:4000/mcp" }), "http://localhost:4000/mcp");
  assert.equal(demoPublicMcpUrl("unwhelm.net", {}), "https://mcp.unwhelm.net/mcp");
  assert.equal(demoPublicMcpUrl(undefined, {}), "https://mcp.unwhelm.net/mcp");
  assert.equal(demoPublicMcpUrl("localhost", { UNWH_DEMO_PUBLIC_MCP_URL: "https://x.test/mcp" }), "https://x.test/mcp");
});
