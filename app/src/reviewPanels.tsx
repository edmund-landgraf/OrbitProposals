import { useEffect, useState, type FormEvent } from "react";
import { ProgressPanel } from "./progressPanel";
import { markdownViewerPath } from "./documents";

export type ReviewComment = {
  id: string;
  parentId: string | null;
  targetKind: string;
  targetId: string | null;
  type: string;
  status: string;
  visibility: string;
  authorRole: string;
  body: string;
  createdAt: string;
};

export type ReviewFlag = {
  id: string;
  targetKind: string;
  targetId: string | null;
  kind: string;
  reason: string;
  status: string;
  visibility: string;
  authorRole: string;
  blocksApproval: boolean;
  automatic: boolean;
};

export type ReviewTransition = {
  to: string;
  action: string;
  label: string;
  requiresComment: boolean;
  requiresReason: boolean;
};

export type ReviewWorkspace = {
  proposalId: string;
  state: string;
  clientLabel: string;
  staffLabel: string;
  clientEditable: boolean;
  approvedVersionId: string | null;
  meeting: { scheduledAt: string; link: string | null; notes: string | null } | null;
  comments: ReviewComment[];
  flags: ReviewFlag[];
  events: Array<{ id: string; actorRole: string; from: string; to: string; reasonCode: string | null; reasonText: string | null; createdAt: string }>;
  versions: Array<{ id: string; number: number; locked: boolean; createdAt: string; reason: string | null }>;
  allowedTransitions: ReviewTransition[];
  commentTypes: Array<{ code: string; blocksApproval: boolean }>;
  reasonCodes: Array<{ code: string; label: string; actions: string[] }>;
  visibilities: string[];
};

export type ReviewQueueItem = { id: string; title: string; state: string; clientLabel: string; staffLabel: string; updatedAt: string };

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;

type CompletionTree = {
  percent: number;
  nodes: Array<{ key: string; title: string; clientLabel: string; stateLabel: string; parentKey: string | null }>;
  edges: Array<{ fromKey: string; toKey: string }>;
};

export function ParkedItems({ proposalId, api }: { proposalId: string; api: Api }) {
  const [items, setItems] = useState<Array<{ id: string; summary: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    api<{ items: Array<{ id: string; summary: string }> }>(`/api/v1/proposals/${proposalId}/parked-items`)
      .then((value) => { if (!cancelled) setItems(value.items); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [proposalId, api]);
  if (items.length === 0) return null;
  return (
    <section className="review-panel" aria-label="Parked for a follow-up proposal">
      <h3>Parked for a follow-up proposal</h3>
      <ul className="review-list">{items.map((item) => <li key={item.id}>{item.summary}</li>)}</ul>
    </section>
  );
}

export function CompletionPanel({ proposalId, api }: { proposalId: string; api: Api }) {
  const [tree, setTree] = useState<CompletionTree | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<CompletionTree>(`/api/v1/proposals/${proposalId}/completion`).then((value) => { if (!cancelled) setTree(value); }).catch(() => { if (!cancelled) setTree(null); });
    return () => { cancelled = true; };
  }, [proposalId, api]);
  if (!tree) return null;
  return (
    <section className="review-panel" aria-label="Completion">
      <h3>Completion {tree.percent}%</h3>
      <ul className="review-list">{tree.nodes.map((node) => <li key={node.key}>{node.title} · {node.stateLabel}</li>)}</ul>
    </section>
  );
}

type AcceptanceView = {
  contract: { id: string; terms: string; status: string; retainageHeldMinor?: number } | null;
  invoice: { id: string; amountMinor: number; currency: string; status: string; dueDate: string; creditAppliedMinor: number } | null;
};

export function AcceptancePanel({ proposalId, approved, api, audience = "client" }: { proposalId: string; approved: boolean; api: Api; audience?: "client" | "staff" }) {
  const [view, setView] = useState<AcceptanceView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [esign, setEsign] = useState<null | { enabled: boolean; provider: string; testMode?: boolean; request: null | { id: string; status: string; providerDocumentId: string; updatedAt: string; completedAt: string | null } }>(null);

  async function load() {
    try {
      setView(await api<AcceptanceView>(`/api/v1/proposals/${proposalId}/acceptance`));
      setError("");
    } catch { setView(null); }
  }

  useEffect(() => { if (approved) void load(); }, [approved, proposalId]);
  if (!approved) return null;

  async function accept() {
    setBusy(true);
    try {
      setView(await api<AcceptanceView>(`/api/v1/proposals/${proposalId}/accept`, { method: "POST", body: "{}" }));
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The proposal could not be accepted."); }
    finally { setBusy(false); }
  }

  async function sign(contractId: string) {
    setBusy(true);
    try {
      await api(`/api/v1/contracts/${contractId}/sign`, { method: "POST", body: "{}" });
      setConfirmed(false);
      await load();
      setEsign(null);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The contract could not be signed."); }
    finally { setBusy(false); }
  }

  async function loadEsign(contractId: string) {
    try { setEsign(await api(`/api/v1/contracts/${contractId}/esign/status`)); }
    catch { setEsign(null); }
  }

  async function sendEsign(contractId: string) {
    setBusy(true);
    try {
      await api(`/api/v1/contracts/${contractId}/esign/send`, { method: "POST", body: "{}" });
      await loadEsign(contractId);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The signature request could not be sent."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const contractId = view?.contract?.id;
    if (!contractId) return;
    void loadEsign(contractId);
  }, [audience, view?.contract?.id]);

  const money = view?.invoice ? new Intl.NumberFormat(undefined, { style: "currency", currency: view.invoice.currency }).format(view.invoice.amountMinor / 100) : "";
  return (
    <section className="review-panel" aria-label="Acceptance">
      <h3>Accept and sign</h3>
      <p className="portal-muted">This is the page the client accepts and signs. Accepting creates the contract. Signing records it here.{esign?.testMode ? " The external signature request is in test mode." : ""}</p>
      {error && <p className="portal-error" role="alert">{error}</p>}
      {view?.contract ? (
        <>
          <p>{view.contract.terms} is {view.contract.status}.{view.invoice ? ` First invoice ${view.invoice.id.slice(0, 8)} is ${money}, ${view.invoice.status}, due ${new Date(view.invoice.dueDate).toLocaleDateString()}.${view.invoice.creditAppliedMinor ? ` Workflow Check credit ${new Intl.NumberFormat(undefined, { style: "currency", currency: view.invoice.currency }).format(view.invoice.creditAppliedMinor / 100)}.` : ""}` : " No first invoice was due."}{view.contract.retainageHeldMinor ? ` Retainage held ${new Intl.NumberFormat(undefined, { style: "currency", currency: view.invoice?.currency ?? "USD" }).format(view.contract.retainageHeldMinor / 100)}.` : ""}</p>
          <div className="portal-actions" aria-label="Contract actions">
            <a className="button" href={`/api/v1/contracts/${view.contract.id}/pdf`} download={`unwhelm-contract-${view.contract.id.slice(0, 8)}.pdf`}>Download contract PDF</a>
            {audience === "client" && view.contract.status !== "signed" && view.contract.status !== "cancelled" ? (
              <form className="portal-editor" onSubmit={(event) => { event.preventDefault(); void sign(view.contract!.id); }}>
                <label>
                  <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I’m authorized to sign this contract for my organization.
                </label>
                <button className="button button-primary" type="submit" disabled={busy || !confirmed}>{busy ? "Signing…" : "Sign contract"}</button>
              </form>
            ) : null}
            {audience === "staff" && view.contract.status !== "signed" && view.contract.status !== "cancelled" ? (
              <div className="portal-editor" aria-label="External e-sign">
                <p className="portal-muted">External e-sign status: {esign?.request?.status ?? (esign?.enabled ? "not sent" : "disabled")}.</p>
                <div className="portal-actions">
                  <button className="button" type="button" disabled={busy || !esign?.enabled} onClick={() => { void sendEsign(view.contract!.id); }}>
                    {busy ? "Sending…" : `Send via ${esign?.provider ?? "e-sign"}${esign?.testMode ? " (test)" : ""}`}
                  </button>
                  {esign?.request?.status === "completed" ? (
                    <>
                      <a className="button" href={`/api/v1/contracts/${view.contract.id}/esign/artifacts/signed_pdf`} download={`unwhelm-signed-${view.contract.id.slice(0, 8)}.pdf`}>Signed PDF</a>
                      <a className="button" href={`/api/v1/contracts/${view.contract.id}/esign/artifacts/audit_pdf`} download={`unwhelm-audit-${view.contract.id.slice(0, 8)}.pdf`}>Audit PDF</a>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
            <p className="portal-muted">Hosted signing uses SignWell or PandaDoc. Notes for another provider (DocuSign, Adobe Sign, HelloSign) are in the <a href={markdownViewerPath("esignature_provider_integration.md")}>integration doc</a>.</p>
          </div>
        </>
      ) : audience === "client" ? (
        <button className="button button-primary" type="button" disabled={busy} onClick={() => { void accept(); }}>{busy ? "Accepting…" : "Accept proposal"}</button>
      ) : <p className="portal-muted">Waiting for the client to accept the locked version.</p>}
    </section>
  );
}

/** Turns a review comment into paragraphs and lists. A spaced hyphen (" - Item") starts a list item even when the agent left it in one paragraph. Ranges such as 8-14 stay inline. */
function commentBlocks(text: string) {
  const lines = text.replace(/[ \t]+-[ \t]+/g, "\n- ").split(/\n/);
  const blocks: Array<{ type: "p"; text: string } | { type: "ul"; items: string[] }> = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("- ")) {
      const item = line.slice(2).trim();
      const last = blocks.at(-1);
      if (last?.type === "ul") last.items.push(item || line);
      else blocks.push({ type: "ul", items: [item] });
    } else {
      const last = blocks.at(-1);
      if (last?.type === "p") last.text = `${last.text} ${line}`;
      else blocks.push({ type: "p", text: line });
    }
  }
  return blocks;
}

function CommentBody({ text }: { text: string }) {
  const blocks = commentBlocks(text);
  return (
    <div className="review-comment-body">
      {blocks.map((block, index) => block.type === "ul"
        ? <ul key={index}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
        : <p key={index}>{block.text}</p>)}
    </div>
  );
}

function clipChange(value: unknown) {
  const text = typeof value === "string" ? value : value == null ? "empty" : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

export function WhatChanged({ proposalId, versions, api }: { proposalId: string; versions: ReviewWorkspace["versions"]; api: Api }) {
  const ordered = [...versions].sort((left, right) => left.number - right.number);
  const from = ordered.at(-2);
  const to = ordered.at(-1);
  const [changes, setChanges] = useState<Array<{ path: string; before: unknown; after: unknown }>>([]);
  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    void api<{ changes: Array<{ path: string; before: unknown; after: unknown }> }>(`/api/v1/proposals/${proposalId}/review/diff?from=${from.number}&to=${to.number}`)
      .then((result) => { if (!cancelled) setChanges(result.changes); })
      .catch(() => { if (!cancelled) setChanges([]); });
    return () => { cancelled = true; };
  }, [api, proposalId, from?.number, to?.number]);
  if (!from || !to || changes.length === 0) return null;
  return (
    <section className="review-panel" aria-label="What changed">
      <h3>What changed</h3>
      <p className="portal-muted">Version {from.number} to version {to.number}. Parts that reopened are in the list.</p>
      <ul className="review-list">{changes.map((change) => <li key={change.path}><strong>{change.path}</strong>: {clipChange(change.before)} → {clipChange(change.after)}</li>)}</ul>
    </section>
  );
}

export function ReviewFeedback({ workspace, audience }: { workspace: ReviewWorkspace; audience: "staff" | "client" }) {
  const label = audience === "staff" ? workspace.staffLabel : workspace.clientLabel;
  const openComments = workspace.comments.filter((comment) => comment.status === "open");
  const openFlags = workspace.flags.filter((flag) => flag.status === "open");
  return (
    <section className="review-panel" aria-label="Review feedback">
      <div className="portal-document-header">
        <h3>Review</h3>
        <span className="portal-status-badge">{label}</span>
      </div>
      {workspace.meeting && <p>Review call {new Date(workspace.meeting.scheduledAt).toLocaleString()}{workspace.meeting.link ? ` · ${workspace.meeting.link}` : ""}{workspace.meeting.notes ? ` · ${workspace.meeting.notes}` : ""}</p>}
      {openFlags.length === 0 ? <p className="portal-muted">No open flags.</p> : (
        <ul className="review-list">{openFlags.map((flag) => <li key={flag.id}><strong>{flag.kind}</strong> · {flag.visibility} · {flag.reason}</li>)}</ul>
      )}
      {openComments.length === 0 ? <p className="portal-muted">No open comments.</p> : (
        <ul className="review-list">{openComments.map((comment) => (
          <li key={comment.id}>
            <strong>{comment.type}</strong> · {comment.authorRole} · {comment.targetKind}{comment.targetId ? ` ${comment.targetId}` : ""} · {comment.visibility}
            <CommentBody text={comment.body} />
            {workspace.comments.filter((reply) => reply.parentId === comment.id).map((reply) => (
              <div key={reply.id} className="review-reply"><span className="review-reply-author">{reply.authorRole}: </span><CommentBody text={reply.body} /></div>
            ))}
          </li>
        ))}</ul>
      )}
    </section>
  );
}

export function StaffReview({ item, workspace, api, onChanged }: { item: ReviewQueueItem; workspace: ReviewWorkspace; api: Api; onChanged: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [commentType, setCommentType] = useState(workspace.commentTypes[0]?.code ?? "pushback");
  const [visibility, setVisibility] = useState("client");
  const [targetKind, setTargetKind] = useState("proposal");
  const [targetId, setTargetId] = useState("");
  const [reasonCode, setReasonCode] = useState(workspace.reasonCodes[0]?.code ?? "");
  const [reasonText, setReasonText] = useState("");
  const [meetingAt, setMeetingAt] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [fromVersion, setFromVersion] = useState("");
  const [toVersion, setToVersion] = useState("");
  const [diff, setDiff] = useState<Array<{ path: string; before: unknown; after: unknown }>>([]);

  async function act(transition: ReviewTransition, event?: FormEvent) {
    event?.preventDefault();
    try {
      await api(`/api/v1/proposals/${item.id}/review/transition`, {
        method: "POST",
        body: JSON.stringify({
          to: transition.to,
          commentBody: comment,
          commentType,
          reasonCode: transition.requiresReason ? reasonCode : undefined,
          reasonText: reasonText || undefined,
          meetingAt: transition.action === "schedule_meeting" ? new Date(meetingAt).toISOString() : undefined,
          meetingLink: meetingLink || undefined,
        }),
      });
      setComment("");
      setError("");
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The review action failed."); }
  }

  async function postComment(event: FormEvent) {
    event.preventDefault();
    try {
      await api(`/api/v1/proposals/${item.id}/review/comments`, { method: "POST", body: JSON.stringify({ body: comment, type: commentType, visibility, targetKind, targetId: targetId.trim() || undefined }) });
      setComment("");
      setError("");
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The comment could not be saved."); }
  }

  async function resolve(commentId: string) {
    try {
      await api(`/api/v1/proposals/${item.id}/review/comments/${commentId}/resolve`, { method: "POST", body: JSON.stringify({}) });
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The comment could not be resolved."); }
  }

  async function loadDiff(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{ changes: Array<{ path: string; before: unknown; after: unknown }> }>(`/api/v1/proposals/${item.id}/review/diff?from=${fromVersion}&to=${toVersion}`);
      setDiff(result.changes);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The diff could not be loaded."); }
  }

  return (
    <article className="review-detail" aria-label="Proposal review">
      <div className="portal-document-header"><div><p className="eyebrow">REVIEW</p><h2>{item.title}</h2></div><span className="portal-status-badge">{workspace.staffLabel}</span></div>
      <ProgressPanel proposalId={item.id} api={api} audience="staff" />
      <AcceptancePanel proposalId={item.id} approved={workspace.state === "approved"} api={api} audience="staff" />
      {error && <p className="admin-error" role="alert">{error}</p>}
      <ReviewFeedback workspace={workspace} audience="staff" />
      <ul className="review-list">{workspace.comments.filter((entry) => entry.status === "open").map((entry) => <li key={`${entry.id}-resolve`}><button type="button" onClick={() => { void resolve(entry.id); }}>Resolve comment</button></li>)}</ul>
      <form className="admin-form" onSubmit={postComment}>
        <label>Comment<textarea value={comment} onChange={(event) => setComment(event.target.value)} required /></label>
        <label>Type<select value={commentType} onChange={(event) => setCommentType(event.target.value)}>{workspace.commentTypes.map((type) => <option key={type.code} value={type.code}>{type.code}</option>)}</select></label>
        <label>On<select value={targetKind} onChange={(event) => setTargetKind(event.target.value)}>{["proposal", "section", "field", "scope", "milestone", "pricing_line", "option"].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        {targetKind !== "proposal" && <label>Target (part key, field path, or id)<input value={targetId} onChange={(event) => setTargetId(event.target.value)} required={["section", "field", "milestone", "option", "pricing_line"].includes(targetKind)} placeholder={targetKind === "field" ? "scope.summary" : targetKind === "section" ? "executive_summary" : ""} /></label>}
        <label>Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value)}>{workspace.visibilities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <button type="submit">Add comment</button>
      </form>
      <div className="portal-actions">
        {workspace.allowedTransitions.map((transition) => transition.action === "schedule_meeting" ? (
          <form key={transition.to} className="admin-form" onSubmit={(event) => { void act(transition, event); }}>
            <label>Call time<input type="datetime-local" value={meetingAt} onChange={(event) => setMeetingAt(event.target.value)} required /></label>
            <label>Link<input value={meetingLink} onChange={(event) => setMeetingLink(event.target.value)} /></label>
            <button className="button button-primary" type="submit">{transition.label}</button>
          </form>
        ) : (
          <button key={transition.to} className="button button-primary" type="button" disabled={(transition.requiresComment && comment.trim() === "") || (transition.requiresReason && reasonCode === "")} onClick={() => { void act(transition); }}>{transition.label}</button>
        ))}
      </div>
      {workspace.allowedTransitions.some((transition) => transition.requiresReason) && (
        <div className="admin-form">
          <label>Reason<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>{workspace.reasonCodes.map((reason) => <option key={reason.code} value={reason.code}>{reason.label}</option>)}</select></label>
          <label>Reason note<input value={reasonText} onChange={(event) => setReasonText(event.target.value)} /></label>
        </div>
      )}
      {workspace.versions.length > 1 && (
        <form className="admin-form" onSubmit={loadDiff}>
          <label>From version<input value={fromVersion} onChange={(event) => setFromVersion(event.target.value)} required /></label>
          <label>To version<input value={toVersion} onChange={(event) => setToVersion(event.target.value)} required /></label>
          <button type="submit">Show changes</button>
        </form>
      )}
      {diff.length > 0 && <ul className="review-list">{diff.map((change) => <li key={change.path}><strong>{change.path}</strong>: {JSON.stringify(change.before)} → {JSON.stringify(change.after)}</li>)}</ul>}
      <h3>History</h3>
      <ul className="review-list">{workspace.events.map((event) => <li key={event.id}>{event.actorRole}: {event.from} → {event.to}{event.reasonCode ? ` (${event.reasonCode})` : ""}</li>)}</ul>
    </article>
  );
}

export function ClientReviewActions({ workspace, api, onChanged }: { workspace: ReviewWorkspace; api: Api; onChanged: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [parentId, setParentId] = useState(workspace.comments.find((comment) => comment.status === "open")?.id ?? "");
  const [reasonCode, setReasonCode] = useState(workspace.reasonCodes[0]?.code ?? "");

  async function transition(item: ReviewTransition) {
    try {
      await api(`/api/v1/proposals/${workspace.proposalId}/review/transition`, { method: "POST", body: JSON.stringify({ to: item.to, reasonCode: item.requiresReason ? reasonCode : undefined }) });
      setError("");
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The review action failed."); }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!parentId) return;
    try {
      await api(`/api/v1/proposals/${workspace.proposalId}/review/comments`, { method: "POST", body: JSON.stringify({ body: reply, type: "clarification", visibility: "client", parentId }) });
      setReply("");
      setError("");
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The reply could not be saved."); }
  }

  return (
    <div className="review-client">
      {error && <p className="portal-error" role="alert">{error}</p>}
      <ReviewFeedback workspace={workspace} audience="client" />
      {workspace.comments.some((comment) => comment.status === "open") && (
        <form className="portal-editor" onSubmit={sendReply}>
          <label>Reply to
            <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              {workspace.comments.filter((comment) => comment.status === "open").map((comment) => <option key={comment.id} value={comment.id}>{comment.body.slice(0, 80)}</option>)}
            </select>
          </label>
          <label>Reply<textarea value={reply} onChange={(event) => setReply(event.target.value)} required /></label>
          <button type="submit">Send reply</button>
        </form>
      )}
      <div className="portal-actions">
        {workspace.allowedTransitions.map((item) => <button key={item.to} className="button button-primary" type="button" onClick={() => { void transition(item); }}>{item.label}</button>)}
      </div>
      {workspace.allowedTransitions.some((item) => item.requiresReason) && (
        <label>Reason<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>{workspace.reasonCodes.filter((reason) => reason.actions.includes("withdraw")).map((reason) => <option key={reason.code} value={reason.code}>{reason.label}</option>)}</select></label>
      )}
    </div>
  );
}
