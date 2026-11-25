// Local draft (copy B of /mcp/explained). Reachable by direct URL only: not in nav, sitemap, routes.json, or breadcrumbs.json.
import { useRef, useState } from "react";

const startPrompts = [
  "I run a ten-person law firm and want to scope a website refresh. Ask me what you need, then draft a proposal.",
  "Can we also add a client portal and a blog?",
];

/** /mcp/explained-b: hidden draft variant of the hook-first Proposals overview. */
export function McpExplainedBPage() {
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const load = (prompt: string) => { setDraft(prompt); setCopied(false); boxRef.current?.focus(); boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  const copy = () => { void navigator.clipboard?.writeText(draft).then(() => setCopied(true), () => setCopied(false)); };
  return (
    <section className="section route-section try-me-help mcp-explained-page mcp-explained-b">
      <div className="container">
        <div className="section-heading try-me-heading mcp-explained-b-heading">
          <div>
            <div className="eyebrow eyebrow-dark">MCP SERVER</div>
            <h1>Two sentences to a proposal</h1>
          </div>
          <p>Say what you need in plain English. The Proposals agent asks a few follow-ups and builds the draft with you.</p>
        </div>

        <div className="mcp-explained-block">
          <h2>Start here</h2>
          <p className="mcp-explained-b-hint">Click a prompt to load it into the try box.</p>
          <div className="mcp-explained-b-prompts">
            {startPrompts.map((prompt) => (
              <button key={prompt} type="button" className="mcp-explained-b-prompt" aria-pressed={draft === prompt} onClick={() => load(prompt)}>{prompt}</button>
            ))}
          </div>
          <label className="mcp-explained-b-try">
            <span>Try me</span>
            <textarea ref={boxRef} rows={4} value={draft} placeholder="Pick a prompt above or type your own." onChange={(event) => { setDraft(event.target.value); setCopied(false); }} />
          </label>
          <div className="mcp-explained-b-try-actions">
            <button type="button" className="button button-secondary" onClick={copy} disabled={!draft}>{copied ? "Copied" : "Copy prompt"}</button>
            <button type="button" className="button button-secondary" onClick={() => setDraft("")} disabled={!draft}>Clear</button>
          </div>
        </div>

        <div className="mcp-explained-block">
          <h2>Why this isn’t a contact form</h2>
          <p>
            A contact form collects a message and stops. This is a chat on top of a small, fixed set of tools that only know how to build
            a proposal. When you talk, the agent chooses the right tools and fills the draft. You don’t learn the proposal outline, hunt
            through a long API surface, or pick which tool loads which section. You do as little as possible; the agent does the rest.
          </p>
        </div>

        <div className="mcp-explained-block">
          <h2>What that buys you</h2>
          <p>
            Turning “add a client portal and a blog” into scope, budget, and a schedule used to take a small cast of people. Here one
            clear ask can get that far.
          </p>
        </div>

        <div className="mcp-explained-block">
          <h2>Why we built our own</h2>
          <p>
            Proposal software is everywhere. We built this AI-first so the workflow fits the agent instead of bolting AI onto an old form.
            Building it ourselves was also the cheapest way to learn what works.
          </p>
        </div>

        <div className="mcp-explained-block">
          <h2>How it works</h2>
          <div className="mcp-explained-flow" role="list" aria-label="How a proposal moves through the agents">
            <div className="mcp-explained-step" role="listitem">
              <strong>Proposals, open</strong>
              <span>Anyone can scope a project and get a draft without signing in.</span>
            </div>
            <div className="mcp-explained-arrow" aria-hidden="true">→</div>
            <div className="mcp-explained-step" role="listitem">
              <strong>Proposals, signed in</strong>
              <span>Clients review, edit, and approve.</span>
            </div>
            <div className="mcp-explained-arrow" aria-hidden="true">→</div>
            <div className="mcp-explained-step mcp-explained-handoff" role="listitem">
              <strong>Hand-off, signed in only</strong>
              <span>Contract and Project Management agents pick up after sign-off.</span>
            </div>
          </div>
          <p className="mcp-explained-status">
            Proposals <span className="mcp-status">Live</span>
            {" "}Contracts and Project Management <span className="mcp-status">Next</span>
          </p>
        </div>

        <div className="mcp-explained-cta">
          <a className="button button-primary" href="/try">Try the demo</a>
          <a className="button button-secondary" href="/mcp/getting-started">Sample prompts</a>
        </div>
      </div>
    </section>
  );
}