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
      // Validate origin: reject null/undefined to prevent accidental open CORS
      if (!origin) return undefined;
      
      const allowed = [
        process.env.FRONTEND_URL || "http://localhost:3000",
        process.env.NEXT_PUBLIC_APP_URL,
      ].filter(Boolean);
      
      // Use exact match for localhost/127.0.0.1 to prevent lookalike domains
      // (e.g. "localhost.evil.com" should NOT be allowed via startsWith)
      try {
        const originUrl = new URL(origin);
        if (['localhost', '127.0.0.1', '0.0.0.0'].includes(originUrl.hostname) ||
            originUrl.hostname.endsWith('.localhost')) {
          return origin;
        }
      } catch { /* invalid URL, fall through to reject */ }

      // Allow *.trycloudflare.com for tunnel access (dynamic subdomain)
      try {
        const cfUrl = new URL(origin);
        if (cfUrl.hostname.endsWith('.trycloudflare.com')) {
          return origin;
        }
      } catch { /* invalid URL, fall through to reject */ }

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
const BACKEND_ROUTE_EXCLUDES_DEFAULT = ["/desktop/"];
const ROUTE_EXCLUDES = (() => {
  const raw = process.env.BACKEND_ROUTE_EXCLUDES;
  // Only use default when env var is undefined/null; empty string means "no exclusions"
  if (raw === undefined) return BACKEND_ROUTE_EXCLUDES_DEFAULT;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
})();

await mountNextApiRoutes(app, apiDir, { exclude: ROUTE_EXCLUDES });

// ── Catch-all 404 (json, not html) ──────────────────────────────────────
app.notFound((c) =>
  c.json({ error: "Not found", path: c.req.path, method: c.req.method }, 404)
);

async function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    // Upper bound: reject if port exceeds 65535 (no valid port above this).
    if (start > 65535) {
      reject(new Error(`No available port found after scanning up to 65535 (started at ${start})`));
      return;
    }
    const srv = createServer();
    srv.listen(start, () => {
      const port = (srv.address() as any).port;
      // TOCTOU fix: close the probe server then try binding the real server.
      // If another process grabs the port between probe and bind, the real
      // serve() call will emit EADDRINUSE — handle that in the retry loop below.
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

const desiredPort = Number(process.env.PORT) || 3000;

// Retry loop: bind the real server directly, catching EADDRINUSE.
// This eliminates the TOCTOU window between probe and bind.
async function startServer(initialPort: number): Promise<void> {
  for (let port = initialPort; port <= 65535; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = serve({ fetch: app.fetch, port });
        server.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            // Port taken, try next one
            reject(err);
          } else {
            reject(err);
          }
        });
        server.on('listening', () => {
          console.log(`🚀 binG backend listening on :${port}`);
          resolve();
        });
      });
      return; // Successfully bound
    } catch (err: any) {
      if (err?.code === 'EADDRINUSE') continue; // Try next port
      throw err; // Non-address error — abort
    }
  }
  // Fallback: if we exhausted all ports, try findAvailablePort (legacy probe)
  // as a last resort (note: still subject to TOCTOU, but unlikely after exhausting 64K ports).
  const fallbackPort = await findAvailablePort(initialPort);
  console.warn(`[DEPRECATED] Auto-fallback to a different port — bound on :${fallbackPort} instead of the configured PORT=${initialPort}. This can break platform routing/health checks that expect the configured PORT.`);
  console.log(`🚀 binG backend listening on :${fallbackPort}`);
  serve({ fetch: app.fetch, port: fallbackPort });
}

await startServer(desiredPort);

// Start the local MCP transport only when explicitly configured. It is
// intentionally non-fatal: chat and the public /api/mcp JSON-RPC route remain
// available if MCP initialization fails or the configured port is occupied.
if (process.env.MCP_CLI_PORT) {
  const mcpPort = Number.parseInt(process.env.MCP_CLI_PORT, 10);
  if (Number.isInteger(mcpPort) && mcpPort > 0 && mcpPort <= 65535) {
    import("@/lib/mcp/architecture-integration")
      .then(({ initializeMCPForArchitecture2 }) => initializeMCPForArchitecture2(mcpPort))
      .catch((error) => {
        console.error("[backend] MCP CLI transport failed to start (non-fatal):", error);
      });
  } else {
    console.error(`[backend] Ignoring invalid MCP_CLI_PORT=${process.env.MCP_CLI_PORT}`);
  }
}
