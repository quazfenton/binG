import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(__dirname, '../web/app/api');

const categories = {
  filesystem: [
    'read', 'write', 'delete', 'list', 'mkdir', 'move', 'rename', 'create-file',
    'search', 'rollback', 'snapshot', 'snapshot/restore', 'diffs', 'diffs/apply',
    'edits/accept', 'edits/deny', 'events/push', 'import', 'commits', 'context-pack'
  ],
  storage: ['usage', 'upload', 'signed-url', 'list', 'download', 'delete'],
  sandbox: [
    'agent', 'clear-sessions', 'daemon', 'devbox', 'execute', 'files',
    'lifecycle', 'provider/pty', 'session', 'sync',
    'terminal', 'terminal/input', 'terminal/resize', 'terminal/stream', 'terminal/ws',
    'terminaluse', 'webcontainer'
  ],
  user: ['api-keys', 'delete', 'integrations/status', 'keys', 'preferences', 'profile'],
  docker: ['compose', 'containers', 'exec', 'remove/[id]', 'start/[id]', 'stop/[id]'],
  terminal: ['local-pty', 'local-pty/input', 'local-pty/resize'],
  auth: [
    'arcade/authorize', 'arcade/custom-verifier', 'check-auth0-session', 'check-email',
    'confirm-reset', 'login', 'logout', 'me', 'mfa/challenge', 'mfa/disable',
    'mfa/setup', 'mfa/verify', 'nango/authorize', 'oauth/callback', 'oauth/error',
    'oauth/initiate', 'oauth/success', 'refresh', 'register', 'reset-password',
    'send-verification', 'session', 'validate', 'verify-email'
  ],
  agent: [
    'health', 'route', 'stateful-agent', 'stateful-agent/interrupt', 'unified-agent',
    'v2/cloud/offload', 'v2/cloud/[agentId]', 'v2/execute', 'v2/session', 'v2/sync',
    'v2/workforce', 'workflows'
  ],
  integrations: [
    'arcade/auth', 'arcade/token', 'audit', 'connections', 'execute',
    'figma', 'figma/callback', 'github', 'github/oauth/authorize', 'github/oauth/callback',
    'github/oauth/disconnect', 'github/oauth/status', 'github/source-control/branch',
    'github/source-control/branches', 'github/source-control/commit', 'github/source-control/commits',
    'github/source-control/import-repo', 'github/source-control/pr', 'github/source-control/pull',
    'github/source-control/push', 'google', 'linkedin', 'twitter'
  ]
};

function checkExports(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const exports = {
      GET: content.includes('export async function GET') || content.includes('export function GET'),
      POST: content.includes('export async function POST') || content.includes('export function POST'),
      PUT: content.includes('export async function PUT') || content.includes('export function PUT'),
      DELETE: content.includes('export async function DELETE') || content.includes('export function DELETE'),
      PATCH: content.includes('export async function PATCH') || content.includes('export function PATCH')
    };
    return exports;
  } catch (err) {
    return null;
  }
}

const results = {};

for (const [category, routes] of Object.entries(categories)) {
  results[category] = {};
  
  for (const route of routes) {
    const routePath = route === 'route' 
      ? path.join(apiDir, category, 'route-original.ts')
      : path.join(apiDir, category, route, 'route.ts');
    
    const exports = checkExports(routePath);
    if (exports) {
      results[category][route] = exports;
    } else {
      results[category][route] = { error: 'File not found or unreadable' };
    }
  }
}

console.log(JSON.stringify(results, null, 2));
