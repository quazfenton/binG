/**
 * Test incomplete response detection
 */

import { detectIncompleteResponse } from './agent/feedback-injection';

// Test cases
const testCases = [
  {
    name: 'Mid-sentence',
    response: 'To create a web game like slither.io, we need to implement the following',
    expected: true,
  },
  {
    name: 'Unclosed code block',
    response: '```javascript\nfunction hello() {\n  console.log("hello',
    expected: true,
  },
  {
    name: 'Incomplete list',
    response: '1. First item\n2. Second item\n3.',
    expected: true,
  },
  {
    name: 'Unclosed JSON',
    response: '{"name": "test", "value":',
    expected: true,
  },
  {
    name: 'Complete response',
    response: 'To create a web game like slither.io, we need to implement the following features:\n\n1. Snake movement\n2. Food collection\n3. Collision detection',
    expected: false,
  },
  {
    name: 'Complete code block',
    response: '```javascript\nfunction hello() {\n  console.log("hello");\n}\n```',
    expected: false,
  },
  {
    name: 'User case from autocontinue.md',
    response: 'To create a web game like slither.io, we need to implement the following features:\n\n#### 1. index.html**This file will contain',
    expected: true,
  },
];

console.log('Testing incomplete response detection...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = detectIncompleteResponse(testCase.response);
  const success = result.detected === testCase.expected;
  
  if (success) {
    passed++;
    console.log(`✓ ${testCase.name}: ${result.detected ? 'detected' : 'not detected'} (confidence: ${result.confidence.toFixed(2)})`);
  } else {
    failed++;
    console.log(`✗ ${testCase.name}: expected ${testCase.expected ? 'detected' : 'not detected'}, got ${result.detected ? 'detected' : 'not detected'} (confidence: ${result.confidence.toFixed(2)})`);
    console.log(`  Reason: ${result.reason}`);
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('\n✓ All tests passed!');
  process.exit(0);
} else {
  console.log('\n✗ Some tests failed!');
  process.exit(1);
}