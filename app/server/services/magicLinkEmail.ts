import { ConfidentialClientApplication } from "@azure/msal-node";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Magic-link email is not configured: ${name} is missing`);
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}

export async function sendMagicLinkEmail(input: { email: string; token: string; expiresAt: Date }): Promise<void> {
  const tenantId = required("UNWHELM_TENANT_ID");
  const clientId = required("UNWHELM_CLIENT_ID");
  const clientSecret = required("UNWHELM_CLIENT_SECRET");
  const sender = process.env.UNWHELM_SENDER ?? "no-reply@unwhelm.net";
  const baseUrl = process.env.UNWH_MAGIC_LINK_URL_BASE ?? `${process.env.UNWH_API_PUBLIC_URL ?? process.env.UNWH_WEB_PUBLIC_URL ?? "https://unwhelm.net"}/api/v1/auth/magic-link`;
  const link = new URL(baseUrl);
  link.searchParams.set("token", input.token);
  const app = new ConfidentialClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret } });
  const auth = await app.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
  if (!auth?.accessToken) throw new Error("Unable to acquire Microsoft Graph access token.");
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: "Your secure Unwhelm sign-in link",
        body: { contentType: "HTML", content: `<div style="font-family:Arial,sans-serif"><h2>Sign in to Unwhelm</h2><p>This one-time link expires at ${escapeHtml(input.expiresAt.toISOString())}.</p><p><a href="${escapeHtml(link.toString())}">Continue to Unwhelm</a></p><p>If you did not request this, you can ignore this email.</p></div>` },
        from: { emailAddress: { address: sender } },
        toRecipients: [{ emailAddress: { address: input.email } }],
        internetMessageHeaders: [{ name: "X-Unwhelm-Tag", value: "magic-link" }],
      },
      saveToSentItems: true,
    }),
  });
  if (!response.ok) throw new Error(`Graph sendMail failed (${response.status}): ${await response.text()}`);
}
