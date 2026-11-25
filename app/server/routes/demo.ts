import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { continueDemo, DemoError, getDemo, listGuide, listPlans, startDemo, stopDemo } from "../demo.js";

const requestId = (request: Request) => request.header("x-request-id") || randomUUID();
const ok = (request: Request, response: Response, entity: unknown, changed = false, status = 200) =>
  response.status(status).json({ ok: true, changed, entity, warnings: [], links: {}, requestId: requestId(request) });
const fail = (request: Request, response: Response, status: number, code: string, message: string) =>
  response.status(status).json({ ok: false, code, message, retryable: status >= 500 || status === 429, requestId: requestId(request) });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bearer = (request: Request) => request.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

/** MCP URL handed to demo clients: the public endpoint, or the local MCP server when the API is reached on localhost. */
export function demoPublicMcpUrl(host: string | undefined, env: NodeJS.ProcessEnv = process.env, localDefault = "http://localhost:3202/mcp") {
  if (env.UNWH_DEMO_PUBLIC_MCP_URL) return env.UNWH_DEMO_PUBLIC_MCP_URL;
  const hostname = (host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return local ? (env.UNWH_DEMO_LOCAL_MCP_URL ?? localDefault) : "https://mcp.unwhelm.net/mcp";
}

export function createDemoRouter(deps: { prisma: PrismaClient; mcpUrl?: string }) {
  const router = Router();
  const mcpUrl = deps.mcpUrl ?? process.env.UNWH_DEMO_MCP_URL ?? "http://127.0.0.1:3202/mcp";
  const handle = (what: string, fn: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response) => {
    try { await fn(request, response); } catch (error) {
      if (error instanceof DemoError) { for (const [name, value] of Object.entries(error.headers)) response.setHeader(name, value); fail(request, response, error.status, error.code, error.message); return; }
      console.error(error);
      fail(request, response, 500, "INTERNAL_ERROR", `The demo could not ${what}.`);
    }
  };
  const sessionId = (request: Request) => { const id = String(request.params.id); if (!uuidPattern.test(id)) throw new DemoError(404, "NOT_FOUND", "No such demo run."); return id; };

  router.get("/public/demo/plans", handle("list plans", async (request, response) => { ok(request, response, await listPlans(deps.prisma)); }));

  router.get("/public/demo/guide", handle("load the guide", async (request, response) => { ok(request, response, await listGuide(deps.prisma)); }));

  router.post("/public/demo/sessions", handle("start", async (request, response) => {
    const plan = typeof request.body?.plan === "string" ? request.body.plan.slice(0, 80) : undefined;
    ok(request, response, { ...(await startDemo(deps.prisma, { ip: request.ip ?? "unknown", mcpUrl, planCode: plan })), mcpUrl: demoPublicMcpUrl(request.header("x-forwarded-host") ?? request.header("host")) }, true, 201);
  }));

  router.get("/public/demo/sessions/:id", handle("be read", async (request, response) => {
    const demo = await getDemo(deps.prisma, sessionId(request));
    if (!demo) throw new DemoError(404, "NOT_FOUND", "That demo run has expired.");
    ok(request, response, demo);
  }));

  router.post("/public/demo/sessions/:id/continue", handle("continue", async (request, response) => {
    ok(request, response, await continueDemo(deps.prisma, { id: sessionId(request), raw: bearer(request), mcpUrl, all: request.body?.all === true }), true, 202);
  }));

  router.post("/public/demo/sessions/:id/stop", handle("stop", async (request, response) => {
    ok(request, response, await stopDemo(deps.prisma, { id: sessionId(request), raw: bearer(request) }), true);
  }));

  return router;
}
