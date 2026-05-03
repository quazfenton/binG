const fs = require('fs');
const filePath = 'packages/shared/agent/modula.ts';
const content = fs.readFileSync(filePath, 'utf8');

// The orphaned cases are after 'return result;' and before the closing '}\n\n  } catch'
// We need to move them inside the switch, before the default case

const lines = content.split('\n');

// Find key line numbers
let returnResultLine = -1;
let switchEndLine = -1;
let defaultCaseLine = -1;
let orphanedStartLine = -1;
let orphanedEndLine = -1;
let tryCatchLine = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('return result;') && returnResultLine === -1) {
    returnResultLine = i;
  }
  if (lines[i].trim() === '}') {
    // Check if this is the switch closing (next non-empty line is not a case/default)
    let nextNonEmpty = i + 1;
    while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') nextNonEmpty++;
    if (nextNonEmpty < lines.length && !lines[nextNonEmpty].includes('case ') && !lines[nextNonEmpty].includes('default:')) {
      switchEndLine = i;
    }
  }
  if (lines[i].includes('// FALLBACK - Should never reach here')) {
    defaultCaseLine = i;
  }
  if (lines[i].includes("// V1-API MODE") && returnResultLine !== -1 && i > returnResultLine) {
    orphanedStartLine = i;
  }
  if (lines[i].includes('  } catch') && orphanedStartLine !== -1 && orphanedEndLine === -1) {
    tryCatchLine = i;
  }
}

// Find the end of orphaned cases (the line before '  } catch')
for (let i = tryCatchLine - 1; i > orphanedStartLine; i--) {
  if (lines[i].trim() !== '') {
    orphanedEndLine = i;
    break;
  }
}

console.log('returnResultLine:', returnResultLine);
console.log('switchEndLine:', switchEndLine);
console.log('defaultCaseLine:', defaultCaseLine);
console.log('orphanedStartLine:', orphanedStartLine);
console.log('orphanedEndLine:', orphanedEndLine);
console.log('tryCatchLine:', tryCatchLine);

// Extract orphaned cases
const orphanedCases = lines.slice(orphanedStartLine, orphanedEndLine + 1).join('\n');

// Find where to insert (before the default case, adjust indentation)
const insertPoint = defaultCaseLine;
const beforeDefault = lines.slice(0, insertPoint);
const afterDefault = lines.slice(insertPoint);

// Fix indentation of orphaned cases (should be at 6 spaces for case, 8 for content)
const fixedOrphaned = orphanedCases.split('\n').map(line => {
  if (line.trim().startsWith('case ') || line.trim().startsWith('// ') || line.trim().startsWith('default:')) {
    return '      ' + line.trim();
  } else if (line.trim() !== '') {
    return '        ' + line.trim();
  }
  return '';
}).join('\n');

// Build new content: beforeDefault + fixedOrphaned + afterDefault (without orphaned cases)
// First, remove orphaned cases from after return result
const newLines = [
  ...lines.slice(0, returnResultLine + 1),
  ...lines.slice(orphanedEndLine + 1, tryCatchLine)
];

// Now insert orphaned cases before default
const returnResultIdx = newLines.findIndex(l => l.includes('return result;'));
const newDefaultIdx = newLines.findIndex((l, i) => i > returnResultIdx && l.includes('// FALLBACK'));

const finalLines = [
  ...newLines.slice(0, newDefaultIdx),
  ...fixedOrphaned.split('\n'),
  '',
  ...newLines.slice(newDefaultIdx)
];

fs.writeFileSync(filePath, finalLines.join('\n'), 'utf8');
console.log('Done! Orphaned cases moved and indentation fixed.');
