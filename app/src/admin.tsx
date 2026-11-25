import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { MCP_SCOPES } from "../shared/mcpScopes";
import { TemplateEditor } from "./templateEditor";
import { StaffReview, type ReviewQueueItem, type ReviewWorkspace } from "./reviewPanels";

/** Every scope a token can carry; the same list the API validates against. */
const SCOPES: readonly string[] = MCP_SCOPES;
const EXPIRY_DAYS = [30, 90, 365] as const;

type AdminUser = { id: string; email: string; name: string; isAdmin: boolean; suspendedAt: string | null; createdAt: string; org?: { id: string; name: string; role: string } | null };
type AccessRequestRow = { id: string; email: string; name: string; company: string | null; role: string | null; reason: string; referral: string | null; status: string; reviewNote: string | null; createdAt: string };
type ScopePreset = { code: string; label: string; scopes: string[] };
type AdminToken = { id: string; name: string; owner: string | null; scopes: string[]; lastUsed: string | null; expiresAt: string | null; revokedAt: string | null };
type AuditEvent = { id: string; operation: string; actorUserId: string | null; recordId: string | null; createdAt: string };
type Secret = { label: string; value: string; expiresAt: string };
type Tab = "users" | "tokens" | "audit" | "security" | "reviews" | "templates" | "access";
type ReviewQueue = { states: Array<{ code: string; staffLabel: string }>; items: ReviewQueueItem[] };
type MfaSetup = { otpauthUrl: string; qrCode: string };

class AdminRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AdminRequestError";
  }
}

async function adminApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await response.json() as { ok?: boolean; code?: string; message?: string; entity?: T };
  if (!response.ok || !body.ok || body.entity === undefined) throw new AdminRequestError(body.code || "REQUEST_FAILED", body.message || "Request failed");
  return body.entity;
}

export function AdminRoute({ denied }: { denied: ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/auth/session", { credentials: "include" })
      .then((response) => response.json())
      .then((body: { entity?: { isAdmin?: boolean; user?: { isAdmin?: boolean } | null } }) => {
        if (cancelled) return;
        const entity = body?.entity;
        setAllowed(entity?.isAdmin === true || entity?.user?.isAdmin === true);
      })
      .catch(() => { if (!cancelled) setAllowed(false); });
    return () => { cancelled = true; };
  }, []);

  if (allowed === null) return <p className="admin-status">Checking access.</p>;
  if (!allowed) return denied;
  return <AdminPage />;
}

function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  const [reviewState, setReviewState] = useState("");
  const [reviewQueue, setReviewQueue] = useState<ReviewQueue>({ states: [], items: [] });
  const [reviewItem, setReviewItem] = useState<ReviewQueueItem | null>(null);
  const [reviewWorkspace, setReviewWorkspace] = useState<ReviewWorkspace | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequestRow[]>([]);
  const [accessNote, setAccessNote] = useState("");
  const [tokens, setTokens] = useState<AdminToken[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<Secret | null>(null);
  const [presets, setPresets] = useState<ScopePreset[]>([]);
  const [preset, setPreset] = useState("");
  const [checkedScopes, setCheckedScopes] = useState<string[]>([]);
  const [minted, setMinted] = useState<Secret & { name: string; owner: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<AdminToken | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  function noteError(reason: unknown) {
    if (reason instanceof AdminRequestError && reason.code === "MFA_REQUIRED") {
      setMfaRequired(true);
      setError("");
      return;
    }
    setError(reason instanceof Error ? reason.message : "Request failed");
  }

  async function load() {
    const [userList, tokenList, audit, accessList] = await Promise.all([
      adminApi<{ items: AdminUser[] }>("/api/v1/admin/users"),
      adminApi<{ items: AdminToken[] }>("/api/v1/admin/tokens"),
      adminApi<{ items: AuditEvent[] }>("/api/v1/admin/audit?limit=100"),
      adminApi<{ items: AccessRequestRow[] }>("/api/v1/admin/access-requests"),
    ]);
    setUsers(userList.items);
    setAccessRequests(accessList.items);
    setTokens(tokenList.items);
    setEvents(audit.items);
    // Presets are rows in scope_preset; the form still works with hand-picked scopes if they fail to load.
    adminApi<{ items: ScopePreset[] }>("/api/v1/admin/scope-presets").then((list) => setPresets(list.items)).catch(() => setPresets([]));
  }

  function choosePreset(code: string) {
    setPreset(code);
    const chosen = presets.find((item) => item.code === code);
    if (chosen) setCheckedScopes(SCOPES.filter((scope) => chosen.scopes.includes(scope)));
  }

  function toggleScope(scope: string, on: boolean) {
    setPreset("");
    setCheckedScopes((current) => on ? SCOPES.filter((item) => item === scope || current.includes(item)) : current.filter((item) => item !== scope));
  }

  useEffect(() => {
    let cancelled = false;
    load().catch((reason: unknown) => { if (!cancelled) noteError(reason); });
    return () => { cancelled = true; };
  }, []);

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    try {
      await adminApi("/api/v1/admin/users", { method: "POST", body: JSON.stringify({ email: data.get("email"), name: data.get("name") }) });
      form.reset();
      await load();
    } catch (reason) {
      noteError(reason);
    }
  }

  async function setSuspended(user: AdminUser, suspend: boolean) {
    setError("");
    try {
      await adminApi(`/api/v1/admin/users/${user.id}/${suspend ? "suspend" : "unsuspend"}`, { method: "POST", body: "{}" });
      await load();
    } catch (reason) { noteError(reason); }
  }

  async function reviewAccess(item: AccessRequestRow, decision: "approve" | "reject") {
    setError("");
    setAccessNote("");
    const note = decision === "reject" ? window.prompt("Note for this rejection (optional)") ?? "" : "";
    try {
      const result = await adminApi<{ message?: string }>(`/api/v1/admin/access-requests/${item.id}/${decision}`, { method: "POST", body: JSON.stringify({ note }) });
      setAccessNote(result.message || (decision === "approve" ? "Approved. No email was sent. They can request a magic link on the sign-in page." : "Rejected."));
      await load();
    } catch (reason) { noteError(reason); }
  }

  async function mintLink(user: AdminUser) {
    setError("");
    try {
      const minted = await adminApi<{ link?: string; expiresAt: string }>(`/api/v1/admin/users/${user.id}/magic-link`, { method: "POST" });
      if (minted.link) setSecret({ label: "Sign-in link", value: minted.link, expiresAt: minted.expiresAt });
    } catch (reason) {
      noteError(reason);
    }
  }

  async function mintToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const scopes = SCOPES.filter((scope) => checkedScopes.includes(scope));
    if (!scopes.length) { setError("Pick a preset or at least one permission."); return; }
    setError("");
    setMinted(null);
    setCopied(false);
    try {
      const minted = await adminApi<{ token?: string; expiresAt: string }>("/api/v1/admin/tokens", {
        method: "POST",
        body: JSON.stringify({ userId: data.get("userId"), name: data.get("name"), scopes, expiresInDays: Number(data.get("expiresInDays")) }),
      });
      const owner = users.find((user) => user.id === data.get("userId"))?.email ?? "";
      if (minted.token) setMinted({ label: "Token", value: minted.token, expiresAt: minted.expiresAt, name: String(data.get("name") ?? ""), owner });
      form.reset();
      setPreset("");
      setCheckedScopes([]);
      await load();
    } catch (reason) {
      noteError(reason);
    }
  }

  async function revoke(token: AdminToken) {
    setError("");
    try {
      await adminApi(`/api/v1/admin/tokens/${token.id}`, { method: "DELETE" });
      setPendingRevoke(null);
      await load();
    } catch (reason) {
      noteError(reason);
    }
  }

  async function startMfaSetup() {
    setError("");
    try {
      const setup = await adminApi<MfaSetup>("/api/v1/auth/mfa/setup", { method: "POST" });
      setMfaSetup(setup);
      setRecoveryCodes(null);
    } catch (reason) {
      noteError(reason);
    }
  }

  async function confirmMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    try {
      const confirmed = await adminApi<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: data.get("code") }),
      });
      setRecoveryCodes(confirmed.recoveryCodes);
      setMfaSetup(null);
    } catch (reason) {
      noteError(reason);
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    try {
      await adminApi("/api/v1/auth/mfa/verify", { method: "POST", body: JSON.stringify({ code: data.get("code") }) });
      setMfaRequired(false);
      await load();
    } catch (reason) {
      noteError(reason);
    }
  }

  async function loadReviews(state = reviewState, keepId = reviewItem?.id) {
    try {
      const queue = await adminApi<ReviewQueue>(`/api/v1/proposals/review-queue${state ? `?state=${encodeURIComponent(state)}` : ""}`);
      setReviewQueue(queue);
      const next = queue.items.find((item) => item.id === keepId) ?? null;
      setReviewItem(next);
      setReviewWorkspace(next ? await adminApi<ReviewWorkspace>(`/api/v1/proposals/${next.id}/review`) : null);
      setError("");
    } catch (reason) { noteError(reason); }
  }

  return (
    <section className="section admin-section">
      <div className="container">
        <h1>Admin</h1>
        <div className="admin-tabs" role="tablist">
          {([["users", "Users"], ["access", "Access requests"], ["tokens", "Tokens"], ["audit", "Audit"], ["security", "Security"], ["reviews", "Reviews"], ["templates", "Templates"]] as const).map(([item, label]) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => { setTab(item); if (item === "reviews") void loadReviews(); }}>
              {label}
            </button>
          ))}
        </div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {tab === "users" && (
          <div role="tabpanel">
            <form className="admin-form" onSubmit={addUser}>
              <label>Email <input name="email" type="email" required autoComplete="off" /></label>
              <label>Name <input name="name" required autoComplete="off" /></label>
              <button className="button button-primary" type="submit">Add user</button>
            </form>
            <table className="admin-table">
              <thead><tr><th>Email</th><th>Name</th><th>Admin</th><th>Suspended</th><th></th></tr></thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{user.name}</td>
                    <td>{user.isAdmin ? "yes" : "no"}</td>
                    <td>{user.suspendedAt ? "yes" : "no"}</td>
                    <td>
                      <button type="button" onClick={() => mintLink(user)}>Sign-in link</button>
                      <button type="button" onClick={() => { void setSuspended(user, !user.suspendedAt); }}>{user.suspendedAt ? "Unsuspend" : "Suspend"}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "access" && (
          <div role="tabpanel">
            <p>Approving adds a client membership in the trial organization and does not send email. Tell them to use Email me a link on the sign-in page. It never grants staff or admin.</p>
            {accessNote && <p role="status">{accessNote}</p>}
            <table className="admin-table">
              <thead><tr><th>When</th><th>Email</th><th>Name</th><th>Company</th><th>Why</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {accessRequests.map((item) => (
                  <tr key={item.id}>
                    <td>{item.createdAt}</td>
                    <td>{item.email}</td>
                    <td>{item.name}</td>
                    <td>{item.company ?? "—"}</td>
                    <td>{item.reason}</td>
                    <td>{item.status}{item.reviewNote ? ` — ${item.reviewNote}` : ""}</td>
                    <td>{item.status === "pending" && (
                      <>
                        <button type="button" onClick={() => { void reviewAccess(item, "approve"); }}>Approve</button>
                        <button type="button" onClick={() => { void reviewAccess(item, "reject"); }}>Reject</button>
                      </>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "tokens" && (
          <div role="tabpanel">
            <form className="admin-form" onSubmit={mintToken}>
              <label>User
                <select key={users.map((user) => user.id).join(",")} name="userId" required defaultValue={users[0]?.id ?? ""}>
                  {users.map((user) => <option key={user.id} value={user.id}>{user.email}{user.org ? ` (${user.org.name})` : user.isAdmin ? " (staff)" : ""}</option>)}
                </select>
              </label>
              <label>Name <input name="name" required autoComplete="off" /></label>
              <label>Preset
                <select name="preset" value={preset} onChange={(event) => choosePreset(event.target.value)}>
                  <option value="">Custom</option>
                  {presets.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                </select>
              </label>
              <fieldset>
                <legend>Permissions</legend>
                {SCOPES.map((scope) => (
                  <label key={scope}><input type="checkbox" name="scopes" value={scope} checked={checkedScopes.includes(scope)} onChange={(event) => toggleScope(scope, event.target.checked)} /> {scope}</label>
                ))}
              </fieldset>
              <label>Expiry
                <select name="expiresInDays" defaultValue="90">
                  {EXPIRY_DAYS.map((days) => <option key={days} value={days}>{days} days</option>)}
                </select>
              </label>
              <button className="button button-primary" type="submit">Mint token</button>
            </form>
            {minted && (
              <div className="admin-reveal" role="region" aria-label="New token">
                <h3>Token for {minted.owner}{minted.name ? ` · ${minted.name}` : ""}</h3>
                <p className="admin-reveal-warning"><strong>Copy it now. You won't see this token again.</strong> Only a hash is stored, so it can't be shown later. If it's lost, revoke it and mint a new one.</p>
                <code className="admin-reveal-secret" aria-label="Token secret">{minted.value}</code>
                <p className="admin-reveal-meta">Expires {minted.expiresAt}.</p>
                <div className="admin-dialog-actions">
                  <button className="button button-primary" type="button" onClick={() => { void navigator.clipboard?.writeText(minted.value).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Copied" : "Copy token"}</button>
                  <button type="button" onClick={() => { setMinted(null); setCopied(false); }}>I've saved it</button>
                </div>
              </div>
            )}
            <table className="admin-table">
              <thead><tr><th>Name</th><th>Owner</th><th>Permissions</th><th>Last used</th><th>Expiry</th><th></th></tr></thead>
              <tbody>
                {tokens.map((token) => (
                  <tr key={token.id}>
                    <td>{token.name}</td>
                    <td>{token.owner ?? "—"}</td>
                    <td>{token.scopes.join(", ")}</td>
                    <td>{token.lastUsed ?? "—"}</td>
                    <td>{token.expiresAt ?? "—"}</td>
                    <td>{token.revokedAt ? "Revoked" : <button type="button" onClick={() => setPendingRevoke(token)}>Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "security" && (
          <div role="tabpanel">
            <h2>Authenticator</h2>
            <p>Add an authenticator app. Recovery codes are shown once, after you confirm the code from the app.</p>
            <button className="button button-primary" type="button" onClick={() => { void startMfaSetup(); }}>Set up authenticator</button>
            {mfaSetup && (
              <form className="admin-form" onSubmit={confirmMfa}>
                <img src={mfaSetup.qrCode} alt="Authenticator QR code" width={180} height={180} />
                <p><code>{mfaSetup.otpauthUrl}</code></p>
                <label>Code from the app <input name="code" inputMode="numeric" autoComplete="one-time-code" required /></label>
                <button className="button button-primary" type="submit">Confirm</button>
              </form>
            )}
            {recoveryCodes && (
              <div>
                <p>Save these recovery codes. They will not be shown again.</p>
                <ul>
                  {recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}
                </ul>
                <button type="button" onClick={() => setRecoveryCodes(null)}>I have saved these codes</button>
              </div>
            )}
          </div>
        )}
        {tab === "reviews" && (
          <div className="portal-grid" role="tabpanel">
            <div>
              <h2>Review queue</h2>
              <label>State
                <select value={reviewState} onChange={(event) => { setReviewState(event.target.value); void loadReviews(event.target.value, reviewItem?.id); }}>
                  <option value="">All</option>
                  {reviewQueue.states.map((state) => <option key={state.code} value={state.code}>{state.staffLabel}</option>)}
                </select>
              </label>
              {reviewQueue.items.length === 0 ? <p>No proposals in this state.</p> : (
                <table className="admin-table"><thead><tr><th>Title</th><th>State</th></tr></thead><tbody>
                  {reviewQueue.items.map((item) => <tr key={item.id}><td><button type="button" onClick={() => { setReviewItem(item); void adminApi<ReviewWorkspace>(`/api/v1/proposals/${item.id}/review`).then(setReviewWorkspace).catch(noteError); }}>{item.title}</button></td><td>{item.staffLabel}</td></tr>)}
                </tbody></table>
              )}
            </div>
            {reviewItem && reviewWorkspace && <StaffReview item={reviewItem} workspace={reviewWorkspace} api={adminApi} onChanged={() => loadReviews(reviewState, reviewItem.id)} />}
          </div>
        )}
        {tab === "templates" && <TemplateEditor api={adminApi} onError={noteError} />}
        {tab === "audit" && (
          <div role="tabpanel">
            <table className="admin-table">
              <thead><tr><th>When</th><th>Type</th><th>Actor</th><th>Target</th></tr></thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.createdAt}</td>
                    <td>{event.operation}</td>
                    <td>{event.actorUserId ?? "—"}</td>
                    <td>{event.recordId ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {mfaRequired && (
        <form className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="mfa-title" onSubmit={verifyMfa}>
          <h2 id="mfa-title">Authenticator code</h2>
          <p>This admin action needs a current authenticator or recovery code.</p>
          <label>Code <input name="code" inputMode="numeric" autoComplete="one-time-code" required /></label>
          <div className="admin-dialog-actions">
            <button type="button" onClick={() => setMfaRequired(false)}>Cancel</button>
            <button className="button button-primary" type="submit">Verify</button>
          </div>
        </form>
      )}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
      {pendingRevoke && (
        <div className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
          <h2 id="revoke-title">Revoke {pendingRevoke.name}?</h2>
          <p>This token stops working immediately.</p>
          <div className="admin-dialog-actions">
            <button type="button" onClick={() => setPendingRevoke(null)}>Cancel</button>
            <button className="button button-primary" type="button" onClick={() => revoke(pendingRevoke)}>Revoke</button>
          </div>
        </div>
      )}
    </section>
  );
}

function SecretDialog({ secret, onClose }: { secret: Secret; onClose: () => void }) {
  return (
    <div className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="secret-title">
      <h2 id="secret-title">{secret.label}</h2>
      <p>Shown once. Expires {secret.expiresAt}.</p>
      <code>{secret.value}</code>
      <div className="admin-dialog-actions">
        <button type="button" onClick={() => { void navigator.clipboard.writeText(secret.value); }}>Copy</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
