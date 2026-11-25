import { createHash, timingSafeEqual } from "node:crypto";

/** Server env. Both must be set or password sign-in stays off. Never commit the values. */
export const REVIEWER_EMAIL_ENV = "REVIEWER_EMAIL";
export const REVIEWER_PASSWORD_ENV = "REVIEWER_PASSWORD";

/** Reject shorter secrets so an empty or placeholder password cannot enable the path. */
export const MIN_REVIEWER_PASSWORD_LENGTH = 12;

/** Failed and successful password posts share this cap, per IP and per submitted email, per hour. */
export const REVIEWER_ATTEMPT_LIMIT = 10;

export type ReviewerLoginConfig = { email: string; password: string };

/**
 * Read the designated reviewer account from the process environment.
 * Returns null when either value is missing, the email is not an address,
 * or the password is shorter than MIN_REVIEWER_PASSWORD_LENGTH.
 * The password is not stored and is not returned anywhere except this object.
 */
export function reviewerLoginFromEnv(env: NodeJS.ProcessEnv = process.env): ReviewerLoginConfig | null {
  const email = env[REVIEWER_EMAIL_ENV]?.trim().toLowerCase() ?? "";
  const password = env[REVIEWER_PASSWORD_ENV] ?? "";
  if (!email || password.length < MIN_REVIEWER_PASSWORD_LENGTH) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { email, password };
}

function digestEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * True only when both the email and the password match the configured reviewer.
 * Both digests are compared even when the email does not match, so a wrong
 * email does not return earlier than a wrong password. Any other account is
 * rejected here and must keep using the magic link.
 */
export function reviewerCredentialsMatch(config: ReviewerLoginConfig | null, email: string, password: string): boolean {
  if (!config) return false;
  const emailMatches = digestEqual(email.trim().toLowerCase(), config.email);
  const passwordMatches = digestEqual(password, config.password);
  return emailMatches && passwordMatches;
}
