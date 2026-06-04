/**
 * Auto-mount loader: scans web/app/api/** for Next.js route handlers and
 * registers each exported HTTP verb on the Hono app at the matching path.
 *
 * Recognised handler file names (in precedence order):
 *   1. route.{ts,js,mjs,cjs}    — Next.js convention
 *   2. gateway.{ts,js,mjs,cjs}  — local convention, picked up so legacy
 *                                  files still mount instead of 404-ing
 *   3. main.{ts,js,mjs,cjs}     — same idea, lowest precedence
 *
 * Next 13+ route handlers export `GET`/`POST`/`PUT`/`DELETE`/`PATCH`/`HEAD`/`OPTIONS`
 * with signature  `(req: Request, ctx?: { params }) => Response | Promise<Response>`
 * — Web Fetch standard, which Hono can invoke directly via `c.req.raw`.
 *
 * Path conversion:
 *   web/app/api/users/[id]/route.ts            →  /api/users/:id
 *   web/app/api/auth/[[...action]]/route.ts    →  /api/auth/*
 *   web/app/api/files/[...path]/route.ts       →  /api/files/*
 *   web/app/api/(group)/widgets/route.ts       →  /api/widgets        (group stripped)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Hono } from "hono";

const VERBS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] as const;
type Verb = (typeof VERBS)[number];
type NextHandler = (
  req: Request,
  ctx?: { params: Record<string, string | string[]> }
) => Response | Promise<Response>;

// Lower index = higher precedence. If two files in the same dir both define
// the same HTTP verb (rare but real after the gateway/route split), the
// higher-precedence file wins.
const HANDLER_BASENAMES = ["route", "gateway", "main"] as const;
const HANDLER_FILE_RE = /^(route|gateway|main)\.(ts|js|mjs|cjs)$/;

export interface MountOptions {
  logPrefix?: string;
  /**
   * Skip files whose path (relative to `apiDir`, posix style) matches any of
   * these substrings. Use this to gate-out desktop-only handlers that should
   * NOT run on the cloud backend, e.g. ["/desktop/", "tauri-only"].
   */
  exclude?: string[];
}

export interface MountResult {
  mounted: { method: Verb; honoPath: string; file: string }[];
  skipped: { file: string; reason: string }[];
  failed:  { file: string; error: string }[];
}

async function walk(dir: string, hits: string[] = []): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);

    // Resolve symlinks — many handler files in this repo are symlinked into
    // their app/api/<route>/ folder. `Dirent.isFile()` returns false for
    // symlinks, so we must stat() through the link to know what it points at.
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        const st = await fs.stat(full); // follows symlink
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue; // broken symlink — skip
      }
    }

    if (isDir) {
      await walk(full, hits);
    } else if (isFile && HANDLER_FILE_RE.test(e.name)) {
      hits.push(full);
    }
  }
  return hits;
}

/** Sort so higher-precedence files come first in the discovery list. */
function sortByPrecedence(files: string[]): string[] {
  return [...files].sort((a, b) => {
    const ra = HANDLER_BASENAMES.indexOf(path.basename(a).split(".")[0] as typeof HANDLER_BASENAMES[number]);
    const rb = HANDLER_BASENAMES.indexOf(path.basename(b).split(".")[0] as typeof HANDLER_BASENAMES[number]);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

function nextPathToHono(relFromApi: string): string {
  // relFromApi like:  "users/[id]/route.ts"   or   "auth/[[...action]]/gateway.ts"
  const noFile = relFromApi.replace(/\/(route|gateway|main)\.(ts|js|mjs|cjs)$/, "");
  const segs = noFile.split("/").map((s) => {
    // catch-all + optional catch-all
    if (/^\[\[\.\.\..+\]\]$/.test(s) || /^\[\.\.\..+\]$/.test(s)) return "*";
    // dynamic [param]
    const dyn = s.match(/^\[(.+)\]$/);
    if (dyn) return ":" + dyn[1].replace(/^\.\.\./, "");
    // route groups (group) are stripped — they don't affect URL
    if (/^\(.+\)$/.test(s)) return null;
    return s;
  }).filter(Boolean);
  return "/api/" + segs.join("/");
}

/** Check if a directory contains subdirectories (dispatcher pattern). */
async function hasSubdirs(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) return true;
      if (e.isSymbolicLink()) {
        try {
          const st = await fs.stat(path.join(dir, e.name));
          if (st.isDirectory()) return true;
        } catch {
          // broken symlink — treat as non-directory
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function mountNextApiRoutes(
  app: Hono,
  apiDir: string,
  opts: MountOptions = {}
): Promise<MountResult> {
  const prefix  = opts.logPrefix ?? "[next-route-loader]";
  const exclude = opts.exclude   ?? [];
  const result: MountResult = { mounted: [], skipped: [], failed: [] };

  // Track which (method, honoPath) combos are already mounted so a
  // lower-precedence file (gateway/main) cannot clobber a higher one (route).
  const taken = new Set<string>(); //  key = `${VERB} ${honoPath}`

  const files = sortByPrecedence(await walk(apiDir));

  for (const file of files) {
    const rel = path.relative(apiDir, file).replace(/\\/g, "/");

    if (exclude.some((needle) => rel.includes(needle))) {
      result.skipped.push({ file: rel, reason: "excluded by config" });
      continue;
    }

    let honoPath = nextPathToHono(rel);

    // Dispatcher route.ts files (in directories with subdirs) need /* to match subpaths.
    const baseName = path.basename(file);
    if (baseName.startsWith("route.")) {
      const dir = path.dirname(file);
      if (await hasSubdirs(dir)) {
        honoPath = honoPath.endsWith("/*") ? honoPath : `${honoPath}/*`;
      }
    }

    let mod: Record<string, unknown>;
    try {
      // Attach a noop .catch() synchronously to prevent Node.js from
      // emitting "unhandledRejection" before the await catches it.
      const importP = import(pathToFileURL(file).href);
      importP.catch(() => {});
      mod = await importP;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${prefix} skip ${rel} — import failed: ${msg}`);
      result.failed.push({ file: rel, error: msg });
      continue;
    }

    for (const verb of VERBS) {
      const handler = mod[verb] as NextHandler | undefined;
      if (typeof handler !== "function") continue;

      const key = `${verb} ${honoPath}`;
      if (taken.has(key)) {
        // Lower-precedence file (e.g. gateway.ts) lost to route.ts at same path.
        result.skipped.push({
          file: rel,
          reason: `superseded by higher-precedence handler for ${key}`,
        });
        continue;
      }
      taken.add(key);

      const method = verb.toLowerCase() as Lowercase<Verb>;

      // Hono does not expose a dedicated .head() method — use .on() for all
      // methods so HEAD (and any future method without a dedicated shortcut)
      // works consistently.
      app.on(
        method,
        honoPath,
        async (c: any) => {
          const params = c.req.param();
          const raw = c.req.raw;

          // Parse cookies from the Cookie header for Next.js compatibility
          const parseCookies = (): Map<string, string> => {
            const cookieHeader = raw.headers.get("cookie") || "";
            const cookies = new Map<string, string>();
            // Handle quoted cookie values that may contain semicolons (RFC 6265)
            let i = 0;
            while (i < cookieHeader.length) {
              while (i < cookieHeader.length && cookieHeader[i] === ' ') i++;
              if (i >= cookieHeader.length) break;
              const eqIdx = cookieHeader.indexOf('=', i);
              if (eqIdx < 0 || eqIdx === i) break;
              const name = cookieHeader.slice(i, eqIdx).trim();
              i = eqIdx + 1;
              let value: string;
              if (i < cookieHeader.length && cookieHeader[i] === '"') {
                const closeQuote = cookieHeader.indexOf('"', i + 1);
                if (closeQuote < 0) {
                  value = cookieHeader.slice(i + 1);
                  i = cookieHeader.length;
                } else {
                  value = cookieHeader.slice(i + 1, closeQuote);
                  i = closeQuote + 1;
                }
              } else {
                const semiIdx = cookieHeader.indexOf(';', i);
                if (semiIdx < 0) {
                  value = cookieHeader.slice(i);
                  i = cookieHeader.length;
                } else {
                  value = cookieHeader.slice(i, semiIdx);
                  i = semiIdx + 1;
                }
              }
              try {
                cookies.set(name, decodeURIComponent(value.trim()));
              } catch {
                cookies.set(name, value.trim());
              }
            }
            return cookies;
          };

          // Next.js handlers expect `request.nextUrl` (URL object) and
          // `request.cookies` (RequestCookies-like API), but Hono passes a
          // standard Fetch Request which only has `url` (string) and no cookies.
          // Create a proxied request with both for compatibility.
          const reqCompat = new Proxy(raw, {
            get(target, prop) {
              if (prop === "nextUrl") {
                try {
                  return new URL((target as Request).url);
                } catch {
                  return undefined;
                }
              }
              if (prop === "cookies") {
                const cookies = parseCookies();
                return {
                  get: (name: string) => {
                    const value = cookies.get(name);
                    return value ? { name, value } : undefined;
                  },
                  getAll: () =>
                    Array.from(cookies.entries()).map(([name, value]) => ({ name, value })),
                  has: (name: string) => cookies.has(name),
                };
              }
              return Reflect.get(target, prop);
            },
          }) as Request & { nextUrl?: URL; cookies?: { get: (n: string) => { name: string; value: string } | undefined; getAll: () => { name: string; value: string }[]; has: (n: string) => boolean } };

          try {
            return await handler(reqCompat, { params });
          } catch (err) {
            const msg = err instanceof Error ? err.stack ?? err.message : String(err);
            console.error(`${prefix} ${verb} ${honoPath} threw:\n${msg}`);
            return new Response(
              JSON.stringify({ error: "Internal route error", route: honoPath }),
              { status: 500, headers: { "content-type": "application/json" } }
            );
          }
        }
      );
      result.mounted.push({ method: verb, honoPath, file: rel });
    }
  }

  console.log(
    `${prefix} mounted ${result.mounted.length} handlers across ${files.length} files ` +
    `(${result.skipped.length} skipped, ${result.failed.length} import errors)`
  );
  return result;
}
