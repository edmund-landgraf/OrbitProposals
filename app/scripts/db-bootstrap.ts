/**
 * npm run db:bootstrap
 *
 * Prepares a database so every Prisma migration can apply, including on an
 * empty Postgres. Safe to run repeatedly.
 *
 * Migration 0001_init_unwhelm is a raw pg_dump. It contains psql-only
 * meta-commands (\restrict / \unrestrict) and sets an empty search_path, so
 * `prisma migrate deploy` cannot apply it to a fresh database. The committed
 * file must not change (production recorded its checksum), so this script:
 *
 *   1. If 0001 is already recorded in _prisma_migrations -> skip to step 4.
 *   2. If the public schema already has tables but 0001 is not recorded ->
 *      refuse (we will not guess about an unknown database).
 *   3. On an empty database: run a sanitized copy of 0001 (in memory) in a
 *      single transaction, then `prisma migrate resolve --applied` so Prisma
 *      records the checksum of the untouched committed file.
 *   4. `prisma migrate deploy` for everything after 0001.
 *
 * Uses DATABASE_URL. Never edits files on disk.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const INIT = "0001_init_unwhelm";
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:bootstrap: DATABASE_URL is not set.");
  process.exit(1);
}

export function sanitizeInitSql(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((line) => !/^\\(un)?restrict\b/.test(line))
    .filter((line) => !/set_config\(\s*'search_path'\s*,\s*''/.test(line))
    .join("\n");
}

function prisma(args: string[]): void {
  const r = spawnSync("npx", ["prisma", ...args], { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`prisma ${args.join(" ")} failed (exit ${r.status})`);
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  let ended = false;
  const endClient = async () => {
    if (ended) return;
    ended = true;
    await client.end();
  };
  try {
    const hasTable = async (name: string) =>
      (await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${name}`])).rows[0].ok as boolean;

    let initRecorded = false;
    if (await hasTable("_prisma_migrations")) {
      const r = await client.query(
        "SELECT 1 FROM public._prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL",
        [INIT],
      );
      initRecorded = (r.rowCount ?? 0) > 0;
    }

    if (initRecorded) {
      console.log(`db:bootstrap: ${INIT} already applied; nothing to bootstrap.`);
    } else {
      const { rows } = await client.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'",
      );
      if (rows[0].n > 0) {
        throw new Error(
          `public schema has ${rows[0].n} table(s) but ${INIT} is not recorded. Refusing to bootstrap a non-empty database.`,
        );
      }
      const file = resolve("prisma/migrations", INIT, "migration.sql");
      const sql = sanitizeInitSql(readFileSync(file, "utf8"));
      console.log(`db:bootstrap: applying sanitized ${INIT} to empty database...`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
      await endClient();
      prisma(["migrate", "resolve", "--applied", INIT]);
    }
  } finally {
    await endClient();
  }
  prisma(["migrate", "deploy"]);
  console.log("db:bootstrap: done.");
}

main().catch((err) => {
  console.error("db:bootstrap failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
