const fs = require('fs');
const binPath = 'bin.ts';

let lines = fs.readFileSync(binPath, 'utf-8').split('\n');

console.log('Before:');
console.log('870:', JSON.stringify(lines[869]));
console.log('871:', JSON.stringify(lines[870]));

// Fix the trailing backslash pattern: /\//+$/ needs to become /\\//+$/
// The pattern in file is: /\/+$/ (single backslash)
// We need: /\\/+$/ (double backslash in source = valid regex)

for (let i = 869; i <= 870; i++) {
  const line = lines[i];
  if (line.includes('replace(/\\//+$')) {
    // This is the invalid pattern - replace single backslash with double
    lines[i] = line.replace(/\/\\\/\/+/g, '/\\\\/+/g');
    console.log(`Fixed line ${i+1}`);
  }
}

console.log('\nAfter:');
console.log('870:', JSON.stringify(lines[869]));
console.log('871:', JSON.stringify(lines[870]));

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');

// Verify hex
const content = fs.readFileSync(binPath, 'utf-8');
const idx = content.indexOf('/\\/+$/');
if (idx >= 0) {
  console.log('\nWARNING: Pattern still has single backslash at index', idx);
  const snippet = content.substring(idx - 10, idx + 15);
  console.log('Snippet:', JSON.stringify(snippet));
} else {
  console.log('\nPattern appears fixed');
}