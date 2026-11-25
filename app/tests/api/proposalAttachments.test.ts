import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import test from "node:test";
import express from "express";
import { ATTACHMENT_MAX_BYTES, parseAttachmentPayload } from "../../server/proposalAttachments.js";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";
import { createServer } from "../../unwh-mcp/src/createServer.js";
import { TOOL_SCOPES } from "../../unwh-mcp/src/toolAccess.js";
import { toolAnnotations } from "../../unwh-mcp/src/toolAnnotations.js";

const proposalId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const tinyMd = Buffer.from("# Notes\n");

type Row = {
  id: string;
  proposalId: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  bytes: Buffer;
  uploadedById: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

function fakePrisma(rows: Row[]) {
  const proposal = { id: proposalId, organizationId: "55555555-5555-4555-8555-555555555555", ownerId: userId };
  const meta = (row: Row) => {
    const { bytes: _bytes, ...rest } = row;
    return rest;
  };
  const prisma = {
    proposal: {
      findFirstOrThrow: async ({ where }: { where: { id: string } }) => {
        if (where.id !== proposalId) {
          const error = Object.assign(new Error("not found"), { code: "P2025" });
          throw error;
        }
        return proposal;
      },
    },
    proposalAttachment: {
      findMany: async ({ where, select, orderBy }: { where: { proposalId: string }; select?: object; orderBy?: unknown }) => {
        const found = rows.filter((row) => row.proposalId === where.proposalId).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
        void orderBy;
        return select ? found.map(meta) : found;
      },
      findFirst: async ({ where }: { where: { id?: string; proposalId: string; filename?: string } }) => {
        return rows.find((row) =>
          row.proposalId === where.proposalId
          && (where.id ? row.id === where.id : true)
          && (where.filename ? row.filename === where.filename : true),
        ) ?? null;
      },
      aggregate: async ({ where }: { where: { proposalId: string } }) => {
        const max = rows.filter((row) => row.proposalId === where.proposalId).reduce((high, row) => Math.max(high, row.sortOrder), -1);
        return { _max: { sortOrder: max < 0 ? null : max } };
      },
      create: async ({ data, select }: { data: Omit<Row, "id" | "createdAt" | "updatedAt"> & { bytes: Buffer }; select?: object }) => {
        const now = new Date();
        const row: Row = { ...data, id: randomUUID(), createdAt: now, updatedAt: now, bytes: Buffer.from(data.bytes) };
        rows.push(row);
        return select ? meta(row) : row;
      },
      update: async ({ where, data, select }: { where: { id: string }; data: Partial<Row>; select?: object }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
        Object.assign(row, data, { updatedAt: new Date() });
        return select ? meta(row) : row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = rows.findIndex((item) => item.id === where.id);
        if (index < 0) throw Object.assign(new Error("not found"), { code: "P2025" });
        rows.splice(index, 1);
      },
    },
    $transaction: async (ops: Array<Promise<unknown>> | ((tx: unknown) => Promise<unknown>)) => {
      if (typeof ops === "function") return ops(prisma);
      return Promise.all(ops);
    },
  };
  return prisma;
}

async function listen(prisma: ReturnType<typeof fakePrisma>): Promise<{ base: string; server: Server; scopes: string[] }> {
  const scopes: string[] = [];
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  app.use("/api/v1", createProposalContractRouter({
    prisma: prisma as never,
    authorize: async (_request, requirement) => {
      scopes.push(requirement.scope);
      return { userId, organizationId: "55555555-5555-4555-8555-555555555555", role: "staff" };
    },
  }));
  const server = await new Promise<Server>((resolve) => {
    const created = app.listen(0, "127.0.0.1", () => resolve(created));
  });
  const address = server.address() as { port: number };
  return { base: `http://127.0.0.1:${address.port}`, server, scopes };
}

function json(response: Response) {
  return response.json() as Promise<{ ok: boolean; code?: string; entity?: { id?: string; filename?: string; items?: Array<{ id: string; filename: string; sortOrder: number; sha256: string }>; deleted?: boolean } }>;
}

test("parseAttachmentPayload accepts PDF and Markdown and rejects other types", () => {
  const pdf = parseAttachmentPayload("scope.pdf", tinyPdf.toString("base64"));
  assert.equal(pdf.contentType, "application/pdf");
  const md = parseAttachmentPayload("notes.md", tinyMd.toString("base64"));
  assert.equal(md.contentType, "text/markdown");
  assert.throws(() => parseAttachmentPayload("notes.txt", tinyMd.toString("base64")), /pdf or .md/i);
  assert.throws(() => parseAttachmentPayload("notes.pdf", Buffer.from("not-a-pdf").toString("base64")), /%PDF-/);
  assert.throws(() => parseAttachmentPayload("notes.md", Buffer.from([0xff, 0xfe, 0x00]).toString("base64")));
  const oversize = Buffer.alloc(ATTACHMENT_MAX_BYTES + 1, 65);
  oversize.set(Buffer.from("%PDF-"), 0);
  assert.throws(() => parseAttachmentPayload("big.pdf", oversize.toString("base64")), /10/);
});

test("attachment routes create, list, upsert, reorder, download, replace, and delete", async () => {
  const rows: Row[] = [];
  const { base, server, scopes } = await listen(fakePrisma(rows));
  try {
    const created = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "scope.pdf", contentBase64: tinyPdf.toString("base64") }),
    });
    assert.equal(created.status, 201);
    const first = await json(created);
    assert.equal(first.entity?.filename, "scope.pdf");
    const conflict = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "scope.pdf", contentBase64: tinyPdf.toString("base64") }),
    });
    assert.equal(conflict.status, 409);

    const md = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "notes.md", contentBase64: tinyMd.toString("base64") }),
    });
    assert.equal(md.status, 201);
    const second = await json(md);

    const replacedPdf = Buffer.from("%PDF-1.4\nreplaced\n%%EOF\n");
    const upsert = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "scope.pdf", contentBase64: replacedPdf.toString("base64") }),
    });
    assert.equal(upsert.status, 200);
    const upserted = await json(upsert);
    assert.equal(upserted.entity?.id, first.entity?.id);
    assert.notEqual(upserted.entity?.sha256, first.entity?.sha256);

    const listed = await json(await fetch(`${base}/api/v1/proposals/${proposalId}/attachments`));
    assert.deepEqual(listed.entity?.items?.map((item) => item.filename), ["scope.pdf", "notes.md"]);
    assert.equal("bytes" in (listed.entity?.items?.[0] ?? {}), false);

    const reordered = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments/order`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [second.entity?.id, first.entity?.id] }),
    });
    assert.equal(reordered.status, 200);
    const afterOrder = await json(reordered);
    assert.deepEqual(afterOrder.entity?.items?.map((item) => item.filename), ["notes.md", "scope.pdf"]);

    const partial = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments/order`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [first.entity?.id] }),
    });
    assert.equal(partial.status, 400);

    const download = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments/${first.entity?.id}`);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.equal(Buffer.compare(Buffer.from(await download.arrayBuffer()), replacedPdf), 0);

    const renamed = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments/${second.entity?.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "brief.md", contentBase64: Buffer.from("# Brief\n").toString("base64") }),
    });
    assert.equal(renamed.status, 200);
    assert.equal((await json(renamed)).entity?.filename, "brief.md");

    const removed = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments/${second.entity?.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.equal((await json(removed)).entity?.deleted, true);
    const missing = await fetch(`${base}/api/v1/proposals/${proposalId}/attachments/${second.entity?.id}`, { method: "DELETE" });
    assert.equal(missing.status, 404);

    assert.ok(scopes.includes("proposals:write"));
    assert.ok(scopes.includes("proposals:read"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("attachment MCP tools are registered with proposal scopes", () => {
  const names = [
    "unw_list_proposal_attachments",
    "unw_get_proposal_attachment",
    "unw_attach_proposal_document",
    "unw_upsert_proposal_document",
    "unw_replace_proposal_attachment",
    "unw_delete_proposal_attachment",
    "unw_reorder_proposal_attachments",
  ];
  const tools = (createServer({ apiOrigin: "http://127.0.0.1:9", traceSink: null }) as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
  for (const name of names) {
    assert.ok(tools[name], name);
  }
  assert.equal(TOOL_SCOPES.unw_list_proposal_attachments, "proposals:read");
  assert.equal(TOOL_SCOPES.unw_get_proposal_attachment, "proposals:read");
  assert.equal(TOOL_SCOPES.unw_attach_proposal_document, "proposals:write");
  assert.equal(TOOL_SCOPES.unw_upsert_proposal_document, "proposals:write");
  assert.equal(TOOL_SCOPES.unw_replace_proposal_attachment, "proposals:write");
  assert.equal(TOOL_SCOPES.unw_delete_proposal_attachment, "proposals:write");
  assert.equal(TOOL_SCOPES.unw_reorder_proposal_attachments, "proposals:write");
  assert.equal(toolAnnotations("unw_list_proposal_attachments")?.readOnlyHint, true);
  assert.equal(toolAnnotations("unw_delete_proposal_attachment")?.destructiveHint, true);
  assert.equal(toolAnnotations("unw_reorder_proposal_attachments")?.idempotentHint, true);
});
