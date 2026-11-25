import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = `http://${process.env.UNWH_MCP_HOST ?? "127.0.0.1"}:${process.env.UNWH_MCP_PORT ?? "3202"}`;
const token = process.env.UNWH_MCP_ACCESS_TOKEN;
if (!token) throw new Error("UNWH_MCP_ACCESS_TOKEN is required for MCP smoke");
const response = await fetch(`${base}/health`);
if (!response.ok) throw new Error(`MCP health failed: ${response.status}`);
const body = await response.json() as { ok?: boolean; connected?: boolean };
if (!body.ok || body.connected !== false) throw new Error(`Unexpected MCP health: ${JSON.stringify(body)}`);

// POST without a bearer is the anonymous tool set (mixed auth); any other method without one is still 401.
const unauthorized = await fetch(`${base}/mcp`, { method: "GET" });
if (unauthorized.status !== 401) throw new Error(`Expected 401 for GET without a bearer, got ${unauthorized.status}`);

const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "unwh-mcp-smoke", version: "0.1.0" });
await client.connect(transport);
const tools = await client.listTools();
for (const name of ["unw_get_service_info", "unw_list_proposals", "unw_create_chat_session", "unw_sign_contract", "unw_get_billing_schedule", "unw_list_invoices", "unw_get_invoice", "unw_create_invoice", "unw_send_invoice", "unw_pay_invoice", "unw_void_invoice", "unw_log_hours", "unw_list_hours", "unw_remaining_hours", "unw_invoice_hours"]) {
  if (!tools.tools.some((tool) => tool.name === name)) {
    throw new Error(`${name} missing from tools/list`);
  }
}
const info = await client.callTool({ name: "unw_get_service_info", arguments: {} });
const infoJson = JSON.stringify(info);
if (!infoJson.includes('"connected":true')) {
  throw new Error(`MCP-to-API health call did not connect: ${JSON.stringify(info)}`);
}
const chat = await client.callTool({ name: "unw_create_chat_session", arguments: { agent: "proposal" } });
if (!JSON.stringify(chat).includes('"ok":true')) {
  throw new Error(`MCP-to-API database write failed: ${JSON.stringify(chat)}`);
}
await client.close();
console.log("unwh-mcp to unwh-api smoke passed", { ...body, toolCount: tools.tools.length });
