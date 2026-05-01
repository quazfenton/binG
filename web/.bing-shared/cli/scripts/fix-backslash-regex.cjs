const fs = require('fs');
const binPath = 'bin.ts';
let content = fs.readFileSync(binPath, 'utf-8');

// Fix the invalid regex /\\/g - it should be /\\/g to match backslash
// In regex, to match a literal backslash you need to escape it: \\
// So /\\/g means: start regex, match literal backslash, match forward slash, end regex, global flag
// This is wrong. The correct pattern is /\\/g which is: start regex, match literal backslash, end regex, global flag

// Find and replace the invalid pattern
// The pattern in the file appears as: /\\/g (which is invalid)
// It should be: /\\/g (which means match backslash)

const invalidPattern = '/\\/g';
const validPattern = '/\\/g';

if (content.includes(invalidPattern)) {
  // Count occurrences
  const count = (content.match(/\/\\\/g/g) || []).length;
  console.log(`Found ${count} occurrences of invalid regex /\\/g`);
  
  // Replace
  content = content.split(invalidPattern).join(validPattern);
  console.log('Fixed: replaced /\\/g with /\\/g');
  
  fs.writeFileSync(binPath, content, 'utf-8');
  console.log('File updated');
} else {
  console.log('Pattern not found - may already be fixed or different encoding');
  // Debug: show what replace patterns we have
  const replaceMatches = content.match(/\/\\\\+\/g/g);
  console.log('Found regex patterns:', replaceMatches);
}