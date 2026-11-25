import { randomBytes } from "node:crypto";
import { generateSecret as createSecret, generateSync, generateURI, verifySync } from "otplib";

const ISSUER = "Unwhelm";
const PERIOD_SECONDS = 30;
const WINDOW_SECONDS = PERIOD_SECONDS;
const consumedSteps = new Map<string, Set<number>>();

export function generateSecret(): string {
  return createSecret();
}

export function otpauthUrl(email: string, secret: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret, period: PERIOD_SECONDS });
}

export function verifyCode(secret: string, code: string, now = new Date()): boolean {
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  const epoch = Math.floor(now.getTime() / 1000);
  const result = verifySync({ secret, token, epoch, period: PERIOD_SECONDS, epochTolerance: WINDOW_SECONDS });
  if (!result.valid) return false;
  const step = Math.floor(epoch / PERIOD_SECONDS) + result.delta;
  const seen = consumedSteps.get(secret) ?? new Set<number>();
  if (seen.has(step)) return false;
  seen.add(step);
  consumedSteps.set(secret, seen);
  return true;
}

export function generateRecoveryCodes(n = 8): string[] {
  return Array.from({ length: n }, () => {
    const raw = randomBytes(5).toString("hex");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function codeAt(secret: string, now: Date): string {
  return generateSync({ secret, epoch: Math.floor(now.getTime() / 1000), period: PERIOD_SECONDS });
}

export function resetTotpReplay(): void {
  consumedSteps.clear();
}
