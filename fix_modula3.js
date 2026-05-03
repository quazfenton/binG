const fs = require('fs');
const filePath = 'packages/shared/agent/modula.ts';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Find all key line numbers
let switchOpen = -1, switchClose = -1, defaultCase = -1;
let returnResult = -1, orphanStart = -1, tryCatch = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line === '    switch (mode) {') switchOpen = i;
  if (switchOpen !== -1 && line === '    }' && switchClose === -1) switchClose = i;
  if (line.includes('// FALLBACK - Should never reach here')) defaultCase = i;
  if (line === '    return result;') returnResult = i;
  if (returnResult !== -1 && line.includes('// V1-API MODE') && orphanStart === -1) orphanStart = i;
  if (orphanStart !== -1 && line.includes('  } catch')) { tryCatch = i; break; }
}

console.log('switchOpen:', switchOpen);
console.log('switchClose:', switchClose, lines[switchClose]);
console.log('defaultCase:', defaultCase, lines[defaultCase]);
console.log('returnResult:', returnResult);
console.log('orphanStart:', orphanStart, lines[orphanStart]);
console.log('tryCatch:', tryCatch, lines[tryCatch]);

// Extract orphaned cases
const orphanedLines = lines.slice(orphanStart, tryCatch);

// Remove orphaned lines from after return result
const cleanedLines = [
  ...lines.slice(0, returnResult + 1),
  ...lines.slice(tryCatch)
];

// Now find where to insert in cleanedLines (before default case)
let insertPos = -1;
for (let i = 0; i < cleanedLines.length; i++) {
  if (cleanedLines[i].includes('// FALLBACK - Should never reach here')) {
    // Find the break before this default case
    for (let j = i - 1; j >= 0; j--) {
      if (cleanedLines[j].trim() === 'break;') {
        insertPos = j + 1;
        break;
      }
    }
    break;
  }
}

console.log('insertPos:', insertPos);

// Fix indentation of orphaned cases and insert
const fixedOrphaned = orphanedLines.map(line => {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('// =')) return '      ' + trimmed;
  if (trimmed.startsWith('case ') || trimmed === 'default:') return '      ' + trimmed;
  if (trimmed === '{' || trimmed === '}') return '      ' + trimmed;
  return '        ' + trimmed;
});

const result = [
  ...cleanedLines.slice(0, insertPos),
  '',
  ...fixedOrphaned,
  '',
  ...cleanedLines.slice(insertPos)
];

fs.writeFileSync(filePath, result.join('\n'), 'utf8');
console.log('Fixed! Orphaned cases moved into switch statement.');
