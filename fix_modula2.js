const fs = require('fs');
const filePath = 'packages/shared/agent/modula.ts';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Find key positions
let switchStart = -1, switchEnd = -1, defaultStart = -1, returnLine = -1;
let orphanStart = -1, orphanEnd = -1, tryCatchLine = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'switch (mode) {') switchStart = i;
  if (switchStart !== -1 && lines[i] === '    }' && switchEnd === -1) switchEnd = i;
  if (lines[i].includes('// FALLBACK - Should never reach here')) defaultStart = i;
  if (lines[i] === '    return result;') returnLine = i;
  if (returnLine !== -1 && lines[i].includes('// V1-API MODE') && orphanStart === -1) orphanStart = i;
  if (orphanStart !== -1 && lines[i].includes('  } catch')) { tryCatchLine = i; break; }
}
orphanEnd = tryCatchLine - 1;

console.log('switchEnd:', switchEnd, lines[switchEnd]);
console.log('defaultStart:', defaultStart, lines[defaultStart]);
console.log('returnLine:', returnLine, lines[returnLine]);
console.log('orphanStart:', orphanStart, lines[orphanStart]);
console.log('tryCatchLine:', tryCatchLine, lines[tryCatchLine]);

// The problem: orphaned cases are after return result, outside the switch
// We need to:
// 1. Remove orphaned cases from their current location
// 2. Insert them into the switch before the default case (with correct indentation)

// Get orphaned cases (from orphanStart to orphanEnd)
const orphanedCases = [];
for (let i = orphanStart; i <= orphanEnd; i++) {
  orphanedCases.push(lines[i]);
}

// Remove orphaned cases and everything between returnLine and tryCatchLine
const beforeReturn = lines.slice(0, returnLine + 1);
const afterOrphaned = lines.slice(tryCatchLine);

// Rebuild content without orphaned cases
const contentWithoutOrphaned = [...beforeReturn, ...afterOrphaned].join('\n');
const lines2 = contentWithoutOrphaned.split('\n');

// Now find where to insert the orphaned cases (before default case in the switch)
let defaultLine2 = -1;
for (let i = 0; i < lines2.length; i++) {
  if (lines2[i].includes('// FALLBACK - Should never reach here')) {
    defaultLine2 = i;
    break;
  }
}

// Find the line before default (the break statement of the previous case)
let insertLine = defaultLine2;
for (let i = defaultLine2 - 1; i >= 0; i--) {
  if (lines2[i].trim() === 'break;') {
    insertLine = i + 1;
    break;
  }
}

// Fix indentation of orphaned cases (case should be at 6 spaces, content at 8)
const fixedOrphaned = orphanedCases.map(line => {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('//')) {
    return '      ' + trimmed;
  }
  if (trimmed.startsWith('case ') || trimmed.startsWith('default:') || trimmed.startsWith('// ')) {
    return '      ' + trimmed;
  }
  return '        ' + trimmed;
});

// Insert into lines2
const resultLines = [
  ...lines2.slice(0, insertLine),
  '',
  ...fixedOrphaned,
  '',
  ...lines2.slice(insertLine)
];

fs.writeFileSync(filePath, resultLines.join('\n'), 'utf8');
console.log('Done! Orphaned cases moved into switch with correct indentation.');
console.log('Inserted at line:', insertLine);
