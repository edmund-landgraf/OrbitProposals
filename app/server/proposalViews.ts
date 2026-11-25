export type ViewRow = { sectionKey: string | null; viewerId: string };

/** Counts openings of the proposal and of each part. */
export function summarizeViews(rows: readonly ViewRow[]) {
  const viewers = new Set<string>();
  const bySection = new Map<string, number>();
  for (const row of rows) {
    viewers.add(row.viewerId);
    const section = row.sectionKey ?? "(proposal)";
    bySection.set(section, (bySection.get(section) ?? 0) + 1);
  }
  return {
    views: rows.length,
    viewers: viewers.size,
    sections: [...bySection.entries()].map(([section, count]) => ({ section, count })).sort((a, b) => b.count - a.count || a.section.localeCompare(b.section)),
  };
}
