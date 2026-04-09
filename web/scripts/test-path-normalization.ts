import { stripWorkspacePrefixes } from '../lib/virtual-filesystem/scope-utils';

// Test cases from the logs
const tests = [
  { input: '/sessions', expected: 'sessions' },
  { input: '/sessions/001', expected: 'sessions/001' },
  { input: '/sessions/002', expected: 'sessions/002' },
  { input: '/src', expected: 'src' },
  { input: '/src/app.ts', expected: 'src/app.ts' },
  { input: 'project/sessions/001', expected: 'sessions/001' },
  { input: '/workspace/sessions/001', expected: 'sessions/001' },
  { input: '/tmp/workspaces/abc/sessions/001', expected: 'sessions/001' },
  { input: '/workspace/sessions/anon:123:001', expected: 'sessions/anon:123:001' },
];

console.log('VFS Path Normalization Tests:');
let allPass = true;
tests.forEach(t => {
  const result = stripWorkspacePrefixes(t.input);
  const pass = result === t.expected;
  if (!pass) allPass = false;
  console.log(pass ? '✅' : '❌', t.input, '->', result, pass ? '' : '(expected: ' + t.expected + ')');
});
console.log(allPass ? 'All tests passed!' : 'Some tests failed!');
process.exit(allPass ? 0 : 1);
