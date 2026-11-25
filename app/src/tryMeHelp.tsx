import { useEffect, useState } from "react";

type Exercise = { code: string; title: string; goal: string; prompt: string; tools: string[] };
type Access = { token: string; mcpUrl: string; expiresAt: string };

const fallbackUrl = "https://mcp.unwhelm.net/mcp";

/** /try/help: hands-on exercises a visitor runs with their own agent against the Try me sandbox. */
export function TryMeHelpPage() {
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<Access | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("unwh-try-me-access");
      const parsed = saved ? (JSON.parse(saved) as Access) : null;
      if (parsed && new Date(parsed.expiresAt).getTime() > Date.now()) setAccess(parsed);
    } catch { /* storage may be off */ }
    void fetch("/api/v1/public/demo/guide").then((r) => r.json()).then((body) => {
      if (body.ok) setExercises(body.entity); else setError(body.message ?? "The guide could not load.");
    }).catch(() => setError("The guide could not load."));
  }, []);

  const url = access?.mcpUrl ?? fallbackUrl;
  const token = access?.token ?? "<your Try me token>";
  const setup = JSON.stringify({ mcpServers: { "unwhelm-try-me": { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  const toolCount = exercises ? new Set(exercises.flatMap((e) => e.tools)).size : 0;

  return (
    <section className="section route-section try-me-help">
      <div className="container">
      <div className="section-heading heading-split try-me-heading">
        <div>
          <div className="eyebrow eyebrow-dark">TRY ME</div>
          <h1>Try me help guide</h1>
        </div>
        <p>
        These exercises have you drive Unwhelm with your own agent, using the sandbox token from <a href="/try">Try me</a>. To work on your real account from Claude, ChatGPT, or Grok, <a href="/try/connect">connect your MCP client</a>.
        Start a plan there, stop it whenever you like, and the token keeps working until the sandbox expires.
          Each exercise names the MCP tools it uses{exercises ? `, ${toolCount} tools in all` : ""}.
        </p>
      </div>
      <h2>Connect your agent</h2>
      {access ? <p>Your sandbox token is filled in below. It expires at {new Date(access.expiresAt).toLocaleTimeString()}.</p>
        : <p>Start a run on <a href="/try">Try me</a> first; its token is shown once and then filled in here.</p>}
      <pre>{setup}</pre>
      <h2>Stopping and taking over</h2>
      <p>
        On Try me, press Stop after any task. Nothing is thrown away: the proposal, chat, and preferences the plan made stay in the sandbox,
        so your agent can pick up where the plan left off or take it somewhere else. The last exercise walks through it.
      </p>
      <h2>Exercises</h2>
      {error && <p role="alert">{error}</p>}
      {!exercises && !error && <p>Loading the exercises.</p>}
      {exercises?.map((exercise, index) => (
        <section key={exercise.code} className="try-me-exercise">
          <h3>{index + 1}. {exercise.title}</h3>
          <p>{exercise.goal}</p>
          <p>Paste this to your agent:</p>
          <pre>{exercise.prompt}</pre>
          <p>Tools used: {exercise.tools.map((tool, i) => <span key={tool}>{i > 0 && ", "}<code>{tool}</code></span>)}</p>
        </section>
      ))}
      </div>
    </section>
  );
}