const fs = require('fs');

const files = [
  'web/app/api/chat/route.ts',
];

let count = 0;
files.forEach(f => {
  try {
    let c = fs.readFileSync(f, 'utf8');
    // Preserve original quote style by capturing it and reusing
    c = c.replace(/from (['"])@\/lib\/agent\//g, "from $1@bing/shared/agent/");
    fs.writeFileSync(f, c);
    console.log('Updated:', f);
    count++;
  } catch (e) {
    console.log('Error:', f, e.message);
  }
});

console.log('Done:', count, 'files updated');
