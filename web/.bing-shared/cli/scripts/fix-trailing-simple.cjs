const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');

console.log('Looking for the trailing pattern...');

// Find the exact pattern - single backslash followed by /+$/
const bad = '/\\//+$/';
const good = '/\\\\/+$/';

console.log('Bad pattern:', bad);
console.log('Good pattern:', good);

if (content.includes(bad)) {
  console.log('Found bad pattern, replacing...');
  content = content.split(bad).join(good);
  fs.writeFileSync(binPath, content, 'utf-8');
  console.log('Done');
} else {
  console.log('Pattern not found - checking what exists...');
  // Find all occurrences of the pattern
  const idx = content.indexOf('/+/');
  if (idx >= 0) {
    console.log('Found /+/ at index', idx);
    const snippet = content.substring(idx - 15, idx + 15);
    console.log('Context:', JSON.stringify(snippet));
  }
}

// Verify
const verify = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('\nLine 870:', verify[869]);
console.log('Line 871:', verify[870]);