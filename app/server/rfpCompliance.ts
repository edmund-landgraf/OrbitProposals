const TYPES = ["deliverable", "qualification", "format", "commercial", "legal", "security", "schedule", "question"] as const;
export type RequirementType = (typeof TYPES)[number];

const TYPE_WORDS: Array<[RequirementType, RegExp]> = [
  ["security", /\b(security|encrypt|privacy|soc\s*2|confidential)\b/i],
  ["commercial", /\b(price|pricing|cost|fee|payment|invoice)\b/i],
  ["legal", /\b(liability|indemn|governing law|warranty|terms)\b/i],
  ["schedule", /\b(deadline|schedule|calendar|business days|due date)\b/i],
  ["format", /\b(page limit|font|pdf|format|margin)\b/i],
  ["qualification", /\b(experience|qualification|certification|past performance)\b/i],
  ["question", /\?$/],
];

export type ProposedRequirement = {
  text: string;
  requirementType: RequirementType;
  sourceReference: string;
  mandatory: boolean;
  priority: "high" | "normal";
  confidence: number;
  suggestedNodeKeys: string[];
  duplicateOfIndex: number | null;
};

export type MatrixSection = { key: string; title: string; hasContent: boolean };
export type MatrixRequirement = {
  id: string;
  text: string;
  mandatory: boolean;
  confidence: number;
  status: string;
  confirmed: boolean;
  mappedNodeKeys: string[];
  suggestedNodeKeys: string[];
  duplicateOfId: string | null;
  evidence: unknown;
};

const tokens = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 3));

function overlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function requirementType(text: string): RequirementType {
  return TYPE_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "deliverable";
}

export function analyzeRfp(content: string, sections: MatrixSection[] = []): ProposedRequirement[] {
  const proposed: ProposedRequirement[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const trimmed = raw.trim();
    const text = trimmed.replace(/^(\d+(?:\.\d+)*[.)]|[a-z][.)]|[-*•])\s+/i, "").trim();
    if (text.length < 12) return;
    const numbered = /^(\d+(?:\.\d+)*[.)]|[-*•])\s+/.test(trimmed);
    const obligation = /\b(shall|must|required)\b/i.test(text);
    const question = text.endsWith("?");
    if (!numbered && !obligation && !question && text.length < 48) return;
    const words = tokens(text);
    const suggestedNodeKeys = sections.filter((section) => overlap(words, tokens(`${section.key} ${section.title}`)) >= 0.3).map((section) => section.key);
    const earlier = proposed.findIndex((item) => overlap(words, tokens(item.text)) >= 0.8);
    proposed.push({
      text,
      requirementType: requirementType(text),
      sourceReference: `line ${index + 1}`,
      mandatory: obligation,
      priority: obligation ? "high" : "normal",
      confidence: obligation ? 0.75 : numbered || question ? 0.6 : 0.45,
      suggestedNodeKeys,
      duplicateOfIndex: earlier >= 0 ? earlier : null,
    });
  });
  return proposed;
}

const ACCEPTED = new Set(["addressed", "not_applicable", "accepted_risk"]);

export function complianceMatrix(requirements: MatrixRequirement[], sections: MatrixSection[]) {
  const byId = new Map(requirements.map((item) => [item.id, item]));
  const conflicts = requirements.filter((item) => item.duplicateOfId && byId.has(item.duplicateOfId)).map((item) => ({ id: item.id, duplicateOfId: item.duplicateOfId, text: item.text }));
  const lowConfidence = requirements.filter((item) => item.confidence < 0.6 || !item.confirmed).map((item) => item.id);
  const gaps = requirements.filter((item) => item.mandatory && !ACCEPTED.has(item.status)).map((item) => ({
    id: item.id,
    message: item.mappedNodeKeys.length ? "Mandatory requirement is mapped but not accepted." : "Mandatory requirement has no accepted mapping.",
    suggestedNodeKeys: item.suggestedNodeKeys,
  }));
  const thinEvidence = requirements.filter((item) => item.mappedNodeKeys.length > 0 && item.mappedNodeKeys.some((key) => sections.find((section) => section.key === key && !section.hasContent))).map((item) => item.id);
  const accepted = requirements.filter((item) => ACCEPTED.has(item.status)).length;
  return {
    readyForSignOff: gaps.length === 0 && requirements.length > 0,
    coverage: { total: requirements.length, accepted, unmapped: requirements.filter((item) => item.status === "unmapped").length, mandatoryGaps: gaps.length },
    gaps,
    conflicts,
    lowConfidence,
    thinEvidence,
    requirements,
  };
}

export function sectionHasContent(body: unknown): boolean {
  if (typeof body === "string") return body.trim().length > 0;
  if (!body || typeof body !== "object") return false;
  return JSON.stringify(body).replace(/[{}[\]",:\s]/g, "").length > 0;
}
