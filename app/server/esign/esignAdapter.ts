import type { PrismaClient } from "@prisma/client";

export type EsignProvider = "signwell" | "pandadoc";

export type EsignCreateRequest = {
  contractId: string;
  proposalVersionId: string;
  uniqueKey: string;
  title: string;
  pdf: Buffer;
  signer: { name: string; email: string };
  testMode: boolean;
  baseUrl: string;
};

export type EsignCreateResult = {
  provider: EsignProvider;
  providerDocumentId: string;
  providerStatus: unknown;
};

export type EsignStatusResult = {
  provider: EsignProvider;
  providerDocumentId: string;
  status: "draft" | "sent" | "completed" | "cancelled" | "unknown";
  providerStatus: unknown;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
};

export type EsignDownloadResult = {
  signedPdf: Buffer;
  auditPdf?: Buffer | null;
};

export type EsignAdapter = {
  provider: EsignProvider;
  createSigningRequest(input: EsignCreateRequest): Promise<EsignCreateResult>;
  getStatus(providerDocumentId: string): Promise<EsignStatusResult>;
  downloadCompleted(providerDocumentId: string): Promise<EsignDownloadResult>;
  cancel(providerDocumentId: string): Promise<{ ok: true; providerStatus?: unknown }>;
};

export type EsignDependencies = {
  prisma: PrismaClient;
  adapter: EsignAdapter;
};

