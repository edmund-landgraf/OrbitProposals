const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return EMAIL.test(value) ? "[redacted]" : value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(obj)) {
    if (key.toLowerCase().includes("email")) { next[key] = "[redacted]"; continue; }
    next[key] = redactValue(v);
  }
  return next;
}

export function redactProviderStatus(value: unknown): unknown {
  return redactValue(value);
}

