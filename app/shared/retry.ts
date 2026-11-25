// Bounded retry with exponential backoff, shared by unwh-api (database calls) and unwh-mcp (API calls),
// so a short Postgres or API restart is retried instead of surfacing as a 500.

export type RetryOptions = {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function backoffMs(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** (attempt - 1));
}

export async function withRetry<T>(run: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseMs = options.baseMs ?? 250;
  const maxMs = options.maxMs ?? 4000;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !options.shouldRetry(error, attempt)) throw error;
      const delayMs = backoffMs(attempt, baseMs, maxMs);
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
}

function codesOf(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const record = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (typeof record.code === "string") codes.push(record.code);
    current = record.cause;
  }
  return codes;
}

// The request never reached the database, so retrying is safe for reads and writes alike.
const NOT_CONNECTED = new Set(["P1001", "P1002", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "57P03"]);
// The connection dropped mid-flight; a write may or may not have committed, so only reads retry.
const DROPPED = new Set(["P1017", "ECONNRESET", "EPIPE", "57P01", "57P02", "08006", "08003", "08001"]);
const DROPPED_MESSAGE = /Connection terminated|server closed the connection|Can't reach database server|connection is closed/i;

export function transientDbError(error: unknown): "not_connected" | "dropped" | null {
  const codes = codesOf(error);
  if (codes.some((code) => NOT_CONNECTED.has(code))) return "not_connected";
  if (codes.some((code) => DROPPED.has(code))) return "dropped";
  if (error instanceof Error && DROPPED_MESSAGE.test(error.message)) return /Can't reach/i.test(error.message) ? "not_connected" : "dropped";
  return null;
}

const READ_OPERATIONS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "$queryRaw", "$queryRawUnsafe"]);

export function shouldRetryDbOperation(operation: string, error: unknown): boolean {
  const kind = transientDbError(error);
  if (kind === "not_connected") return true;
  return kind === "dropped" && READ_OPERATIONS.has(operation);
}

/** Wait for a dependency at startup; resolves true when ready, false when it gave up (the caller still starts, degraded). */
export async function waitUntilReady(check: () => Promise<unknown>, options: { attempts?: number; baseMs?: number; maxMs?: number; label: string; log?: (line: string) => void; sleep?: (ms: number) => Promise<void> }): Promise<boolean> {
  const log = options.log ?? ((line: string) => console.log(line));
  try {
    await withRetry(check, {
      attempts: options.attempts ?? 8,
      baseMs: options.baseMs ?? 500,
      maxMs: options.maxMs ?? 8000,
      sleep: options.sleep,
      shouldRetry: () => true,
      onRetry: (error, attempt, delayMs) => log(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event: "startup_retry", dependency: options.label, attempt, delayMs, error: error instanceof Error ? error.name : "Error" })),
    });
    return true;
  } catch (error) {
    log(JSON.stringify({ ts: new Date().toISOString(), level: "error", event: "startup_unready", dependency: options.label, error: error instanceof Error ? error.name : "Error" }));
    return false;
  }
}