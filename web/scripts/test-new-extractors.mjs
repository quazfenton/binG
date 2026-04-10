import { extractCodeBlockFirstLineFilename, extractExplicitCreateCommands, extractJsonLikePathContent } from './lib/chat/file-edit-parser.ts';

// Test 1: First-line filename extraction
const test1 = 'Here is the file:\n```javascript\nproject/test.js\nconst x = 42;\n```';
const r1 = extractCodeBlockFirstLineFilename(test1);
console.log('Test 1 (first-line filename):', r1.length > 0 ? 'PASS' : 'FAIL', JSON.stringify(r1));

// Test 2: Explicit create commands
const test2 = 'I will create a file called project/hello.js with this content:\nconst hello = 123;';
const r2 = extractExplicitCreateCommands(test2);
console.log('Test 2 (explicit create):', r2.length > 0 ? 'PASS' : 'FAIL', JSON.stringify(r2));

// Test 3: JSON-like path:content
const test3 = 'path: project/test.txt\ncontent: Hello world this is the file content';
const r3 = extractJsonLikePathContent(test3);
console.log('Test 3 (json-like):', r3.length > 0 ? 'PASS' : 'FAIL', JSON.stringify(r3));

// Test 4: O(1) gate — no false positives
const test4 = 'Just some regular text about nothing important';
const t4a = extractCodeBlockFirstLineFilename(test4).length === 0;
const t4b = extractExplicitCreateCommands(test4).length === 0;
const t4c = extractJsonLikePathContent(test4).length === 0;
console.log('Test 4 (O(1) gate):', t4a && t4b && t4c ? 'PASS' : 'FAIL');

// Test 5: Reject code as path
const test5 = '```javascript\nconst x = 42;\n```';
console.log('Test 5 (reject code as path):', extractCodeBlockFirstLineFilename(test5).length === 0 ? 'PASS' : 'FAIL');
