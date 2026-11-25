import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const dist = join(process.cwd(), "dist");
const template = await readFile(join(dist, "index.html"), "utf8");

const breadcrumbTrails = JSON.parse(await readFile(join(process.cwd(), "shared", "breadcrumbs.json"), "utf8"));
const siteRoutes = JSON.parse(await readFile(join(process.cwd(), "shared", "routes.json"), "utf8"));
const routes = [
  ...siteRoutes.filter(([path]) => path !== "/admin" && path !== "/portal"),
  ["/markdown-viewer", "Document viewer.", "Read public technical documents from the UnwhelmNet document library."],
  ["/404", "Page not found.", "The requested page could not be found."],
];

function escapeHtml(value) {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

// Extra crawlable links a route's raw HTML carries, so pages reached only from client-side UI still have a real <a href>.
const shellLinks = {
  "/mcp/getting-started": [["/mcp/connect","How to connect"],["/try","Start a Try me run"]],
  "/mcp/connect": [["/mcp","Unwhelm's MCP server"],["/mcp/getting-started","Sample prompts"]],
  "/try": [["/try/help", "Try me help guide"]],
  "/try/help": [["/try", "Start a Try me run"], ["/try/connect", "Connect your MCP client"]],
  "/try/connect": [["/try/help", "Try me help guide"], ["/try", "Start a Try me run"]],
  "/privacy": [["/terms", "Terms of service"], ["/support", "Support"]],
  "/terms": [["/privacy", "Privacy"], ["/support", "Support"]],
  "/support": [["/privacy", "Privacy"], ["/terms", "Terms of service"], ["/contact", "Contact"]],
  "/demo": [["/portal", "Client portal"], ["/support", "Support"], ["/request-access", "Request access"]],
  "/request-access": [["/demo", "Try the demo account"], ["/api/v1/auth/signin", "Sign in"]],
  "/claude": [["/mcp/connect", "How to connect"], ["/connect", "Connect hub"], ["/demo", "Try the demo account"], ["/request-access", "Request access"]],
  "/connect": [["/claude", "Claude"], ["/chatgpt", "ChatGPT"], ["/cursor", "Cursor"], ["/vscode", "VS Code"], ["/windsurf", "Windsurf"], ["/gemini-cli", "Gemini CLI"], ["/codex", "Codex"], ["/demo", "Try the demo account"], ["/request-access", "Request access"]],
  "/chatgpt": [["/connect", "Connect hub"], ["/demo", "Try the demo account"], ["/request-access", "Request access"]],
  "/cursor": [["/connect", "Connect hub"], ["/demo", "Try the demo account"], ["/request-access", "Request access"]],
  "/vscode": [["/connect", "Connect hub"], ["/demo", "Try the demo account"], ["/request-access", "Request access"]],
  "/windsurf": [["/connect", "Connect hub"], ["/demo", "Try the demo account"], ["/request-access", "Request access"]],
  "/gemini-cli": [["/connect", "Connect hub"], ["/demo", "Try the demo account"], ["/request-access", "Request access"]],
  "/codex": [["/connect", "Connect hub"], ["/demo", "Try the demo account"], ["/request-access", "Request access"]],
};


function buildPage(path, title, description) {
  const canonical = `https://unwhelm.net${path === "/" ? "/" : path}`;
  const shell = `<main style="max-width:1100px;margin:0 auto;padding:96px 24px;font-family:Arial,sans-serif"><p style="letter-spacing:.12em;text-transform:uppercase;color:#087f8c;font-size:12px;font-weight:700">UnwhelmNet</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p>${(shellLinks[path] ?? []).map(([href, label]) => `<p><a href="${href}">${escapeHtml(label)}</a></p>`).join("")}<p><a href="/contact">Start a project</a></p></main>`;
  const structuredData = path === "/industries/real-estate"
    ? `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          { "@type": "Question", name: "How much does an integration cost?", acceptedAnswer: { "@type": "Answer", text: "A small workflow can start with a short paid mapping session or a fixed first build. Larger integrations are scoped after we understand the systems, access, and acceptance criteria." } },
          { "@type": "Question", name: "How long does a first build take?", acceptedAnswer: { "@type": "Answer", text: "A bounded workflow commonly takes one to three weeks after access and requirements are clear." } },
          { "@type": "Question", name: "What access do you need?", acceptedAnswer: { "@type": "Answer", text: "We start with the least privilege needed for discovery and testing, keep credentials separate from source code, and define production access before deployment." } },
        ],
      })}</script>`
    : "";
  const trail = breadcrumbTrails[path];
  const breadcrumbData = trail
    ? `<script type="application/ld+json" id="breadcrumb-jsonld">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: trail.map(([itemPath, name], index) => ({ "@type": "ListItem", position: index + 1, name, item: `https://unwhelm.net${itemPath}` })),
      }).replace(/</g, "\\u003c")}</script>`
    : "";
  const noindex = path === "/404" ? '<meta name="robots" content="noindex, nofollow" />' : "";
  return template
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)} — UnwhelmNet</title>`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(title)} — UnwhelmNet" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeHtml(description)}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonical}" />`)
    .replace(/<meta property="og:image" content="[^"]*" \/>/, '<meta property="og:image" content="https://unwhelm.net/assets/og-image.png" />')
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${escapeHtml(title)} — UnwhelmNet" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${escapeHtml(description)}" />`)
    .replace(/<meta name="twitter:image" content="[^"]*" \/>/, '<meta name="twitter:image" content="https://unwhelm.net/assets/og-image.png" />')
    .replace("</head>", `${structuredData}${breadcrumbData}${noindex}</head>`)
    // index.html ships the home page's shell inside #root; every other route swaps in its own, so its raw HTML matches the page.
    .replace(/<div id="root">[\s\S]*?<\/main><\/div>|<div id="root"><\/div>/, (home) => (path === "/" ? home : `<div id="root">${shell}</div>`));
}

for (const [path, title, description] of routes) {
  const output = path === "/" ? join(dist, "index.html") : path === "/404" ? join(dist, "404.html") : join(dist, path.slice(1), "index.html");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, buildPage(path, title, description));
}

console.log(`Pre-rendered ${routes.length} route shells.`);
