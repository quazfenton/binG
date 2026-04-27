const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Removing All Duplicate Commands (v2) ===\n');

// Find all .command() registrations - more inclusive regex
const commands = {};
const duplicates = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Match .command('...') including commands with args like 'agents:stop <agent>'
  const match = line.match(/\u002ecommand\u0028'\u0027([^'\u0022]+?)['\u0022]\u0029/);
  if (match) {
    const cmd = match[1];
    // Normalize command name - extract base command without arguments
    const baseCmd = cmd.split(' ')[0].split('<')[0];
    
    if (commands[baseCmd] !== undefined) {
      // Check if it's truly a duplicate (same base command)
      duplicates.push({ fullCmd: cmd, baseCmd, first: commands[baseCmd], second: i });
    } else {
      commands[baseCmd] = i;
    }
  }
}

console.log('Found', duplicates.length, 'duplicate commands:');
duplicates.forEach(d => console.log('  -', d.fullCmd, 'at lines', d.first + 1, 'and', d.second + 1));

if (duplicates.length === 0) {
  console.log('No duplicates found - checking for duplicates with different patterns...');
  
  // Try alternative pattern - commands might use different quoting
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match .command('...') or .command('...', ...)
    const match = line.match(/command\u0028['\u0022]([^'\"\u003e]+)/);
    if (match) {
      const cmd = match[1];
      console.log('Found:', cmd, 'at line', i + 1);
    }
  }
  process.exit(1);
}

// Remove duplicates (second occurrence) - work backwards
duplicates.reverse().forEach(d => {
  console.log('\nRemoving duplicate', d.fullCmd, 'starting at line', d.second + 1);
  
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
  
  console.log('  Removing lines', d.second + 1, 'to', endIdx + 1, '(', endIdx - d.second + 1, 'lines)');
  lines.splice(d.second, endIdx - d.second + 1);
});

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n✓ Removed', duplicates.length, 'duplicate commands');