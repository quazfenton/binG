import { extractFileEdits } from './lib/chat/file-edit-parser';

const content1 = 'I will create the file.\n\n<file_edit path="test.txt">\nHello World\n</file_edit>\n\nDone.';
console.log('Test 1 - file_edit with newlines:');
const r1 = extractFileEdits(content1);
console.log(JSON.stringify(r1, null, 2));

const content2 = 'I will create the file.\n\n<file_edit path="test2.txt">Hello World</file_edit>\n\nDone.';
console.log('\nTest 2 - file_edit inline:');
const r2 = extractFileEdits(content2);
console.log(JSON.stringify(r2, null, 2));
