import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import session from "express-session";
import { invalidateCatalogCache, seedCatalogFixture } from "../../server/catalog.js";
import { createCatalogEditRouter } from "../../server/routes/catalogEdit.js";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";

const staffId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const organizationId = "55555555-5555-4555-8555-555555555555";

type Version = { id: string; status: "draft" | "published"; effectiveFrom: Date; effectiveTo: Date | null; createdAt: Date; updatedAt: Date };

function memoryCatalog() {
  const versions: Version[] = [];
  const models: Array<{ id: string; catalogVersionId: string; code: string; sortOrder: number; createdAt: Date; updatedAt: Date }> = [];
  const tiers: Array<{ id: string; catalogVersionId: string; pricingModelId: string; code: string; amountMinor: number; hours: number | null; minAmountMinor: number | null; currency: string; createdAt: Date; updatedAt: Date }> = [];
  const templates: Array<{ id: string; catalogVersionId: string; pricingModelId: string; percentBasis: number; leftoverCentTarget: "last_entry"; createdAt: Date; updatedAt: Date }> = [];
  const lines: Array<{ id: string; templateId: string; sortOrder: number; label: string; trigger: string; percentBasis: number; amountMinor: number | null; amountRule: string; dueOffsetDays: number | null; createdAt: Date; updatedAt: Date }> = [];
  const policies: Array<Record<string, unknown> & { id: string; catalogVersionId: string }> = [];
  const transitions: Array<{ id: string; catalogVersionId: string; fromStatus: string; toStatus: string; staffOnly: boolean; createdAt: Date }> = [];
  const oauthScopes: Array<{ id: string; catalogVersionId: string; scope: string; mcp: boolean; createdAt: Date }> = [];
  const grants: Array<{ id: string; catalogVersionId: string; role: string; scope: string; createdAt: Date }> = [];

  const source = seedCatalogFixture();
  const seeded: Version = { id: source.id, status: "published", effectiveFrom: new Date(source.effectiveFrom), effectiveTo: null, createdAt: new Date(source.updatedAt), updatedAt: new Date(source.updatedAt) };
  versions.push(seeded);
  const modelId = new Map<string, string>();
  for (const [index, code] of ["workflow_check", "capped_hours", "fixed_price", "hourly"].entries()) {
    const id = `00000000-0000-4000-8000-00000000011${index}`;
    modelId.set(code, id);
    models.push({ id, catalogVersionId: seeded.id, code, sortOrder: index + 1, createdAt: seeded.createdAt, updatedAt: seeded.updatedAt });
  }
  for (const tier of source.tiers) {
    tiers.push({ id: randomUUID(), catalogVersionId: seeded.id, pricingModelId: modelId.get(tier.model) ?? "", code: tier.code, amountMinor: tier.amountMinor, hours: tier.hours, minAmountMinor: tier.minAmountMinor, currency: tier.currency, createdAt: seeded.createdAt, updatedAt: seeded.updatedAt });
  }
  for (const template of source.templates) {
    templates.push({ id: template.id, catalogVersionId: seeded.id, pricingModelId: modelId.get(template.model) ?? "", percentBasis: template.percentBasis, leftoverCentTarget: template.leftoverCentTarget, createdAt: seeded.createdAt, updatedAt: seeded.updatedAt });
    for (const line of template.lines) {
      lines.push({ id: randomUUID(), templateId: template.id, sortOrder: line.sortOrder, label: line.label, trigger: line.trigger, percentBasis: line.percentBasis, amountMinor: line.amountMinor, amountRule: line.amountRule, dueOffsetDays: line.dueOffsetDays, createdAt: seeded.createdAt, updatedAt: seeded.updatedAt });
    }
  }
  policies.push({ id: randomUUID(), catalogVersionId: seeded.id, ...source.invoicePolicy, createdAt: seeded.createdAt, updatedAt: seeded.updatedAt });
  for (const transition of source.transitions) transitions.push({ id: randomUUID(), catalogVersionId: seeded.id, ...transition, createdAt: seeded.createdAt });
  for (const scope of source.mcpScopes) oauthScopes.push({ id: randomUUID(), catalogVersionId: seeded.id, scope, mcp: true, createdAt: seeded.createdAt });
  for (const grant of source.grants) grants.push({ id: randomUUID(), catalogVersionId: seeded.id, ...grant, createdAt: seeded.createdAt });

  const matches = (version: Version, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    if (typeof where.id === "string" && version.id !== where.id) return false;
    if (where.id && typeof where.id === "object" && "not" in where.id && version.id === (where.id as { not: string }).not) return false;
    if (typeof where.status === "string" && version.status !== where.status) return false;
    const from = where.effectiveFrom as { lte?: Date } | undefined;
    if (from?.lte && version.effectiveFrom > from.lte) return false;
    const or = where.OR as Array<Record<string, unknown>> | undefined;
    if (or) {
      const ok = or.some((clause) => {
        if ("effectiveTo" in clause && clause.effectiveTo === null) return version.effectiveTo === null;
        const bound = clause.effectiveTo as { gt?: Date } | undefined;
        return Boolean(bound?.gt && version.effectiveTo && version.effectiveTo > bound.gt);
      });
      if (!ok) return false;
    }
    return true;
  };

  const hydrate = (version: Version) => ({
    ...version,
    pricingModels: models.filter((model) => model.catalogVersionId === version.id).map((model) => ({ ...model })),
    priceTiers: tiers.filter((tier) => tier.catalogVersionId === version.id).map((tier) => ({ ...tier })),
    billingScheduleTemplates: templates.filter((template) => template.catalogVersionId === version.id).map((template) => ({
      ...template,
      lines: lines.filter((line) => line.templateId === template.id).map((line) => ({ ...line })),
    })),
    invoicePolicy: policies.filter((policy) => policy.catalogVersionId === version.id).map((policy) => ({ ...policy }))[0] ?? null,
    invoiceStatusTransitions: transitions.filter((transition) => transition.catalogVersionId === version.id).map((transition) => ({ ...transition })),
    oauthScopes: oauthScopes.filter((scope) => scope.catalogVersionId === version.id).map((scope) => ({ ...scope })),
    sessionScopeGrants: grants.filter((grant) => grant.catalogVersionId === version.id).map((grant) => ({ ...grant })),
  });

  const pick = (where: Record<string, unknown> | undefined, orderBy?: { effectiveFrom?: "desc" }) => {
    const found = versions.filter((version) => matches(version, where));
    if (orderBy?.effectiveFrom === "desc") found.sort((left, right) => right.effectiveFrom.getTime() - left.effectiveFrom.getTime());
    return found;
  };

  const catalogVersion = {
    findFirst: async (args: { where?: Record<string, unknown>; select?: { id: boolean }; include?: unknown; orderBy?: { effectiveFrom?: "desc" } } = {}) => {
      const version = pick(args.where, args.orderBy)[0];
      if (!version) return null;
      if (args.select) return { id: version.id, updatedAt: version.updatedAt };
      return args.include ? hydrate(version) : { ...version };
    },
    findMany: async (args: { where?: Record<string, unknown> } = {}) => pick(args.where).map((version) => ({ ...version })),
    create: async ({ data }: { data: Version }) => {
      const row: Version = { ...data, createdAt: new Date(), updatedAt: new Date() };
      versions.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Version> }) => {
      const version = versions.find((item) => item.id === where.id);
      if (!version) throw new Error("missing version");
      Object.assign(version, data, { updatedAt: new Date() });
      return hydrate(version);
    },
  };

  const stamp = () => ({ createdAt: new Date(), updatedAt: new Date() });
  return {
    versions,
    catalogVersion,
    catalogPricingModel: {
      create: async ({ data }: { data: Omit<(typeof models)[number], "createdAt" | "updatedAt"> }) => {
        const row = { ...data, ...stamp() };
        models.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: { sortOrder: number } }) => {
        const model = models.find((item) => item.id === where.id);
        if (!model) throw new Error("missing model");
        model.sortOrder = data.sortOrder;
        model.updatedAt = new Date();
        return model;
      },
    },
    priceTier: {
      create: async ({ data }: { data: Omit<(typeof tiers)[number], "createdAt" | "updatedAt"> }) => {
        const row = { ...data, ...stamp() };
        tiers.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<(typeof tiers)[number]> }) => {
        const tier = tiers.find((item) => item.id === where.id);
        if (!tier) throw new Error("missing tier");
        Object.assign(tier, data, { updatedAt: new Date() });
        return tier;
      },
    },
    billingScheduleTemplate: {
      create: async ({ data }: { data: Omit<(typeof templates)[number], "createdAt" | "updatedAt"> }) => {
        const row = { ...data, ...stamp() };
        templates.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<(typeof templates)[number]> }) => {
        const template = templates.find((item) => item.id === where.id);
        if (!template) throw new Error("missing template");
        Object.assign(template, data, { updatedAt: new Date() });
        return template;
      },
    },
    billingScheduleTemplateLine: {
      create: async ({ data }: { data: Omit<(typeof lines)[number], "createdAt" | "updatedAt"> }) => {
        const row = { ...data, ...stamp() };
        lines.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<(typeof lines)[number]> }) => {
        const line = lines.find((item) => item.id === where.id);
        if (!line) throw new Error("missing line");
        Object.assign(line, data, { updatedAt: new Date() });
        return line;
      },
    },
    invoicePolicy: {
      create: async ({ data }: { data: Record<string, unknown> & { id: string; catalogVersionId: string } }) => {
        const row = { ...data, ...stamp() };
        policies.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const policy = policies.find((item) => item.id === where.id);
        if (!policy) throw new Error("missing policy");
        Object.assign(policy, data, { updatedAt: new Date() });
        return policy;
      },
    },
    invoiceStatusTransition: {
      create: async ({ data }: { data: Omit<(typeof transitions)[number], "createdAt"> }) => {
        const row = { ...data, createdAt: new Date() };
        transitions.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { catalogVersionId: string } }) => {
        const before = transitions.length;
        for (let index = transitions.length - 1; index >= 0; index -= 1) {
          if (transitions[index]?.catalogVersionId === where.catalogVersionId) transitions.splice(index, 1);
        }
        return { count: before - transitions.length };
      },
    },
    oauthScope: {
      create: async ({ data }: { data: Omit<(typeof oauthScopes)[number], "createdAt"> }) => {
        const row = { ...data, createdAt: new Date() };
        oauthScopes.push(row);
        return row;
      },
    },
    sessionScopeGrant: {
      create: async ({ data }: { data: Omit<(typeof grants)[number], "createdAt"> }) => {
        const row = { ...data, createdAt: new Date() };
        grants.push(row);
        return row;
      },
    },
  };
}

test("draft edits publish for new proposals and leave a signed contract", async () => {
  invalidateCatalogCache();
  const store = memoryCatalog();
  const contracts = new Map<string, { id: string; organizationId: string; proposalId: string; status: string; signedAt: Date | null; billing: unknown; terms: string; createdAt: Date; updatedAt: Date; catalogVersionId: string | null; billingScheduleTemplateId: string | null; proposal: { pricing: unknown; pricingModel: string; catalogVersionId: string | null; engagement: string }; entries: Array<{ id: string; contractId: string; label: string; amountMinor: number; currency: string; trigger: string; invoiceId: string | null; milestoneId: null; percent: string; dueOn: null }> }>();
  const proposals = new Map<string, { id: string; organizationId: string; ownerId: string; title: string; engagement: string; status: string; scope: unknown; timeline: unknown; pricing: unknown; pricingModel: string; catalogVersionId: string | null; version: number; createdAt: Date; updatedAt: Date; options: []; milestones: [] }>();
  const proposalId = randomUUID();
  proposals.set(proposalId, {
    id: proposalId, organizationId, ownerId: staffId, title: "Check", engagement: "workflow_check", status: "draft",
    scope: { summary: "Look", deliverables: ["Notes"] }, timeline: {}, pricing: { model: "workflow_check", amountMinor: 25_000, currency: "USD" },
    pricingModel: "workflow_check", catalogVersionId: store.versions[0]?.id ?? null, version: 1, createdAt: new Date(), updatedAt: new Date(), options: [], milestones: [],
  });
  const tokens = new Map<string, { scopes: string[]; role: "staff" | "client" }>();
  const plainToken = "client-token";
  tokens.set(createHash("sha256").update(plainToken).digest("hex"), { scopes: ["proposals:read"], role: "client" });

  const db = {
    ...store,
    membership: {
      findUnique: async ({ where }: { where: { userId_organizationId: { userId: string } } }) => {
        const userId = where.userId_organizationId.userId;
        if (userId !== staffId && userId !== clientId) return null;
        return { userId, organizationId, role: userId === staffId ? "staff" : "client", status: "active" };
      },
      findFirst: async ({ where }: { where: { userId: string } }) => db.membership.findUnique({ where: { userId_organizationId: { userId: where.userId } } }),
    },
    mcpToken: {
      findFirst: async ({ where }: { where: { tokenHash: string } }) => {
        const token = tokens.get(where.tokenHash);
        if (!token) return null;
        return { userId: clientId, scopes: token.scopes, user: { memberships: [{ status: "active", role: token.role, organizationId }] } };
      },
    },
    proposal: {
      findFirstOrThrow: async ({ where }: { where: { id: string } }) => {
        const proposal = proposals.get(where.id);
        if (!proposal) throw Object.assign(new Error("missing"), { code: "P2025" });
        return { ...proposal, options: [], milestones: [] };
      },
      update: async ({ where, data }: { where: { id: string }; data: { pricingModel?: string; pricing?: unknown; catalogVersionId?: string; version?: { increment: number } } }) => {
        const proposal = proposals.get(where.id);
        if (!proposal) throw new Error("missing proposal");
        if (data.pricingModel) proposal.pricingModel = data.pricingModel;
        if (data.pricing !== undefined) proposal.pricing = data.pricing;
        if (data.catalogVersionId) proposal.catalogVersionId = data.catalogVersionId;
        if (data.version?.increment) proposal.version += data.version.increment;
        proposal.updatedAt = new Date();
        return { ...proposal, options: [], milestones: [] };
      },
    },
    contract: {
      findFirstOrThrow: async ({ where }: { where: { id: string } }) => {
        const contract = contracts.get(where.id);
        if (!contract) throw Object.assign(new Error("missing"), { code: "P2025" });
        return { ...contract, entries: contract.entries.map((entry) => ({ ...entry })), proposal: { ...contract.proposal } };
      },
      update: async ({ where, data }: { where: { id: string }; data: { status?: string; signedAt?: Date; billing?: unknown; catalogVersion?: { connect: { id: string } }; billingScheduleTemplate?: { connect: { id: string } } } }) => {
        const contract = contracts.get(where.id);
        if (!contract) throw new Error("missing contract");
        if (data.status) contract.status = data.status;
        if (data.signedAt) contract.signedAt = data.signedAt;
        if (data.billing !== undefined) contract.billing = data.billing;
        if (data.catalogVersion?.connect.id) contract.catalogVersionId = data.catalogVersion.connect.id;
        if (data.billingScheduleTemplate?.connect.id) contract.billingScheduleTemplateId = data.billingScheduleTemplate.connect.id;
        contract.updatedAt = new Date();
        return { ...contract, entries: contract.entries.map((entry) => ({ ...entry })) };
      },
    },
    billingEntry: {
      createMany: async ({ data }: { data: Array<{ id: string; contractId: string; label: string; amountMinor: number; currency: string; trigger: string; percent: string }> }) => {
        const contract = contracts.get(data[0]?.contractId ?? "");
        if (contract) contract.entries.push(...data.map((entry) => ({ ...entry, invoiceId: null, milestoneId: null as null, dueOn: null as null })));
        return { count: data.length };
      },
      updateMany: async () => ({ count: 1 }),
    },
    invoice: { create: async ({ data }: { data: { amountMinor: number } }) => ({ id: randomUUID(), ...data }) },
    $queryRawUnsafe: async () => [],
    $transaction: async <T>(callback: (transaction: typeof db) => Promise<T>) => callback(db),
  };

  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => {
    if (!request.header("authorization")) request.session.userId = request.header("x-test-user") === "client" ? clientId : staffId;
    request.session.organizationId = organizationId;
    next();
  });
  app.use("/api/v1", createCatalogEditRouter({ prisma: db as never }));
  app.use("/api/v1", createProposalContractRouter({ prisma: db as never }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const contractId = randomUUID();
  const proposal = proposals.get(proposalId);
  if (!proposal) throw new Error("missing proposal");
  contracts.set(contractId, {
    id: contractId, organizationId, proposalId, status: "draft", signedAt: null, billing: {}, terms: "Terms", createdAt: new Date(), updatedAt: new Date(),
    catalogVersionId: null, billingScheduleTemplateId: null,
    proposal: { pricing: proposal.pricing, pricingModel: proposal.pricingModel, catalogVersionId: proposal.catalogVersionId, engagement: proposal.engagement },
    entries: [],
  });
  const json = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${base}${path}`, init);
    return { status: response.status, body: await response.json() as { ok: boolean; code?: string; entity: { id?: string; status?: string; entries?: Array<{ amountMinor: number }>; priceTiers?: Array<{ code: string; amountMinor: number }>; templates?: Array<{ lines: Array<{ id: string; label: string }> }>; invoicePolicy?: { signingDueOffsetDays: number }; pricing?: { amountMinor?: number }; catalogVersionId?: string } } };
  };
  try {
    const denied = await json("/api/v1/catalog/drafts", { method: "POST", headers: { "content-type": "application/json", "x-test-user": "client" } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "FORBIDDEN");
    const bearer = await json("/api/v1/catalog/drafts", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${plainToken}` } });
    assert.equal(bearer.status, 403);
    assert.equal(bearer.body.code, "SCOPE_REQUIRED");

    const signed = await json(`/api/v1/contracts/${contractId}/sign`, { method: "POST", headers: { "content-type": "application/json" } });
    assert.equal(signed.status, 200);
    assert.equal(signed.body.entity.entries?.[0]?.amountMinor, 25_000);
    const signedVersion = contracts.get(contractId)?.catalogVersionId;

    const draft = await json("/api/v1/catalog/drafts", { method: "POST", headers: { "content-type": "application/json" } });
    assert.equal(draft.status, 201);
    assert.equal(draft.body.entity.status, "draft");
    const versionId = draft.body.entity.id;
    if (!versionId) throw new Error("missing draft");
    const lineId = draft.body.entity.templates?.flatMap((template) => template.lines).find((line) => line.label === "Workflow Check")?.id;
    if (!lineId) throw new Error("missing line");
    const tier = await json(`/api/v1/catalog/drafts/${versionId}/price-tiers/workflow_check`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountMinor: 26_000, minAmountMinor: 26_000 }) });
    assert.equal(tier.status, 200);
    assert.equal(tier.body.entity.priceTiers?.find((item) => item.code === "workflow_check")?.amountMinor, 26_000);
    const line = await json(`/api/v1/catalog/drafts/${versionId}/billing-schedule-lines/${lineId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "Workflow Check, revised" }) });
    assert.equal(line.status, 200);
    const policy = await json(`/api/v1/catalog/drafts/${versionId}/invoice-policy`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ signingDueOffsetDays: 2 }) });
    assert.equal(policy.status, 200);
    assert.equal(policy.body.entity.invoicePolicy?.signingDueOffsetDays, 2);
    const published = await json(`/api/v1/catalog/drafts/${versionId}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ effectiveFrom: "2026-03-01T00:00:00.000Z" }) });
    assert.equal(published.status, 200);
    assert.equal(published.body.entity.status, "published");
    const previous = store.versions.find((version) => version.id === signedVersion);
    assert.equal(previous?.effectiveTo?.toISOString(), "2026-03-01T00:00:00.000Z");
    const frozen = await json(`/api/v1/catalog/drafts/${versionId}/price-tiers/workflow_check`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountMinor: 27_000 }) });
    assert.equal(frozen.status, 409);

    const nextPrice = await json(`/api/v1/proposals/${proposalId}/budget`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "workflow_check", amountMinor: 26_000, currency: "USD" }) });
    assert.equal(nextPrice.status, 200);
    assert.equal(nextPrice.body.entity.pricing?.amountMinor, 26_000);
    assert.equal(proposals.get(proposalId)?.catalogVersionId, versionId);
    const oldPrice = await json(`/api/v1/proposals/${proposalId}/budget`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "workflow_check", amountMinor: 25_000, currency: "USD" }) });
    assert.equal(oldPrice.status, 400);

    const again = await json(`/api/v1/contracts/${contractId}/sign`, { method: "POST", headers: { "content-type": "application/json" } });
    assert.equal(again.status, 200);
    assert.equal(again.body.entity.entries?.[0]?.amountMinor, 25_000);
    assert.equal(again.body.entity.entries?.[0] && contracts.get(contractId)?.entries[0]?.label, "Workflow Check");
    assert.equal(contracts.get(contractId)?.catalogVersionId, signedVersion);
  } finally {
    server.close();
  }
});
