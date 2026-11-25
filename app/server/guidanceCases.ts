// Approach B case library helpers: rank approved cases by how well their signal snapshot matches the current one.
export type CaseRow = { key: string; title: string; situation: string; signals: unknown; move: string | null; clientPhrase: string | null; lesson: string; polarity: number; tags: string[]; updatedAt: Date };

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** Share of the case's signals that equal the current ones (0..1). A case with no signals scores 0. */
export function caseSimilarity(caseSignals: unknown, current: unknown): number {
  const want = asRecord(caseSignals);
  const have = asRecord(current);
  const keys = Object.keys(want);
  if (keys.length === 0) return 0;
  const hits = keys.filter((key) => key in have && JSON.stringify(have[key]) === JSON.stringify(want[key])).length;
  return hits / keys.length;
}

export function rankCases(cases: CaseRow[], current: unknown, options: { move?: string; limit?: number } = {}) {
  return cases
    .filter((row) => !options.move || row.move === options.move)
    .map((row) => ({ row, similarity: caseSimilarity(row.signals, current) }))
    .sort((a, b) => b.similarity - a.similarity || b.row.updatedAt.getTime() - a.row.updatedAt.getTime())
    .slice(0, options.limit ?? 5)
    .map(({ row, similarity }) => ({
      key: row.key, title: row.title, situation: row.situation, move: row.move, clientPhrase: row.clientPhrase,
      lesson: row.lesson, outcome: row.polarity > 0 ? "worked" : row.polarity < 0 ? "avoid" : "neutral", tags: row.tags,
      similarity: Math.round(similarity * 100) / 100,
    }));
}
