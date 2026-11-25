import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import express, { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { runReminders } from "../proposalReminders.js";
import { deliverReminders, isValidTimezone, newUnsubscribeToken, nextTicklerAt, parseClock, prismaDeliveryStore, runTicklers, sendersFromEnv, settingsFromRows, smsKeyword, type Senders } from "../reminderDelivery.js";
import { guidanceSessionId, noteGuidanceAction } from "../guidanceTurn.js";

type Principal = { userId: string; organizationId?: string; membershipRole?: string; isAdmin: boolean; scopes: string[] | null };

const resolvePrincipal = async (prisma: PrismaClient, request: Request): Promise<Principal | undefined> => {
  const header = request.header("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (!token) return undefined;
    const stored = await prisma.mcpToken.findFirst({
      where: { tokenHash: createHash("sha256").update(token).digest("hex"), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { client: true, user: { include: { memberships: true } } },
    });
    if (!stored?.userId || !stored.user) return undefined;
    const membership = stored.user.memberships.find((item) => item.status === "active");
    const scopes = Array.isArray(stored.scopes) ? stored.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    return { userId: stored.userId, organizationId: stored.client.organizationId ?? membership?.organizationId, membershipRole: membership?.role, isAdmin: Boolean(stored.user.isAdmin), scopes };
  }
  const userId = request.session?.userId;
  if (!userId) return undefined;
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: true } });
  if (!user) return undefined;
  const membership = user.memberships.find((item) => item.status === "active");
  return { userId, organizationId: membership?.organizationId, membershipRole: membership?.role, isAdmin: Boolean(user.isAdmin), scopes: null };
};

const isStaff = (principal: Principal) => principal.isAdmin || principal.membershipRole === "staff";

const requestId = (request: Request) => request.header("x-request-id") || randomUUID();
const param = (request: Request, name: string) => {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
};
const ok = (request: Request, response: Response, entity: unknown, changed = false, status = 200) =>
  response.status(status).json({ ok: true, changed, entity, warnings: [], links: {}, requestId: requestId(request) });
const fail = (request: Request, response: Response, status: number, code: string, message: string) =>
  response.status(status).json({ ok: false, code, message, retryable: status >= 500, requestId: requestId(request) });

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const run = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response) => {
  try { await handler(request, response); }
  catch (error) {
    if (error instanceof HttpError) { fail(request, response, error.status, error.code, error.message); return; }
    if (error instanceof z.ZodError) { fail(request, response, 400, "VALIDATION_FAILED", "The request body is invalid."); return; }
    console.error(error);
    fail(request, response, 500, "INTERNAL_ERROR", "The request could not be completed.");
  }
};

const authorize = async (prisma: PrismaClient, request: Request, scope: string, options: { staff?: boolean } = {}): Promise<Principal> => {
  const principal = await resolvePrincipal(prisma, request);
  if (!principal) throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  if (principal.scopes && !scopeAllows(principal.scopes, scope)) throw new HttpError(403, "SCOPE_REQUIRED", `The ${scope} scope is required.`);
  if (options.staff && !isStaff(principal)) throw new HttpError(403, "FORBIDDEN", "Staff authorization is required.");
  return principal;
};

const canSeeProposal = (principal: Principal, proposal: { ownerId: string; organizationId: string | null }) =>
  isStaff(principal) || proposal.ownerId === principal.userId || Boolean(principal.organizationId && proposal.organizationId === principal.organizationId);

async function writeAudit(prisma: PrismaClient | Prisma.TransactionClient, event: { organizationId: string | null; actorUserId: string | null; operation: string; method: string; path: string; recordType: string; recordId: string; requestId: string; input: Record<string, unknown>; statusCode: number }) {
  const previous = await prisma.auditEvent.findFirst({ orderBy: { createdAt: "desc" } });
  const previousHash = previous?.hash ?? null;
  await prisma.auditEvent.create({
    data: {
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      tokenId: null,
      operation: event.operation,
      method: event.method,
      path: event.path,
      recordType: event.recordType,
      recordId: event.recordId,
      requestId: event.requestId,
      inputRedacted: event.input as Prisma.InputJsonValue,
      statusCode: event.statusCode,
      previousHash,
      hash: createHash("sha256").update(JSON.stringify({ previousHash, operation: event.operation, recordId: event.recordId, ...event.input })).digest("hex"),
    },
  });
}

const Clock = z.string().refine((value) => parseClock(value) !== null, "Use HH:MM (24 hour).");
const PreferenceBody = z.object({
  channel: z.string().min(1).max(40),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Use E.164, e.g. +15551234567.").nullable().optional(),
  consent: z.boolean().optional(),
  consentSource: z.string().max(80).optional(),
  quietStart: Clock.nullable().optional(),
  quietEnd: Clock.nullable().optional(),
  timezone: z.string().max(80).refine(isValidTimezone, "Unknown timezone.").nullable().optional(),
  optOut: z.boolean().optional(),
}).strict();
const TicklerBody = z.object({
  option: z.string().min(1).max(40),
  intervalDays: z.number().int().min(1).max(365).nullable().optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  timeOfDay: Clock.optional(),
}).strict();
const DeliveryQuery = z.object({ status: z.enum(["pending", "deferred", "sent", "failed", "skipped"]).optional(), proposalId: z.string().uuid().optional(), userId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).optional() });
const DeliverBody = z.object({ ticklers: z.boolean().optional(), dryRun: z.boolean().optional() }).strict();

const publicPreference = (row: { channel: string; email: string | null; phone: string | null; consentAt: Date | null; quietStart: string | null; quietEnd: string | null; timezone: string | null; optedOutAt: Date | null; updatedAt: Date } | null) =>
  row ? { channel: row.channel, email: row.email, phone: row.phone, consentAt: row.consentAt, quietStart: row.quietStart, quietEnd: row.quietEnd, timezone: row.timezone, optedOut: Boolean(row.optedOutAt), optedOutAt: row.optedOutAt, updatedAt: row.updatedAt } : null;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);

export function createReminderDeliveryRouter({ prisma, now = () => new Date(), senders }: { prisma: PrismaClient; now?: () => Date; senders?: Senders }): Router {
  const router = Router();
  const store = prismaDeliveryStore(prisma);
  const settings = async () => settingsFromRows(await prisma.reminderDeliverySetting.findMany());

  /** Channel and tickler choices to offer at intake. All DB rows. */
  router.get("/reminders/options", run(async (request, response) => {
    await authorize(prisma, request, "proposals:read");
    const [channels, ticklerOptions, current] = await Promise.all([
      prisma.contactChannel.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.ticklerOption.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      settings(),
    ]);
    ok(request, response, { channels, ticklerOptions, defaults: { quietStart: current.defaultQuietStart, quietEnd: current.defaultQuietEnd, timezone: current.defaultTimezone, ticklerTime: current.ticklerDefaultTime, ticklerMaxCount: current.ticklerMaxCount, minIntervalDays: current.ticklerMinIntervalDays, maxIntervalDays: current.ticklerMaxIntervalDays } });
  }));

  router.get("/me/contact-preference", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:read");
    ok(request, response, { preference: publicPreference(await prisma.contactPreference.findUnique({ where: { userId: principal.userId } })) });
  }));

  router.put("/me/contact-preference", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:write");
    const body = PreferenceBody.parse(request.body ?? {});
    const channel = await prisma.contactChannel.findUnique({ where: { code: body.channel } });
    if (!channel) throw new HttpError(400, "UNKNOWN_CHANNEL", "That reminder channel is not offered.");
    const existing = await prisma.contactPreference.findUnique({ where: { userId: principal.userId } });
    const phone = body.phone === undefined ? existing?.phone ?? null : body.phone;
    if (channel.sendsSms && !phone) throw new HttpError(400, "PHONE_REQUIRED", "Text reminders need a mobile number in E.164 form.");
    if ((channel.sendsEmail || channel.sendsSms) && !body.consent && !existing?.consentAt) throw new HttpError(400, "CONSENT_REQUIRED", "Ask the client to agree to reminders, then send consent: true.");
    const at = now();
    const data = {
      organizationId: principal.organizationId ?? existing?.organizationId ?? null,
      channel: body.channel,
      email: body.email === undefined ? existing?.email ?? null : body.email,
      phone,
      quietStart: body.quietStart === undefined ? existing?.quietStart ?? null : body.quietStart,
      quietEnd: body.quietEnd === undefined ? existing?.quietEnd ?? null : body.quietEnd,
      timezone: body.timezone === undefined ? existing?.timezone ?? null : body.timezone,
      ...(body.consent ? { consentAt: at, consentSource: body.consentSource ?? (principal.scopes ? "mcp" : "portal") } : {}),
      ...(body.optOut === true ? { optedOutAt: at, optOutSource: "preference" } : body.optOut === false || body.consent ? { optedOutAt: null, optOutSource: null } : {}),
    };
    const saved = await prisma.contactPreference.upsert({ where: { userId: principal.userId }, create: { userId: principal.userId, unsubscribeToken: newUnsubscribeToken(), ...data }, update: data });
    // Preference changes can cancel or reschedule ticklers. Ticklers use wall-clock time in the selected timezone.
    if (body.optOut === true) {
      await prisma.proposalTickler.updateMany({ where: { userId: principal.userId, stoppedAt: null }, data: { stoppedAt: at, stopReason: "opted_out", nextAt: null } });
    } else if (body.timezone !== undefined && (body.timezone ?? null) !== (existing?.timezone ?? null)) {
      const current = await settings();
      const timezone = body.timezone ?? current.defaultTimezone;
      const active = await prisma.proposalTickler.findMany({ where: { userId: principal.userId, stoppedAt: null } });
      if (active.length) {
        await prisma.$transaction(active.map((tickler) => prisma.proposalTickler.update({
          where: { id: tickler.id },
          data: { nextAt: nextTicklerAt({ optionCode: tickler.optionCode, intervalDays: tickler.intervalDays, weekday: tickler.weekday, timeOfDay: tickler.timeOfDay }, at, timezone) },
        })));
      }
    }
    await writeAudit(prisma, { organizationId: principal.organizationId ?? null, actorUserId: principal.userId, operation: "contact_preference.set", method: request.method, path: request.path, recordType: "ContactPreference", recordId: saved.id, requestId: requestId(request), input: { channel: body.channel, consent: Boolean(body.consent), optOut: body.optOut ?? null, hasPhone: Boolean(phone), timezone: data.timezone }, statusCode: 200 });
    ok(request, response, { preference: publicPreference(saved) }, true);
  }));

  /** Linked from every reminder email. No login: the token is the credential. */
  router.get("/reminders/unsubscribe/:token", run(async (request, response) => {
    const token = param(request, "token");
    const updated = token.length >= 16 ? await prisma.contactPreference.updateMany({ where: { unsubscribeToken: token }, data: { optedOutAt: now(), optOutSource: "email_link" } }) : { count: 0 };
    const message = updated.count ? "You're unsubscribed. Unwhelm won't send you any more reminders. You can turn them back on from the client portal." : "That unsubscribe link isn't valid. It may have been replaced by a newer one.";
    response.status(updated.count ? 200 : 404).type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reminders</title></head><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>Reminders</h1><p>${escapeHtml(message)}</p></body></html>`);
  }));

  /** Inbound SMS (ACS Event Grid SMSReceived or a Twilio webhook). STOP opts out, START opts back in. Guarded by SMS_WEBHOOK_SECRET. */
  router.post("/reminders/sms-inbound", express.urlencoded({ extended: false, limit: "32kb" }), run(async (request, response) => {
    const secret = process.env.SMS_WEBHOOK_SECRET;
    if (!secret || request.query.secret !== secret) throw new HttpError(401, "AUTH_REQUIRED", "The webhook secret is missing or wrong.");
    const raw = request.body as unknown;
    const events = Array.isArray(raw) ? raw as Array<{ eventType?: string; data?: { validationCode?: string; from?: string; message?: string } }> : [];
    const validation = events.find((event) => event.eventType === "Microsoft.EventGrid.SubscriptionValidationEvent");
    if (validation?.data?.validationCode) { response.json({ validationResponse: validation.data.validationCode }); return; }
    const messages: Array<{ from: string; text: string }> = events.length
      ? events.filter((event) => event.data?.from && typeof event.data.message === "string").map((event) => ({ from: String(event.data?.from), text: String(event.data?.message) }))
      : raw && typeof raw === "object" && "From" in raw && "Body" in raw ? [{ from: String((raw as { From: unknown }).From), text: String((raw as { Body: unknown }).Body) }] : [];
    const current = await settings();
    let changed = 0;
    for (const message of messages) {
      const keyword = smsKeyword(message.text, current);
      if (!keyword) continue;
      const result = await prisma.contactPreference.updateMany({ where: { phone: message.from }, data: keyword === "stop" ? { optedOutAt: now(), optOutSource: "sms_stop" } : { optedOutAt: null, optOutSource: null } });
      changed += result.count;
    }
    ok(request, response, { received: messages.length, changed }, changed > 0);
  }));

  const loadOwnProposal = async (principal: Awaited<ReturnType<typeof authorize>>, id: string) => {
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "NOT_FOUND", "The proposal was not found.");
    const proposal = await prisma.proposal.findUnique({ where: { id }, select: { id: true, ownerId: true, organizationId: true, reviewState: true, status: true, validUntil: true } });
    if (!proposal || !canSeeProposal(principal, proposal)) throw new HttpError(404, "NOT_FOUND", "The proposal was not found.");
    return proposal;
  };

  router.get("/proposals/:id/tickler", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:read");
    const proposal = await loadOwnProposal(principal, param(request, "id"));
    ok(request, response, { tickler: await prisma.proposalTickler.findUnique({ where: { proposalId: proposal.id } }) });
  }));

  router.put("/proposals/:id/tickler", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:write");
    const proposal = await loadOwnProposal(principal, param(request, "id"));
    const body = TicklerBody.parse(request.body ?? {});
    if (!["draft", "client_revising"].includes(proposal.reviewState) || proposal.status === "closed") throw new HttpError(409, "NOT_UNFINISHED", "Ticklers are only for proposals that are still being worked on.");
    const option = await prisma.ticklerOption.findFirst({ where: { code: body.option, active: true } });
    if (!option) throw new HttpError(400, "UNKNOWN_OPTION", "That reminder schedule is not offered.");
    const current = await settings();
    const intervalDays = option.code === "weekly" || option.code === "tomorrow_at" ? null : body.intervalDays ?? option.defaultDays ?? 1;
    if (intervalDays !== null && (intervalDays < current.ticklerMinIntervalDays || intervalDays > current.ticklerMaxIntervalDays)) throw new HttpError(400, "INTERVAL_OUT_OF_RANGE", `Pick between ${current.ticklerMinIntervalDays} and ${current.ticklerMaxIntervalDays} days.`);
    if (option.code === "weekly" && (body.weekday === undefined || body.weekday === null)) throw new HttpError(400, "WEEKDAY_REQUIRED", "Weekly reminders need a weekday (0 = Sunday).");
    const preference = await prisma.contactPreference.findUnique({ where: { userId: proposal.ownerId } });
    if (!preference || preference.channel === "none" || preference.optedOutAt) throw new HttpError(409, "NO_CONTACT_PREFERENCE", "Set how to reach the client (unw_set_contact_preference) before scheduling reminders.");
    const timezone = preference.timezone ?? current.defaultTimezone;
    const spec = { optionCode: option.code, intervalDays, weekday: option.code === "weekly" ? body.weekday ?? null : null, timeOfDay: body.timeOfDay ?? current.ticklerDefaultTime };
    const nextAt = nextTicklerAt(spec, now(), timezone);
    const data = { userId: proposal.ownerId, ...spec, nextAt, sentCount: 0, stoppedAt: null, stopReason: null };
    const saved = await prisma.proposalTickler.upsert({ where: { proposalId: proposal.id }, create: { proposalId: proposal.id, ...data }, update: data });
    await writeAudit(prisma, { organizationId: proposal.organizationId, actorUserId: principal.userId, operation: "proposal.tickler.set", method: request.method, path: request.path, recordType: "ProposalTickler", recordId: saved.id, requestId: requestId(request), input: { option: option.code, intervalDays, weekday: spec.weekday, timeOfDay: spec.timeOfDay }, statusCode: 200 });
    await noteGuidanceAction(prisma, { proposalId: proposal.id, sessionId: guidanceSessionId(request, principal.userId, proposal.id), actionTaken: "offer_tickler", chosenMove: "offer_tickler", explicitTrigger: "pause" });
    ok(request, response, { tickler: saved, timezone }, true);
  }));

  router.delete("/proposals/:id/tickler", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:write");
    const proposal = await loadOwnProposal(principal, param(request, "id"));
    const result = await prisma.proposalTickler.updateMany({ where: { proposalId: proposal.id, stoppedAt: null }, data: { stoppedAt: now(), stopReason: "client_stopped", nextAt: null } });
    ok(request, response, { stopped: result.count }, result.count > 0);
  }));

  router.post("/staff/reminders/deliver", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:write", { staff: true });
    const body = DeliverBody.parse(request.body ?? {});
    const at = now();
    const dryRun = body.dryRun === true;
    const sendEnabled = process.env.UNWH_REMINDER_SEND_ENABLED === "1" && process.env.UNWH_REMINDER_DRY_RUN !== "1";
    if (!dryRun && !sendEnabled) throw new HttpError(409, "SEND_DISABLED", "Reminder sending is disabled. Set UNWH_REMINDER_SEND_ENABLED=1 and remove UNWH_REMINDER_DRY_RUN to deliver, or pass dryRun: true to preview.");
    const ticklers = dryRun || body.ticklers === false ? { outcomes: [] } : await runTicklers(store, { now: at });
    const delivered = await deliverReminders(store, senders ?? sendersFromEnv(), { now: at, dryRun });
    const sent = delivered.outcomes.filter((item) => item.status === "sent").length;
    await writeAudit(prisma, { organizationId: principal.organizationId ?? null, actorUserId: principal.userId, operation: "proposal.reminders.deliver", method: request.method, path: request.path, recordType: "ReminderDelivery", recordId: randomUUID(), requestId: requestId(request), input: { ticklers: ticklers.outcomes.length, deliveries: delivered.outcomes.length, sent }, statusCode: 200 });
    ok(request, response, { dryRun, ticklers: ticklers.outcomes, deliveries: delivered.outcomes, sent }, !dryRun && (sent > 0 || ticklers.outcomes.length > 0));
  }));

  router.get("/staff/reminder-deliveries", run(async (request, response) => {
    await authorize(prisma, request, "proposals:read", { staff: true });
    const query = DeliveryQuery.parse(request.query ?? {});
    const reminderIds = query.proposalId ? (await prisma.proposalReminder.findMany({ where: { proposalId: query.proposalId }, select: { id: true } })).map((row) => row.id) : null;
    const items = await prisma.reminderDelivery.findMany({
      where: { ...(query.status ? { status: query.status } : {}), ...(query.userId ? { userId: query.userId } : {}), ...(reminderIds ? { reminderId: { in: reminderIds } } : {}) },
      orderBy: { createdAt: "desc" },
      take: query.limit ?? 100,
    });
    const reminders = await prisma.proposalReminder.findMany({ where: { id: { in: items.map((item) => item.reminderId) } }, select: { id: true, proposalId: true, ruleCode: true, message: true } });
    const byId = new Map(reminders.map((row) => [row.id, row]));
    ok(request, response, { items: items.map((item) => ({ ...item, reminder: byId.get(item.reminderId) ?? null })) });
  }));

  return router;
}
