import { useEffect, useRef, useState } from "react";
import { TryChatView } from "./tryChat";

export type TryView = "live" | "chat";
const VIEW_KEY = "unwh.try.view";
/** The saved view, Live run by default. */
export function savedView(): TryView { try { return window.localStorage.getItem(VIEW_KEY) === "chat" ? "chat" : "live"; } catch { return "live"; } }

type CallStatus = "pending" | "running" | "ok" | "refused" | "error" | "unexpected" | "skipped";
type TaskStatus = "pending" | "running" | "done" | "attention";
type Trace = { id: string; occurredAt: string; durationMs: number; isError: boolean; errorMessage: string | null; input: string; output: string };
type Call = { seq: number; toolName: string; note: string | null; expect: "ok" | "refused" | "either"; status: CallStatus; summary: string | null; durationMs: number | null; result?: unknown; trace: Trace | null };
type Task = { seq: number; title: string; narration: string; status: TaskStatus; calls: Call[] };
type Demo = { id: string; plan: { code: string; title: string; description: string }; status: "running" | "paused" | "complete" | "taken_over" | "failed"; nextTaskSeq: number | null; errorMessage: string | null; expiresAt: string; doneTasks: number; totalTasks: number; doneCalls: number; totalCalls: number; tasks: Task[] };
type Plan = { code: string; title: string; description: string; taskCount: number; callCount: number; tasks: Array<{ seq: number; title: string }> };
type Access = { token: string; mcpUrl: string; expiresAt: string; scopes: string[] };

type CheckState = "pending" | "running" | "done" | "error" | "skipped";
const callCheck: Record<CallStatus, CheckState> = { pending: "pending", running: "running", ok: "done", refused: "done", error: "error", unexpected: "error", skipped: "skipped" };
const checkText: Record<CheckState, string> = { pending: "Pending", running: "Running", done: "Done", error: "Failed", skipped: "Skipped" };
const isFinished = (t: Task) => t.status === "done" || t.status === "attention";

/** Checkbox-style status: empty box, spinner, checked box, or error box. The text label is for screen readers. */
export function Check({ state, label }: { state: CheckState; label?: string }) {
  return <span className="try-me-check" data-state={state} role="img" aria-label={label ?? checkText[state]} />;
}

/**
 * The chunk window: finished tasks collapse to one checked line each, and at most two tasks are open,
 * the current one (executing, or the next to run when paused) and the following one as a read-ahead.
 * Nothing past those two opens until the current task finishes, so no third chunk can appear while a call is in flight.
 */
export function chunkWindow(tasks: Task[]) {
  const first = tasks.findIndex((t) => !isFinished(t));
  const done = first < 0 ? tasks : tasks.slice(0, first);
  const open = first < 0 ? [] : tasks.slice(first, first + 2);
  return { done, open, later: first < 0 ? 0 : Math.max(0, tasks.length - first - 2) };
}
/** A call's recorded response: the tool's result, or its error body. Falls back to the trace output for older runs. */
function callResult(call: Call): { value: unknown } | null {
  if (call.result !== undefined && call.result !== null) return { value: call.result };
  const text = call.trace?.output || call.trace?.errorMessage;
  if (!text) return null;
  try { return { value: JSON.parse(text) }; } catch { return { value: text }; }
}

/** Collapsible, formatted JSON: objects and arrays are native details elements, open for the first two levels. */
export function JsonView({ value, name, depth = 0 }: { value: unknown; name?: string; depth?: number }) {
  const label = name !== undefined ? <span className="try-me-json-key">{name}: </span> : null;
  if (value !== null && typeof value === "object") {
    const isArray = Array.isArray(value);
    const entries = isArray ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
    const [openB, closeB] = isArray ? ["[", "]"] : ["{", "}"];
    if (entries.length === 0) return <div className="try-me-json-row">{label}<span className="try-me-json-punct">{openB}{closeB}</span></div>;
    return (
      <details className="try-me-json-node" open={depth < 2}>
        <summary>{label}<span className="try-me-json-punct">{openB}</span><span className="try-me-json-count"> {entries.length} {isArray ? (entries.length === 1 ? "item" : "items") : (entries.length === 1 ? "key" : "keys")} </span><span className="try-me-json-punct try-me-json-close-inline">{closeB}</span></summary>
        <div className="try-me-json-children">
          {entries.map(([k, v]) => <JsonView key={k} name={isArray ? undefined : k} value={v} depth={depth + 1} />)}
        </div>
        <span className="try-me-json-punct">{closeB}</span>
      </details>
    );
  }
  const kind = value === null ? "null" : typeof value;
  return <div className="try-me-json-row">{label}<span className={`try-me-json-${kind}`}>{typeof value === "string" ? JSON.stringify(value) : String(value)}</span></div>;
}

const callLabel: Partial<Record<CallStatus, string>> = { refused: "refused, as expected", error: "error", unexpected: "should have been refused", skipped: "skipped" };

/**
 * Public "Try me" page. The visitor picks a plan (one try_me row), and the server runs it one task at a
 * time against Unwhelm's MCP server. After each task they can continue, run the rest, or stop and take
 * over the same sandbox from their own MCP client with the token shown here.
 */
export function TryMePage() {
  const [view, setViewState] = useState<TryView>(savedView);
  const [playKey, setPlayKey] = useState(0);
  const setView = (next: TryView) => { setViewState(next); setPlayKey(0); try { window.localStorage.setItem(VIEW_KEY, next); } catch { /* private mode */ } };
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planCode, setPlanCode] = useState("");
  const [demo, setDemo] = useState<Demo | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const [copied, setCopied] = useState<string | null>(null);
  const [plansState, setPlansState] = useState<"loading" | "ready" | "error">("loading");
  const [plansError, setPlansError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const loadPlans = () => {
    setPlansState("loading"); setPlansError(null);
    void fetch("/api/v1/public/demo/plans").then(async (r) => {
      // A dev proxy with no API behind it answers with an empty or HTML error body, so check the type before parsing.
      const isJson = (r.headers.get("content-type") ?? "").includes("application/json");
      const body = isJson ? await r.json() : null;
      if (!body?.ok || !Array.isArray(body.entity)) { setPlansError(body?.message ?? null); setPlansState("error"); return; }
      setPlans(body.entity); if (body.entity[0]) setPlanCode((code) => code || body.entity[0].code);
      setPlansState("ready");
    }).catch(() => setPlansState("error"));
  };

  useEffect(() => {
    loadPlans();
    return () => window.clearTimeout(timer.current);
  }, []);

  const poll = async (id: string) => {
    window.clearTimeout(timer.current);
    const body = await (await fetch(`/api/v1/public/demo/sessions/${id}`)).json();
    if (!body.ok) { setError(body.message ?? "The demo run could not be read."); return; }
    setDemo(body.entity);
    const waitingOnTraces = (body.entity.tasks as Task[]).some((t) => t.calls.some((c) => ["ok", "refused", "error", "unexpected"].includes(c.status) && !c.trace));
    if (body.entity.status === "running" || waitingOnTraces) timer.current = window.setTimeout(() => void poll(id), 1000);
  };

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch { setError(`The demo could not ${what}. Try again in a moment.`); } finally { setBusy(false); }
  };

  const start = () => act("start", async () => {
    window.clearTimeout(timer.current); setDemo(null); setAccess(null); setOpen(new Set());
    const body = await (await fetch("/api/v1/public/demo/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan: planCode }) })).json();
    if (!body.ok) { setError(body.message ?? "The demo could not start."); return; }
    const next = { token: body.entity.token, mcpUrl: body.entity.mcpUrl, expiresAt: body.entity.expiresAt, scopes: body.entity.scopes };
      setAccess(next);
      try { sessionStorage.setItem("unwh-try-me-access", JSON.stringify(next)); } catch { /* storage may be off */ }
    await poll(body.entity.id);
  });

  const send = (path: "continue" | "stop", payload: object = {}) => act(path, async () => {
    if (!demo || !access) return;
    const body = await (await fetch(`/api/v1/public/demo/sessions/${demo.id}/${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${access.token}` }, body: JSON.stringify(payload) })).json();
    if (!body.ok) { setError(body.message ?? `The demo could not ${path}.`); return; }
    await poll(demo.id);
  });

  const copy = (label: string, text: string) => { void navigator.clipboard?.writeText(text).then(() => { setCopied(label); window.setTimeout(() => setCopied(null), 1500); }); };
  const plan = plans.find((p) => p.code === planCode);
  const nextTask = demo?.tasks.find((t) => t.seq === demo.nextTaskSeq);
  const running = demo?.status === "running";
  const mcpJson = access ? JSON.stringify({ mcpServers: { "unwhelm-try-me": { url: access.mcpUrl, headers: { Authorization: `Bearer ${access.token}` } } } }, null, 2) : "";
  const curl = access ? `curl -s ${access.mcpUrl} \\\n  -H "Authorization: Bearer ${access.token}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"unw_list_proposals","arguments":{}}}'` : "";

  return (
    <section className="section route-section try-me">
      <div className="container">
      <div className="section-heading heading-split try-me-heading">
        <div>
          <div className="eyebrow eyebrow-dark">TRY ME</div>
          <h1>Watch an agent work through Unwhelm's MCP server</h1>
        </div>
        <p>
          Pick a plan and an agent runs it in a private sandbox, one task at a time. Each task is a short series of real MCP tool calls,
          and you can open any call to see its trace, the same record staff see for every agent session. The agent never sets hours or price.
        </p>
      </div>
      <div className="try-me-intro">
        <p>
          After each task you choose: run the next task, run the rest, or stop and take over. Taking over gives you this sandbox's MCP address
          and token, so you can connect your own agent (Cursor, Claude, or anything that speaks MCP) and take the proposal in a different direction.
          The sandbox and its token are deleted within 30 minutes.
        </p>
        <p><a href="/try/help">Read the Try me help guide</a> for exercises to run with your own agent.</p>
      </div>

      <div className="hero-actions try-view-toggle" role="group" aria-label="View">
        <button type="button" className={view === "live" ? "button button-primary" : "button button-secondary"} aria-pressed={view === "live"} onClick={() => setView("live")}>Live run</button>
        <button type="button" className={view === "chat" ? "button button-primary" : "button button-secondary"} aria-pressed={view === "chat"} onClick={() => setView("chat")}>Chat view</button>
      </div>

      <div className="try-me-picker">
        {plansState === "loading" && <p className="try-me-status" role="status">Loading plans…</p>}
        {plansState === "error" && (
          <div className="try-me-empty" role="alert">
            <h2>The Try me plans aren't available right now.</h2>
            <p>{plansError ?? "We couldn't reach the demo service. Try again in a moment."}</p>
            <button type="button" className="button button-primary" onClick={loadPlans}>Retry</button>
          </div>
        )}
        {plansState === "ready" && plans.length === 0 && (
          <div className="try-me-empty" role="status">
            <h2>No Try me plans are set up yet.</h2>
            <p>Check back soon.</p>
            <button type="button" className="button button-secondary" onClick={loadPlans}>Retry</button>
          </div>
        )}
        {plansState === "ready" && plans.length > 0 && (
          <fieldset className="try-me-plans" disabled={busy || running}>
            <legend>Pick a plan</legend>
            <div className="try-me-plan-grid">
              {plans.map((p) => (
                <label key={p.code} className={p.code === planCode ? "try-me-plan is-selected" : "try-me-plan"}>
                  <input type="radio" name="try-me-plan" value={p.code} checked={p.code === planCode} onChange={() => setPlanCode(p.code)} />
                  <span className="try-me-plan-title">{p.title}</span>
                  <span className="try-me-plan-meta">{p.taskCount} tasks, {p.callCount} calls</span>
                  <span className="try-me-plan-desc">{p.description}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {plansState === "ready" && plans.length > 0 && (
          <div className="hero-actions">
            <button type="button" className="button button-primary" onClick={() => { if (view === "chat") setPlayKey((k) => k + 1); else void start(); }} disabled={busy || running || !plan}>
              {view === "live" && demo ? "Start a new run" : "Start"}
            </button>
          </div>
        )}
        {error && <p className="try-me-error" role="alert">{error}</p>}
      </div>

      {view === "chat" && <TryChatView planCode={planCode} playKey={playKey} />}
      {view === "live" && demo && (
        <div aria-live="polite">
          <h2>{demo.plan.title}</h2>
          <p>
            {demo.doneTasks} of {demo.totalTasks} tasks done ({demo.doneCalls} of {demo.totalCalls} calls)
            {demo.status === "complete" ? ". The plan is finished, and you can still take over." : demo.status === "taken_over" ? ". You've taken over." : demo.status === "failed" ? `. The run stopped: ${demo.errorMessage}` : "."}
          </p>

          {demo.status === "paused" && nextTask && (
            <div className="try-me-choice">
              <p>Next up: <strong>{nextTask.title}</strong>. Keep going, or stop here and drive it yourself.</p>
              <button type="button" className="button button-primary" onClick={() => void send("continue")} disabled={busy}>Run the next task</button>{" "}
              <button type="button" className="button button-secondary" onClick={() => void send("continue", { all: true })} disabled={busy}>Run the rest</button>{" "}
              <button type="button" className="button button-secondary" onClick={() => void send("stop")} disabled={busy}>Stop and take over</button>
            </div>
          )}

          {access && (demo.status === "taken_over" || demo.status === "complete") && (
            <div className="try-me-takeover">
              <h3>Take over this sandbox</h3>
              <p>
                Your agent gets the same client permissions as the demo ({access.scopes.join(", ")}) and sees the same proposals, so it can pick up where
                the plan stopped. This token works until {new Date(access.expiresAt).toLocaleTimeString()}. It is only shown on this page, so copy it now.
              </p>
              <p>MCP server address</p>
              <pre>{access.mcpUrl}</pre>
          <p><a href="/try/help">Open the Try me help guide</a> for exercises to run with your own agent.</p>
              <p>Sandbox token <button type="button" onClick={() => copy("token", access.token)}>{copied === "token" ? "Copied" : "Copy"}</button></p>
              <pre>{access.token}</pre>
              <p>For Cursor (<code>.cursor/mcp.json</code>), Claude, or another MCP client config <button type="button" onClick={() => copy("json", mcpJson)}>{copied === "json" ? "Copied" : "Copy"}</button></p>
              <pre>{mcpJson}</pre>
              <p>Or call a tool by hand <button type="button" onClick={() => copy("curl", curl)}>{copied === "curl" ? "Copied" : "Copy"}</button></p>
              <pre>{curl}</pre>
              <p>Try asking your agent to add a deliverable, preview what that does to progress, or park it for a phase 2.</p>
            </div>
          )}

          {(() => {
            const win = chunkWindow(demo.tasks);
            const renderCalls = (task: Task) => (
              <ul className="try-me-calls">
                {task.calls.map((call) => {
                  const key = `${task.seq}.${call.seq}`;
                  const state = callCheck[call.status];
                  const result = callResult(call);
                  const isOpen = open.has(key) && result !== null;
                  const panelId = `try-me-result-${task.seq}-${call.seq}`;
                  return (
                    <li key={key} className="try-me-call" data-status={call.status} data-check={state}>
                      <button type="button" className="try-me-call-toggle" onClick={() => toggle(key)} aria-expanded={isOpen} aria-controls={result ? panelId : undefined} disabled={!result}
                        title={result ? (isOpen ? "Hide the result" : "Show the result") : undefined}>
                        <Check state={state} label={`${checkText[state]}${callLabel[call.status] ? `, ${callLabel[call.status]}` : ""}`} />
                        <code>{call.toolName}</code>
                        {call.note && <span> {call.note}</span>}
                        {callLabel[call.status] && <small> ({callLabel[call.status]})</small>}
                        {call.durationMs !== null && <small> {call.durationMs} ms</small>}
                        {result && <span className="try-me-call-chevron" aria-hidden="true" />}
                        {result && <span className="visually-hidden">{isOpen ? ", hide result" : ", show result"}</span>}
                      </button>
                      {call.summary && <p className={state === "error" ? "try-me-call-error" : undefined}><em>{call.summary}</em></p>}
                      {isOpen && result && (
                        <div className="try-me-result" id={panelId} role="region" aria-label={`${call.toolName} result`} data-error={call.status === "refused" || state === "error" ? "true" : undefined}>
                          <p className="try-me-result-label">{call.status === "refused" || state === "error" ? "Error response" : "Response"}</p>
                          <div className="try-me-json"><JsonView value={result.value} /></div>
                          {call.trace?.input && <details className="try-me-result-input"><summary>Arguments sent</summary><pre>{(() => { try { return JSON.stringify(JSON.parse(call.trace.input), null, 2); } catch { return call.trace.input; } })()}</pre></details>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            );
            return (
              <ol className="try-me-steps try-me-chunks">
                {win.done.map((task) => {
                  const bad = task.status === "attention";
                  return (
                    <li key={task.seq} className="try-me-chunk is-done" data-status={task.status} data-seq={task.seq}>
                      <details open={demo.status === "complete" || undefined}>
                        <summary>
                          <Check state={bad ? "error" : "done"} label={bad ? "Finished with problems" : "Done"} />
                          <span className="try-me-chunk-title">{task.title}</span>
                          <small> {task.calls.length} {task.calls.length === 1 ? "call" : "calls"}{bad ? ", needs attention" : ""}</small>
                        </summary>
                        {renderCalls(task)}
                      </details>
                    </li>
                  );
                })}
                {win.open.map((task, index) => {
                  const role = index === 0 ? "current" : "next";
                  return (
                    <li key={task.seq} className={`try-me-chunk is-open is-${role}`} data-status={task.status} data-seq={task.seq} aria-current={index === 0 ? "step" : undefined}>
                      <h3>
                        <Check state={task.status === "running" ? "running" : "pending"} />
                        <span className="try-me-chunk-tag">{index === 0 ? (task.status === "running" ? "Running now" : "Up next") : "After that"}</span>
                        <span className="try-me-chunk-title">{task.title}</span>
                      </h3>
                      <p>{task.narration}</p>
                      {renderCalls(task)}
                    </li>
                  );
                })}
                {win.later > 0 && <li className="try-me-chunk-later">{win.later} more {win.later === 1 ? "task" : "tasks"} after these</li>}
              </ol>
            );
          })()}
        </div>
      )}
      </div>
    </section>
  );
}
