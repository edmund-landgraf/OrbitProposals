import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./prismaClient.js";
import { shouldRetryDbOperation, withRetry } from "../shared/retry.js";

// Keep module import safe for route unit tests that inject a mocked Prisma
// client. A missing URL still fails at the first real query and is surfaced by
// the health endpoint as DATABASE_UNAVAILABLE.
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://missing:missing@127.0.0.1:1/missing";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const globalForPrisma = globalThis as typeof globalThis & { unwhPrisma?: PrismaClient };

// Every query retries a few times with backoff on transient connection errors, so a short
// Postgres restart does not surface as 500s. Writes retry only when the database was never reached.
function createClient(): PrismaClient {
  const base = new PrismaClient({ adapter });
  return base.$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        return withRetry(() => query(args), {
          attempts: Number(process.env.UNWH_DB_RETRY_ATTEMPTS ?? "4"),
          shouldRetry: (error) => shouldRetryDbOperation(operation, error),
          onRetry: (error, attempt, delayMs) => console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event: "db_retry", operation, attempt, delayMs, error: error instanceof Error ? error.name : "Error" })),
        });
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.unwhPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.unwhPrisma = prisma;
}

export async function checkDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}
