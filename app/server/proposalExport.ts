import type { PrismaClient } from "@prisma/client";

/** Formats unw_export_proposal / GET /proposals/:id/export can return. */
export const EXPORT_FORMATS = ["json", "markdown", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportNarrative = { key: string; title: string; clientLabel: string; state: string; text: string | null };
export type ExportParked = { kind: "item" | "change"; summary: string; nodeKey: string | null; mode: string | null; swapSummary: string | null };
export type ExportDocument = {
  id: string; title: string; engagement: string; status: string;
  scope: { summary: string; deliverables: string[]; assumptions: string[]; exclusions: string[] };
  timeline: { startDate: string | null; targetDate: string | null; milestones: Array<{ title: string; description: string; dueDate: string | null; weekOffset?: number; weeksLow?: number | null; weeksHigh?: number | null; endsWeekLow?: number | null; endsWeekHigh?: number | null; gate?: string }> };
  pricing: Record<string, unknown>;
  options: Array<{ id: string; label: string; description: string; priceDelta: { amountMinor: number; currency: string }; selected: boolean; selection?: string; groupName?: string | null }>;
};

export function parseExportFormat(value: unknown): ExportFormat | null {
  if (value === undefined || value === null || value === "") return "json";
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "md") return "markdown";
  return (EXPORT_FORMATS as readonly string[]).includes(normalized) ? normalized as ExportFormat : null;
}

/** Narrative sections (parts with a section spec) and parked work for an export. */
export async function exportExtras(prisma: PrismaClient, proposalId: string): Promise<{ narrative: ExportNarrative[]; parked: ExportParked[] }> {
  const [specs, nodes, items, changes] = await Promise.all([
    prisma.proposalSectionSpec.findMany({ select: { nodeKey: true } }),
    prisma.proposalNode.findMany({ where: { proposalId }, orderBy: [{ sortOrder: "asc" }, { key: "asc" }], select: { key: true, title: true, clientLabel: true, stateCode: true, body: true } }),
    prisma.proposalIntakePark.findMany({ where: { proposalId }, orderBy: { createdAt: "asc" } }),
    prisma.proposalParkedChange.findMany({ where: { proposalId }, orderBy: { createdAt: "asc" } }),
  ]);
  const specKeys = new Set(specs.map((spec) => spec.nodeKey));
  const narrative = nodes.filter((node) => specKeys.has(node.key)).map((node) => {
    const body = node.body && typeof node.body === "object" && !Array.isArray(node.body) ? node.body as Record<string, unknown> : {};
    return { key: node.key, title: node.title, clientLabel: node.clientLabel, state: node.stateCode, text: typeof body.text === "string" ? body.text : null };
  });
  const parked: ExportParked[] = [
    ...items.map((item) => ({ kind: "item" as const, summary: item.summary, nodeKey: null, mode: null, swapSummary: null })),
    ...changes.map((change) => ({ kind: "change" as const, summary: change.summary, nodeKey: change.nodeKey, mode: change.mode, swapSummary: change.swapSummary })),
  ];
  return { narrative, parked };
}

const money = (amountMinor: number, currency: string) => (amountMinor / 100).toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 });

function priceLine(pricing: Record<string, unknown>): string {
  const currency = typeof pricing.currency === "string" ? pricing.currency : "USD";
  if (pricing.pendingStaffPrice === true) return `${String(pricing.model ?? "")}: waiting for staff to price it`;
  if (typeof pricing.rateMinor === "number") return `${money(pricing.rateMinor, currency)}/hr`;
  if (typeof pricing.amountMinor === "number") return `${money(pricing.amountMinor, currency)}${typeof pricing.hours === "number" ? ` for ${pricing.hours} hours` : ""} (${String(pricing.model ?? "")})`;
  return String(pricing.model ?? "not set");
}

const list = (items: readonly string[]) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";

/** Markdown copy of a proposal: scope, schedule, price, options, narrative sections, and parked items. */
export function proposalMarkdown(document: ExportDocument, extras: { narrative: ExportNarrative[]; parked: ExportParked[] }, portalUrl: string): string {
  const lines: string[] = [`# ${document.title}`, "", `Status: ${document.status} · Engagement: ${document.engagement}`, `Portal: ${portalUrl}`, ""];
  const written = extras.narrative.filter((section) => section.text);
  for (const section of written) lines.push(`## ${section.clientLabel || section.title}`, "", section.text!, "");
  lines.push("## Scope", "", document.scope.summary, "", "### Deliverables", "", list(document.scope.deliverables), "", "### Assumptions", "", list(document.scope.assumptions), "", "### Exclusions", "", list(document.scope.exclusions), "");
  lines.push("## Schedule", "", `Start: ${document.timeline.startDate ?? "not set"} · Target: ${document.timeline.targetDate ?? "not set"}`, "");
  if (document.timeline.milestones.length) {
    lines.push("| Phase | Low | High | Ends | Gate | Due |", "| --- | --- | --- | --- | --- | --- |");
    for (const milestone of document.timeline.milestones) {
      const due = milestone.dueDate ?? (milestone.weekOffset !== undefined ? `week ${milestone.weekOffset}` : "not set");
      lines.push(`| ${milestone.title.replace(/\|/g, "\\|")} | ${milestone.weeksLow ?? ""} | ${milestone.weeksHigh ?? ""} | ${milestone.endsWeekLow ?? ""}${milestone.endsWeekHigh != null && milestone.endsWeekHigh !== milestone.endsWeekLow ? ` / ${milestone.endsWeekHigh}` : ""} | ${(milestone.gate ?? "").replace(/\|/g, "\\|")} | ${due} |`);
    }
    lines.push("");
  }
  lines.push("## Price", "", priceLine(document.pricing), "");
  if (document.options.length) {
    lines.push("## Options", "");
    for (const option of document.options) lines.push(`- [${option.selected ? "x" : " "}] ${option.label} (${option.priceDelta.amountMinor >= 0 ? "+" : ""}${money(option.priceDelta.amountMinor, option.priceDelta.currency)})${option.groupName ? ` · ${option.groupName}` : ""}${option.description ? `: ${option.description}` : ""}`);
    lines.push("");
  }
  if (extras.parked.length) {
    lines.push("## Saved for later", "");
    for (const item of extras.parked) lines.push(`- ${item.summary}${item.kind === "change" ? ` (${item.mode}${item.nodeKey ? ` on ${item.nodeKey}` : ""}${item.swapSummary ? `; swap: ${item.swapSummary}` : ""})` : ""}`);
    lines.push("");
  }
  const unwritten = extras.narrative.filter((section) => !section.text).map((section) => section.clientLabel || section.title);
  if (unwritten.length) lines.push(`_Not written yet: ${unwritten.join(", ")}._`, "");
  return lines.join("\n");
}
