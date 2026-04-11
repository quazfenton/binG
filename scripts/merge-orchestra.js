const fs = require('fs');

const files = [
  'desktop/lib/orchestra/agent-loop.ts',
  'desktop/lib/orchestra/stateful-agent/human-in-the-loop.ts',
];

files.forEach(f => {
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/from ['"]@\/lib\/utils\/desktop-env['"]/, "from '@bing/platform/env'");
  fs.writeFileSync(f, c);
  console.log('Fixed imports:', f);
});

// Now copy to web
const pairs = [
  ['desktop/lib/orchestra/agent-loop.ts', 'web/lib/orchestra/agent-loop.ts'],
  ['desktop/lib/orchestra/stateful-agent/human-in-the-loop.ts', 'web/lib/orchestra/stateful-agent/human-in-the-loop.ts'],
];

pairs.forEach(([src, dst]) => {
  const content = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(dst, content);
  console.log('Copied:', src.split('\\').pop(), '->', dst.split('\\').pop());
});

console.log('Done.');
