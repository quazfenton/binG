const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Fixing Duplicate Login Command ===\n');

// Find all login command registrations
const loginIndices = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.command(\u0027login\u0027)') || lines[i].includes('.command(\"login\")')) {
    loginIndices.push(i);
  }
}

console.log('Found', loginIndices.length, 'login commands at lines:', loginIndices.map(x => x + 1).join(', '));

if (loginIndices.length > 1) {
  // Remove the second login block (wrap in multi-line comment)
  const secondIdx = loginIndices[1];
  
  // Find where this block ends - look for }); that closes the .action() callback
  let endIdx = secondIdx;
  let braceCount = 0;
  let foundAction = false;
  
  for (let i = secondIdx; i < lines.length && i < secondIdx + 50; i++) {
    const line = lines[i];
    if (line.includes('.action(') || line.includes('.description(') || line.includes('.option(')) {
      foundAction = true;
    }
    if (foundAction) {
      braceCount += (line.match(/\\{/g) || []).length;
      braceCount -= (line.match(/\\}/g) || []).length;
      if (braceCount === 0 && line.trim() === '});') {
        endIdx = i;
        break;
      }
    }
  }
  
  console.log('Removing lines', secondIdx + 1, 'to', endIdx + 1);
  
  // Remove the entire block
  lines.splice(secondIdx, endIdx - secondIdx + 1);
  console.log('Removed', endIdx - secondIdx + 1, 'lines');
} else {
  console.log('No duplicate found');
}

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n=== Done ===');

// Verify
const verify = fs.readFileSync(binPath, 'utf-8').split('\n');
const remaining = verify.filter(l => l.includes('.command(\u0027login\u0027)') || l.includes('.command(\"login\")')).length;
console.log('Login commands remaining:', remaining);