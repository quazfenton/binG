const fs = require('fs');

// Fix unified-agent-service.ts import if needed
const uas = 'web/lib/orchestra/unified-agent-service.ts';
try {
  let c = fs.readFileSync(uas, 'utf8');
  const before = c;
  c = c.replace(/from ['"]@\/lib\/utils\/desktop-env['"]/, "from '@bing/platform/env'");
  c = c.replace(/from ['"]@\/lib\/orchestra\/agent-loop['"]/, "from './agent-loop'");
  if (c !== before) {
    fs.writeFileSync(uas, c);
    console.log('Fixed imports:', uas);
  }
} catch (e) {
  console.log('Error:', uas, e.message);
}

console.log('Done.');
