const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, 'bin.ts');
let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Comprehensive Fix for bin.ts ===\n');

let changes = 0;

function addLinesAfter(lines, condition, newLines) {
  const idx = lines.findIndex(condition);
  if (idx >= 0) {
    lines.splice(idx + 1, 0, ...newLines);
    return true;
  }
  return false;
}

// 1. ES module __dirname polyfill
console.log('1. ES module __dirname polyfill...');
if (addLinesAfter(lines, l => l.includes('import * as path from'), [
  '',
  'import { fileURLToPath } from \u0027url\u0027;',
  'import { dirname } from \u0027path\u0027;',
  '',
  'const __filename = fileURLToPath(import.meta.url);',
  'const __dirname = dirname(__filename);'
])) {
  changes++;
  console.log('   ✓ Added ES module polyfill');
} else {
  console.log('   ✓ Already exists or not needed');
}

// 2. RTK CLI import
console.log('2. RTK CLI import...');
if (addLinesAfter(lines, l => l.includes('import { Readable } from'), [
  '',
  '// RTK CLI Commands - Token-optimized command execution',
  'import { registerRTKCommands } from \u0022./lib/rtk-cli-commands\u0022;'
])) {
  changes++;
  console.log('   ✓ Added RTK import');
} else {
  console.log('   ✓ Already exists');
}

// 3. registerRTKCommands call
console.log('3. registerRTKCommands call...');
const parseIdx = lines.findIndex((l, i) => l.includes('program.parse()') && lines[i - 1]?.trim() === '}');
if (parseIdx >= 0 && !lines.some(l => l.includes('registerRTKCommands(program)'))) {
  lines.splice(parseIdx, 0,
    '    // Register RTK commands for token-optimized execution',
    '    try {',
    '      registerRTKCommands(program);',
    '    } catch (err) {',
    '      console.warn(\u0027RTK commands not available:\u0027, err.message);',
    '    }',
    ''
  );
  changes++;
  console.log('   ✓ Added registerRTKCommands call');
} else {
  console.log('   ✓ Already exists or program.parse not found');
}

// 4. Fix broken return statement (return  + ;)
console.log('4. Fixing broken return statement...');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line === 'return  +' || line === 'return++') {
    if (lines[i + 1]?.trim() === ';') {
      lines[i] = '    return null;';
      lines.splice(i + 1, 1);
      changes++;
      console.log('   ✓ Fixed at line', i + 1);
    }
  }
}

// 5. Fix regex patterns - use simple string replacement on full content
console.log('5. Fixing regex patterns...');
const sBS = String.fromCharCode(92);
const dBS = sBS + sBS;

// Pattern 1: \/\/g should be \\/\\/g (escaping for regex literal)
// The file contains: \/\\g  (single backslash before /)
// Need: \\/\\g  (double backslash)
const old1 = '/\\' + sBS + 'g';
const new1 = '/\\' + dBS + 'g';

const old2 = '/\\' + sBS + '+$\u0027';
const new2 = '/\\' + dBS + '+$\u0027';

let contentFixed = content;
if (contentFixed.includes(old1)) {
  contentFixed = contentFixed.split(old1).join(new1);
  changes++;
  console.log('   ✓ Fixed first regex pattern');
}
if (contentFixed.includes(old2)) {
  contentFixed = contentFixed.split(old2).join(new2);
  changes++;
  console.log('   ✓ Fixed trailing regex pattern');
}

// Write the fixed content
fs.writeFileSync(binPath, contentFixed, 'utf-8');
console.log('\n✓ Applied', changes, 'changes');
console.log('✓ Written to', binPath);

// Quick verification
const newContent = fs.readFileSync(binPath, 'utf-8');
console.log('\nVerification:');
console.log('- ES module polyfill:', newContent.includes('fileURLToPath'));
console.log('- RTK import:', newContent.includes('registerRTKCommands'));
console.log('- registerRTK call:', newContent.includes('registerRTKCommands(program)'));
console.log('- Broken return fixed:', !newContent.includes('return  +'));