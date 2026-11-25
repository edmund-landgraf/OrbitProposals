// Delivery and tickler logic with mocked providers and an in-memory store. The database half runs when UNWH_DB_TEST=1 and DATABASE_URL are set.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";
import {
  acsSmsSender, backoffMs, deliverReminders, graphEmailSender, localParts, nextTicklerAt, prismaDeliveryStore, quietUntil, runTicklers, sendersFromEnv, settingsFromRows, smsKeyword, ticklerStopReason, twilioSmsSender,
  type DeliveryRow, type DeliveryStore, type OutboundMessage, type Preference, type QueuedReminder, type Sender, type TicklerContext, type TicklerRow,
} from "../../server/reminderDelivery.js";

const TZ = "America/Los_Angeles";
const settings = settingsFromRows([]);

test("quiet hours wrap midnight and end at the client's local time", () => {
  const late = new Date("2026-10-23T05:30:00Z"); // 22:30 PDT
  assert.equal(quietUntil(late, TZ, "21:00", "08:00")?.toISOString(), "2026-10-23T15:00:00.000Z");
  const early = new Date("2026-10-23T13:00:00Z"); // 06:00 PDT
  assert.equal(quietUntil(early, TZ, "21:00", "08:00")?.toISOString(), "2026-10-23T15:00:00.000Z");
  assert.equal(quietUntil(new Date("2026-10-23T19:00:00Z"), TZ, "21:00", "08:00"), null);
  assert.equal(quietUntil(new Date("2026-10-23T19:00:00Z"), TZ, "12:00", "13:00")?.toISOString(), "2026-10-23T20:00:00.000Z");
  assert.equal(quietUntil(late, TZ, null, null), null);
});

test("backoff doubles from the base row", () => {
  assert.deepEqual([1, 2, 3].map((attempt) => backoffMs(attempt, 15) / 60_000), [15, 30, 60]);
});

test("tickler times follow the client's timezone and schedule", () => {
  const from = new Date("2026-10-23T19:00:00Z"); // Fri 12:00 PDT
  assert.equal(nextTicklerAt({ optionCode: "tomorrow_at", intervalDays: null, weekday: null, timeOfDay: "09:00" }, from, TZ).toISOString(), "2026-10-24T16:00:00.000Z");
  assert.equal(nextTicklerAt({ optionCode: "snooze", intervalDays: 3, weekday: null, timeOfDay: "09:00" }, from, TZ).toISOString(), "2026-10-26T16:00:00.000Z");
  // Crosses the Nov 1 DST change: 09:00 PST is 17:00Z.
  assert.equal(nextTicklerAt({ optionCode: "every_n_days", intervalDays: 10, weekday: null, timeOfDay: "09:00" }, from, TZ).toISOString(), "2026-11-02T17:00:00.000Z");
  assert.equal(nextTicklerAt({ optionCode: "weekly", intervalDays: null, weekday: 1, timeOfDay: "10:30" }, from, TZ).toISOString(), "2026-10-26T17:30:00.000Z");
  // Same weekday, time already passed: next week.
  assert.equal(nextTicklerAt({ optionCode: "weekly", intervalDays: null, weekday: 5, timeOfDay: "09:00" }, from, TZ).toISOString(), "2026-10-30T16:00:00.000Z");
  assert.equal(localParts(from, "Asia/Tokyo").weekday, 6);
});

test("ticklers stop on submit, opt-out, and the max count, and a past deadline does not stop them", () => {
  const now = new Date("2026-10-23T19:00:00Z");
  const base = { reviewState: "draft", status: "draft", hasContract: false, hasHandoff: false, validUntil: null, optedOut: false, channel: "email", sentCount: 0, maxCount: 5, stopAfterExpiry: true, now };
  assert.equal(ticklerStopReason(base), null);
  assert.equal(ticklerStopReason({ ...base, reviewState: "in_review" }), "submitted");
  assert.equal(ticklerStopReason({ ...base, hasHandoff: true }), "handoff");
  assert.equal(ticklerStopReason({ ...base, validUntil: new Date("2026-10-22T00:00:00Z") }), null);
  assert.equal(ticklerStopReason({ ...base, validUntil: new Date("2026-10-22T00:00:00Z"), stopAfterExpiry: false }), null);
  assert.equal(ticklerStopReason({ ...base, optedOut: true }), "opted_out");
  assert.equal(ticklerStopReason({ ...base, channel: "none" }), "opted_out");
  assert.equal(ticklerStopReason({ ...base, sentCount: 5 }), "max_reached");
});

test("SMS keywords come from the setting rows", () => {
  assert.equal(smsKeyword(" stop ", settings), "stop");
  assert.equal(smsKeyword("Unsubscribe.", settings), "stop");
  assert.equal(smsKeyword("start", settings), "start");
  assert.equal(smsKeyword("stop by tomorrow?", settings), null);
  const custom = settingsFromRows([{ code: "sms_stop_words", intValue: null, textValue: "BASTA" }]);
  assert.equal(smsKeyword("basta", custom), "stop");
  assert.equal(smsKeyword("stop", custom), null);
});

type Call = { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } };
const fakeFetch = (responses: Array<{ ok?: boolean; status?: number; body: unknown; headers?: Record<string, string> }>) => {
  const calls: Call[] = [];
  const impl = async (url: string, init: Call["init"] = {}) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { body: {} };
    return { ok: next.ok ?? true, status: next.status ?? 200, text: async () => JSON.stringify(next.body), headers: { get: (name: string) => next.headers?.[name] ?? null } };
  };
  return { calls, impl };
};

test("Graph sends mail as MAIL_FROM with a cached client-credentials token", async () => {
  const fetch = fakeFetch([{ body: { access_token: "tok", expires_in: 3600 } }, { status: 202, body: {}, headers: { "request-id": "r1" } }, { status: 202, body: {} }]);
  const sender = graphEmailSender({ tenantId: "tenant", clientId: "client", clientSecret: "secret", from: "reminders@unwhelm.com" }, fetch.impl);
  const result = await sender.send({ channel: "email", to: "c@example.com", subject: "Hi", text: "Body" });
  await sender.send({ channel: "email", to: "c@example.com", subject: "Hi", text: "Body" });
  assert.equal(result.providerMessageId, "r1");
  assert.equal(fetch.calls.length, 3);
  assert.match(fetch.calls[0]!.url, /login\.microsoftonline\.com\/tenant\/oauth2\/v2\.0\/token/);
  assert.match(fetch.calls[0]!.init.body ?? "", /grant_type=client_credentials/);
  assert.equal(fetch.calls[1]!.url, "https://graph.microsoft.com/v1.0/users/reminders%40unwhelm.com/sendMail");
  assert.equal(fetch.calls[1]!.init.headers?.authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(fetch.calls[1]!.init.body ?? "{}").message.toRecipients, [{ emailAddress: { address: "c@example.com" } }]);
});

test("Graph errors surface the status", async () => {
  const fetch = fakeFetch([{ body: { access_token: "tok", expires_in: 3600 } }, { ok: false, status: 403, body: { error: "ErrorAccessDenied" } }]);
  const sender = graphEmailSender({ tenantId: "t", clientId: "c", clientSecret: "s", from: "a@b.c" }, fetch.impl);
  await assert.rejects(sender.send({ channel: "email", to: "x@y.z", text: "t" }), /Graph sendMail 403/);
});

test("ACS signs SMS requests with HMAC-SHA256", async () => {
  const fetch = fakeFetch([{ status: 202, body: { value: [{ messageId: "m1", successful: true }] } }]);
  const key = Buffer.from("not-a-real-key").toString("base64");
  const sender = acsSmsSender({ connectionString: `endpoint=https://example.communication.azure.com/;accesskey=${key}`, from: "+18005550100" }, fetch.impl, () => new Date("2026-10-23T19:00:00Z"));
  const result = await sender.send({ channel: "sms", to: "+15551234567", text: "Hello" });
  assert.equal(result.providerMessageId, "m1");
  const call = fetch.calls[0]!;
  assert.equal(call.url, "https://example.communication.azure.com/sms?api-version=2021-03-07");
  assert.match(call.init.headers?.authorization ?? "", /^HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=.+/);
  assert.equal(call.init.headers?.["x-ms-date"], "Fri, 23 Oct 2026 19:00:00 GMT");
  assert.deepEqual(JSON.parse(call.init.body ?? "{}").smsRecipients, [{ to: "+15551234567" }]);
});

test("Twilio posts a form with basic auth", async () => {
  const fetch = fakeFetch([{ status: 201, body: { sid: "SM1" } }]);
  const result = await twilioSmsSender({ accountSid: "AC1", authToken: "tok", from: "+18005550100" }, fetch.impl).send({ channel: "sms", to: "+15551234567", text: "Hi" });
  assert.equal(result.providerMessageId, "SM1");
  assert.match(fetch.calls[0]!.init.body ?? "", /To=%2B15551234567/);
});

test("providers come from env and fall back to the log dry run", () => {
  assert.deepEqual(Object.values(sendersFromEnv({})).map((sender) => sender.provider), ["log:email", "log:sms"]);
  const all = { UNWH_REMINDER_SEND_ENABLED: "1", AZURE_TENANT_ID: "t", AZURE_CLIENT_ID: "c", AZURE_CLIENT_SECRET: "s", MAIL_FROM: "a@b.c", ACS_CONNECTION_STRING: "endpoint=https://x.y/;accesskey=eA==", ACS_FROM_NUMBER: "+1800", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+1" };
  assert.deepEqual(Object.values(sendersFromEnv(all)).map((sender) => sender.provider), ["graph", "acs"]);
  assert.equal(sendersFromEnv({ ...all, ACS_CONNECTION_STRING: undefined }).sms.provider, "twilio");
  assert.deepEqual(Object.values(sendersFromEnv({ ...all, UNWH_REMINDER_DRY_RUN: "1" })).map((sender) => sender.provider), ["log:email", "log:sms"]);
  assert.deepEqual(Object.values(sendersFromEnv({ ...all, UNWH_REMINDER_SEND_ENABLED: "0" })).map((sender) => sender.provider), ["log:email", "log:sms"]);
});

// ---------- In-memory store ----------

function memoryStore(input: { reminders: QueuedReminder[]; preferences: Preference[]; ticklers?: TicklerContext[]; progress?: { progress: string; nextStep: string } }) {
  const deliveries: DeliveryRow[] = [];
  const finished = new Map<string, string>();
  const queued: Array<{ proposalId: string; anchorKey: string; message: string }> = [];
  const ticklers = input.ticklers ?? [];
  const store: DeliveryStore = {
    async settings() { return settingsFromRows([{ code: "rate_limit_per_day", intValue: 2, textValue: null }, { code: "max_attempts", intValue: 2, textValue: null }, { code: "tickler_max_count", intValue: 2, textValue: null }]); },
    async channels() { return [{ code: "email", label: "Email", sendsEmail: true, sendsSms: false, sortOrder: 1 }, { code: "sms", label: "SMS", sendsEmail: false, sendsSms: true, sortOrder: 2 }, { code: "both", label: "Both", sendsEmail: true, sendsSms: true, sortOrder: 3 }, { code: "none", label: "None", sendsEmail: false, sendsSms: false, sortOrder: 4 }]; },
    async templates() { return [
      { ruleCode: "near_expiry", channel: "email", subject: "\"{proposal_title}\" expires {expiry_date}", body: "Hi {client_name}, {portal_link} {unsubscribe_link}" },
      { ruleCode: "near_expiry", channel: "sms", subject: null, body: "{proposal_title} {portal_link} Reply STOP" },
      { ruleCode: "tickler", channel: "email", subject: "Pick up {proposal_title}", body: "{progress} Next step: {next_step} {portal_link}" },
    ]; },
    async queuedClientReminders() { return input.reminders.filter((row) => !finished.has(row.id)); },
    async preference(userId) { return input.preferences.find((row) => row.userId === userId) ?? null; },
    async deliveries(reminderId) { return deliveries.filter((row) => row.reminderId === reminderId).map((row) => ({ ...row })); },
    async ensureDelivery(reminderId, userId, channel) {
      let row = deliveries.find((item) => item.reminderId === reminderId && item.channel === channel);
      if (!row) { row = { id: randomUUID(), reminderId, userId, channel, destination: null, provider: null, status: "pending", attempts: 0, nextAttemptAt: null, lastError: null, providerMessageId: null, sentAt: null }; deliveries.push(row); }
      return { ...row };
    },
    async claim(delivery, now) {
      const row = deliveries.find((item) => item.id === delivery.id)!;
      if (row.attempts !== delivery.attempts || !["pending", "deferred"].includes(row.status) || (row.nextAttemptAt && row.nextAttemptAt > now)) return false;
      row.nextAttemptAt = new Date(now.getTime() + 600_000);
      return true;
    },
    async updateDelivery(id, data) { Object.assign(deliveries.find((item) => item.id === id)!, data); },
    async sentReminderCount(userId, since) { return new Set(deliveries.filter((row) => row.userId === userId && row.status === "sent" && row.sentAt && row.sentAt >= since).map((row) => row.reminderId)).size; },
    async finishReminder(id, status) { finished.set(id, status); },
    async progressSummary() { return input.progress ?? null; },
    async dueTicklers(now) { return ticklers.filter((item) => !item.tickler.stoppedAt && item.tickler.nextAt && item.tickler.nextAt <= now); },
    async queueReminder(row) { if (queued.some((item) => item.anchorKey === row.anchorKey)) return false; queued.push(row); return true; },
    async updateTickler(id, data) { Object.assign(ticklers.find((item) => item.tickler.id === id)!.tickler, data); },
    async ruleTemplate() { return "\"{title}\": {progress}"; },
  };
  return { store, deliveries, finished, queued, ticklers };
}

const mockSender = (provider: string, fail: number[] = []) => {
  const sent: OutboundMessage[] = [];
  let call = 0;
  const sender: Sender = { provider, async send(message) { call += 1; if (fail.includes(call)) throw new Error(`boom ${call}`); sent.push(message); return { providerMessageId: `${provider}-${call}` }; } };
  return { sender, sent };
};
const userId = randomUUID();
const pref = (overrides: Partial<Preference> = {}): Preference => ({ userId, channel: "both", email: null, phone: "+15551234567", quietStart: "21:00", quietEnd: "08:00", timezone: TZ, optedOutAt: null, unsubscribeToken: "tok_abcdefghijklmnop", ...overrides });
const reminder = (overrides: Partial<QueuedReminder> = {}): QueuedReminder => ({ id: randomUUID(), proposalId: randomUUID(), ruleCode: "near_expiry", message: "P expires", createdAt: new Date(), userId, userEmail: "client@example.com", clientName: "Ada", proposalTitle: "Ops map", validUntil: new Date("2026-10-27T19:00:00Z"), reviewState: "approved", status: "pending_approval", hasContract: false, hasHandoff: false, ...overrides });
const noon = new Date("2026-10-23T19:00:00Z"); // 12:00 PDT

test("delivers by preference with templates, an unsubscribe link, and STOP copy; repeat runs do not resend", async () => {
  const email = mockSender("mock-email");
  const sms = mockSender("mock-sms");
  const item = reminder();
  const memory = memoryStore({ reminders: [item], preferences: [pref()] });
  const first = await deliverReminders(memory.store, { email: email.sender, sms: sms.sender }, { now: noon });
  assert.deepEqual(first.outcomes.map((row) => `${row.channel}:${row.status}`), ["email:sent", "sms:sent"]);
  assert.equal(email.sent[0]?.to, "client@example.com");
  assert.equal(email.sent[0]?.subject, "\"Ops map\" expires ");
  assert.doesNotMatch(email.sent[0]?.subject ?? "", /October/);
  assert.match(email.sent[0]?.text ?? "", new RegExp(`^Hi Ada, https://unwhelm.com/portal\\?proposal=${item.proposalId} https://unwhelm.com/api/v1/reminders/unsubscribe/tok_abcdefghijklmnop$`));
  assert.match(sms.sent[0]?.text ?? "", /Reply STOP$/);
  assert.equal(memory.finished.get(item.id), "sent");
  await deliverReminders(memory.store, { email: email.sender, sms: sms.sender }, { now: noon });
  assert.equal(email.sent.length + sms.sent.length, 2);
  assert.equal(memory.deliveries.find((row) => row.channel === "email")?.providerMessageId, "mock-email-1");
});

test("opt-out, no preference, and channel none skip and cancel", async () => {
  const email = mockSender("e");
  const items = [reminder(), reminder({ userId: randomUUID() }), reminder()];
  for (const [index, preference] of [pref({ optedOutAt: new Date() }), null, pref({ channel: "none" })].entries()) {
    const memory = memoryStore({ reminders: [items[index]!], preferences: preference ? [preference] : [] });
    const result = await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: noon });
    assert.equal(result.outcomes[0]?.status, "skipped");
    assert.equal(memory.finished.get(items[index]!.id), "cancelled");
  }
  assert.equal(email.sent.length, 0);
});

test("quiet hours defer until they end, then send", async () => {
  const email = mockSender("e");
  const item = reminder();
  const memory = memoryStore({ reminders: [item], preferences: [pref({ channel: "email" })] });
  const night = new Date("2026-10-24T05:00:00Z"); // 22:00 PDT
  const result = await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: night });
  assert.equal(result.outcomes[0]?.reason, "quiet_hours");
  assert.equal(memory.deliveries[0]?.nextAttemptAt?.toISOString(), "2026-10-24T15:00:00.000Z");
  assert.equal((await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: new Date("2026-10-24T10:00:00Z") })).outcomes[0]?.status, "waiting");
  await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: new Date("2026-10-24T15:01:00Z") });
  assert.equal(email.sent.length, 1);
});

test("the daily cap defers extra reminders", async () => {
  const email = mockSender("e");
  const items = [reminder(), reminder(), reminder()];
  const memory = memoryStore({ reminders: items, preferences: [pref({ channel: "email" })] });
  const result = await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: noon });
  assert.deepEqual(result.outcomes.map((row) => row.status), ["sent", "sent", "deferred"]);
  assert.equal(result.outcomes[2]?.reason, "rate_limited");
});

test("failures retry with backoff and stop at max attempts", async () => {
  const email = mockSender("e", [1, 2]);
  const item = reminder();
  const memory = memoryStore({ reminders: [item], preferences: [pref({ channel: "email" })] });
  const first = await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: noon });
  assert.equal(first.outcomes[0]?.status, "retrying");
  assert.equal(memory.deliveries[0]?.nextAttemptAt?.toISOString(), new Date(noon.getTime() + 15 * 60_000).toISOString());
  assert.equal(memory.deliveries[0]?.lastError, "boom 1");
  const second = await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: new Date(noon.getTime() + 16 * 60_000) });
  assert.equal(second.outcomes[0]?.status, "failed");
  assert.equal(memory.deliveries[0]?.attempts, 2);
  assert.equal(memory.finished.get(item.id), "cancelled");
});

const tickler = (overrides: Partial<TicklerRow> = {}): TicklerRow => ({ id: randomUUID(), proposalId: randomUUID(), userId, optionCode: "every_n_days", intervalDays: 2, weekday: null, timeOfDay: "09:00", nextAt: new Date(noon.getTime() - 1000), sentCount: 0, stoppedAt: null, stopReason: null, ...overrides });
const ticklerContext = (row: TicklerRow, overrides: Partial<TicklerContext> = {}): TicklerContext => ({ tickler: row, repeats: row.optionCode === "every_n_days" || row.optionCode === "weekly", title: "Ops map", clientName: "Ada", reviewState: "draft", status: "draft", hasContract: false, hasHandoff: false, validUntil: null, ...overrides });

test("ticklers queue a progress reminder, advance, and stop at the max count", async () => {
  const row = tickler();
  const memory = memoryStore({ reminders: [], preferences: [pref()], ticklers: [ticklerContext(row)], progress: { progress: "9 of 12 parts settled.", nextStep: "Pick a start date." } });
  const first = await runTicklers(memory.store, { now: noon });
  assert.equal(first.outcomes[0]?.result, "queued");
  assert.equal(memory.queued[0]?.message, "\"Ops map\": 9 of 12 parts settled.");
  assert.equal(memory.queued[0]?.anchorKey, `tickler:${row.id}:1`);
  assert.equal(row.nextAt?.toISOString(), "2026-10-25T16:00:00.000Z");
  await runTicklers(memory.store, { now: noon });
  assert.equal(memory.queued.length, 1);
  const later = new Date("2026-10-25T16:00:00Z");
  const second = await runTicklers(memory.store, { now: later });
  assert.equal(second.outcomes[0]?.reason, "max_reached");
  assert.equal(row.stopReason, "max_reached");
  assert.equal(row.nextAt, null);
});

test("one-shot ticklers stop after sending; submitted ones stop without sending; a past deadline does not", async () => {
  const once = tickler({ optionCode: "tomorrow_at", intervalDays: null });
  const submitted = tickler();
  const expired = tickler();
  const memory = memoryStore({ reminders: [], preferences: [pref()], ticklers: [ticklerContext(once), ticklerContext(submitted, { reviewState: "in_review" }), ticklerContext(expired, { validUntil: new Date(noon.getTime() - 1) })] });
  const result = await runTicklers(memory.store, { now: noon });
  assert.deepEqual(result.outcomes.map((row) => `${row.result}:${row.reason ?? ""}`), ["queued:done", "stopped:submitted", "queued:"]);
  assert.equal(memory.queued.length, 2);
  const optedOut = tickler();
  const memory2 = memoryStore({ reminders: [], preferences: [pref({ optedOutAt: new Date() })], ticklers: [ticklerContext(optedOut)] });
  assert.equal((await runTicklers(memory2.store, { now: noon })).outcomes[0]?.reason, "opted_out");
});

test("tickler emails carry the progress summary and skip proposals submitted since queueing", async () => {
  const email = mockSender("e");
  const pending = reminder({ ruleCode: "tickler", reviewState: "draft", status: "draft" });
  const stale = reminder({ ruleCode: "tickler", reviewState: "in_review" });
  const memory = memoryStore({ reminders: [pending, stale], preferences: [pref({ channel: "email" })], progress: { progress: "9 of 12 parts settled.", nextStep: "Pick a start date." } });
  const result = await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: noon });
  assert.deepEqual(result.outcomes.map((row) => row.status), ["sent", "skipped"]);
  assert.match(email.sent[0]?.text ?? "", /^9 of 12 parts settled\. Next step: Pick a start date\. https:\/\/unwhelm\.com\/portal\?proposal=/);
  assert.equal(email.sent[0]?.subject, "Pick up Ops map");
});

test("tickler reminders stop once a handoff is recommended", async () => {
  const email = mockSender("e");
  const handoff = reminder({ ruleCode: "tickler", reviewState: "draft", status: "draft", hasHandoff: true });
  const memory = memoryStore({ reminders: [handoff], preferences: [pref({ channel: "email" })], progress: { progress: "Needs a call.", nextStep: "Wait for a person." } });
  const result = await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: noon });
  assert.equal(result.outcomes[0]?.status, "skipped");
  assert.equal(result.outcomes[0]?.reason, "handoff");
  assert.equal(email.sent.length, 0);
});

// ---------- Database ----------

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;

test("database: preference, tickler, delivery, and idempotent resend", { skip: !url && "set UNWH_DB_TEST=1 and DATABASE_URL" }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `delivery-${randomUUID()}@test.invalid`, displayName: "Delivery test" } });
  const created = await prisma.proposal.create({ data: {
    ownerId: owner.id, title: "Unfinished", engagement: "capped_hours_4", pricingModel: "capped_hours", reviewState: "draft", status: "draft",
    scope: { summary: "Map it.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, currency: "USD" },
  } });
  try {
    assert.ok(await prisma.contactChannel.findUnique({ where: { code: "both" } }));
    assert.ok(await prisma.reminderTemplate.findUnique({ where: { ruleCode_channel: { ruleCode: "tickler", channel: "email" } } }));
    await prisma.contactPreference.create({ data: { userId: owner.id, channel: "email", consentAt: new Date(), quietStart: "21:00", quietEnd: "08:00", timezone: TZ, unsubscribeToken: `test-${randomUUID()}` } });
    await prisma.proposalTickler.create({ data: { proposalId: created.id, userId: owner.id, optionCode: "every_n_days", intervalDays: 2, timeOfDay: "09:00", nextAt: new Date(noon.getTime() - 1000) } });
    const store = prismaDeliveryStore(prisma as never);
    const ticklers = await runTicklers(store, { now: noon });
    assert.ok(ticklers.outcomes.some((row) => row.proposalId === created.id && row.result === "queued"));
    const email = mockSender("mock-email");
    await deliverReminders(store, { email: email.sender, sms: email.sender }, { now: noon });
    await deliverReminders(store, { email: email.sender, sms: email.sender }, { now: noon });
    const mine = email.sent.filter((message) => message.to === owner.email);
    assert.equal(mine.length, 1);
    assert.match(mine[0]?.text ?? "", /Pick up where you left off: https:\/\/unwhelm\.com\/portal\?proposal=/);
    const reminderRow = await prisma.proposalReminder.findFirstOrThrow({ where: { proposalId: created.id, ruleCode: "tickler" } });
    assert.equal(reminderRow.status, "sent");
    const deliveryRows = await prisma.reminderDelivery.findMany({ where: { reminderId: reminderRow.id } });
    assert.deepEqual(deliveryRows.map((row) => [row.channel, row.status, row.attempts, row.provider]), [["email", "sent", 1, "mock-email"]]);
    const stored = await prisma.proposalTickler.findUniqueOrThrow({ where: { proposalId: created.id } });
    assert.equal(stored.sentCount, 1);
    assert.equal(stored.nextAt?.toISOString(), "2026-10-25T16:00:00.000Z");
    await prisma.proposal.update({ where: { id: created.id }, data: { reviewState: "in_review" } });
    const stop = await runTicklers(store, { now: new Date("2026-10-25T16:00:01Z") });
    assert.ok(stop.outcomes.some((row) => row.proposalId === created.id && row.reason === "submitted"));
  } finally {
    await deleteProposalCascade(prisma, created.id);
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});

test("preview respects the daily cap without sending or changing stored state", async () => {
  const email = mockSender("e");
  const memory = memoryStore({ reminders: [reminder(), reminder(), reminder()], preferences: [pref({ channel: "email" })] });
  for (const method of ["ensureDelivery", "claim", "updateDelivery", "finishReminder"] as const) {
    memory.store[method] = async () => { throw new Error(`Preview attempted ${method}`); };
  }
  const result = await deliverReminders(memory.store, { email: email.sender, sms: email.sender }, { now: noon, dryRun: true });
  assert.deepEqual(result.outcomes.map(row => row.status), ["would_send", "would_send", "would_defer"]);
  assert.equal(result.outcomes[2]?.reason, "rate_limited");
  assert.equal(email.sent.length, 0);
  assert.equal(memory.deliveries.length, 0);
  assert.equal(memory.finished.size, 0);
});

test("log-only providers keep deliveries queued instead of marking them sent", async () => {
  const item = reminder();
  const memory = memoryStore({ reminders: [item], preferences: [pref()] });
  const result = await deliverReminders(memory.store, sendersFromEnv({}), { now: noon });
  assert.deepEqual(result.outcomes.map(row => row.status), ["disabled", "disabled"]);
  assert.equal(memory.deliveries.length, 0);
  assert.equal(memory.finished.size, 0);
});

test("preview skips obsolete and opted-out reminders without writing delivery rows", async () => {
  for (const item of [reminder({ status: "closed" }), reminder({ hasContract: true }), reminder({ ruleCode: "tickler", hasHandoff: true })]) {
    const memory = memoryStore({ reminders: [item], preferences: [pref()] });
    const result = await deliverReminders(memory.store, sendersFromEnv({}), { now: noon, dryRun: true });
    assert.equal(result.outcomes[0]?.status, "would_skip");
    assert.equal(memory.deliveries.length, 0);
    assert.equal(memory.finished.size, 0);
  }
});
