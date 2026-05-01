const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Comprehensive Fix for bin.ts ===\n');

// Fix 1: Add ES module __dirname polyfill after path import
console.log('1. Adding ES module __dirname polyfill...');
const pathImportIdx = lines.findIndex(l => l.includes('import * as path from'));
if (pathImportIdx >= 0 && !content.includes('fileURLToPath')) {
  const polyfill = [
    '',
    '// ES module __dirname polyfill (required for tsx execution)',
    'import { fileURLToPath } from \u0027url\u0027;',
    'import { dirname } from \u0027path\u0027;',
    '',
    'const __filename = fileURLToPath(import.meta.url);',
    'const __dirname = dirname(__filename);'
  ];
  lines.splice(pathImportIdx + 1, 0, ...polyfill);
  console.log('   ✓ Added ES module polyfill');
} else {
  console.log('   ✓ Already has polyfill or no path import');
}

// Fix 2: Add RTK CLI import
console.log('2. Adding RTK CLI import...');
const readableImportIdx = lines.findIndex(l => l.includes('import { Readable } from'));
if (readableImportIdx >= 0 && !content.includes('./lib/rtk-cli-commands')) {
  lines.splice(readableImportIdx + 1, 0, 
    '',
    '// RTK CLI Commands - Token-optimized command execution for LLM consumption',
    'import { registerRTKCommands } from \"./lib/rtk-cli-commands\";'
  );
  console.log('   ✓ Added RTK import');
} else {
  console.log('   ✓ RTK import already exists or no Readable import');
}

// Fix 3: Add registerRTKCommands call before program.parse()
console.log('3. Adding registerRTKCommands call...');
const parseIdx = lines.findIndex(l => l.includes('} else {') && lines[lines.indexOf(l) + 1]?.includes('program.parse()'));
if (parseIdx >= 0 && !content.includes('registerRTKCommands(program)')) {
  const insertCode = [
    '    // Register RTK commands for token-optimized command execution',
    '    try {',
    '      registerRTKCommands(program);',
    '    } catch (err) {',
    '      console.warn(\u0027Warning: RTK commands not available:\u0027, err.message);',
    '    }',
    ''
  ];
  lines.splice(parseIdx + 1, 0, ...insertCode);
  console.log('   ✓ Added registerRTKCommands call');
} else {
  console.log('   ✓ registerRTKCommands already called or no parse found');
}

// Fix 4: Fix broken return statement
console.log('4. Fixing broken return statement...');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'return  +' && lines[i + 1]?.trim() === ';') {
    lines[i] = '  return `Workspace boundary: \u0024{targetPath} is outside workspace root \u0024{root}. Destructive operations on paths outside the workspace require explicit confirmation.`;';
    lines[i + 1] = '';
    console.log('   ✓ Fixed broken return at line', i + 1);
    break;
  }
}

// Fix 5: Fix invalid regex patterns
console.log('5. Fixing invalid regex patterns...');
// Pattern: /\//g needs to become /\\//g (double backslash in source)
const bad1 = '/\\//g';
const good1 = '/\\\\/g';
const bad2 = '/\\//+$/';
const good2 = '/\\\\/+$/';

let count1 = 0, count2 = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(bad1)) {
    lines[i] = lines[i].split(bad1).join(good1);
    count1++;
  }
  if (lines[i].includes(bad2)) {
    lines[i] = lines[i].split(bad2).join(good2);
    count2++;
  }
}
console.log(`   ✓ Fixed ${count1} instances of /\\/g pattern`);
console.log(`   ✓ Fixed ${count2} instances of /\\/+$/ pattern`);

// Fix 6: Remove duplicate login command (keep line ~3008, remove ~3218)
console.log('6. Removing duplicate login command...');
const loginIndices = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('.command(\u0027login\u0027)') || lines[i].includes('.command(\"login\")')) {
    loginIndices.push(i);
  }
}
if (loginIndices.length > 1) {
  // Remove the second login command block (after first)
  const secondLogin = loginIndices[1];
  // Find the end of this block by counting braces from .action
  let endIdx = secondLogin;
  let braceCount = 0;
  let inAction = false;
  for (let i = secondLogin; i < lines.length && i < secondLogin + 50; i++) {
    if (lines[i].includes('.action(')) inAction = true;
    if (inAction) {
      braceCount += (lines[i].match(/\\{/g) || []).length;
      braceCount -= (lines[i].match(/\\}/g) || []).length;
      if (braceCount === 0 && lines[i].includes(');')) {
        endIdx = i;
        break;
      }
    }
  }
  lines.splice(secondLogin, endIdx - secondLogin + 1);
  console.log(`   ✓ Removed duplicate login command (${endIdx - secondLogin + 1} lines)`);
} else {
  console.log('   ✓ No duplicate login found');
}

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n=== File written ===');

// Final verification
const verify = fs.readFileSync(binPath, 'utf-8');
console.log('\nVerification:');
console.log('- ES module polyfill:', verify.includes('const __dirname = dirname(__filename);') ? '✓' : '✗');
console.log('- RTK import:', verify.includes('./lib/rtk-cli-commands') ? '✓' : '✗');
console.log('- registerRTKCommands:', verify.includes('registerRTKCommands(program)') ? '✓' : '✗');
console.log('- Double backslash regex:', (verify.match(/\\\\\\\\/g/g) || []).length > 0 ? '✓' : '✗');
console.log('- Single login command:', (verify.match(/\/login/g) || []).length <= 3 ? '✓' : '✗');