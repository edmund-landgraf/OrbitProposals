import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type {} from "../sessionTypes.js";

type AdminActor = { userId: string; via: "session" | "bearer" };

export const MFA_MAX_AGE_MS = 12 * 60 * 60 * 1000;

type MfaUser = { totpEnabledAt: Date | null };
type MfaDependencies = {
  prisma: { user: { findUnique: (args: { where: { id: string } }) => Promise<MfaUser | null> } };
  now?: () => Date;
};

export function adminMfaMode(env: NodeJS.ProcessEnv = process.env): "off" | "warn" | "enforce" {
  if (env.UNWH_ADMIN_MFA === "warn" || env.UNWH_ADMIN_MFA === "enforce" || env.UNWH_ADMIN_MFA === "off") return env.UNWH_ADMIN_MFA;
  return "off";
}

export function mfaIsCurrent(user: MfaUser | null, verifiedAt: string | undefined, now: Date): boolean {
  if (!user?.totpEnabledAt || !verifiedAt) return false;
  const verified = new Date(verifiedAt).getTime();
  if (Number.isNaN(verified) || verified > now.getTime()) return false;
  return now.getTime() - verified < MFA_MAX_AGE_MS;
}

function failure(response: Response, request: Request, status: number, code: string, message: string) {
  const supplied = request.header("x-request-id");
  const requestId = supplied && /^[0-9a-f-]{36}$/i.test(supplied) ? supplied : randomUUID();
  response.status(status).json({ ok: false, code, message, retryable: false, requestId });
}

export function requireAdminMfa(deps: MfaDependencies) {
  const now = deps.now ?? (() => new Date());
  return async (request: Request, response: Response, next: NextFunction) => {
    const mode = adminMfaMode();
    if (mode === "off") { next(); return; }
    const actor = response.locals.admin as AdminActor | undefined;
    // TODO: bearer tokens with the admin scope skip this check until machine clients can complete an MFA challenge.
    if (actor?.via === "bearer") { next(); return; }
    const user = actor ? await deps.prisma.user.findUnique({ where: { id: actor.userId } }) : null;
    if (mfaIsCurrent(user, request.session.mfaVerifiedAt, now())) { next(); return; }
    if (mode === "warn") {
      console.warn(`admin MFA is not current for user ${actor?.userId ?? "unknown"} on ${request.method} ${request.path}`);
      response.locals.mfaWarning = "Multi-factor authentication is not current for this admin session.";
      next();
      return;
    }
    failure(response, request, 403, "MFA_REQUIRED", "A current authenticator code is required.");
  };
}
