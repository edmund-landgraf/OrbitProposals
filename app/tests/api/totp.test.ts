import assert from "node:assert/strict";
import test from "node:test";
import { codeAt, generateRecoveryCodes, generateSecret, otpauthUrl, resetTotpReplay, verifyCode } from "../../server/auth/totp.js";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

test("verifyCode matches the RFC 6238 SHA-1 vectors and a one-step window", () => {
  resetTotpReplay();
  for (const [seconds, code] of RFC_VECTORS) {
    resetTotpReplay();
    assert.equal(verifyCode(RFC_SECRET, code, new Date(seconds * 1000)), true, `T=${seconds}`);
  }
  resetTotpReplay();
  const issuedAt = new Date(59_000);
  const neighbor = codeAt(RFC_SECRET, issuedAt);
  assert.equal(verifyCode(RFC_SECRET, neighbor, new Date(59_000 + 30_000)), true);
  assert.equal(verifyCode(RFC_SECRET, neighbor, new Date(59_000 + 30_000)), false);
  assert.equal(verifyCode(RFC_SECRET, "000000", new Date(59_000 + 30_000)), false);
});

test("otpauth URLs name Unwhelm and recovery codes default to eight", () => {
  const secret = generateSecret();
  const url = otpauthUrl("admin@example.com", secret);
  assert.match(url, /^otpauth:\/\/totp\/Unwhelm:/);
  assert.match(url, /issuer=Unwhelm/);
  assert.match(url, /secret=/);
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  assert.equal(generateRecoveryCodes(2).length, 2);
});
