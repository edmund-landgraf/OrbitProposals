import { createBrotliCompress, createGzip } from "node:zlib";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { handleContactSubmit, handleSessionSchedule } from "./server/contact-email.mjs";

const root = resolve("dist");
const port = Number(process.env.PORT ?? 5193);
const host = process.env.HOST ?? "127.0.0.1";
const sharedDir = join(dirname(fileURLToPath(import.meta.url)), "shared");
const siteRoutes = JSON.parse(readFileSync(join(sharedDir, "routes.json"), "utf8"));
// Listed in routes.json, served by the client app, and kept out of the sitemap and prerendered shells.
const clientOnlyRoutes = new Set(["/admin", "/portal", "/mcp/explained-b"]);
// Every route that has a pre-rendered shell in dist/ (sitemap routes plus the document viewer).
export const prerenderedRoutes = new Set([...siteRoutes.map(([path]) => path).filter((path) => !clientOnlyRoutes.has(path)), "/markdown-viewer"]);
// Old URL -> new URL. Every target is a final route, so each redirect is a single 301 hop.
export const legacyRedirects = new Map(Object.entries(JSON.parse(readFileSync(join(sharedDir, "redirects.json"), "utf8"))));

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".mp4", "video/mp4"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".pdf", "application/pdf"],
]);

// Public documents (e.g. PDFs) copied from public/docs into dist/docs by the build.
// Files only: no index, no directory listing, no dotfiles, no traversal.
const docsRoot = join(root, "docs");
const downloadsRoot = join(root, "downloads");
const docsFilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function flatFileName(requestPath, prefix) {
  try {
    return decodeURIComponent(requestPath.slice(prefix.length));
  } catch {
    return null;
  }
}

// One flat folder: reject empty names, slashes, backslashes, dotfiles and "..".
function flatFile(dir, name) {
  if (!name || !docsFilePattern.test(name) || name.includes("..")) return null;
  const file = resolve(dir, name);
  if (dirname(file) !== dir || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

// Windows treats names as case-insensitive. Downloads require the directory entry itself.
function exactFlatFile(dir, name) {
  const file = flatFile(dir, name);
  if (!file) return null;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  return entries.includes(name) ? file : null;
}

function handleDocs(request, response, requestPath) {
  const notFound = () => {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders });
    response.end("Not found");
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", ...securityHeaders });
    response.end();
    return;
  }
  const name = flatFileName(requestPath, "/docs/");
  const file = flatFile(docsRoot, name);
  if (!file) return notFound();
  const extension = extname(file).toLowerCase();
  response.statusCode = 200;
  sendFile(file, request, response, {
    "Content-Type": mimeTypes.get(extension) ?? "application/octet-stream",
    "Cache-Control": "public, max-age=3600",
    ...(extension === ".pdf" ? { "Content-Disposition": `inline; filename="${name}"` } : {}),
  });
}

// Files copied from public/downloads into dist/downloads. Same flat-folder rules as /docs,
// plus a case-exact directory entry so a differently cased name is not a hit.
function handleDownloads(request, response, requestPath) {
  const notFound = () => {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders });
    response.end("Not found");
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", ...securityHeaders });
    response.end();
    return;
  }
  const name = flatFileName(requestPath, "/downloads/");
  const file = exactFlatFile(downloadsRoot, name);
  if (!file) return notFound();
  const extension = extname(file).toLowerCase();
  response.statusCode = 200;
  sendFile(file, request, response, {
    "Content-Type": mimeTypes.get(extension) ?? "application/octet-stream",
    "Cache-Control": "public, max-age=3600",
    "Content-Disposition": `attachment; filename="${name}"`,
  });
}

// A route is servable if it is listed in routes.json at startup OR its pre-rendered shell exists in dist/.
// Checking the file too means a deploy that adds routes still returns 200 even if this process loaded an older routes.json.
function hasPrerenderedShell(route) {
  if (prerenderedRoutes.has(route)) return true;
  const shell = join(root, normalize(route === "/" ? "/" : route).replace(/^(\.\.[/\\])+/, ""), "index.html");
  return shell.startsWith(root) && existsSync(shell) && statSync(shell).isFile();
}

function resolveFile(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const safePath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(root, safePath);

  if (candidate.startsWith(root) && existsSync(candidate)) {
    if (statSync(candidate).isFile()) return candidate;
    const routeIndex = join(candidate, "index.html");
    if (existsSync(routeIndex) && statSync(routeIndex).isFile()) return routeIndex;
  }

  return null;
}

const compressibleExtensions = new Set([".html", ".css", ".js", ".json", ".svg", ".xml", ".txt"]);
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' https://plausible.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; media-src 'self' https://unwhelm.net; connect-src 'self' https://plausible.io",
};

function sendFile(file, request, response, headers) {
  const extension = extname(file);
  const acceptEncoding = request.headers["accept-encoding"] ?? "";
  const canCompress = compressibleExtensions.has(extension);
  let stream = createReadStream(file);
  const outputHeaders = { ...headers, ...securityHeaders };

  if (canCompress && /\bbr\b/i.test(acceptEncoding)) {
    outputHeaders["Content-Encoding"] = "br";
    outputHeaders.Vary = "Accept-Encoding";
    stream = stream.pipe(createBrotliCompress());
  } else if (canCompress && /\bgzip\b/i.test(acceptEncoding)) {
    outputHeaders["Content-Encoding"] = "gzip";
    outputHeaders.Vary = "Accept-Encoding";
    stream = stream.pipe(createGzip());
  }

  response.writeHead(response.statusCode || 200, outputHeaders);
  stream.pipe(response);
}

export function handleRequest(request, response) {
  if (!request.url) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const requestPath = request.url.split("?")[0];
  // Before redirects, prerendered shells and the SPA fallback so nothing else can answer /docs.
  if (requestPath === "/docs" || requestPath.startsWith("/docs/") || /^\/docs%2f/i.test(requestPath)) {
    handleDocs(request, response, requestPath.replace(/^\/docs%2f/i, "/docs/"));
    return;
  }
  if (requestPath === "/downloads" || requestPath.startsWith("/downloads/") || /^\/downloads%2f/i.test(requestPath)) {
    handleDownloads(request, response, requestPath.replace(/^\/downloads%2f/i, "/downloads/"));
    return;
  }
  if (request.method === "POST" && requestPath === "/api/contact/submit") {
    void handleContactSubmit(request, response);
    return;
  }
  if (request.method === "POST" && requestPath === "/api/session/schedule") {
    void handleSessionSchedule(request, response);
    return;
  }

  const normalizedRoute = requestPath.replace(/\/+$/, "") || "/";
  const redirectTarget = legacyRedirects.get(normalizedRoute);
  if (request.method === "GET" && redirectTarget) {
    response.writeHead(301, {
      Location: `${redirectTarget}${request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : ""}`,
      "Cache-Control": "public, max-age=3600",
    });
    response.end();
    return;
  }
  if ((request.method === "GET" || request.method === "HEAD") && clientOnlyRoutes.has(normalizedRoute)) {
    response.statusCode = 200;
    sendFile(join(root, "index.html"), request, response, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Robots-Tag": "noindex, nofollow",
    });
    return;
  }
  if (request.method === "GET" && !hasPrerenderedShell(normalizedRoute) && !extname(requestPath)) {
    const notFoundFile = join(root, "404.html");
    response.statusCode = 404;
    sendFile(notFoundFile, request, response, {
      "Content-Type": "text/html; charset=utf-8",
    });
    return;
  }

  const file = resolveFile(request.url);
  if (!file) {
    response.statusCode = 404;
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders });
    response.end("Not found");
    return;
  }
  const extension = extname(file);
  sendFile(file, request, response, {
    "Content-Type": mimeTypes.get(extension) ?? "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
}

// Tests import handleRequest without binding the production port.
if (process.env.UNWHELM_SERVER_NO_LISTEN !== "1") {
  createServer(handleRequest).listen(port, host, () => {
    console.log(`UnwhelmNet redesign listening on http://${host}:${port}`);
  });
}
