const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

// Find the line with 'import * as path from' and add __dirname polyfill after it
const pathImportIdx = lines.findIndex(l => l.includes('import * as path from') && l.includes('path'));
if (pathImportIdx >= 0) {
  // Check if we already have the ES module dirname polyfill
  if (!content.includes('fileURLToPath') && !content.includes('import.meta.url')) {
    // Add the ES module dirname polyfill after path import
    lines.splice(pathImportIdx + 1, 0, 
      '',
      '// ES module __dirname polyfill (required for tsx execution)',
      'import { fileURLToPath } from \u0027url\u0027;',
      'import { dirname } from \u0027path\u0027;',
      '',
      'const __filename = fileURLToPath(import.meta.url);',
      'const __dirname = dirname(__filename);'
    );
    console.log('Added ES module __dirname polyfill after line', pathImportIdx + 1);
  } else {
    console.log('ES module polyfill already exists');
  }
} else {
  console.log('Could not find path import');
}

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('File written');

// Verify
const verify = fs.readFileSync(binPath, 'utf-8');
if (verify.includes('const __dirname = dirname(__filename);')) {
  console.log('✓ __dirname polyfill is in place');
} else {
  console.log('✗ __dirname polyfill not found');
}