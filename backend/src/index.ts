import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import path from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { mountNextApiRoutes } from "./lib/next-route-loader";

// Prevent unhandled rejections from crashing the process
// (mountNextApiRoutes may encounter async rejections from
// Next.js route files that use server-only or browser APIs)
process.on("unhandledRejection", (reason) => {
  console.warn("[backend] unhandledRejection (non-fatal):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[backend] uncaughtException (non-fatal):", err);
});

const app = new Hono();

// ── Middleware ───────────────────────────────────────────────────────────
app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      const allowed = [
        process.env.FRONTEND_URL || "http://localhost:3000",
        process.env.NEXT_PUBLIC_APP_URL,
        origin?.startsWith('http://localhost') ? origin : undefined,
        origin?.startsWith('http://127.0.0.1') ? origin : undefined,
      ].filter(Boolean);

      // Allow *.trycloudflare.com for tunnel access (dynamic subdomain)
      if (origin?.endsWith('.trycloudflare.com')) {
        return origin;
      }

      if (allowed.includes(origin)) {
        return origin;
      }
      return undefined;
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-User-ID', 'X-Forwarded-For', 'X-Real-IP', 'X-Forwarded-Authorization'],
    exposeHeaders: ['Content-Type'],
  })
);

// ── Health ───────────────────────────────────────────────────────────────
app.get("/health", (c) =>
  c.json({ status: "ok", service: "bing-backend", time: new Date().toISOString() })
);

// ── Auto-mount every web/app/api/**/route.ts ─────────────────────────────
// Resolved relative to this file:  backend/src/index.ts  →  ../../web/app/api
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(__dirname, "..", "..", "web", "app", "api");

// Gate out handlers that should never run on the cloud backend.
// Add substrings of the path-relative-to-web/app/api here. Example:
//   "/desktop/"        — anything under web/app/api/desktop/
//   "tauri-only"       — files explicitly named *tauri-only*
// Routes that gate themselves at runtime via process.env.DESKTOP_MODE do
// NOT need to be listed; they fall through correctly when the env is unset.
const ROUTE_EXCLUDES = (process.env.BACKEND_ROUTE_EXCLUDES ?? "/desktop/")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

await mountNextApiRoutes(app, apiDir, { exclude: ROUTE_EXCLUDES });

// ── Catch-all 404 (json, not html) ──────────────────────────────────────
app.notFound((c) =>
  c.json({ error: "Not found", path: c.req.path, method: c.req.method }, 404)
);

async function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(start, () => {
      const port = (srv.address() as any).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(start + 1));
      } else {
        reject(err);
      }
    });
  });
}

const desiredPort = Number(process.env.PORT) || 3001;
const port = await findAvailablePort(desiredPort);
console.log(`🚀 binG backend listening on :${port}`);
serve({ fetch: app.fetch, port });
