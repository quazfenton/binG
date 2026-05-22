import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
const apiDir = path.resolve(process.cwd(), "web", "app", "api");
const HANDLER_RE = /^(route|gateway|main)\.\w+$/;

async function walk(dir: string, hits: string[] = []): Promise<string[]> {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return hits; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try { const st = await fs.stat(full); isDir = st.isDirectory(); isFile = st.isFile(); }
      catch { continue; }
    }
    if (isDir) await walk(full, hits);
    else if (isFile && HANDLER_RE.test(e.name)) hits.push(full);
  }
  return hits;
}

const files = await walk(apiDir);
console.log(`Total handler files: ${files.length}`);
console.log("");

interface MountedInfo {
  file: string;
  verbs: string[];
  path: string;
}

let mounted: MountedInfo[] = [];
let failed: Array<{ file: string; error: string }> = [];
let skipped = 0;

for (const file of files) {
  const rel = path.relative(apiDir, file);
  if (rel.startsWith("desktop/")) { skipped++; continue; }

  try {
    const mod = await import(pathToFileURL(file).href);
    const verbs = ["GET","POST","PUT","DELETE","PATCH","HEAD","OPTIONS"].filter(
      (v) => typeof (mod as any)[v] === "function"
    );
    if (verbs.length > 0) {
      // Derive the API path from the rel path (same logic as next-route-loader)
      const noFile = rel.replace(/\/(route|gateway|main)\.\w+$/, "");
      const segs = noFile.split("/").map((s) => {
        if (/^\[\[\.\.\..+\]\]$/.test(s) || /^\[\.\.\..+\]$/.test(s)) return "*";
        const dyn = s.match(/^\[(.+)\]$/);
        if (dyn) return ":" + dyn[1].replace(/^\.\.\./, "");
        if (/^\(.+\)$/.test(s)) return null;
        return s;
      }).filter((s): s is string => s !== null);
      const apiPath = "/api/" + segs.join("/");
      mounted.push({ file: rel, verbs, path: apiPath });
    }
  } catch (err: any) {
    const msg = (err?.message || String(err)).substring(0, 120);
    failed.push({ file: rel, error: msg });
  }
}

console.log("=== SUCCESSFULLY MOUNTED HANDLERS ===\n");
// Sort by API path for readability
mounted.sort((a, b) => a.path.localeCompare(b.path) || a.file.localeCompare(b.file));

for (const m of mounted) {
  console.log(`  ${m.path}`);
  console.log(`    ${m.verbs.join(", ")}  ← ${m.file}`);
}

console.log(`\n=== SUMMARY ===`);
console.log(`Mounted: ${mounted.reduce((s, m) => s + m.verbs.length, 0)} handlers from ${mounted.length} files`);
console.log(`Skipped (desktop/): ${skipped} files`);
console.log(`Failed: ${failed.length} files`);
}

main().catch(console.error);
