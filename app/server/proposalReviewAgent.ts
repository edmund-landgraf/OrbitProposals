import type { PrismaClient } from "@prisma/client";
import { timelineDateWarnings } from "./proposalTimeline.js";

export type ReviewRule = { code: string; nodeKey: string; check: string; fieldPath: string | null; minChars: number | null; minItems: number | null; pattern: string | null; severity: string; weight: number; message: string; suggestion: string };
export type ReviewNode = { key: string; title: string; stateCode: string; body: unknown };
export type ReviewProposal = { scope?: unknown; timeline?: unknown; pricing?: unknown; [field: string]: unknown };
export type ReviewFinding = { code: string; severity: string; message: string; suggestion: string };
export type SectionReview = { key: string; title: string; state: string; score: number; issues: ReviewFinding[]; suggestions: ReviewFinding[] };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A rule reads either a dotted path on the proposal (scope.summary, timeline.targetDate, pricing.model) or the node's narrative text. */
export function ruleValue(rule: ReviewRule, node: ReviewNode, proposal: ReviewProposal): unknown {
  if (!rule.fieldPath) return isRecord(node.body) ? node.body.text : undefined;
  return rule.fieldPath.split(".").reduce<unknown>((value, part) => (isRecord(value) ? value[part] : undefined), proposal);
}

const isEmpty = (value: unknown) =>
  value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);
const asText = (value: unknown) => (typeof value === "string" ? value.trim() : Array.isArray(value) ? value.filter((v) => typeof v === "string").join("\n") : "");

/** True when the rule fails. Only the missing check fires on an empty value, so an empty part is not double-counted. */
export function ruleFails(rule: ReviewRule, value: unknown, node: ReviewNode): boolean {
  if (rule.check === "state_open") return node.stateCode === "open";
  if (rule.check === "missing") return isEmpty(value);
  if (isEmpty(value)) return false;
  if (rule.check === "min_chars") return rule.minChars !== null && asText(value).length < rule.minChars;
  if (rule.check === "min_items") return rule.minItems !== null && (!Array.isArray(value) || value.length < rule.minItems);
  if (rule.check === "pattern") return rule.pattern !== null && new RegExp(rule.pattern, "i").test(asText(value));
  return false;
}

/** Scores each reviewed part 0-100 (100 minus failed weights) and averages them for the proposal. */
export function reviewProposal(nodes: ReviewNode[], rules: ReviewRule[], proposal: ReviewProposal = {}) {
  const sections: SectionReview[] = [];
  for (const node of nodes) {
    const own = rules.filter((rule) => rule.nodeKey === node.key);
    if (own.length === 0) continue;
    const failed = own.filter((rule) => ruleFails(rule, ruleValue(rule, node, proposal), node));
    const finding = (rule: ReviewRule): ReviewFinding => ({ code: rule.code, severity: rule.severity, message: rule.message, suggestion: rule.suggestion });
    sections.push({
      key: node.key, title: node.title, state: node.stateCode,
      score: Math.max(0, 100 - failed.reduce((sum, rule) => sum + rule.weight, 0)),
      issues: failed.filter((rule) => rule.severity === "issue").map(finding),
      suggestions: failed.filter((rule) => rule.severity === "suggestion").map(finding),
    });
  }
  const score = sections.length ? Math.round(sections.reduce((sum, s) => sum + s.score, 0) / sections.length) : null;
  const issueCount = sections.reduce((sum, s) => sum + s.issues.length, 0);
  return { score, issueCount, readySections: sections.filter((s) => s.issues.length === 0).length, totalSections: sections.length, sections };
}

/** Global rules (no template) apply to every proposal; template-scoped rules only to proposals built from that template. */
export async function loadReview(prisma: PrismaClient, proposalId: string) {
  const [nodes, proposal] = await Promise.all([
    prisma.proposalNode.findMany({ where: { proposalId }, orderBy: { sortOrder: "asc" } }),
    prisma.proposal.findUnique({ where: { id: proposalId }, select: { scope: true, timeline: true, pricing: true, templateCode: true } }),
  ]);
  const templateCode = proposal?.templateCode ?? null;
  const rules = await prisma.proposalReviewRule.findMany({
    where: { active: true, OR: templateCode ? [{ templateCode: null }, { templateCode }] : [{ templateCode: null }] },
    orderBy: [{ sort: "asc" }, { code: "asc" }],
  });
  const review = reviewProposal(nodes, rules, (proposal ?? {}) as ReviewProposal);
  const milestones = await prisma.timelineMilestone.findMany({ where: { proposalId }, select: { title: true, dueDate: true } });
  const timeline = isRecord(proposal?.timeline) ? proposal!.timeline as Record<string, unknown> : {};
  const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  const findings = timelineDateWarnings(date(timeline.startDate), date(timeline.targetDate), milestones.map((row) => ({ title: row.title, dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null })));
  return withTimelineFindings(review, nodes, findings);
}

const TIMELINE_FINDING_WEIGHT = 30;

/**
 * Adds impossible-date findings (target or milestone before the start, milestone after the target) to the schedule part.
 * They are issues, so the part is not ready until the dates are fixed. Nothing changes when the dates are consistent.
 */
export function withTimelineFindings(review: ReturnType<typeof reviewProposal>, nodes: ReviewNode[], warnings: ReadonlyArray<{ code: string; message: string }>) {
  if (!warnings.length) return review;
  const node = nodes.find((item) => item.key === "schedule") ?? nodes.find((item) => item.key === "milestones");
  const key = node?.key ?? "schedule";
  const issues: ReviewFinding[] = warnings.map((warning) => ({ code: warning.code.toLowerCase(), severity: "issue", message: warning.message, suggestion: "Fix the dates so the start comes first, milestones fall between the start and the target, and the target comes last." }));
  const sections = [...review.sections];
  const index = sections.findIndex((section) => section.key === key);
  if (index >= 0) {
    const section = sections[index]!;
    sections[index] = { ...section, score: Math.max(0, section.score - TIMELINE_FINDING_WEIGHT * issues.length), issues: [...section.issues, ...issues] };
  } else {
    sections.push({ key, title: node?.title ?? "Dates", state: node?.stateCode ?? "open", score: Math.max(0, 100 - TIMELINE_FINDING_WEIGHT * issues.length), issues, suggestions: [] });
  }
  const score = Math.round(sections.reduce((sum, section) => sum + section.score, 0) / sections.length);
  return { score, issueCount: sections.reduce((sum, section) => sum + section.issues.length, 0), readySections: sections.filter((section) => section.issues.length === 0).length, totalSections: sections.length, sections };
}
