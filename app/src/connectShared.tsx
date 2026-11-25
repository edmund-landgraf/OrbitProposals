import { useState, type ReactNode } from "react";

export const mcpUrl = "https://mcp.unwhelm.net/mcp";

export const clientLogos = {
  claude: { file: "claude", name: "Claude" },
  chatgpt: { file: "chatgpt", name: "ChatGPT" },
  cursor: { file: "cursor", name: "Cursor" },
  vscode: { file: "vscode", name: "VS Code" },
  windsurf: { file: "windsurf", name: "Windsurf" },
  "gemini-cli": { file: "gemini-cli", name: "Gemini CLI" },
  codex: { file: "codex", name: "Codex" },
} as const;

export type ClientLogoId = keyof typeof clientLogos;

export function ClientLogo({ id }: { id: ClientLogoId }) {
  const { file, name } = clientLogos[id];
  return (
    <img
      className="client-logo"
      src={`/assets/logos/${file}.svg`}
      width={32}
      height={32}
      alt={`${name} logo`}
    />
  );
}

export const connectPrompts = [
  "List my proposals",
  "Draft a proposal for a 3-month data warehouse project",
  "Show the service catalog",
  "Open my latest draft and summarize the scope and pricing",
  "What can I do in Unwhelm before I sign in?",
];

export function McpUrlRow() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mcp-url-row">
      <code>{mcpUrl}</code>
      <button
        className="button button-secondary"
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(mcpUrl).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label="Copy the Unwhelm MCP server URL"
      >
        {copied ? "Copied" : "Copy URL"}
      </button>
    </div>
  );
}

export function CopySnippet({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mcp-url-row">
      <pre><code>{text}</code></pre>
      <button
        className="button button-secondary"
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label={label}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function SignInArticle() {
  return (
    <article>
      <h2>Sign in with an email link</h2>
      <ol>
        <li>The client opens Unwhelm's sign-in page. Enter the email for an existing account and choose <strong>Email me a link</strong>.</li>
        <li>Open the one-time link we email you. It works once and expires after 15 minutes.</li>
        <li>Review the scopes on the consent page and choose <strong>Allow</strong>.</li>
      </ol>
      <p>
        New visitors request an account first at <a href="/request-access">Request access</a>. After that request is approved, the magic-link sign-in works. To try a shared client account instead, see the <a href="/demo">demo account</a> page.
      </p>
    </article>
  );
}

export function PromptsArticle({ extra }: { extra?: ReactNode }) {
  return (
    <article>
      <h2>Try these prompts</h2>
      <ul>
        {connectPrompts.map((prompt) => <li key={prompt}>{prompt}</li>)}
      </ul>
      <p>More sample prompts are on the <a href="/mcp/getting-started">getting started</a> page.</p>
      {extra}
    </article>
  );
}

export function ConnectNav({ current }: { current?: string }) {
  return (
    <p>
      See every client side by side on the <a href="/connect">connect hub</a>
      {current !== "/claude" && <> · <a href="/claude">Claude</a></>}
      {current !== "/chatgpt" && <> · <a href="/chatgpt">ChatGPT</a></>}
      {current !== "/cursor" && <> · <a href="/cursor">Cursor</a></>}
      {current !== "/vscode" && <> · <a href="/vscode">VS Code</a></>}
      {current !== "/windsurf" && <> · <a href="/windsurf">Windsurf</a></>}
      {current !== "/gemini-cli" && <> · <a href="/gemini-cli">Gemini CLI</a></>}
      {current !== "/codex" && <> · <a href="/codex">Codex</a></>}
      . For Grok and a shorter overview, see <a href="/mcp/connect">How to connect</a>.
    </p>
  );
}
