const fs = require('fs');
const path = require('path');

function findFiles(dir) {
  let results = [];
  try {
    fs.readdirSync(dir).forEach(f => {
      const fp = path.join(dir, f);
      try {
        findFiles(fp);
      } catch (e) {
        if (/\.(ts|tsx|js|jsx)$/.test(f)) {
          results.push(fp);
        }
      }
    });
  } catch (e) {}
  return results;
}

const files = findFiles('web').filter(f => {
  try {
    return /from\s+['"]@\/lib\/agent/.test(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    return false;
  }
});

console.log('Found', files.length, 'files with @/lib/agent imports');

let updated = 0;
files.forEach(f => {
  let c = fs.readFileSync(f, 'utf8');
  const orig = c;
  c = c.replace(/from\s+['"]@\/lib\/agent/g, "from '@bing/shared/agent");
  if (c !== orig) {
    fs.writeFileSync(f, c);
    console.log('  Updated:', path.relative('web', f));
    updated++;
  }
});

console.log('Done. Updated', updated, 'files.');
