const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

// Fix lines 870 and 871 (1-indexed, so 869 and 870 in 0-indexed)
for (let i = 869; i <= 870; i++) {
  if (lines[i] && lines[i].includes('replace(/\\//g')) {
    // The pattern /\/g needs to become /\\/g
    lines[i] = lines[i].replace(/\/\\\//g, '/\\\\/g');
  }
  if (lines[i] && lines[i].includes('replace(/\\/+')) {
    // The pattern /\/+$ needs to become /\\/+
    lines[i] = lines[i].replace(/\/\\\/\/+/g, '/\\\\/+/g');
  }
}

// Write back
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('Fixed lines 870-871');

// Verify
const newLines = fs.readFileSync(binPath, 'utf-8').split('\n');
for (let i = 869; i <= 870; i++) {
  console.log(`Line ${i+1}: ${newLines[i]}`);
}