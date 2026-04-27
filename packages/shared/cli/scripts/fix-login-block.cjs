const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Removing Second Login Command Block ===\n');

// Find all login command registrations
const loginIndices = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.command(\u0027login\u0027)') || lines[i].includes('.command(\"login\")')) {
    loginIndices.push(i);
  }
}

console.log('Found', loginIndices.length, 'login command registrations at lines:', loginIndices.map(x => x + 1).join(', '));

if (loginIndices.length > 1) {
  // Find the second login command block
  const secondLoginIdx = loginIndices[1];
  
  // Find where this block ends - look for }); that closes the .action() callback
  let endIdx = secondLoginIdx;
  let braceCount = 0;
  let foundAction = false;
  
  for (let i = secondLoginIdx; i < lines.length && i < secondLoginIdx + 100; i++) {
    const line = lines[i];
    
    // Track if we're inside an action callback
    if (line.includes('.action(') || line.includes('.action (') || line.includes('.option(') || line.includes('.description(')) {
      foundAction = true;
    }
    
    // Count braces when we're in the action block
    if (foundAction) {
      braceCount += (line.match(/\\{/g) || []).length;
      braceCount -= (line.match(/\\}/g) || []).length;
      
      // Look for }); that closes the action callback
      if (braceCount === 0 && line.includes('});')) {
        endIdx = i;
        break;
      }
    }
  }
  
  console.log('Removing lines', secondLoginIdx + 1, 'to', endIdx + 1, '(', endIdx - secondLoginIdx + 1, 'lines)');
  
  // Remove the entire block
  lines.splice(secondLoginIdx, endIdx - secondLoginIdx + 1);
  console.log('Removed');
} else {
  console.log('No duplicate to remove');
}

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n=== Done ===');

// Verify
const verify = fs.readFileSync(binPath, 'utf-8').split('\n');
const newLoginCount = verify.filter(l => l.includes('.command(\u0027login\u0027)') || l.includes('.command(\"login\")')).length;
console.log('Login commands remaining:', newLoginCount);

// Run tsc to verify
console.log('\nChecking TypeScript...');
const { execSync } = require('child_process');
try {
  execSync('npx tsc --noEmit bin.ts', { cwd: binPath.replace('bin.ts', ''), stdio: 'pipe' });
  console.log('✓ No TypeScript errors!');
} catch (e) {
  console.log('TypeScript errors:', e.stdout?.toString() || e.message);
}