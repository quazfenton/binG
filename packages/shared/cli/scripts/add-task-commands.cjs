/**
 * Script to add task commands integration to bin.ts
 * 
 * Adds:
 * 1. Import statement for registerTaskCommands
 * 2. Registration call before program.parse()
 */

const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'bin.ts');

if (!fs.existsSync(binPath)) {
  console.error('bin.ts not found at:', binPath);
  process.exit(1);
}

let content = fs.readFileSync(binPath, 'utf-8');

// 1. Add import statement after registerRTKCommands import
const importLine = 'import { registerRTKCommands } from \"./lib/rtk-cli-commands.js\";';
const importIdx = content.indexOf(importLine);

if (importIdx < 0) {
  console.error('Could not find registerRTKCommands import');
  process.exit(1);
}

const insertPoint = content.indexOf('\n', importIdx + importLine.length) + 1;
content = content.slice(0, insertPoint) + '\nimport { registerTaskCommands } from \"./lib/task-commands.js\";' + content.slice(insertPoint);

// 2. Add registration call before program.parse()
const parseLine = 'program.parse();';
const parseIdx = content.indexOf(parseLine);

if (parseIdx < 0) {
  console.error('Could not find program.parse call');
  process.exit(1);
}

// Add registration before parse line
const registerCode = `
  // Register Task Commands
  try {
    registerTaskCommands(program, apiRequest, prompt);
  } catch (err) {
    console.warn('Task commands not available:', err.message);
  }

`;

content = content.slice(0, parseIdx) + registerCode + content.slice(parseIdx);

fs.writeFileSync(binPath, content);
console.log('✓ Added task commands integration to bin.ts');