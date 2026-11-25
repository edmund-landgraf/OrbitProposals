import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { maybeNotifyAccessRequest } from "../services/accessRequestNotify.js";

const HOUR_MS = 60 * 60 * 1000;
const LIMIT = 5;
const attempts = new Map<string, number[]>();

const EmailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const OptionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || null);

export const AccessRequestBody = z.object({
  email: EmailSchema,
  name: z.string().trim().min(1).max(200),
  company: OptionalText(200),
  role: OptionalText(200),
  reason: z.string().trim().min(1).max(4000),
  referral: OptionalText(500),
  consent: z.literal(true),
  website: z.string().max(200).optional(),
}).strict();

export type AccessRequestDeps = {
  prisma: Pick<PrismaClient, "accessRequest" | "user">;
  now?: () => Date;
  notify?: (input: { email: string; name: string; company: string | null }) => Promise<void>;
};

export function clearAccessRequestLimit() { attempts.clear(); }

function requestId(request: Request) {
  const supplied = request.header("x-request-id");
  return supplied && z.string().uuid().safeParse(supplied).success ? supplied : randomUUID();
}

function genericSuccess(response: Response, request: Request) {
  response.status(200).json({ ok: true, entity: { accepted: true }, warnings: [], links: {}, requestId: requestId(request) });
}

function allow(key: string, timestamp: number): boolean {
  const recent = (attempts.get(key) ?? []).filter((value) => value > timestamp - HOUR_MS);
  if (recent.length >= LIMIT) { attempts.set(key, recent); return false; }
  recent.push(timestamp);
  attempts.set(key, recent);
  return true;
}

function retryAfter(keys: string[], timestamp: number): number {
  let latest = 0;
  for (const key of keys) {
    const recent = (attempts.get(key) ?? []).filter((value) => value > timestamp - HOUR_MS);
    if (recent.length >= LIMIT) latest = Math.max(latest, recent[0] + HOUR_MS - timestamp);
  }
  return Math.max(1, Math.ceil(latest / 1000));
}

export function createAccessRequestRouter(deps: AccessRequestDeps) {
  const router = express.Router();
  const now = deps.now ?? (() => new Date());
  const notify = deps.notify ?? maybeNotifyAccessRequest;

  router.post("/access-requests", async (request, response) => {
    const parsed = AccessRequestBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ ok: false, code: "VALIDATION_FAILED", message: "The request is not valid.", retryable: false, requestId: requestId(request) });
      return;
    }
    const issuedAt = now();
    const ip = (request.ip || "unknown").slice(0, 64);
    const emailKey = `email:${parsed.data.email}`;
    const ipKey = `ip:${ip}`;
    const ipAllowed = allow(ipKey, issuedAt.getTime());
    const emailAllowed = allow(emailKey, issuedAt.getTime());
    if (!ipAllowed || !emailAllowed) {
      response.setHeader("Retry-After", String(retryAfter([ipKey, emailKey], issuedAt.getTime())));
      response.status(429).json({ ok: false, code: "RATE_LIMITED", message: "Too many requests. Please try again later.", retryable: true, requestId: requestId(request) });
      return;
    }
    const honeypot = parsed.data.website?.trim();
    if (honeypot) { genericSuccess(response, request); return; }
    const pending = await deps.prisma.accessRequest.findFirst({ where: { email: parsed.data.email, status: "pending" } });
    if (!pending) {
      const created = await deps.prisma.accessRequest.create({
        data: {
          email: parsed.data.email,
          name: parsed.data.name,
          company: parsed.data.company,
          role: parsed.data.role,
          reason: parsed.data.reason,
          referral: parsed.data.referral,
          status: "pending",
          ip,
          userAgent: (request.get("user-agent") ?? "").slice(0, 500) || null,
        },
      });
      await notify({ email: created.email, name: created.name, company: created.company });
    }
    genericSuccess(response, request);
  });

  return router;
}
