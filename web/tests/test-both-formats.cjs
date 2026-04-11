// Test both code block formats
const regex = /```(?:javascript|js|typescript|ts|jsx|tsx|python|py|json|html|css|bash|sh|markdown|md)\s*([^\n]*)\n?([\s\S]*?)```/gi;

// Test 1: ```javascript file: utils.js (no newline after lang)
const test1 = "```javascript file: utils.js\nexport function slugify(text) { return text; }\n```";
console.log('Test 1: ```javascript file: utils.js');
let match;
regex.lastIndex = 0;
while ((match = regex.exec(test1)) !== null) {
  console.log('  langLine:', JSON.stringify(match[1]));
  console.log('  blockContent:', match[2].slice(0, 60));
  if (/^file[:\s]/i.test(match[1].trim())) {
    const path = match[1].trim().replace(/^file[:\s]+/i, '');
    console.log('  ✓ Direct path:', path);
  }
}

// Test 2: ```javascript\n// utils.js (newline after lang)
const test2 = "```javascript\n// utils.js\nexport function helper() { return 42; }\n```";
console.log('\nTest 2: ```javascript\\n// utils.js');
regex.lastIndex = 0;
while ((match = regex.exec(test2)) !== null) {
  console.log('  langLine:', JSON.stringify(match[1]));
  console.log('  blockContent:', match[2].slice(0, 60));
  if (/^file[:\s]/i.test(match[1].trim())) {
    console.log('  ✓ Direct path (file:)');
  }
  const firstLine = match[2].split('\n')[0]?.trim();
  console.log('  firstLine:', firstLine);
}
