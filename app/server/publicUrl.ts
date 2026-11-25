import { isIP } from "node:net";

const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);

function blockedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  return false;
}

/** Accepts a public https URL. Rejects http, credentials, localhost, and private or link-local addresses. */
export function assertPublicHttps(sourceUrl: string): URL {
  let url: URL;
  try { url = new URL(sourceUrl); }
  catch { throw new Error("The document link must be an https URL."); }
  if (url.protocol !== "https:") throw new Error("The document link must be an https URL.");
  if (url.username || url.password) throw new Error("The document link cannot include a username or password.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("The document link must be a public https URL.");
  }
  if (isIP(host) && blockedIp(host)) throw new Error("The document link must be a public https URL.");
  return url;
}

export function blockedAddress(address: string): boolean {
  return blockedIp(address);
}
