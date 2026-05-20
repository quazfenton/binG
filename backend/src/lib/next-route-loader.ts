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

    const honoPath = nextPathToHono(rel);

    let mod: Record<string, unknown>;
    try {
      mod = await import(pathToFileURL(file).href);
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
      (app as unknown as Record<string, (p: string, h: (c: any) => any) => unknown>)[method](
        honoPath,
        async (c: any) => {
          const params = c.req.param();
          try {
            return await handler(c.req.raw, { params });
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
