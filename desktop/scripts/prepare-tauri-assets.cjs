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

console.log('Preparing desktop web assets...');
run('npx', ['next', 'build', '--webpack'], webRoot);

fs.rmSync(destDir, {
  recursive: true,
  force: true,
});
fs.mkdirSync(destDir, {
  recursive: true,
});

fs.writeFileSync(
  path.join(destDir, '.keep'),
  'Static desktop build intentionally omits bundled Next server assets.\n',
  'utf8'
);

console.log(`Desktop web assets prepared at ${destDir}`);
