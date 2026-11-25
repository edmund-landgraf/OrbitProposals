import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderPdf } from "../server/pdf/pdfRender.js";
import { contractPdfHtml, proposalPdfHtml } from "../server/pdf/templates.js";

async function main() {
  const outDir = "/opt/cursor/artifacts";
  await mkdir(outDir, { recursive: true });

  const long = (label: string) =>
    `${label}\n\n` +
    [
      "This is synthetic sample content used only to demonstrate PDF rendering and layout behavior.",
      "It intentionally includes long paragraphs, dense lists, and multi-page sections to surface pagination issues, awkward splits, and table readability problems.",
      "Nothing in this PDF reflects real client data, testimonials, or legal language.",
    ].join(" ");

  const proposal = proposalPdfHtml({
    kind: "proposal",
    title: "Synthetic Sample Proposal (No Real Client Data)",
    engagement: "fixed_price",
    status: "active",
    version: 7,
    updatedAt: "2026-11-07",
    build: "synthetic",
    organizationName: "Example Client Organization",
    scope: {
      summary: long("Summary"),
      deliverables: [
        "Discovery workshop (stakeholders + constraints)",
        "Architecture plan (phased delivery, risks, dependencies)",
        "Implementation of agreed features (tracked milestones)",
        "Security and privacy review checklist (synthetic example only)",
        "Deployment runbook (rollback steps + monitoring checklist)",
        "Handoff session (recorded notes, synthetic)",
      ],
      assumptions: [
        "Client provides access to required systems and test environments.",
        "Timely feedback on review milestones and clarifying questions.",
        "Availability of a single point-of-contact for coordination.",
        "Non-production data is used for demonstrations in this synthetic sample.",
      ],
      exclusions: [
        "Ongoing support outside the agreed project scope.",
        "Third-party license costs (if any).",
        "Work requiring credentials or access not provided by the client.",
      ],
    },
    timeline: {
      startDate: "2026-11-10",
      targetDate: "2026-12-15",
      milestones: [
        { title: "Kickoff", dueDate: "2026-11-10", description: "Project kickoff and access validation." },
        { title: "Discovery complete", dueDate: "2026-11-14", description: "Discovery notes + initial architecture draft." },
        { title: "Architecture review", dueDate: "2026-11-18", description: "Review plan, confirm dependencies, adjust scope." },
        { title: "Prototype", dueDate: "2026-11-24", description: "Prototype flow with synthetic sample data and logging." },
        { title: "Implementation pass 1", dueDate: "2026-12-02", description: "Core implementation, tests, and internal review." },
        { title: "Implementation pass 2", dueDate: "2026-12-08", description: "Hardening, UX polish, and documentation updates." },
        { title: "Delivery", dueDate: "2026-12-15", description: "Final delivery and handoff." },
      ],
    },
    pricingText: "$12,500.00",
    options: [
      { label: "Priority delivery", description: "Accelerated schedule with prioritized staffing and earlier review windows.", selected: false, priceDeltaText: "$2,500.00", selection: "optional", groupName: "Delivery options" },
      { label: "Extended support", description: "Two weeks of post-delivery support (bugfixes and minor adjustments).", selected: true, priceDeltaText: "$1,000.00", selection: "optional", groupName: "Support options" },
      { label: "Additional workshop", description: "One additional structured workshop session (up to 90 minutes).", selected: false, priceDeltaText: "$600.00", selection: "optional", groupName: "Support options" },
      { label: "Documentation pack", description: "Expanded documentation pack: runbook + troubleshooting guide + FAQ.", selected: false, priceDeltaText: "$900.00", selection: "optional", groupName: "Support options" },
    ],
    sections: [
      { key: "context", title: "Context", clientLabel: "Context", text: `${long("Context")}\n\nKey goals:\n- Clarity\n- Predictability\n- Strong documentation\n\nRisks:\n- Unknown constraints\n- Access dependencies\n- Timeline changes` },
      { key: "approach", title: "Approach", clientLabel: "Approach", text: `${long("Approach")}\n\nWe will prioritize correctness and explicit trade-offs. This synthetic section is intentionally long.\n\n${long("Approach (continued)")}` },
      { key: "implementation", title: "Implementation details", clientLabel: "Implementation details", text: `Synthetic table-like text (for stress testing wrapping):\n\nItem | Notes\n--- | ---\nAuthentication | Session + bearer flows validated\nTenant isolation | Org boundaries enforced\nUntrusted input | Escaped at render\nLong text | Wrapped + avoid awkward splits\n\n${long("Implementation narrative")}` },
      { key: "faq", title: "FAQ", clientLabel: "FAQ", text: `Q: Is this real client data?\nA: No. Everything here is synthetic.\n\nQ: Does this activate DocuSign?\nA: No. Provider notes describe what would be needed.` },
    ],
    audit: { source: "live_proposal", approvedVersionId: null },
  });

  const contract = contractPdfHtml({
    kind: "contract",
    contractId: "11111111-1111-4111-8111-111111111111",
    proposalTitle: "Synthetic Sample Proposal (No Real Client Data)",
    organizationName: "Example Client Organization",
    status: "draft",
    createdAt: "2026-11-07",
    updatedAt: "2026-11-07",
    signedAt: null,
    termsTitle: "Synthetic Sample Contract (No Real Client Data)",
    termsBody:
      "These terms are synthetic and for demo only.\n\n" +
      "1) Work.\n" +
      "The work described here is synthetic. This section is intentionally long to test pagination and readability.\n\n" +
      "2) Payment.\n" +
      "Payment details are represented only as synthetic examples in the billing schedule section. No real financial claims are made.\n\n" +
      "3) Confidentiality.\n" +
      "No confidential information is included. This is synthetic sample text.\n\n" +
      "4) Additional notes.\n" +
      "This paragraph repeats to create a multi-page terms section.\n\n" +
      `${long("Terms narrative block A")}\n\n${long("Terms narrative block B")}\n\n${long("Terms narrative block C")}`,
    billing: {
      totalText: "$12,500.00",
      entries: [
        { label: "Signing invoice", trigger: "contract_signed", percent: "40%", amountText: "$5,000.00", invoiceId: null },
        { label: "Delivery invoice", trigger: "milestone_accepted", percent: "60%", amountText: "$7,500.00", invoiceId: null },
      ],
    },
    build: "synthetic",
    audit: { note: "synthetic sample only" },
  });

  const proposalPdf = await renderPdf({ html: proposal, title: "Synthetic proposal PDF", headerText: "Unwhelm · Proposal", footerText: "Synthetic sample" });
  const contractPdf = await renderPdf({ html: contract, title: "Synthetic contract PDF", headerText: "Unwhelm · Contract", footerText: "Synthetic sample" });

  await writeFile(join(outDir, "synthetic-proposal.pdf"), proposalPdf);
  await writeFile(join(outDir, "synthetic-contract.pdf"), contractPdf);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${join(outDir, "synthetic-proposal.pdf")} and ${join(outDir, "synthetic-contract.pdf")}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});

