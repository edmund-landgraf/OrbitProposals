import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyBytes(): Buffer {
  const raw = process.env.UNWH_TOTP_KEY;
  if (!raw) throw new Error("UNWH_TOTP_KEY is required");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("UNWH_TOTP_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptTotpSecret(stored: string): string {
  const [ivPart, tagPart, dataPart] = stored.split(".");
  if (!ivPart || !tagPart || !dataPart) throw new Error("Stored TOTP secret is not valid");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}
