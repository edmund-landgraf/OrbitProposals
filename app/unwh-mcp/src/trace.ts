import { logEvent } from "../../shared/log.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type TraceSink = (trace: {
  toolName: string;
  input: unknown;
  output?: unknown;
  isError: boolean;
  errorMessage?: string | null;
  durationMs: number;
  agentName?: string | null;
  occurredAt: string;
}) => void;

/** Posts each trace to unwh-api with the caller's bearer. Never throws and never delays the tool result. */
export function apiTraceSink(apiOrigin: string, bearer: string | undefined): TraceSink | undefined {
  if (!bearer || process.env.UNWH_MCP_TRACE === "off") return undefined;
  const url = `${apiOrigin.replace(/\/$/, "")}/api/v1/agent-traces`;
  return (trace) => {
    void fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", authorization: bearer }, body: JSON.stringify(trace) })
      .then(async (response) => { if (!response.ok) logEvent("warn", "agent trace not stored", { service: "unwh-mcp", status: response.status }); })
      .catch((error: unknown) => logEvent("warn", "agent trace not stored", { service: "unwh-mcp", error: error instanceof Error ? error.message : String(error) }));
  };
}

const errorText = (result: unknown) => {
  const content = (result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
  return Array.isArray(content) ? content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join(" ").slice(0, 2000) : null;
};

/**
 * Wraps registerTool so every handler registered afterward is timed and traced.
 * Call before registering tools. The tool result and any thrown error pass through unchanged.
 */
export function traceTools(server: McpServer, sink: TraceSink | undefined) {
  if (!sink) return;
  const original = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  const agentName = () => {
    const info = server.server.getClientVersion?.();
    return info ? `${info.name}${info.version ? `@${info.version}` : ""}` : null;
  };
  (server as unknown as { registerTool: (...args: unknown[]) => unknown }).registerTool = (name: unknown, config: unknown, handler: unknown) => {
    if (typeof handler !== "function") return original(name, config, handler);
    const wrapped = async (...args: unknown[]) => {
      const started = performance.now();
      const occurredAt = new Date().toISOString();
      const input = args.length > 1 ? args[0] : {};
      try {
        const result = await (handler as (...inner: unknown[]) => unknown)(...args);
        const isError = Boolean((result as { isError?: boolean } | undefined)?.isError);
        const output = (result as { structuredContent?: unknown } | undefined)?.structuredContent ?? result;
        sink({ toolName: String(name), input, output, isError, errorMessage: isError ? errorText(result) : null, durationMs: performance.now() - started, agentName: agentName(), occurredAt });
        return result;
      } catch (error) {
        sink({ toolName: String(name), input, isError: true, errorMessage: error instanceof Error ? error.message : String(error), durationMs: performance.now() - started, agentName: agentName(), occurredAt });
        throw error;
      }
    };
    return original(name, config, wrapped);
  };
}
