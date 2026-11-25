import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { enforcedValidUntil } from "./proposalExpiry.js";
import { renderReminder } from "./proposalReminders.js";
import { prismaCompletionStore } from "./proposalCompletion.js";
import { prismaProgressStore, proposalProgress } from "./proposalProgress.js";

// ---------- Senders ----------

export type OutboundMessage = { channel: "email" | "sms"; to: string; subject?: string | null; text: string };
export type SendResult = { providerMessageId: string | null };
export type Sender = { provider: string; send(message: OutboundMessage): Promise<SendResult> };
export type Senders = { email: Sender; sms: Sender };
type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; headers?: { get(name: string): string | null } }>;
type Env = Record<string, string | undefined>;

/** Dry run: writes only redacted metadata to the log and reports success. The default when sending is disabled or provider env is missing. */
export function logSender(channel: "email" | "sms", log: (line: string) => void = (line) => console.log(line)): Sender {
  return {
    provider: `log:${channel}`,
    async send(message) {
      const subjectLen = message.subject ? message.subject.length : 0;
      log(`[reminder ${message.channel}] redacted subject_len=${subjectLen} text_len=${message.text.length}`);
      return { providerMessageId: null };
    },
  };
}

async function failOnError(response: Awaited<ReturnType<FetchLike>>, label: string) {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(`${label} ${response.status}: ${body.slice(0, 300)}`);
}

/** Microsoft Graph sendMail as MAIL_FROM using client credentials (Mail.Send application permission). */
export function graphEmailSender(env: { tenantId: string; clientId: string; clientSecret: string; from: string }, fetchImpl: FetchLike = fetch as unknown as FetchLike): Sender {
  let cached: { token: string; expiresAt: number } | null = null;
  async function token() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(env.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }).toString(),
    });
    await failOnError(response, "Graph token");
    const json = JSON.parse(await response.text()) as { access_token: string; expires_in: number };
    cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return cached.token;
  }
  return {
    provider: "graph",
    async send(message) {
      const response = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.from)}/sendMail`, {
        method: "POST",
        headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" },
        body: JSON.stringify({ message: { subject: message.subject ?? "", body: { contentType: "Text", content: message.text }, toRecipients: [{ emailAddress: { address: message.to } }] }, saveToSentItems: true }),
      });
      await failOnError(response, "Graph sendMail");
      return { providerMessageId: response.headers?.get("request-id") ?? null };
    },
  };
}

/** Azure Communication Services SMS, HMAC-signed with the connection string's access key. */
export function acsSmsSender(env: { connectionString: string; from: string }, fetchImpl: FetchLike = fetch as unknown as FetchLike, clock: () => Date = () => new Date()): Sender {
  const parts = Object.fromEntries(env.connectionString.split(";").filter(Boolean).map((part) => { const index = part.indexOf("="); return [part.slice(0, index).toLowerCase(), part.slice(index + 1)]; }));
  const endpoint = new URL(parts.endpoint ?? "");
  const key = Buffer.from(parts.accesskey ?? "", "base64");
  return {
    provider: "acs",
    async send(message) {
      const pathAndQuery = "/sms?api-version=2021-03-07";
      const body = JSON.stringify({ from: env.from, smsRecipients: [{ to: message.to }], message: message.text, smsSendOptions: { enableDeliveryReport: true } });
      const date = clock().toUTCString();
      const contentHash = createHash("sha256").update(body).digest("base64");
      const signature = createHmac("sha256", key).update(`POST\n${pathAndQuery}\n${date};${endpoint.host};${contentHash}`).digest("base64");
      const response = await fetchImpl(`${endpoint.origin}${pathAndQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ms-date": date, "x-ms-content-sha256": contentHash, authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}` },
        body,
      });
      await failOnError(response, "ACS SMS");
      const json = JSON.parse(await response.text()) as { value?: Array<{ messageId?: string; successful?: boolean; errorMessage?: string }> };
      const result = json.value?.[0];
      if (result && result.successful === false) throw new Error(`ACS SMS rejected: ${result.errorMessage ?? "unknown"}`);
      return { providerMessageId: result?.messageId ?? null };
    },
  };
}

/** Twilio SMS, the alternative to ACS. */
export function twilioSmsSender(env: { accountSid: string; authToken: string; from: string }, fetchImpl: FetchLike = fetch as unknown as FetchLike): Sender {
  return {
    provider: "twilio",
    async send(message) {
      const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.accountSid)}/Messages.json`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${env.accountSid}:${env.authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: env.from, To: message.to, Body: message.text }).toString(),
      });
      await failOnError(response, "Twilio SMS");
      const json = JSON.parse(await response.text()) as { sid?: string };
      return { providerMessageId: json.sid ?? null };
    },
  };
}

/** Picks providers from env. Anything not configured falls back to the log dry run. UNWH_REMINDER_DRY_RUN=1 forces it. */
export function sendersFromEnv(env: Env = process.env, fetchImpl?: FetchLike): Senders {
  const dry = env.UNWH_REMINDER_DRY_RUN === "1";
  const enabled = env.UNWH_REMINDER_SEND_ENABLED === "1";
  const live = enabled && !dry;
  const email = live && env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET && env.MAIL_FROM
    ? graphEmailSender({ tenantId: env.AZURE_TENANT_ID, clientId: env.AZURE_CLIENT_ID, clientSecret: env.AZURE_CLIENT_SECRET, from: env.MAIL_FROM }, fetchImpl)
    : logSender("email");
  const sms = live && env.ACS_CONNECTION_STRING && env.ACS_FROM_NUMBER ? acsSmsSender({ connectionString: env.ACS_CONNECTION_STRING, from: env.ACS_FROM_NUMBER }, fetchImpl)
    : live && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER ? twilioSmsSender({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM_NUMBER }, fetchImpl)
    : logSender("sms");
  return { email, sms };
}

// ---------- Pure time helpers ----------

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimezone(timezone: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); return true; } catch { return false; }
}

export function localParts(date: Date, timezone: string): LocalParts {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), weekday: WEEKDAYS.indexOf(parts.weekday ?? "Sun") };
}

/** The UTC instant for a wall-clock time in a timezone. Day overflow (day 32) rolls over. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = localParts(new Date(guess), timezone);
    const seenWall = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += wall - seenWall;
  }
  return new Date(guess);
}

export function parseClock(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/** Null when now is outside quiet hours, otherwise when quiet hours end. Handles windows that wrap midnight. */
export function quietUntil(now: Date, timezone: string, start: string | null, end: string | null): Date | null {
  const from = start ? parseClock(start) : null;
  const to = end ? parseClock(end) : null;
  if (!from || !to) return null;
  const local = localParts(now, timezone);
  const minutes = local.hour * 60 + local.minute;
  const startMinutes = from.hour * 60 + from.minute;
  const endMinutes = to.hour * 60 + to.minute;
  if (startMinutes === endMinutes) return null;
  const inside = startMinutes < endMinutes ? minutes >= startMinutes && minutes < endMinutes : minutes >= startMinutes || minutes < endMinutes;
  if (!inside) return null;
  const endsToday = minutes < endMinutes;
  return zonedTime(local.year, local.month, local.day + (endsToday ? 0 : 1), to.hour, to.minute, timezone);
}

export function backoffMs(attempts: number, baseMinutes: number) {
  return baseMinutes * 60_000 * 2 ** Math.max(0, attempts - 1);
}

export type TicklerSpec = { optionCode: string; intervalDays: number | null; weekday: number | null; timeOfDay: string };

/** Next tickler time after `from`, in the client's timezone. tomorrow_at and snooze fire once; every_n_days and weekly repeat. */
export function nextTicklerAt(spec: TicklerSpec, from: Date, timezone: string): Date {
  const clock = parseClock(spec.timeOfDay) ?? { hour: 9, minute: 0 };
  const local = localParts(from, timezone);
  if (spec.optionCode === "weekly") {
    const target = spec.weekday ?? local.weekday;
    let add = (target - local.weekday + 7) % 7;
    let candidate = zonedTime(local.year, local.month, local.day + add, clock.hour, clock.minute, timezone);
    if (candidate.getTime() <= from.getTime()) { add += 7; candidate = zonedTime(local.year, local.month, local.day + add, clock.hour, clock.minute, timezone); }
    return candidate;
  }
  const days = spec.optionCode === "tomorrow_at" ? 1 : Math.max(1, spec.intervalDays ?? 1);
  return zonedTime(local.year, local.month, local.day + days, clock.hour, clock.minute, timezone);
}

export const TICKLER_STATES = ["draft", "client_revising"];

export function ticklerStopReason(input: { reviewState: string; status: string; hasContract: boolean; hasHandoff: boolean; validUntil: Date | null; optedOut: boolean; channel: string | null; sentCount: number; maxCount: number; stopAfterExpiry: boolean; now: Date }): string | null {
  if (input.status === "closed" || input.hasContract || !TICKLER_STATES.includes(input.reviewState)) return "submitted";
  if (input.hasHandoff) return "handoff";
  const deadline = enforcedValidUntil(input.validUntil);
  if (input.stopAfterExpiry && deadline && deadline.getTime() <= input.now.getTime()) return "expired";
  if (input.optedOut || !input.channel || input.channel === "none") return "opted_out";
  if (input.sentCount >= input.maxCount) return "max_reached";
  return null;
}

// ---------- Settings ----------

export type DeliverySettings = {
  maxAttempts: number; backoffBaseMinutes: number; rateLimitPerDay: number;
  defaultQuietStart: string; defaultQuietEnd: string; defaultTimezone: string; portalBaseUrl: string;
  smsStopWords: string[]; smsStartWords: string[];
  ticklerMaxCount: number; ticklerStopAfterExpiry: boolean; ticklerDefaultTime: string; ticklerMinIntervalDays: number; ticklerMaxIntervalDays: number; progressFallback: string; nextStepFallback: string;
};
export type SettingRow = { code: string; intValue: number | null; textValue: string | null };

export function settingsFromRows(rows: readonly SettingRow[]): DeliverySettings {
  const map = new Map(rows.map((row) => [row.code, row]));
  const int = (code: string, fallback: number) => map.get(code)?.intValue ?? fallback;
  const text = (code: string, fallback: string) => map.get(code)?.textValue ?? fallback;
  const words = (code: string, fallback: string) => text(code, fallback).split(",").map((word) => word.trim().toUpperCase()).filter(Boolean);
  return {
    maxAttempts: int("max_attempts", 5), backoffBaseMinutes: int("backoff_base_minutes", 15), rateLimitPerDay: int("rate_limit_per_day", 3),
    defaultQuietStart: text("default_quiet_start", "21:00"), defaultQuietEnd: text("default_quiet_end", "08:00"), defaultTimezone: text("default_timezone", "America/Los_Angeles"),
    portalBaseUrl: text("portal_base_url", "https://unwhelm.com").replace(/\/$/, ""),
    smsStopWords: words("sms_stop_words", "STOP,STOPALL,UNSUBSCRIBE,CANCEL,END,QUIT"), smsStartWords: words("sms_start_words", "START,UNSTOP"),
    ticklerMaxCount: int("tickler_max_count", 5), ticklerStopAfterExpiry: int("tickler_stop_after_expiry", 1) === 1, ticklerDefaultTime: text("tickler_default_time", "09:00"),
    ticklerMinIntervalDays: int("tickler_min_interval_days", 1), ticklerMaxIntervalDays: int("tickler_max_interval_days", 30),
    progressFallback: text("progress_fallback", "Your proposal is saved where you left it."), nextStepFallback: text("next_step_fallback", "Open the proposal and keep going."),
  };
}

export function smsKeyword(text: string, settings: DeliverySettings): "stop" | "start" | null {
  const word = text.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (settings.smsStopWords.includes(word)) return "stop";
  if (settings.smsStartWords.includes(word)) return "start";
  return null;
}

export const newUnsubscribeToken = () => randomBytes(24).toString("base64url");
export const portalLink = (settings: DeliverySettings, proposalId: string) => `${settings.portalBaseUrl}/portal?proposal=${encodeURIComponent(proposalId)}`;
export const unsubscribeLink = (settings: DeliverySettings, token: string) => `${settings.portalBaseUrl}/api/v1/reminders/unsubscribe/${encodeURIComponent(token)}`;

// ---------- Store ----------

export type Preference = { userId: string; channel: string; email: string | null; phone: string | null; quietStart: string | null; quietEnd: string | null; timezone: string | null; optedOutAt: Date | null; unsubscribeToken: string };
export type ChannelRow = { code: string; label: string; sendsEmail: boolean; sendsSms: boolean; sortOrder: number };
export type TemplateRow = { ruleCode: string; channel: string; subject: string | null; body: string };
export type QueuedReminder = { id: string; proposalId: string; ruleCode: string; message: string; createdAt: Date; userId: string; userEmail: string; clientName: string; proposalTitle: string; validUntil: Date | null; reviewState: string; status: string; hasContract: boolean; hasHandoff: boolean };
export type DeliveryRow = { id: string; reminderId: string; userId: string | null; channel: string; destination: string | null; provider: string | null; status: string; attempts: number; nextAttemptAt: Date | null; lastError: string | null; providerMessageId: string | null; sentAt: Date | null };
export type TicklerRow = { id: string; proposalId: string; userId: string; optionCode: string; intervalDays: number | null; weekday: number | null; timeOfDay: string; nextAt: Date | null; sentCount: number; stoppedAt: Date | null; stopReason: string | null };
export type TicklerContext = { tickler: TicklerRow; repeats: boolean; title: string; clientName: string; reviewState: string; status: string; hasContract: boolean; hasHandoff: boolean; validUntil: Date | null };

export type DeliveryStore = {
  settings(): Promise<DeliverySettings>;
  channels(): Promise<ChannelRow[]>;
  templates(): Promise<TemplateRow[]>;
  queuedClientReminders(): Promise<QueuedReminder[]>;
  preference(userId: string): Promise<Preference | null>;
  deliveries(reminderId: string): Promise<DeliveryRow[]>;
  ensureDelivery(reminderId: string, userId: string, channel: string): Promise<DeliveryRow>;
  /** Atomically takes a delivery for one attempt. False when another run already did. */
  claim(delivery: DeliveryRow, now: Date): Promise<boolean>;
  updateDelivery(id: string, data: Partial<DeliveryRow>): Promise<void>;
  sentReminderCount(userId: string, since: Date): Promise<number>;
  finishReminder(id: string, status: "sent" | "cancelled", at: Date): Promise<void>;
  progressSummary(proposalId: string, userId: string): Promise<{ progress: string; nextStep: string } | null>;
  dueTicklers(now: Date): Promise<TicklerContext[]>;
  queueReminder(input: { proposalId: string; ruleCode: string; audience: string; anchorKey: string; message: string }): Promise<boolean>;
  updateTickler(id: string, data: Partial<TicklerRow>): Promise<void>;
  ruleTemplate(code: string): Promise<string | null>;
};

// ---------- Runs ----------

export type DeliveryOutcome = { reminderId: string; channel: string; status: string; reason?: string };

const TERMINAL = new Set(["sent", "failed", "skipped"]);

/** Sends queued client reminders. Respects preference, opt-out, quiet hours, and the daily cap; retries with backoff; idempotent per reminder and channel. */
export async function deliverReminders(store: DeliveryStore, senders: Senders, options: { now?: Date; dryRun?: boolean } = {}): Promise<{ outcomes: DeliveryOutcome[]; dryRun: boolean }> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const [settings, channels, templates, reminders] = await Promise.all([store.settings(), store.channels(), store.templates(), store.queuedClientReminders()]);
  const channelByCode = new Map(channels.map((row) => [row.code, row]));
  const outcomes: DeliveryOutcome[] = [];
  const previewCounts = new Map<string, number>();
  for (const reminder of reminders) {
    const preference = await store.preference(reminder.userId);
    const channelRow = preference ? channelByCode.get(preference.channel) : undefined;
    const wanted: Array<"email" | "sms"> = [];
    if (channelRow?.sendsEmail) wanted.push("email");
    if (channelRow?.sendsSms) wanted.push("sms");
    let skipReason: string | null = null;
    if (reminder.status === "closed" || reminder.hasContract) skipReason = "resolved";
    else if (!preference) skipReason = "no_preference";
    else if (preference.optedOutAt) skipReason = "opted_out";
    else if (!wanted.length) skipReason = "channel_none";
    else if (reminder.ruleCode === "tickler" && reminder.hasHandoff) skipReason = "handoff";
    else if (reminder.ruleCode === "tickler" && !TICKLER_STATES.includes(reminder.reviewState)) skipReason = "submitted";
    if (skipReason) {
      const channel = wanted[0] ?? "email";
      if (!dryRun) {
        const delivery = await store.ensureDelivery(reminder.id, reminder.userId, channel);
        if (!TERMINAL.has(delivery.status)) await store.updateDelivery(delivery.id, { status: "skipped", lastError: skipReason, nextAttemptAt: null });
        await store.finishReminder(reminder.id, "cancelled", now);
      }
      outcomes.push({ reminderId: reminder.id, channel, status: dryRun ? "would_skip" : "skipped", reason: skipReason });
      continue;
    }
    const pref = preference as Preference;
    const timezone = pref.timezone && isValidTimezone(pref.timezone) ? pref.timezone : settings.defaultTimezone;
    const quiet = quietUntil(now, timezone, pref.quietStart ?? settings.defaultQuietStart, pref.quietEnd ?? settings.defaultQuietEnd);
    const priorSent = (await store.sentReminderCount(reminder.userId, new Date(now.getTime() - 86_400_000))) + (previewCounts.get(reminder.userId) ?? 0);
    const alreadyCounted = (await store.deliveries(reminder.id)).some((row) => row.status === "sent");
    let sentNow = false;
    const deadline = enforcedValidUntil(reminder.validUntil);
    const values = {
      client_name: reminder.clientName, proposal_title: reminder.proposalTitle, title: reminder.proposalTitle,
      portal_link: portalLink(settings, reminder.proposalId), unsubscribe_link: unsubscribeLink(settings, pref.unsubscribeToken),
      expiry_date: deadline ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "long" }).format(deadline) : "",
      days: deadline ? Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000)) : "",
      progress: "", next_step: "",
    };
    if (templates.some((row) => row.ruleCode === reminder.ruleCode && /\{(progress|next_step)\}/.test(row.body))) {
      const summary = await store.progressSummary(reminder.proposalId, reminder.userId).catch(() => null);
      values.progress = summary?.progress || settings.progressFallback;
      values.next_step = summary?.nextStep || settings.nextStepFallback;
    }
    for (const channel of wanted) {
      const existing = (await store.deliveries(reminder.id)).find((row) => row.channel === channel);
      const delivery = existing ?? { id: "", reminderId: reminder.id, userId: reminder.userId, channel, destination: null, provider: null, status: "pending", attempts: 0, nextAttemptAt: null, lastError: null, providerMessageId: null, sentAt: null };
      if (TERMINAL.has(delivery.status)) { outcomes.push({ reminderId: reminder.id, channel, status: dryRun ? "already_terminal" : delivery.status }); continue; }
      if (delivery.nextAttemptAt && delivery.nextAttemptAt.getTime() > now.getTime()) { outcomes.push({ reminderId: reminder.id, channel, status: "waiting" }); continue; }
      const destination = channel === "email" ? pref.email ?? reminder.userEmail : pref.phone;
      if (!destination) {
        if (!dryRun && delivery.id) await store.updateDelivery(delivery.id, { status: "skipped", lastError: "no_destination", nextAttemptAt: null });
        else if (!dryRun && !delivery.id) {
          const created = await store.ensureDelivery(reminder.id, reminder.userId, channel);
          await store.updateDelivery(created.id, { status: "skipped", lastError: "no_destination", nextAttemptAt: null });
        }
        outcomes.push({ reminderId: reminder.id, channel, status: dryRun ? "would_skip" : "skipped", reason: "no_destination" });
        continue;
      }
      if (quiet) {
        if (!dryRun && delivery.id) await store.updateDelivery(delivery.id, { status: "deferred", lastError: "quiet_hours", nextAttemptAt: quiet, destination });
        else if (!dryRun && !delivery.id) {
          const created = await store.ensureDelivery(reminder.id, reminder.userId, channel);
          await store.updateDelivery(created.id, { status: "deferred", lastError: "quiet_hours", nextAttemptAt: quiet, destination });
        }
        outcomes.push({ reminderId: reminder.id, channel, status: dryRun ? "would_defer" : "deferred", reason: "quiet_hours" });
        continue;
      }
      if (!alreadyCounted && !sentNow && priorSent >= settings.rateLimitPerDay) {
        if (!dryRun && delivery.id) await store.updateDelivery(delivery.id, { status: "deferred", lastError: "rate_limited", nextAttemptAt: new Date(now.getTime() + 60 * 60_000), destination });
        else if (!dryRun && !delivery.id) {
          const created = await store.ensureDelivery(reminder.id, reminder.userId, channel);
          await store.updateDelivery(created.id, { status: "deferred", lastError: "rate_limited", nextAttemptAt: new Date(now.getTime() + 60 * 60_000), destination });
        }
        outcomes.push({ reminderId: reminder.id, channel, status: dryRun ? "would_defer" : "deferred", reason: "rate_limited" });
        continue;
      }
      if (dryRun) { outcomes.push({ reminderId: reminder.id, channel, status: "would_send" }); sentNow = true; continue; }
      if (senders[channel].provider.startsWith("log:")) { outcomes.push({ reminderId: reminder.id, channel, status: "disabled", reason: "provider_not_configured" }); continue; }
      const ensured = delivery.id ? delivery : await store.ensureDelivery(reminder.id, reminder.userId, channel);
      if (!(await store.claim(ensured, now))) { outcomes.push({ reminderId: reminder.id, channel, status: "claimed_elsewhere" }); continue; }
      const attempts = ensured.attempts + 1;
      const template = templates.find((row) => row.ruleCode === reminder.ruleCode && row.channel === channel);
      const text = template ? renderReminder(template.body, values) : channel === "email" ? `${reminder.message}\n\n${values.portal_link}\n\nUnsubscribe: ${values.unsubscribe_link}` : `${reminder.message} ${values.portal_link} Reply STOP to opt out.`;
      const subject = channel === "email" ? (template?.subject ? renderReminder(template.subject, values) : reminder.proposalTitle) : null;
      const sender = senders[channel];
      try {
        const result = await sender.send({ channel, to: destination, subject, text });
        await store.updateDelivery(ensured.id, { status: "sent", attempts, sentAt: now, provider: sender.provider, providerMessageId: result.providerMessageId, destination, lastError: null, nextAttemptAt: null });
        outcomes.push({ reminderId: reminder.id, channel, status: "sent" });
        sentNow = true;
      } catch (error) {
        const failed = attempts >= settings.maxAttempts;
        const message = error instanceof Error ? error.message : String(error);
        await store.updateDelivery(ensured.id, { status: failed ? "failed" : "deferred", attempts, provider: sender.provider, destination, lastError: message.slice(0, 1000), nextAttemptAt: failed ? null : new Date(now.getTime() + backoffMs(attempts, settings.backoffBaseMinutes)) });
        outcomes.push({ reminderId: reminder.id, channel, status: failed ? "failed" : "retrying", reason: message });
      }
    }
    if (dryRun && sentNow && !alreadyCounted) previewCounts.set(reminder.userId, (previewCounts.get(reminder.userId) ?? 0) + 1);
    if (!dryRun) {
      const rows = await store.deliveries(reminder.id);
      const relevant = rows.filter((row) => wanted.includes(row.channel as "email" | "sms"));
      if (relevant.length === wanted.length && relevant.every((row) => TERMINAL.has(row.status))) {
        await store.finishReminder(reminder.id, relevant.some((row) => row.status === "sent") ? "sent" : "cancelled", now);
      }
    }
  }
  return { outcomes, dryRun };
}

export type TicklerOutcome = { ticklerId: string; proposalId: string; result: "queued" | "stopped"; reason?: string; nextAt?: string | null };

/** Queues due ticklers as `tickler` reminders, advances or stops them. Stops on submit, opt-out, or the max count. A stored proposal deadline does not stop a tickler. */
export async function runTicklers(store: DeliveryStore, options: { now?: Date } = {}): Promise<{ outcomes: TicklerOutcome[] }> {
  const now = options.now ?? new Date();
  const settings = await store.settings();
  const template = (await store.ruleTemplate("tickler")) ?? "\"{title}\": {progress}";
  const outcomes: TicklerOutcome[] = [];
  for (const context of await store.dueTicklers(now)) {
    const { tickler } = context;
    const preference = await store.preference(tickler.userId);
    const stop = ticklerStopReason({ reviewState: context.reviewState, status: context.status, hasContract: context.hasContract, hasHandoff: context.hasHandoff, validUntil: context.validUntil, optedOut: Boolean(preference?.optedOutAt), channel: preference?.channel ?? null, sentCount: tickler.sentCount, maxCount: settings.ticklerMaxCount, stopAfterExpiry: settings.ticklerStopAfterExpiry, now });
    if (stop) {
      await store.updateTickler(tickler.id, { stoppedAt: now, stopReason: stop, nextAt: null });
      outcomes.push({ ticklerId: tickler.id, proposalId: tickler.proposalId, result: "stopped", reason: stop });
      continue;
    }
    const summary = await store.progressSummary(tickler.proposalId, tickler.userId).catch(() => null);
    const sentCount = tickler.sentCount + 1;
    await store.queueReminder({ proposalId: tickler.proposalId, ruleCode: "tickler", audience: "client", anchorKey: `tickler:${tickler.id}:${sentCount}`, message: renderReminder(template, { title: context.title, progress: summary?.progress || settings.progressFallback, next_step: summary?.nextStep || settings.nextStepFallback }) });
    const timezone = preference?.timezone && isValidTimezone(preference.timezone) ? preference.timezone : settings.defaultTimezone;
    const done = !context.repeats ? "done" : sentCount >= settings.ticklerMaxCount ? "max_reached" : null;
    const nextAt = done ? null : nextTicklerAt(tickler, now, timezone);
    await store.updateTickler(tickler.id, { sentCount, nextAt, ...(done ? { stoppedAt: now, stopReason: done } : {}) });
    outcomes.push({ ticklerId: tickler.id, proposalId: tickler.proposalId, result: "queued", nextAt: nextAt?.toISOString() ?? null, ...(done ? { reason: done } : {}) });
  }
  return { outcomes };
}

// ---------- Prisma store ----------

const deliverySelect = { id: true, reminderId: true, userId: true, channel: true, destination: true, provider: true, status: true, attempts: true, nextAttemptAt: true, lastError: true, providerMessageId: true, sentAt: true } as const;

export function prismaDeliveryStore(prisma: PrismaClient): DeliveryStore {
  const completion = prismaCompletionStore(prisma);
  const progress = prismaProgressStore(prisma);
  return {
    async settings() { return settingsFromRows(await prisma.reminderDeliverySetting.findMany()); },
    async channels() { return prisma.contactChannel.findMany({ orderBy: { sortOrder: "asc" } }); },
    async templates() { return prisma.reminderTemplate.findMany(); },
    async queuedClientReminders() {
      const rows = await prisma.proposalReminder.findMany({ where: { status: "queued", audience: "client" }, orderBy: { createdAt: "asc" }, take: 500 });
      if (!rows.length) return [];
      const proposalIds = [...new Set(rows.map((row) => row.proposalId))];
      const proposals = await prisma.proposal.findMany({ where: { id: { in: proposalIds } }, select: { id: true, title: true, status: true, reviewState: true, validUntil: true, owner: { select: { id: true, email: true, displayName: true } }, _count: { select: { contracts: true } } } });
      const handoffCounts = await prisma.proposalHandoff.groupBy({ by: ["proposalId"], where: { proposalId: { in: proposalIds }, clearedAt: null }, _count: { proposalId: true } });
      const hasHandoff = new Set(handoffCounts.filter((row) => row._count.proposalId > 0).map((row) => row.proposalId));
      const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
      return rows.flatMap((row) => {
        const proposal = byId.get(row.proposalId);
        if (!proposal) return [];
        return [{ id: row.id, proposalId: row.proposalId, ruleCode: row.ruleCode, message: row.message, createdAt: row.createdAt, userId: proposal.owner.id, userEmail: proposal.owner.email, clientName: proposal.owner.displayName, proposalTitle: proposal.title, validUntil: proposal.validUntil, reviewState: proposal.reviewState, status: proposal.status, hasContract: proposal._count.contracts > 0, hasHandoff: hasHandoff.has(proposal.id) }];
      });
    },
    async preference(userId) { return prisma.contactPreference.findUnique({ where: { userId } }); },
    async deliveries(reminderId) { return prisma.reminderDelivery.findMany({ where: { reminderId }, select: deliverySelect }); },
    async ensureDelivery(reminderId, userId, channel) {
      await prisma.reminderDelivery.createMany({ data: [{ reminderId, userId, channel }], skipDuplicates: true });
      return prisma.reminderDelivery.findUniqueOrThrow({ where: { reminderId_channel: { reminderId, channel } }, select: deliverySelect });
    },
    async claim(delivery, now) {
      const claimed = await prisma.reminderDelivery.updateMany({
        where: { id: delivery.id, attempts: delivery.attempts, status: { in: ["pending", "deferred"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        data: { status: "pending", nextAttemptAt: new Date(now.getTime() + 10 * 60_000) },
      });
      return claimed.count === 1;
    },
    async updateDelivery(id, data) { await prisma.reminderDelivery.update({ where: { id }, data }); },
    async sentReminderCount(userId, since) {
      const rows = await prisma.reminderDelivery.findMany({ where: { userId, status: "sent", sentAt: { gte: since } }, select: { reminderId: true }, distinct: ["reminderId"] });
      return rows.length;
    },
    async finishReminder(id, status, at) { await prisma.proposalReminder.updateMany({ where: { id, status: "queued" }, data: { status, sentAt: status === "sent" ? at : null } }); },
    async progressSummary(proposalId, userId) {
      const view = await proposalProgress(completion, progress, proposalId, userId);
      if (!view.total) return null;
      return { progress: view.headline, nextStep: view.nextStep.text };
    },
    async dueTicklers(now) {
      const ticklers = await prisma.proposalTickler.findMany({ where: { stoppedAt: null, nextAt: { lte: now } }, orderBy: { nextAt: "asc" }, take: 500 });
      if (!ticklers.length) return [];
      const proposalIds = ticklers.map((row) => row.proposalId);
      const [proposals, options] = await Promise.all([
        prisma.proposal.findMany({ where: { id: { in: proposalIds } }, select: { id: true, title: true, status: true, reviewState: true, validUntil: true, owner: { select: { displayName: true } }, _count: { select: { contracts: true } } } }),
        prisma.ticklerOption.findMany(),
      ]);
      const handoffCounts = await prisma.proposalHandoff.groupBy({ by: ["proposalId"], where: { proposalId: { in: proposalIds }, clearedAt: null }, _count: { proposalId: true } });
      const hasHandoff = new Set(handoffCounts.filter((row) => row._count.proposalId > 0).map((row) => row.proposalId));
      const byId = new Map(proposals.map((proposal) => [proposal.id, proposal]));
      const repeats = new Map(options.map((option) => [option.code, option.repeats]));
      return ticklers.flatMap((tickler) => {
        const proposal = byId.get(tickler.proposalId);
        return proposal ? [{ tickler, repeats: repeats.get(tickler.optionCode) ?? false, title: proposal.title, clientName: proposal.owner.displayName, reviewState: proposal.reviewState, status: proposal.status, hasContract: proposal._count.contracts > 0, hasHandoff: hasHandoff.has(proposal.id), validUntil: proposal.validUntil }] : [];
      });
    },
    async queueReminder(input) {
      const result = await prisma.proposalReminder.createMany({ data: [input], skipDuplicates: true });
      return result.count === 1;
    },
    async updateTickler(id, data) { await prisma.proposalTickler.update({ where: { id }, data }); },
    async ruleTemplate(code) { return (await prisma.reminderRule.findUnique({ where: { code } }))?.messageTemplate ?? null; },
  };
}

/** Stops a proposal's tickler, e.g. when the client submits. */
export async function stopTickler(prisma: PrismaClient, proposalId: string, reason: string, now = new Date()) {
  await prisma.proposalTickler.updateMany({ where: { proposalId, stoppedAt: null }, data: { stoppedAt: now, stopReason: reason, nextAt: null } });
}
