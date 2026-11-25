import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { authorize } from "./catalogEdit.js";

// Staff side of the case library: rate agent sessions or turns good/bad, turn a rating into a case, and curate cases.
// Ratings and case statuses are rows (guidance_feedback_rating, guidance_case_status).
const Key = z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/, "Keys are lowercase letters, digits, and underscores.");
const FeedbackBody = z.object({
  proposalId: z.string().uuid(),
  sessionId: z.string().min(1).max(200).optional(),
  eventId: z.string().uuid().optional(),
  rating: z.string().min(1).max(32),
  note: z.string().trim().max(2000).optional(),
}).strict();
const CaseFields = {
  title: z.string().trim().min(1).max(200),
  situation: z.string().trim().min(1).max(4000),
  signals: z.record(z.string(), z.unknown()),
  move: z.string().min(1).max(100).nullable(),
  clientPhrase: z.string().trim().max(1000).nullable(),
  lesson: z.string().trim().min(1).max(4000),
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
};
const CaseCreate = z.object({
  key: Key,
  feedbackId: z.string().uuid().optional(),
  title: CaseFields.title,
  situation: CaseFields.situation,
  lesson: CaseFields.lesson,
  signals: CaseFields.signals.optional(),
  move: CaseFields.move.optional(),
  clientPhrase: CaseFields.clientPhrase.optional(),
  tags: CaseFields.tags.optional(),
  polarity: z.number().int().min(-1).max(1).optional(),
}).strict();
const CasePatch = z.object({
  title: CaseFields.title.optional(),
  situation: CaseFields.situation.optional(),
  lesson: CaseFields.lesson.optional(),
  signals: CaseFields.signals.optional(),
  move: CaseFields.move.optional(),
  clientPhrase: CaseFields.clientPhrase.optional(),
  tags: CaseFields.tags.optional(),
  polarity: z.number().int().min(-1).max(1).optional(),
  status: z.string().min(1).max(32).optional(),
}).strict();

class CaseError extends Error { constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); } }

export function createGuidanceCaseEditRouter(options: { prisma: PrismaClient }): Router {
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
      if (error instanceof CaseError) { fail(error.statusCode, error.code, error.message); return; }
      if (error instanceof z.ZodError) { fail(400, "VALIDATION_FAILED", "The request is not valid.", error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)); return; }
      if ((error as { code?: string }).code === "P2003") { fail(400, "VALIDATION_FAILED", "That move is not configured."); return; }
      if ((error as { code?: string }).code === "P2002") { fail(409, "CONFLICT", "That case key or feedback is already used by another case."); return; }
      next(error);
    }
  };
  const param = (request: Request, name: string) => { const v = request.params[name]; return Array.isArray(v) ? v[0] ?? "" : v ?? ""; };
  const staffId = (request: Request) => (request.session as { userId?: string } | undefined)?.userId ?? null;

  router.get("/staff/guidance-feedback", run(async (request, response) => {
    const rating = typeof request.query.rating === "string" ? request.query.rating : undefined;
    const rows = await prisma.guidanceFeedback.findMany({ where: rating ? { rating } : {}, orderBy: { createdAt: "desc" }, take: 200 });
    const used = new Set((await prisma.guidanceCase.findMany({ where: { feedbackId: { in: rows.map((row) => row.id) } }, select: { feedbackId: true } })).map((row) => row.feedbackId));
    const unpromoted = request.query.unpromoted === "1";
    ok(request, response, rows.filter((row) => !unpromoted || !used.has(row.id)).map((row) => ({ ...row, promoted: used.has(row.id) })));
  }));

  router.post("/staff/guidance-feedback", run(async (request, response) => {
    const body = FeedbackBody.parse(request.body ?? {});
    if (!(await prisma.guidanceFeedbackRating.findUnique({ where: { code: body.rating } }))) throw new CaseError(400, "VALIDATION_FAILED", "That rating is not configured.");
    if (!(await prisma.proposal.findUnique({ where: { id: body.proposalId } }))) throw new CaseError(404, "NOT_FOUND", "That proposal does not exist.");
    if (body.eventId) {
      const event = await prisma.guidanceSessionEvent.findUnique({ where: { id: body.eventId } });
      if (!event || event.proposalId !== body.proposalId) throw new CaseError(404, "NOT_FOUND", "That session event does not belong to the proposal.");
    }
    const row = await prisma.guidanceFeedback.create({ data: { ...body, staffId: staffId(request) } });
    ok(request, response, row, true, 201);
  }));

  router.get("/staff/guidance-cases", run(async (request, response) => {
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    const [cases, statuses] = await Promise.all([
      prisma.guidanceCase.findMany({ where: status ? { statusCode: status } : {}, orderBy: { updatedAt: "desc" } }),
      prisma.guidanceCaseStatus.findMany({ orderBy: { sortOrder: "asc" } }),
    ]);
    ok(request, response, { cases, statuses });
  }));

  router.post("/staff/guidance-cases", run(async (request, response) => {
    const body = CaseCreate.parse(request.body ?? {});
    let fromFeedback: { proposalId: string; eventId: string | null; polarity: number; signals: unknown; move: string | null } | undefined;
    if (body.feedbackId) {
      const feedback = await prisma.guidanceFeedback.findUnique({ where: { id: body.feedbackId } });
      if (!feedback) throw new CaseError(404, "NOT_FOUND", "That feedback does not exist.");
      const rating = await prisma.guidanceFeedbackRating.findUnique({ where: { code: feedback.rating } });
      const event = feedback.eventId ? await prisma.guidanceSessionEvent.findUnique({ where: { id: feedback.eventId } }) : null;
      fromFeedback = { proposalId: feedback.proposalId, eventId: feedback.eventId, polarity: rating?.polarity ?? 0, signals: event?.signals ?? {}, move: event?.chosenMove ?? null };
    }
    const row = await prisma.guidanceCase.create({ data: {
      key: body.key, title: body.title, situation: body.situation, lesson: body.lesson,
      signals: (body.signals ?? fromFeedback?.signals ?? {}) as object,
      move: body.move !== undefined ? body.move : fromFeedback?.move ?? null,
      clientPhrase: body.clientPhrase ?? null, tags: body.tags ?? [],
      polarity: body.polarity ?? fromFeedback?.polarity ?? 0,
      proposalId: fromFeedback?.proposalId ?? null, eventId: fromFeedback?.eventId ?? null, feedbackId: body.feedbackId ?? null,
      createdBy: staffId(request),
    } });
    ok(request, response, row, true, 201);
  }));

  router.patch("/staff/guidance-cases/:key", run(async (request, response) => {
    const body = CasePatch.parse(request.body ?? {});
    const key = param(request, "key");
    if (!(await prisma.guidanceCase.findUnique({ where: { key } }))) throw new CaseError(404, "NOT_FOUND", "That case does not exist.");
    if (body.status && !(await prisma.guidanceCaseStatus.findUnique({ where: { code: body.status } }))) throw new CaseError(400, "VALIDATION_FAILED", "That case status is not configured.");
    const { status, signals, ...rest } = body;
    const row = await prisma.guidanceCase.update({ where: { key }, data: { ...rest, ...(signals ? { signals: signals as object } : {}), ...(status ? { statusCode: status } : {}) } });
    ok(request, response, row, true);
  }));

  return router;
}
