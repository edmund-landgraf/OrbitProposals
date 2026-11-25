import type { PrismaClient } from "@prisma/client";
import { esignConfigFromEnv } from "./esignConfig.js";
import { PandaDocAdapter } from "./providers/pandadoc.js";
import { SignWellAdapter } from "./providers/signwell.js";
import type { EsignAdapter, EsignProvider } from "./esignAdapter.js";

export function esignProviderFromEnv(env: Record<string, string | undefined> = process.env): { provider: "disabled" | EsignProvider; adapter: EsignAdapter | null; testMode: boolean } {
  const config = esignConfigFromEnv(env);
  const testMode = !config.live;
  if (config.provider === "signwell") {
    const apiKey = env.SIGNWELL_API_KEY;
    if (!apiKey) return { provider: "disabled", adapter: null, testMode: true };
    return { provider: "signwell", adapter: new SignWellAdapter({ apiKey }), testMode };
  }
  if (config.provider === "pandadoc") {
    const apiKey = env.PANDADOC_API_KEY;
    if (!apiKey) return { provider: "disabled", adapter: null, testMode: true };
    return { provider: "pandadoc", adapter: new PandaDocAdapter({ apiKey }), testMode };
  }
  return { provider: "disabled", adapter: null, testMode: true };
}

export function esignBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.UNWH_API_PUBLIC_URL ?? "").trim();
}

export function esignEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const { provider, adapter } = esignProviderFromEnv(env);
  return provider !== "disabled" && Boolean(adapter);
}

export type EsignRuntime = {
  prisma: PrismaClient;
  provider: EsignProvider;
  adapter: EsignAdapter;
  testMode: boolean;
  baseUrl: string;
};

export function esignRuntime(prisma: PrismaClient, env: Record<string, string | undefined> = process.env): EsignRuntime | null {
  const baseUrl = esignBaseUrl(env);
  const resolved = esignProviderFromEnv(env);
  if (resolved.provider === "disabled" || !resolved.adapter) return null;
  if (!baseUrl) return null;
  return { prisma, provider: resolved.provider, adapter: resolved.adapter, testMode: resolved.testMode, baseUrl };
}

