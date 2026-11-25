import { createHash } from "node:crypto";
import type { EsignAdapter, EsignCreateRequest, EsignCreateResult, EsignDownloadResult, EsignStatusResult } from "../esignAdapter.js";

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Buffer }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer> }>;

export type SignWellClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
};

const defaultBaseUrl = "https://www.signwell.com";

function safeJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return { raw: text.slice(0, 500) }; }
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class SignWellAdapter implements EsignAdapter {
  readonly provider = "signwell" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: SignWellClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? defaultBaseUrl;
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  }

  private headers(extra: Record<string, string> = {}) {
    return { "x-api-key": this.apiKey, "content-type": "application/json", ...extra };
  }

  async createSigningRequest(input: EsignCreateRequest): Promise<EsignCreateResult> {
    // SignWell has no idempotency key; Unwhelm enforces idempotency via uniqueKey + DB unique constraints.
    // Always set test_mode unless UNWH_ESIGN_LIVE=1, enforced by the caller.
    const url = `${this.baseUrl}/api/v1/documents`;
    const body = {
      test_mode: Boolean(input.testMode),
      name: input.title,
      // SignWell supports file_base64 for uploads. Keep this provider-specific; callers pass Buffer.
      files: [{ name: "contract.pdf", file_base64: input.pdf.toString("base64") }],
      recipients: [{ name: input.signer.name, email: input.signer.email }],
      // Provider-hosted signing. The webhook is the source of truth for completion.
      metadata: { contractId: input.contractId, proposalVersionId: input.proposalVersionId, uniqueKey: input.uniqueKey },
      // Optional: redirect back to Unwhelm. Must never mark signed.
      redirect_url: `${input.baseUrl}/api/v1/esign/signwell/callback`,
      webhook_url: `${input.baseUrl}/api/v1/esign/signwell/webhook`,
    };
    const response = await this.fetchImpl(url, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`SignWell create failed (${response.status}).`);
    const json = safeJson(text) as { id?: unknown; status?: unknown };
    const id = typeof json.id === "string" ? json.id : "";
    if (!id) throw new Error("SignWell create failed (missing document id).");
    return { provider: "signwell", providerDocumentId: id, providerStatus: json };
  }

  async getStatus(providerDocumentId: string): Promise<EsignStatusResult> {
    const url = `${this.baseUrl}/api/v1/documents/${encodeURIComponent(providerDocumentId)}`;
    const response = await this.fetchImpl(url, { method: "GET", headers: this.headers({ "content-type": "application/json" }) });
    const text = await response.text();
    if (!response.ok) throw new Error(`SignWell status failed (${response.status}).`);
    const json = safeJson(text) as { status?: unknown; completed_at?: unknown; cancelled_at?: unknown };
    const raw = typeof json.status === "string" ? json.status.toLowerCase() : "";
    const status: EsignStatusResult["status"] = raw.includes("complete") ? "completed"
      : raw.includes("cancel") ? "cancelled"
      : raw.includes("sent") ? "sent"
      : raw.includes("draft") ? "draft"
      : "unknown";
    const completedAt = typeof json.completed_at === "string" ? new Date(json.completed_at) : null;
    const cancelledAt = typeof json.cancelled_at === "string" ? new Date(json.cancelled_at) : null;
    return { provider: "signwell", providerDocumentId, status, providerStatus: json, completedAt, cancelledAt };
  }

  async downloadCompleted(providerDocumentId: string): Promise<EsignDownloadResult> {
    const signedUrl = `${this.baseUrl}/api/v1/documents/${encodeURIComponent(providerDocumentId)}/completed_pdf`;
    const signed = await this.fetchImpl(signedUrl, { method: "GET", headers: { "x-api-key": this.apiKey } });
    if (!signed.ok || !signed.arrayBuffer) throw new Error(`SignWell download failed (${signed.status}).`);
    const signedPdf = Buffer.from(await signed.arrayBuffer());

    // Optional audit/certificate. If absent, we still persist the signed PDF.
    const auditUrl = `${this.baseUrl}/api/v1/documents/${encodeURIComponent(providerDocumentId)}/certificate`;
    const audit = await this.fetchImpl(auditUrl, { method: "GET", headers: { "x-api-key": this.apiKey } });
    const auditPdf = audit.ok && audit.arrayBuffer ? Buffer.from(await audit.arrayBuffer()) : null;
    return { signedPdf, auditPdf };
  }

  async cancel(providerDocumentId: string): Promise<{ ok: true; providerStatus?: unknown }> {
    const url = `${this.baseUrl}/api/v1/documents/${encodeURIComponent(providerDocumentId)}/cancel`;
    const response = await this.fetchImpl(url, { method: "POST", headers: this.headers(), body: "{}" });
    const text = await response.text();
    if (!response.ok) throw new Error(`SignWell cancel failed (${response.status}).`);
    return { ok: true, providerStatus: safeJson(text) };
  }
}

export const signwellArtifactsSha256 = (result: EsignDownloadResult) => ({
  signedPdfSha256: sha256Hex(result.signedPdf),
  auditPdfSha256: result.auditPdf ? sha256Hex(result.auditPdf) : null,
});

