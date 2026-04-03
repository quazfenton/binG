const fs = require('fs');
const path = require('path');

function findTSFiles(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(entry => {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.next') {
          results = results.concat(findTSFiles(fp));
        }
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        results.push(fp);
      }
    });
  } catch (e) {}
  return results;
}

const files = findTSFiles('web');
console.log('Scanning', files.length, 'files in web/');

let updated = 0;
let skipped = 0;
files.forEach(f => {
  try {
    let c = fs.readFileSync(f, 'utf8');
    const orig = c;
    c = c.replace(/from\s+['"]@\/lib\/agent([\/"'])/g, "from '@bing/shared/agent$1");
    c = c.replace(/from\s+['"]@\/lib\/agents([\/"'])/g, "from '@bing/shared/agent$1");
    c = c.replace(/import\(['"`]@\/lib\/agent([\/"'])/g, "import('@bing/shared/agent$1");
    c = c.replace(/require\(['"`]@\/lib\/agents?([\/"'])/g, "require('@bing/shared/agent$1");
    if (c !== orig) {
      fs.writeFileSync(f, c);
      console.log('Updated:', path.relative('web', f));
      updated++;
    } else {
      skipped++;
    }
  } catch (e) {}
});

console.log('Done. Updated', updated, 'files. Skipped', skipped);
