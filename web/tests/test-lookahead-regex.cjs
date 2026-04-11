// Test negative lookahead regex
const regex = /```(?:javascript|js|typescript|ts|jsx|tsx|python|py|json|html|css|bash|sh|markdown|md)(?:\s+(?!\/\/|#|\/\*)([^\n]+?))?\n([\s\S]*?)```/gi;

// Test 1: ```javascript file: utils.js
const test1 = "```javascript file: utils.js\nexport function slugify(text) { return text; }\n```";
console.log('Test 1: ```javascript file: utils.js');
let match;
regex.lastIndex = 0;
while ((match = regex.exec(test1)) !== null) {
  console.log('  langLine (group 1):', JSON.stringify(match[1]));
  console.log('  blockContent (group 2):', match[2].slice(0, 60));
  if (match[1] && /^file[:\s]/i.test(match[1].trim())) {
    const path = match[1].trim().replace(/^file[:\s]+/i, '');
    console.log('  ✓ Direct path:', path);
  }
}

// Test 2: ```javascript\n// utils.js
const test2 = "```javascript\n// utils.js\nexport function helper() { return 42; }\n```";
console.log('\nTest 2: ```javascript\\n// utils.js');
regex.lastIndex = 0;
while ((match = regex.exec(test2)) !== null) {
  console.log('  langLine (group 1):', JSON.stringify(match[1]));
  console.log('  blockContent (group 2):', match[2].slice(0, 60));
  const firstLine = match[2].split('\n')[0]?.trim();
  console.log('  firstLine of blockContent:', firstLine);
  
  // Test filename regex
  const filenameRegex = /(?:\/\/|#)\s*(?:file(?:name)?[:\s]*)?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]+)|["']([a-zA-Z0-9_\-/.]+\.[a-zA-Z]+)["']/i;
  const m = firstLine.match(filenameRegex);
  if (m) console.log('  ✓ Found filename:', m[1] || m[2]);
}

// Test 3: ```javascript\n# hello.py
const test3 = "```python\n# hello.py\nprint('hello')\n```";
console.log('\nTest 3: ```python\\n# hello.py');
regex.lastIndex = 0;
while ((match = regex.exec(test3)) !== null) {
  console.log('  langLine:', JSON.stringify(match[1]));
  const firstLine = match[2].split('\n')[0]?.trim();
  console.log('  firstLine:', firstLine);
  const filenameRegex = /(?:\/\/|#)\s*(?:file(?:name)?[:\s]*)?([a-zA-Z0-9_\-/.]+\.[a-zA-Z]+)/i;
  const m = firstLine.match(filenameRegex);
  if (m) console.log('  ✓ Found filename:', m[1]);
}
