import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { describeRefusal, describeResult, summaryLine } from "../shared/tryFormat.js";
import { deleteProposalCascade } from "./routes/admin.js";

/**
 * Guided public "Try me" demo. A visitor starts a run; the API creates a
 * throwaway sandbox org, client user, MCP client, and short-lived token, then
 * runs the script from rows: try_me 1..n try_me_task 1..n try_me_task_call.
 * Each call is recorded in try_me_session_call and linked to the agent_trace row
 * unwh-mcp wrote for it. No LLM is involved.
 */


export class DemoError extends Error {
  constructor(public status: number, public code: string, message: string, public headers: Record<string, string> = {}) { super(message); }
}

const DEMO_RATE_WINDOW_MS = 3_600_000;
/** Rate-limit headers for a throttled demo start: the window frees a slot when its oldest start ages out. */
export function demoRateLimitHeaders(oldestStart: Date, now: Date, limit: number): Record<string, string> {
  const resetAt = oldestStart.getTime() + DEMO_RATE_WINDOW_MS;
  const seconds = String(Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)));
  return { "Retry-After": seconds, "RateLimit-Limit": String(limit), "RateLimit-Remaining": "0", "RateLimit-Reset": seconds, "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)) };
}

export async function demoSettings(prisma: PrismaClient) {
  const rows = await prisma.tryMeSetting.findMany();
  const get = (code: string) => {
    const row = rows.find((r) => r.code === code);
    if (!row) throw new Error(`try_me_setting ${code} is missing. Run db:migrate.`);
    return row.value;
  };
  return { enabled: get("enabled") === 1, ttlMinutes: get("ttl_minutes"), maxStartsPerIpPerHour: get("max_starts_per_ip_per_hour"), maxActive: get("max_active_sessions"), stepDelayMs: get("step_delay_ms") };
}

export const hashIp = (ip: string) => createHash("sha256").update(`unwh-demo:${ip}`).digest("hex");

const pick = (value: unknown, path: string) => path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), value);
export function fillArgs(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === "string") return value.replace(/\{(\w+)\}/g, (_, key: string) => { if (!(key in vars)) throw new Error(`Nothing captured for {${key}} yet.`); return vars[key]; });
  if (Array.isArray(value)) return value.map((item) => fillArgs(item, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillArgs(v, vars)]));
  return value;
}

/** One JSON-RPC tools/call against the stateless unwh-mcp endpoint. Handles a JSON or SSE reply. */
export async function callMcpTool(mcpUrl: string, bearer: string, name: string, args: unknown, id: number) {
  let response: Response;
  try {
  response = await fetch(mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${bearer}`, "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args, _meta: {} } }),
  });
  } catch (error) {
    // Node's fetch only says "fetch failed"; the useful part (ECONNREFUSED, ENOTFOUND, ...) is on error.cause.
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    let where = mcpUrl;
    try { const u = new URL(mcpUrl); where = u.host + u.pathname; } catch { /* keep raw */ }
    throw new Error(`Could not reach Unwhelm's MCP server at ${where} (${cause?.code ?? cause?.message ?? (error instanceof Error ? error.message : "network error")}). Is unwh-mcp running? Set UNWH_DEMO_MCP_URL if it listens elsewhere.`);
  }
  const text = await response.text();
  let message: unknown;
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try { const parsed = JSON.parse(line.slice(5).trim()); if ((parsed as { id?: unknown }).id === id) message = parsed; } catch { /* keep looking */ }
    }
  } else {
    try { message = JSON.parse(text); } catch { /* not JSON */ }
  }
  if (!message) throw new Error(`MCP server replied ${response.status} with no result.`);
  const rpc = message as { error?: { message?: string }; result?: { isError?: boolean; structuredContent?: unknown; content?: Array<{ type: string; text?: string }> } };
  if (rpc.error) throw new Error(rpc.error.message ?? "MCP error");
  const result = rpc.result ?? {};
  let structured = result.structuredContent;
  if (structured === undefined) {
    const firstText = result.content?.find((part) => part.type === "text")?.text;
    try { structured = firstText ? JSON.parse(firstText) : undefined; } catch { structured = firstText; }
  }
  const errorText = result.isError ? (result.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join(" ").slice(0, 500) : null;
  return { isError: Boolean(result.isError), structured, errorText };
}

function summarize(toolName: string, structured: unknown): string { return summaryLine(describeResult(toolName, structured)); }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tokenHash = (raw: string) => createHash("sha256").update(raw).digest("hex");
/** Built-in template values every plan may use. {zeroId} is a valid uuid that matches nothing. */
const builtInVars = { zeroId: "00000000-0000-0000-0000-000000000000" };

const planInclude = { tasks: { where: { active: true }, orderBy: { seq: "asc" as const }, include: { calls: { where: { active: true }, orderBy: { seq: "asc" as const } } } } };

/** Loads a plan with its ordered tasks and calls. With no code, the first active plan by sort. */
export async function loadPlan(prisma: PrismaClient, code?: string) {
  const plan = await prisma.tryMe.findFirst({ where: { active: true, ...(code ? { code } : {}) }, orderBy: [{ sort: "asc" }, { code: "asc" }], include: planInclude });
  if (!plan) return null;
  return { ...plan, tasks: plan.tasks.filter((t) => t.calls.length > 0) };
}

/** The dropdown: one entry per active try_me row. */
export async function listPlans(prisma: PrismaClient) {
  const plans = await prisma.tryMe.findMany({ where: { active: true }, orderBy: [{ sort: "asc" }, { code: "asc" }], include: planInclude });
  return plans.map((p) => {
    const tasks = p.tasks.filter((t) => t.calls.length > 0);
    return { code: p.code, title: p.title, description: p.description, taskCount: tasks.length, callCount: tasks.reduce((n, t) => n + t.calls.length, 0), tasks: tasks.map((t) => ({ seq: t.seq, title: t.title, toolNames: t.calls.map((c) => c.toolName) })) };
  });
}

/** The Try me help guide: active exercises, each with the MCP tools it uses. */
export async function listGuide(prisma: PrismaClient) {
  const rows = await prisma.tryMeExercise.findMany({ where: { active: true }, include: { tools: true }, orderBy: { sort: "asc" } });
  return rows.map((row) => ({ code: row.code, title: row.title, goal: row.goal, prompt: row.prompt, tools: row.tools.map((t) => t.toolName).sort() }));
}

/** Every tool name the active plans call. Used by the coverage test. */
export async function coveredTools(prisma: PrismaClient) {
  const calls = await prisma.tryMeTaskCall.findMany({ where: { active: true, task: { active: true, tryMe: { active: true } } }, select: { toolName: true } });
  return [...new Set(calls.map((c) => c.toolName))].sort();
}

type Session = { id: string; status: string; tokenId: string | null; expiresAt: Date; purgedAt: Date | null; nextTaskSeq: number | null; tryMeCode: string };

/** Runs one task's calls in order. Pauses the session after it, or completes it after the last task. */
async function runTask(prisma: PrismaClient, mcpUrl: string, raw: string, sessionId: string, delayMs: number) {
  const session = await prisma.tryMeSession.findUniqueOrThrow({ where: { id: sessionId } });
  const plan = await loadPlan(prisma, session.tryMeCode);
  const task = plan?.tasks.find((t) => t.seq === session.nextTaskSeq);
  if (!plan || !task) { await prisma.tryMeSession.update({ where: { id: sessionId }, data: { status: "complete", nextTaskSeq: null, finishedAt: new Date() } }); return; }
  const vars: Record<string, string> = { ...builtInVars, ...((session.vars ?? {}) as Record<string, string>) };
  let current: string | null = null;
  try {
    for (const [index, call] of task.calls.entries()) {
      current = call.id;
      const where = { sessionId_callId: { sessionId, callId: call.id } };
      let args: unknown;
      try { args = fillArgs(call.arguments, vars); } catch (error) {
        await prisma.tryMeSessionCall.update({ where, data: { status: "skipped", summary: error instanceof Error ? error.message : String(error), finishedAt: new Date() } });
        continue;
      }
      await prisma.tryMeSessionCall.update({ where, data: { status: "running", startedAt: new Date() } });
      const started = performance.now();
      let out: { isError: boolean; structured: unknown; errorText: string | null };
      try { out = await callMcpTool(mcpUrl, raw, call.toolName, args, Date.now() % 1_000_000 + index); } catch (error) { out = { isError: true, structured: undefined, errorText: error instanceof Error ? error.message : String(error) }; }
      const durationMs = Math.round(performance.now() - started);
      for (const [key, path] of Object.entries((call.capture ?? {}) as Record<string, string>)) {
        const value = pick(out.structured, path);
        if (!out.isError && typeof value === "string") vars[key] = value;
      }
      const status = out.isError ? (call.expect === "ok" ? "error" : "refused") : call.expect === "refused" ? "unexpected" : "ok";
      const summary = out.isError ? (status === "refused" ? describeRefusal(out.errorText) : (out.errorText ?? "The tool returned an error.")) : status === "unexpected" ? "This call should have been refused." : summarize(call.toolName, out.structured) ?? null;
      // The response as the agent saw it: the tool's result, or its error body for a refused or failed call.
      const result = (out.structured !== undefined ? out.structured : { error: out.errorText ?? "The tool returned an error." }) as Prisma.InputJsonValue;
      await prisma.tryMeSessionCall.update({ where, data: { status, summary, durationMs, result, finishedAt: new Date() } });
      current = null;
      if (index < task.calls.length - 1 && delayMs > 0) await sleep(delayMs);
    }
    const next = plan.tasks.find((t) => t.seq > task.seq);
    const { zeroId: _zero, ...captured } = vars;
    await prisma.tryMeSession.update({ where: { id: sessionId }, data: { vars: captured, proposalId: captured.proposalId ?? null, ...(next ? { status: "paused", nextTaskSeq: next.seq } : { status: "complete", nextTaskSeq: null, finishedAt: new Date() }) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (current) await prisma.tryMeSessionCall.update({ where: { sessionId_callId: { sessionId, callId: current } }, data: { status: "error", summary: message, finishedAt: new Date() } }).catch(() => undefined);
    await prisma.tryMeSession.update({ where: { id: sessionId }, data: { status: "failed", errorMessage: message, finishedAt: new Date() } }).catch(() => undefined);
  }
}

/**
 * Creates the sandbox, runs the plan's first task, and pauses. Returns the raw sandbox token once:
 * the visitor needs it to continue, and to take over from their own MCP client. Only its hash is stored.
 */
export async function startDemo(prisma: PrismaClient, options: { ip: string; mcpUrl: string; planCode?: string; now?: Date; wait?: boolean }) {
  const now = options.now ?? new Date();
  const settings = await demoSettings(prisma);
  if (!settings.enabled) throw new DemoError(503, "DEMO_DISABLED", "The demo is turned off right now.");
  await purgeExpiredDemos(prisma, now).catch((error) => console.warn("demo purge failed", error));
  const ipHash = hashIp(options.ip);
  const windowStart = new Date(now.getTime() - DEMO_RATE_WINDOW_MS);
  const recent = await prisma.tryMeSession.count({ where: { ipHash, createdAt: { gt: windowStart } } });
  if (recent >= settings.maxStartsPerIpPerHour) {
    const oldest = await prisma.tryMeSession.findFirst({ where: { ipHash, createdAt: { gt: windowStart } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    throw new DemoError(429, "DEMO_RATE_LIMITED", "You've started a few demos this hour. Try again a little later.", demoRateLimitHeaders(oldest?.createdAt ?? now, now, settings.maxStartsPerIpPerHour));
  }
  const active = await prisma.tryMeSession.count({ where: { purgedAt: null, expiresAt: { gt: now } } });
  if (active >= settings.maxActive) throw new DemoError(503, "DEMO_BUSY", "A lot of people are trying the demo right now. Try again in a few minutes.");
  const plan = await loadPlan(prisma, options.planCode);
  if (!plan) throw new DemoError(options.planCode ? 404 : 503, options.planCode ? "NOT_FOUND" : "DEMO_NOT_CONFIGURED", options.planCode ? "No such Try me plan." : "There are no Try me plans.");
  if (plan.tasks.length === 0) throw new DemoError(503, "DEMO_NOT_CONFIGURED", "That plan has no tasks.");
  const preset = await prisma.scopePreset.findUnique({ where: { code: "client" } });
  if (!preset?.active) throw new DemoError(503, "DEMO_NOT_CONFIGURED", "The client scope preset is missing.");

  const tag = randomBytes(6).toString("hex");
  const expiresAt = new Date(now.getTime() + settings.ttlMinutes * 60_000);
  const org = await prisma.organization.create({ data: { name: `Try me sandbox ${tag}`, slug: `try-me-${tag}` } });
  const user = await prisma.user.create({ data: { email: `try-me-${tag}@demo.unwhelm.invalid`, displayName: "Try me visitor" } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "client", status: "active" } });
  const client = await prisma.mcpClient.create({ data: { clientId: `try-me-${tag}`, name: "Try me demo agent", organizationId: org.id, redirectUris: [], scopes: preset.scopes } });
  const raw = `unwh_try_${randomBytes(32).toString("base64url")}`;
  const token = await prisma.mcpToken.create({ data: { clientId: client.id, userId: user.id, tokenHash: tokenHash(raw), scopes: preset.scopes, expiresAt } });
  const session = await prisma.tryMeSession.create({ data: { tryMeCode: plan.code, nextTaskSeq: plan.tasks[0].seq, ipHash, organizationId: org.id, userId: user.id, mcpClientId: client.id, tokenId: token.id, expiresAt } });
  await prisma.tryMeSessionCall.createMany({ data: plan.tasks.flatMap((task) => task.calls.map((call) => ({ sessionId: session.id, taskId: task.id, callId: call.id }))) });
  const run = runTask(prisma, options.mcpUrl, raw, session.id, settings.stepDelayMs);
  if (options.wait) await run; else void run;
  return { id: session.id, plan: plan.code, token: raw, expiresAt, scopes: preset.scopes };
}

/** The raw token is the visitor's proof: only its hash is stored, on the session's mcp_token row. */
async function authorize(prisma: PrismaClient, id: string, raw: string | undefined, now: Date): Promise<Session> {
  const session = await prisma.tryMeSession.findUnique({ where: { id } });
  if (!session || session.purgedAt || session.expiresAt < now) throw new DemoError(404, "NOT_FOUND", "That demo run has expired.");
  const token = session.tokenId ? await prisma.mcpToken.findUnique({ where: { id: session.tokenId } }) : null;
  if (!raw || !token || token.tokenHash !== tokenHash(raw)) throw new DemoError(401, "UNAUTHORIZED", "Send this run's sandbox token as the bearer.");
  return session;
}

/** Runs the next task (or, with all, every remaining task). Only a paused session can continue. */
export async function continueDemo(prisma: PrismaClient, options: { id: string; raw?: string; mcpUrl: string; all?: boolean; now?: Date; wait?: boolean }) {
  const session = await authorize(prisma, options.id, options.raw, options.now ?? new Date());
  if (session.status !== "paused") throw new DemoError(409, "CONFLICT", session.status === "running" ? "A task is still running." : `This run is ${session.status.replace("_", " ")}.`);
  const settings = await demoSettings(prisma);
  const claimed = await prisma.tryMeSession.updateMany({ where: { id: session.id, status: "paused" }, data: { status: "running" } });
  if (claimed.count === 0) throw new DemoError(409, "CONFLICT", "A task is still running.");
  const run = async () => {
    do { await runTask(prisma, options.mcpUrl, options.raw!, session.id, settings.stepDelayMs); }
    while (options.all && (await prisma.tryMeSession.findUnique({ where: { id: session.id } }))?.status === "paused" && (await prisma.tryMeSession.updateMany({ where: { id: session.id, status: "paused" }, data: { status: "running" } })).count === 1);
  };
  const work = run();
  if (options.wait) await work; else void work;
  return { id: session.id };
}

/** The visitor stops and takes over. The sandbox and token keep working until the run expires. */
export async function stopDemo(prisma: PrismaClient, options: { id: string; raw?: string; now?: Date }) {
  const session = await authorize(prisma, options.id, options.raw, options.now ?? new Date());
  if (session.status === "running") throw new DemoError(409, "CONFLICT", "Wait for the current task to finish, then stop.");
  if (session.status === "paused") await prisma.tryMeSession.update({ where: { id: session.id }, data: { status: "taken_over", finishedAt: new Date() } });
  return { id: session.id, status: session.status === "paused" ? "taken_over" : session.status, expiresAt: session.expiresAt };
}

/** Links finished calls to the agent_trace rows this token produced, in order, by tool name. */
async function linkTraces(prisma: PrismaClient, sessionId: string, tokenId: string) {
  const calls = await prisma.tryMeSessionCall.findMany({ where: { sessionId, status: { in: ["ok", "error", "refused", "unexpected"] } }, include: { call: true }, orderBy: { startedAt: "asc" } });
  if (!calls.some((c) => !c.agentTraceId)) return;
  const traces = await prisma.agentTrace.findMany({ where: { tokenId }, orderBy: { occurredAt: "asc" }, select: { id: true, toolName: true } });
  const claimed = new Set(calls.map((c) => c.agentTraceId).filter(Boolean));
  for (const c of calls) {
    if (c.agentTraceId) continue;
    const trace = traces.find((t) => t.toolName === c.call.toolName && !claimed.has(t.id));
    if (!trace) continue;
    claimed.add(trace.id);
    await prisma.tryMeSessionCall.update({ where: { id: c.id }, data: { agentTraceId: trace.id } });
  }
}

/** What the page polls: each task with its calls, each call with its trace when unwh-mcp has written it. */
export async function getDemo(prisma: PrismaClient, id: string) {
  const session = await prisma.tryMeSession.findUnique({ where: { id }, include: { tryMe: true } });
  if (!session || session.purgedAt) return null;
  if (session.tokenId) await linkTraces(prisma, session.id, session.tokenId);
  const rows = await prisma.tryMeSessionCall.findMany({ where: { sessionId: id }, include: { task: true, call: true } });
  rows.sort((a, b) => a.task.seq - b.task.seq || a.call.seq - b.call.seq);
  const traceIds = rows.map((r) => r.agentTraceId).filter((t): t is string => Boolean(t));
  const traces = traceIds.length ? await prisma.agentTrace.findMany({ where: { id: { in: traceIds } } }) : [];
  const preview = (value: unknown) => { const text = value === null || value === undefined ? "" : JSON.stringify(value); return text.length > 1500 ? `${text.slice(0, 1500)}…` : text; };
  const tasks: Array<{ seq: number; title: string; narration: string; status: string; calls: Array<Record<string, unknown> & { status: string }> }> = [];
  for (const row of rows) {
    let task = tasks.find((t) => t.seq === row.task.seq);
    if (!task) { task = { seq: row.task.seq, title: row.task.title, narration: row.task.narration, status: "pending", calls: [] }; tasks.push(task); }
    const trace = traces.find((t) => t.id === row.agentTraceId);
    task.calls.push({
      seq: row.call.seq, toolName: row.call.toolName, note: row.call.note, expect: row.call.expect, status: row.status, summary: row.summary, durationMs: row.durationMs, result: row.result ?? null,
      trace: trace ? { id: trace.id, occurredAt: trace.occurredAt, durationMs: trace.durationMs, isError: trace.isError, errorMessage: trace.errorMessage, agentName: trace.agentName, input: preview(trace.input), output: preview(trace.output) } : null,
    });
  }
  const finished = new Set(["ok", "refused", "error", "unexpected", "skipped"]);
  for (const task of tasks) {
    const states = task.calls.map((c) => c.status);
    task.status = states.includes("running") ? "running" : states.every((s) => finished.has(s)) ? (states.some((s) => s === "error" || s === "unexpected") ? "attention" : "done") : states.some((s) => finished.has(s)) ? "running" : "pending";
  }
  const doneCalls = rows.filter((r) => finished.has(r.status)).length;
  return { id: session.id, plan: { code: session.tryMe.code, title: session.tryMe.title, description: session.tryMe.description }, status: session.status, nextTaskSeq: session.nextTaskSeq, proposalId: session.proposalId, errorMessage: session.errorMessage, createdAt: session.createdAt, finishedAt: session.finishedAt, expiresAt: session.expiresAt, doneTasks: tasks.filter((t) => t.status === "done" || t.status === "attention").length, totalTasks: tasks.length, doneCalls, totalCalls: rows.length, tasks };
}

/** Deletes every expired sandbox: proposals, traces, token, client, membership, org, user, and the run's call rows. */
export async function purgeExpiredDemos(prisma: PrismaClient, now = new Date()) {
  const expired = await prisma.tryMeSession.findMany({ where: { purgedAt: null, expiresAt: { lt: now } }, take: 100 });
  for (const session of expired) {
    if (session.organizationId) {
      const proposals = await prisma.proposal.findMany({ where: { organizationId: session.organizationId }, select: { id: true } });
      for (const p of proposals) await deleteProposalCascade(prisma, p.id);
    }
    await prisma.tryMeSessionCall.deleteMany({ where: { sessionId: session.id } });
    if (session.tokenId) await prisma.agentTrace.deleteMany({ where: { tokenId: session.tokenId } });
    if (session.userId) {
      const chats = await prisma.chatSession.findMany({ where: { ownerId: session.userId }, select: { id: true } });
      if (chats.length) { await prisma.chatMessage.deleteMany({ where: { sessionId: { in: chats.map((c) => c.id) } } }); await prisma.chatSession.deleteMany({ where: { id: { in: chats.map((c) => c.id) } } }); }
    }
    if (session.mcpClientId) { await prisma.mcpToken.deleteMany({ where: { clientId: session.mcpClientId } }); await prisma.mcpClient.deleteMany({ where: { id: session.mcpClientId } }); }
    if (session.userId) { await prisma.contactPreference.deleteMany({ where: { userId: session.userId } }); await prisma.membership.deleteMany({ where: { userId: session.userId } }); }
    if (session.organizationId) await prisma.organization.deleteMany({ where: { id: session.organizationId } });
    if (session.userId) await prisma.user.deleteMany({ where: { id: session.userId } });
    await prisma.tryMeSession.update({ where: { id: session.id }, data: { purgedAt: now } });
  }
  return expired.length;
}
