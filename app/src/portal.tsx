import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AcceptancePanel, ClientReviewActions, WhatChanged, type ReviewWorkspace } from "./reviewPanels";
import { ProgressPanel } from "./progressPanel";
import { RemindersPanel } from "./remindersPanel";
import { VersionStamp } from "./versionStamp";

type Proposal = {
  id: string;
  title: string;
  engagement: string;
  status: string;
  scope: { summary: string; deliverables: string[]; assumptions: string[]; exclusions: string[] };
  timeline: { startDate: string | null; targetDate: string | null; milestones: Array<TimelinePhase> };
  pricing: { model: string; amountMinor?: number; rateMinor?: number; hours?: number; currency: string; [key: string]: unknown };
  options: Array<{ id: string; label: string; description: string; priceDelta: { amountMinor: number; currency: string }; selected: boolean; selection?: string; groupId?: string | null; groupName?: string | null; groupMode?: string | null }>;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type NarrativeSection = { key: string; title: string; clientLabel: string; state: string; text: string | null; guidance: string; maxChars: number; updatedAt?: string | null };
type Freshness = { record: { version: number; updatedAt: string }; parts: Array<{ key: string; updatedAt: string }> };

type TimelinePhase = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  weeksLow?: number | null;
  weeksHigh?: number | null;
  endsWeekLow?: number | null;
  endsWeekHigh?: number | null;
  gate?: string;
  actualStart?: string | null;
  actualEnd?: string | null;
};
type ProposalRole = { id: string; name: string; side: string; responsibility: string; heaviestIn: string[] };

type ProposalDraft = {
  title: string;
  summary: string;
  deliverables: string;
  assumptions: string;
  exclusions: string;
  startDate: string;
  targetDate: string;
  milestones: string;
  roles: string;
  pricing: string;
  options: string;
};

type Contract = { id: string; proposalId: string; status: string; terms: string; signedAt: string | null; createdAt: string; updatedAt: string; retainageHeldMinor?: number; retainagePercentBasis?: number };
type BillingSchedule = { total: { amountMinor: number; currency: string }; entries: Array<{ id: string; label: string; percent: string; amount: { amountMinor: number; currency: string }; trigger: string; invoiceId: string | null }> };
type Invoice = { id: string; contractId: string; amount: { amountMinor: number; currency: string }; status: string; dueDate: string; paidAt?: string | null; createdAt: string; retainage?: { amountMinor: number; currency: string }; kind?: string };
type Project = { id: string; contractId: string; title: string; status: string; milestones: Array<{ id: string; title: string; description: string; dueDate: string | null; status: string }> };

class PortalRequestError extends Error {
  readonly code: string;
  readonly details?: Array<{ path?: string; code: string; message: string }>;
  constructor(code: string, message: string, details?: Array<{ path?: string; code: string; message: string }>) {
    super(message); this.code = code; this.details = details; this.name = "PortalRequestError";
  }
}

export async function portalApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, credentials: "include", headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  if (response.status === 401 && typeof window !== "undefined") {
    const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.href = `/api/v1/auth/signin?next=${next}`;
    throw new PortalRequestError("AUTH_REQUIRED", "Authentication is required.");
  }
  const body = await response.json().catch(() => undefined) as undefined | { ok?: boolean; code?: string; message?: string; details?: Array<{ path?: string; code: string; message: string }>; entity?: T };
  const message = body?.message ?? (response.ok ? "Request failed." : `Request failed (${response.status}).`);
  const details = body?.details;
  const detailText = details?.length ? `\n${details.map((item) => `- ${item.message}`).join("\n")}` : "";
  if (!response.ok || !body?.ok || body.entity === undefined) throw new PortalRequestError(body?.code ?? "REQUEST_FAILED", `${message}${detailText}`, details);
  return body.entity;
}

export function PortalRoute({ denied }: { denied: ReactNode }) {
  const [state, setState] = useState<"checking" | "signed-out" | "denied" | "allowed">("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/auth/session", { credentials: "include" })
      .then((response) => response.json())
      .then((body: { entity?: { user?: { roles?: string[] } | null; isAdmin?: boolean } }) => {
        if (cancelled) return;
        const entity = body.entity;
        if (!entity?.user) { setState("signed-out"); return; }
        const roles = entity?.user?.roles ?? [];
        setState(Boolean(entity?.isAdmin || roles.includes("client") || roles.includes("staff")) ? "allowed" : "denied");
      })
      .catch(() => { if (!cancelled) setState("denied"); });
    return () => { cancelled = true; };
  }, []);

  if (state === "checking") return <p className="portal-status">Checking access.</p>;
  if (state === "signed-out") return (
    <section className="section portal-section">
      <div className="container">
        <p className="eyebrow">CLIENT PORTAL</p>
        <h1>Work with your proposal.</h1>
        <p className="portal-status">Sign in to continue.</p>
        <p><a className="portal-link" href="/api/v1/auth/signin">Sign in</a></p>
      </div>
    </section>
  );
  if (state === "denied") return denied;
  return <PortalPage />;
}

function PortalPage() {
  const [tab, setTab] = useState<"proposals" | "contracts" | "invoices" | "projects">("proposals");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [review, setReview] = useState<ReviewWorkspace | null>(null);
  const [draft, setDraft] = useState<ProposalDraft | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openPart, setOpenPart] = useState<string | null>(null);
  const [narratives, setNarratives] = useState<NarrativeSection[]>([]);
  const [roles, setRoles] = useState<ProposalRole[]>([]);
  const opening = useRef(0);
  const seen = useRef<{ id: string; record: string; parts: Map<string, string> } | null>(null);

  async function loadProposals() {
    setLoading(true);
    try {
      const page = await portalApi<{ items: Proposal[] }>("/api/v1/proposals");
      setProposals(page.items);
      if (selected) {
        const refreshed = await portalApi<Proposal>(`/api/v1/proposals/${selected.id}`);
        setSelected(refreshed);
      }
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load proposals."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void loadProposals();
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("proposal");
    const part = params.get("part");
    if (linked) void openProposal(linked, part);
  }, []);

  function writePortalQuery(proposalId?: string | null, part?: string | null) {
    const params = new URLSearchParams(window.location.search);
    if (proposalId) params.set("proposal", proposalId); else params.delete("proposal");
    if (part) params.set("part", part); else params.delete("part");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
  }

  async function loadResource(kind: "contracts" | "invoices" | "projects") {
    setResourceLoading(true);
    setError("");
    try {
      if (kind === "contracts") setContracts((await portalApi<{ items: Contract[] }>("/api/v1/contracts")).items);
      if (kind === "invoices") setInvoices((await portalApi<{ items: Invoice[] }>("/api/v1/invoices")).items);
      if (kind === "projects") setProjects((await portalApi<{ items: Project[] }>("/api/v1/projects")).items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not load ${kind}.`);
    } finally { setResourceLoading(false); }
  }

  async function loadNarratives(id: string) {
    try { setNarratives(await portalApi<NarrativeSection[]>(`/api/v1/proposals/${id}/narrative`)); }
    catch { setNarratives([]); }
  }

  async function openProposal(id: string, part?: string | null) {
    const request = ++opening.current;
    seen.current = null;
    try {
      const proposal = await portalApi<Proposal>(`/api/v1/proposals/${id}`);
      if (request !== opening.current) return;
      setSelected(proposal);
      setDraft(null);
      setError("");
      setOpenPart(part ?? null);
      writePortalQuery(id, part ?? null);
      // Optional section/freshness failures must not prevent review feedback loading.
      const [sections, workspace] = await Promise.all([
        portalApi<NarrativeSection[]>(`/api/v1/proposals/${id}/narrative`).catch(() => null),
        portalApi<ReviewWorkspace>(`/api/v1/proposals/${id}/review`).catch(() => null),
      ]);
      if (request !== opening.current) return;
      setNarratives(sections ?? []);
      setReview(workspace);
      try {
        const loaded = await portalApi<{ roles: ProposalRole[] }>(`/api/v1/proposals/${id}/roles`);
        if (request !== opening.current) return;
        setRoles(loaded.roles);
      } catch { if (request === opening.current) setRoles([]); }
      // Use timestamps from what was actually loaded, so edits during opening are not missed.
      seen.current = { id, record: `${proposal.version}:${proposal.updatedAt}`, parts: new Map((sections ?? []).flatMap((part) => part.updatedAt ? [[part.key, part.updatedAt] as const] : [])) };
    } catch (reason) {
      if (request === opening.current) setError(reason instanceof Error ? reason.message : "Could not load that proposal.");
    }
  }

  useEffect(() => {
    if (!selected || draft || tab !== "proposals") return;
    const id = selected.id;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    let busy = false;
    const timer = window.setInterval(() => {
      if (busy) return;
      busy = true;
      const request = opening.current;
      const current = () => !controller.signal.aborted && opening.current === request;
      void (async () => {
        try {
          const fresh = await portalApi<Freshness>(`/api/v1/proposals/${id}/freshness`, options);
          if (!current()) return;
          const prior = seen.current?.id === id ? seen.current : null;
          const recordKey = `${fresh.record.version}:${fresh.record.updatedAt}`;
          const recordChanged = !prior || prior.record !== recordKey;
          const dirty = fresh.parts.filter((part) => prior?.parts.get(part.key) !== part.updatedAt);
          const removed = prior && [...prior.parts.keys()].some((key) => !fresh.parts.some((part) => part.key === key));
          const [proposal, workspace, loaded] = await Promise.all([
            recordChanged ? portalApi<Proposal>(`/api/v1/proposals/${id}`, options) : null,
            recordChanged || dirty.length || removed ? portalApi<ReviewWorkspace>(`/api/v1/proposals/${id}/review`, options).catch(() => null) : null,
            Promise.all(dirty.map(async (part) => {
              try { return { part, section: await portalApi<NarrativeSection>(`/api/v1/proposals/${id}/narrative/${encodeURIComponent(part.key)}`, options), acknowledged: true }; }
              catch (error) { return { part, section: null, acknowledged: error instanceof PortalRequestError && error.code === "NOT_FOUND" }; }
            })),
          ]);
          if (!current()) return;
          if (proposal) {
            setSelected(proposal);
            setProposals((items) => items.map((item) => item.id === id ? proposal : item));
            try {
              const loaded = await portalApi<{ roles: ProposalRole[] }>(`/api/v1/proposals/${id}/roles`, options);
              if (current()) setRoles(loaded.roles);
            } catch { /* Keep the roles last loaded. */ }
          }
          if (workspace) setReview(workspace);
          const byKey = new Map(loaded.flatMap(({ section }) => section ? [[section.key, section] as const] : []));
          const live = new Set(fresh.parts.map((part) => part.key));
          setNarratives((items) => {
            const merged = items.filter((section) => live.has(section.key)).map((section) => byKey.get(section.key) ?? section);
            for (const section of byKey.values()) if (!merged.some((item) => item.key === section.key)) merged.push(section);
            return merged;
          });
          const parts = new Map(prior?.parts ?? []);
          for (const key of parts.keys()) if (!live.has(key)) parts.delete(key);
          for (const item of loaded) if (item.acknowledged) parts.set(item.part.key, item.part.updatedAt);
          seen.current = { id, record: proposal ? `${proposal.version}:${proposal.updatedAt}` : prior?.record ?? "", parts };
        } catch { /* Keep the current page and retry on the next tick. */ }
        finally { busy = false; }
      })();
    }, 8000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [selected?.id, draft, tab]);

  function editProposal(proposal: Proposal) {
    setDraft({
      title: proposal.title,
      summary: proposal.scope.summary,
      deliverables: proposal.scope.deliverables.join("\n"),
      assumptions: proposal.scope.assumptions.join("\n"),
      exclusions: proposal.scope.exclusions.join("\n"),
      startDate: proposal.timeline.startDate ?? "",
      targetDate: proposal.timeline.targetDate ?? "",
      milestones: proposal.timeline.milestones.map((milestone) => phaseLine(milestone)).join("\n"),
      roles: roles.map((role) => `${role.name} | ${role.side} | ${role.responsibility} | ${role.heaviestIn.join(",")}`).join("\n"),
      pricing: JSON.stringify(proposal.pricing, null, 2),
      options: JSON.stringify(proposal.options.map((option) => ({ label: option.label, description: option.description, priceDelta: option.priceDelta, selected: option.selected })), null, 2),
    });
    setError("");
  }

  async function saveProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !draft) return;
    setSaving(true); setError("");
    try {
      const scope = { summary: draft.summary.trim(), deliverables: lines(draft.deliverables), assumptions: lines(draft.assumptions), exclusions: lines(draft.exclusions) };
      if (!scope.summary || scope.deliverables.length === 0) throw new Error("Add a summary and at least one deliverable.");
      let updated = await portalApi<Proposal>(`/api/v1/proposals/${selected.id}`, { method: "PATCH", body: JSON.stringify({ title: draft.title.trim(), scope }) });
      const milestones = draft.milestones.split("\n").map((row) => row.trim()).filter(Boolean).map(parsePhaseLine);
      updated = await portalApi<Proposal>(`/api/v1/proposals/${selected.id}/timeline`, { method: "PUT", body: JSON.stringify({ startDate: draft.startDate || null, targetDate: draft.targetDate || null, milestones }) });
      const roleRows = draft.roles.split("\n").map((row) => row.trim()).filter(Boolean).map((row) => {
        const [name, side, responsibility, heaviest] = row.split("|").map((item) => item.trim());
        return { name, side: side === "client" ? "client" : "unwhelm", responsibility: responsibility ?? "", heaviestIn: heaviest ? heaviest.split(",").map((item) => item.trim()).filter(Boolean) : [] };
      });
      const savedRoles = await portalApi<{ roles: ProposalRole[] }>(`/api/v1/proposals/${selected.id}/roles`, { method: "PUT", body: JSON.stringify({ roles: roleRows }) });
      setRoles(savedRoles.roles);
      const pricing = JSON.parse(draft.pricing) as Record<string, unknown>;
      updated = await portalApi<Proposal>(`/api/v1/proposals/${selected.id}/budget`, { method: "PUT", body: JSON.stringify(pricing) });
      setSelected(updated); setDraft(null); await loadProposals();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the proposal."); }
    finally { setSaving(false); }
  }

  async function submitForReview() {
    if (!selected) return;
    try { const updated = await portalApi<Proposal>(`/api/v1/proposals/${selected.id}/review`, { method: "POST", body: JSON.stringify({}) }); setSelected(updated); await loadProposals(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit the proposal."); }
  }

  return (
    <section className="section portal-section">
      <div className="container">
        <p className="eyebrow">CLIENT PORTAL</p>
        <h1>Work with your proposal.</h1>
        <div className="portal-tabs" role="tablist" aria-label="Client portal">
          {(["proposals", "contracts", "invoices", "projects"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => { setTab(item); if (item !== "proposals") void loadResource(item); }}>{item[0].toUpperCase() + item.slice(1)}</button>)}
        </div>
        {error && <p className="portal-error" role="alert">{error}</p>}
        {tab === "proposals" && (
          <div className="portal-grid" role="tabpanel">
            <div>
              <h2>Your proposals</h2>
              {loading ? <p className="portal-status">Loading proposals.</p> : error ? <p className="portal-status">Could not load proposals.</p> : proposals.length === 0 ? <p>No proposals yet.</p> : (
                <table className="portal-table"><thead><tr><th>Title</th><th>Status</th><th>Updated</th></tr></thead><tbody>
                  {proposals.map((proposal) => <tr key={proposal.id} className={selected?.id === proposal.id ? "selected" : ""} onClick={() => { void openProposal(proposal.id); }}><td><button className="portal-link" type="button" onClick={() => { void openProposal(proposal.id); }}>{proposal.title}</button></td><td>{proposal.status}</td><td>{formatDate(proposal.updatedAt)}</td></tr>)}
                </tbody></table>
              )}
            </div>
            {selected && <ProposalDocument proposal={selected} roles={roles} review={review} draft={draft} saving={saving} openPart={openPart} narratives={narratives} onEdit={() => editProposal(selected)} onCancel={() => setDraft(null)} onSave={saveProposal} onDraftChange={setDraft} onSubmit={submitForReview} onReviewChanged={() => openProposal(selected.id, openPart)} onOpenPart={(key) => { setOpenPart(key); writePortalQuery(selected.id, key); void portalApi(`/api/v1/proposals/${selected.id}/views`, { method: "POST", body: JSON.stringify({ sectionKey: key }) }).catch(() => undefined); }} onClosePart={() => { setOpenPart(null); writePortalQuery(selected.id, null); }} onNarrativeSaved={(sections) => setNarratives(sections)} />}
          </div>
        )}
        {tab === "contracts" && <ContractsPanel contracts={contracts} loading={resourceLoading} onError={setError} />}
        {tab === "invoices" && <InvoicesPanel invoices={invoices} loading={resourceLoading} />}
        {tab === "projects" && <ProjectsPanel projects={projects} loading={resourceLoading} />}
      </div>
    </section>
  );
}

function ContractsPanel({ contracts, loading, onError }: { contracts: Contract[]; loading: boolean; onError: (message: string) => void }) {
  const [selected, setSelected] = useState<{ contract: Contract; billing: BillingSchedule | null } | null>(null);
  async function open(contract: Contract) {
    try { setSelected({ contract, billing: await portalApi<BillingSchedule>(`/api/v1/contracts/${contract.id}/billing`) }); onError(""); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Could not load the billing schedule."); }
  }
  return <div className="portal-resource-grid" role="tabpanel"><div><h2>Your contracts</h2>{loading ? <p className="portal-status">Loading contracts.</p> : contracts.length === 0 ? <p>No contracts yet.</p> : <table className="portal-table"><thead><tr><th>Contract</th><th>Status</th><th>Updated</th></tr></thead><tbody>{contracts.map((contract) => <tr key={contract.id} onClick={() => { void open(contract); }}><td><button className="portal-link" type="button" onClick={() => { void open(contract); }}>{contract.terms}</button></td><td>{contract.status}</td><td>{formatDate(contract.updatedAt)}</td></tr>)}</tbody></table>}</div>{selected && <article className="portal-proposal-document"><div className="portal-document-header"><div><p className="eyebrow">CONTRACT</p><h2>{selected.contract.terms}</h2></div><span className="portal-status-badge">{selected.contract.status}</span></div><p>{selected.contract.signedAt ? `Signed ${formatDate(selected.contract.signedAt)}.` : "Not signed yet."}</p>{selected.contract.retainagePercentBasis ? <p>Retainage {selected.contract.retainagePercentBasis / 10000}% held: {formatMinor(selected.contract.retainageHeldMinor ?? 0, "USD")}.</p> : null}{selected.billing && <section><h3>Billing schedule</h3><p>Total: {formatMoney(selected.billing.total)}</p><ul>{selected.billing.entries.map((entry) => <li key={entry.id}>{entry.label} — {formatMoney(entry.amount)} ({entry.percent}) {entry.invoiceId ? "· invoiced" : "· pending"}</li>)}</ul></section>}</article>}</div>;
}

function InvoicesPanel({ invoices, loading }: { invoices: Invoice[]; loading: boolean }) { return <div role="tabpanel"><h2>Invoices</h2>{loading ? <p className="portal-status">Loading invoices.</p> : invoices.length === 0 ? <p>No invoices yet.</p> : <table className="portal-table"><thead><tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Due</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td>{invoice.id.slice(0, 8)}{invoice.kind === "retainage_release" ? " · retainage release" : ""}</td><td>{formatMoney(invoice.amount)}{invoice.retainage?.amountMinor ? ` (withheld ${formatMoney(invoice.retainage)})` : ""}</td><td>{invoice.status}</td><td>{formatDate(invoice.dueDate)}</td></tr>)}</tbody></table>}</div>; }

function ProjectsPanel({ projects, loading }: { projects: Project[]; loading: boolean }) { return <div role="tabpanel"><h2>Projects and milestones</h2>{loading ? <p className="portal-status">Loading projects.</p> : projects.length === 0 ? <p>No projects yet.</p> : <div className="portal-resource-list">{projects.map((project) => <article className="portal-resource-card" key={project.id}><div className="portal-document-header"><h3>{project.title}</h3><span className="portal-status-badge">{project.status}</span></div>{project.milestones.length === 0 ? <p className="portal-muted">No milestones yet.</p> : <ul>{project.milestones.map((milestone) => <li key={milestone.id}><strong>{milestone.title}</strong> — {milestone.status}{milestone.dueDate ? ` · due ${milestone.dueDate}` : ""}<br />{milestone.description}</li>)}</ul>}</article>)}</div>}</div>; }

function OptionPicker({ proposal, onUpdated }: { proposal: Proposal; onUpdated: () => Promise<void> }) {
  const [ids, setIds] = useState(proposal.options.filter((option) => option.selected || option.selection === "required").map((option) => option.id));
  const [impact, setImpact] = useState("");
  const [error, setError] = useState("");
  const base = proposal.pricing.amountMinor ?? 0;
  const chosen = new Set(ids);
  for (const option of proposal.options) if (option.selection === "required") chosen.add(option.id);
  const total = base + proposal.options.reduce((sum, option) => sum + (chosen.has(option.id) ? option.priceDelta.amountMinor : 0), 0);
  const groups = new Map<string, Proposal["options"]>();
  for (const option of proposal.options) {
    const key = option.groupId ?? option.id;
    groups.set(key, [...(groups.get(key) ?? []), option]);
  }

  function toggle(option: Proposal["options"][number], checked: boolean) {
    if (option.selection === "required") return;
    const group = proposal.options.filter((item) => item.groupId && item.groupId === option.groupId);
    if (option.groupMode === "single" && group.length > 0) {
      setIds([option.id, ...proposal.options.filter((item) => item.selection === "required" && item.groupId !== option.groupId).map((item) => item.id), ...ids.filter((id) => !group.some((item) => item.id === id))]);
      return;
    }
    setIds(checked ? [...ids, option.id] : ids.filter((id) => id !== option.id));
  }

  async function save(apply = false) {
    try {
      const result = await portalApi<{ needsImpact?: boolean; preview?: { sentence?: string }; totalMinor: number }>(`/api/v1/proposals/${proposal.id}/options/selection`, { method: "POST", body: JSON.stringify({ optionIds: [...chosen], apply }) });
      if (result.needsImpact && result.preview?.sentence) { setImpact(result.preview.sentence); return; }
      setImpact("");
      setError("");
      await onUpdated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The selection could not be saved."); }
  }

  return <section aria-label="Options"><h3>Options</h3><p>Total {formatMinor(total, proposal.pricing.currency)}.</p>{[...groups.values()].map((group) => <fieldset key={group[0]?.groupId ?? group[0]?.id}><legend>{group[0]?.groupName ?? "Items"}</legend>{group.map((option) => <label key={option.id}><input type={option.groupMode === "single" ? "radio" : "checkbox"} name={option.groupId ?? option.id} checked={chosen.has(option.id)} disabled={option.selection === "required"} onChange={(event) => toggle(option, event.target.checked)} /> {option.label} — {option.description} ({option.selection ?? "optional"}, {formatMinor(option.priceDelta.amountMinor, option.priceDelta.currency)})</label>)}</fieldset>)}{error && <p className="portal-error" role="alert">{error}</p>}{impact && <p>{impact}</p>}<button type="button" onClick={() => { void save(Boolean(impact)); }}>{impact ? "Apply selection" : "Save selection"}</button></section>;
}

function weeksPhrase(count: number, label: string) {
  return `${label}: ${count} week${count === 1 ? "" : "s"}`;
}

function phaseEstimate(phase: TimelinePhase) {
  const parts: string[] = [];
  if (typeof phase.weeksLow === "number") {
    const extra = typeof phase.endsWeekLow === "number" && phase.endsWeekLow !== phase.weeksLow ? ` (ends week ${phase.endsWeekLow})` : "";
    parts.push(`${weeksPhrase(phase.weeksLow, "Low estimate")}${extra}`);
  }
  if (typeof phase.weeksHigh === "number") {
    const extra = typeof phase.endsWeekHigh === "number" ? ` (ends week ${phase.endsWeekHigh})` : "";
    parts.push(`${weeksPhrase(phase.weeksHigh, "High estimate")}${extra}`);
  }
  return parts.join(". ");
}

function PhaseList({ phases }: { phases: TimelinePhase[] }) {
  if (!phases.length) return <p className="portal-muted">No phases saved yet.</p>;
  return <ul>{phases.map((phase) => (
    <li key={phase.id}>
      <strong>{phase.title}</strong>{phase.dueDate ? ` — ${phase.dueDate}` : ""}
      {phaseEstimate(phase) ? <><br />{phaseEstimate(phase)}</> : null}
      {phase.gate ? <><br />Gate: {phase.gate}</> : null}
      {phase.description ? <><br />{phase.description}</> : null}
    </li>
  ))}</ul>;
}

function RoleTable({ roles, phases }: { roles: ProposalRole[]; phases: TimelinePhase[] }) {
  if (!roles.length) return null;
  const titles = new Map(phases.map((phase) => [phase.id, phase.title] as const));
  const label = (item: string) => item === "all" ? "All phases" : item === "gates" ? "Gates" : titles.get(item) ?? item;
  return (
    <section>
      <h3>Roles</h3>
      <table className="portal-table">
        <thead><tr><th>Who</th><th>Role in the project</th><th>Heaviest in</th></tr></thead>
        <tbody>{roles.map((role) => (
          <tr key={role.id}>
            <td>{role.name}</td>
            <td>{role.responsibility}</td>
            <td>{role.heaviestIn.map(label).join(", ")}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

function phaseLine(phase: TimelinePhase) {
  const range = typeof phase.weeksLow === "number" || typeof phase.weeksHigh === "number" ? `${phase.weeksLow ?? ""}-${phase.weeksHigh ?? ""}` : "";
  return `${phase.title} | ${phase.dueDate ?? ""} | ${range} | ${phase.gate ?? ""} | ${phase.description}`;
}

function parsePhaseLine(row: string) {
  const parts = row.split("|").map((item) => item.trim());
  if (parts.length >= 5) {
    const [title, dueDate, range, gate, ...rest] = parts;
    const [low, high] = (range ?? "").split("-").map((item) => item.trim());
    const weeksLow = low && Number.isInteger(Number(low)) ? Number(low) : undefined;
    const weeksHigh = high && Number.isInteger(Number(high)) ? Number(high) : undefined;
    return { title, dueDate: dueDate || null, weeksLow, weeksHigh, gate, description: rest.join(" | ") };
  }
  const [title, dueDate, ...description] = parts;
  return { title, dueDate: dueDate || null, description: description.join(" | ") || title };
}

function ProposalDocument({ proposal, roles, review, draft, saving, openPart, narratives, onEdit, onCancel, onSave, onDraftChange, onSubmit, onReviewChanged, onOpenPart, onClosePart, onNarrativeSaved }: { proposal: Proposal; roles: ProposalRole[]; review: ReviewWorkspace | null; draft: ProposalDraft | null; saving: boolean; openPart: string | null; narratives: NarrativeSection[]; onEdit: () => void; onCancel: () => void; onSave: (event: FormEvent<HTMLFormElement>) => void; onDraftChange: (draft: ProposalDraft) => void; onSubmit: () => void; onReviewChanged: () => Promise<void>; onOpenPart: (key: string) => void; onClosePart: () => void; onNarrativeSaved: (sections: NarrativeSection[]) => void }) {
  const [progressTick, setProgressTick] = useState(0);
  if (draft) return <form className="portal-editor" onSubmit={onSave}><div className="portal-editor-header"><h2>Edit proposal</h2><span>Version {proposal.version}</span></div>
    <label>Title<input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} required /></label>
    <label>Summary<textarea value={draft.summary} onChange={(event) => onDraftChange({ ...draft, summary: event.target.value })} required /></label>
    <label>Deliverables <span className="portal-help">One per line</span><textarea value={draft.deliverables} onChange={(event) => onDraftChange({ ...draft, deliverables: event.target.value })} required /></label>
    <label>Assumptions <span className="portal-help">One per line</span><textarea value={draft.assumptions} onChange={(event) => onDraftChange({ ...draft, assumptions: event.target.value })} /></label>
    <label>Exclusions <span className="portal-help">One per line</span><textarea value={draft.exclusions} onChange={(event) => onDraftChange({ ...draft, exclusions: event.target.value })} /></label>
    <div className="portal-form-row"><label>Start date<input type="date" value={draft.startDate} onChange={(event) => onDraftChange({ ...draft, startDate: event.target.value })} /></label><label>Target date<input type="date" value={draft.targetDate} onChange={(event) => onDraftChange({ ...draft, targetDate: event.target.value })} /></label></div>
    <label>Phases <span className="portal-help">One per line: title | YYYY-MM-DD | low-high weeks | gate | description</span><textarea value={draft.milestones} onChange={(event) => onDraftChange({ ...draft, milestones: event.target.value })} /></label>
    <label>Roles <span className="portal-help">One per line: name | unwhelm or client | responsibility | heaviest (all, gates, or phase ids)</span><textarea value={draft.roles} onChange={(event) => onDraftChange({ ...draft, roles: event.target.value })} /></label>
    <label>Pricing JSON <textarea className="portal-code" value={draft.pricing} onChange={(event) => onDraftChange({ ...draft, pricing: event.target.value })} /></label>
    <div className="portal-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save proposal"}</button></div>
  </form>;
  const canEdit = !review || review.clientEditable || review.state === "approved";
  return <article className="portal-proposal-document" aria-label="Proposal document"><div className="portal-document-header"><div><p className="eyebrow">{proposal.engagement.replaceAll("_", " ")}</p><h2>{proposal.title}</h2></div><span className="portal-status-badge">{review?.clientLabel ?? proposal.status}</span></div><VersionStamp version={proposal.version} updatedAt={proposal.updatedAt} /><p className="portal-muted">Updates from your assistant appear here automatically.</p>
    {review?.state === "approved" && <AcceptancePanel proposalId={proposal.id} approved api={portalApi} />}
    <div className="portal-actions" aria-label="Proposal exports">
      <a className="button" href={`/api/v1/proposals/${proposal.id}/pdf`} download={`unwhelm-proposal-${proposal.id.slice(0, 8)}.pdf`}>Download proposal PDF</a>
    </div>
    <section><h3>Overview</h3><p>{proposal.scope.summary}</p></section><section><h3>Deliverables</h3><List items={proposal.scope.deliverables} /></section><section><h3>Assumptions</h3><List items={proposal.scope.assumptions} /></section><section><h3>Exclusions</h3><List items={proposal.scope.exclusions} /></section>
    <section><h3>Timeline</h3><p>{proposal.timeline.startDate ? `Starts ${proposal.timeline.startDate}. ` : ""}{proposal.timeline.targetDate ? `Target date ${proposal.timeline.targetDate}.` : "No target date set."}</p><PhaseList phases={proposal.timeline.milestones} /></section>
    <RoleTable roles={roles} phases={proposal.timeline.milestones} />
    <section><h3>Investment</h3><p>{priceText(proposal.pricing)}</p></section>
    <ProposalDocuments proposalId={proposal.id} canWrite={canEdit} />
    {review && review.versions.length > 1 && <WhatChanged proposalId={proposal.id} versions={review.versions} api={portalApi} />}
    {proposal.options.length > 0 && <OptionPicker proposal={proposal} onUpdated={onReviewChanged} />}
    {narratives.length > 0 && narratives.map((section) => (
      <section key={section.key} id={`part-${section.key}`}>
        <h3>{section.title}</h3>
        {section.text ? <p className="portal-pre">{section.text}</p> : <p className="portal-muted">No text saved for this part yet.</p>}
      </section>
    ))}
    {openPart && <PartDetail proposal={proposal} partKey={openPart} narratives={narratives} canEdit={canEdit} onEdit={onEdit} onClose={onClosePart} onSaved={(sections) => { onNarrativeSaved(sections); setProgressTick((value) => value + 1); }} />}
    <ProgressPanel key={`${proposal.id}-${progressTick}-${proposal.version}-${proposal.updatedAt}-${narratives.map((section) => `${section.key}:${section.updatedAt}`).join(",")}`} proposalId={proposal.id} api={portalApi} onSubmit={!review && proposal.status === "draft" ? onSubmit : undefined} onOpenPart={onOpenPart} />
    <RemindersPanel proposalId={proposal.id} api={portalApi} unfinished={proposal.status !== "closed" && (!review || review.state === "client_revising" || review.state === "draft")} />
    {review && <ClientReviewActions workspace={review} api={portalApi} onChanged={onReviewChanged} />}
    <div className="portal-actions">{canEdit && <button type="button" onClick={onEdit}>Edit proposal</button>}{!review && proposal.status === "draft" && <button className="button button-primary" type="button" onClick={onSubmit}>Submit for review</button>}</div>
  </article>;
}

function partTitle(proposal: Proposal, partKey: string, narratives: NarrativeSection[]) {
  return narratives.find((item) => item.key === partKey)?.title
    ?? { scope: "Scope", hours: "Hours", price: "Price", options: "Options", milestones: "Milestones", schedule: "Schedule", terms: "Terms" }[partKey]
    ?? partKey.replaceAll("_", " ");
}

function PartDetail({ proposal, partKey, narratives, canEdit, onEdit, onClose, onSaved }: { proposal: Proposal; partKey: string; narratives: NarrativeSection[]; canEdit: boolean; onEdit: () => void; onClose: () => void; onSaved: (sections: NarrativeSection[]) => void }) {
  const narrative = narratives.find((item) => item.key === partKey);
  const structured = ["scope", "hours", "price", "options", "milestones", "schedule"].includes(partKey);
  const [text, setText] = useState(narrative?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draftNote, setDraftNote] = useState<{ gaps: Array<{ requirementId: string; text: string }>; sources: Array<{ title: string; version: number }> } | null>(null);
  const [settled, setSettled] = useState(narrative?.state === "agreed" || narrative?.state === "locked");
  const lastText = useRef({ key: partKey, text: narrative?.text ?? "" });
  useEffect(() => {
    const previous = lastText.current;
    const next = narrative?.text ?? "";
    setText((current) => previous.key !== partKey || current === previous.text ? next : current);
    lastText.current = { key: partKey, text: next };
    setSettled(narrative?.state === "agreed" || narrative?.state === "locked");
    setDraftNote(null);
  }, [narrative?.text, narrative?.state, partKey]);
  async function draftFromLibrary() {
    setSaving(true); setError("");
    try {
      const result = await portalApi<{ text: string; gaps: Array<{ requirementId: string; text: string }>; citations: Array<{ title: string; version: number }> }>(`/api/v1/proposals/${proposal.id}/sections/${encodeURIComponent(partKey)}/draft`, { method: "POST", body: JSON.stringify({ apply: true }) });
      setText(result.text);
      lastText.current = { key: partKey, text: result.text };
      setDraftNote({ gaps: result.gaps, sources: result.citations });
      onSaved(narratives.map((item) => item.key === partKey ? { ...item, text: result.text, state: item.state === "open" ? "drafted" : item.state } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not draft that part.");
    } finally { setSaving(false); }
  }
  async function saveNarrative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const updated = await portalApi<NarrativeSection>(`/api/v1/proposals/${proposal.id}/narrative/${encodeURIComponent(partKey)}`, { method: "PUT", body: JSON.stringify({ text }) });
      onSaved(narratives.map((item) => item.key === partKey ? { ...item, ...updated, text } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save that part.");
    } finally { setSaving(false); }
  }
  async function agreePart() {
    setSaving(true); setError("");
    try {
      await portalApi(`/api/v1/proposals/${proposal.id}/completion/nodes/${encodeURIComponent(partKey)}/state`, { method: "POST", body: JSON.stringify({ state: "agreed" }) });
      setSettled(true);
      onSaved(narratives.map((item) => item.key === partKey ? { ...item, state: "agreed" } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not agree to that part.");
    } finally { setSaving(false); }
  }
  return (
    <section className="portal-part-view" aria-label={`${partTitle(proposal, partKey, narratives)} details`} id={`part-detail-${partKey}`}>
      <div className="portal-document-header">
        <h3>{partTitle(proposal, partKey, narratives)}</h3>
        <button type="button" className="portal-link" onClick={onClose}>Close</button>
      </div>
      {partKey === "scope" && (
        <>
          <p>{proposal.scope.summary}</p>
          <h4>Deliverables</h4><List items={proposal.scope.deliverables} />
          <h4>Assumptions</h4><List items={proposal.scope.assumptions} />
          <h4>Exclusions</h4><List items={proposal.scope.exclusions} />
        </>
      )}
      {partKey === "schedule" && <p>{proposal.timeline.startDate ? `Starts ${proposal.timeline.startDate}. ` : "No start date set. "}{proposal.timeline.targetDate ? `Target date ${proposal.timeline.targetDate}.` : "No target date set."}</p>}
      {partKey === "milestones" && <PhaseList phases={proposal.timeline.milestones} />}
      {partKey === "hours" && <p>{typeof proposal.pricing.hours === "number" ? `${proposal.pricing.hours} hours.` : "Hours are not set yet."}</p>}
      {partKey === "price" && <p>{priceText(proposal.pricing)}</p>}
      {partKey === "options" && (proposal.options.length ? <ul>{proposal.options.map((option) => <li key={option.id}><strong>{option.label}</strong> — {option.description}</li>)}</ul> : <p className="portal-muted">No options on this proposal.</p>)}
      {narrative && narrative.text && (structured || !canEdit) && partKey !== "scope" ? <p className="portal-pre">{narrative.text}</p> : null}
      {!structured && !narrative?.text && !canEdit && <p className="portal-muted">No text saved for this part yet.</p>}
      {(narrative?.state || settled) && <p className="portal-muted">Status: {narrative?.state === "locked" ? "Locked" : settled || narrative?.state === "agreed" ? "Agreed" : narrative?.state === "drafted" ? "Drafted" : narrative?.state === "open" ? "Not started" : (narrative?.state ?? "open").replaceAll("_", " ")}.</p>}
      {error && <p className="portal-error" role="alert">{error}</p>}
      {!structured && canEdit && narrative && (
        <form onSubmit={saveNarrative}>
          {narrative.guidance && <p className="portal-help">{narrative.guidance}</p>}
          <label>
            Wording
            <textarea rows={12} value={text} onChange={(event) => setText(event.target.value)} maxLength={narrative.maxChars} required />
          </label>
          <p className="portal-help">Save keeps this wording. Agree marks the part settled. Draft from approved answers uses the library only and leaves a named gap where nothing approved matches.</p>
          {draftNote && (
            <div>
              {draftNote.sources.length > 0 && <p className="portal-help">Cited: {draftNote.sources.map((source) => `${source.title} v${source.version}`).join(", ")}.</p>}
              {draftNote.gaps.length > 0 && <ul>{draftNote.gaps.map((gap) => <li key={gap.requirementId}>Gap: {gap.text}</li>)}</ul>}
            </div>
          )}
          <div className="portal-actions">
            <button className="button button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save this part"}</button>
            <button type="button" onClick={() => { void draftFromLibrary(); }} disabled={saving}>Draft from approved answers</button>
            {!settled && <button type="button" onClick={() => { void agreePart(); }} disabled={saving}>Agree to this part</button>}
          </div>
        </form>
      )}
      {(structured || !narrative) && canEdit && (
        <div className="portal-actions">
          {structured && <button type="button" onClick={onEdit}>Edit proposal</button>}
          {!settled && <button type="button" className="button button-primary" onClick={() => { void agreePart(); }} disabled={saving}>Agree to this part</button>}
        </div>
      )}
    </section>
  );
}

type ProposalAttachment = { id: string; filename: string; contentType: string; byteSize: number; sha256: string; sourceUrl?: string | null; sortOrder: number; createdAt: string; updatedAt: string };

function ProposalDocuments({ proposalId, canWrite }: { proposalId: string; canWrite: boolean }) {
  const [items, setItems] = useState<ProposalAttachment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<{ item: ProposalAttachment; markdown?: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  async function reload() {
    const loaded = await portalApi<{ items: ProposalAttachment[] }>(`/api/v1/proposals/${proposalId}/attachments`);
    setItems(loaded.items);
  }

  useEffect(() => {
    let cancelled = false;
    portalApi<{ items: ProposalAttachment[] }>(`/api/v1/proposals/${proposalId}/attachments`)
      .then((loaded) => { if (!cancelled) setItems(loaded.items); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load documents."); });
    return () => { cancelled = true; };
  }, [proposalId]);

  useEffect(() => {
    if (viewer) closeRef.current?.focus();
  }, [viewer]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That document change failed."); }
    finally { setBusy(false); }
  }

  async function upload(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    await portalApi(`/api/v1/proposals/${proposalId}/attachments`, { method: "POST", body: JSON.stringify({ filename: file.name, contentBase64: btoa(binary) }) });
    await reload();
  }

  async function remove(id: string) {
    await portalApi(`/api/v1/proposals/${proposalId}/attachments/${id}`, { method: "DELETE" });
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function move(index: number, delta: number) {
    const next = [...items];
    const swap = index + delta;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    const ordered = await portalApi<{ items: ProposalAttachment[] }>(`/api/v1/proposals/${proposalId}/attachments/order`, { method: "PUT", body: JSON.stringify({ ids: next.map((item) => item.id) }) });
    setItems(ordered.items);
  }

  async function open(item: ProposalAttachment) {
    const path = `/api/v1/proposals/${proposalId}/attachments/${item.id}`;
    if (item.contentType === "text/markdown" || item.filename.toLowerCase().endsWith(".md")) {
      const response = await fetch(path, { credentials: "include" });
      if (!response.ok) throw new Error("Could not open that document.");
      setViewer({ item, markdown: await response.text() });
      return;
    }
    setViewer({ item });
  }

  function onDialogKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") setViewer(null);
  }

  return (
    <section>
      <h3>Documents</h3>
      {error && <p className="portal-error" role="alert">{error}</p>}
      {items.length === 0 ? <p className="portal-muted">No documents attached yet.</p> : (
        <ul className="portal-attachment-list">
          {items.map((item, index) => (
            <li key={item.id}>
              {item.sourceUrl
                ? <a className="portal-link" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.filename}</a>
                : <button type="button" className="portal-link" onClick={() => { void run(() => open(item)); }}>{item.filename}</button>}
              <span className="portal-help">{item.sourceUrl ? "Link" : item.contentType === "application/pdf" ? "PDF" : "Markdown"}</span>
              {canWrite && (
                <span className="portal-attachment-actions">
                  <button type="button" disabled={busy || index === 0} onClick={() => { void run(() => move(index, -1)); }}>Up</button>
                  <button type="button" disabled={busy || index === items.length - 1} onClick={() => { void run(() => move(index, 1)); }}>Down</button>
                  <button type="button" disabled={busy} onClick={() => { void run(() => remove(item.id)); }}>Remove</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <label className="portal-file">Add a PDF or Markdown file
          <input type="file" accept=".pdf,.md,application/pdf,text/markdown" disabled={busy} onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void run(() => upload(file));
          }} />
        </label>
      )}
      {viewer && (
        <div className="portal-attachment-dialog" role="dialog" aria-modal="true" aria-labelledby="attachment-dialog-title" tabIndex={-1} onKeyDown={onDialogKey}>
          <div className="portal-attachment-dialog-panel">
            <div className="portal-document-header">
              <h4 id="attachment-dialog-title">{viewer.item.filename}</h4>
              <button ref={closeRef} type="button" className="portal-link" onClick={() => setViewer(null)}>Close</button>
            </div>
            <p className="portal-attachment-download"><a href={`/api/v1/proposals/${proposalId}/attachments/${viewer.item.id}`} download={viewer.item.filename}>Download</a></p>
            {viewer.markdown !== undefined
              ? <div className="portal-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{viewer.markdown}</ReactMarkdown></div>
              : <iframe className="portal-attachment-frame" title={viewer.item.filename} src={`/api/v1/proposals/${proposalId}/attachments/${viewer.item.id}`} />}
          </div>
        </div>
      )}
    </section>
  );
}

function List({ items }: { items: string[] }) { return items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="portal-muted">None listed.</p>; }
function lines(value: string) { return value.split("\n").map((item) => item.trim()).filter(Boolean); }
function formatDate(value: string) { return new Date(value).toLocaleDateString(); }
function priceText(pricing: Proposal["pricing"]) { if (pricing.model === "hourly") return `${formatMinor(pricing.rateMinor ?? 0, pricing.currency)}/hour`; return formatMinor(pricing.amountMinor ?? 0, pricing.currency); }
function formatMinor(amount: number, currency: string) { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100); }
function formatMoney(value: { amountMinor: number; currency: string }) { return formatMinor(value.amountMinor, value.currency); }
