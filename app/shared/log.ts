/** One structured JSON log line, the same shape as unwh-api's request log: ts, level, msg, then fields. */
export type LogLevel = "info" | "warn" | "error";
export function formatLogLine(level: LogLevel, msg: string, fields: Record<string, unknown> = {}, now: Date = new Date()): string {
  return JSON.stringify({ ts: now.toISOString(), level, msg, ...fields });
}
export function logEvent(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  const line = formatLogLine(level, msg, fields);
  if (level === "info") process.stdout.write(`${line}\n`); else process.stderr.write(`${line}\n`);
}
