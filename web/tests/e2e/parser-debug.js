#!/usr/bin/env node
// Direct parser test

import { extractFencedFileEdits, extractCodeBlockFileEdits, extractTopLevelWrites, extractFileEdits } from '../../lib/chat/file-edit-parser';

const testContent = `\`\`\`file: test.js
console.log("test");
\`\`\``;

const testContent2 = `\`\`\`file: \`\`\`file: test1.js
\`\`\`file: test1.js
console.log("test1");
\`\`\`file: test1.js
console.log("test1");
\`\`\``;

console.log('Testing parser on sample content...\n');

console.log('=== Test 1: Clean format ===');
console.log('Input:', testContent);
const result1 = extractFencedFileEdits(testContent);
console.log('Result:', result1);

console.log('\n=== Test 2: Malformed format ===');
console.log('Input:', testContent2.slice(0, 100), '...');
const result2 = extractFencedFileEdits(testContent2);
console.log('Result:', result2);

console.log('\n=== Test 3: extractFileEdits ===');
const result3 = extractFileEdits(testContent2);
console.log('Result:', result3);

console.log('\n=== Test 4: Top-level writes ===');
const result4 = extractTopLevelWrites(testContent2);
console.log('Result:', result4);

// Now test with real data from test
const realContent = `\`\`\`file: \`\`\`file: test1.js
\`\`\`file: test1.js
console.log("test1");
\`\`\`file: test1.js
console.log("test1");
\`\`\`console.log("test1");console.log("test1");
\`\`\`file: test1.js
console.log("test1");
\`\`\`cons`;

console.log('\n=== Real content test ===');
const result5 = extractFencedFileEdits(realContent);
console.log('FencedFileEdits:', result5);

const result6 = extractFileEdits(realContent);
console.log('extractFileEdits:', result6);