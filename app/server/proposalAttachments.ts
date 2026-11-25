import { createHash } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
import { assertPublicHttps } from "./publicUrl.js";

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Small enough that one part fits in a tool call that cuts off around 17 KB. */
export const UPLOAD_PART_MAX_CHARS = 12_000;

export const ATTACHMENT_TYPES = {
  pdf: { contentType: "application/pdf", extension: ".pdf" },
  md: { contentType: "text/markdown", extension: ".md" },
} as const;

export class AttachmentError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown[]) {
    super(message);
  }
}

export const AttachmentWriteSchema = z.object({
  filename: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
}).strict();

export const AttachmentReplaceSchema = z.object({
  filename: z.string().min(1).max(200).optional(),
  contentBase64: z.string().min(1),
}).strict();

export const AttachmentOrderSchema = z.object({
  ids: z.array(z.string().uuid()).min(0),
}).strict();

const metadataSelect = {
  id: true,
  filename: true,
  contentType: true,
  byteSize: true,
  sha256: true,
  sourceUrl: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const attachmentMetadataSelect = metadataSelect;

export type AttachmentRecord = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  sourceUrl?: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export function attachmentView(row: AttachmentRecord) {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    sourceUrl: row.sourceUrl ?? null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function parseAttachmentPayload(filename: string, contentBase64: string): {
  filename: string;
  contentType: string;
  bytes: Buffer;
  byteSize: number;
  sha256: string;
} {
  return validateAttachmentBytes(sanitizeFilename(filename), decodeBase64(contentBase64));
}

export function parseUploadPart(filename: string, contentBase64: string): { filename: string; bytes: Buffer } {
  if (contentBase64.length > UPLOAD_PART_MAX_CHARS) {
    throw new AttachmentError(400, "VALIDATION_FAILED", `Each upload part must be ${UPLOAD_PART_MAX_CHARS} base64 characters or smaller.`);
  }
  const safeName = sanitizeFilename(filename);
  attachmentKind(safeName);
  const bytes = decodeBase64(contentBase64);
  if (bytes.length === 0) throw new AttachmentError(400, "VALIDATION_FAILED", "The upload part is empty.");
  return { filename: safeName, bytes };
}

export function validateAttachmentBytes(filename: string, bytes: Buffer): {
  filename: string;
  contentType: string;
  bytes: Buffer;
  byteSize: number;
  sha256: string;
} {
  const safeName = sanitizeFilename(filename);
  const kind = attachmentKind(safeName);
  if (bytes.length > ATTACHMENT_MAX_BYTES) {
    throw new AttachmentError(400, "VALIDATION_FAILED", `The file must be ${ATTACHMENT_MAX_BYTES} bytes or smaller.`);
  }
  if (bytes.length === 0) throw new AttachmentError(400, "VALIDATION_FAILED", "The file is empty.");
  if (kind === "pdf") {
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new AttachmentError(400, "VALIDATION_FAILED", "A PDF upload must start with %PDF-.");
    }
  } else {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AttachmentError(400, "VALIDATION_FAILED", "A Markdown upload must be valid UTF-8 text.");
    }
    if (bytes.includes(0)) throw new AttachmentError(400, "VALIDATION_FAILED", "A Markdown upload cannot contain binary data.");
  }
  return {
    filename: safeName,
    contentType: ATTACHMENT_TYPES[kind].contentType,
    bytes,
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function sanitizeFilename(filename: string): string {
  const name = basename(filename.replaceAll("\\", "/")).trim();
  if (!name || name === "." || name === "..") throw new AttachmentError(400, "VALIDATION_FAILED", "A filename is required.");
  if (!/^[\w .()[\]-]+\.(pdf|md)$/i.test(name)) {
    throw new AttachmentError(400, "VALIDATION_FAILED", "Use a .pdf or .md filename with letters, numbers, spaces, and simple punctuation.");
  }
  return name;
}

function attachmentKind(filename: string): "pdf" | "md" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".md")) return "md";
  throw new AttachmentError(400, "VALIDATION_FAILED", "Only .pdf and .md files are accepted.");
}

export function parseLinkedDocument(filename: string, sourceUrl: string): {
  filename: string;
  contentType: string;
  sourceUrl: string;
  sha256: string;
} {
  const safeName = sanitizeFilename(filename);
  const kind = attachmentKind(safeName);
  let url: URL;
  try { url = assertPublicHttps(sourceUrl); }
  catch (error) { throw new AttachmentError(400, "VALIDATION_FAILED", error instanceof Error ? error.message : "The document link must be an https URL."); }
  return {
    filename: safeName,
    contentType: ATTACHMENT_TYPES[kind].contentType,
    sourceUrl: url.toString(),
    sha256: createHash("sha256").update(url.toString()).digest("hex"),
  };
}

function decodeBase64(value: string): Buffer {
  const compact = value.replace(/\s+/g, "");
  if (!compact || /[^A-Za-z0-9+/=]/.test(compact) || compact.length % 4 !== 0) {
    throw new AttachmentError(400, "VALIDATION_FAILED", "contentBase64 must be valid base64.");
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0 && compact.replace(/=+$/, "").length > 0) {
    throw new AttachmentError(400, "VALIDATION_FAILED", "contentBase64 must be valid base64.");
  }
  return bytes;
}

export function sameIdSet(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) return false;
  if (new Set(expected).size !== expected.length) return false;
  const wanted = new Set(expected);
  return actual.every((id) => wanted.has(id));
}
