const fs = require('fs');
const filePath = 'packages/shared/agent/modula.ts';
const content = fs.readFileSync(filePath, 'utf8');

// Split into lines
const lines = content.split('\n');
const totalLines = lines.length;
console.log('Total lines:', totalLines);

// Find key positions
let switchOpen = -1, switchClose = -1, defaultCase = -1;
let returnResult = -1, orphanStart = -1, orphanEnd = -1, tryCatch = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line === '    switch (mode) {') switchOpen = i;
  if (switchOpen !== -1 && line === '    }' && switchClose === -1) switchClose = i;
  if (line.includes('// FALLBACK - Should never reach here')) defaultCase = i;
  if (line === '    return result;') returnResult = i;
  if (returnResult !== -1 && line.includes('// V1-API MODE') && orphanStart === -1) orphanStart = i;
  if (orphanStart !== -1 && line === '  } catch (error: any) {') { tryCatch = i; break; }
}
orphanEnd = tryCatch - 1;

console.log('switchOpen:', switchOpen);
console.log('switchClose:', switchClose);
console.log('defaultCase:', defaultCase);
console.log('returnResult:', returnResult);
console.log('orphanStart:', orphanStart);
console.log('orphanEnd:', orphanEnd);
console.log('tryCatch:', tryCatch);

// Extract orphaned cases
const orphanedCases = lines.slice(orphanStart, orphanEnd + 1);

// Build new content:
// 1. Lines up to returnResult (inclusive)
// 2. Lines from tryCatch to end
// 3. But we also need to insert orphanedCases into the switch before defaultCase
const part1 = lines.slice(0, returnResult + 1);  // up to and including 'return result;'
const part2 = lines.slice(tryCatch);               // from '  } catch' to end

// Now we need to insert orphanedCases into the switch in part1
// Find where to insert (before defaultCase in part1)
let insertPos = -1;
for (let i = 0; i < part1.length; i++) {
  if (part1[i].includes('// FALLBACK - Should never reach here')) {
    // Find the break; before this default case
    for (let j = i - 1; j >= 0; j--) {
      if (part1[j].trim() === 'break;') {
        insertPos = j + 1; // after the break;
        break;
      }
    }
    break;
  }
}

console.log('insertPos in part1:', insertPos);

// Fix indentation of orphaned cases
// Switch cases should be at 6 spaces, content at 8 spaces
const fixedOrphaned = orphanedCases.map(line => {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('// ===')) return '      ' + trimmed;
  if (trimmed.startsWith('case ') || trimmed === 'default:' || trimmed === '{' || trimmed === '}') return '      ' + trimmed;
  return '        ' + trimmed;
});

// Insert into part1 at insertPos
const newPart1 = [
  ...part1.slice(0, insertPos),
  '',
  ...fixedOrphaned,
  '',
  ...part1.slice(insertPos)
];

// Combine everything
const result = [...newPart1, ...part2].join('\n');

fs.writeFileSync(filePath, result, 'utf8');
console.log('Done! Orphaned cases moved into switch with correct indentation.');
