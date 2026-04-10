// Test optimized extractCodeBlockFileEdits
const filenameRegex = /(?:\/\/|#)\s*(?:file(?:name)?[:\s]*)?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]+)|["']([a-zA-Z0-9_\-/.]+\.[a-zA-Z]+)["']|\/\*\s*(?:file(?:name)?[:\s]*)?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]+)\s*\*\//i;

// Test 1: // calculator.js
const t1 = '// calculator.js';
const m1 = t1.match(filenameRegex);
console.log('Test 1:', t1, '→', m1 ? m1[1] || m1[2] || m1[3] : 'null');

// Test 2: // file: utils.ts
const t2 = '// file: utils.ts';
const m2 = t2.match(filenameRegex);
console.log('Test 2:', t2, '→', m2 ? m2[1] || m2[2] || m2[3] : 'null');

// Test 3: # hello.py
const t3 = '# hello.py';
const m3 = t3.match(filenameRegex);
console.log('Test 3:', t3, '→', m3 ? m3[1] || m3[2] || m3[3] : 'null');

// Test 4: "package.json"
const t4 = '"package.json"';
const m4 = t4.match(filenameRegex);
console.log('Test 4:', t4, '→', m4 ? m4[1] || m4[2] || m4[3] : 'null');

// Test 5: no filename (should be null)
const t5 = 'const x = 1;';
const m5 = t5.match(filenameRegex);
console.log('Test 5:', t5, '→', m5 ? m5[1] || m5[2] || m5[3] : 'null');

// Test O(1) guard
const guard = /```(?:javascript|js|typescript|ts|python|py|json|html|css|bash|sh|md)\b/i;
console.log('\nO(1) guard tests:');
console.log('  Has ```javascript:', guard.test('```javascript\n// calc.js'));
console.log('  Has no code blocks:', guard.test('just regular text'));
console.log('  Has ```python:', guard.test('```python\n# hello.py'));
