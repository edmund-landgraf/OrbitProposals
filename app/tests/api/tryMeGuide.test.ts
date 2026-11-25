// Pure check: the Try me help guide must cover at least 80% of the MCP tools a Try me (client preset) token can see.
// The DB half checks the guide route returns the seeded exercises when UNWH_DB_TEST=1 and DATABASE_URL are set.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { listGuide } from "../../server/demo.js";
import { createServer } from "../../unwh-mcp/src/createServer.js";
import { toolsHiddenForScopes } from "../../unwh-mcp/src/toolAccess.js";

const MIN_COVERAGE = 0.8;
const migrations = join(process.cwd(), "prisma", "migrations");
const sqlFiles = () => readdirSync(migrations).flatMap((name) => { try { return [readFileSync(join(migrations, name, "migration.sql"), "utf8")]; } catch { return []; } });
const registeredTools = () => Object.keys((createServer({ apiOrigin: "http://127.0.0.1:9", traceSink: null }) as unknown as { _registeredTools: Record<string, unknown> })._registeredTools).sort();

/** The scopes of the seeded client preset, which is what a Try me token gets. */
function clientScopes() {
  for (const sql of sqlFiles()) {
    const match = sql.match(/\('client',\s*'[^']*',\s*ARRAY\[([^\]]*)\]/);
    if (match) return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }
  throw new Error("No client scope preset seed found.");
}

/** Tool names seeded into try_me_exercise_tool across all migrations. */
function guideTools() {
  const tools = new Set<string>();
  for (const sql of sqlFiles()) {
    for (const block of sql.matchAll(/INSERT INTO "try_me_exercise_tool"[^;]*;/g)) {
      for (const m of block[0].matchAll(/'(unw_[a-z_]+)'/g)) tools.add(m[1]);
    }
  }
  return tools;
}

export function guideCoverage() {
  const names = registeredTools();
  const hidden = new Set(toolsHiddenForScopes(names, clientScopes()).map((h) => h.name));
  const visible = names.filter((name) => !hidden.has(name));
  const covered = guideTools();
  const hit = visible.filter((name) => covered.has(name));
  return { visible, covered, hit, percent: hit.length / visible.length, unknown: [...covered].filter((name) => !names.includes(name)) };
}

test("the Try me help guide covers at least 80% of the tools a demo token can see", () => {
  const { visible, hit, percent } = guideCoverage();
  const missing = visible.filter((name) => !hit.includes(name));
  console.log(`Try me guide coverage: ${hit.length} of ${visible.length} demo-visible tools (${Math.round(percent * 100)}%)`);
  assert.ok(percent >= MIN_COVERAGE, `Guide covers ${Math.round(percent * 100)}%; add exercises for: ${missing.join(", ")}`);
});

test("every tool the guide names is a real MCP tool", () => {
  assert.deepEqual(guideCoverage().unknown, []);
});

const dbTest = process.env.UNWH_DB_TEST === "1" && process.env.DATABASE_URL ? test : test.skip;
dbTest("the guide route returns the seeded exercises with their tools", async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const guide = await listGuide(prisma as never);
    assert.ok(guide.length >= 10);
    assert.ok(guide.every((e) => e.prompt && e.tools.length > 0));
    assert.ok(guide.some((e) => e.code === "takeover"), "the take-over exercise is present");
  } finally { await prisma.$disconnect(); }
});