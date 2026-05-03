const fs = require('fs');
let content = fs.readFileSync('lib/chat/file-edit-parser.ts', 'utf8');

// Remove the broken extractFunctionCallEdits function
const startMarker = 'export function extractFunctionCallEdits';
const startIdx = content.indexOf(startMarker);
if (startIdx !== -1) {
  let braceCount = 0;
  let foundStart = false;
  let endIdx = -1;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === '{') { braceCount++; foundStart = true; }
    if (content[i] === '}') { braceCount--; }
    if (foundStart && braceCount === 0) { endIdx = i + 1; break; }
  }
  if (endIdx !== -1) {
    content = content.slice(0, startIdx) + content.slice(endIdx);
    console.log('Removed function');
  }
}

// Remove duplicate broken lines from sed - look for lines that are just regex fragments
const lines = content.split('\n');
const filteredLines = lines.filter(line => {
  const trimmed = line.trim();
  // Filter out lines that are just regex fragments like "<]+)/i.exec(funcBody);"
  if (trimmed.match(/^<]\+\)/i)) return false;
  if (trimmed.match(/^<]\+\)\/i\.exec\(funcBody\);$/)) return false;
  return true;
});
content = filteredLines.join('\n');

// Fix hasAnyMarker - remove the <function= addition
content = content.replace(
  "content.includes('```toolcall') || content.includes('<function=');",
  "content.includes('```toolcall');"
);

// Remove the function call
content = content.replace(
  /\n {2}if \(content\.includes\('<function='\)\)\s*\{\s*\n\s*allEdits\.push\(\.\.\.extractFunctionCallEdits\(content\)\);\s*\n\s*\}/g,
  ''
);

fs.writeFileSync('lib/chat/file-edit-parser.ts', content);
console.log('Done fixing');