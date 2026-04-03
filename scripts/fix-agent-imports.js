const fs = require('fs');
const path = require('path');

function findTSFiles(dir) {
  let results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach(entry => {
      const fp = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '__tests__') {
          results = results.concat(findTSFiles(fp));
        }
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        results.push(fp);
      }
    });
  } catch (e) {}
  return results;
}

// Fix files in packages/shared/agent/
const agentDir = 'packages/shared/agent';
const files = findTSFiles(agentDir);
console.log('Scanning', files.length, 'files in', agentDir);

let updated = 0;
files.forEach(f => {
  try {
    let c = fs.readFileSync(f, 'utf8');
    const orig = c;
    c = c.replace(/from\s+['"]@\/lib\/agent([\/"'])/g, "from '@bing/shared/agent$1");
    if (c !== orig) {
      fs.writeFileSync(f, c);
      console.log('Updated:', path.relative('packages/shared/agent', f));
      updated++;
    }
  } catch (e) {}
});

console.log('Done. Updated', updated, 'files in packages/shared/agent/');
