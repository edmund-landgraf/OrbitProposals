export type ApprovalStep = { id: string; sortOrder: number; label: string; decided: boolean };

/** Steps still waiting, in chain order. An empty chain means the existing single approval stands. */
export function remainingApprovals(steps: readonly ApprovalStep[]) {
  return [...steps].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)).filter((step) => !step.decided);
}
