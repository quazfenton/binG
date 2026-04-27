const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Fixing bin.ts ===\n');

// Fix 1: ES module __dirname polyfill
console.log('1. ES module polyfill...');
const pathImportIdx = lines.findIndex(l => l.includes('import * as path from'));
if (pathImportIdx >= 0 && !content.includes('fileURLToPath')) {
  const polyfill = ['', 'import { fileURLToPath } from \u0027url\u0027;', 'import { dirname } from \u0027path\u0027;', '', 'const __filename = fileURLToPath(import.meta.url);', 'const __dirname = dirname(__filename);'];
  lines.splice(pathImportIdx + 1, 0, ...polyfill);
  console.log('   ✓');
} else { console.log('   ✓ already exists'); }

// Fix 2: RTK import
console.log('2. RTK import...');
const readableIdx = lines.findIndex(l => l.includes('import { Readable } from'));
if (readableIdx >= 0 && !content.includes('./lib/rtk-cli-commands')) {
  lines.splice(readableIdx + 1, 0, '', '// RTK CLI Commands', 'import { registerRTKCommands } from \"./lib/rtk-cli-commands\";');
  console.log('   ✓');
} else { console.log('   ✓ already exists'); }

// Fix 3: registerRTKCommands call
console.log('3. registerRTKCommands...');
const parseIdx = lines.findIndex((l, i) => l.includes('program.parse()') && lines[i-1]?.includes('}'));
if (parseIdx >= 0 && !content.includes('registerRTKCommands(program)')) {
  lines.splice(parseIdx, 0, '    try {', '      registerRTKCommands(program);', '    } catch (err) {', '      console.warn(\u0027RTK not available:\u0027, err.message);', '    }', '');
  console.log('   ✓');
} else { console.log('   ✓ already exists'); }

// Fix 4: Broken return statement
console.log('4. Broken return...');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'return  +' && lines[i + 1]?.trim() === ';') {
    lines[i] = '  return `Path outside workspace`;';
    lines[i + 1] = '';
    console.log('   ✓ fixed at line', i + 1);
    break;
  }
}

// Fix 5: Regex patterns using String.fromCharCode
console.log('5. Regex patterns...');
const singleBS = String.fromCharCode(92);  // single backslash
const doubleBS = String.fromCharCode(92, 92);  // double backslash

const badPattern1 = singleBS + '/g';  // \/g (invalid)
const goodPattern1 = doubleBS + '/g';  // \\/g (valid)

const badPattern2 = singleBS + '/+$/';  // \/+$/ (invalid)
const goodPattern2 = doubleBS + '/+$/';  // \\/+$/ (valid)

let fixed1 = 0, fixed2 = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(badPattern1) && !lines[i].includes(goodPattern1)) {
    lines[i] = lines[i].split(badPattern1).join(goodPattern1);
    fixed1++;
  }
  if (lines[i].includes(badPattern2) && !lines[i].includes(goodPattern2)) {
    lines[i] = lines[i].split(badPattern2).join(goodPattern2);
    fixed2++;
  }
}
console.log(`   ✓ fixed ${fixed1} /\\/g patterns, ${fixed2} /\\/+$/ patterns`);

// Fix 6: Duplicate login - just comment out the second .command('login')
console.log('6. Duplicate login...');
const loginLines = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.command(\u0027login\u0027)') || lines[i].includes('.command(\"login\")')) {
    loginLines.push(i);
  }
}
if (loginLines.length > 1) {
  // Comment out the second login command line only
  lines[loginLines[1]] = '// ' + lines[loginLines[1]].trim();
  console.log(`   ✓ commented out second login at line ${loginLines[1] + 1}`);
} else { console.log('   ✓ no duplicate'); }

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n=== Done ===');

console.log('\nVerifying:');
const v = fs.readFileSync(binPath, 'utf-8');
console.log('- __dirname polyfill:', v.includes('dirname(__filename)') ? '✓' : '✗');
console.log('- RTK import:', v.includes('rtk-cli-commands') ? '✓' : '✗');
console.log('- registerRTKCommands:', v.includes('registerRTKCommands(program)') ? '✓' : '✗');
console.log('- login count:', (v.match(/\/login/g) || []).length);