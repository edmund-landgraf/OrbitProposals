import type { ContractStatus, RecordStatus } from "@prisma/client";
import { escapeHtml, safeText } from "./escape.js";
import { auditLine, humanDate, isEmptyNarrative, leadSentences, plainText, renderMarkdown, sentenceCase, timelineColumns, timelineRows, titleCase, type TimelineColumn } from "./format.js";

export type PdfBrand = {
  companyName: string;
  productName: string;
  website: string;
};

export type ProposalPdfModel = {
  kind: "proposal";
  title: string;
  engagement: string;
  status: RecordStatus | string;
  version: number | null;
  /** ISO timestamp or YYYY-MM-DD; printed as "Nov 16, 2026". */
  updatedAt: string | null;
  build: string;
  organizationName: string | null;
  scope: { summary: string; deliverables: string[]; assumptions: string[]; exclusions: string[] };
  timeline: { startDate: string | null; targetDate: string | null; milestones: Array<{ title: string; dueDate: string | null; description: string; weeksLow?: number | null; weeksHigh?: number | null; hoursLow?: number | null; hoursHigh?: number | null; endsWeekLow?: number | null; endsWeekHigh?: number | null; gate?: string; actualStart?: string | null; actualEnd?: string | null }> };
  pricingText: string;
  /** Real payment terms only (e.g. from pricing data); the Investment card never invents them. */
  paymentTerms?: string | null;
  options: Array<{ label: string; description: string; selected: boolean; priceDeltaText: string; selection?: string | null; groupName?: string | null }>;
  sections: Array<{ title: string; clientLabel: string; key: string; text: string | null }>;
  audit: { source: "approved_version_snapshot" | "live_proposal"; approvedVersionId: string | null; approvedVersionNumber?: number | null };
};

export type ContractPdfModel = {
  kind: "contract";
  contractId: string;
  proposalTitle: string;
  organizationName: string;
  status: ContractStatus | string;
  createdAt: string;
  updatedAt: string;
  signedAt: string | null;
  termsTitle: string;
  termsBody: string;
  billing: { totalText: string; entries: Array<{ label: string; percent: string; amountText: string; trigger: string; invoiceId: string | null }> };
  build: string;
  audit: { note: string };
};

const defaultBrand: PdfBrand = {
  companyName: "Unwhelm",
  productName: "Unwhelm",
  website: "https://unwhelm.example",
};

function css() {
  return `
    :root{
      --ink:#1a2228; --inkStrong:#0c1116; --muted:#5f6968;
      --line:#d6cdc0; --lineSoft:#e4ddd2;
      --paper:#fffdf6; --paperSoft:#f8f1e6;
      --teal:#006b75; --tealDeep:#04555d; --orange:#b34f27;
    }
    /* Bottom margin leaves room for the "Prepared by Unwhelm · Page N of M" footer template. */
    @page { size: Letter; margin: 56px 56px 64px 56px; }
    *{ box-sizing:border-box; }
    html,body{ padding:0; margin:0; color:var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    body{ background:white; font-size:12px; line-height:1.55; }
    .doc{ width:100%; position:relative; z-index:1; }
    h1,h2,h3,h4,h5{ color:var(--inkStrong); letter-spacing: -0.01em; break-after: avoid; page-break-after: avoid; }
    h2{ margin:0 0 6px; font-size:22px; line-height:1.2; }
    p{ margin:0; orphans:3; widows:3; break-inside:avoid; page-break-inside:avoid; }

    /* Fixed elements repeat on every printed page in Chromium; it sits above the cards so it shows on each page, faint enough to read through. */
    .watermark{ position:fixed; top:40%; left:-10%; right:-10%; text-align:center; font-size:96px; font-weight:700; letter-spacing:.16em; color:rgba(12,17,22,.04); transform:rotate(-30deg); z-index:2; line-height:1; pointer-events:none; }

    .badgeRow{ display:flex; flex-wrap:wrap; gap:6px; margin:10px 0 0; }
    .badge{ display:inline-block; padding:3px 10px; border:1px solid var(--lineSoft); border-radius:999px; font-size:10px; color:var(--inkStrong); background:var(--paperSoft); }
    .badge.badgeStrong{ background:#e8f1f1; border-color:#b8d3d5; color: var(--tealDeep); }
    .statusLine{ margin:8px 0 0; font-size:10.5px; color:var(--muted); }

    .cover{ break-after: page; }
    .coverTop{ display:flex; justify-content:space-between; align-items:flex-start; gap:20px; padding-bottom:18px; border-bottom:1px solid var(--line); }
    .brand{ display:flex; gap:12px; align-items:center; }
    .mark{ width:24px; height:24px; border-radius:7px; background:var(--teal); position:relative; flex:0 0 auto; }
    .mark:after{ content:""; position:absolute; inset:6px; border-radius:5px; background:rgba(255,255,255,0.9); }
    .brandTitle{ margin:0; font-size:16px; letter-spacing:0.01em; }
    .meta{ text-align:right; color:var(--muted); font-size:10px; line-height:1.35; }
    .meta strong{ display:block; color:var(--inkStrong); font-weight:700; }
    .coverMain{ padding-top:22px; }
    .docKind{ text-transform:uppercase; letter-spacing:.16em; font-size:10px; color:var(--tealDeep); }
    .coverH1{ margin:10px 0 0; font-size:34px; line-height:1.08; }
    .coverSub{ margin:10px 0 0; font-size:13px; color:var(--muted); max-width: 520px; }
    .coverGrid{ display:grid; grid-template-columns: 1.15fr .85fr; gap:18px; margin-top:22px; align-items:stretch; }
    .panel{ border:1px solid var(--line); border-radius:12px; padding:14px; background:var(--paper); break-inside:avoid; page-break-inside:avoid; }
    .panel h3{ margin:0 0 10px; font-size:11px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
    .panel p + p{ margin-top:8px; }
    .coverStack{ display:grid; gap:16px; margin-top:16px; }
    .brief p{ font-size:12.5px; line-height:1.6; color:var(--ink); }
    .kv{ display:grid; grid-template-columns: 110px 1fr; gap:6px 10px; font-size:11px; margin:0; }
    .kv dt{ color:var(--muted); }
    .kv dd{ margin:0; color:var(--inkStrong); }
    .toc ol{ margin:0 0 0 18px; padding:0; font-size:11px; }
    .toc li{ margin:4px 0; }

    .pageTitle{ margin:0; font-size:16px; }
    .subtitle{ margin:8px 0 0; color:var(--muted); font-size:11px; }

    .grid{ display:grid; grid-template-columns: 1fr 1fr; gap:14px; align-items:start; }
    .section{ margin-top:18px; }
    .sectionTitle{ margin:0 0 8px; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.12em; color: var(--muted); break-after: avoid; page-break-after: avoid; }
    /* Long cards may split. No bottom padding and no radius: Chromium paints those on the first fragment and leaves an empty band. Short cards get .keep. */
    .card{ border:1px solid var(--line); padding:12px 12px 0; background:var(--paper); box-decoration-break:slice; -webkit-box-decoration-break:slice; }
    .card:not(.keep) > :last-child{ margin-bottom:12px; }
    .keep{ break-inside:avoid; page-break-inside:avoid; }
    .card.keep{ border-radius:10px; padding-bottom:12px; }
    .card h4{ margin:0 0 8px; font-size:13px; }
    .card p{ margin:0; }
    .card p + p, .card p + ul, .card p + ol, .card ul + p, .card ol + p{ margin-top:8px; }
    .card h5{ margin:10px 0 4px; font-size:12px; }
    .prose li{ orphans:3; widows:3; }
    .prose ol > li{ margin:7px 0; }
    .runIn{ color:var(--inkStrong); }
    .price{ font-size:20px; line-height:1.2; margin:0 0 4px; color:var(--inkStrong); }
    ul, ol{ margin:8px 0 0 18px; padding:0; }
    li{ margin:5px 0; break-inside: avoid; page-break-inside: avoid; }
    .hr{ height:1px; background:var(--line); margin:18px 0; }
    .mono{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .pre{ white-space:pre-wrap; overflow-wrap:anywhere; }
    .callout{ border-left: 3px solid #a6c9cc; padding: 10px 12px; background: #eef5f5; border-radius: 8px; }
    .callout strong{ color: var(--tealDeep); }
    table{ width:100%; border-collapse:separate; border-spacing:0; margin-top:10px; }
    thead{ display: table-header-group; }
    th,td{ border-bottom:1px solid var(--lineSoft); padding:9px 10px; vertical-align:top; }
    th{ border-top:1px solid var(--lineSoft); background: #f4efe5; text-align:left; font-size:11px; color: var(--inkStrong); }
    tr td:first-child, tr th:first-child{ border-left:1px solid var(--lineSoft); }
    tr td:last-child, tr th:last-child{ border-right:1px solid var(--lineSoft); }
    tbody tr:nth-child(even) td{ background: #faf5ec; }
    tr{ break-inside: avoid; page-break-inside: avoid; }
    .tableTight td, .tableTight th{ padding:7px 9px; }
    .phaseName{ font-weight:600; color:var(--inkStrong); }
    .phaseDetail{ margin-top:3px; font-size:11px; }
    .nowrap{ white-space:nowrap; }
    .num{ text-align:right; white-space:nowrap; }
    .muted{ color:var(--muted); }
    .pageBreak{ break-before: page; }
    .breakAfter{ break-after: page; }
    .avoidBreak{ break-inside: avoid; page-break-inside: avoid; }
    .signatureGrid{ display:grid; grid-template-columns: 1fr 1fr; gap:22px 18px; margin-top:16px; }
    .sigLine{ border-top: 1px solid var(--ink); padding-top: 6px; color: var(--muted); font-size: 10px; min-height: 34px; }
    .sigBlock{ margin-top:14px; }
    .sigBlock h5{ margin:0; font-size:11px; color:var(--inkStrong); }
    .audit{ font-size:9.5px; margin-top:4px; }
    a{ color:var(--teal); text-decoration:none; }
  `;
}

function wrap(title: string, bodyHtml: string, opts: { watermark?: string } = {}) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <style>${css()}</style>
    </head>
    <body>
      ${opts.watermark ? `<div class="watermark" aria-hidden="true">${escapeHtml(opts.watermark)}</div>` : ""}
      <main class="doc" role="document" aria-label="${escapeHtml(title)}">
        ${bodyHtml}
      </main>
    </body>
  </html>`;
}

function list(items: string[]) {
  const safe = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return items.length ? `<ul>${safe}</ul>` : `<p class="muted">None listed.</p>`;
}

/** Roughly a third of a Letter page of 12px text; shorter cards stay on one page. */
const SHORT_CARD_CHARS = 900;
const keepIfShort = (chars: number) => (chars < SHORT_CARD_CHARS ? " keep" : "");

function cover(brand: PdfBrand, opts: {
  kindLabel: string;
  title: string;
  subtitle: string;
  badges: Array<{ text: string; strong?: boolean }>;
  meta: Array<{ label: string; value: string }>;
  tocItems: string[];
  statusLine?: string;
  extraPanels?: Array<{ title: string; body: string; className?: string }>;
  /** Legacy single panel, still used by the contract cover. */
  extraPanel?: { title: string; body: string };
}) {
  const metaHtml = `<dl class="kv" aria-label="Document metadata">${opts.meta.map((row) => `<dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd>`).join("")}</dl>`;
  const toc = opts.tocItems.length
    ? `<h3>Contents</h3><ol>${opts.tocItems.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ol>`
    : `<h3>Contents</h3><p class="muted">No sections listed.</p>`;
  const panels = [...(opts.extraPanels ?? []), ...(opts.extraPanel ? [opts.extraPanel] : [])];
  const extra = panels.length
    ? `<div class="coverStack">${panels.map((panel) => `<div class="panel${"className" in panel && panel.className ? ` ${panel.className}` : ""}">
         <h3>${escapeHtml(panel.title)}</h3>
         <p class="${"className" in panel && panel.className === "brief" ? "" : "muted"}">${escapeHtml(panel.body)}</p>
       </div>`).join("")}</div>`
    : "";
  return `
    <section class="cover" aria-label="${escapeHtml(opts.kindLabel)} cover">
      <div class="coverTop">
        <div class="brand" aria-label="Brand">
          <div class="mark" aria-hidden="true"></div>
          <h1 class="brandTitle">${escapeHtml(brand.productName)}</h1>
        </div>
        <div class="meta" aria-label="Document type">
          <strong>${escapeHtml(opts.kindLabel)}</strong>
          ${escapeHtml(brand.companyName)}
        </div>
      </div>
      <div class="coverMain">
        <div class="docKind">${escapeHtml(opts.kindLabel)}</div>
        <h2 class="coverH1">${escapeHtml(opts.title)}</h2>
        <p class="coverSub">${escapeHtml(opts.subtitle)}</p>
        <div class="badgeRow" aria-label="Badges">
          ${opts.badges.map((b) => `<span class="badge${b.strong ? " badgeStrong" : ""}">${escapeHtml(b.text)}</span>`).join("")}
        </div>
        ${opts.statusLine ? `<p class="statusLine">${escapeHtml(opts.statusLine)}</p>` : ""}
        <div class="coverGrid">
          <div class="panel">
            <h3>At a glance</h3>
            ${metaHtml}
          </div>
          <div class="panel toc">
            ${toc}
          </div>
        </div>
        ${extra}
      </div>
    </section>
  `;
}

type RenderedSection = { title: string; html: string };

const sectionKey = (s: { key: string; title: string; clientLabel: string }) => `${s.key} ${s.title} ${s.clientLabel}`.toLowerCase().replace(/[_-]+/g, " ");
const isExecutiveSummary = (s: { key: string; title: string; clientLabel: string }) => /executive summary/.test(sectionKey(s));
const isProblem = (s: { key: string; title: string; clientLabel: string }) => /\bproblem\b|\bbackground\b/.test(sectionKey(s));

function narrativeSection(s: { title: string; clientLabel: string; text: string | null }): RenderedSection {
  const title = titleCase(s.clientLabel || s.title);
  const text = s.text ?? "";
  return {
    title,
    html: `
      <section class="section narrative" aria-label="${escapeHtml(title)}">
        <div class="sectionTitle">${escapeHtml(title)}</div>
        <div class="card prose${keepIfShort(text.length)}">${renderMarkdown(text)}</div>
      </section>`,
  };
}

const OPEN_STATUSES = new Set(["draft", "pending_approval"]);

export function proposalPdfHtml(model: ProposalPdfModel, brand: PdfBrand = defaultBrand): string {
  const approved = model.audit.source === "approved_version_snapshot";
  const showDraftMark = !approved && OPEN_STATUSES.has(String(model.status));
  const statusLine = approved
    ? `Approved version${model.audit.approvedVersionNumber ? ` ${model.audit.approvedVersionNumber}` : ""}.`
    : model.status === "draft"
      ? "Draft for review — not yet approved."
      : model.status === "pending_approval"
        ? "Awaiting approval — not yet approved."
        : "Not yet approved.";

  // Empty narrative sections ("Not provided.") are left out entirely.
  const narratives = model.sections.filter((s) => !isEmptyNarrative(s.text));
  const executive = narratives.find(isExecutiveSummary);
  const problem = narratives.find((s) => s !== executive && isProblem(s));
  const lead = [executive, problem].filter((s): s is NonNullable<typeof s> => Boolean(s));
  const rest = narratives.filter((s) => !lead.includes(s));

  const rendered: RenderedSection[] = [];

  // A real executive summary replaces the short scope summary card, which says the same thing.
  if (!executive && model.scope.summary.trim()) {
    rendered.push({
      title: "Overview",
      html: `
        <section class="section" aria-label="Overview">
          <div class="sectionTitle">Overview</div>
          <div class="card prose${keepIfShort(model.scope.summary.length)}">${renderMarkdown(model.scope.summary)}</div>
        </section>`,
    });
  }
  for (const s of lead) rendered.push(narrativeSection(s));

  rendered.push({
    title: "Scope and Investment",
    html: `
      <section class="section" aria-label="Scope and investment">
        <div class="sectionTitle">Scope and investment</div>
        <div class="grid">
          <div class="card${keepIfShort(model.scope.deliverables.join(" ").length)}">
            <h4>Deliverables</h4>
            ${list(model.scope.deliverables)}
          </div>
          <div class="card${keepIfShort(`${model.pricingText} ${model.engagement} ${model.paymentTerms ?? ""}`.length)}">
            <h4>Investment</h4>
            <p class="price"><strong>${escapeHtml(model.pricingText)}</strong></p>
            <p class="muted">${escapeHtml(sentenceCase(model.engagement))}</p>
            ${model.paymentTerms && model.paymentTerms.trim() ? `<h5>Payment terms</h5><p class="muted">${escapeHtml(model.paymentTerms)}</p>` : ""}
          </div>
        </div>
      </section>`,
  });

  const rows = timelineRows(model.timeline.milestones);
  const columns = timelineColumns(rows);
  const columnLabels: Record<TimelineColumn, string> = { duration: "Duration", ends: "Ends", gate: "Gate", due: "Due" };
  const dates = [
    model.timeline.startDate ? `Start: ${humanDate(model.timeline.startDate)}` : "",
    model.timeline.targetDate ? `Target: ${humanDate(model.timeline.targetDate)}` : "",
  ].filter(Boolean).join(" · ");
  const phaseWidth = columns.includes("gate") ? "38%" : "56%";
  rendered.push({
    title: "Timeline",
    html: `
      <section class="section" aria-label="Timeline">
        <div class="sectionTitle">Timeline</div>
        <div class="card${rows.length <= 3 ? " keep" : ""}">
          <p class="muted">${dates ? escapeHtml(dates) : "Start date to be agreed at kickoff."}</p>
          ${rows.length
            ? `<table class="tableTight" aria-label="Phases"><thead><tr><th style="width:${phaseWidth}">Phase</th>${columns.map((c) => `<th${c === "gate" ? "" : ` class="nowrap"`}>${columnLabels[c]}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr><td><div class="phaseName">${escapeHtml(r.phase)}</div>${r.detail ? `<div class="muted phaseDetail">${escapeHtml(r.detail)}</div>` : ""}</td>${columns.map((c) => `<td${c === "gate" ? "" : ` class="nowrap"`}>${escapeHtml(r[c] || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>`
            : `<p class="muted">No phases listed.</p>`}
        </div>
      </section>`,
  });

  if (model.scope.assumptions.length || model.scope.exclusions.length) {
    rendered.push({
      title: "Assumptions and Exclusions",
      html: `
        <section class="section" aria-label="Assumptions and exclusions">
          <div class="sectionTitle">Assumptions and exclusions</div>
          <div class="grid">
            <div class="card${keepIfShort(model.scope.assumptions.join(" ").length)}">
              <h4>Assumptions</h4>
              ${list(model.scope.assumptions)}
            </div>
            <div class="card${keepIfShort(model.scope.exclusions.join(" ").length)}">
              <h4>Exclusions</h4>
              ${list(model.scope.exclusions)}
            </div>
          </div>
        </section>`,
    });
  }

  if (model.options.length) {
    rendered.push({
      title: "Options",
      html: `
        <section class="section" aria-label="Options">
          <div class="sectionTitle">Options</div>
          <div class="card">
            <h4>Optional add-ons</h4>
            <table aria-label="Options"><thead><tr><th style="width:28%">Option</th><th>Description</th><th class="num" style="width:16%">Price delta</th><th style="width:12%">Selected</th></tr></thead>
              <tbody>
                ${model.options.map((o) => `<tr><td>${escapeHtml(o.groupName ? `${o.groupName}: ${o.label}` : o.label)}</td><td class="pre">${escapeHtml(o.description)}</td><td class="num">${escapeHtml(o.priceDeltaText)}</td><td>${o.selected ? "Yes" : "No"}</td></tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>`,
    });
  }

  for (const s of rest) rendered.push(narrativeSection(s));

  const signer = model.organizationName ? `Authorized signer (${model.organizationName})` : "Authorized signer (client)";
  rendered.push({
    title: "Acceptance",
    html: `
      <section class="section keep" aria-label="Acceptance">
        <div class="sectionTitle">Acceptance</div>
        <div class="card keep">
          <h4>How to accept and sign</h4>
          <p class="muted">To accept this proposal and sign the contract, use the Unwhelm client portal. This export is for review and recordkeeping.</p>
          <div class="sigBlock">
            <h5>${escapeHtml(signer)}</h5>
            <div class="signatureGrid" aria-label="Signature lines">
              <div class="sigLine">Signature</div>
              <div class="sigLine">Date</div>
              <div class="sigLine">Name</div>
              <div class="sigLine">Title</div>
            </div>
          </div>
        </div>
      </section>`,
  });

  const updated = humanDate(model.updatedAt);
  const facts: Array<{ label: string; value: string }> = [
    ...(model.organizationName ? [{ label: "Client", value: model.organizationName }] : []),
    ...(model.pricingText ? [{ label: "Investment", value: model.pricingText }] : []),
    ...(model.engagement ? [{ label: "Engagement", value: sentenceCase(model.engagement) }] : []),
    ...(rows.length ? [{ label: "Phases", value: String(rows.length) }] : []),
    // The last phase's "Ends" column is the planned length of the whole engagement.
    ...(rows.length && rows[rows.length - 1].ends ? [{ label: "Duration", value: `${rows[rows.length - 1].ends.replace(/^Week /, "")} weeks` }] : []),
    ...(model.timeline.startDate ? [{ label: "Start", value: humanDate(model.timeline.startDate) ?? model.timeline.startDate }] : []),
    ...(model.timeline.targetDate ? [{ label: "Target", value: humanDate(model.timeline.targetDate) ?? model.timeline.targetDate }] : []),
  ];

  const brief = leadSentences(executive?.text) || leadSentences(model.scope.summary) || plainText(model.scope.summary);
  const coverHtml = cover(brand, {
    kindLabel: "Proposal",
    title: model.title,
    subtitle: model.organizationName ? `Prepared for ${model.organizationName}.` : "Prepared by Unwhelm.",
    badges: [
      ...(model.engagement ? [{ text: sentenceCase(model.engagement), strong: true }] : []),
      { text: sentenceCase(String(model.status)) },
      ...(model.version ? [{ text: `Version ${model.version}` }] : []),
      ...(updated ? [{ text: `Updated ${updated}` }] : []),
    ],
    statusLine,
    meta: facts,
    tocItems: rendered.map((s) => s.title),
    extraPanels: [
      ...(brief ? [{ title: "In brief", body: brief, className: "brief" }] : []),
      {
        title: "Next steps",
        body: "Review this proposal, confirm any options, then accept and sign in the Unwhelm client portal. This PDF is for review and recordkeeping.",
      },
    ],
  });

  const audit = `
    <div class="hr"></div>
    <p class="muted audit">${escapeHtml(auditLine(model.build, model.audit))}</p>
  `;

  return wrap(
    `Proposal — ${safeText(model.title, "Untitled")}`,
    `${coverHtml}${rendered.map((s) => s.html).join("")}${audit}`,
    { watermark: showDraftMark ? "DRAFT" : undefined },
  );
}

export function contractPdfHtml(model: ContractPdfModel, brand: PdfBrand = defaultBrand): string {
  const coverHtml = cover(brand, {
    kindLabel: "Contract",
    title: model.termsTitle,
    subtitle: `Between ${brand.companyName} and ${model.organizationName}.`,
    badges: [
      { text: `Status: ${model.status}`, strong: true },
      ...(model.signedAt ? [{ text: `Signed ${model.signedAt}` }] : [{ text: "Not signed" }]),
      { text: `Updated ${model.updatedAt}` },
    ],
    meta: [
      { label: "Client", value: model.organizationName },
      { label: "Contract id", value: model.contractId },
      { label: "Created", value: model.createdAt },
      { label: "Proposal", value: model.proposalTitle },
      { label: "Build", value: model.build || "unknown" },
    ],
    tocItems: ["Summary", "Billing schedule", "Terms", "Signature"],
    extraPanel: {
      title: "Signing",
      body: "Signing status and timestamp are recorded in the Unwhelm client portal. This export is for review and recordkeeping.",
    },
  });

  const summary = `
    <section class="section" aria-label="Summary">
      <div class="sectionTitle">Summary</div>
      <div class="grid">
        <div class="card">
          <h4>Parties</h4>
          <p><strong>${escapeHtml(brand.companyName)}</strong> and <strong>${escapeHtml(model.organizationName)}</strong>.</p>
          <p class="muted" style="margin-top:6px;">Related proposal: ${escapeHtml(model.proposalTitle)}</p>
        </div>
        <div class="card">
          <h4>Status</h4>
          <p class="muted">Contract status: <strong>${escapeHtml(model.status)}</strong></p>
          <p class="muted">Signed: <strong>${escapeHtml(model.signedAt ?? "—")}</strong></p>
        </div>
      </div>
    </section>
  `;

  const billing = `
    <section class="section" aria-label="Billing schedule">
      <div class="sectionTitle">Billing schedule</div>
      <div class="card">
        <h4>Total</h4>
        <p style="font-size:18px; line-height:1.2; margin-bottom:8px;"><strong>${escapeHtml(model.billing.totalText)}</strong></p>
        <table aria-label="Billing schedule"><thead><tr><th style="width:34%">Line</th><th style="width:20%">Trigger</th><th class="num" style="width:12%">Percent</th><th class="num" style="width:18%">Amount</th><th style="width:16%">Invoice</th></tr></thead>
          <tbody>
            ${model.billing.entries.map((e) => `<tr><td>${escapeHtml(e.label)}</td><td>${escapeHtml(e.trigger)}</td><td class="num">${escapeHtml(e.percent)}</td><td class="num">${escapeHtml(e.amountText)}</td><td class="mono">${escapeHtml(e.invoiceId ? e.invoiceId.slice(0, 8) : "—")}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;

  const terms = `
    <div class="pageBreak"></div>
    <section class="section" aria-label="Terms">
      <div class="sectionTitle">Terms</div>
      <div class="card">
        <h4>Contract terms</h4>
        <div class="pre">${escapeHtml(model.termsBody)}</div>
      </div>
    </section>
  `;

  const signature = `
    <section class="section" aria-label="Signature">
      <div class="sectionTitle">Signature</div>
      <div class="card">
        <h4>Acceptance</h4>
        <p class="muted">Sign in the Unwhelm client portal to record signing status and timestamp. This section is a printable signature block for reference.</p>
        <div class="signatureGrid">
          <div><div class="sigLine">Authorized signer (${escapeHtml(model.organizationName)})</div></div>
          <div><div class="sigLine">Date</div></div>
          <div><div class="sigLine">Authorized signer (${escapeHtml(brand.companyName)})</div></div>
          <div><div class="sigLine">Date</div></div>
        </div>
      </div>
    </section>
  `;

  const auditInline = `<p class="muted" style="font-size:10px; margin-top:12px;">Audit: ${escapeHtml(model.audit.note)} · build=${escapeHtml(model.build)}</p>`;

  return wrap(
    `Contract — ${safeText(model.termsTitle, "Contract")}`,
    `${coverHtml}${summary}${billing}${terms}${signature.replace("</div>\n    </section>", `${auditInline}</div>\n    </section>`)}`,
  );
}

