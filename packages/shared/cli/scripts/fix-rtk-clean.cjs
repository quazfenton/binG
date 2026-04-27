const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== RTK CLI Integration Fix ===\n');

const sBS = String.fromCharCode(92);  // single backslash
const dBS = String.fromCharCode(92, 92);  // double backslash

// 1. ES module __dirname polyfill
console.log('1. ES module __dirname polyfill...');
const pIdx = lines.findIndex(l => l.includes('import * as path from'));
if (pIdx >= 0 && !content.includes('fileURLToPath')) {
  lines.splice(pIdx + 1, 0, '', 'import { fileURLToPath } from url;', 'import { dirname } from path;', '', 'const __filename = fileURLToPath(import.meta.url);', 'const __dirname = dirname(__filename);');
  console.log('   ✓ Added');
} else {
  console.log('   ✓ Already exists');
}

// 2. RTK CLI import
console.log('2. RTK CLI import...');
const rIdx = lines.findIndex(l => l.includes('import { Readable } from'));
if (rIdx >= 0 && !content.includes('./lib/rtk-cli-commands')) {
  lines.splice(rIdx + 1, 0, '', '// RTK CLI Commands - Token-optimized command execution for LLM consumption', 'import { registerRTKCommands } from \"./lib/rtk-cli-commands\";');
  console.log('   ✓ Added');
} else {
  console.log('   ✓ Already exists');
}

// 3. registerRTKCommands call with try-catch
console.log('3. registerRTKCommands call...');
const parseIdx = lines.findIndex((l, i) => l.includes('program.parse()') && lines[i-1]?.trim() === '}');
if (parseIdx >= 0 && !content.includes('registerRTKCommands(program)')) {
  lines.splice(parseIdx, 0, '    // Register RTK commands for token-optimized execution', '    try {', '      registerRTKCommands(program);', '    } catch (err) {', '      console.warn(\u0027RTK commands not available:\u0027, err.message);', '    }', '');
  console.log('   ✓ Added');
} else {
  console.log('   ✓ Already exists');
}

// 4. Fix broken return statement (line 884: return  + \r)
console.log('4. Fixing broken return statement...');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim() === 'return  +' || (line.includes('return') && line.includes('+') && line.trim().endsWith('+'))) {
    console.log(`   Found broken return at line ${i + 1}`);
    // Check if next line is just semicolon
    if (lines[i + 1]?.trim() === ';') {
      lines.splice(i, 2, '    return null;');
      console.log('   ✓ Fixed');
    }
  }
}

// 5. Fix regex patterns with single backslash
console.log('5. Fixing regex patterns...');
const badPattern1 = sBS + '/g';
const goodPattern1 = dBS + '/g';
const badPattern2 = sBS + '/+$/';
const goodPattern2 = dBS + '/+$/';

let fixed = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('.replace(') && line.includes(badPattern1) && !line.includes(goodPattern1)) {
    lines[i] = line.split(badPattern1).join(goodPattern1);
    fixed++;
    console.log(`   Fixed line ${i + 1} (first pattern)`);
  }
  if (line.includes('.replace(') && line.includes(badPattern2) && !line.includes(goodPattern2)) {
    lines[i] = lines[i].split(badPattern2).join(goodPattern2);
    fixed++;
    console.log(`   Fixed line ${i + 1} (trailing pattern)`);
  }
}
console.log(`   ✓ Fixed ${fixed} patterns`);

// Write the file
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n✓ Written to', binPath);

// Verify key lines
const v = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('\nVerification:');
console.log('- Has ES module polyfill:', content.includes('fileURLToPath') || v.some(l => l.includes('fileURLToPath')));
console.log('- Has RTK import:', v.some(l => l.includes('registerRTKCommands')));
console.log('- Has registerRTKCommands call:', v.some(l => l.includes('registerRTKCommands(program)')));