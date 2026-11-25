/**
 * Scopes stored on a connector access token.
 * The client may request any oauth_scope row advertised with mcp=true.
 * A staff member or admin also receives that role's session_scope_grant rows
 * when those scopes are advertised, so a connector that asked for an older
 * subset still receives billing and catalog access.
 */
export function connectorTokenScopes(input: {
  requested: string;
  mcpScopes: readonly string[];
  staffGrants: readonly string[];
  isStaffOrAdmin: boolean;
  /** Scopes only staff or admins may hold; dropped for everyone else even when requested. */
  staffOnlyScopes?: readonly string[];
}): string[] {
  const known = new Set(input.mcpScopes);
  const recognized = input.requested.split(/\s+/).filter((scope) => known.has(scope));
  const scopes = recognized.length > 0 ? [...recognized] : [...input.mcpScopes];
  if (input.isStaffOrAdmin) {
    for (const scope of input.staffGrants) {
      if (known.has(scope) && !scopes.includes(scope)) scopes.push(scope);
    }
    return scopes;
  }
  const staffOnly = new Set(input.staffOnlyScopes ?? []);
  return scopes.filter((scope) => !staffOnly.has(scope));
}

export function isStaffOrAdmin(user: { isAdmin?: boolean | null; memberships?: ReadonlyArray<{ status?: string | null; role?: string | null }> } | null | undefined): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  return user.memberships?.some((membership) => membership.status === "active" && membership.role === "staff") ?? false;
}
