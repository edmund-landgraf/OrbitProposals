const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 5;
const attempts = new Map<string, number[]>();

export function allowMfaAttempt(userId: string, timestamp: number): boolean {
  const recent = (attempts.get(userId) ?? []).filter((value) => value > timestamp - WINDOW_MS);
  if (recent.length >= LIMIT) {
    attempts.set(userId, recent);
    return false;
  }
  recent.push(timestamp);
  attempts.set(userId, recent);
  return true;
}

export function resetMfaAttempts(): void {
  attempts.clear();
}
