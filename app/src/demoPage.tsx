const demoEmail = "app-reviewer@unwhelm.net";
const contactEmail = "contact@unwhelm.net";
const mcpUrl = "https://mcp.unwhelm.net/mcp";
const signInUrl = "https://unwhelm.net/api/v1/auth/signin";

const prompts = [
  "List my proposals",
  "Open the Executive Recruiting proposal and summarize it",
  "Draft a new proposal for a small landlord who wants AI help with tenant screening",
];

/** /demo: how to try Unwhelm with the shared client reviewer account. */
export function DemoPage() {
  return (
    <section className="section legal-section route-section">
      <div className="container legal-shell">
        <div className="section-heading">
          <div className="eyebrow eyebrow-dark">DEMO</div>
          <h1>Try the demo account.</h1>
          <p>
            The demo account is an ordinary client account, not a staff account. Sign in as <a href={`mailto:${demoEmail}`}>{demoEmail}</a>.
            It owns a sample proposal titled <strong>Executive Recruiting: AI Workflow Check</strong>.
          </p>
        </div>
        <div className="legal-grid">
          <article>
            <h2>The password</h2>
            <p>
              The password is not published. Ask Edmund for the demo password at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
            </p>
          </article>
          <article>
            <h2>In ChatGPT</h2>
            <ol>
              <li>Add a custom MCP connector (or app) with the server URL <code>{mcpUrl}</code>. Sign-in uses OAuth. Do not paste a password into ChatGPT.</li>
              <li>When the Unwhelm sign-in page opens, use the <strong>App reviewer</strong> form. Leave the <strong>Email me a link</strong> form alone.</li>
              <li>Enter the demo email and the password Edmund sent you, then choose <strong>Sign in</strong>.</li>
              <li>On the consent page, choose <strong>Allow</strong>.</li>
            </ol>
            <p>Then try one of these prompts:</p>
            <ul>
              {prompts.map((prompt) => <li key={prompt}>{prompt}</li>)}
            </ul>
            <p>Anyone can browse the public catalog and draft a proposal without an account. Saving a proposal, and submitting it, require you to be signed in.</p>
            <p>No account yet? <a href="/request-access">Request access</a>. Unwhelm is invite-only during preview, and sign-in is a passwordless email link after the request is reviewed.</p>
            <p>Connecting from Claude? Follow the step-by-step guide on the <a href="/claude">Connect Claude</a> page.</p>
            <p>For ChatGPT, Cursor, VS Code, and other clients, start at the <a href="/connect">connect hub</a> or the dedicated <a href="/chatgpt">Connect ChatGPT</a> page.</p>
          </article>
          <article>
            <h2>On the web</h2>
            <ol>
              <li>Open <a href={signInUrl}>{signInUrl}</a>.</li>
              <li>Use the same <strong>App reviewer</strong> form, not <strong>Email me a link</strong>, and sign in with the demo email and password.</li>
              <li>Open the <a href="/portal">client portal</a> to see the Executive Recruiting proposal.</li>
            </ol>
          </article>
          <article>
            <h2>What this account can and cannot do</h2>
            <p>This is a client view of that account’s own proposals, contracts, invoices, and projects. It is not a staff or admin view.</p>
            <p>When hosted e-signature is turned on, signatures go through SignWell or PandaDoc in test mode. A test-mode signature is not legally binding.</p>
            <p>The portal can offer a proposal PDF download. That download may be unavailable.</p>
          </article>
        </div>
      </div>
    </section>
  );
}
