import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiEnvelope } from "./apiClient.js";

// `search` and `fetch` follow the shape ChatGPT and Claude connectors expect:
// search returns { results: [{ id, title, url }] } and fetch returns { id, title, text, url, metadata }.
// Every read goes through the Unwhelm API with the caller's bearer, so the API still enforces scopes and ownership.

type Call = (path: string) => Promise<ApiEnvelope>;
type Doc = { id: string; title: string; url: string; text: string; metadata?: Record<string, unknown> };

const PROPOSAL = "proposal:";
const CATALOG_ID = "catalog:active";
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

function items(entity: unknown): Record<string, unknown>[] {
  if (Array.isArray(entity)) return entity as Record<string, unknown>[];
  const list = (entity as { items?: unknown } | null)?.items;
  return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
}

function proposalTitle(p: Record<string, unknown>): string {
  return typeof p.title === "string" && p.title.trim() ? p.title : `Proposal ${String(p.id)}`;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}

export function registerSearchFetch(server: McpServer, options: { apiOrigin: string; publicBaseUrl?: string; scopes?: readonly string[]; call: Call; authChallenge?: (scope: string, action: string) => { isError: true; content: Array<{ type: "text"; text: string }>; _meta: Record<string, unknown> } }) {
  // Connector urls are for humans (and ChatGPT open-link UI), not the private API origin the MCP process calls.
  const publicBase = (options.publicBaseUrl ?? "https://unwhelm.net").replace(/\/$/, "");
  const proposalUrl = (id: string) => `${publicBase}/portal?proposal=${encodeURIComponent(id)}`;
  const catalogUrl = `${publicBase}/pricing`;
  // When the token's scopes are known, skip proposal reads it cannot make. The API checks again either way.
  const canReadProposals = () => !options.scopes || options.scopes.includes("proposals:read");

  server.registerTool("search", {
    description: "Searches the proposals this token can see (needs proposals:read) and the published pricing catalog. Returns ids, titles, and urls; pass an id to fetch for the full document.",
    inputSchema: { query: z.string().max(500) },
    outputSchema: { results: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })) },
    annotations: READ_ONLY,
  }, async ({ query }) => {
    const needle = query.trim().toLowerCase();
    const matches = (text: string) => !needle || needle.split(/\s+/).every((word) => text.toLowerCase().includes(word));
    const results: { id: string; title: string; url: string }[] = [];
    if (canReadProposals()) {
      const listed = await options.call("/api/v1/proposals?limit=100");
      if (listed.ok) {
        for (const p of items(listed.entity)) {
          if (typeof p.id !== "string") continue;
          if (matches(JSON.stringify(p))) results.push({ id: `${PROPOSAL}${p.id}`, title: proposalTitle(p), url: proposalUrl(p.id) });
        }
      }
    }
    const catalog = await options.call("/api/v1/catalog");
    if (catalog.ok && (matches(JSON.stringify(catalog.entity)) || /catalog|pric|rate|tier/.test(needle))) {
      results.push({ id: CATALOG_ID, title: "Unwhelm published pricing catalog", url: catalogUrl });
    }
    return textResult({ results });
  });

  server.registerTool("fetch", {
    description: "Returns the full document for an id from search: a proposal (proposal:<uuid>, needs proposals:read) or the published catalog (catalog:active).",
    inputSchema: { id: z.string().min(1).max(100) },
    outputSchema: { id: z.string(), title: z.string(), text: z.string(), url: z.string(), metadata: z.record(z.string(), z.unknown()).optional() },
    annotations: READ_ONLY,
  }, async ({ id }) => {
    let doc: Doc | null = null;
    if (id === CATALOG_ID) {
      const catalog = await options.call("/api/v1/catalog");
      if (catalog.ok) doc = { id, title: "Unwhelm published pricing catalog", url: catalogUrl, text: JSON.stringify(catalog.entity, null, 2) };
    } else if (id.startsWith(PROPOSAL)) {
      const proposalId = id.slice(PROPOSAL.length);
      if (!z.string().uuid().safeParse(proposalId).success) throw new Error(`Unknown id: ${id}`);
      if (!canReadProposals()) {
        if (options.authChallenge) return options.authChallenge("proposals:read", "read this proposal");
        throw new Error("This token lacks proposals:read.");
      }
      const loaded = await options.call(`/api/v1/proposals/${proposalId}`);
      if (!loaded.ok) throw new Error(typeof loaded.message === "string" ? loaded.message : `Proposal ${proposalId} was not found.`);
      const entity = { ...((loaded.entity ?? {}) as Record<string, unknown>) };
      const narrative = await options.call(`/api/v1/proposals/${proposalId}/narrative`);
      if (narrative.ok) entity.narrative = narrative.entity;
      doc = { id, title: proposalTitle({ id: proposalId, ...entity }), url: proposalUrl(proposalId), text: JSON.stringify(entity, null, 2), metadata: { status: entity.status ?? null } };
    }
    if (!doc) throw new Error(`Unknown id: ${id}`);
    return textResult(doc);
  });
}
