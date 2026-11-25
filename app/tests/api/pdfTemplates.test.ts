import assert from "node:assert/strict";
import test from "node:test";
import { contractPdfHtml, proposalPdfHtml } from "../../server/pdf/templates.js";

test("proposalPdfHtml escapes untrusted strings", () => {
  const html = proposalPdfHtml({
    kind: "proposal",
    title: `Title <script>alert("x")</script>`,
    engagement: "fixed_price",
    status: "draft",
    version: 1,
    updatedAt: "2026-01-02",
    build: "test-build",
    organizationName: `ACME & Co`,
    scope: { summary: `Summary <b>bold</b>`, deliverables: [`One`, `Two<script>`], assumptions: [], exclusions: [] },
    timeline: { startDate: null, targetDate: null, milestones: [{ title: `M1`, dueDate: null, description: `Desc & <tag>` }] },
    pricingText: "$1.00",
    options: [{ label: `Rush`, description: `Fast <img src=x>`, selected: false, priceDeltaText: "$0.50", selection: "optional", groupName: null }],
    sections: [{ key: "k", title: "t", clientLabel: "Section", text: `Line 1\n<script>no</script>` }],
    audit: { source: "live_proposal", approvedVersionId: null },
  });
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("ACME &amp; Co"));
  assert.ok(html.includes("Summary &lt;b&gt;bold&lt;/b&gt;"));
  assert.ok(html.includes("aria-label=\"Proposal cover\""));
});

test("contractPdfHtml escapes terms", () => {
  const html = contractPdfHtml({
    kind: "contract",
    contractId: "11111111-1111-4111-8111-111111111111",
    proposalTitle: "Proposal",
    organizationName: "Org",
    status: "draft",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    signedAt: null,
    termsTitle: `Contract <svg onload=alert(1)>`,
    termsBody: `Terms <script>alert(1)</script>\nSecond line`,
    billing: { totalText: "$1.00", entries: [{ label: "Upfront", percent: "50%", amountText: "$0.50", trigger: "contract_signed", invoiceId: null }] },
    build: "test-build",
    audit: { note: "test" },
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;svg onload=alert(1)&gt;"));
  assert.ok(html.includes("Terms &lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("aria-label=\"Contract cover\""));
});


import { pdfFooterTemplate } from "../../server/pdf/pdfRender.js";
import { auditLine, humanDate, isEmptyNarrative, leadSentences, renderMarkdown, sentenceCase, shortBuild, timelineColumns, timelineRows, titleCase } from "../../server/pdf/format.js";
import type { ProposalPdfModel } from "../../server/pdf/templates.js";

const baseModel = (over: Partial<ProposalPdfModel> = {}): ProposalPdfModel => ({
  kind: "proposal",
  title: "ARR Dashboard",
  engagement: "fixed_price",
  status: "draft",
  version: 3,
  updatedAt: "2026-11-17T01:51:20.639Z",
  build: "f80c1d4c7e6b9f56d6e3b218515e6e866ef4bc9b",
  organizationName: "Example Client",
  scope: { summary: "Short scope summary. Second sentence.", deliverables: ["Dashboard"], assumptions: ["Access"], exclusions: ["Support"] },
  timeline: { startDate: null, targetDate: null, milestones: [] },
  pricingText: "$3,000.00",
  options: [],
  sections: [],
  audit: { source: "live_proposal", approvedVersionId: null },
  ...over,
});

const tocOf = (html: string) => {
  const toc = /<div class="panel toc">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  return [...toc.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
};

test("titleCase and sentenceCase turn keys into readable labels", () => {
  assert.equal(titleCase("success metrics"), "Success Metrics");
  assert.equal(titleCase("systems_and_integrations"), "Systems and Integrations");
  assert.equal(titleCase("problem and background"), "Problem and Background");
  assert.equal(titleCase("the ARR model"), "The ARR Model");
  assert.equal(sentenceCase("fixed_price"), "Fixed price");
  assert.equal(sentenceCase("draft"), "Draft");
});

test("shortBuild, humanDate and auditLine stay short and human", () => {
  assert.equal(shortBuild("f80c1d4c7e6b9f56d6e3b218515e6e866ef4bc9b"), "f80c1d4");
  assert.equal(shortBuild("unknown"), "unknown");
  assert.equal(shortBuild(""), "unknown");
  assert.equal(humanDate("2026-11-17T01:51:20.639Z"), "Nov 16, 2026");
  assert.equal(humanDate("2026-12-01"), "Dec 1, 2026");
  assert.equal(humanDate(null), null);
  assert.equal(auditLine("f80c1d4c7e6b9f56d6e3b218515e6e866ef4bc9b", { source: "live_proposal" }), "Audit: build f80c1d4 · live proposal");
  assert.equal(auditLine("abcdef1234567", { source: "approved_version_snapshot", approvedVersionNumber: 4 }), "Audit: build abcdef1 · approved version 4 snapshot");
});

test("renderMarkdown renders lists, bold and run-in labels, and escapes raw HTML", () => {
  const html = renderMarkdown("Intro line.\n\n- one **bold**\n- two\n\n1. Align. First phase.\n\n2. Connect. Second phase.");
  assert.ok(html.includes("<ul><li>one <strong>bold</strong></li><li>two</li></ul>"));
  assert.ok(html.includes("<ol><li><strong class=\"runIn\">Align.</strong> First phase.</li><li><strong class=\"runIn\">Connect.</strong> Second phase.</li></ol>"));
  const runIns = renderMarkdown("Access needed. Read-only access.\n\nWho holds it. MeridianLink admins.\n\nThis paragraph has a long first sentence that should never be treated as a label at all.");
  assert.ok(runIns.includes("<p><strong class=\"runIn\">Access needed.</strong> Read-only access.</p>"));
  assert.ok(runIns.includes("<p><strong class=\"runIn\">Who holds it.</strong> MeridianLink admins.</p>"));
  assert.ok(runIns.includes("<p>This paragraph has a long first sentence"));
  // One short opening sentence alone is not a run-in pattern.
  assert.equal(renderMarkdown("Short one. Then more."), "<p>Short one. Then more.</p>");
  const unsafe = renderMarkdown(`<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>\n\n**<b>x</b>**`);
  assert.ok(!unsafe.includes("<script>"));
  assert.ok(!unsafe.includes("<img"));
  assert.ok(unsafe.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(unsafe.includes("<strong>&lt;b&gt;x&lt;/b&gt;</strong>"));
  assert.equal(renderMarkdown("Not provided."), "");
});

test("isEmptyNarrative and leadSentences", () => {
  assert.ok(isEmptyNarrative(null));
  assert.ok(isEmptyNarrative("  "));
  assert.ok(isEmptyNarrative("Not provided."));
  assert.ok(!isEmptyNarrative("Real text."));
  assert.equal(leadSentences("First sentence here. Second sentence (ARR) here. Third one.\n\nNext paragraph."), "First sentence here. Second sentence (ARR) here.");
});

test("timelineRows lifts estimates and gates out of descriptions and hides empty columns", () => {
  const rows = timelineRows([
    { title: "Phase 1 Align", dueDate: null, description: "Low estimate: 1 week. High estimate: 2 weeks. Gate: Finance signs the written ARR definitions." },
    { title: "Phase 2 Connect", dueDate: null, description: "Low estimate: 2 weeks (ends week 3). High estimate: 3 weeks (ends week 5). Gate: row counts and freshness match the sources." },
    { title: "Phase 3 Model", dueDate: null, description: "Build the bridge. Low estimate: 2 weeks (ends week 5). High estimate: 2 weeks (ends week 7)." },
  ]);
  assert.deepEqual(rows[0], { phase: "Phase 1 Align", detail: "", duration: "1–2 weeks", ends: "Week 1–2", gate: "Finance signs the written ARR definitions.", due: "" });
  assert.deepEqual(rows[1], { phase: "Phase 2 Connect", detail: "", duration: "2–3 weeks", ends: "Week 3–5", gate: "Row counts and freshness match the sources.", due: "" });
  assert.equal(rows[2].detail, "Build the bridge.");
  assert.equal(rows[2].duration, "2 weeks");
  assert.equal(rows[2].ends, "Week 5–7");
  assert.deepEqual(timelineColumns(rows), ["duration", "ends", "gate"]);
});

test("timelineRows prefers structured fields and shows due dates", () => {
  const rows = timelineRows([{ title: "Kickoff", dueDate: "2026-12-01", description: "Low estimate: 9 weeks.", weeksLow: 1, weeksHigh: 1, gate: "signed SOW" }]);
  assert.equal(rows[0].duration, "1 week");
  assert.equal(rows[0].gate, "Signed SOW");
  assert.equal(rows[0].due, "Dec 1, 2026");
  assert.deepEqual(timelineColumns(rows), ["duration", "gate", "due"]);
  assert.deepEqual(timelineColumns(timelineRows([{ title: "Plain", dueDate: null, description: "Just words." }])), []);
});

test("proposal PDF hides internals, empty sections, and orders narrative after the cover", () => {
  const html = proposalPdfHtml(baseModel({
    sections: [
      { key: "approach", title: "approach", clientLabel: "approach", text: "1. Align. A.\n2. Show. B." },
      { key: "executive_summary", title: "executive summary", clientLabel: "executive summary", text: "Exec first sentence. Exec second sentence. Third." },
      { key: "pricing_notes", title: "pricing notes", clientLabel: "", text: "Not provided." },
      { key: "problem_and_background", title: "problem and background", clientLabel: "problem and background", text: "Problem text." },
      { key: "success_metrics", title: "success metrics", clientLabel: "success metrics", text: "- one\n- two" },
    ],
    timeline: { startDate: null, targetDate: null, milestones: [{ title: "Phase 1", dueDate: null, description: "Low estimate: 1 week. High estimate: 2 weeks. Gate: Finance signs." }] },
  }));
  assert.ok(!html.includes("Export stability"));
  assert.ok(!html.includes("Export source"));
  assert.ok(!html.includes("Approved version</dt>"));
  assert.ok(!html.includes("approvedVersionId"));
  assert.ok(!html.includes("f80c1d4c7e6b9f56d6e3b218515e6e866ef4bc9b"));
  assert.ok(html.includes("Audit: build f80c1d4 · live proposal"));
  assert.ok(!html.includes("Not provided."));
  assert.ok(!html.includes("Pricing Notes"));
  assert.ok(html.includes("Draft for review — not yet approved."));
  assert.ok(html.includes('<div class="watermark" aria-hidden="true">DRAFT</div>'));
  assert.ok(html.includes(">Fixed price<"));
  assert.ok(html.includes(">Draft<"));
  assert.ok(html.includes(">Updated Nov 16, 2026<"));
  assert.ok(html.includes("Exec first sentence. Exec second sentence."));
  assert.ok(html.includes("Authorized signer (Example Client)"));
  for (const label of ["Signature", "Name", "Title", "Date"]) assert.ok(html.includes(`<div class="sigLine">${label}</div>`), label);
  assert.deepEqual(tocOf(html), ["Executive Summary", "Problem and Background", "Scope and Investment", "Timeline", "Assumptions and Exclusions", "Approach", "Success Metrics", "Acceptance"]);
  // The short overview card is dropped when an executive summary exists.
  assert.ok(!html.includes('aria-label="Overview"'));
  // Timeline: Due is hidden when no phase has a date.
  assert.ok(html.includes("<th class=\"nowrap\">Duration</th>"));
  assert.ok(!html.includes(">Due</th>"));
  // Section order in the body matches the contents.
  const order = ["Executive Summary", "Problem and Background", "Scope and investment", "Timeline", "Approach", "Success Metrics", "Acceptance"].map((t) => html.indexOf(`<div class="sectionTitle">${t}</div>`));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), JSON.stringify(order));
});

test("proposal PDF without narrative keeps the overview; approved exports drop the watermark", () => {
  const html = proposalPdfHtml(baseModel({
    status: "active",
    audit: { source: "approved_version_snapshot", approvedVersionId: "11111111-1111-4111-8111-111111111111", approvedVersionNumber: 2 },
  }));
  assert.deepEqual(tocOf(html), ["Overview", "Scope and Investment", "Timeline", "Assumptions and Exclusions", "Acceptance"]);
  assert.ok(!html.includes('class="watermark"'));
  assert.ok(html.includes("Approved version 2."));
  assert.ok(html.includes("Audit: build f80c1d4 · approved version 2 snapshot"));
  assert.ok(!html.includes("11111111-1111-4111-8111-111111111111"));
  assert.ok(html.includes("Short scope summary. Second sentence."));
});

test("PDF footer puts the label left and Page N of M right", () => {
  const footer = pdfFooterTemplate("Prepared by Unwhelm");
  assert.ok(footer.includes("justify-content:space-between"));
  assert.ok(footer.includes("<span>Prepared by Unwhelm</span>"));
  assert.ok(footer.includes('Page <span class="pageNumber"></span> of <span class="totalPages"></span>'));
});

test("leadSentences does not split on abbreviations", () => {
  assert.equal(leadSentences("We use tools, e.g. Databricks. Then we ship. Later."), "We use tools, e.g. Databricks. Then we ship.");
});

test("long narrative cards may break across pages; short ones stay together", () => {
  const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} has enough words to take up a line or two of the printed page.`).join("\n\n");
  const html = proposalPdfHtml(baseModel({ sections: [
    { key: "approach", title: "approach", clientLabel: "approach", text: long },
    { key: "terms", title: "terms", clientLabel: "terms", text: "Short terms." },
  ] }));
  assert.ok(html.includes('<div class="sectionTitle">Approach</div>\n        <div class="card prose">'));
  assert.ok(html.includes('<div class="sectionTitle">Terms</div>\n        <div class="card prose keep">'));
  assert.ok(/\.sectionTitle\{[^}]*break-after: avoid/.test(html));
  assert.ok(html.includes("box-decoration-break:slice"));
  assert.ok(html.includes("orphans:3"));
  assert.ok(!/box-shadow/.test(html));
});
