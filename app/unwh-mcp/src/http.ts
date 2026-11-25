import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "./createServer.js";
import { corsHeaders, isPreflight, parseCorsOrigins } from "./cors.js";
import { publicScopeSource } from "./publicScopes.js";
import { getApiHealth } from "./apiClient.js";
import { waitUntilReady } from "../../shared/retry.js";
import { logEvent } from "../../shared/log.js";
import { anonymousRateLimiter, anonymousSettingsSource, clientAddress } from "./anonymousAccess.js";

async function tokenAccess(apiOrigin: string, authorization: string): Promise<{ scopes: readonly string[]; staff: boolean } | undefined> {
  try {
    const response = await fetch(`${apiOrigin.replace(/\/$/, "")}/api/v1/health`, { headers: { accept: "application/json", authorization } });
    if (!response.ok) return undefined;
    const body = await response.json() as { entity?: { scopes?: unknown; staff?: unknown } };
    if (!Array.isArray(body.entity?.scopes)) return undefined;
    return { scopes: body.entity.scopes.filter((scope): scope is string => typeof scope === "string"), staff: body.entity.staff === true };
  } catch {
    return undefined;
  }
}

// Decoded attachment cap is 10 MiB. Base64 expands that to ~13.4 MiB, and the API allows 15mb on those routes.
// The SDK default is 4 MiB (DEFAULT_MAX_REQUEST_BODY_SIZE), which rejects a real 10 MiB upload with 413.
const MCP_MAX_REQUEST_BODY_BYTES = 15 * 1024 * 1024;

const host = process.env.UNWH_MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.UNWH_MCP_PORT ?? "3202");
const apiOrigin = process.env.UNWH_API_ORIGIN ?? "http://127.0.0.1:3201";
const publicBaseUrl = process.env.UNWH_WEB_PUBLIC_URL ?? process.env.UNWH_API_PUBLIC_URL ?? "https://unwhelm.net";
const mcpPublicUrl = process.env.UNWH_MCP_PUBLIC_URL ?? "https://mcp.unwhelm.net";
const resourceUrl = process.env.UNWH_MCP_RESOURCE_URL ?? (mcpPublicUrl.endsWith("/mcp") ? mcpPublicUrl : `${mcpPublicUrl}/mcp`);
const corsOrigins = parseCorsOrigins(process.env.UNWH_MCP_CORS_ORIGINS);
const publicScopes = publicScopeSource(apiOrigin);
const resourceMetadataUrl = `${mcpPublicUrl.replace(/\/mcp\/?$/, "")}/.well-known/oauth-protected-resource`;
const anonymousSettings = anonymousSettingsSource(apiOrigin);
const allowAnonymous = anonymousRateLimiter();

const httpServer = createHttpServer(async (request, response) => {
  if (request.url === "/health" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "unwh-mcp", connected: false }));
    return;
  }

  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const protectedResourcePaths = new Set(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]);
  if (pathname === "/mcp" || protectedResourcePaths.has(pathname)) {
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    for (const [name, value] of Object.entries(corsHeaders(origin, corsOrigins))) response.setHeader(name, value);
    if (isPreflight(request.method)) {
      response.writeHead(204);
      response.end();
      return;
    }
  }
  if (protectedResourcePaths.has(pathname) && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ resource: resourceUrl, authorization_servers: [process.env.UNWH_AUTHORIZATION_SERVER ?? "https://unwhelm.net"], bearer_methods_supported: ["header"], scopes_supported: await publicScopes() }));
    return;
  }

  if (pathname !== "/mcp") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, code: "NOT_FOUND" }));
    return;
  }

  if (!request.headers.authorization?.startsWith("Bearer ") && request.method === "POST") {
    // Mixed auth (OpenAI Apps SDK): no token means the anonymous tool set, rate limited per client address.
    const { rateLimit, windowSeconds } = await anonymousSettings();
    const verdict = allowAnonymous(clientAddress(request.headers, request.socket.remoteAddress), rateLimit, windowSeconds * 1000);
    if (!verdict.allowed) {
      response.writeHead(429, { "content-type": "application/json", "retry-after": String(verdict.retryAfterSeconds), "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"` });
      response.end(JSON.stringify({ ok: false, code: "RATE_LIMITED", message: "Too many requests without signing in. Sign in to Unwhelm or try again later." }));
      return;
    }
    const server = createServer({ apiOrigin, anonymous: true, resourceMetadataUrl, publicBaseUrl, traceSink: null });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES });
    await server.connect(transport);
    await transport.handleRequest(request, response);
    return;
  }

  if (!request.headers.authorization?.startsWith("Bearer ")) {
    response.writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"` });
    response.end(JSON.stringify({ ok: false, code: "AUTH_REQUIRED" }));
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(405, { "content-type": "application/json", allow: "POST" });
    response.end(JSON.stringify({ ok: false, code: "METHOD_NOT_ALLOWED" }));
    return;
  }

  const authorization = request.headers.authorization;
  const access = await tokenAccess(apiOrigin, authorization);
  const server = createServer({ apiOrigin, bearer: authorization, resourceMetadataUrl, publicBaseUrl, ...(access !== undefined ? { scopes: access.scopes, staff: access.staff } : {}) });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, maxRequestBodySize: MCP_MAX_REQUEST_BODY_BYTES });
  await server.connect(transport);
  await transport.handleRequest(request, response);
});

// Wait (bounded) for unwh-api before listening; start anyway, since tool calls retry on their own.
void waitUntilReady(() => getApiHealth(apiOrigin), { label: "unwh-api" }).then(() => {
  httpServer.listen(port, host, () => {
    logEvent("info", "listening", { service: "unwh-mcp", url: `http://${host}:${port}/mcp`, apiOrigin });
  });
});
