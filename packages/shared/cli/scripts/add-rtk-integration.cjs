const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Adding RTK CLI Integration ===\n');

let changes = 0;

// 1. Add RTK import after Readable import
const readableIdx = lines.findIndex(l => l.includes('import { Readable } from'));
if (readableIdx >= 0 && !content.includes('rtk-cli-commands')) {
  lines.splice(readableIdx + 1, 0,
    '',
    '// RTK CLI Commands - Token-optimized command execution for LLM consumption',
    'import { registerRTKCommands } from \"./lib/rtk-cli-commands\";'
  );
  changes++;
  console.log('✓ Added RTK import at line', readableIdx + 2);
} else {
  console.log('RTK import already exists or Readable not found');
}

// 2. Add registerRTKCommands call before program.parse()
const parseIdx = lines.findIndex((l, i) => l.includes('program.parse()') && lines[i - 1]?.trim() === '}');
if (parseIdx >= 0 && !content.includes('registerRTKCommands(program)')) {
  lines.splice(parseIdx, 0,
    '',
    '    // Register RTK commands for token-optimized command execution',
    '    try {',
    '      registerRTKCommands(program);',
    '    } catch (err) {',
    '      console.warn(\u0027RTK commands not available:\u0027, err.message);',
    '    }',
    ''
  );
  changes++;
  console.log('✓ Added registerRTKCommands call before line', parseIdx + 1);
} else {
  console.log('registerRTKCommands call already exists or program.parse not found');
}

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('\n✓ Applied', changes, 'changes');

// Verify
const newContent = fs.readFileSync(binPath, 'utf-8');
console.log('\nVerification:');
console.log('- Has RTK import:', newContent.includes('./lib/rtk-cli-commands'));
console.log('- Has registerRTKCommands call:', newContent.includes('registerRTKCommands(program)'));