const hookPrompts = [
  "I run a ten-person law firm and want to scope a website refresh. Ask me what you need, then draft a proposal.",
  "Can we also add a client portal and a blog?",
];

/** /mcp/explained: hook-first, plain-language overview of the Proposals agent and how the agents fit together. */
export function McpExplainedPage() {
  return (
    <section className="section route-section try-me-help mcp-explained-page">
      <div className="container">
        <div className="section-heading heading-split try-me-heading">
          <div>
            <div className="eyebrow eyebrow-dark">MCP SERVER</div>
            <h1>Two sentences to a proposal</h1>
          </div>
          <p>Type what you need in plain words. The Proposals agent asks follow-up questions and builds the proposal with you.</p>
        </div>

        <div className="mcp-explained-block">
          <h2>Start with something like this</h2>
          {hookPrompts.map((prompt) => <pre key={prompt}><code>{prompt}</code></pre>)}
          <p>That's enough to start a real conversation that builds a proposal.</p>
        </div>

        <div className="mcp-explained-block">
          <h2>Why it's different</h2>
          <p>
            A contact-us form is static: you fill it in and wait. This is a chat, but it sits on a bounded set of MCP tools shaped around
            one job, building a proposal. The AI turns what you say into the right tool calls to update the proposal. You never have to
            learn the proposal's structure, roughly 95 API endpoints, or which tool loads which section. You do the minimum work, and
            that's the point.
          </p>
        </div>

        <div className="mcp-explained-block">
          <h2>The payoff</h2>
          <p>
            Think about how many people it used to take to turn one ask like "add a client portal and a blog" into something scoped,
            budgeted, and scheduled. Here, one question or requirement gets you there.
          </p>
        </div>

        <div className="mcp-explained-block">
          <h2>Why we built it</h2>
          <p>
            There are plenty of proposal tools. Building AI-first means the workflow is designed around the agent instead of retrofitted.
            Software is now faster and cheaper to build, so building our own also means learning in the process.
          </p>
        </div>

        <div className="mcp-explained-block">
          <h2>How it works</h2>
          <div className="mcp-explained-flow" role="list" aria-label="How a proposal moves through the agents">
            <div className="mcp-explained-step" role="listitem">
              <strong>Proposals: open</strong>
              <span>Anyone can scope a project and get a draft, no sign-in.</span>
            </div>
            <div className="mcp-explained-arrow" aria-hidden="true">→</div>
            <div className="mcp-explained-step" role="listitem">
              <strong>Proposals: signed in</strong>
              <span>Clients review, edit, and sign off.</span>
            </div>
            <div className="mcp-explained-arrow" aria-hidden="true">→</div>
            <div className="mcp-explained-step mcp-explained-handoff" role="listitem">
              <strong>Hand-off (signed in only)</strong>
              <span>Contract and Project Management agents take it from there.</span>
            </div>
          </div>
          <p className="mcp-explained-status">
            Proposals <span className="mcp-status">Live today</span>
            {" "}Contracts and Project Management <span className="mcp-status">Coming next</span>
          </p>
        </div>

        <div className="mcp-explained-cta">
          <a className="button button-primary" href="/try">Try the demo</a>
          <a className="button button-secondary" href="/mcp/getting-started">See sample prompts</a>
        </div>
      </div>
    </section>
  );
}