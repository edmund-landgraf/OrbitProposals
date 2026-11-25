import type { EsignAdapter, EsignCreateRequest, EsignCreateResult, EsignDownloadResult, EsignStatusResult } from "../esignAdapter.js";

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Buffer }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer> }>;

export type PandaDocClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  pollAttempts?: number;
};

const defaultBaseUrl = "https://api.pandadoc.com";

function safeJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return { raw: text.slice(0, 500) }; }
}

export function mapPandaDocStatus(raw: string): EsignStatusResult["status"] {
  const status = raw.trim().toLowerCase();
  if (status === "document.draft" || status === "document.uploaded") return "draft";
  if (status === "document.sent" || status === "document.viewed" || status === "document.waiting_approval" || status === "document.approved") return "sent";
  if (status === "document.completed") return "completed";
  if (status === "document.voided" || status === "document.declined" || status === "document.rejected") return "cancelled";
  return "unknown";
}

function signerParts(name: string): { first_name: string; last_name: string } {
  const trimmed = name.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0) return { first_name: trimmed || "Signer", last_name: "" };
  return { first_name: trimmed.slice(0, space), last_name: trimmed.slice(space + 1) };
}

/** JSON `data` part plus PDF `file` part, same shape PandaDoc's create-from-upload expects. */
export function pandaDocCreateMultipart(pdf: Buffer, data: unknown): { body: Buffer; contentType: string } {
  const boundary = "----UnwhelmPandaDocBoundary";
  const json = JSON.stringify(data);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="data"\r\nContent-Type: application/json\r\n\r\n${json}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="contract.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return { body: Buffer.concat([head, pdf, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

export class PandaDocAdapter implements EsignAdapter {
  readonly provider = "pandadoc" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollAttempts: number;

  constructor(options: PandaDocClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? defaultBaseUrl;
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.pollAttempts = options.pollAttempts ?? 20;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `API-Key ${this.apiKey}`, ...extra };
  }

  async createSigningRequest(input: EsignCreateRequest): Promise<EsignCreateResult> {
    const names = signerParts(input.signer.name);
    const payload = {
      name: input.title,
      recipients: [{ email: input.signer.email, first_name: names.first_name, last_name: names.last_name, role: "Client" }],
      metadata: { contractId: input.contractId, proposalVersionId: input.proposalVersionId, uniqueKey: input.uniqueKey, testMode: String(input.testMode) },
      parse_form_fields: false,
    };
    const { body, contentType } = pandaDocCreateMultipart(input.pdf, payload);
    const created = await this.fetchImpl(`${this.baseUrl}/public/v1/documents`, {
      method: "POST",
      headers: this.headers({ "content-type": contentType }),
      body,
    });
    const createdText = await created.text();
    if (!created.ok) throw new Error(`PandaDoc create failed (${created.status}).`);
    const json = safeJson(createdText) as { id?: unknown; status?: unknown };
    const id = typeof json.id === "string" ? json.id : "";
    if (!id) throw new Error("PandaDoc create failed (missing document id).");

    let lastStatus = typeof json.status === "string" ? json.status : "document.uploaded";
    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      if (mapPandaDocStatus(lastStatus) === "draft" && lastStatus !== "document.uploaded") break;
      const polled = await this.getStatus(id);
      lastStatus = typeof (polled.providerStatus as { status?: unknown })?.status === "string"
        ? String((polled.providerStatus as { status: string }).status)
        : lastStatus;
      if (mapPandaDocStatus(lastStatus) === "draft" && lastStatus !== "document.uploaded") break;
      await this.sleep(250);
    }

    const sent = await this.fetchImpl(`${this.baseUrl}/public/v1/documents/${encodeURIComponent(id)}/send`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        subject: input.title,
        message: "Please review and sign this contract.",
        silent: false,
      }),
    });
    if (!sent.ok && sent.status !== 204) throw new Error(`PandaDoc send failed (${sent.status}).`);
    const sentText = await sent.text().catch(() => "");
    const sentJson = sentText ? safeJson(sentText) : { status: "document.sent" };
    return { provider: "pandadoc", providerDocumentId: id, providerStatus: sentJson };
  }

  async getStatus(providerDocumentId: string): Promise<EsignStatusResult> {
    const url = `${this.baseUrl}/public/v1/documents/${encodeURIComponent(providerDocumentId)}`;
    const response = await this.fetchImpl(url, { method: "GET", headers: this.headers({ "content-type": "application/json" }) });
    const text = await response.text();
    if (!response.ok) throw new Error(`PandaDoc status failed (${response.status}).`);
    const json = safeJson(text) as { status?: unknown; date_completed?: unknown; date_declined?: unknown };
    const raw = typeof json.status === "string" ? json.status : "";
    const status = mapPandaDocStatus(raw);
    const completedAt = typeof json.date_completed === "string" ? new Date(json.date_completed) : null;
    const cancelledAt = typeof json.date_declined === "string" ? new Date(json.date_declined) : null;
    return { provider: "pandadoc", providerDocumentId, status, providerStatus: json, completedAt, cancelledAt };
  }

  async downloadCompleted(providerDocumentId: string): Promise<EsignDownloadResult> {
    const signedUrl = `${this.baseUrl}/public/v1/documents/${encodeURIComponent(providerDocumentId)}/download-protected`;
    let signed = await this.fetchImpl(signedUrl, { method: "GET", headers: this.headers({ accept: "application/pdf" }) });
    if (!signed.ok || !signed.arrayBuffer) {
      signed = await this.fetchImpl(`${this.baseUrl}/public/v1/documents/${encodeURIComponent(providerDocumentId)}/download`, {
        method: "GET",
        headers: this.headers({ accept: "application/pdf" }),
      });
    }
    if (!signed.ok || !signed.arrayBuffer) throw new Error(`PandaDoc download failed (${signed.status}).`);
    const signedPdf = Buffer.from(await signed.arrayBuffer());
    return { signedPdf, auditPdf: null };
  }

  async cancel(providerDocumentId: string): Promise<{ ok: true; providerStatus?: unknown }> {
    const url = `${this.baseUrl}/public/v1/documents/${encodeURIComponent(providerDocumentId)}/status`;
    const response = await this.fetchImpl(url, {
      method: "PATCH",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ status: "document.voided" }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`PandaDoc cancel failed (${response.status}).`);
    return { ok: true, providerStatus: safeJson(text) };
  }
}
