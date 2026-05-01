const fs = require('fs');
const binPath = 'bin.ts';
let content = fs.readFileSync(binPath, 'utf-8');

// The regex /\\/g is invalid - need /\\/g (escaped backslash)
// In the file, /\\/g appears as: slash, backslash, forward-slash, slash, g
// Should be: slash, backslash, backslash, forward-slash, slash, g

// The pattern we're looking for is literally: / \/
const invalid = '/\\/g';  // This is slash-backslash-forward-slash-slash-g
const valid = '/\\/g';     // This is slash-backslash-backslash-forward-slash-slash-g

console.log('Current file has /\\/g pattern?', content.includes(invalid));

// Replace the invalid pattern
const count = (content.match(/\/\\\/g/g) || []).length;
console.log('Found', count, 'occurrences');

// Use a simple string replacement
content = content.split(invalid).join(valid);

fs.writeFileSync(binPath, content, 'utf-8');
console.log('Fixed - now checking result...');

// Verify
const newContent = fs.readFileSync(binPath, 'utf-8');
const lines = newContent.split('\n');
console.log('Line 870:', lines[869]);
console.log('Line 871:', lines[870]);