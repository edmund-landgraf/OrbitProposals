// Scores guidance rules for one UTC day and updates learned weights.
// Safe to run from cron. Idempotent per (rule, period) via upsert.
import { closeDatabase, prisma } from "../server/db.js";
import { scoreGuidanceRulesNightly } from "../server/guidanceScoring.js";

const dryRun = process.argv.includes("--dry-run");
const periodArg = process.argv.find((arg) => arg.startsWith("--period="));
const period = periodArg ? periodArg.slice("--period=".length) : undefined;

try {
  const result = await scoreGuidanceRulesNightly(prisma, { period, dryRun });
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  await closeDatabase();
}

