// Sample prompts mirror the active Try me plans (try_me rows in prisma/migrations/0036_try_me_demo and later).
// The firm details are an example, not a client.
const prompts = [
  { plan: "Build and submit a proposal", prompt: "Example: I run a 10-person law firm and want to scope a website refresh. Ask me what you need, then draft a proposal.", does: "Reads the engagement types and pricing models from our database, then drafts scope, deliverables, assumptions, exclusions and timeline." },
  { plan: "Build and submit a proposal", prompt: "Show me the Capped Hours option and the other ways you can price this.", does: "Lists Workflow Check, Capped Hours and Fixed Price from the catalog. It never sets hours or a price; a person does." },
  { plan: "Build and submit a proposal", prompt: "Show me what's still open on the draft, then submit it for review.", does: "Hands hours, milestones and terms to staff, reads the draft back to you, and submits it, which saves a version." },
  { plan: "Scope creep, handled gently", prompt: "Can we also add a client portal and a blog?", does: "Shows what each addition does to progress, parks ideas for later, and offers a fresh start or a human." },
  { plan: "Reminders and ticklers", prompt: "Remind me by email every 3 days at 9am until I finish.", does: "Saves your reminder choice with your consent and schedules the tickler." },
  { plan: "Review, comments, and acceptance", prompt: "What comments and flags are open on my proposal, and which ones are mine?", does: "Shows which review steps are yours and which belong to staff." },
  { plan: "Free consult and chat", prompt: "Book my free consult and open a chat with the proposal agent.", does: "Requests the free 30-minute consult and starts a chat session with the proposal agent." },
];

/** /mcp/getting-started: copy-paste prompts for a connected AI app, one line each on what the agent does. */
export function McpGettingStartedPage() {
  return (
    <section className="section route-section try-me-help mcp-getting-started-page">
      <div className="container">
        <div className="section-heading heading-split try-me-heading">
          <div>
            <div className="eyebrow eyebrow-dark">MCP SERVER</div>
            <h1>Getting started</h1>
          </div>
          <p>
            Once your app is <a href="/mcp/connect">connected</a>, paste any of these. They follow the same plans you can watch on <a href="/try">Try me</a>.
          </p>
        </div>
        <ol className="mcp-prompts">
          {prompts.map((item) => (
            <li key={item.prompt}>
              <span className="card-eyebrow">{item.plan}</span>
              <pre><code>{item.prompt}</code></pre>
              <p>{item.does}</p>
            </li>
          ))}
        </ol>
        <p><a href="/mcp/connect">Back to How to connect</a></p>
      </div>
    </section>
  );
}
