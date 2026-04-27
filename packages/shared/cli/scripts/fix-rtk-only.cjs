const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== RTK CLI Integration Only ===\n');

const sBS = String.fromCharCode(92);
const dBS = String.fromCharCode(92, 92);

let changes = [];

// 1. ES module __dirname polyfill
console.log('1. ES module polyfill...');
const pIdx = lines.findIndex(l => l.includes('import * as path from'));
if (pIdx >= 0 && !content.includes('fileURLToPath')) {
  lines.splice(pIdx + 1, 0, '', 'import { fileURLToPath } from \u0027url\u0027;', 'import { dirname } from \u0027path\u0027;', '', 'const __filename = fileURLToPath(import.meta.url);', 'const __dirname = dirname(__filename);');
  changes.push('ES module polyfill');
  console.log('   ✓ Added');
} else {
  console.log('   ✓ Already exists or path import not found');
}

// 2. RTK import
console.log('2. RTK import...');
const rIdx = lines.findIndex(l => l.includes('import { Readable } from'));
if (rIdx >= 0 && !content.includes('./lib/rtk-cli-commands')) {
  lines.splice(rIdx + 1, 0, '', '// RTK CLI Commands - Token-optimized command execution for LLM consumption', 'import { registerRTKCommands } from \"./lib/rtk-cli-commands\";');
  changes.push('RTK import');
  console.log('   ✓ Added');
} else {
  console.log('   ✓ Already exists or Readable import not found');
}

// 3. registerRTKCommands call
console.log('3. registerRTKCommands...');
const parseIdx = lines.findIndex((l, i) => l.includes('program.parse()') && lines[i-1]?.trim() === '}');
if (parseIdx >= 0 && !content.includes('registerRTKCommands(program)')) {
  lines.splice(parseIdx, 0, '    // Register RTK commands for token-optimized command execution', '    try {', '      registerRTKCommands(program);', '    } catch (err) {', '      console.warn(\u0027RTK commands not available:\u0027, err.message);', '    }', '');
  changes.push('registerRTKCommands call');
  console.log('   ✓ Added');
} else {
  console.log('   ✓ Already exists or program.parse not found');
}

// 4. Fix broken return statement only if found
console.log('4. Broken return...');
let brokenReturnFixed = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'return  +' && lines[i + 1]?.trim() === ';') {
    lines[i] = '  return `Workspace boundary: \u0024{targetPath} is outside workspace root \u0024{root}. Destructive operations on paths outside the workspace require explicit confirmation.`;';
    lines[i + 1] = '';
    changes.push('Broken return at line ' + (i + 1));
    console.log('   ✓ Fixed at line', i + 1);
    brokenReturnFixed = true;
    break;
  }
}
if (!brokenReturnFixed) {
  console.log('   ✓ Not found');
}

// 5. Fix regex patterns only on lines around 870-871
console.log('5. Regex patterns...');
let f1 = 0, f2 = 0;
const bad1 = sBS + '/g';
const good1 = dBS + '/g';
const bad2 = sBS + '/+$/';
const good2 = dBS + '/+$/';

for (let i = 868; i <= 872 && i < lines.length; i++) {
  if (lines[i] && lines[i].includes(bad1)) { 
    lines[i] = lines[i].split(bad1).join(good1); 
    f1++; 
  }
  if (lines[i] && lines[i].includes(bad2)) { 
    lines[i] = lines[i].split(bad2).join(good2); 
    f2++; 
  }
}
console.log(`   ✓ Fixed ${f1} /\\/g and ${f2} /\\/+$/ patterns`);

// DO NOT touch duplicate login - leave as is

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n=== Done ===');
console.log('Changes:', changes.join(', ') || 'none');

// Verify
const v = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('\nVerification:');
console.log('- __dirname:', v.some(l => l.includes('dirname(__filename)')) ? '✓' : '✗');
console.log('- RTK import:', v.some(l => l.includes('rtk-cli-commands')) ? '✓' : '✗');
console.log('- registerRTKCommands:', v.some(l => l.includes('registerRTKCommands(program)')) ? '✓' : '✗');