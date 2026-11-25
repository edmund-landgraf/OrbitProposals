import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_SCOPES } from "./toolAccess.js";

// Mixed auth, following the OpenAI Apps SDK auth guide (developers.openai.com/apps-sdk/build/auth):
// - every tool declares _meta.securitySchemes: "noauth" for anonymous tools, "oauth2" (with its scope) for the rest,
//   and both for tools whose results grow once the caller links an account;
// - when an anonymous caller runs an oauth2 tool, the tool returns an error result carrying
//   _meta["mcp/www_authenticate"] (with error and error_description) so ChatGPT shows its sign-in UI.
// The API still verifies every token and scope; these declarations are only hints for the client.

/** Tools an anonymous (no bearer) caller may run. Everything else answers with an OAuth challenge. */
export const ANONYMOUS_TOOLS: readonly string[] = ["unw_get_service_info", "unw_get_catalog", "search", "fetch", "unw_draft_proposal"];

/** Anonymous tools that see more after sign-in (proposals), so they advertise both schemes. */
const LINKING_UNLOCKS: Readonly<Record<string, string>> = { search: "proposals:read", fetch: "proposals:read" };

export type SecurityScheme = { type: "noauth" } | { type: "oauth2"; scopes: string[] };

export function securitySchemesFor(name: string): SecurityScheme[] {
  const unlock = LINKING_UNLOCKS[name];
  if (unlock) return [{ type: "noauth" }, { type: "oauth2", scopes: [unlock] }];
  if (ANONYMOUS_TOOLS.includes(name)) return [{ type: "noauth" }];
  const scope = TOOL_SCOPES[name];
  return [{ type: "oauth2", scopes: scope ? [scope] : [] }];
}

export const DEFAULT_RESOURCE_METADATA_URL = "https://mcp.unwhelm.net/.well-known/oauth-protected-resource";

export function authChallenge(resourceMetadataUrl: string, scope?: string, action = "use this tool") {
  const description = `Sign in to Unwhelm to ${action}.`;
  const header = `Bearer resource_metadata="${resourceMetadataUrl}", error="insufficient_scope", error_description="${description}"${scope ? `, scope="${scope}"` : ""}`;
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Authentication required. ${description}` }],
    _meta: { "mcp/www_authenticate": [header] },
  };
}

/** Wraps registerTool so every tool registered afterward declares its securitySchemes. For an anonymous caller, tools that need OAuth return the challenge instead of running. */
export function applyToolAuth(server: McpServer, options: { anonymous: boolean; resourceMetadataUrl: string }): void {
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (name: unknown, config: unknown, handler: unknown) => {
    if (typeof name !== "string" || !config || typeof config !== "object") return original(name, config, handler);
    const existing = (config as { _meta?: Record<string, unknown> })._meta ?? {};
    const withSchemes = { ...config, _meta: { ...existing, securitySchemes: securitySchemesFor(name) } };
    const run = options.anonymous && !ANONYMOUS_TOOLS.includes(name)
      ? async () => authChallenge(options.resourceMetadataUrl, TOOL_SCOPES[name])
      : handler;
    return original(name, withSchemes, run);
  };
}

/** Fixed-window limiter for anonymous callers, keyed by client address. Memory is bounded by sweeping expired windows. */
export function anonymousRateLimiter(maxKeys = 10_000) {
  const windows = new Map<string, { start: number; count: number }>();
  return function allow(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const current = windows.get(key);
    if (!current || now - current.start >= windowMs) {
      if (windows.size >= maxKeys) for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
      if (windows.size >= maxKeys) return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      windows.set(key, { start: now, count: 1 });
      return { allowed: limit >= 1, retryAfterSeconds: limit >= 1 ? 0 : Math.ceil(windowMs / 1000) };
    }
    current.count += 1;
    if (current.count <= limit) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.start + windowMs - now) / 1000)) };
  };
}

export type AnonymousSettings = { rateLimit: number; windowSeconds: number };
/** Used only when the API is unreachable; deliberately stricter than the seeded rows. */
export const FALLBACK_ANONYMOUS_SETTINGS: AnonymousSettings = { rateLimit: 10, windowSeconds: 600 };

type Fetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Reads the anonymous limits (mcp_client_setting rows) from GET /api/v1/public/mcp-info. Cached for ttlMs. */
export function anonymousSettingsSource(apiOrigin: string, fetcher: Fetcher = (url) => fetch(url, { headers: { accept: "application/json" } }), ttlMs = 60_000) {
  let cached: { at: number; settings: AnonymousSettings } | undefined;
  return async function anonymousSettings(now = Date.now()): Promise<AnonymousSettings> {
    if (cached && now - cached.at < ttlMs) return cached.settings;
    try {
      const response = await fetcher(`${apiOrigin.replace(/\/$/, "")}/api/v1/public/mcp-info`);
      if (response.ok) {
        const body = await response.json() as { entity?: { anonymous?: { rateLimit?: unknown; windowSeconds?: unknown } } };
        const rateLimit = Number(body.entity?.anonymous?.rateLimit);
        const windowSeconds = Number(body.entity?.anonymous?.windowSeconds);
        if (Number.isInteger(rateLimit) && rateLimit >= 0 && Number.isInteger(windowSeconds) && windowSeconds > 0) {
          cached = { at: now, settings: { rateLimit, windowSeconds } };
          return cached.settings;
        }
      }
    } catch { /* fall through */ }
    return FALLBACK_ANONYMOUS_SETTINGS;
  };
}

/** The caller's address. Behind one trusted proxy (like the API's trust proxy 1), that is the last x-forwarded-for hop. */
export function clientAddress(headers: Record<string, string | string[] | undefined>, socketAddress: string | undefined): string {
  const forwarded = headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  const hops = (value ?? "").split(",").map((hop) => hop.trim()).filter(Boolean);
  return hops.at(-1) ?? socketAddress ?? "unknown";
}
