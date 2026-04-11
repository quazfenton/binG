// Quick test: directly test the parser with LLM output
import { extractFileEdits, extractCompactFileEdits } from '../../lib/chat/file-edit-parser';

const testCases = [
  {
    name: 'Compact file_edit with newline',
    content: '<file_edit path="test.txt">\nHello World\n</file_edit>',
    expected: ['test.txt'],
  },
  {
    name: 'Compact file_edit inline',
    content: '<file_edit path="test.txt">Hello World</file_edit>',
    expected: ['test.txt'],
  },
  {
    name: 'Function format',
    content: `write_file("test.txt", "Hello World")`,
  },
];

// Run tests
async function runTests() {
  for (const tc of testCases) {
    try {
      const edits = extractFileEdits(tc.content);
      const paths = edits.map(e => e.path);
      console.log(`${tc.name}: ${paths.join(', ')}`);
    } catch (e) {
      console.error(`${tc.name}: ERROR - ${e}`);
    }
  }
}

runTests().catch(console.error);