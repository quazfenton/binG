const fs = require('fs');
let content = fs.readFileSync('lib/chat/file-edit-parser.ts', 'utf8');

// Add sanitization for <function=...> format in sanitizeFileEditTags
// Find the section where tool_call is sanitized and add <function= handling
content = content.replace(
  "sanitized = sanitized.replace(/<\\/tool_call>/gi, '');",
  `sanitized = sanitized.replace(/<\\/tool_call>/gi, '');

  // Remove <function=tool_name> format (Mistral models)
  if (sanitized.includes('<function=')) {
    sanitized = sanitized.replace(/<function=[\\s\\S]*?<\\/function>/gi, '');
  }`
);

fs.writeFileSync('lib/chat/file-edit-parser.ts', content);
console.log('Added sanitization');