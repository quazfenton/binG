const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Removing All Duplicate Agent Commands ===\n');

// Find all .command() registrations
const commands = {};
const duplicates = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Match .command('name') or .command('name', ...)
  const match = line.match(/\u002ecommand\u0028'\u0027([^'\u0022]+)['\u0022]/);
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

// Remove duplicates (second occurrence) - work backwards
duplicates.reverse().forEach(d => {
  console.log('\nRemoving duplicate', d.cmd, 'starting at line', d.second + 1);
  
  // Find end of this command block - look for }); after .action()
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
  
  console.log('  Removing lines', d.second + 1, 'to', endIdx + 1, '(', endIdx - d.second + 1, 'lines)');
  lines.splice(d.second, endIdx - d.second + 1);
});

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n✓ Removed', duplicates.length, 'duplicate commands');

// Verify no more duplicates
const newContent = fs.readFileSync(binPath, 'utf-8');
const newLines = newContent.split('\n');
const newCmds = {};
let remaining = [];
for (let i = 0; i < newLines.length; i++) {
  const match = newLines[i].match(/\u002ecommand\u0028'\u0027([^'\u0022]+)['\u0022]/);
  if (match) {
    if (newCmds[match[1]] !== undefined) {
      remaining.push(match[1] + ' (lines ' + (newCmds[match[1]] + 1) + ', ' + (i + 1) + ')');
    } else {
      newCmds[match[1]] = i;
    }
  }
}
console.log('Remaining duplicates:', remaining.length > 0 ? remaining.join(', ') : 'None');