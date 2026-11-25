/**
 * npm run test:scripted-proposal
 *
 * Builds and submits one proposal piece by piece through the public API, with
 * no proposal-agent conversation. The test client and every step live in
 * scripts/fixtures/scripted-proposal.json (override with SCRIPT_FILE).
 *
 * 1. Upserts the test client: user, organization, client membership, and a
 *    token with the scopes of the named scope preset (read from the database).
 * 2. Runs each step against UNWH_API_URL (default http://127.0.0.1:3201/api/v1),
 *    substituting {captured} values, and stops at the first unexpected status.
 * 3. Prints a one-line result per step and a JSON summary; exits 1 on failure.
 *    The token is revoked at the end unless KEEP_TOKEN=1.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../server/prismaClient.js";

type Step = { name: string; method: string; path: string; body?: unknown; expect: number[]; capture?: Record<string, string> };
type Script = { client: { email: string; displayName: string; organization: string; slug: string; preset: string }; steps: Step[] };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for test:scripted-proposal");
const apiUrl = (process.env.UNWH_API_URL ?? "http://127.0.0.1:3201/api/v1").replace(/\/$/, "");
const script = JSON.parse(readFileSync(resolve(process.env.SCRIPT_FILE ?? "scripts/fixtures/scripted-proposal.json"), "utf8")) as Script;
if (script.steps.length < 5 || script.steps.length > 25) throw new Error(`A script needs 5 to 25 steps; this one has ${script.steps.length}.`);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const vars: Record<string, string> = {};
const fill = (text: string) => text.replace(/\{(\w+)\}/g, (_, key: string) => { if (!(key in vars)) throw new Error(`Nothing captured for {${key}} yet.`); return vars[key]; });
const pick = (value: unknown, path: string) => path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), value);

let tokenId: string | null = null;
let failed = false;
const results: { step: number; name: string; status: number; ok: boolean }[] = [];
try {
  const c = script.client;
  const preset = await prisma.scopePreset.findUnique({ where: { code: c.preset } });
  if (!preset?.active) throw new Error(`No active scope preset named ${c.preset}. Run db:migrate first.`);
  const org = await prisma.organization.upsert({ where: { slug: c.slug }, update: { name: c.organization }, create: { name: c.organization, slug: c.slug } });
  const user = await prisma.user.upsert({ where: { email: c.email }, update: { displayName: c.displayName }, create: { email: c.email, displayName: c.displayName } });
  await prisma.membership.upsert({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } }, update: { role: "client", status: "active" }, create: { userId: user.id, organizationId: org.id, role: "client", status: "active" } });
  const mcpClient = await prisma.mcpClient.create({ data: { clientId: `scripted-${randomBytes(8).toString("hex")}`, name: "Scripted proposal run", organizationId: org.id, redirectUris: [], scopes: preset.scopes } });
  const raw = randomBytes(32).toString("base64url");
  const token = await prisma.mcpToken.create({ data: { clientId: mcpClient.id, userId: user.id, tokenHash: createHash("sha256").update(raw).digest("hex"), scopes: preset.scopes, expiresAt: new Date(Date.now() + 60 * 60_000) } });
  tokenId = token.id;
  console.log(`Test client ${c.email} in ${c.organization}; ${script.steps.length} steps against ${apiUrl}`);

  for (const [index, step] of script.steps.entries()) {
    const n = index + 1;
    const response = await fetch(apiUrl + fill(step.path), {
      method: step.method,
      headers: { authorization: `Bearer ${raw}`, "content-type": "application/json", "x-organization-id": org.id },
      body: step.body === undefined ? undefined : JSON.stringify(step.body),
    });
    const text = await response.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    const ok = step.expect.includes(response.status);
    results.push({ step: n, name: step.name, status: response.status, ok });
    const progress = pick(json, "entity.settled") !== undefined ? ` (${pick(json, "entity.settled")} of ${pick(json, "entity.total")} parts settled)` : "";
    console.log(`${ok ? "ok  " : "FAIL"} ${String(n).padStart(2)}. ${step.name}: ${response.status}${progress}`);
    if (!ok) { console.log(text.slice(0, 2000)); failed = true; break; }
    for (const [key, path] of Object.entries(step.capture ?? {})) {
      const value = pick(json, path);
      if (typeof value !== "string") { console.log(`Step ${n} did not return ${path}.`); failed = true; break; }
      vars[key] = value;
    }
    if (failed) break;
  }
} finally {
  if (tokenId && process.env.KEEP_TOKEN !== "1") await prisma.mcpToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } }).catch(() => undefined);
  await prisma.$disconnect();
}
console.log(JSON.stringify({ ok: !failed && results.length === script.steps.length, proposalId: vars.proposalId ?? null, passed: results.filter((r) => r.ok).length, total: script.steps.length }));
if (failed) process.exitCode = 1;
