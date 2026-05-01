const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Removing All Duplicate Commands ===\n');

// Find all command registrations and their duplicates
const commands = {};
const duplicates = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const match = line.match(/\u002ecommand\u0028['\u0022]([^'\u0022]+)['\u0022]\u0029/);
  if (match) {
    const cmd = match[1];
    if (commands[cmd] !== undefined) {
      duplicates.push({ cmd, first: commands[cmd], second: i });
    } else {
      commands[cmd] = i;
    }
  }
}

console.log('Found', duplicates.length, 'duplicate commands:');
duplicates.forEach(d => console.log('  -', d.cmd, 'at lines', d.first + 1, 'and', d.second + 1));

// Remove duplicates (second occurrence) - work backwards to preserve line numbers
duplicates.reverse().forEach(d => {
  console.log('Removing duplicate', d.cmd, 'at line', d.second + 1);
  
  // Find end of this command block
  let endIdx = d.second;
  let foundAction = false;
  let braceCount = 0;
  
  for (let i = d.second; i < lines.length && i < d.second + 100; i++) {
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
  
  console.log('  Removing lines', d.second + 1, 'to', endIdx + 1);
  lines.splice(d.second, endIdx - d.second + 1);
});

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n✓ Removed', duplicates.length, 'duplicate commands');

// Verify
const newContent = fs.readFileSync(binPath, 'utf-8');
const newCommands = {};
let remaining = [];
for (let i = 0; i < newContent.split('\n').length; i++) {
  const match = newContent.split('\n')[i].match(/\u002ecommand\u0028['\u0022]([^'\u0022]+)['\u0022]\u0029/);
  if (match) {
    if (newCommands[match[1]] !== undefined) {
      remaining.push(match[1]);
    } else {
      newCommands[match[1]] = i;
    }
  }
}
console.log('Remaining duplicates:', remaining.length > 0 ? remaining.join(', ') : 'None');