import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import { ZodError } from "zod";

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestIdOf(request: Request): string {
  const header = request.header("x-request-id");
  return header && requestIdPattern.test(header) ? header : randomUUID();
}

export function logServerFailure(status: number, requestId: string, error?: unknown): void {
  if (status < 500) return;
  const stack = error instanceof Error ? error.stack ?? error.message : new Error(`HTTP ${status}`).stack;
  console.error(`[${requestId}] HTTP ${status}\n${stack}`);
}

export const logFinishedServerFailure: RequestHandler = (request, response, next) => {
  response.on("finish", () => {
    if (response.statusCode < 500 || response.locals.serverFailureLogged) return;
    logServerFailure(response.statusCode, requestIdOf(request));
    response.locals.serverFailureLogged = true;
  });
  next();
};

export const apiErrorHandler: ErrorRequestHandler = (error, request, response, next) => {
  if (response.headersSent) { next(error); return; }
  const requestId = requestIdOf(request);
  if (error instanceof ZodError) {
    response.status(400).json({ ok: false, code: "VALIDATION_FAILED", message: "The request is not valid.", retryable: false, requestId });
    return;
  }
  const reported = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
  const status = reported >= 400 && reported < 500 ? reported : 500;
  if (status >= 500) {
    logServerFailure(status, requestId, error);
    response.locals.serverFailureLogged = true;
  }
  response.status(status).json({
    ok: false,
    code: status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED",
    message: status >= 500 ? "The request could not be completed." : "The request is not valid.",
    retryable: status >= 500,
    requestId,
  });
};
