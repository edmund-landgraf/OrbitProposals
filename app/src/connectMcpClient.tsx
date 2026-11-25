const mcpUrl = "https://mcp.unwhelm.net/mcp";

type ClientGuide = { name: string; steps: string[] };

// Menu names in these apps move around between releases; the steps name what to look for, not exact click paths.
const clients: ClientGuide[] = [
  { name: "Claude", steps: [
    "Open Claude's settings and find Connectors (custom connectors need a plan that allows them).",
    `Add a custom connector and paste ${mcpUrl} as its URL. Under Authentication choose Sign in now, under OAuth client choose Register automatically, leave Request headers empty, and click Add.`,
    "When you click Add, Claude opens Unwhelm's sign-in page right away; enter your email and use the magic link we send.",
    "Review the scopes on the consent page and approve. Back in Claude, turn the Unwhelm connector on in a chat and ask it to list your proposals.",
  ] },
  { name: "ChatGPT", steps: [
    "On ChatGPT web, go to Plugins, select the plus button, then select Add custom MCP server. You do not need to turn on Developer Mode first in the current Plugins experience.",
    `Enter a name and paste ${mcpUrl} as the MCP server URL, then choose OAuth for authentication.`,
    "Acknowledge the risk warning, create the plugin, and complete Unwhelm's email-link sign-in when prompted.",
    "Install the plugin, type @ in a conversation, select it, and ask it to show your proposals.",
  ] },
  { name: "Grok", steps: [
    "In a Grok app or agent that supports remote MCP servers, add a new MCP server or connector.",
    `Use ${mcpUrl} as the server URL, with OAuth sign-in (no API key needed).`,
    "Sign in on Unwhelm's page with the magic link we email you, then approve the scopes.",
    "Ask Grok to list the Unwhelm tools it can see, then to open one of your proposals.",
  ] },
];

/** /try/connect: how to point Claude, ChatGPT, or Grok at Unwhelm's public MCP server with OAuth. */
export function ConnectMcpClientPage() {
  return (
    <section className="section route-section try-me-help">
      <div className="container">
        <div className="section-heading heading-split try-me-heading">
          <div>
            <div className="eyebrow eyebrow-dark">TRY ME</div>
            <h1>Connect your MCP client</h1>
          </div>
          <p>
            Point your own AI app at Unwhelm's MCP server and work on your real proposals from there.
            For a throwaway sandbox instead, start a run on <a href="/try">Try me</a>.
          </p>
        </div>
        <h2>The server</h2>
        <p>Server URL: <code>{mcpUrl}</code></p>
        <p>
          Sign-in is OAuth 2.1. Your client registers itself (dynamic client registration), proves the sign-in with PKCE (S256),
          and gets a token limited to the scopes you approve. You never paste a password or API key into the AI app.
        </p>
        {clients.map((client) => (
          <div key={client.name} className="connect-client">
            <h2>{client.name}</h2>
            <ol>{client.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </div>
        ))}
        <p>For the full Claude walkthrough, including Claude Desktop and Claude Code, see <a href="/claude">Connect Claude</a>.</p>
        <p>The dedicated <a href="/chatgpt">Connect ChatGPT</a> page has current plan requirements and a diagram. Compare every documented client on the <a href="/connect">connect hub</a>.</p>
        <h2>If it doesn't connect</h2>
        <ul>
          <li>Check the URL ends in <code>/mcp</code> and starts with <code>https://</code>.</li>
          <li>If the magic link has expired, start the connection again; links last 15 minutes.</li>
          <li>To revoke access later, remove the connector in your AI app; its token stops working.</li>
        </ul>
        <p><a href="/try/help">Back to the Try me help guide</a></p>
      </div>
    </section>
  );
}
