import { useEffect, useState } from "react";

/** One line that says which proposal revision you're looking at, when it last changed, and which app build served it. */
export function versionStampText(version: number, updatedAt: string, build: string | null): string {
  const when = new Date(updatedAt);
  const stamp = Number.isNaN(when.getTime()) ? updatedAt : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `Version ${version} \u00b7 Updated ${stamp}${build && build !== "unknown" ? ` \u00b7 Build ${build}` : ""}`;
}

let buildPromise: Promise<string | null> | null = null;
/** The deployed build from /api/v1/status, fetched once per page load. A degraded (503) status still names its version. */
export function loadBuildVersion(): Promise<string | null> {
  buildPromise ??= fetch("/api/v1/status", { headers: { accept: "application/json" } })
    .then(async (response) => { const body = await response.json() as { entity?: { version?: unknown } }; return typeof body.entity?.version === "string" ? body.entity.version : null; })
    .catch(() => null);
  return buildPromise;
}

export function VersionStamp({ version, updatedAt }: { version: number; updatedAt: string }) {
  const [build, setBuild] = useState<string | null>(null);
  useEffect(() => { let live = true; void loadBuildVersion().then((value) => { if (live) setBuild(value); }); return () => { live = false; }; }, []);
  return <p className="portal-document-meta proposal-version-stamp" data-testid="proposal-version-stamp" title={updatedAt}>{versionStampText(version, updatedAt, build)}</p>;
}
