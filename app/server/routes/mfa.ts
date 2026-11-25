import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { allowMfaAttempt } from "../auth/mfaRateLimit.js";
import { decryptTotpSecret, encryptTotpSecret } from "../auth/totpCrypto.js";
import { generateRecoveryCodes, generateSecret, otpauthUrl, verifyCode } from "../auth/totp.js";
import type { PrismaClient } from "../prismaClient.js";
import type {} from "../sessionTypes.js";

const CodeSchema = z.object({ code: z.string().trim().min(6).max(64) }).strict();

type MfaUser = {
  id: string;
  email: string;
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
  totpRecoveryHashes: string[];
};

export type MfaDependencies = {
  prisma: Pick<PrismaClient, "user" | "auditEvent">;
  now?: () => Date;
};

function requestId(request: Request) {
  const supplied = request.header("x-request-id");
  return supplied && z.string().uuid().safeParse(supplied).success ? supplied : randomUUID();
}
function success(response: Response, request: Request, entity: unknown, status = 200) {
  response.status(status).json({ ok: true, entity, warnings: [], links: {}, requestId: requestId(request) });
}
function failure(response: Response, request: Request, status: number, code: string, message: string) {
  response.status(status).json({ ok: false, code, message, retryable: status >= 500 || status === 429, requestId: requestId(request) });
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function sameHash(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function writeAudit(deps: MfaDependencies, request: Request, userId: string, event: { operation: string; statusCode: number; inputRedacted: Record<string, unknown> }) {
  const previous = await deps.prisma.auditEvent.findFirst({ orderBy: { createdAt: "desc" } });
  const previousHash = previous?.hash ?? null;
  const digest = hash(JSON.stringify({ previousHash, operation: event.operation, actorUserId: userId, inputRedacted: event.inputRedacted }));
  await deps.prisma.auditEvent.create({
    data: {
      actorUserId: userId,
      operation: event.operation,
      method: request.method,
      path: request.path,
      recordType: "User",
      recordId: userId,
      requestId: requestId(request),
      inputRedacted: event.inputRedacted as never,
      statusCode: event.statusCode,
      previousHash,
      hash: digest,
    },
  });
}

async function signedIn(deps: MfaDependencies, request: Request, response: Response): Promise<MfaUser | null> {
  const userId = request.session.userId;
  if (!userId) { failure(response, request, 401, "AUTH_REQUIRED", "Authentication is required."); return null; }
  const user = await deps.prisma.user.findUnique({ where: { id: userId } });
  if (!user) { failure(response, request, 401, "AUTH_REQUIRED", "Authentication is required."); return null; }
  return user;
}

function limited(response: Response, request: Request) {
  failure(response, request, 429, "RATE_LIMITED", "Too many authenticator attempts. Try again in a few minutes.");
}

export function createMfaRouter(deps: MfaDependencies): express.Router {
  const router = express.Router();
  const now = deps.now ?? (() => new Date());

  router.post("/auth/mfa/setup", async (request, response, next) => {
    try {
      const user = await signedIn(deps, request, response);
      if (!user) return;
      if (!allowMfaAttempt(user.id, now().getTime())) { limited(response, request); return; }
      if (user.totpEnabledAt) { failure(response, request, 409, "CONFLICT", "An authenticator is already enabled."); return; }
      const secret = generateSecret();
      await deps.prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: encryptTotpSecret(secret) } });
      const url = otpauthUrl(user.email, secret);
      const qrCode = await QRCode.toDataURL(url);
      await writeAudit(deps, request, user.id, { operation: "mfa.setup", statusCode: 200, inputRedacted: { pending: true } });
      success(response, request, { otpauthUrl: url, qrCode });
    } catch (error) { next(error); }
  });

  router.post("/auth/mfa/confirm", async (request, response, next) => {
    try {
      const user = await signedIn(deps, request, response);
      if (!user) return;
      if (!allowMfaAttempt(user.id, now().getTime())) { limited(response, request); return; }
      const input = CodeSchema.parse(request.body);
      if (!user.totpSecretEnc || user.totpEnabledAt) { failure(response, request, 409, "CONFLICT", "Authenticator setup is not pending."); return; }
      const secret = decryptTotpSecret(user.totpSecretEnc);
      if (!verifyCode(secret, input.code, now())) {
        await writeAudit(deps, request, user.id, { operation: "mfa.failed", statusCode: 401, inputRedacted: { action: "confirm" } });
        failure(response, request, 401, "MFA_INVALID", "That code is not valid.");
        return;
      }
      const recoveryCodes = generateRecoveryCodes();
      const enabledAt = now();
      await deps.prisma.user.update({
        where: { id: user.id },
        data: { totpEnabledAt: enabledAt, totpRecoveryHashes: recoveryCodes.map(hash) },
      });
      request.session.mfaVerifiedAt = enabledAt.toISOString();
      await writeAudit(deps, request, user.id, { operation: "mfa.confirm", statusCode: 200, inputRedacted: { recoveryCount: recoveryCodes.length } });
      success(response, request, { recoveryCodes, totpEnabledAt: enabledAt.toISOString() });
    } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid."); else next(error); }
  });

  router.post("/auth/mfa/verify", async (request, response, next) => {
    try {
      const user = await signedIn(deps, request, response);
      if (!user) return;
      if (!allowMfaAttempt(user.id, now().getTime())) { limited(response, request); return; }
      const input = CodeSchema.parse(request.body);
      if (!user.totpEnabledAt || !user.totpSecretEnc) { failure(response, request, 409, "CONFLICT", "An authenticator is not enabled."); return; }
      const secret = decryptTotpSecret(user.totpSecretEnc);
      const totpOk = verifyCode(secret, input.code, now());
      let method: "totp" | "recovery" | null = totpOk ? "totp" : null;
      if (!method) {
        const digest = hash(input.code);
        const index = user.totpRecoveryHashes.findIndex((stored) => sameHash(stored, digest));
        if (index >= 0) {
          method = "recovery";
          const remaining = user.totpRecoveryHashes.filter((_, item) => item !== index);
          await deps.prisma.user.update({ where: { id: user.id }, data: { totpRecoveryHashes: remaining } });
        }
      }
      if (!method) {
        await writeAudit(deps, request, user.id, { operation: "mfa.failed", statusCode: 401, inputRedacted: { action: "verify" } });
        failure(response, request, 401, "MFA_INVALID", "That code is not valid.");
        return;
      }
      const verifiedAt = now().toISOString();
      request.session.mfaVerifiedAt = verifiedAt;
      await writeAudit(deps, request, user.id, { operation: "mfa.verify", statusCode: 200, inputRedacted: { method } });
      success(response, request, { verifiedAt });
    } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid."); else next(error); }
  });

  router.post("/auth/mfa/disable", async (request, response, next) => {
    try {
      const user = await signedIn(deps, request, response);
      if (!user) return;
      if (!allowMfaAttempt(user.id, now().getTime())) { limited(response, request); return; }
      const input = CodeSchema.parse(request.body);
      if (!user.totpEnabledAt || !user.totpSecretEnc) { failure(response, request, 409, "CONFLICT", "An authenticator is not enabled."); return; }
      const secret = decryptTotpSecret(user.totpSecretEnc);
      const totpOk = verifyCode(secret, input.code, now());
      const digest = hash(input.code);
      const recoveryOk = user.totpRecoveryHashes.some((stored) => sameHash(stored, digest));
      if (!totpOk && !recoveryOk) {
        await writeAudit(deps, request, user.id, { operation: "mfa.failed", statusCode: 401, inputRedacted: { action: "disable" } });
        failure(response, request, 401, "MFA_INVALID", "That code is not valid.");
        return;
      }
      await deps.prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpRecoveryHashes: [] } });
      delete request.session.mfaVerifiedAt;
      await writeAudit(deps, request, user.id, { operation: "mfa.disable", statusCode: 200, inputRedacted: { disabled: true } });
      success(response, request, { disabled: true });
    } catch (error) { if (error instanceof z.ZodError) failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid."); else next(error); }
  });

  return router;
}
