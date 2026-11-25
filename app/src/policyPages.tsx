import type { MouseEvent, ReactNode } from "react";
import { ArrowRight } from "lucide-react";

type PolicyPage = "contact" | "privacy" | "terms" | "support" | "mcp-connect" | "try-help";

export type PolicyRouteLink = (page: PolicyPage) => {
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
};

const draftDate = "November 5, 2026";
const contactEmail = "contact@unwhelm.com";

function LegalDraftNotice() {
  return (
    <p className="legal-draft-banner" role="note">
      <strong>Draft — not legal advice.</strong> This page is a working draft for Edmund's review. It is not a final policy, it is not legal advice, and it has not been reviewed by counsel.
    </p>
  );
}

function LegalPage({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <section className="section legal-section route-section">
      <div className="container legal-shell">
        <LegalDraftNotice />
        <div className="section-heading">
          <div className="eyebrow eyebrow-dark">{eyebrow}</div>
          <h1>{title}</h1>
          <p>{lede}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

function LegalActions({
  routeLink,
  current,
}: {
  routeLink: PolicyRouteLink;
  current: "privacy" | "terms" | "support";
}) {
  const links: { page: "privacy" | "terms" | "support" | "contact"; label: string; primary?: boolean }[] = [
    { page: "privacy", label: "Privacy" },
    { page: "terms", label: "Terms" },
    { page: "support", label: "Support" },
    { page: "contact", label: "Contact us", primary: true },
  ];
  return (
    <div className="legal-actions">
      {links.filter((link) => link.page !== current).map((link) => (
        <a className={link.primary ? "button button-primary" : "button button-secondary"} key={link.page} {...routeLink(link.page)}>
          {link.label} <ArrowRight size={16} />
        </a>
      ))}
    </div>
  );
}

export function PrivacyPage({ routeLink }: { routeLink: PolicyRouteLink }) {
  return (
    <LegalPage
      eyebrow="PRIVACY"
      title="How we handle your information."
      lede={`Draft updated ${draftDate}. This notice describes information UnwhelmNet handles on the public website, in the client portal, and when you use Unwhelm through an MCP connector such as ChatGPT or Claude.`}
    >
      <div className="legal-grid">
        <article>
          <h2>What this covers</h2>
          <p>UnwhelmNet is the public site at unwhelm.net, the client portal, and Unwhelm's MCP server. You can reach that server from the website, from the portal, or from an MCP client you already use, including ChatGPT and Claude. This draft covers those paths together. It does not change the privacy policy of ChatGPT, Claude, or any other app you connect.</p>
        </article>
        <article>
          <h2>Contact information</h2>
          <p>When you write to us or use the contact form, we may receive your name, email address, phone number, company, title, website, project description, the systems involved, your goals, and scheduling preferences.</p>
          <p>If you save a reminder preference, we also store the channel you choose (email, text, both, or none), the email or mobile number for that channel, quiet hours, timezone, and whether you agreed to reminders.</p>
        </article>
        <article>
          <h2>Account information</h2>
          <p>Signing in uses an email magic link. We store the email address, a display name, and the organization the account belongs to. We do not ask you to paste a password or a model API key into Unwhelm. Magic links and MCP access tokens expire, tokens are stored as hashes, and a token can be revoked.</p>
        </article>
        <article>
          <h2>Proposals, contracts, and invoices</h2>
          <p>When you, or an agent acting through your connector, use Unwhelm, we handle the business records that work creates:</p>
          <ul>
            <li>Proposals: title, scope, timeline, pricing, options, review comments, and status.</li>
            <li>Contracts: terms, billing schedule, and signature or acceptance status.</li>
            <li>Invoices: amounts, currency, due dates, payment status, time entries, and credits tied to a contract.</li>
          </ul>
          <p>Those records are kept with the organization the work belongs to. The public Try me page runs a separate sandbox, not a customer account. Expired Try me sandboxes are deleted.</p>
        </article>
        <article>
          <h2>ChatGPT, Claude, and other MCP connectors</h2>
          <p>ChatGPT, Claude, and similar apps keep the conversation in their own products under their own terms. Unwhelm receives the tool requests the connector sends to our MCP server, and the records those tools create or read. We do not receive the rest of your chat with that provider unless the text is included in a tool request.</p>
          <p>Before you sign in, a connector can read public service and catalog information. A draft proposal built before sign-in is checked and returned to the connector. Unwhelm does not save that draft. Saving a proposal, and anything about contracts, invoices, or contact preferences, requires a signed-in account, and then only what that account is allowed to see.</p>
        </article>
        <article>
          <h2>Why we use it</h2>
          <p>We use this information to answer an inquiry, prepare for a conversation, and run the proposal, contract, and invoice workflow you start. We do not sell contact information, account information, proposals, contracts, or invoices.</p>
        </article>
        <article>
          <h2>Where it goes</h2>
          <p>Account and workflow records are stored in Unwhelm's application database. Contact-form and scheduling messages are also sent to our business mailbox through Microsoft Graph when that mail configuration is turned on. We may use Plausible Analytics to see which public pages help people find a next step. Plausible is set up to run without cookies and without cross-site tracking.</p>
        </article>
        <article>
          <h2>Retention</h2>
          <p>Inquiry and account information is kept while we are responding to you or doing the work, and while an engagement is active. Proposals, contracts, and invoices are kept for that work. Signed contracts and issued invoices may be kept as ordinary business records after the work ends. This draft does not set a fixed number of years. Expired magic links, expired public proposal links, expired MCP tokens, and expired Try me sandboxes are deleted.</p>
        </article>
        <article>
          <h2>How to request deletion</h2>
          <p>Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> from the address on the account or the inquiry. Say whether you want a contact-form message, an account, proposals, contracts, invoices, or all of them removed, and include the organization or proposal name if you have it. We will delete or anonymize personal information we are not keeping as a business record. This draft does not promise a specific response time. You can also start from the <a {...routeLink("support")}>support page</a>.</p>
        </article>
      </div>
      <LegalActions routeLink={routeLink} current="privacy" />
    </LegalPage>
  );
}

export function TermsPage({ routeLink }: { routeLink: PolicyRouteLink }) {
  return (
    <LegalPage
      eyebrow="TERMS"
      title="Terms of service."
      lede={`Draft dated ${draftDate}. These terms describe use of the UnwhelmNet website, the client portal, and Unwhelm's MCP server, including use through ChatGPT, Claude, or another MCP client. They are not a signed statement of work.`}
    >
      <div className="legal-grid">
        <article>
          <h2>Who this draft is for</h2>
          <p>This draft is published by UnwhelmNet for people using unwhelm.net, the client portal, or Unwhelm's MCP server. The legal entity name, governing law, and liability terms are not set here. Do not treat this page as the final contract for paid work.</p>
        </article>
        <article>
          <h2>The service</h2>
          <p>Unwhelm provides tools to draft proposals, review them, form contracts, and track invoices and related project work. Marketing pages describe how an engagement can start. A paid engagement exists only when you accept a proposal or sign a contract that says so. Nothing on this website is legal, tax, or accounting advice.</p>
        </article>
        <article>
          <h2>MCP connectors</h2>
          <p>You may connect an MCP client you already use, including ChatGPT or Claude, to Unwhelm's MCP server. That app sends tool requests to Unwhelm. You are responsible for the account you connect and for reviewing what the agent submits before you accept it. The AI provider's own terms apply to your use of that app. Unwhelm does not operate ChatGPT or Claude.</p>
        </article>
        <article>
          <h2>Your content</h2>
          <p>You keep ownership of the business information you submit, including proposal text, contract terms you provide, and invoice details. You allow Unwhelm to store and process that information to provide the service, as described on the <a {...routeLink("privacy")}>Privacy page</a>. Do not submit information you do not have the right to share.</p>
        </article>
        <article>
          <h2>Acceptable use</h2>
          <p>Use the service for your own organization. Do not try to access another customer's proposals, contracts, invoices, or account. Do not probe, overload, or misuse the website or the MCP server, and do not attempt to bypass sign-in or authorization.</p>
        </article>
        <article>
          <h2>Accounts</h2>
          <p>Sign-in can use a magic link sent to your email. Keep that inbox under your control. You can ask us to close access as described on the Privacy page. Connecting ChatGPT, Claude, or another client does not give that provider ownership of your Unwhelm records.</p>
        </article>
        <article>
          <h2>Fees</h2>
          <p>Prices on the site are starting points. The proposal you accept, or the contract you sign, states the price, the schedule, and what is included. This draft does not by itself create a fee.</p>
        </article>
        <article>
          <h2>Changes</h2>
          <p>This text will change after review. The date above is the draft date. A final version will replace it. Until then, a proposal you accept or a contract you sign controls that work, and this page is only a draft for review.</p>
        </article>
        <article>
          <h2>Contact</h2>
          <p>Questions about these terms: email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> or use the <a {...routeLink("support")}>support page</a>.</p>
        </article>
      </div>
      <LegalActions routeLink={routeLink} current="terms" />
    </LegalPage>
  );
}

export function SupportPage({ routeLink }: { routeLink: PolicyRouteLink }) {
  return (
    <LegalPage
      eyebrow="SUPPORT"
      title="How to get help."
      lede={`Draft dated ${draftDate}. This is the public help page for the UnwhelmNet website, the client portal, and MCP connectors such as ChatGPT and Claude.`}
    >
      <div className="legal-grid">
        <article>
          <h2>Email and phone</h2>
          <p>Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. For voice or fax, call <a href="tel:+18662094787">866-209-4787</a>. We are available Monday through Friday, 8am to 5pm PT.</p>
        </article>
        <article>
          <h2>Project intake</h2>
          <p>For a new workflow or a first conversation, use the <a {...routeLink("contact")}>contact form</a>. Tell us the systems involved and what is stuck. The form is the best path for a new project. Email and phone are the path when you already have an account, a proposal, a contract, or an invoice.</p>
        </article>
        <article>
          <h2>ChatGPT, Claude, and other MCP clients</h2>
          <p>If a connector cannot sign in, cannot see Unwhelm's tools, or submits something you did not expect, include the app you used (ChatGPT, Claude, or another client), the email you signed in with, and what you were trying to do. Setup steps for a connector are on <a {...routeLink("mcp-connect")}>How to connect</a>. The <a {...routeLink("try-help")}>Try me help guide</a> walks through the tools against the sandbox.</p>
        </article>
        <article>
          <h2>What to include</h2>
          <p>The fastest requests name the surface (website, portal, ChatGPT, or Claude), the account email, and the proposal, contract, or invoice you mean. If a page or tool returned an error, quote the message.</p>
        </article>
        <article>
          <h2>Deletion and privacy questions</h2>
          <p>To ask what we hold, or to request deletion, email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> as described on the <a {...routeLink("privacy")}>Privacy page</a>. Use the same address for a question about the draft <a {...routeLink("terms")}>Terms</a>.</p>
        </article>
      </div>
      <LegalActions routeLink={routeLink} current="support" />
    </LegalPage>
  );
}
