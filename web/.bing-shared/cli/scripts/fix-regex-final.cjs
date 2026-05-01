const fs = require('fs');
const binPath = 'bin.ts';
let content = fs.readFileSync(binPath, 'utf-8');

// Current state: /\\/g (single backslash in regex) - WRONG
// Correct state: /\\/g (double backslash in regex means literal backslash) - RIGHT

// Check what we have
const lines = content.split('\n');
console.log('Line 870:', lines[869]);
console.log('Line 871:', lines[870]);

// The pattern in file appears as: /\\/g (1 backslash)
// We need: /\\/g (2 backslashes in file = 1 backslash matched in regex)

// Find the exact pattern and replace
// The file has: replace(/\//g, '/')
// It should be: replace(/\\/g, '/')

const wrongPattern = '/\\/g';  // slash-backslash-forward-slash-slash-g
const rightPattern = '/\\/g';   // slash-backslash-backslash-forward-slash-slash-g

console.log('\\nLooking for wrong pattern:', wrongPattern);

// Count occurrences
const regex = new RegExp(wrongPattern.replace(/[-\/\\^$*+?.()|[\\]{}]/g, '\\$&'), 'g');
const matches = content.match(regex);
console.log('Found', matches ? matches.length : 0, 'matches');

// Do the replacement
if (content.includes(wrongPattern)) {
  content = content.split(wrongPattern).join(rightPattern);
  fs.writeFileSync(binPath, content, 'utf-8');
  console.log('\\nFixed! New lines:');
  const newLines = fs.readFileSync(binPath, 'utf-8').split('\n');
  console.log('Line 870:', newLines[869]);
  console.log('Line 871:', newLines[870]);
} else {
  console.log('Pattern not found - may already be correct');
}