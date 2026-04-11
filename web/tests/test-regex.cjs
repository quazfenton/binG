// Test the regex pattern directly
const codeBlockRegex = /```(?:javascript|js|typescript|ts|jsx|tsx|python|py|json|html|css|bash|sh|markdown|md)\s*(\w+)?\s*\n([\s\S]*?)```/gi;

const test1 = "```javascript\n// calculator.js\n\nfunction add(a, b) {\n  return a + b;\n}\n```";

console.log('Test 1:', test1.slice(0, 60));
let match;
while ((match = codeBlockRegex.exec(test1)) !== null) {
  console.log('  Lang tag:', JSON.stringify(match[1]));
  console.log('  Content:', match[2].slice(0, 60));
  
  const firstLine = match[2].split('\n')[0]?.trim() || '';
  console.log('  First line:', firstLine);
  
  // Test filename pattern
  const filenamePattern = /\/\/\s*(?:file(?:name)?[:\s]*)?([a-zA-Z0-9_\-/.]+\.(?:js|ts|jsx|tsx|json|py|html|css))/i;
  const m = firstLine.match(filenamePattern);
  if (m) {
    console.log('  Found filename:', m[1]);
  } else {
    console.log('  No filename found');
  }
}

// Test with // file: utils.ts
const test2 = "```typescript\n// file: utils.ts\n\nexport function helper() {\n  return 42;\n}\n```";
console.log('\nTest 2:', test2.slice(0, 60));
codeBlockRegex.lastIndex = 0;
while ((match = codeBlockRegex.exec(test2)) !== null) {
  console.log('  Lang tag:', JSON.stringify(match[1]));
  const firstLine = match[2].split('\n')[0]?.trim() || '';
  console.log('  First line:', firstLine);
  const filenamePattern = /\/\/\s*(?:file(?:name)?[:\s]*)?([a-zA-Z0-9_\-/.]+\.(?:js|ts|jsx|tsx|json|py|html|css))/i;
  const m = firstLine.match(filenamePattern);
  if (m) console.log('  Found filename:', m[1]);
  else console.log('  No filename found');
}
