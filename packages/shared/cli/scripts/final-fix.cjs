const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Final Fix ===\n');

// Fix 1: Fix trailing backslash pattern specifically
console.log('1. Fixing trailing backslash regex...');
// The pattern \/+$/ needs to be \\\/+$/ (double backslash)
const singleBS = String.fromCharCode(92);
const badPattern = singleBS + '/+$/';
const goodPattern = String.fromCharCode(92, 92) + '/+$/';

let fixed = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Only fix lines that have .replace pattern with trailing backslash
  if (line.includes('.replace(') && line.includes(badPattern) && !line.includes(goodPattern)) {
    lines[i] = line.split(badPattern).join(goodPattern);
    fixed++;
    console.log(`   Fixed line ${i + 1}`);
  }
}
console.log(`   ✓ Fixed ${fixed} trailing patterns`);

// Fix 2: Remove or uncomment the entire duplicate login block
console.log('\n2. Fixing duplicate login...');
const loginLines = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.command(\u0027login\u0027)') || lines[i].includes('.command(\"login\")')) {
    loginLines.push(i);
  }
}

// Find commented-out login and remove the comment
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim().startsWith('// .command(\u0027login\u0027)') || lines[i].trim().startsWith('// .command(\"login\")')) {
    // Find the end of this block and remove all lines from here to the closing });
    let endIdx = i;
    for (let j = i + 1; j < lines.length && j < i + 50; j++) {
      if (lines[j].includes('});')) {
        endIdx = j;
        break;
      }
    }
    // Remove all lines from i to endIdx
    lines.splice(i, endIdx - i + 1);
    console.log(`   ✓ Removed duplicate login block (lines ${i + 1} to ${endIdx + 1})`);
    break;
  }
}

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n=== Done ===');

// Verify
const verify = fs.readFileSync(binPath, 'utf-8');
const verifyLines = verify.split('\n');
console.log('\nVerification:');
console.log('- Line 877:', verifyLines[876]?.substring(54, 70));
console.log('- Line 878:', verifyLines[877]?.substring(62, 78));
console.log('- No dangling login:', !verify.includes('// .command(\u0027login\u0027) \u0027));')