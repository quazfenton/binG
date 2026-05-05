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

function revertEdge(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  if (content.includes("runtime = 'edge'")) {
    const newContent = content.replace(/\nexport const runtime = 'edge';\n?/g, '\n');
    fs.writeFileSync(filePath, newContent);
    return true;
  }
  return false;
}

let count = 0;
walkDir(apiDir, (file) => {
  if (revertEdge(file)) {
    const relativePath = path.relative(apiDir, file);
    console.log('✓ Reverted:', relativePath);
    count++;
  }
});

console.log(`\nTotal routes reverted: ${count}`);