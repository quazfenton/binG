const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

// Line 870 (index 869): Fix regex patterns
const line870 = lines[869];
const line871 = lines[870];

console.log('Before:');
console.log('870:', line870);
console.log('871:', line871);

// The pattern in source is: /\//g (single backslash)
// We need: /\\//g (double backslash) which makes valid regex /\\/g (one backslash)

if (line870 && line870.includes('replace(/\\//g')) {
  // Replace the invalid regex pattern
  lines[869] = line870
    .replace(/\/\//g, '/\\/g')  // Fix /\//g -> /\\//g
    .replace(/\/\/+/g, '/\\\\/+/g');  // Fix /\/+ -> /\\/+ (for trailing pattern)
  console.log('\nFixed line 870');
}

if (line871 && line871.includes('replace(/\\//g')) {
  lines[870] = line871
    .replace(/\/\//g, '/\\/g')
    .replace(/\/\/+/g, '/\\\\/+/g');
  console.log('Fixed line 871');
}

console.log('\nAfter:');
console.log('870:', lines[869]);
console.log('871:', lines[870]);

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\nFile written');

// Verify it was written
const verify = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('\nVerification:');
console.log('870:', verify[869]);
console.log('871:', verify[870]);