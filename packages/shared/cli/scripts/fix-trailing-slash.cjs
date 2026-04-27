const fs = require('fs');
const binPath = 'bin.ts';
let content = fs.readFileSync(binPath, 'utf-8');

// Fix the trailing backslash pattern: /\\/+$/ → /\\/+$/
// This pattern matches one or more trailing backslashes at end of string

const wrongPattern = '/\\/+$/';
const rightPattern = '/\\/+$/';

console.log('Looking for wrong pattern:', wrongPattern);

if (content.includes(wrongPattern)) {
  content = content.split(wrongPattern).join(rightPattern);
  fs.writeFileSync(binPath, content, 'utf-8');
  console.log('Fixed! Verifying...');
  
  const lines = fs.readFileSync(binPath, 'utf-8').split('\n');
  console.log('Line 870:', lines[869]);
  console.log('Line 871:', lines[870]);
} else {
  console.log('Pattern not found');
}