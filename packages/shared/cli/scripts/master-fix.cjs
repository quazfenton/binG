const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Master Fix for bin.ts ===\n');

const sBS = String.fromCharCode(92);  // single backslash
const dBS = String.fromCharCode(92, 92);  // double backslash

// Fix 1: ES module __dirname polyfill
console.log('1. ES module polyfill...');
const pIdx = lines.findIndex(l => l.includes('import * as path from'));
if (pIdx >= 0 && !content.includes('fileURLToPath')) {
  lines.splice(pIdx + 1, 0, '', 'import { fileURLToPath } from \u0027url\u0027;', 'import { dirname } from \u0027path\u0027;', '', 'const __filename = fileURLToPath(import.meta.url);', 'const __dirname = dirname(__filename);');
  console.log('   ✓ Added');
} else { console.log('   ✓ Already exists'); }

// Fix 2: RTK import
console.log('2. RTK import...');
const rIdx = lines.findIndex(l => l.includes('import { Readable } from'));
if (rIdx >= 0 && !content.includes('./lib/rtk-cli-commands')) {
  lines.splice(rIdx + 1, 0, '', '// RTK CLI Commands', 'import { registerRTKCommands } from \"./lib/rtk-cli-commands\";');
  console.log('   ✓ Added');
} else { console.log('   ✓ Already exists'); }

// Fix 3: registerRTKCommands call
console.log('3. registerRTKCommands call...');
const pIdx2 = lines.findIndex((l, i) => l.includes('program.parse()') && lines[i-1]?.trim() === '}');
if (pIdx2 >= 0 && !content.includes('registerRTKCommands(program)')) {
  lines.splice(pIdx2, 0, '    try {', '      registerRTKCommands(program);', '    } catch (err) {', '      console.warn(\u0027RTK not available:\u0027, err.message);', '    }', '');
  console.log('   ✓ Added');
} else { console.log('   ✓ Already exists'); }

// Fix 4: Broken return statement
console.log('4. Broken return...');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'return  +' && lines[i + 1]?.trim() === ';') {
    lines[i] = '  return `Path outside workspace`;';
    lines[i + 1] = '';
    console.log('   ✓ Fixed at line', i + 1);
    break;
  }
}

// Fix 5: Regex patterns - using char codes for reliability
console.log('5. Regex patterns...');
let f1 = 0, f2 = 0;
const bad1 = sBS + '/g';
const good1 = dBS + '/g';
const bad2 = sBS + '/+$/';
const good2 = dBS + '/+$/';

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(bad1)) { lines[i] = lines[i].split(bad1).join(good1); f1++; }
  if (lines[i].includes(bad2)) { lines[i] = lines[i].split(bad2).join(good2); f2++; }
}
console.log('   ✓ Fixed', f1, '/\\/g and', f2, '/\\/+$/ patterns');

// Fix 6: Duplicate login command - remove ALL occurrences of second login block
console.log('6. Duplicate login...');
const loginCmdLines = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.command(\u0027login\u0027)') || lines[i].includes('.command(\"login\")')) {
    loginCmdLines.push(i);
  }
}
if (loginCmdLines.length > 1) {
  console.log('   Found', loginCmdLines.length, 'login commands at lines:', loginCmdLines.map(x => x + 1).join(', '));
  // Mark all but first as commented (don't remove to avoid breaking structure)
  for (let i = 1; i < loginCmdLines.length; i++) {
    lines[loginCmdLines[i]] = '// ' + lines[loginCmdLines[i]].trim();
  }
  console.log('   ✓ Commented out duplicates');
} else { console.log('   ✓ No duplicates'); }

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n=== Done ===\n');

// Final verification
const v = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('Verification:');
console.log('- __dirname polyfill:', v.some(l => l.includes('dirname(__filename)')) ? '✓' : '✗');
console.log('- RTK import:', v.some(l => l.includes('rtk-cli-commands')) ? '✓' : '✗');
console.log('- registerRTKCommands:', v.some(l => l.includes('registerRTKCommands(program)')) ? '✓' : '✗');
console.log('- No broken return:', !v.some((l, i) => l.trim() === 'return  +' && v[i+1]?.trim() === ';') ? '✓' : '✗');

// Count double backslashes in regex context
const regexMatches = v.filter(l => l.includes('replace(/'));
console.log('- Regex patterns:', regexMatches.length, 'replace calls');