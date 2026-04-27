const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');

console.log('=== Adding ES Module Polyfill ===\n');

// Check if already has it
if (content.includes('fileURLToPath')) {
  console.log('Already has ES module polyfill');
  process.exit(0);
}

// Find the path import line
const pathImportLine = content.indexOf('import * as path from');
if (pathImportLine === -1) {
  console.log('Could not find path import');
  process.exit(1);
}

// Find the end of that line
let lineEnd = content.indexOf('\n', pathImportLine);
if (lineEnd === -1) lineEnd = content.length;

// Add the polyfill after the path import
const polyfill = '\n\nimport { fileURLToPath } from \u0027url\u0027;\nimport { dirname } from \u0027path\u0027;\n\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);';

content = content.substring(0, lineEnd) + polyfill + content.substring(lineEnd);

fs.writeFileSync(binPath, content, 'utf-8');
console.log('Added ES module polyfill');

// Verify
const newContent = fs.readFileSync(binPath, 'utf-8');
console.log('Has fileURLToPath:', newContent.includes('fileURLToPath'));
console.log('Has __dirname:', newContent.includes('const __dirname = dirname(__filename)'));