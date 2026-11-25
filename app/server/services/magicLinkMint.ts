import { createHash, randomBytes } from "node:crypto";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export function mintMagicLinkMaterial(now: Date) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + FIFTEEN_MINUTES_MS);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return { token, expiresAt, tokenHash };
}

export function magicLinkUrl(token: string) {
  const baseUrl = process.env.UNWH_MAGIC_LINK_URL_BASE ?? `${process.env.UNWH_API_PUBLIC_URL ?? process.env.UNWH_WEB_PUBLIC_URL ?? "https://unwhelm.net"}/api/v1/auth/magic-link`;
  const link = new URL(baseUrl);
  link.searchParams.set("token", token);
  return link.toString();
}
