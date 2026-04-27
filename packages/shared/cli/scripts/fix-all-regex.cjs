const fs = require('fs');
const binPath = 'bin.ts';
let content = fs.readFileSync(binPath, 'utf-8');

// Fix both regex patterns:
// 1. /\\/g → /\\/g (match backslash)
// 2. /\\/+$/ → /\\/+$/ (match trailing backslashes)

// Pattern 1: single backslash in replace
const invalid1 = '/\\/g';
const valid1 = '/\\/g';
const count1 = (content.match(/\/\\\/g/g) || []).length;
console.log(`Found ${count1} occurrences of /\\/g`);
content = content.split(invalid1).join(valid1);

// Pattern 2: trailing backslash pattern /\\/+$/
const invalid2 = '/\\/+$/';
const valid2 = '/\\/+$/';
const count2 = (content.match(/\/\\\/\/\/\/\/\/\//g) || []).length;
console.log(`Found ${count2} occurrences of /\\/+$/`);
content = content.split(invalid2).join(valid2);

fs.writeFileSync(binPath, content, 'utf-8');
console.log('Fixed all regex patterns');

// Verify
const lines = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('Line 870:', lines[869]);
console.log('Line 871:', lines[870]);