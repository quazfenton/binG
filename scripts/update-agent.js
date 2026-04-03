const fs = require('fs');

const files = [
  'web/app/api/chat/route.ts',
];

let count = 0;
files.forEach(f => {
  try {
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/from ['"]@\/lib\/agent\//g, "from '@bing/shared/agent/");
    fs.writeFileSync(f, c);
    console.log('Updated:', f);
    count++;
  } catch (e) {
    console.log('Error:', f, e.message);
  }
});

console.log('Done:', count, 'files updated');
