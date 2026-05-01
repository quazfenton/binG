const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Removing Duplicate agents:stop Command ===\n');

// Find the second agents:stop command
let secondIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.command(\u0027agents:stop') || lines[i].includes('.command(\"agents:stop')) {
    if (i > 2400) { // Skip the first one at ~2454
      secondIdx = i;
      console.log('Found second agents:stop at line', i + 1);
      break;
    }
  }
}

if (secondIdx < 0) {
  console.log('Could not find second agents:stop');
  process.exit(1);
}

// Find end of this block
let endIdx = secondIdx;
let foundAction = false;
let braceCount = 0;

for (let i = secondIdx; i < lines.length && i < secondIdx + 100; i++) {
  const line = lines[i];
  if (line.includes('.action(') || line.includes('.action (')) {
    foundAction = true;
  }
  if (foundAction) {
    braceCount += (line.match(/[{]/g) || []).length;
    braceCount -= (line.match(/[}]/g) || []).length;
    if (braceCount <= 0 && line.includes('});')) {
      endIdx = i;
      break;
    }
  }
}

console.log('Removing lines', secondIdx + 1, 'to', endIdx + 1, '(', endIdx - secondIdx + 1, 'lines)');
lines.splice(secondIdx, endIdx - secondIdx + 1);

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n✓ Removed duplicate agents:stop');

// Verify
const newContent = fs.readFileSync(binPath, 'utf-8');
const count = (newContent.match(/agents:stop/g) || []).length;
console.log('Remaining agents:stop references:', count);