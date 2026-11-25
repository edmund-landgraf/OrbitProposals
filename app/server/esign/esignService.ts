import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { signContract } from "../contracts/signContract.js";
import type { EsignAdapter, EsignProvider } from "./esignAdapter.js";
import { redactProviderStatus } from "./redact.js";

export type EsignServiceDeps = {
  prisma: PrismaClient;
  adapter: EsignAdapter;
  provider: EsignProvider;
  testMode: boolean;
  baseUrl: string;
  signContract?: (prisma: PrismaClient, contractId: string) => Promise<unknown>;
};

export function esignUniqueKey(input: { provider: EsignProvider; contractId: string; proposalVersionId: string }): string {
  return createHash("sha256").update(`${input.provider}:${input.contractId}:${input.proposalVersionId}`).digest("hex");
}

export async function sendContractForEsign(deps: EsignServiceDeps, input: {
  contractId: string;
  proposalVersionId: string;
  contractTitle: string;
  pdf: Buffer;
  signer: { name: string; email: string };
}): Promise<{ idempotent: boolean; requestId: string; providerDocumentId: string; status: string }> {
  const uniqueKey = esignUniqueKey({ provider: deps.provider, contractId: input.contractId, proposalVersionId: input.proposalVersionId });

  // Create a local request first so we never send twice for the same contract+version.
  let created = false;
  let request = await deps.prisma.contractEsignRequest.findUnique({ where: { uniqueKey } }).catch(() => null);
  if (!request) {
    try {
      request = await deps.prisma.contractEsignRequest.create({
        data: {
          contractId: input.contractId,
          proposalVersionId: input.proposalVersionId,
          provider: deps.provider,
          providerDocumentId: "creating",
          uniqueKey,
          status: "creating",
          providerStatus: {},
          testMode: deps.testMode,
        },
      });
      created = true;
    } catch {
      request = await deps.prisma.contractEsignRequest.findUnique({ where: { uniqueKey } });
    }
  }

  if (!request) throw new Error("Could not create or load e-sign request.");
  if (request.status !== "creating" && request.providerDocumentId !== "creating") {
    return { idempotent: true, requestId: request.id, providerDocumentId: request.providerDocumentId, status: request.status };
  }

  // Best-effort crash recovery: allow retrying a stuck "creating" after 2 minutes.
  const stuck = request.updatedAt.getTime() < Date.now() - 2 * 60_000;
  if (!created && !stuck) {
    return { idempotent: true, requestId: request.id, providerDocumentId: request.providerDocumentId, status: request.status };
  }

  const result = await deps.adapter.createSigningRequest({
    contractId: input.contractId,
    proposalVersionId: input.proposalVersionId,
    uniqueKey,
    title: input.contractTitle,
    pdf: input.pdf,
    signer: input.signer,
    testMode: deps.testMode,
    baseUrl: deps.baseUrl,
  });

  const updated = await deps.prisma.contractEsignRequest.update({
    where: { id: request.id },
    data: {
      providerDocumentId: result.providerDocumentId,
      status: "sent",
      providerStatus: redactProviderStatus(result.providerStatus) as never,
      testMode: deps.testMode,
    },
  });

  return { idempotent: !created, requestId: updated.id, providerDocumentId: updated.providerDocumentId, status: updated.status };
}

export async function reconcileEsignWebhook(deps: EsignServiceDeps, input: { providerDocumentId: string }): Promise<{ changed: boolean; status: string }> {
  const request = await deps.prisma.contractEsignRequest.findFirst({
    where: { provider: deps.provider, providerDocumentId: input.providerDocumentId },
  });
  if (!request) return { changed: false, status: "unknown" };

  const status = await deps.adapter.getStatus(input.providerDocumentId);
  const updates: Record<string, unknown> = {
    providerStatus: redactProviderStatus(status.providerStatus) as never,
    status: status.status,
    completedAt: status.completedAt ?? null,
    cancelledAt: status.cancelledAt ?? null,
  };

  let changed = false;
  const next = await deps.prisma.contractEsignRequest.update({ where: { id: request.id }, data: updates as never });
  changed = next.status !== request.status;

  if (status.status === "completed") {
    const existing = await deps.prisma.contractEsignArtifact.findMany({ where: { requestId: request.id } });
    const kinds = new Set(existing.map((row) => row.kind));
    if (!kinds.has("signed_pdf")) {
      const downloaded = await deps.adapter.downloadCompleted(input.providerDocumentId);
      const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
      await deps.prisma.contractEsignArtifact.createMany({
        data: [
          { requestId: request.id, kind: "signed_pdf", sha256: sha(downloaded.signedPdf), bytes: Uint8Array.from(downloaded.signedPdf) },
          ...(downloaded.auditPdf ? [{ requestId: request.id, kind: "audit_pdf", sha256: sha(downloaded.auditPdf), bytes: Uint8Array.from(downloaded.auditPdf) }] : []),
        ],
        skipDuplicates: true,
      });
    }

    // Only the webhook reconciliation can mark the contract signed / trigger billing.
    const markSigned = deps.signContract ?? signContract;
    await markSigned(deps.prisma, request.contractId);
  }

  return { changed: true, status: next.status };
}

