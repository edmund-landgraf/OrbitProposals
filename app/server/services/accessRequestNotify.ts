/**
 * Owner notification for a new access request.
 * Stays off unless UNWH_ACCESS_REQUEST_NOTIFY=1 and UNWH_ACCESS_REQUEST_NOTIFY_TO is set.
 * Missing Graph credentials skip the send. Failures are swallowed so the public response stays generic.
 */
export async function maybeNotifyAccessRequest(input: { email: string; name: string; company: string | null }): Promise<void> {
  if (process.env.UNWH_ACCESS_REQUEST_NOTIFY !== "1") return;
  const to = process.env.UNWH_ACCESS_REQUEST_NOTIFY_TO?.trim();
  const tenantId = process.env.UNWHELM_TENANT_ID;
  const clientId = process.env.UNWHELM_CLIENT_ID;
  const clientSecret = process.env.UNWHELM_CLIENT_SECRET;
  if (!to || !tenantId || !clientId || !clientSecret) return;
  try {
    const { ConfidentialClientApplication } = await import("@azure/msal-node");
    const sender = process.env.UNWHELM_SENDER ?? "no-reply@unwhelm.net";
    const app = new ConfidentialClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret } });
    const auth = await app.acquireTokenByClientCredential({ scopes: ["https://graph.microsoft.com/.default"] });
    if (!auth?.accessToken) return;
    const subject = "Unwhelm access request";
    const text = `${input.name} (${input.email}${input.company ? `, ${input.company}` : ""}) asked for preview access. Review it in Admin. This message does not approve the request and does not send them a sign-in link.`;
    await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "Text", content: text },
          from: { emailAddress: { address: sender } },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: false,
      }),
    });
  } catch (error) {
    console.error("access-request notify failed", error instanceof Error ? error.message : "error");
  }
}
