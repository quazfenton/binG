const { spawnSync } = require('node:child_process');

const mode = process.argv[2];

if (!mode || !['dev', 'build'].includes(mode)) {
  console.error('Usage: node scripts/run-tauri.cjs <dev|build>');
  process.exit(1);
}

const env = {
  ...process.env,
  DESKTOP_MODE: 'true',
  DESKTOP_LOCAL_EXECUTION: 'true',
};

const result = process.platform === 'win32'
  ? spawnSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `pnpm exec tauri ${mode}`],
      {
        cwd: process.cwd(),
        env,
        stdio: 'inherit',
      }
    )
  : spawnSync('pnpm', ['exec', 'tauri', mode], {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
