import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DateSchema, IdSchema } from "../packages/shapes/src/index.js";

export type TimelineWarning = { code: string; message: string; path?: string };
export type ResolvedMilestone = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  weekOffset?: number;
  weeksLow?: number | null;
  weeksHigh?: number | null;
  hoursLow?: number | null;
  hoursHigh?: number | null;
  gate?: string;
  actualStart?: string | null;
  actualEnd?: string | null;
};

const optionalWeeks = z.number().int().min(1).max(104).nullable().optional();
const optionalHours = z.number().int().min(0).max(100_000).nullable().optional();

/** endsWeekLow and endsWeekHigh are computed on read. A write that echoes the document drops them; every other extra key still fails. */
function dropComputedEndWeeks(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { endsWeekLow: _endsWeekLow, endsWeekHigh: _endsWeekHigh, ...rest } = value as Record<string, unknown>;
  return rest;
}

export const TimelineMilestoneInputSchema = z.preprocess(dropComputedEndWeeks, z.object({
  id: IdSchema.optional(),
  title: z.string().min(1),
  description: z.string().default(""),
  dueDate: DateSchema.nullable().optional(),
  weekOffset: z.number().int().min(0).max(520).optional(),
  weeksLow: optionalWeeks,
  weeksHigh: optionalWeeks,
  hoursLow: optionalHours,
  hoursHigh: optionalHours,
  gate: z.string().max(500).optional(),
  actualStart: DateSchema.nullable().optional(),
  actualEnd: DateSchema.nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.dueDate === undefined && value.weekOffset === undefined && value.weeksLow == null && value.weeksHigh == null) {
    ctx.addIssue({ code: "custom", message: "Each milestone needs a dueDate, a weekOffset, or a week estimate." });
  }
  if (typeof value.weeksLow === "number" && typeof value.weeksHigh === "number" && value.weeksHigh < value.weeksLow) {
    ctx.addIssue({ code: "custom", message: "weeksHigh must be at least weeksLow.", path: ["weeksHigh"] });
  }
  if (typeof value.hoursLow === "number" && typeof value.hoursHigh === "number" && value.hoursHigh < value.hoursLow) {
    ctx.addIssue({ code: "custom", message: "hoursHigh must be at least hoursLow.", path: ["hoursHigh"] });
  }
  if (value.actualStart && value.actualEnd && value.actualEnd < value.actualStart) {
    ctx.addIssue({ code: "custom", message: "actualEnd must be on or after actualStart.", path: ["actualEnd"] });
  }
}));

export const TimelineWriteSchema = z.object({
  startDate: DateSchema.nullable().optional(),
  targetDate: DateSchema.nullable().optional(),
  milestones: z.array(TimelineMilestoneInputSchema).optional(),
}).strict();

const estimateBound = {
  hoursLow: z.number().int().min(0).max(100_000),
  hoursHigh: z.number().int().min(0).max(100_000),
  weeksLow: z.number().int().min(1).max(520),
  weeksHigh: z.number().int().min(1).max(520),
};

export const PhaseEstimateSchema = z.object({
  phases: z.array(z.object({
    milestoneId: IdSchema,
    hoursLow: estimateBound.hoursLow.optional(),
    hoursHigh: estimateBound.hoursHigh.max(100_000).optional(),
    weeksLow: z.number().int().min(1).max(104).optional(),
    weeksHigh: z.number().int().min(1).max(104).optional(),
  }).strict()).min(1),
  total: z.object(estimateBound).strict().optional(),
}).strict().superRefine((value, ctx) => {
  const bounds = value.total;
  if (bounds) {
    if (bounds.hoursHigh < bounds.hoursLow) ctx.addIssue({ code: "custom", message: "hoursHigh must be at least hoursLow.", path: ["total", "hoursHigh"] });
    if (bounds.weeksHigh < bounds.weeksLow) ctx.addIssue({ code: "custom", message: "weeksHigh must be at least weeksLow.", path: ["total", "weeksHigh"] });
    if (bounds.weeksLow < value.phases.length) ctx.addIssue({ code: "custom", message: "The week range is shorter than one week on each phase.", path: ["total", "weeksLow"] });
    return;
  }
  value.phases.forEach((phase, index) => {
    if (phase.hoursLow === undefined || phase.hoursHigh === undefined || phase.weeksLow === undefined || phase.weeksHigh === undefined) {
      ctx.addIssue({ code: "custom", message: "Each phase needs hoursLow, hoursHigh, weeksLow, and weeksHigh, or pass total once for the whole engagement.", path: ["phases", index] });
      return;
    }
    if (phase.hoursHigh < phase.hoursLow) ctx.addIssue({ code: "custom", message: "hoursHigh must be at least hoursLow.", path: ["phases", index, "hoursHigh"] });
    if (phase.weeksHigh < phase.weeksLow) ctx.addIssue({ code: "custom", message: "weeksHigh must be at least weeksLow.", path: ["phases", index, "weeksHigh"] });
  });
});

/** Splits one engagement range across phases so the phase values add up to the total. Remainder goes on the later phases. */
export function splitEngagementRange(total: { hoursLow: number; hoursHigh: number; weeksLow: number; weeksHigh: number }, count: number) {
  if (count < 1) throw new Error("At least one phase is required.");
  if (total.weeksLow < count || total.weeksHigh < count) throw new Error("The week range is shorter than one week on each phase.");
  const hoursLow = spread(total.hoursLow, count, 0);
  const hoursHigh = spread(total.hoursHigh, count, 0);
  const weeksLow = spread(total.weeksLow, count, 1);
  const weeksHigh = spread(total.weeksHigh, count, 1);
  return hoursLow.map((low, index) => ({
    hoursLow: low,
    hoursHigh: Math.max(hoursHigh[index] ?? low, low),
    weeksLow: weeksLow[index] ?? 1,
    weeksHigh: Math.max(weeksHigh[index] ?? 1, weeksLow[index] ?? 1),
  }));
}

function spread(total: number, count: number, minEach: number) {
  const base = Math.floor(total / count);
  const extra = total - base * count;
  const values = Array.from({ length: count }, () => base);
  for (let index = count - extra; index < count; index += 1) values[index] = (values[index] ?? 0) + 1;
  if (values.some((value) => value < minEach)) throw new Error("The range cannot put the minimum on every phase.");
  return values;
}

export const TimelineCreateSchema = z.object({
  startDate: DateSchema.nullable().default(null),
  targetDate: DateSchema.nullable().default(null),
  milestones: z.array(TimelineMilestoneInputSchema).default([]),
}).strict();

export function addWeeksToDate(date: string, weeks: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.valueOf())) throw new Error(`Invalid date: ${date}`);
  value.setUTCDate(value.getUTCDate() + weeks * 7);
  return value.toISOString().slice(0, 10);
}

function phaseFields(milestone: {
  weeksLow?: number | null;
  weeksHigh?: number | null;
  hoursLow?: number | null;
  hoursHigh?: number | null;
  gate?: string;
  actualStart?: string | null;
  actualEnd?: string | null;
}): Pick<ResolvedMilestone, "weeksLow" | "weeksHigh" | "hoursLow" | "hoursHigh" | "gate" | "actualStart" | "actualEnd"> {
  return {
    weeksLow: milestone.weeksLow ?? null,
    weeksHigh: milestone.weeksHigh ?? null,
    hoursLow: milestone.hoursLow,
    hoursHigh: milestone.hoursHigh,
    gate: milestone.gate ?? "",
    actualStart: milestone.actualStart === undefined ? null : milestone.actualStart,
    actualEnd: milestone.actualEnd === undefined ? null : milestone.actualEnd,
  };
}

export function resolveTimelineMilestones(
  milestones: Array<{
    id?: string;
    title: string;
    description?: string;
    dueDate?: string | null;
    weekOffset?: number;
    weeksLow?: number | null;
    weeksHigh?: number | null;
    hoursLow?: number | null;
    hoursHigh?: number | null;
    gate?: string;
    actualStart?: string | null;
    actualEnd?: string | null;
  }>,
  startDate: string | null,
): { milestones: ResolvedMilestone[]; warnings: TimelineWarning[] } {
  const warnings: TimelineWarning[] = [];
  const resolved = milestones.map((milestone, index) => {
    const path = `timeline.milestones.${index}`;
    let dueDate = milestone.dueDate === undefined ? null : milestone.dueDate;
    if (milestone.weekOffset !== undefined) {
      if (startDate) {
        const computed = addWeeksToDate(startDate, milestone.weekOffset);
        if (dueDate && dueDate !== computed) {
          warnings.push({
            code: "MILESTONE_DATE_MISMATCH",
            message: `Milestone "${milestone.title}" has due date ${dueDate} and week offset ${milestone.weekOffset} (which is ${computed} from the start date). The due date was kept.`,
            path,
          });
        } else if (!dueDate) {
          dueDate = computed;
        }
      } else if (!dueDate) {
        warnings.push({
          code: "MILESTONE_WEEK_OFFSET_UNRESOLVED",
          message: `Milestone "${milestone.title}" has a week offset but no start date, so it was saved without a due date.`,
          path,
        });
      }
    }
    return {
      id: milestone.id ?? randomUUID(),
      title: milestone.title,
      description: milestone.description ?? "",
      dueDate,
      ...(milestone.weekOffset !== undefined ? { weekOffset: milestone.weekOffset } : {}),
      ...phaseFields(milestone),
    };
  });
  return { milestones: resolved, warnings };
}

/** Warnings for dates that cannot happen: a target or milestone before the start, or a milestone after the target. */
export function timelineDateWarnings(startDate: string | null, targetDate: string | null, milestones: ReadonlyArray<{ title: string; dueDate: string | null }>): TimelineWarning[] {
  const warnings: TimelineWarning[] = [];
  if (startDate && targetDate && targetDate < startDate) {
    warnings.push({ code: "TIMELINE_TARGET_BEFORE_START", message: `The target date ${targetDate} is before the start date ${startDate}.`, path: "timeline.targetDate" });
  }
  milestones.forEach((milestone, index) => {
    if (!milestone.dueDate) return;
    const path = `timeline.milestones.${index}.dueDate`;
    if (startDate && milestone.dueDate < startDate) {
      warnings.push({ code: "MILESTONE_BEFORE_START", message: `Milestone "${milestone.title}" is due ${milestone.dueDate}, before the start date ${startDate}.`, path });
    }
    if (targetDate && milestone.dueDate > targetDate && !(startDate && targetDate < startDate)) {
      warnings.push({ code: "MILESTONE_AFTER_TARGET", message: `Milestone "${milestone.title}" is due ${milestone.dueDate}, after the target date ${targetDate}.`, path });
    }
  });
  return warnings;
}

type StoredMilestone = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  dueDate?: unknown;
  weekOffset?: unknown;
  weeksLow?: unknown;
  weeksHigh?: unknown;
  hoursLow?: unknown;
  hoursHigh?: unknown;
  gate?: unknown;
  actualStart?: unknown;
  actualEnd?: unknown;
};
const storedMilestones = (value: unknown): StoredMilestone[] => Array.isArray(value) ? value.filter((item): item is StoredMilestone => !!item && typeof item === "object") : [];
const storedDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
const storedWeeks = (value: unknown) => typeof value === "number" && Number.isInteger(value) ? value : null;

function resolvedFromStored(item: StoredMilestone): ResolvedMilestone {
  const weekOffset = typeof item.weekOffset === "number" ? item.weekOffset : undefined;
  return {
    id: typeof item.id === "string" ? item.id : randomUUID(),
    title: String(item.title ?? ""),
    description: String(item.description ?? ""),
    dueDate: storedDate(item.dueDate),
    ...(weekOffset !== undefined ? { weekOffset } : {}),
    weeksLow: storedWeeks(item.weeksLow),
    weeksHigh: storedWeeks(item.weeksHigh),
    hoursLow: storedWeeks(item.hoursLow),
    hoursHigh: storedWeeks(item.hoursHigh),
    gate: typeof item.gate === "string" ? item.gate : "",
    actualStart: storedDate(item.actualStart),
    actualEnd: storedDate(item.actualEnd),
  };
}

/**
 * Keeps milestone ids stable across saves. A caller id is kept when it already belongs to this proposal or is unused;
 * a milestone sent without an id reuses the id of the existing milestone with the same title. Anything else gets a new id.
 */
export function assignMilestoneIds(milestones: ResolvedMilestone[], suppliedIds: ReadonlyArray<string | undefined>, existing: ReadonlyArray<{ id: string; title: string }>, takenElsewhere: ReadonlySet<string>): { milestones: ResolvedMilestone[]; warnings: TimelineWarning[] } {
  const warnings: TimelineWarning[] = [];
  const used = new Set<string>();
  const own = new Set(existing.map((item) => item.id));
  const byTitle = new Map<string, string[]>();
  for (const item of existing) byTitle.set(item.title, [...(byTitle.get(item.title) ?? []), item.id]);
  const result = milestones.map((milestone, index) => {
    const supplied = suppliedIds[index];
    if (supplied) {
      if (!used.has(supplied) && (own.has(supplied) || !takenElsewhere.has(supplied))) { used.add(supplied); return { ...milestone, id: supplied }; }
      warnings.push({ code: "MILESTONE_ID_REPLACED", message: `Milestone "${milestone.title}" id ${supplied} is already used, so it was given a new id.`, path: `timeline.milestones.${index}.id` });
    } else {
      const match = (byTitle.get(milestone.title) ?? []).find((id) => !used.has(id) && !suppliedIds.includes(id));
      if (match) { used.add(match); return { ...milestone, id: match }; }
    }
    let id = milestone.id;
    while (used.has(id) || (supplied !== undefined && id === supplied) || takenElsewhere.has(id)) id = randomUUID();
    used.add(id);
    return { ...milestone, id };
  });
  return { milestones: result, warnings };
}

type MilestoneStore = { timelineMilestone: { findMany(args: { where: { id: { in: string[] } }; select: { id: true; proposalId: true } }): Promise<Array<{ id: string; proposalId: string }>> } };
export type TimelineInput = {
  startDate?: string | null;
  targetDate?: string | null;
  milestones?: Array<{
    id?: string;
    title: string;
    description?: string;
    dueDate?: string | null;
    weekOffset?: number;
    weeksLow?: number | null;
    weeksHigh?: number | null;
    hoursLow?: number | null;
    hoursHigh?: number | null;
    gate?: string;
    actualStart?: string | null;
    actualEnd?: string | null;
  }>;
};

/**
 * Plans one timeline write. Returns the timeline JSON to store, the milestone rows to write (null when the table is unchanged),
 * and warnings. Milestones keep their ids and weekOffset; when only the start date changes, offset-based due dates are recomputed.
 */
export async function planTimelineWrite(db: MilestoneStore, proposalId: string | null, previous: Record<string, unknown>, existing: ReadonlyArray<{ id: string; title: string }>, input: TimelineInput) {
  const previousStart = storedDate(previous.startDate);
  const startDate = input.startDate !== undefined ? input.startDate : previousStart;
  const targetDate = input.targetDate !== undefined ? input.targetDate : storedDate(previous.targetDate);
  const warnings: TimelineWarning[] = [];
  let rows: ResolvedMilestone[] | null = null;
  if (input.milestones) {
    const resolved = resolveTimelineMilestones(input.milestones, startDate);
    warnings.push(...resolved.warnings);
    const supplied = input.milestones.map((item) => item.id);
    const requested = supplied.filter((id): id is string => typeof id === "string");
    const found = requested.length ? await db.timelineMilestone.findMany({ where: { id: { in: requested } }, select: { id: true, proposalId: true } }) : [];
    const takenElsewhere = new Set(found.filter((row) => row.proposalId !== proposalId).map((row) => row.id));
    const assigned = assignMilestoneIds(resolved.milestones, supplied, existing, takenElsewhere);
    warnings.push(...assigned.warnings);
    const previousById = new Map(storedMilestones(previous.milestones).map((item) => [typeof item.id === "string" ? item.id : "", item]));
    rows = assigned.milestones.map((row) => {
      const previousRow = previousById.get(row.id);
      return {
        ...row,
        hoursLow: row.hoursLow !== undefined ? row.hoursLow : storedWeeks(previousRow?.hoursLow),
        hoursHigh: row.hoursHigh !== undefined ? row.hoursHigh : storedWeeks(previousRow?.hoursHigh),
      };
    });
  } else if (startDate !== previousStart) {
    const stored = storedMilestones(previous.milestones);
    const offsets = stored.filter((item) => typeof item.weekOffset === "number");
    if (offsets.length) {
      rows = stored.map((item) => {
        const weekOffset = typeof item.weekOffset === "number" ? item.weekOffset : undefined;
        const due = storedDate(item.dueDate);
        const derived = weekOffset !== undefined && (!due || (previousStart !== null && due === addWeeksToDate(previousStart, weekOffset)));
        return {
          ...resolvedFromStored(item),
          dueDate: derived && weekOffset !== undefined ? (startDate ? addWeeksToDate(startDate, weekOffset) : null) : due,
        };
      });
      if (!startDate) warnings.push(...rows.filter((row) => row.weekOffset !== undefined).map((row) => ({ code: "MILESTONE_WEEK_OFFSET_UNRESOLVED", message: `Milestone "${row.title}" has a week offset but no start date, so it was saved without a due date.` })));
    }
  }
  const milestones = rows ?? storedMilestones(previous.milestones);
  const datesForCheck = rows ?? milestones.map((item) => ({ title: String(item.title ?? ""), dueDate: storedDate(item.dueDate) }));
  warnings.push(...timelineDateWarnings(startDate ?? null, targetDate ?? null, datesForCheck));
  return { timeline: { ...previous, startDate: startDate ?? null, targetDate: targetDate ?? null, milestones }, rows, warnings };
}

/** weekOffset by milestone id from the stored timeline JSON, so reads can return it next to the table row. */
export function weekOffsetsById(timeline: unknown): Map<string, number> {
  const map = new Map<string, number>();
  const record = timeline && typeof timeline === "object" && !Array.isArray(timeline) ? timeline as Record<string, unknown> : {};
  for (const item of storedMilestones(record.milestones)) if (typeof item.id === "string" && typeof item.weekOffset === "number") map.set(item.id, item.weekOffset);
  return map;
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return storedDate(value);
  return value.toISOString().slice(0, 10);
}

export function milestoneTableRow(milestone: ResolvedMilestone & { id?: string }) {
  return {
    ...(milestone.id ? { id: milestone.id } : {}),
    title: milestone.title,
    description: milestone.description,
    dueDate: milestone.dueDate ? new Date(`${milestone.dueDate}T00:00:00.000Z`) : null,
    weeksLow: milestone.weeksLow ?? null,
    weeksHigh: milestone.weeksHigh ?? null,
    hoursLow: milestone.hoursLow ?? null,
    hoursHigh: milestone.hoursHigh ?? null,
    gate: milestone.gate ?? "",
    actualStart: milestone.actualStart ? new Date(`${milestone.actualStart}T00:00:00.000Z`) : null,
    actualEnd: milestone.actualEnd ? new Date(`${milestone.actualEnd}T00:00:00.000Z`) : null,
  };
}

export type MilestoneView = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  weekOffset?: number;
  weeksLow: number | null;
  weeksHigh: number | null;
  hoursLow: number | null;
  hoursHigh: number | null;
  endsWeekLow: number | null;
  endsWeekHigh: number | null;
  gate: string;
  actualStart: string | null;
  actualEnd: string | null;
};

export function withEndWeeks<T extends { weeksLow?: number | null; weeksHigh?: number | null }>(rows: readonly T[]): Array<T & { endsWeekLow: number | null; endsWeekHigh: number | null }> {
  let low = 0;
  let high = 0;
  let hasLow = false;
  let hasHigh = false;
  return rows.map((row) => {
    if (typeof row.weeksLow === "number") { low += row.weeksLow; hasLow = true; }
    if (typeof row.weeksHigh === "number") { high += row.weeksHigh; hasHigh = true; }
    return { ...row, endsWeekLow: hasLow && typeof row.weeksLow === "number" ? low : null, endsWeekHigh: hasHigh && typeof row.weeksHigh === "number" ? high : null };
  });
}

type MilestoneRow = {
  id: string;
  title: string;
  description: string;
  dueDate: Date | null;
  weeksLow?: number | null;
  weeksHigh?: number | null;
  hoursLow?: number | null;
  hoursHigh?: number | null;
  gate?: string | null;
  actualStart?: Date | null;
  actualEnd?: Date | null;
};

/** Milestone rows for a proposal document, in the stored timeline order, with weekOffset when one was saved. */
export function milestoneViews(rows: ReadonlyArray<MilestoneRow>, timeline: unknown): MilestoneView[] {
  const offsets = weekOffsetsById(timeline);
  const record = timeline && typeof timeline === "object" && !Array.isArray(timeline) ? timeline as Record<string, unknown> : {};
  const order = new Map(storedMilestones(record.milestones).map((item, index) => [typeof item.id === "string" ? item.id : "", index] as const));
  const ordered = [...rows]
    .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) || (a.dueDate?.valueOf() ?? Infinity) - (b.dueDate?.valueOf() ?? Infinity))
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      dueDate: isoDate(row.dueDate),
      ...(offsets.has(row.id) ? { weekOffset: offsets.get(row.id)! } : {}),
      weeksLow: row.weeksLow ?? null,
      weeksHigh: row.weeksHigh ?? null,
      hoursLow: row.hoursLow ?? null,
      hoursHigh: row.hoursHigh ?? null,
      gate: row.gate ?? "",
      actualStart: isoDate(row.actualStart),
      actualEnd: isoDate(row.actualEnd),
    }));
  return withEndWeeks(ordered);
}
