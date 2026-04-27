const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'bin.ts');
let content = fs.readFileSync(binPath, 'utf-8');

console.log('=== Fixing Regex Patterns (Corrected) ===\n');

// Use char codes for reliable matching
// Current (wrong): \/  = / \/ (forward slash, backslash, forward slash)
// Should be: \\/ = / \\ \/ (forward slash, backslash, backslash, forward slash)

const singleBS = String.fromCharCode(92);  // backslash
const slash = String.fromCharCode(47);      // forward slash

// Pattern to find: \/+$\u0027 (backward: /\/\/$')
// Actually: /\/+$/  = slash, backslash, plus, dollar, slash
// Current wrong: /\/+$/  (single backslash)
// Should be: /\\/+$/  (double backslash)

// The regex pattern ends with /, not '
const badTrailing = slash + singleBS + '+$\u0027';  // WRONG - missing closing /
const badTrailing2 = slash + singleBS + '+$\u0027'; // WRONG end

// Actual pattern: /\/+$/
const badTrailingCorrect = slash + singleBS + '+' + slash;  // /\/+$
const goodTrailing = slash + singleBS + singleBS + '+' + slash;  // /\\/+$/

console.log('Looking for:', JSON.stringify(badTrailingCorrect));
console.log('Replace with:', JSON.stringify(goodTrailing));

// Find and replace all occurrences of trailing backslash pattern
let count = 0;
let idx = content.indexOf(badTrailingCorrect);
while (idx !== -1) {
  content = content.substring(0, idx) + goodTrailing + content.substring(idx + badTrailingCorrect.length);
  count++;
  idx = content.indexOf(badTrailingCorrect, idx + goodTrailing.length);
}

console.log('Fixed', count, 'trailing patterns');

// Also fix the first pattern: \/g (single backslash before /g)
// Current wrong: /\/g  (slash, backslash, slash, g)
// Should be: /\\/g (slash, backslash, backslash, slash, g)
const badFirst = slash + singleBS + slash;  // /\/ 
const goodFirst = slash + singleBS + singleBS + slash;  // /\\\/

// Actually the first pattern should match: \/g,
const badFirstPattern = slash + singleBS + slash + 'g,';
const goodFirstPattern = slash + singleBS + singleBS + slash + 'g,';

count = 0;
idx = content.indexOf(badFirstPattern);
while (idx !== -1) {
  content = content.substring(0, idx) + goodFirstPattern + content.substring(idx + badFirstPattern.length);
  count++;
  idx = content.indexOf(badFirstPattern, idx + goodFirstPattern.length);
}

console.log('Fixed', count, 'first patterns');

// Write
fs.writeFileSync(binPath, content, 'utf-8');
console.log('\n✓ Written to', binPath);

// Verify
const lines = content.split('\n');
for (let i = 865; i <= 868 && i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('.replace(')) {
    console.log('\nLine ' + (i + 1) + ':', line.substring(line.indexOf('.replace(')));
    const hex = Buffer.from(line).toString('hex');
    console.log('Hex:', hex.substring(hex.indexOf('282f') * 2, (hex.indexOf('282f') + 30) * 2));
  }
}