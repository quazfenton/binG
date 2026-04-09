/**
 * Patch: Fix checkFileExists to handle nested response structure
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'e2e-deep-workflow.mjs');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
  /async function checkFileExists\(path, maxRetries = 3, delay = 2000\) \{[\s\S]*?return \{ exists: false \};\n\s*\}/,
  `async function checkFileExists(path, maxRetries = 3, delay = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await readVfs(path);
    // Response: { ok, status, data: { success: true, data: { content, ... } } }
    const content = result.data?.data?.content ?? result.data?.content;
    const success = result.data?.success !== false && content !== undefined;
    if (success) {
      return { exists: true, content };
    }
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { exists: false };
}`
);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Patched checkFileExists in e2e-deep-workflow.mjs');
