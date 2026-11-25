import { useEffect, useState } from "react";

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;

export type ProgressPart = { key: string; label: string; state: string; stateLabel: string; group: string; settled: boolean; whatsLeft: string; toDiscuss: boolean; note: string | null; reopenedBy: { source: string; change: string } | null; dependsOn: string[] };
export type ProposalProgressView = {
  settled: number;
  toDiscuss: number;
  total: number;
  headline: string;
  phrase: string;
  percent: number;
  groups: Array<{ code: string; label: string; settled: boolean; parts: ProgressPart[] }>;
  nextStep: { key: string | null; text: string };
  savedForLater: { heading: string; note: string; items: Array<{ id: string; summary: string }> };
  sinceLastVisit: { direction: "down" | "up"; before: number; after: number; text: string } | null;
  lastSeenAt: string | null;
  resolutions: Array<{ code: string; label: string; flagsForCall: boolean }>;
  statuses?: Array<{ code: string; label: string }>;
  handoff: { ready: boolean; heading: string; body: string; submitLabel: string; reasons: Array<{ code: string; label: string; note: string | null }>; openParts: string[]; draftedParts?: string[]; reopenedParts?: string[]; discussParts: string[]; openSummary: string };
};

/** Proposal progress: "N of M parts settled" with a plain phrase, parts grouped by state, the next step, and what changed since the last visit. */
export function ProgressPanel({ proposalId, api, audience = "client", onSubmit, onOpenPart }: { proposalId: string; api: Api; audience?: "client" | "staff"; onSubmit?: () => void; onOpenPart?: (key: string) => void }) {
  const [view, setView] = useState<ProposalProgressView | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  async function resolve(nodeKey: string, resolution: string) {
    setError("");
    try { await api(`/api/v1/proposals/${proposalId}/completion/nodes/${encodeURIComponent(nodeKey)}/resolve`, { method: "POST", body: JSON.stringify({ resolution }) }); setReload((value) => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That could not be saved."); }
  }
  async function setStatus(nodeKey: string, state: string) {
    setError("");
    try { await api(`/api/v1/proposals/${proposalId}/completion/nodes/${encodeURIComponent(nodeKey)}/state`, { method: "POST", body: JSON.stringify({ state }) }); setReload((value) => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That could not be saved."); }
  }
  useEffect(() => {
    let cancelled = false;
    api<ProposalProgressView>(`/api/v1/proposals/${proposalId}/progress`)
      .then((value) => {
        if (cancelled) return;
        setView(value);
        void api(`/api/v1/proposals/${proposalId}/progress/seen`, { method: "POST", body: "{}" }).catch(() => undefined);
      })
      .catch(() => { if (!cancelled) setView(null); });
    return () => { cancelled = true; };
  }, [proposalId, api, reload]);
  if (!view) return null;
  const drafted = view.groups.filter((group) => group.code === "in_progress").reduce((count, group) => count + group.parts.length, 0);
  const share = (count: number) => (view.total === 0 ? 0 : Math.round((count / view.total) * 100));
  const draftedPct = share(drafted);
  const completePct = share(view.settled);
  return (
    <section className="review-panel progress-panel" aria-label="Proposal progress" data-audience={audience}>
      <div className="progress-summary">
        <div>
          <p className="eyebrow">{view.phrase}</p>
          <h3>{view.headline}</h3>
        </div>
      </div>
      <div className="progress-meters">
        <div>
          <div className="progress-meter-label"><span>Drafted</span><span>{drafted} of {view.total}</span></div>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={draftedPct} aria-label={`Drafted, ${drafted} of ${view.total}`}>
            <span className="progress-fill-draft" style={{ width: `${draftedPct}%` }} />
          </div>
        </div>
        <div>
          <div className="progress-meter-label"><span>Complete</span><span>{view.settled} of {view.total}</span></div>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completePct} aria-label={`Complete, ${view.settled} of ${view.total}`}>
            <span style={{ width: `${completePct}%` }} />
          </div>
        </div>
      </div>
      {view.sinceLastVisit && (
        <p className={`progress-delta progress-delta-${view.sinceLastVisit.direction}`} role="status">{view.sinceLastVisit.text}</p>
      )}
      {view.handoff.ready && (
        <div className="progress-handoff" role="region" aria-label={view.handoff.heading}>
          <div>
            <strong>{view.handoff.heading}</strong>
            <p>{view.handoff.body}</p>
            <ul>{view.handoff.reasons.map((reason) => <li key={reason.code}>{reason.label}{reason.note ? `: ${reason.note}` : ""}</li>)}</ul>
          </div>
          {audience === "client" && onSubmit && <button className="button button-primary" type="button" onClick={onSubmit}>{view.handoff.submitLabel}</button>}
        </div>
      )}
      {audience === "staff" && (view.handoff.discussParts.length > 0 || Boolean(view.handoff.openSummary)) && (
        <div className="progress-review-call" aria-label="For the review call">
          <strong>For the review call</strong>
          {view.handoff.discussParts.length > 0 && <p>Client unsure: {view.handoff.discussParts.join(", ")}</p>}
          {view.handoff.openSummary && <p>{view.handoff.openSummary}</p>}
        </div>
      )}
      {error && <p className="portal-error" role="alert">{error}</p>}
      <div className="progress-next" aria-label="Next best step">
        <strong>Next best step</strong>
        <p>{view.nextStep.text}</p>
      </div>
      <ol className="progress-groups">
        {view.groups.map((group) => (
          <li key={group.code} className={`progress-group progress-group-${group.code}`}>
            <h4>{group.label} <span className="portal-muted">({group.parts.length})</span></h4>
            <ul className="progress-parts">
              {group.parts.map((part) => (
                <li key={part.key} className={`progress-part${part.settled ? " is-settled" : ""}${view.nextStep.key === part.key ? " is-next" : ""}`}>
                  <span className="progress-mark" aria-hidden="true">{part.toDiscuss ? "?" : part.settled ? "✓" : group.code === "reopened" ? "↺" : "○"}</span>
                  <div>
                    {onOpenPart ? <button type="button" className="portal-link progress-part-link" onClick={() => onOpenPart(part.key)}>{part.label}</button> : <strong>{part.label}</strong>}
                    <p>{part.whatsLeft}</p>
                    {part.note && <p className="portal-muted">“{part.note}”</p>}
                  </div>
                  {audience === "client" && part.state !== "locked" && (
                    <select
                      className="progress-resolve"
                      aria-label={`Status of ${part.label}`}
                      value={part.state}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value || value === part.state) return;
                        if (view.resolutions.some((item) => item.code === value)) void resolve(part.key, value);
                        else void setStatus(part.key, value);
                      }}
                    >
                      <optgroup label="Status">
                        {(view.statuses ?? [{ code: "open", label: "Not started" }, { code: "drafted", label: "Drafted" }]).some((item) => item.code === part.state) ? null : <option value={part.state}>{part.stateLabel}</option>}
                        {(view.statuses ?? [{ code: "open", label: "Not started" }, { code: "drafted", label: "Drafted" }]).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                      </optgroup>
                      {view.resolutions.length > 0 && (
                        <optgroup label="Need help">
                          {view.resolutions.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                        </optgroup>
                      )}
                    </select>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {view.savedForLater.items.length > 0 && (
        <div className="progress-later">
          <h4>{view.savedForLater.heading}</h4>
          <p className="portal-muted">{view.savedForLater.note}</p>
          <ul>{view.savedForLater.items.map((item) => <li key={item.id}>{item.summary}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
