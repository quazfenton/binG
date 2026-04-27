const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(bin.ts, 'utf-8');
const lines = content.split('\n');

// Check what's actually there
console.log('Line 870:', lines[869]);
console.log('Line 871:', lines[870]);

// The invalid pattern is: replace(/\//g
// We need: replace(/\\/g
// In the source, /\//g has: slash-backslash-forward-slash-slash-g (5 chars for regex part)
// We need: slash-backslash-backslash-forward-slash-slash-g (6 chars)

// Replace the exact string
const badStr = 'replace(/\\//g';
const goodStr = 'replace(/\\\\/g';

console.log('Bad string:', badStr, 'length:', badStr.length);
console.log('Good string:', goodStr, 'length:', goodStr.length);

// Also fix the trailing pattern
const badStr2 = 'replace(/\\//+$';
const goodStr2 = 'replace(/\\\\/+$';

console.log('Bad string 2:', badStr2, 'length:', badStr2.length);
console.log('Good string 2:', goodStr2, 'length:', goodStr2.length);

// Count occurrences before
console.log('\nBefore: occurrences of bad pattern 1:', (content.match(/replace\/\\/\/g/g) || []).length);
console.log('Before: occurrences of bad pattern 2:', (content.match(/replace\/\\/\/+/g) || []).length);

// Do replacements
let newContent = content.split(badStr).join(goodStr);
newContent = newContent.split(badStr2).join(goodStr2);

console.log('\nAfter: occurrences of good pattern 1:', (newContent.match(/replace\/\\\\/g/g) || []).length);
console.log('After: occurrences of good pattern 2:', (newContent.match(/replace\/\\\\/+/g) || []).length);

// Write
fs.writeFileSync(binPath, newContent, 'utf-8');

// Verify
const verify = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('\nVerification:');
console.log('870:', verify[869]);
console.log('871:', verify[870]);