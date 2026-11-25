import { connectGuides } from "./connectClientPages";
import { ClientLogo, type ClientLogoId, mcpUrl, McpUrlRow } from "./connectShared";

const claudeCommand = `claude mcp add --transport http unwhelm ${mcpUrl}`;

const rows: { name: string; href: string; logo: ClientLogoId; setupMethod: string; configSnippet: string; oauthSupport: string; plans: string }[] = [
  {
    name: "Claude",
    href: "/claude",
    logo: "claude",
    setupMethod: "Customize → Connectors, or the Claude Code command",
    configSnippet: claudeCommand,
    oauthSupport: "Native OAuth 2.1. Complete Unwhelm's email-link sign-in when prompted.",
    plans: "Custom connectors are documented for Free, Pro, Max, Ultra, Team, and Enterprise. Free users are limited to one custom connector. Team and Enterprise owners add the connector for the organization.",
  },
  ...connectGuides.map((guide) => ({
    name: ({ chatgpt: "ChatGPT", cursor: "Cursor", vscode: "VS Code", windsurf: "Windsurf", "gemini-cli": "Gemini CLI", codex: "Codex" } as Record<string, string>)[guide.page] ?? guide.eyebrow,
    href: guide.path,
    logo: guide.page as ClientLogoId,
    setupMethod: guide.setupMethod,
    configSnippet: guide.configSnippet,
    oauthSupport: guide.oauthSupport,
    plans: guide.plans,
  })),
];

/** /connect: side-by-side setup comparison for the documented MCP clients. */
export function ConnectHubPage() {
  return (
    <section className="section legal-section route-section">
      <div className="container legal-shell">
        <div className="section-heading">
          <div className="eyebrow eyebrow-dark">MCP SERVER</div>
          <h1>Connect an MCP client.</h1>
          <p>
            Point your AI app at Unwhelm's remote MCP server and work on proposals from there. Anyone can browse the catalog and draft a proposal without an account. Saving a proposal, and submitting it, require you to be signed in.
          </p>
        </div>
        <article className="connect-hub-intro">
          <h2>The server URL</h2>
          <McpUrlRow />
          <p>
            This is a remote MCP server over HTTPS. Sign-in uses OAuth 2.1. You do not paste a password or API key into the client. The pages below are for clients that document native remote HTTP and OAuth. For Grok, see <a href="/mcp/connect">How to connect</a>.
          </p>
        </article>
        <div className="connect-hub-grid">
          {rows.map((row) => (
            <article className="connect-hub-card" key={row.href}>
              <h2 className="connect-hub-card-title"><ClientLogo id={row.logo} /><a href={row.href}>{row.name}</a></h2>
              <dl>
                <div>
                  <dt>Setup method</dt>
                  <dd>{row.setupMethod}</dd>
                </div>
                <div>
                  <dt>Config snippet</dt>
                  <dd><pre><code>{row.configSnippet}</code></pre></dd>
                </div>
                <div>
                  <dt>Sign-in / OAuth</dt>
                  <dd>{row.oauthSupport}</dd>
                </div>
                <div>
                  <dt>Plans</dt>
                  <dd>{row.plans}</dd>
                </div>
              </dl>
              <p><a href={row.href}>Open the {row.name} guide</a></p>
            </article>
          ))}
        </div>
        <p>
          Need an account first? <a href="/request-access">Request access</a>. To try a shared client account, see the <a href="/demo">demo account</a> page. A shorter Grok and custom-client overview is on <a href="/mcp/connect">How to connect</a>.
        </p>
        <p className="connect-trademark-note">Product names and logos are trademarks of their respective owners; used to identify compatible clients. No endorsement implied.</p>
      </div>
    </section>
  );
}
