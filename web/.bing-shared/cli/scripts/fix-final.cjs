const fs = require('fs');
const binPath = 'bin.ts';

let lines = fs.readFileSync(binPath, 'utf-8').split('\n');

console.log('Current line 870:', lines[869]);
console.log('Current line 871:', lines[870]);

// Set the corrected lines with valid regex patterns
// /\\/g means double backslash in source = valid regex matching one backslash
lines[869] = '  const normRoot = root.replace(/\\\\/g, \u0027/\u0027).replace(/\\\\/+$/, \u0027\u0027);';
lines[870] = '  const normTarget = targetPath.replace(/\\\\/g, \u0027/\u0027).replace(/\\\\/+$/, \u0027\u0027);';

console.log('\nNew line 870:', lines[869]);
console.log('New line 871:', lines[870]);

// Write back
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');

// Verify
const verify = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('\nVerification:');
console.log('870:', JSON.stringify(verify[869]));
console.log('871:', JSON.stringify(verify[870]));