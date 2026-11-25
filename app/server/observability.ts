import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";

export type LogLine = { ts: string; level: "info" | "warn" | "error"; msg: string; [field: string]: unknown };
export type LogSink = (line: LogLine) => void;
export const stdoutSink: LogSink = (line) => { process.stdout.write(`${JSON.stringify(line)}\n`); };

/** One JSON line per finished request: request id, method, path (no query string), status, and duration. */
export function requestLogger(sink: LogSink = stdoutSink) {
  return (request: Request, response: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    const requestId = request.header("x-request-id") || randomUUID();
    if (!request.header("x-request-id")) request.headers["x-request-id"] = requestId;
    response.setHeader("x-request-id", requestId);
    response.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const status = response.statusCode;
      sink({ ts: new Date().toISOString(), level: status >= 500 ? "error" : status >= 400 ? "warn" : "info", msg: "request", requestId, method: request.method, path: request.originalUrl.split("?")[0], status, ms: Math.round(ms * 10) / 10 });
    });
    next();
  };
}

export type Check = { name: string; run: () => Promise<unknown> };
export type CheckResult = { name: string; ok: boolean; ms: number; error?: string };

export async function runChecks(checks: Check[]): Promise<CheckResult[]> {
  return Promise.all(checks.map(async (check) => {
    const started = Date.now();
    try { await check.run(); return { name: check.name, ok: true, ms: Date.now() - started }; }
    catch (error) { return { name: check.name, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.name : "Error" }; }
  }));
}

/** Public GET /status: overall ok or degraded (503), each check with its latency, uptime, and the deployed version. No internals leak: errors report only a class name. */
export function createStatusRouter(options: { checks: Check[]; version?: string; startedAt?: Date }) {
  const startedAt = options.startedAt ?? new Date();
  const router = Router();
  router.get("/status", async (request, response) => {
    const checks = await runChecks(options.checks);
    const healthy = checks.every((check) => check.ok);
    response.setHeader("cache-control", "no-store");
    response.status(healthy ? 200 : 503).json({
      ok: healthy, changed: false, warnings: [], links: {}, requestId: request.header("x-request-id") || randomUUID(),
      entity: { status: healthy ? "ok" : "degraded", checks, version: options.version ?? process.env.UNWH_VERSION ?? "unknown", uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000), checkedAt: new Date().toISOString() },
    });
  });
  return router;
}
