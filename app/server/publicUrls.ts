export function webPublicUrl() {
  return (process.env.UNWH_WEB_PUBLIC_URL ?? "https://unwhelm.net").replace(/\/$/, "");
}

export function proposalPortalUrl(proposalId: string) {
  return `${webPublicUrl()}/portal?proposal=${encodeURIComponent(proposalId)}`;
}

export function proposalLinks(entity: unknown): Record<string, string> {
  if (!entity || typeof entity !== "object") return {};
  const record = entity as { id?: unknown; scope?: unknown; timeline?: unknown };
  if (typeof record.id !== "string" || (record.scope === undefined && record.timeline === undefined)) return {};
  return { portal: proposalPortalUrl(record.id) };
}
