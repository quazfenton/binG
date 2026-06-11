/**
 * Test the new extractCodeBlockFileEdits function
 */
import { extractCodeBlockFileEdits, extractFileEdits } from './lib/chat/file-edit-parser.js';

// Test 1: ```javascript // calculator.js pattern
const test1 = `\`\`\`javascript
// calculator.js

function add(a, b) {
  return a + b;
}

module.exports = { add };
\`\`\``;

console.log('Test 1: ```javascript // calculator.js');
const edits1 = extractCodeBlockFileEdits(test1);
console.log('  extractCodeBlockFileEdits:', edits1.length, 'edits');
if (edits1.length > 0) {
  console.log('  Path:', edits1[0].path);
  console.log('  Content length:', edits1[0].content.length);
  console.log('  Has add function:', edits1[0].content.includes('function add'));
}

const allEdits1 = extractFileEdits(test1);
console.log('  extractFileEdits:', allEdits1.length, 'edits');
if (allEdits1.length > 0) {
  console.log('  Path:', allEdits1[0].path);
}

// Test 2: ```python # hello.py
const test2 = `\`\`\`python
# hello.py

print("Hello World")
\`\`\``;

console.log('\nTest 2: ```python # hello.py');
const edits2 = extractCodeBlockFileEdits(test2);
console.log('  Edits:', edits2.length);
if (edits2.length > 0) {
  console.log('  Path:', edits2[0].path);
}

// Test 3: ```typescript with // file: path
const test3 = `\`\`\`typescript
// file: utils.ts

export function helper() {
  return 42;
}
\`\`\``;

console.log('\nTest 3: ```typescript // file: utils.ts');
const edits3 = extractCodeBlockFileEdits(test3);
console.log('  Edits:', edits3.length);
if (edits3.length > 0) {
  console.log('  Path:', edits3[0].path);
}
