import { withRetry } from "../../shared/retry.js";

export type ApiHealth = {
  ok: boolean;
  service?: string;
  mode?: string;
  connected?: boolean;
};

export type ApiEnvelope = {
  ok: boolean;
  entity?: unknown;
  code?: string;
  message?: string;
  [key: string]: unknown;
};

export async function getApiHealth(apiOrigin: string, bearer?: string): Promise<ApiHealth> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (bearer) headers.authorization = bearer;

  const response = await fetch(`${apiOrigin.replace(/\/$/, "")}/api/v1/health`, { headers });
  const body = await readJson(response) as ApiHealth;
  if (!response.ok || !body.ok) {
    throw new Error(`unwh-api health failed: ${response.status}`);
  }
  return body;
}

export async function requestApi(
  apiOrigin: string,
  path: string,
  options: { method?: string; bearer?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiEnvelope> {
  const headers: Record<string, string> = { accept: "application/json", ...(options.headers ?? {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.bearer) headers.authorization = options.bearer;
  const method = options.method ?? "GET";
  const response = await fetchWithRetry(`${apiOrigin.replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await readJson(response);
  if (response.status === 403 && body.code === "SCOPE_REQUIRED") {
    const scope = /The (\S+) scope is required/.exec(body.message ?? "")?.[1] ?? "the required scope";
    throw new Error(`Reconnect Unwhelm to grant ${scope}.`);
  }
  if (!response.ok || !body.ok) {
    // Keep the API's reason: "400 VALIDATION_FAILED" alone does not say that, for example, a fixed price is under the $3,000 floor.
    const message = typeof body.message === "string" && body.message ? `: ${body.message}` : "";
    const details = Array.isArray(body.details) && body.details.length > 0 ? ` ${JSON.stringify(body.details)}` : "";
    throw new Error(`unwh-api request failed: ${response.status} ${body.code ?? "UNKNOWN"}${message}${details}`);
  }
  return body;
}

async function readJson(response: Response): Promise<ApiEnvelope> {
  const text = await response.text();
  try {
    return JSON.parse(text) as ApiEnvelope;
  } catch {
    throw new Error(`unwh-api request failed: ${response.status} response was not JSON`);
  }
}


class RetryableStatus extends Error {
  constructor(readonly response: Response) { super(`unwh-api returned ${response.status}`); }
}

/**
 * Retries a few times with backoff when unwh-api is briefly unreachable (restart, or Postgres restarting behind it).
 * A refused connection retries for every method; a 503 retries only for GET, since a write may have started.
 */
export async function fetchWithRetry(url: string, init: RequestInit & { method: string }, options: { attempts?: number; baseMs?: number; sleep?: (ms: number) => Promise<void>; fetcher?: typeof fetch } = {}): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  try {
    return await withRetry(async () => {
      const response = await fetcher(url, init);
      if (response.status === 503 && init.method === "GET") throw new RetryableStatus(response);
      return response;
    }, {
      attempts: options.attempts ?? 4,
      baseMs: options.baseMs ?? 250,
      sleep: options.sleep,
      shouldRetry: (error) => error instanceof RetryableStatus || (error instanceof TypeError && /fetch failed/i.test(error.message)),
    });
  } catch (error) {
    if (error instanceof RetryableStatus) return error.response;
    throw error;
  }
}
