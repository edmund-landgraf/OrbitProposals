export type LibraryItem = {
  status: string;
  title: string;
  category: string;
  tags: string[];
  clientLabel: string | null;
  industry: string | null;
  product: string | null;
  guidance: string;
  expiresAt: Date | null;
  approvedVersion: number | null;
};

export function contentExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return Boolean(expiresAt && expiresAt.getTime() < now.getTime());
}

export function insertRefusal(item: { status: string; expiresAt: Date | null }, now = new Date()): string | null {
  if (item.status === "archived") return "Archived content stays in history and cannot be inserted.";
  if (item.status !== "approved" || contentExpired(item.expiresAt, now)) return "Only approved, non-expired content can be inserted.";
  return null;
}

export function upsertMode(existing: { status: string; pending?: string } | null): "create" | "revise" | "next" | "blocked" {
  if (!existing) return "create";
  const pending = existing.pending;
  if (pending === "in_review" || (!pending && existing.status === "in_review")) return "blocked";
  if (pending === "draft" || pending === "rejected" || existing.status === "draft" || existing.status === "rejected") return "revise";
  return "next";
}

export function matchReason(item: LibraryItem, query: { query?: string; category?: string; clientLabel?: string; industry?: string; product?: string; tags?: string[] }, now = new Date()): string {
  const hits: string[] = [];
  const needle = query.query?.trim().toLowerCase();
  if (needle && item.title.toLowerCase().includes(needle)) hits.push("title");
  if (needle && item.guidance.toLowerCase().includes(needle)) hits.push("guidance");
  if (query.category && item.category === query.category) hits.push("category");
  if (query.clientLabel && item.clientLabel === query.clientLabel) hits.push("client label");
  if (query.industry && item.industry === query.industry) hits.push("industry");
  if (query.product && item.product === query.product) hits.push("product");
  for (const tag of query.tags ?? []) if (item.tags.includes(tag)) hits.push(`tag ${tag}`);
  const state = contentExpired(item.expiresAt, now) ? "expired" : item.status;
  const approval = item.approvedVersion ? `approved version ${item.approvedVersion}` : "no approved version";
  const why = hits.length ? hits.join(", ") : "visible library item";
  return `Matched on ${why}. State is ${state}; ${approval}.`;
}
