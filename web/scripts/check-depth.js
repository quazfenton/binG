const fs = require('fs');
const content = fs.readFileSync(process.argv[2], 'utf-8');
const lines = content.split('\n');
let depth = 0;
for (let i = 515; i < 650; i++) {
  const line = lines[i];
  if (!line) continue;
  for (const ch of line) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (i >= 615 && i <= 628) {
    console.log('Line ' + (i+1) + ' (depth ' + depth + '): ' + line.trim());
  }
}
console.log('Final depth at line 650:', depth);
