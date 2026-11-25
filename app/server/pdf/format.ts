import { escapeHtml } from "./escape.js";

// Small words stay lowercase inside a title ("Problem and Background"), never at the start.
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "per", "the", "to", "via", "vs", "with"]);

/** "success metrics" / "systems_and_integrations" -> "Success Metrics" / "Systems and Integrations". Words that already carry capitals (ARR, NetSuite) are kept. */
export function titleCase(value: string): string {
  const words = value.replaceAll("_", " ").replace(/\s+/g, " ").trim().split(" ");
  return words
    .map((word, index) => {
      if (!word) return word;
      if (word !== word.toLowerCase()) return word;
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** "fixed_price" -> "Fixed price"; "pending_approval" -> "Pending approval". */
export function sentenceCase(value: string): string {
  const text = value.replaceAll("_", " ").replace(/\s+/g, " ").trim();
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A git sha becomes its 7-character short form; anything else (e.g. "unknown") is returned unchanged. */
export function shortBuild(build: string | null | undefined): string {
  const value = (build ?? "").trim();
  if (!value) return "unknown";
  return /^[0-9a-f]{8,40}$/i.test(value) ? value.slice(0, 7) : value;
}

/** ISO timestamps or YYYY-MM-DD become "Nov 16, 2026" (Pacific time); other strings pass through. */
export function humanDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  const date = new Date(dateOnly ? `${text}T12:00:00Z` : text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: dateOnly ? "UTC" : "America/Los_Angeles" });
}

/** True when a narrative body is missing, blank, or a "Not provided." placeholder. */
export function isEmptyNarrative(text: string | null | undefined): boolean {
  if (typeof text !== "string") return true;
  const trimmed = text.trim();
  return !trimmed || /^(not provided|n\/a|none|tbd)\.?$/i.test(trimmed);
}

function inline(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+?)`/g, '<code class="mono">$1</code>');
  html = html.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  return html;
}

// A short label sentence that opens a paragraph, e.g. "Access needed." or "Salesforce to Databricks.".
const RUN_IN = /^([A-Z][^.!?:\n]{0,48}?[.:])\s+(?=\S)/;
function runInLabel(text: string): { label: string; rest: string } | null {
  if (/^\*\*/.test(text)) return null;
  const match = RUN_IN.exec(text);
  if (!match) return null;
  const label = match[1];
  if (label.split(/\s+/).length > 6) return null;
  return { label, rest: text.slice(match[0].length) };
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[]; start: number };

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
      continue;
    }
    if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] });
      continue;
    }
    if (bullet) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
      continue;
    }
    if (numbered) {
      flush();
      const last = blocks[blocks.length - 1];
      // Numbered items separated by blank lines still form one list.
      if (last?.kind === "ol") last.items.push(numbered[2]);
      else blocks.push({ kind: "ol", items: [numbered[2]], start: Number(numbered[1]) || 1 });
      continue;
    }
    const last = blocks[blocks.length - 1];
    // An indented continuation line belongs to the previous list item.
    if (!para.length && /^\s{2,}\S/.test(raw) && (last?.kind === "ul" || last?.kind === "ol")) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

/**
 * Renders the small markdown subset proposal narratives use (paragraphs, "- " and "1." lists, ### headings, **bold**, *italic*, `code`).
 * Everything is HTML-escaped first, so raw HTML in a section body prints as text and never becomes markup.
 * When two or more paragraphs or items open with a short label sentence ("Access needed."), those labels are bolded as run-in heads.
 */
export function renderMarkdown(source: string | null | undefined): string {
  if (isEmptyNarrative(source)) return "";
  const blocks = parseBlocks(source as string);
  const candidates = blocks.flatMap((block) => (block.kind === "p" ? [block.text] : block.kind === "ul" || block.kind === "ol" ? block.items : []));
  const useRunIns = candidates.filter((text) => runInLabel(text)).length >= 2;
  const text = (value: string) => {
    const run = useRunIns ? runInLabel(value) : null;
    const body = (part: string) => part.split("\n").map(inline).join("<br />");
    return run ? `<strong class="runIn">${inline(run.label)}</strong> ${body(run.rest)}` : body(value);
  };
  return blocks
    .map((block) => {
      if (block.kind === "h") return `<h5>${inline(block.text)}</h5>`;
      if (block.kind === "ul") return `<ul>${block.items.map((item) => `<li>${text(item)}</li>`).join("")}</ul>`;
      if (block.kind === "ol") return `<ol${block.start !== 1 ? ` start="${block.start}"` : ""}>${block.items.map((item) => `<li>${text(item)}</li>`).join("")}</ol>`;
      return `<p>${text(block.text)}</p>`;
    })
    .join("");
}

/** Plain text from narrative markdown: markers removed, whitespace collapsed. */
export function plainText(source: string | null | undefined): string {
  if (isEmptyNarrative(source)) return "";
  return (source as string)
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first `count` sentences of the first paragraph, for the cover's "In brief". */
export function leadSentences(source: string | null | undefined, count = 2): string {
  if (isEmptyNarrative(source)) return "";
  const firstParagraph = (source as string).replace(/\r\n?/g, "\n").split(/\n\s*\n/).find((part) => part.trim()) ?? "";
  const text = plainText(firstParagraph);
  // Split at whitespace after sentence punctuation when the next sentence starts with a capital or digit.
  const sentences = text.split(/(?<=[.!?]["”’)]*)\s+(?=["“(]?[A-Z0-9])/).map((part) => part.trim()).filter(Boolean);
  // Avoid splitting after abbreviations such as "e.g." or "Inc." by joining the next fragment back on.
  const merged: string[] = [];
  for (const sentence of sentences) {
    if (merged.length && /(?:\b(?:e\.g|i\.e|etc|vs|Inc|Ltd|Co|Corp|Mr|Ms|Dr|No)\.|\b[A-Za-z]\.)$/.test(merged[merged.length - 1])) merged[merged.length - 1] += ` ${sentence}`;
    else merged.push(sentence);
  }
  return merged.slice(0, count).join(" ");
}

export type MilestoneInput = {
  title: string;
  dueDate: string | null;
  description: string;
  weeksLow?: number | null;
  weeksHigh?: number | null;
  endsWeekLow?: number | null;
  endsWeekHigh?: number | null;
  gate?: string;
  actualStart?: string | null;
  actualEnd?: string | null;
};

export type TimelineRow = { phase: string; detail: string; duration: string; ends: string; gate: string; due: string };

const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function range(low: number | null, high: number | null): string {
  if (low === null && high === null) return "";
  if (low === null || high === null || low === high) return String(low ?? high);
  return `${low}–${high}`;
}

/**
 * One table row per milestone. Structured fields win; when a phase only carries
 * "Low estimate: 1 week. High estimate: 2 weeks (ends week 5). Gate: …" in its description,
 * those values are lifted into columns and the remaining text stays under the phase name.
 */
export function timelineRows(milestones: MilestoneInput[]): TimelineRow[] {
  const rows = milestones.map((m) => {
    let detail = m.description ?? "";
    const take = (pattern: RegExp) => {
      const match = pattern.exec(detail);
      if (match) detail = (detail.slice(0, match.index) + " " + detail.slice(match.index + match[0].length)).trim();
      return match;
    };
    const lowMatch = take(/Low estimate:\s*(\d+(?:\.\d+)?)\s*weeks?(?:\s*\(ends week\s*(\d+)\))?\.?/i);
    const highMatch = take(/High estimate:\s*(\d+(?:\.\d+)?)\s*weeks?(?:\s*\(ends week\s*(\d+)\))?\.?/i);
    const gateMatch = take(/Gate:\s*([\s\S]+?)(?=\s*(?:Low estimate:|High estimate:)|$)/i);
    const weeksLow = num(m.weeksLow) ?? (lowMatch ? Number(lowMatch[1]) : null);
    const weeksHigh = num(m.weeksHigh) ?? (highMatch ? Number(highMatch[1]) : null);
    const endsLow = num(m.endsWeekLow) ?? (lowMatch?.[2] ? Number(lowMatch[2]) : null);
    const endsHigh = num(m.endsWeekHigh) ?? (highMatch?.[2] ? Number(highMatch[2]) : null);
    const gate = (m.gate && m.gate.trim()) || (gateMatch ? gateMatch[1].trim() : "");
    return { m, detail: detail.replace(/\s+/g, " ").trim(), weeksLow, weeksHigh, endsLow, endsHigh, gate };
  });
  const anyEnds = rows.some((row) => row.endsLow !== null || row.endsHigh !== null);
  return rows.map((row, index) => {
    let { endsLow, endsHigh } = row;
    // The first phase starts at week 0, so it ends when its own estimate runs out.
    if (index === 0 && anyEnds && endsLow === null && endsHigh === null) {
      endsLow = row.weeksLow;
      endsHigh = row.weeksHigh;
    }
    const weeks = range(row.weeksLow, row.weeksHigh);
    const plural = (row.weeksHigh ?? row.weeksLow) === 1 ? "week" : "weeks";
    const ends = range(endsLow, endsHigh);
    return {
      phase: row.m.title,
      detail: row.detail,
      duration: weeks ? `${weeks} ${plural}` : "",
      ends: ends ? `Week ${ends}` : "",
      gate: capitalize(row.gate.replace(/\s+/g, " ").trim()),
      due: humanDate(row.m.dueDate ?? row.m.actualEnd ?? null) ?? "",
    };
  });
}

export type TimelineColumn = "duration" | "ends" | "gate" | "due";

/** Columns that have a value in at least one row; empty columns (e.g. Due with no dates) are hidden. */
export function timelineColumns(rows: TimelineRow[]): TimelineColumn[] {
  return (["duration", "ends", "gate", "due"] as const).filter((column) => rows.some((row) => row[column]));
}

/** "Audit: build f80c1d4 · live proposal" — short and human, no raw ids. */
export function auditLine(build: string, audit: { source: string; approvedVersionNumber?: number | null }): string {
  const source = audit.source === "approved_version_snapshot"
    ? `approved version${audit.approvedVersionNumber ? ` ${audit.approvedVersionNumber}` : ""} snapshot`
    : "live proposal";
  return `Audit: build ${shortBuild(build)} · ${source}`;
}
