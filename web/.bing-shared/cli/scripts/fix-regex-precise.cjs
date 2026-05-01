const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

// Find and fix the invalid patterns on lines 870-871
// We need to change /\//g to /\\//g (2 backslashes become 1 in regex)
// And /\//+$/ to /\\//+$/ (same fix for trailing pattern)

let fixed = false;
for (let i = 869; i <= 870; i++) {
  const line = lines[i];
  if (line && line.includes('.replace(/\\//g')) {
    // The pattern /\//g needs to become /\\//g
    // This means: slash-backslash-forward-slash-slash-g -> slash-backslash-backslash-forward-slash-slash-g
    
    // Replace the specific pattern
    lines[i] = line.replace(/\/\/g/g, '/\\\\/g');
    fixed = true;
    console.log(`Fixed line ${i+1}: ${lines[i]}`);
  }
  if (lines[i] && line.includes('.replace(/\\//')) {
    // Also fix the trailing pattern /\/+$/
    lines[i] = lines[i].replace(/\/\/+/g, '/\\\\/+/g');
    console.log(`Fixed trailing pattern on line ${i+1}: ${lines[i]}`);
  }
}

if (fixed) {
  fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
  console.log('\nFile written');
  
  // Verify
  const newContent = fs.readFileSync(binPath, 'utf-8');
  const newLines = newContent.split('\n');
  console.log('\nVerification:');
  for (let i = 869; i <= 870; i++) {
    console.log(`Line ${i+1}: ${newLines[i]}`);
  }
} else {
  console.log('No changes needed or pattern not found');
  console.log('\nCurrent lines:');
  for (let i = 869; i <= 870; i++) {
    console.log(`Line ${i+1}: ${lines[i]}`);
  }
}