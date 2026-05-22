import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RE = /^(route|gateway|main)\.(ts|js|mjs|cjs)$/;
const HB = ['route','gateway','main'];
const VERBS = ['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS'];

async function walk(d, h=[]) {
  for (const e of await fs.readdir(d,{withFileTypes:true})) {
    const f = path.join(d,e.name);
    let isDir=e.isDirectory(), isFile=e.isFile();
    if (e.isSymbolicLink()) {
      try { const s=await fs.stat(f); isDir=s.isDirectory(); isFile=s.isFile(); } catch { continue; }
    }
    if (isDir) await walk(f,h);
    else if (isFile && RE.test(e.name)) h.push(f);
  }
  return h;
}

const apiDir = path.resolve(process.cwd(), '../web/app/api');
const hits = (await walk(apiDir)).sort((a,b)=>{
  const ra=HB.indexOf(path.basename(a).split('.')[0]);
  const rb=HB.indexOf(path.basename(b).split('.')[0]);
  return ra!==rb? ra-rb : a.localeCompare(b);
});

const by={}; hits.forEach(h=>{const k=path.basename(h).split('.')[0]; by[k]=(by[k]||0)+1;});
console.log('Discovered:', hits.length, 'files |', JSON.stringify(by));

const failed = [];
let mounted = 0;
const verbCounts = {};

for (const f of hits) {
  try {
    const mod = await import(pathToFileURL(f).href);
    const verbs = VERBS.filter(v => typeof mod[v] === 'function');
    if (verbs.length === 0) {
      failed.push({ f: path.relative(apiDir,f), reason: 'no HTTP verb exports' });
    } else {
      mounted++;
      for (const v of verbs) verbCounts[v] = (verbCounts[v]||0)+1;
    }
  } catch (err) {
    failed.push({ f: path.relative(apiDir,f), reason: (err.message||String(err)).split('\n')[0].slice(0,200) });
  }
}

console.log('\nImport-success files:', mounted, '/', hits.length);
console.log('Verb distribution:', verbCounts);
console.log('\nFailed imports (' + failed.length + '):');
const grouped = {};
for (const x of failed) {
  const key = x.reason.replace(/['"]?\/[^'"\s]+/g,'<PATH>').slice(0,160);
  grouped[key] = (grouped[key]||0)+1;
}
for (const [k,v] of Object.entries(grouped).sort((a,b)=>b[1]-a[1]).slice(0,15)) {
  console.log('  [' + String(v).padStart(3) + '] ' + k);
}
console.log('\nFirst 10 failures with paths:');
failed.slice(0,10).forEach(x => console.log('  ', x.f, '\n     ', x.reason));
