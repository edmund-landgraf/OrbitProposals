export type ChargeRequest = { invoiceId: string; amountMinor: number; currency: string; paymentMethodId: string };
export type ChargeResult = { processor: string; processorId: string };
export type Charger = (request: ChargeRequest) => Promise<ChargeResult>;

export class ChargeError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Charges a sent invoice through the configured processor. Card numbers are refused; pass a processor payment method id. */
export async function chargeInvoice(input: ChargeRequest & { status: string }, charger: Charger | null): Promise<ChargeResult> {
  if (!/^pm_/.test(input.paymentMethodId)) throw new ChargeError(422, "VALIDATION_ERROR", "Pass a payment method id from the processor. Card numbers are not accepted.");
  if (input.status !== "sent" && input.status !== "overdue") throw new ChargeError(409, "CONFLICT", `A ${input.status} invoice cannot be charged.`);
  if (!charger) throw new ChargeError(422, "VALIDATION_ERROR", "No payment processor is configured.");
  if (input.amountMinor < 0) throw new ChargeError(422, "VALIDATION_ERROR", "The invoice amount cannot be charged.");
  return charger(input);
}

/** Stripe PaymentIntent confirmed off-session. STRIPE_SECRET_KEY selects this charger. */
export function stripeCharger(secret: string, fetchImpl: typeof fetch = fetch): Charger {
  return async (request) => {
    const body = new URLSearchParams({
      amount: String(request.amountMinor),
      currency: request.currency.toLowerCase(),
      payment_method: request.paymentMethodId,
      confirm: "true",
      off_session: "true",
    });
    body.set("metadata[invoiceId]", request.invoiceId);
    const response = await fetchImpl("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await response.json() as { id?: string; error?: { message?: string } };
    if (!response.ok || !payload.id) throw new ChargeError(402, "PAYMENT_FAILED", payload.error?.message || "The processor declined the charge.");
    return { processor: "stripe", processorId: payload.id };
  };
}
