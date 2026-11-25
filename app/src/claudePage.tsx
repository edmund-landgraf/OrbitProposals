import { useState } from "react";
import { ClientLogo } from "./connectShared";

const mcpUrl = "https://mcp.unwhelm.net/mcp";
const claudeAddUrl = "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Unwhelm&connectorUrl=https%3A%2F%2Fmcp.unwhelm.net%2Fmcp";
const claudeCodeCommand = `claude mcp add --transport http unwhelm ${mcpUrl}`;

const prompts = [
  "List my proposals",
  "Draft a proposal for a 3-month data warehouse project",
  "Show the service catalog",
  "Open my latest draft and summarize the scope and pricing",
  "What can I do in Unwhelm before I sign in?",
];

/** /claude: how to connect Claude to Unwhelm's remote MCP server. */
export function ClaudePage() {
  const [copied, setCopied] = useState<"url" | "command" | null>(null);

  function copy(label: "url" | "command", text: string) {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <section className="section legal-section route-section">
      <div className="container legal-shell">
        <div className="section-heading">
          <div className="connect-page-kicker">
            <ClientLogo id="claude" />
            <div className="eyebrow eyebrow-dark">CLAUDE</div>
          </div>
          <h1>Connect Claude to Unwhelm.</h1>
          <p>
            Point Claude at Unwhelm's remote MCP server and work on proposals from chat.
            Anyone can browse the catalog and draft a proposal without an account. Saving a proposal, and submitting it, require you to be signed in.
          </p>
        </div>

        <div className="claude-connect-toolbar">
          <div className="mcp-url-row">
            <code>{mcpUrl}</code>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => copy("url", mcpUrl)}
              aria-label="Copy the Unwhelm MCP server URL"
            >
              {copied === "url" ? "Copied" : "Copy URL"}
            </button>
            <a className="button button-primary" href={claudeAddUrl} rel="noopener noreferrer">Add Unwhelm in Claude</a>
          </div>
        </div>

        <div className="claude-connect-columns">
        <div className="legal-grid">
          <article>
            <h2>The server URL</h2>
            <p>
              This is a remote MCP server over HTTPS. Sign-in uses OAuth 2.1. With OAuth client set to Register automatically, Claude registers itself with the server; you do not paste a password, client ID, or API key into Claude.
            </p>
          </article>

          <article>
            <h2>On claude.ai</h2>
            <p>
              Custom connectors using remote MCP are available on Claude, Cowork, and Claude Desktop for Free, Pro, Max, Ultra, Team, and Enterprise plans. Free users are limited to one custom connector.
            </p>
            <p>
              You can open Claude with the name and URL already filled in. Claude shows a notice that those values came from an external link. Review them, then confirm before anything is added:
            </p>
            <h3>For Free, Pro, Max, and Ultra plans</h3>
            <ol>
              <li>Navigate to Customize, then Connectors.</li>
              <li>Click “+ Add”, then “Add custom connector.”</li>
              <li>Enter a name, such as Unwhelm, and the server URL <code>{mcpUrl}</code>. Click “Continue.”</li>
              <li>
                <strong>Set sign-in options</strong> in the Add custom connector dialog:
                <ul>
                  <li>Under Authentication, choose <strong>Sign in now</strong>, even if Claude marks “No sign-in” as Detected.</li>
                  <li>Under OAuth client, choose <strong>Register automatically</strong>. Don't pick “Use Claude's published identity,” even though Claude labels it Recommended: Unwhelm's sign-in doesn't support it, so sign-in would fail.</li>
                  <li>Leave Request headers empty. Unwhelm signs you in with an email link, not an API key.</li>
                </ul>
                Then click “Add.”
              </li>
              <li>
                <strong>Sign in with an email link.</strong> When you click “Add,” Claude opens Unwhelm's sign-in page right away. Enter your email, open the link we send, then approve access (details below).
              </li>
              <li>
                <strong>Let reads run without asking.</strong> Claude then shows the connector's Tool permissions, with Read-only tools and Write/delete tools both set to “Needs approval.” Open the Read-only tools dropdown and set it to allow automatically, so Claude can browse the catalog and your proposals without asking each time. Write/delete tools can stay on “Needs approval,” or allow them too if you trust Claude to save and update proposals without prompting.
              </li>
            </ol>
            <h3>For Team and Enterprise plans</h3>
            <p>
              Only Owners and Primary Owners can add a custom connector to a Team plan. On Enterprise, Owners, Primary Owners, and people with a custom role that includes Manage access to Libraries can add one. They do that in Organization settings, then Connectors.
            </p>
            <p>
              Once the connector has been added to the organization, each person still connects individually: navigate to Customize, then Connectors, find Unwhelm, and click “Connect.” That way Claude only reaches the tools and data that person can access.
            </p>
            <h3>Enable it in a chat</h3>
            <p>
              After the connector is added, enable it for an individual conversation with the “+” button on the lower left of the chat, then “Connectors.” Turn Unwhelm on for that conversation.
            </p>
          </article>

          <article>
            <h2>Sign in with an email link</h2>
            <ol>
              <li>Claude opens Unwhelm's sign-in page. Enter the email for an existing account and choose <strong>Email me a link</strong>.</li>
              <li>Open the one-time link we email you. It works once and expires after 15 minutes.</li>
              <li>Review the scopes on the consent page and choose <strong>Allow</strong>.</li>
            </ol>
            <p>
              New visitors request an account first at <a href="/request-access">Request access</a>. After that request is approved, the magic-link sign-in works. To try a shared client account instead, see the <a href="/demo">demo account</a> page.
            </p>
          </article>

          <article>
            <h2>Claude Desktop</h2>
            <p>
              Remote connectors are configured and brokered through your Claude account, including on Claude Desktop. Add Unwhelm once, then it is available in claude.ai and Claude Desktop when you are signed in to the same account.
            </p>
            <p>
              Claude connects to the server from Anthropic's cloud, not from your computer, so the public URL above is the one to use. Enable the connector in a Desktop chat the same way: the “+” button, then “Connectors.”
            </p>
          </article>

          <article>
            <h2>Claude Code</h2>
            <p>In your terminal, not inside a <code>claude</code> session, add the server:</p>
            <div className="mcp-url-row">
              <pre><code>{claudeCodeCommand}</code></pre>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => copy("command", claudeCodeCommand)}
                aria-label="Copy the Claude Code MCP add command"
              >
                {copied === "command" ? "Copied" : "Copy"}
              </button>
            </div>
            <ol>
              <li>After adding, <code>claude mcp list</code> may show the server with “Needs authentication.” That is expected.</li>
              <li>Start a Claude Code session and enter <code>/mcp</code>.</li>
              <li>Select <code>unwhelm</code> and choose <strong>Authenticate</strong>. Your browser opens Unwhelm's sign-in page. Complete the email link and consent steps above.</li>
              <li>Back in Claude Code, the server's status changes to connected. If the browser does not open, copy the URL shown in the terminal and open it yourself.</li>
            </ol>
          </article>

          <article>
            <h2>Try these prompts</h2>
            <ul>
              {prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}
            </ul>
            <p>More sample prompts are on the <a href="/mcp/getting-started">getting started</a> page. For Grok, ChatGPT, and other clients, see <a href="/mcp/connect">How to connect</a>. Compare setup side by side on the <a href="/connect">connect hub</a>.</p>
          </article>

          <article>
            <h2>If it doesn't connect</h2>
            <ul>
              <li><strong>Authentication error.</strong> Start the connection again. On claude.ai, return to Customize, then Connectors, and connect or add the connector once more. In Claude Code, open <code>/mcp</code>, select <code>unwhelm</code>, and choose Authenticate or Reconnect.</li>
              <li><strong>No sign-in email arrives.</strong> Magic links go only to existing accounts. If you do not have one yet, <a href="/request-access">request access</a>. If you do, check spam and wait a minute, then request a new link. Links expire after 15 minutes.</li>
              <li><strong>The Unwhelm tools do not appear.</strong> Enable the connector in that conversation with the “+” button, then “Connectors.” In Claude Code, confirm <code>claude mcp list</code> shows the server as connected.</li>
              <li>Check that the URL starts with <code>https://</code> and ends in <code>/mcp</code>.</li>
            </ul>
          </article>
        </div>
        <figure className="claude-connect-figure">
          <img
            src="/assets/claude-connect-diagram.svg"
            width="800"
            height="1446"
            alt="Six numbered steps: add a custom connector with the Unwhelm MCP URL, set sign-in options to Sign in now and Register automatically, sign in with an email link, approve access, let read-only tools run without approval, then use Unwhelm in a Claude chat."
          />
        </figure>
        </div>
      </div>
    </section>
  );
}
