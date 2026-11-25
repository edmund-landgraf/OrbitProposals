import { MCP_SCOPES } from "./scopes.js";

/** Used only when the API is unreachable: never advertise the staff-only scopes. */
const FALLBACK_HIDDEN = new Set(["admin", "catalog:write"]);
export const FALLBACK_PUBLIC_SCOPES: readonly string[] = MCP_SCOPES.filter((scope) => !FALLBACK_HIDDEN.has(scope));

type Fetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Reads the public scope list from the API's OAuth discovery, which filters oauth_scope.staff_only rows. Cached for ttlMs. */
export function publicScopeSource(apiOrigin: string, fetcher: Fetcher = (url) => fetch(url, { headers: { accept: "application/json" } }), ttlMs = 60_000) {
  let cached: { at: number; scopes: readonly string[] } | undefined;
  return async function publicScopes(now = Date.now()): Promise<readonly string[]> {
    if (cached && now - cached.at < ttlMs) return cached.scopes;
    try {
      const response = await fetcher(`${apiOrigin.replace(/\/$/, "")}/.well-known/oauth-authorization-server`);
      if (response.ok) {
        const body = await response.json() as { scopes_supported?: unknown };
        if (Array.isArray(body.scopes_supported)) {
          const scopes = body.scopes_supported.filter((scope): scope is string => typeof scope === "string");
          cached = { at: now, scopes };
          return scopes;
        }
      }
    } catch { /* fall through */ }
    return FALLBACK_PUBLIC_SCOPES;
  };
}
