const mcpUrl = "https://mcp.unwhelm.net/mcp";

// Every step below matches the OAuth flow in server/routes/systemAuth.ts and unwh-mcp/src/http.ts:
// dynamic client registration, S256 PKCE, an emailed magic link (15 minutes), a consent page, then a 30-day bearer token.
const signInSteps = [
  "Your app opens Unwhelm's sign-in page. Enter your email address.",
  "Open the magic link we email you. It works once and expires after 15 minutes.",
  "Review the scopes on the consent page and choose Allow.",
];

/** /mcp/connect: how to connect Grok, ChatGPT, Claude, or your own MCP client to Unwhelm's MCP server. */
export function McpConnectPage() {
  return (
    <section className="section route-section try-me-help mcp-connect-page">
      <div className="container">
        <div className="section-heading heading-split try-me-heading">
          <div>
            <div className="eyebrow eyebrow-dark">MCP SERVER</div>
            <h1>How to connect</h1>
          </div>
          <p>
            Point your own AI app at <code>{mcpUrl}</code> and sign in with OAuth. You never paste a password or API key into the app.
            Then try the <a href="/mcp/getting-started">sample prompts</a>.
          </p>
        </div>

        <div className="connect-client" id="grok">
          <h2>Grok <span className="mcp-status">Ready</span></h2>
          <ol>
            <li>In Grok, add a remote MCP server (connector) with the URL <code>{mcpUrl}</code>. No API key is needed; Grok registers itself with our server.</li>
            {signInSteps.map((step) => <li key={step}>{step}</li>)}
            <li>Back in Grok, ask it to list the Unwhelm tools it can see.</li>
          </ol>
        </div>

        <div className="connect-client" id="chatgpt">
          <h2>ChatGPT <span className="mcp-status">Ready on supported plans</span></h2>
          <p>The dedicated <a href="/chatgpt">Connect ChatGPT</a> page has the current steps for adding Unwhelm as a custom MCP server, including a diagram, plan requirements, and example prompts.</p>
          <p>On ChatGPT web, go to Plugins, select the plus button, then select “Add custom MCP server.” Enter a name and the URL <code>{mcpUrl}</code>, configure OAuth, acknowledge the risk warning, and create the plugin. Install it, then type @ in a conversation and select the plugin.</p>
          <p>Full MCP is documented for Business and Enterprise/Edu. Pro can connect custom MCP servers with read/fetch permissions. In the current Plugins experience you do not need to turn on Developer Mode first.</p>
        </div>

        <div className="connect-client" id="claude">
          <h2>Claude <span className="mcp-status">Beta</span></h2>
          <p>The dedicated <a href="/claude">Connect Claude</a> page has the current steps for claude.ai, Claude Desktop, and Claude Code, including a diagram and example prompts.</p>
          <p><strong>Claude Desktop and claude.ai:</strong> open Settings, then Connectors, and add a custom connector with the URL <code>{mcpUrl}</code>. Leave the client ID and secret empty, click Connect, and complete the sign-in below.</p>
          <p><strong>Claude Code:</strong></p>
          <pre><code>claude mcp add --transport http unwhelm {mcpUrl}</code></pre>
          <ol>{signInSteps.map((step) => <li key={step}>{step}</li>)}</ol>
        </div>

        <div className="connect-client" id="your-own-client">
          <h2>Your own MCP client</h2>
          <ol>
            <li>Server URL: <code>{mcpUrl}</code> (Streamable HTTP). A request without a token gets a 401 that points to the protected-resource metadata and our authorization server.</li>
            <li>OAuth 2.1: register with dynamic client registration (DCR) as a public client, then authorize with PKCE (S256 only).</li>
            <li>Sign in with the magic-link email and approve the scopes. The token lasts 30 days; there is no refresh token, so sign in again when it expires.</li>
            <li>Pick an agent: start a chat session with <code>unw_create_chat_session</code> and choose <code>proposal</code> (the default), <code>contract</code>, or <code>project_manager</code>.</li>
          </ol>
        </div>

        <h2>If it doesn't connect</h2>
        <ul>
          <li>Check the URL starts with <code>https://</code> and ends in <code>/mcp</code>.</li>
          <li>If the magic link expired, start the connection again.</li>
          <li>To revoke access, remove the connector in your AI app.</li>
        </ul>
        <p>Compare setup for each client, side by side, on the <a href="/connect">connect hub</a>.</p>
        <p><a href="/mcp/getting-started">Next: sample prompts to get started</a></p>
      </div>
    </section>
  );
}
