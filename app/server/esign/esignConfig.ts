export type EsignConfig = {
  provider: "disabled" | "signwell" | "pandadoc";
  live: boolean;
};

export function esignConfigFromEnv(env: Record<string, string | undefined> = process.env): EsignConfig {
  const providerRaw = (env.UNWH_ESIGN_PROVIDER ?? "").trim().toLowerCase();
  const provider = providerRaw === "signwell" || providerRaw === "pandadoc" ? providerRaw : "disabled";
  const live = env.UNWH_ESIGN_LIVE === "1";
  return { provider, live };
}

