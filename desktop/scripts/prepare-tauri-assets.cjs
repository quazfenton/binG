const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const webRoot = path.join(repoRoot, 'web');
const tauriRoot = path.join(repoRoot, 'desktop', 'src-tauri');
const destDir = path.join(tauriRoot, 'web-assets');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      DESKTOP_MODE: 'true',
      DESKTOP_LOCAL_EXECUTION: 'true',
      NODE_ENV: 'production',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function copyIfExists(source, destination) {
  if (!fs.existsSync(source)) {
    return;
  }

  fs.cpSync(source, destination, {
    recursive: true,
    force: true,
  });
}

console.log('Preparing desktop web assets...');
run('pnpm', ['exec', 'next', 'build', '--webpack'], webRoot);

const standaloneRoot = path.join(webRoot, '.next', 'standalone');
const standaloneAppRoot = path.join(standaloneRoot, 'web');
const standaloneServer = path.join(standaloneAppRoot, 'server.js');

if (!fs.existsSync(standaloneServer)) {
  throw new Error('Expected web/.next/standalone/web/server.js after desktop web build, but it was not found.');
}

fs.rmSync(destDir, {
  recursive: true,
  force: true,
});
fs.mkdirSync(destDir, {
  recursive: true,
});

copyIfExists(standaloneAppRoot, path.join(destDir, 'web'));
copyIfExists(path.join(standaloneRoot, 'node_modules'), path.join(destDir, 'node_modules'));
copyIfExists(path.join(standaloneRoot, 'packages'), path.join(destDir, 'packages'));
copyIfExists(path.join(webRoot, '.next', 'static'), path.join(destDir, 'web', '.next', 'static'));
copyIfExists(path.join(webRoot, 'public'), path.join(destDir, 'web', 'public'));

if (process.platform === 'win32' && process.execPath.toLowerCase().endsWith('node.exe')) {
  copyIfExists(process.execPath, path.join(destDir, 'node.exe'));
}

console.log(`Desktop web assets prepared at ${destDir}`);
