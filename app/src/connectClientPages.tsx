import type { ReactNode } from "react";
import { ClientLogo, type ClientLogoId, ConnectNav, CopySnippet, mcpUrl, McpUrlRow, PromptsArticle, SignInArticle } from "./connectShared";

export type ConnectGuide = {
  path: string;
  page: string;
  eyebrow: string;
  title: string;
  description: string;
  metaDescription: string;
  diagramSrc: string;
  diagramAlt: string;
  intro: ReactNode;
  setupMethod: string;
  configSnippet: string;
  configLabel: string;
  oauthSupport: string;
  plans: string;
  setup: ReactNode;
  notes?: ReactNode;
  troubleshoot: ReactNode;
};

const cursorInstallLink = "cursor://anysphere.cursor-deeplink/mcp/install?name=unwhelm&config=eyJ1cmwiOiJodHRwczovL21jcC51bndoZWxtLm5ldC9tY3AifQ%3D%3D";

const cursorConfig = `{
  "mcpServers": {
    "unwhelm": {
      "url": "https://mcp.unwhelm.net/mcp"
    }
  }
}`;

const vscodeConfig = `{
  "mcpServers": {
    "unwhelm": {
      "type": "http",
      "url": "https://mcp.unwhelm.net/mcp",
      "tools": ["*"]
    }
  }
}`;

const windsurfConfig = `{
  "mcpServers": {
    "unwhelm": {
      "serverUrl": "https://mcp.unwhelm.net/mcp"
    }
  }
}`;

const geminiConfig = `{
  "mcpServers": {
    "unwhelm": {
      "httpUrl": "https://mcp.unwhelm.net/mcp"
    }
  }
}`;

const geminiCommand = `gemini mcp add --transport http unwhelm ${mcpUrl}`;

const codexConfig = `[mcp_servers.unwhelm]
url = "https://mcp.unwhelm.net/mcp"`;

const codexLogin = "codex mcp login unwhelm";

export const connectGuides: ConnectGuide[] = [
  {
    path: "/chatgpt",
    page: "chatgpt",
    eyebrow: "CHATGPT",
    title: "Connect ChatGPT to Unwhelm.",
    description: "Add Unwhelm as a custom MCP server in ChatGPT. Sign in with an email link, then use it from chat.",
    metaDescription: "Add Unwhelm as a custom MCP server in ChatGPT. Sign in with an email link, then list proposals and draft work from chat.",
    diagramSrc: "/assets/chatgpt-connect-diagram.svg",
    diagramAlt: "Four numbered steps: add a custom MCP server in ChatGPT Plugins, enter the Unwhelm URL, configure OAuth and approve access, then install the plugin and use it in chat with @.",
    intro: <>Point ChatGPT at Unwhelm's remote MCP server and work on proposals from chat. Anyone can browse the catalog and draft a proposal without an account. Saving a proposal, and submitting it, require you to be signed in.</>,
    setupMethod: "Plugins → Add custom MCP server",
    configSnippet: mcpUrl,
    configLabel: "Copy the Unwhelm MCP server URL",
    oauthSupport: "Native OAuth (including DCR or CIMD). Complete Unwhelm's email-link sign-in when prompted.",
    plans: "Full MCP is documented for Business and Enterprise/Edu on ChatGPT web. Pro can connect custom MCP servers with read/fetch permissions. You do not need to turn on Developer Mode first in the current Plugins experience.",
    setup: (
      <>
        <h2>On ChatGPT web</h2>
        <p>
          Custom MCP server connections are documented for ChatGPT Business and Enterprise/Edu customers on ChatGPT web. Pro users can connect custom MCP servers with read/fetch permissions. Full MCP is only available to Business and Enterprise/Edu users, currently. Workspace permissions and security restrictions, including Lockdown, still apply.
        </p>
        <p>
          In the current Plugins experience, add a custom MCP server directly from Plugins. You do not need to turn on Developer Mode first. Instead, review and acknowledge the risk warning for each server you add.
        </p>
        <ol>
          <li>Go to Plugins.</li>
          <li>Select the plus button, then select “Add custom MCP server.”</li>
          <li>Enter a name, such as Unwhelm, and optionally a description.</li>
          <li>Under Connection, enter the server's public HTTPS MCP endpoint URL: <code>{mcpUrl}</code>. Clicking Create uses streaming HTTP or SSE, which this server supports.</li>
          <li>Configure authentication for the server. Choose OAuth when that option is offered. You never paste a password, client ID, or API key into ChatGPT unless a form explicitly asks for a client you already registered.</li>
          <li>Review the risk warning and select “I understand and want to continue.”</li>
          <li>Select “Create as a plugin,” then review the discovered tools and metadata. If the server uses OAuth, complete the Unwhelm sign-in and consent steps below.</li>
        </ol>
        <h3>Business, Enterprise, and Edu workspaces</h3>
        <p>
          On Business plans, only admins and owners can create and publish plugins for custom MCP servers. On Enterprise/Edu, admins and owners can create and test connections, and only they can publish apps for the workspace. Enterprise/Edu admins can use role-based access control to grant selected members permission to create connections.
        </p>
        <h3>Use it in a conversation</h3>
        <ol>
          <li>Install the resulting plugin, then start a new conversation.</li>
          <li>Type <code>@</code> in the prompt box and select the plugin.</li>
          <li>Confirm actions when prompted. Write actions require confirmation by default.</li>
        </ol>
      </>
    ),
    troubleshoot: (
      <ul>
        <li><strong>Authentication error.</strong> Start the connection again from Plugins, or reconnect the plugin and complete the sign-in steps below.</li>
        <li><strong>No sign-in email arrives.</strong> Magic links go only to existing accounts. If you do not have one yet, <a href="/request-access">request access</a>. If you do, check spam and wait a minute, then request a new link. Links expire after 15 minutes.</li>
        <li><strong>The Unwhelm tools do not appear.</strong> Install the plugin, start a new conversation, type <code>@</code>, and select Unwhelm. Workspace policy can also block custom MCP servers.</li>
        <li>Check that the URL starts with <code>https://</code> and ends in <code>/mcp</code>.</li>
      </ul>
    ),
  },
  {
    path: "/cursor",
    page: "cursor",
    eyebrow: "CURSOR",
    title: "Connect Cursor to Unwhelm.",
    description: "Add Unwhelm in Cursor with mcp.json or a one-click install link, then sign in with an email link.",
    metaDescription: "Add Unwhelm to Cursor with mcp.json or a one-click install link. Sign in with an email link, then list proposals from Agent chat.",
    diagramSrc: "/assets/cursor-connect-diagram.svg",
    diagramAlt: "Four numbered steps: add the Unwhelm URL in Cursor mcp.json or an install link, open Cursor, sign in with an email link, then use Unwhelm in Agent chat.",
    intro: <>Point Cursor at Unwhelm's remote MCP server and work on proposals from Agent chat. Anyone can browse the catalog and draft a proposal without an account. Saving a proposal, and submitting it, require you to be signed in.</>,
    setupMethod: "mcp.json or one-click install link",
    configSnippet: cursorConfig,
    configLabel: "Copy the Cursor mcp.json snippet",
    oauthSupport: "Native OAuth for Streamable HTTP and SSE. Cursor uses the authorization code flow with PKCE and can register itself with dynamic client registration.",
    plans: "No separate paid-plan requirement is documented for adding a custom remote MCP server in Cursor. Team and enterprise admins can distribute or restrict servers.",
    setup: (
      <>
        <h2>One-click install</h2>
        <p>
          Cursor can install a custom MCP server from a deeplink. Click the link or paste it into a browser. Cursor prompts you to install the server, then you can use it in Cursor.
        </p>
        <p className="legal-actions">
          <a className="button button-primary" href={cursorInstallLink}>Add Unwhelm in Cursor</a>
        </p>
        <h2>Or add mcp.json yourself</h2>
        <p>
          Configure custom servers in a JSON file. Use <code>.cursor/mcp.json</code> in a project folder to share it with your team, or <code>~/.cursor/mcp.json</code> in your home directory for every project. Both files are merged; a project-level server with the same name takes priority.
        </p>
        <CopySnippet text={cursorConfig} label="Copy the Cursor mcp.json snippet" />
        <p>
          For a remote server, the important field is <code>url</code>. You do not need a client ID or secret. Cursor supports Streamable HTTP with OAuth.
        </p>
        <p>You can also open Customize in the sidebar to review, toggle, or remove MCP servers after they are installed.</p>
      </>
    ),
    notes: (
      <article>
        <h2>Sign-in in Cursor</h2>
        <p>
          Cursor supports OAuth for servers that require it. Sign-in uses the authorization code flow with PKCE. With dynamic client registration, Cursor registers as a public client with no client secret. Complete the Unwhelm email-link steps below when the browser opens.
        </p>
        <p>If a connection fails, open the Output panel in Cursor, select “MCP Logs,” and try the server again from Customize.</p>
      </article>
    ),
    troubleshoot: (
      <ul>
        <li><strong>Authentication error.</strong> Toggle the server off and on in Customize, or sign in again when Cursor prompts you.</li>
        <li><strong>No sign-in email arrives.</strong> Magic links go only to existing accounts. If you do not have one yet, <a href="/request-access">request access</a>. Check spam, then request a new link. Links expire after 15 minutes.</li>
        <li><strong>The Unwhelm tools do not appear.</strong> Confirm the server is enabled in Customize and that the config uses <code>url</code> with this exact endpoint.</li>
        <li>Check that the URL starts with <code>https://</code> and ends in <code>/mcp</code>.</li>
      </ul>
    ),
  },
  {
    path: "/vscode",
    page: "vscode",
    eyebrow: "VS CODE",
    title: "Connect VS Code to Unwhelm.",
    description: "Add Unwhelm as an HTTP MCP server in VS Code and GitHub Copilot, then sign in with an email link.",
    metaDescription: "Add Unwhelm in VS Code and GitHub Copilot with MCP: Add Server or a portable mcp.json. Sign in with an email link, then use it in Copilot chat.",
    diagramSrc: "/assets/vscode-connect-diagram.svg",
    diagramAlt: "Four numbered steps: add an HTTP MCP server in VS Code, save the configuration, complete Unwhelm sign-in, then use Unwhelm in Copilot chat.",
    intro: <>Point VS Code and GitHub Copilot at Unwhelm's remote MCP server and work on proposals from chat. Anyone can browse the catalog and draft a proposal without an account. Saving a proposal, and submitting it, require you to be signed in.</>,
    setupMethod: "MCP: Add Server, or portable mcp.json (type http)",
    configSnippet: vscodeConfig,
    configLabel: "Copy the VS Code MCP config snippet",
    oauthSupport: "Native browser sign-in / OAuth. Complete authorization when prompted, and use Authenticate in the session's server actions when offered.",
    plans: "The walkthrough uses the Copilot harness in VS Code. Organization policy can restrict MCP servers. No other plan name is documented on the VS Code MCP pages.",
    setup: (
      <>
        <h2>Add the server in VS Code</h2>
        <p>
          Enable AI features and open a project folder. Select Copilot in the Session Target dropdown. Then add Unwhelm as an HTTP server:
        </p>
        <ol>
          <li>Run <strong>MCP: Add Server</strong> from the Command Palette, or run <strong>Chat: Open Customizations</strong>, select MCP Servers, and select Add Server.</li>
          <li>Choose HTTP (HTTP or Server-Sent Events) and enter the server endpoint: <code>{mcpUrl}</code>.</li>
          <li>Enter a unique server ID, such as <code>unwhelm</code>.</li>
          <li>For personal use across workspaces, select Global, then Copilot Global. That configuration is stored in <code>~/.copilot/mcp-config.json</code> when <code>COPILOT_HOME</code> is unset.</li>
          <li>To share the server with teammates in the same workspace, use a workspace-root <code>.mcp.json</code> when that option is offered.</li>
          <li>Review any server trust requests, then complete the Unwhelm sign-in below when the browser opens.</li>
        </ol>
        <h2>The current config format</h2>
        <p>
          For new Copilot configurations, official docs recommend a portable top-level <code>mcpServers</code> object, not a new <code>.vscode/mcp.json</code> file. <code>.vscode/mcp.json</code> and profile <code>mcp.json</code> use the older editor-managed format for the Local harness, which is deprecated and scheduled for removal in February 2027.
        </p>
        <CopySnippet text={vscodeConfig} label="Copy the VS Code MCP config snippet" />
        <p>
          If you already have a working <code>.vscode/mcp.json</code>, you can keep using it for now, or migrate it to <code>.mcp.json</code> at the workspace root. Do not invent a mix of the two formats in one file.
        </p>
      </>
    ),
    troubleshoot: (
      <ul>
        <li><strong>Authentication error.</strong> Use Authenticate in the session's server actions when it is offered, then complete the sign-in steps below again.</li>
        <li><strong>No sign-in email arrives.</strong> Magic links go only to existing accounts. If you do not have one yet, <a href="/request-access">request access</a>. Check spam, then request a new link. Links expire after 15 minutes.</li>
        <li><strong>The Unwhelm tools do not appear.</strong> Confirm Copilot is selected, the server is started, and organization policy allows custom MCP servers. Ask Copilot to use Unwhelm for a low-impact task and inspect the tool call.</li>
        <li>Check that the URL starts with <code>https://</code> and ends in <code>/mcp</code>.</li>
      </ul>
    ),
  },
  {
    path: "/windsurf",
    page: "windsurf",
    eyebrow: "WINDSURF",
    title: "Connect Windsurf to Unwhelm.",
    description: "Add Unwhelm to Windsurf Cascade with mcp_config.json and a serverUrl, then sign in with an email link.",
    metaDescription: "Add Unwhelm in Windsurf or Devin Desktop Cascade with mcp_config.json and serverUrl. Sign in with an email link, then use it in Cascade.",
    diagramSrc: "/assets/windsurf-connect-diagram.svg",
    diagramAlt: "Four numbered steps: open the Windsurf MCP config file, add the Unwhelm serverUrl, refresh and sign in with an email link, then use Unwhelm in Cascade.",
    intro: <>Point Windsurf's Cascade agent at Unwhelm's remote MCP server and work on proposals from chat. Anyone can browse the catalog and draft a proposal without an account. Saving a proposal, and submitting it, require you to be signed in.</>,
    setupMethod: "mcp_config.json with serverUrl (or url)",
    configSnippet: windsurfConfig,
    configLabel: "Copy the Windsurf mcp_config.json snippet",
    oauthSupport: "Native OAuth for remote servers that use Streamable HTTP or SSE. OAuth is not available for stdio servers.",
    plans: "Enterprise users must turn MCP on in settings. Team admins can allowlist servers; once any server is allowlisted, other servers are blocked.",
    setup: (
      <>
        <h2>In Windsurf or Devin Desktop</h2>
        <p>
          Windsurf's Cascade agent still uses this setup. Official docs now live under Devin, and the app may appear as Devin Desktop. Cascade supports Streamable HTTP and OAuth for remote servers.
        </p>
        <ol>
          <li>Add a server from Settings, then Tools, then Windsurf Settings, then Add Server. To edit the file yourself, use Open MCP config file in Cascade's MCP menu.</li>
          <li>That action opens the Cortex-managed file: <code>~/.config/devin/mcp_config.json</code> on macOS and Linux (or <code>$XDG_CONFIG_HOME/devin/mcp_config.json</code>), and <code>%AppData%/devin/mcp_config.json</code> on Windows.</li>
          <li>For a remote HTTP server, set <code>serverUrl</code> or <code>url</code>:</li>
        </ol>
        <CopySnippet text={windsurfConfig} label="Copy the Windsurf mcp_config.json snippet" />
        <p>Leave headers empty so Cascade can start OAuth when the server requires sign-in. Do not paste a password into the file.</p>
        <p>Press the refresh button after you add the server. When you click an MCP server, click “+ Add Server” if you still need to expose its tools to Cascade.</p>
        <p>
          Older Windsurf builds also had an editor discovery file at <code>~/.codeium/windsurf/mcp_config.json</code>. Use the file that Open MCP config file actually opens for your install.
        </p>
      </>
    ),
    troubleshoot: (
      <ul>
        <li><strong>Authentication error.</strong> Refresh the MCP list and complete the sign-in steps below again.</li>
        <li><strong>No sign-in email arrives.</strong> Magic links go only to existing accounts. If you do not have one yet, <a href="/request-access">request access</a>. Check spam, then request a new link. Links expire after 15 minutes.</li>
        <li><strong>The Unwhelm tools do not appear.</strong> Press refresh after editing the config. On a team plan, check whether MCP servers are allowlisted. Enterprise users must turn MCP on in settings first.</li>
        <li>Check that the URL starts with <code>https://</code> and ends in <code>/mcp</code>.</li>
      </ul>
    ),
  },
  {
    path: "/gemini-cli",
    page: "gemini-cli",
    eyebrow: "GEMINI CLI",
    title: "Connect Gemini CLI to Unwhelm.",
    description: "Add Unwhelm in Gemini CLI with httpUrl in settings.json, then sign in with /mcp auth and an email link.",
    metaDescription: "Add Unwhelm to Gemini CLI with httpUrl in settings.json or gemini mcp add. Authenticate with /mcp auth and an email link.",
    diagramSrc: "/assets/gemini-cli-connect-diagram.svg",
    diagramAlt: "Four numbered steps: add Unwhelm with httpUrl in Gemini CLI settings, start the CLI, run /mcp auth, then use Unwhelm in the CLI.",
    intro: <>Point Gemini CLI at Unwhelm's remote MCP server and work on proposals from the terminal. Anyone can browse the catalog and draft a proposal without an account. Saving a proposal, and submitting it, require you to be signed in.</>,
    setupMethod: "settings.json httpUrl, or gemini mcp add --transport http",
    configSnippet: geminiConfig,
    configLabel: "Copy the Gemini CLI settings snippet",
    oauthSupport: "Native OAuth 2.0 for HTTP and SSE. The CLI can discover OAuth from a 401 and server metadata, register a client dynamically, and then you run /mcp auth.",
    plans: "No separate Gemini paid-plan requirement is documented on the official MCP server page. The CLI must be able to open a local browser for sign-in.",
    setup: (
      <>
        <h2>Add the server</h2>
        <p>
          Gemini CLI reads MCP servers from the <code>mcpServers</code> object in <code>settings.json</code>. User config is <code>~/.gemini/settings.json</code>. Project config is <code>.gemini/settings.json</code>. Official docs list <code>httpUrl</code> as the HTTP streaming endpoint field for streamable HTTP.
        </p>
        <CopySnippet text={geminiConfig} label="Copy the Gemini CLI settings snippet" />
        <p>Or add it from your terminal, not from inside a Gemini session:</p>
        <CopySnippet text={geminiCommand} label="Copy the Gemini CLI add command" />
        <p>The <code>add</code> command can target user or project scope with <code>-s</code> or <code>--scope</code>.</p>
        <h2>Authenticate</h2>
        <p>
          Gemini CLI supports OAuth 2.0 for remote HTTP servers. For servers that support OAuth discovery, you can omit an <code>oauth</code> block and let the CLI discover it: it detects a 401, reads server metadata, and can use dynamic client registration.
        </p>
        <ol>
          <li>Start a Gemini CLI session.</li>
          <li>Run <code>/mcp auth</code> to list servers that need authentication, or <code>/mcp auth unwhelm</code> to sign in to Unwhelm.</li>
          <li>Complete the Unwhelm email-link steps below in the browser, then choose Allow.</li>
          <li>If a token expires, run <code>/mcp auth unwhelm</code> again.</li>
        </ol>
        <p>
          OAuth sign-in needs a local browser and a redirect back to the CLI. Official docs note that this flow will not work in headless environments without browser access, remote SSH sessions without forwarding, or containers without a browser.
        </p>
      </>
    ),
    troubleshoot: (
      <ul>
        <li><strong>Authentication error.</strong> Run <code>/mcp auth unwhelm</code> again, or <code>gemini mcp list</code> from your shell to see connection errors.</li>
        <li><strong>No sign-in email arrives.</strong> Magic links go only to existing accounts. If you do not have one yet, <a href="/request-access">request access</a>. Check spam, then request a new link. Links expire after 15 minutes.</li>
        <li><strong>The Unwhelm tools do not appear.</strong> Confirm the server is in the settings file that your current scope reads, and that it is not disabled or excluded in the global <code>mcp</code> settings.</li>
        <li>Check that the URL starts with <code>https://</code> and ends in <code>/mcp</code>.</li>
      </ul>
    ),
  },
  {
    path: "/codex",
    page: "codex",
    eyebrow: "CODEX",
    title: "Connect Codex to Unwhelm.",
    description: "Add Unwhelm in the Codex CLI or ChatGPT desktop app as a Streamable HTTP MCP server, then sign in with an email link.",
    metaDescription: "Add Unwhelm to Codex with a Streamable HTTP url in config.toml, then run codex mcp login and sign in with an email link.",
    diagramSrc: "/assets/codex-connect-diagram.svg",
    diagramAlt: "Four numbered steps: add Unwhelm as a Streamable HTTP server in Codex config.toml, confirm the URL, run codex mcp login, then use Unwhelm in Codex.",
    intro: <>Point Codex at Unwhelm's remote MCP server and work on proposals from the CLI, the ChatGPT desktop app, or the IDE extension. Anyone can browse the catalog and draft a proposal without an account. Saving a proposal, and submitting it, require you to be signed in.</>,
    setupMethod: "config.toml url, or Add server in the desktop app / IDE",
    configSnippet: codexConfig,
    configLabel: "Copy the Codex config.toml snippet",
    oauthSupport: "Native OAuth for Streamable HTTP, including CIMD and DCR. auth defaults to oauth. Run codex mcp login, or select Authenticate in the desktop app or IDE.",
    plans: "The ChatGPT desktop app, Codex CLI, and IDE extension share ~/.codex/config.toml. No separate Codex plan requirement is documented on the MCP page.",
    setup: (
      <>
        <h2>Streamable HTTP in config.toml</h2>
        <p>
          Codex stores MCP configuration in <code>config.toml</code>. By default this is <code>~/.codex/config.toml</code>. You can also scope servers to a project with <code>.codex/config.toml</code> in trusted projects only. The ChatGPT desktop app, Codex CLI, and IDE extension share this configuration.
        </p>
        <p>Official docs describe Streamable HTTP servers, with <code>url</code> required. OAuth authentication is supported, including Client ID Metadata Documents and dynamic client registration. The optional <code>auth</code> field defaults to <code>oauth</code> for stored MCP OAuth credentials.</p>
        <CopySnippet text={codexConfig} label="Copy the Codex config.toml snippet" />
        <p>If no credential is stored yet, run this separately to start the OAuth login:</p>
        <CopySnippet text={codexLogin} label="Copy the Codex MCP login command" />
        <p>
          If you are in a terminal without a local browser, run <code>codex mcp login unwhelm --no-browser</code>. Open the printed authorization URL, sign in, and paste the full redirect URL back into the terminal, even if the browser cannot load the callback page.
        </p>
        <h3>ChatGPT desktop app or the IDE extension</h3>
        <ol>
          <li>Open Settings (or the gear menu in the IDE), then select MCP servers.</li>
          <li>Select Add server. Enter a name, choose Streamable HTTP, and provide the URL <code>{mcpUrl}</code>.</li>
          <li>Save the server, then select Restart (or Restart extension in the IDE).</li>
          <li>The server list shows which servers require OAuth. Select Authenticate when sign-in is needed.</li>
        </ol>
        <p>In the <code>codex</code> TUI, type <code>/mcp</code> to see connected servers. Run <code>codex mcp list</code> from your shell to review configured servers.</p>
      </>
    ),
    troubleshoot: (
      <ul>
        <li><strong>Authentication error.</strong> Run <code>codex mcp login unwhelm</code> again, or select Authenticate in the desktop or IDE server list.</li>
        <li><strong>No sign-in email arrives.</strong> Magic links go only to existing accounts. If you do not have one yet, <a href="/request-access">request access</a>. Check spam, then request a new link. Links expire after 15 minutes.</li>
        <li><strong>The Unwhelm tools do not appear.</strong> Confirm the <code>url</code> is exact, the server is not set to <code>enabled = false</code>, and you restarted the app or extension after editing the file.</li>
        <li>Check that the URL starts with <code>https://</code> and ends in <code>/mcp</code>.</li>
      </ul>
    ),
  },
];

export function ConnectClientPage({ guide }: { guide: ConnectGuide }) {
  return (
    <section className="section legal-section route-section">
      <div className="container legal-shell">
        <div className="section-heading">
          <div className="connect-page-kicker">
            <ClientLogo id={guide.page as ClientLogoId} />
            <div className="eyebrow eyebrow-dark">{guide.eyebrow}</div>
          </div>
          <h1>{guide.title}</h1>
          <p>{guide.intro}</p>
        </div>
        <figure className="claude-connect-figure">
          <img src={guide.diagramSrc} width="800" alt={guide.diagramAlt} />
        </figure>
        <div className="legal-grid">
          <article>
            <h2>The server URL</h2>
            <McpUrlRow />
            <p>
              This is a remote MCP server over HTTPS. Sign-in uses OAuth 2.1. You do not paste a password or API key into the client.
            </p>
          </article>
          <article>{guide.setup}</article>
          <SignInArticle />
          {guide.notes}
          <PromptsArticle extra={<ConnectNav current={guide.path} />} />
          <article>
            <h2>If it doesn't connect</h2>
            {guide.troubleshoot}
          </article>
        </div>
      </div>
    </section>
  );
}

export function ChatGptPage() {
  return <ConnectClientPage guide={connectGuides[0]} />;
}
export function CursorConnectPage() {
  return <ConnectClientPage guide={connectGuides[1]} />;
}
export function VsCodeConnectPage() {
  return <ConnectClientPage guide={connectGuides[2]} />;
}
export function WindsurfConnectPage() {
  return <ConnectClientPage guide={connectGuides[3]} />;
}
export function GeminiCliConnectPage() {
  return <ConnectClientPage guide={connectGuides[4]} />;
}
export function CodexConnectPage() {
  return <ConnectClientPage guide={connectGuides[5]} />;
}
