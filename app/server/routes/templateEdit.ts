import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import { PricingModel, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorize } from "./catalogEdit.js";

// Staff editor for proposal templates. Everything a template is (parts, samples, options, review rules) is rows,
// so staff change templates here instead of in migrations. Options never carry prices; the agent never sets hours or price.
const Code = z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/, "Codes are lowercase letters, digits, and underscores.");
const pricingModel = z.enum(Object.values(PricingModel) as [string, ...string[]]);
const checks = z.enum(["missing", "min_chars", "min_items", "pattern", "state_open"]);
const fieldPath = z.enum(["scope", "timeline", "pricing"]).or(z.string().regex(/^(scope|timeline|pricing)\.[a-zA-Z.]+$/));

const TemplateCreate = z.object({
  code: Code,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(""),
  suggestedPricingModel: pricingModel.nullable().optional(),
  copyFrom: Code.optional(),
}).strict();
const TemplatePatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
  suggestedPricingModel: pricingModel.nullable().optional(),
}).strict();
const NodesBody = z.object({ nodes: z.array(z.object({ nodeKey: z.string().min(1).max(100), parentKey: z.string().min(1).max(100).nullable().optional() }).strict()).min(1).max(60) }).strict();
const SampleBody = z.object({ content: z.record(z.string(), z.unknown()) }).strict();
const OptionsBody = z.object({ options: z.array(z.object({
  code: Code, label: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).default(""),
  selection: z.enum(["optional"]).default("optional"),
}).strict()).max(20) }).strict();
const RuleFields = {
  nodeKey: z.string().min(1).max(100),
  check: checks,
  fieldPath: fieldPath.nullable().optional(),
  minChars: z.number().int().positive().nullable().optional(),
  minItems: z.number().int().positive().nullable().optional(),
  pattern: z.string().max(500).nullable().optional(),
  severity: z.enum(["issue", "suggestion"]),
  weight: z.number().int().min(0).max(100),
  message: z.string().trim().min(1).max(500),
  suggestion: z.string().trim().min(1).max(1000),
  sort: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
};
const RuleCreate = z.object({ code: Code, ...RuleFields }).strict();
const RulePatch = z.object(Object.fromEntries(Object.entries(RuleFields).map(([k, v]) => [k, v.optional()])) as { [K in keyof typeof RuleFields]: z.ZodOptional<(typeof RuleFields)[K]> }).strict();

class EditError extends Error { constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); } }

function ruleProblems(rule: { check?: string; minChars?: number | null; minItems?: number | null; pattern?: string | null }): void {
  if (rule.check === "min_chars" && !rule.minChars) throw new EditError(400, "VALIDATION_FAILED", "A min_chars rule needs minChars.");
  if (rule.check === "min_items" && !rule.minItems) throw new EditError(400, "VALIDATION_FAILED", "A min_items rule needs minItems.");
  if (rule.check === "pattern") {
    if (!rule.pattern) throw new EditError(400, "VALIDATION_FAILED", "A pattern rule needs a pattern.");
    try { new RegExp(rule.pattern, "i"); } catch { throw new EditError(400, "VALIDATION_FAILED", "The pattern is not a valid regular expression."); }
  }
}

const include = {
  nodes: { include: { node: true }, orderBy: { sortOrder: "asc" as const } },
  samples: true,
  options: { orderBy: { sortOrder: "asc" as const } },
  reviewRules: { orderBy: [{ nodeKey: "asc" as const }, { sort: "asc" as const }] },
  _count: { select: { proposals: true } },
};

export function createTemplateEditRouter(options: { prisma: PrismaClient }): Router {
  const prisma = options.prisma;
  const router = Router();
  const ok = (request: Request, response: Response, entity: unknown, changed = false, statusCode = 200) =>
    response.status(statusCode).json({ ok: true, ...(changed ? { changed: true } : {}), entity, warnings: [], links: {}, requestId: randomUUID() });
  const run = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response, next: (error: unknown) => void) => {
    try {
      if (!(await authorize(prisma, request, response))) return;
      await handler(request, response);
    } catch (error) {
      const fail = (status: number, code: string, message: string, details?: string[]) =>
        response.status(status).json({ ok: false, code, message, retryable: false, ...(details ? { details } : {}), requestId: randomUUID() });
      if (error instanceof EditError) { fail(error.statusCode, error.code, error.message); return; }
      if (error instanceof z.ZodError) { fail(400, "VALIDATION_FAILED", "The request is not valid.", error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)); return; }
      next(error);
    }
  };
  const code = (request: Request) => { const v = request.params.code; return Array.isArray(v) ? v[0] ?? "" : v ?? ""; };
  const load = async (templateCode: string) => {
    const row = await prisma.proposalTemplate.findUnique({ where: { code: templateCode }, include });
    if (!row) throw new EditError(404, "NOT_FOUND", "That template does not exist.");
    return row;
  };

  router.get("/staff/proposal-templates", run(async (request, response) => {
    const [templates, parts] = await Promise.all([
      prisma.proposalTemplate.findMany({ include, orderBy: { sortOrder: "asc" } }),
      prisma.proposalNodeTemplate.findMany({ include: { library: true }, orderBy: { sortOrder: "asc" } }),
    ]);
    ok(request, response, { templates, parts: parts.map((p) => ({ key: p.key, kind: p.kind, title: p.title, clientLabel: p.clientLabel, inLibrary: Boolean(p.library?.active) })), pricingModels: Object.values(PricingModel) });
  }));

  router.post("/staff/proposal-templates", run(async (request, response) => {
    const body = TemplateCreate.parse(request.body ?? {});
    if (await prisma.proposalTemplate.findUnique({ where: { code: body.code } })) throw new EditError(409, "CONFLICT", "A template with that code already exists.");
    const source = body.copyFrom ? await load(body.copyFrom) : null;
    const last = await prisma.proposalTemplate.aggregate({ _max: { sortOrder: true } });
    await prisma.$transaction(async (tx) => {
      await tx.proposalTemplate.create({ data: { code: body.code, name: body.name, description: body.description, sortOrder: (last._max.sortOrder ?? 0) + 10, active: false, suggestedPricingModel: body.suggestedPricingModel ?? source?.suggestedPricingModel ?? null } });
      if (!source) return;
      await tx.proposalTemplateNode.createMany({ data: source.nodes.map((n) => ({ templateCode: body.code, nodeKey: n.nodeKey, sortOrder: n.sortOrder, parentKey: n.parentKey })) });
      await tx.proposalTemplateSample.createMany({ data: source.samples.map((s) => ({ templateCode: body.code, nodeKey: s.nodeKey, content: s.content as object })) });
      await tx.proposalTemplateOption.createMany({ data: source.options.map((o) => ({ templateCode: body.code, code: o.code, sortOrder: o.sortOrder, label: o.label, description: o.description, selection: o.selection })) });
      await tx.proposalReviewRule.createMany({ data: source.reviewRules.map(({ code: ruleCode, templateCode: _t, ...rule }) => ({ ...rule, code: `${body.code}__${ruleCode}`.slice(0, 120), templateCode: body.code })) });
    });
    // New templates start inactive so clients never see a half-built one.
    ok(request, response, await load(body.code), true, 201);
  }));

  router.patch("/staff/proposal-templates/:code", run(async (request, response) => {
    const body = TemplatePatch.parse(request.body ?? {});
    const current = await load(code(request));
    if (body.active === true && current.nodes.length === 0) throw new EditError(409, "CONFLICT", "Add parts before activating a template.");
    await prisma.proposalTemplate.update({ where: { code: current.code }, data: body });
    ok(request, response, await load(current.code), true);
  }));

  router.put("/staff/proposal-templates/:code/nodes", run(async (request, response) => {
    const body = NodesBody.parse(request.body ?? {});
    const current = await load(code(request));
    const keys = body.nodes.map((n) => n.nodeKey);
    if (new Set(keys).size !== keys.length) throw new EditError(400, "VALIDATION_FAILED", "Each part can appear once.");
    const known = new Set((await prisma.proposalNodeTemplate.findMany({ where: { key: { in: keys } }, select: { key: true } })).map((n) => n.key));
    const unknown = keys.filter((k) => !known.has(k));
    if (unknown.length) throw new EditError(400, "VALIDATION_FAILED", `Unknown parts: ${unknown.join(", ")}`);
    const badParent = body.nodes.find((n) => n.parentKey && !keys.includes(n.parentKey));
    if (badParent) throw new EditError(400, "VALIDATION_FAILED", `The parent of ${badParent.nodeKey} is not in this template.`);
    // Existing proposals keep the parts they were built with; this only changes what new proposals get.
    await prisma.$transaction([
      prisma.proposalTemplateNode.deleteMany({ where: { templateCode: current.code } }),
      prisma.proposalTemplateNode.createMany({ data: body.nodes.map((n, i) => ({ templateCode: current.code, nodeKey: n.nodeKey, parentKey: n.parentKey ?? null, sortOrder: (i + 1) * 10 })) }),
      prisma.proposalTemplateSample.deleteMany({ where: { templateCode: current.code, nodeKey: { notIn: keys } } }),
    ]);
    ok(request, response, await load(current.code), true);
  }));

  router.put("/staff/proposal-templates/:code/samples/:nodeKey", run(async (request, response) => {
    const body = SampleBody.parse(request.body ?? {});
    const current = await load(code(request));
    const nodeKey = String(request.params.nodeKey);
    if (!current.nodes.some((n) => n.nodeKey === nodeKey)) throw new EditError(400, "VALIDATION_FAILED", "That part is not in this template.");
    await prisma.proposalTemplateSample.upsert({ where: { templateCode_nodeKey: { templateCode: current.code, nodeKey } }, create: { templateCode: current.code, nodeKey, content: body.content as object }, update: { content: body.content as object } });
    ok(request, response, await load(current.code), true);
  }));

  router.delete("/staff/proposal-templates/:code/samples/:nodeKey", run(async (request, response) => {
    const current = await load(code(request));
    await prisma.proposalTemplateSample.deleteMany({ where: { templateCode: current.code, nodeKey: String(request.params.nodeKey) } });
    ok(request, response, await load(current.code), true);
  }));

  router.put("/staff/proposal-templates/:code/options", run(async (request, response) => {
    const body = OptionsBody.parse(request.body ?? {});
    const current = await load(code(request));
    if (new Set(body.options.map((o) => o.code)).size !== body.options.length) throw new EditError(400, "VALIDATION_FAILED", "Option codes must be unique.");
    await prisma.$transaction([
      prisma.proposalTemplateOption.deleteMany({ where: { templateCode: current.code } }),
      prisma.proposalTemplateOption.createMany({ data: body.options.map((o, i) => ({ templateCode: current.code, sortOrder: (i + 1) * 10, ...o })) }),
    ]);
    ok(request, response, await load(current.code), true);
  }));

  router.post("/staff/proposal-templates/:code/rules", run(async (request, response) => {
    const body = RuleCreate.parse(request.body ?? {});
    const current = await load(code(request));
    ruleProblems(body);
    if (await prisma.proposalReviewRule.findUnique({ where: { code: body.code } })) throw new EditError(409, "CONFLICT", "A rule with that code already exists.");
    await prisma.proposalReviewRule.create({ data: { ...body, templateCode: current.code } });
    ok(request, response, await load(current.code), true, 201);
  }));

  const ownRule = async (request: Request) => {
    const current = await load(code(request));
    const rule = current.reviewRules.find((r) => r.code === String(request.params.ruleCode));
    if (!rule) throw new EditError(404, "NOT_FOUND", "That rule is not on this template.");
    return { current, rule };
  };

  router.patch("/staff/proposal-templates/:code/rules/:ruleCode", run(async (request, response) => {
    const body = RulePatch.parse(request.body ?? {});
    const { current, rule } = await ownRule(request);
    ruleProblems({ ...rule, ...body });
    await prisma.proposalReviewRule.update({ where: { code: rule.code }, data: body });
    ok(request, response, await load(current.code), true);
  }));

  router.delete("/staff/proposal-templates/:code/rules/:ruleCode", run(async (request, response) => {
    const { current, rule } = await ownRule(request);
    await prisma.proposalReviewRule.delete({ where: { code: rule.code } });
    ok(request, response, await load(current.code), true);
  }));

  return router;
}
