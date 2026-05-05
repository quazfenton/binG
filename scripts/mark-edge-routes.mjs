import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(__dirname, '../web/app/api');

const categoriesThatNeedNode = new Set([
  'auth', 'agent', 'filesystem', 'storage', 'sandbox', 'terminal', 
  'docker', 'user', 'backend', 'code', 'mastra', 'livekit',
  'providers', 'chat', 'tts', 'speech-to-text', 'image', 'video',
  'modal', 'music-hub', 'orchestration', 'kernel', 'repo-index',
  'devbox', 'blaxel', 'smithery', 'runloop', 'codesandbox',
  'integrations', 'automations', 'antigravity', 'bookmarks',
  'deals', 'broadway', 'prompts', 'powers', 'plugins', 'mind-map',
  'spawn', 'quota', 'news', 'visual-editor', 'metrics'
]);

const categoriesThatCanBeEdge = new Set([
  'health', 'events', 'webhooks', 'url', 'image-proxy', 'csp-report',
  'mcp', 'embed', 'top-panel', 'cli-install', 'art-gallery',
  'zine', 'zine-display', 'cron-jobs', 'webcontainer', 'observa',
  'github', 'huggingface', 'tambo', 'zine-display'
]);

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

function addEdgeToRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  
  if (content.includes("runtime = 'edge'") || content.includes('runtime = "edge"')) {
    return false;
  }
  
  if (content.includes("runtime = 'nodejs'") || content.includes('runtime = "nodejs"')) {
    return false;
  }

  const relativePath = path.relative(apiDir, filePath);
  const parts = relativePath.split(path.sep);
  const category = parts[0];

  if (categoriesThatNeedNode.has(category)) {
    return false;
  }

  const edgeMarker = "\nexport const runtime = 'edge';\n";
  const lines = content.split('\n');
  
  const hasExport = lines.some(l => l.startsWith('export ') && !l.startsWith('export const'));
  const importIdx = lines.findIndex(l => l.startsWith('import ') || l.startsWith('export '));
  
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
  if (addEdgeToRoute(file)) {
    const relativePath = path.relative(apiDir, file);
    console.log('✓ Edge:', relativePath);
    count++;
  }
});

console.log(`\nTotal routes converted to edge: ${count}`);