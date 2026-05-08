import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(__dirname, '../web/app/api');

function walkDir(dir, callback) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, callback);
    } else if (entry.name === 'route.ts') {
      callback(fullPath);
    }
  });
}

function forceEdge(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  if (content.includes("runtime = 'edge'")) return false;
  if (content.includes("runtime = 'nodejs'")) {
    const newContent = content.replace(/runtime = 'nodejs'/, "runtime = 'edge'");
    fs.writeFileSync(filePath, newContent);
    return true;
  }

  const edgeMarker = "\nexport const runtime = 'edge';\n";
  const lines = content.split('\n');
  const importIdx = lines.findIndex(l => l.startsWith('import ') || (l.startsWith('export ') && !l.includes('runtime')));
  
  if (importIdx >= 0) {
    lines.splice(importIdx + 1, 0, edgeMarker);
  } else {
    lines.unshift(edgeMarker);
  }
  
  fs.writeFileSync(filePath, lines.join('\n'));
  return true;
}

let count = 0;
walkDir(apiDir, (file) => {
  if (forceEdge(file)) {
    const relativePath = path.relative(apiDir, file);
    console.log('✓ Edge:', relativePath);
    count++;
  }
});

console.log(`\nTotal routes converted to edge: ${count}`);