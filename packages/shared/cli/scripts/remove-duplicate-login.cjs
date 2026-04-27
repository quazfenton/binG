const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Removing Duplicate Login Command ===\n');

// Find all login command registrations
const loginIndices = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.command(\u0027login\u0027)') || lines[i].includes('.command(\"login\")')) {
    loginIndices.push(i);
    console.log('Found login at line', i + 1);
  }
}

if (loginIndices.length < 2) {
  console.log('No duplicate login found');
  process.exit(0);
}

// Find and remove the second login block (lines 3212-3237 approximately)
const secondLogin = loginIndices[1];
console.log('Removing second login block starting at line', secondLogin + 1);

// Find the end of this block - look for }); after .action()
let endIdx = secondLogin;
let foundAction = false;
let braceCount = 0;

for (let i = secondLogin; i < lines.length && i < secondLogin + 100; i++) {
  const line = lines[i];
  
  if (line.includes('.action(') || line.includes('.action (')) {
    foundAction = true;
  }
  
  if (foundAction) {
    braceCount += (line.match(/[{|]/g) || []).length;
    braceCount -= (line.match(/[}|]/g) || []).length;
    
    if (braceCount <= 0 && line.includes('});')) {
      endIdx = i;
      break;
    }
  }
}

console.log('Removing lines', secondLogin + 1, 'to', endIdx + 1);
lines.splice(secondLogin, endIdx - secondLogin + 1);

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n✓ Removed duplicate login command');

// Verify
const newContent = fs.readFileSync(binPath, 'utf-8');
const remaining = [];
for (let i = 0; i < newContent.split('\n').length; i++) {
  if (newContent.split('\n')[i].includes('.command(\u0027login\u0027)') || newContent.split('\n')[i].includes('.command(\"login\")')) {
    remaining.push(i + 1);
  }
}
console.log('Remaining login commands at lines:', remaining.join(', '));