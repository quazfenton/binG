const fs = require('fs');
const binPath = 'bin.ts';

let lines = fs.readFileSync(binPath, 'utf-8').split('\n');

// Directly set the corrected lines with correct quotes (single quotes like original)
// Line 870: Need /\\/g (double backslash in source = valid regex for backslash)
lines[869] = '  const normRoot = root.replace(/\\\\/g, \u0027/\u0027).replace(/\\\\/+$/, \u0027\u0027);';
// Line 871: Same pattern  
lines[870] = '  const normTarget = targetPath.replace(/\\\\/g, \u0027/\u0027).replace(/\\\\/+$/, \u0027\u0027);';

console.log('Set line 870:', lines[869]);
console.log('Set line 871:', lines[870]);

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('File written');

// Quick verify
const verify = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('\nVerify line 870:', verify[869]);
console.log('Verify line 871:', verify[870]);