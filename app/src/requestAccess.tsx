import { useState, type FormEvent } from "react";

const signInUrl = "/api/v1/auth/signin";

/** /request-access: ask for a preview account. The response never says whether the email already exists. */
export function RequestAccessPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/v1/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          name: data.get("name"),
          company: data.get("company") || undefined,
          role: data.get("role") || undefined,
          reason: data.get("reason"),
          referral: data.get("referral") || undefined,
          consent: data.get("consent") === "yes",
          website: data.get("website") || undefined,
        }),
      });
      const body = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !body.ok) {
        setError(body.message || "The request could not be sent. Check the form and try again.");
        return;
      }
      setDone(true);
    } catch {
      setError("The request could not be sent. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="section legal-section route-section">
      <div className="container legal-shell">
        <div className="section-heading">
          <div className="eyebrow eyebrow-dark">PREVIEW</div>
          <h1>Request access.</h1>
          <p>
            Unwhelm is invite-only during this preview. Sign-in is passwordless: after a request is approved, you ask for a one-time link at the <a href={signInUrl}>sign-in page</a> and it arrives by email.
            Requests are reviewed by hand. Submitting this form does not create an account and does not send a sign-in link.
          </p>
        </div>
        {done ? (
          <article>
            <h2>Request received.</h2>
            <p>Thanks. If a preview seat is available, you will hear back by email. When the request is approved, go to the <a href={signInUrl}>sign-in page</a> and choose <strong>Email me a link</strong>. No password is involved.</p>
          </article>
        ) : (
          <form className="admin-form" onSubmit={submit}>
            <label>Email <input name="email" type="email" required autoComplete="email" /></label>
            <label>Name <input name="name" required autoComplete="name" /></label>
            <label>Company or organization <input name="company" autoComplete="organization" /></label>
            <label>Role or title <input name="role" autoComplete="organization-title" /></label>
            <label>What do you want to try, or why are you interested? <textarea name="reason" required rows={5} /></label>
            <label>How did you hear about Unwhelm? <input name="referral" /></label>
            <label><input name="consent" type="checkbox" value="yes" required /> You may contact me about this request.</label>
            <label className="hp-field" aria-hidden="true">Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
            {error && <p className="admin-error" role="alert">{error}</p>}
            <button className="button button-primary" type="submit" disabled={pending}>{pending ? "Sending" : "Submit request"}</button>
          </form>
        )}
      </div>
    </section>
  );
}
