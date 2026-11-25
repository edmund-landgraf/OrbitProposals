import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { contactApiMiddleware } from "./server/contact-email.mjs";

function catalogApiPlugin(): Plugin {
  const body = JSON.stringify({ ok: true, entity: JSON.parse(readFileSync(new URL("./shared/catalog-v1.json", import.meta.url), "utf8")) });
  const handler = (request: { url?: string; method?: string }, response: { setHeader: (name: string, value: string) => void; end: (body: string) => void }, next: () => void) => {
    const path = request.url?.split("?")[0];
    if (request.method === "GET" && (path === "/api/v1/catalog" || path === "/api/v1/public/pricing")) {
      response.setHeader("content-type", "application/json");
      response.end(body);
      return;
    }
    next();
  };
  return {
    name: "catalog-api",
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}


function contactApiPlugin(): Plugin {
  const attach = (server: { middlewares: { use: (handler: typeof contactApiMiddleware) => void } }) => {
    server.middlewares.use(contactApiMiddleware);
  };

  return {
    name: "contact-api",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

// Dev-only: forward /api to the local API (npm run dev:api). UNWH_API_URL may include a path such as /api/v1; only its origin is used.
const apiTarget = new URL(process.env.UNWH_API_URL ?? "http://127.0.0.1:3201").origin;

export default defineConfig({
  plugins: [catalogApiPlugin(), contactApiPlugin(), react()],
  css: {
    // Avoid native lightningcss bindings in minimal CI/agent environments.
    transformer: "postcss",
  },
  build: {
    cssMinify: "esbuild",
  },
  server: {
    port: 5192,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true }
    }
  },
  preview: {
    port: 5192,
    strictPort: true
  }
});
