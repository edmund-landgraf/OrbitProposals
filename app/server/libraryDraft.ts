const words = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 3));

function overlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function libraryText(body: unknown): string {
  if (typeof body === "string") return body.trim();
  if (body && typeof body === "object" && !Array.isArray(body) && typeof (body as { text?: unknown }).text === "string") return (body as { text: string }).text.trim();
  return "";
}

export type DraftRequirement = { id: string; text: string; mappedNodeKeys: string[]; suggestedNodeKeys: string[] };
export type DraftItem = { id: string; title: string; version: number; bodyText: string };
export type SectionDraft = {
  text: string;
  citations: Array<{ requirementId: string; itemId: string; title: string; version: number }>;
  gaps: Array<{ requirementId: string; text: string }>;
};

export function draftSection(sectionKey: string, requirements: DraftRequirement[], items: DraftItem[]): SectionDraft {
  const relevant = requirements.filter((item) => item.mappedNodeKeys.includes(sectionKey) || item.suggestedNodeKeys.includes(sectionKey));
  const citations: SectionDraft["citations"] = [];
  const gaps: SectionDraft["gaps"] = [];
  const blocks: string[] = [];
  for (const requirement of relevant) {
    const ranked = items
      .map((item) => ({ item, score: overlap(words(requirement.text), words(`${item.title} ${item.bodyText}`)) }))
      .filter((entry) => entry.score >= 0.3 && entry.item.bodyText)
      .sort((left, right) => right.score - left.score);
    const match = ranked[0]?.item;
    if (!match) {
      gaps.push({ requirementId: requirement.id, text: requirement.text });
      blocks.push(`Gap: ${requirement.text}\nNo approved library answer covers this requirement.`);
      continue;
    }
    citations.push({ requirementId: requirement.id, itemId: match.id, title: match.title, version: match.version });
    blocks.push(`${match.bodyText}\n\nSource: ${match.title}, version ${match.version}.`);
  }
  const text = blocks.join("\n\n");
  return { text, citations, gaps };
}
