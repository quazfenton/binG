const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'bin.ts');
let content = fs.readFileSync(binPath, 'utf-8');

console.log('=== Fixing Regex Patterns ===\n');

// Use char codes for reliable matching
// Current (wrong): \/  = 47, 92, 47 (/)
// Should be: \\/ = 47, 92, 92, 47 (/)

const singleBS = String.fromCharCode(92);
const slash = String.fromCharCode(47);

// Pattern to find: \/+$
// In UTF-8 bytes: 47, 92, 43, 36 (/, +, $)
const badTrailing = slash + singleBS + '+$\u0027';
const goodTrailing = slash + singleBS + singleBS + '+$\u0027';

console.log('Looking for bad pattern:', JSON.stringify(badTrailing));
console.log('Replacing with:', JSON.stringify(goodTrailing));

// Find and replace all occurrences of trailing backslash pattern
let count = 0;
let idx = content.indexOf(badTrailing);
while (idx !== -1) {
  content = content.substring(0, idx) + goodTrailing + content.substring(idx + badTrailing.length);
  count++;
  idx = content.indexOf(badTrailing, idx + goodTrailing.length);
}

console.log('Fixed', count, 'trailing patterns');

// Also fix the first pattern: \/g (single backslash before /g)
const badFirst = slash + singleBS + 'g,';
const goodFirst = slash + singleBS + singleBS + 'g,';

count = 0;
idx = content.indexOf(badFirst);
while (idx !== -1) {
  content = content.substring(0, idx) + goodFirst + content.substring(idx + badFirst.length);
  count++;
  idx = content.indexOf(badFirst, idx + goodFirst.length);
}

console.log('Fixed', count, 'first patterns');

// Write
fs.writeFileSync(binPath, content, 'utf-8');
console.log('\n✓ Written to', binPath);

// Verify
const line867 = content.split('\n')[866];
console.log('\nLine 867:', line867.substring(50, 75));
const hex = Buffer.from(line867).toString('hex');
console.log('Hex 50-75:', hex.substring(100, 150));