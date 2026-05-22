import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const apiDir = new URL('../web/app/api', import.meta.url).pathname;
const HANDLER_FILE_RE = /^(route|gateway|main)\.(ts|js|mjs|cjs)$/;

async function walk(dir, hits = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return hits; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        const st = await fs.stat(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch { continue; }
    }
    if (isDir) await walk(full, hits);
    else if (isFile && HANDLER_FILE_RE.test(e.name)) hits.push(full);
  }
  return hits;
}

const files = await walk(apiDir);
console.log(`Total handler files found: ${files.length}`);

const byExt = {};
const byBase = {};
for (const f of files) {
  const ext = path.extname(f);
  byExt[ext] = (byExt[ext] || 0) + 1;
  const base = path.basename(f).split('.')[0];
  byBase[base] = (byBase[base] || 0) + 1;
}
console.log('By ext:', JSON.stringify(byExt));
console.log('By type:', JSON.stringify(byBase));

// Full scan with per-file timeout
console.log('\n=== Full scan (desktop/ excluded, 5s per file) ===');
let totalHandlers = 0;
let failed = 0;
let mountedFiles = 0;

for (const file of files) {
  const rel = path.relative(apiDir, file);
  if (rel.startsWith('desktop/')) { continue; }
  
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const mod = await import(pathToFileURL(file).href);
    clearTimeout(timer);
    
    const verbs = ['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS'].filter(v => typeof mod[v] === 'function');
    if (verbs.length > 0) {
      totalHandlers += verbs.length;
      mountedFiles++;
    }
  } catch (err) {
    failed++;
    if (failed <= 20) {
      const msg = (err.message || String(err)).substring(0, 150);
      console.log(`  FAIL ${rel}: ${msg}`);
    }
  }
}

console.log(`\n=== Results ===`);
console.log(`Mounted: ${totalHandlers} handlers from ${mountedFiles} files`);
console.log(`Failed: ${failed} files`);
console.log(`Total files scanned (excl desktop/): ${files.filter(f => !path.relative(apiDir, f).startsWith('desktop/')).length}`);
