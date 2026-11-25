// CORS for browser-based MCP clients. Tokens travel in the Authorization header, never cookies,
// so a wildcard origin is safe by default; set UNWH_MCP_CORS_ORIGINS to a comma list to narrow it.
export const MCP_CORS_ALLOW_HEADERS = ["Authorization", "Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version", "Last-Event-ID"];
export const MCP_CORS_EXPOSE_HEADERS = ["Mcp-Session-Id", "Mcp-Protocol-Version", "WWW-Authenticate"];
export const MCP_CORS_METHODS = ["GET", "POST", "DELETE", "OPTIONS"];

export function parseCorsOrigins(value: string | undefined): readonly string[] {
  const origins = (value ?? "*").split(",").map((origin) => origin.trim()).filter(Boolean);
  return origins.length ? origins : ["*"];
}

export function corsHeaders(origin: string | undefined, allowed: readonly string[]): Record<string, string> {
  const base = {
    "access-control-allow-methods": MCP_CORS_METHODS.join(", "),
    "access-control-allow-headers": MCP_CORS_ALLOW_HEADERS.join(", "),
    "access-control-expose-headers": MCP_CORS_EXPOSE_HEADERS.join(", "),
    "access-control-max-age": "600",
  };
  if (allowed.includes("*")) return { "access-control-allow-origin": "*", ...base };
  if (origin && allowed.includes(origin)) return { "access-control-allow-origin": origin, vary: "Origin", ...base };
  return { vary: "Origin" };
}

/** Preflight answers before auth: browsers never send credentials on OPTIONS. */
export function isPreflight(method: string | undefined): boolean {
  return method === "OPTIONS";
}
