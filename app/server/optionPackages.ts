export type OptionChoice = {
  id: string;
  selection: string;
  groupId: string | null;
  priceDeltaMinor: number;
  selected: boolean;
};

export type OptionGroupChoice = { id: string; mode: string };

export class OptionPackageError extends Error {
  constructor(message: string) { super(message); this.name = "OptionPackageError"; }
}

/** Required lines stay selected. A single-select group keeps one line. */
export function applyOptionSelection(options: OptionChoice[], groups: OptionGroupChoice[], selectedIds: readonly string[]): OptionChoice[] {
  const chosen = new Set(selectedIds);
  for (const option of options) {
    if (option.selection === "required") chosen.add(option.id);
  }
  for (const group of groups) {
    if (group.mode !== "single") continue;
    const members = options.filter((option) => option.groupId === group.id);
    const picked = members.filter((option) => chosen.has(option.id));
    if (picked.length > 1) {
      const required = picked.find((option) => option.selection === "required");
      const keep = required?.id ?? [...selectedIds].reverse().find((id) => picked.some((option) => option.id === id));
      for (const member of members) {
        if (member.id !== keep) chosen.delete(member.id);
      }
    }
    if (![...chosen].some((id) => members.some((option) => option.id === id))) {
      const fallback = members.find((option) => option.selection === "preselected" || option.selection === "required") ?? members[0];
      if (fallback) chosen.add(fallback.id);
    }
  }
  return options.map((option) => ({ ...option, selected: chosen.has(option.id) }));
}

export function totalWithOptions(baseMinor: number, options: readonly OptionChoice[]): number {
  return baseMinor + options.reduce((sum, option) => sum + (option.selected ? option.priceDeltaMinor : 0), 0);
}
