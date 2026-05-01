const fs = require('fs');
const binPath = 'bin.ts';

let content = fs.readFileSync(binPath, 'utf-8');
const lines = content.split('\n');

console.log('=== Clean Fix ===');

// Fix trailing backslash pattern: \/+$/ -> \\/+$/
const sBS = String.fromCharCode(92);
const dBS = String.fromCharCode(92, 92);
const badPattern = sBS + '/+$/';
const goodPattern = dBS + '/+$/';

console.log('Looking for bad pattern:', JSON.stringify(badPattern));

let fixed = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(badPattern)) {
    lines[i] = lines[i].split(badPattern).join(goodPattern);
    fixed++;
    console.log('Fixed line ' + (i + 1));
  }
}
console.log('Fixed ' + fixed + ' trailing patterns');

// Remove commented-out login block
for (let i = 0; i < lines.length; i++) {
  if (lines[i].indexOf('// .command(') === 0 && lines[i].includes('login')) {
    console.log('Found commented login at line ' + (i + 1));
    // Remove from this line until we find });
    let endIdx = i;
    for (let j = i + 1; j < lines.length && j < i + 50; j++) {
      if (lines[j].indexOf('});') >= 0) {
        endIdx = j;
        break;
      }
    }
    console.log('Removing lines ' + (i + 1) + ' to ' + (endIdx + 1));
    lines.splice(i, endIdx - i + 1);
    break;
  }
}

// Write
fs.writeFileSync(binPath, lines.join('\n'), 'utf-8');
console.log('Done');

// Quick test
const v = fs.readFileSync(binPath, 'utf-8').split('\n');
console.log('Line 877:', v[876] ? v[876].substring(54, 70) : 'N/A');
console.log('Line 878:', v[877] ? v[877].substring(62, 78) : 'N/A');