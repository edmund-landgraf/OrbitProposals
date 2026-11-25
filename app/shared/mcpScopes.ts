/**
 * Scopes the MCP listener advertises and the admin Tokens tab can mint.
 * billing:read covers the billing schedule and invoice reads. billing:write
 * covers invoice create, send, pay, and void. Pay records status only.
 * contracts:write is grantable to client tokens. For a client caller the API
 * honors it only when signing a contract that caller is a party to. Signing
 * generates the billing schedule. Every other contract write stays staff-only.
 * catalog:write covers draft catalog edits and publish. The published catalog
 * at GET /api/v1/catalog is public and is not in this list.
 * admin satisfies every scope check.
 */
export const MCP_SCOPES = [
  "proposals:read",
  "proposals:write",
  "contracts:write",
  "billing:read",
  "billing:write",
  "projects:read",
  "projects:write",
  "admin",
  "catalog:write",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/** A missing scope list means the caller was already granted access another way. An empty list grants nothing. admin passes every named scope. */
export function scopeAllows(scopes: readonly string[] | null | undefined, required: string): boolean {
  if (scopes == null) return true;
  return scopes.includes("admin") || scopes.includes(required);
}
