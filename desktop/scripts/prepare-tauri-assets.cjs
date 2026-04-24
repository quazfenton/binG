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

console.log('Copying standalone build to web-assets...');
fs.rmSync(destDir, {
  recursive: true,
  force: true,
});
fs.mkdirSync(destDir, {
  recursive: true,
});

// Copy standalone output
const standaloneDir = path.join(webRoot, '.next', 'standalone');
if (fs.existsSync(standaloneDir)) {
  // Use recursive copy for standalone folder
  // Note: standalone build contains a folder named 'web' (the project name)
  fs.cpSync(standaloneDir, destDir, { recursive: true });
  console.log('✓ Copied standalone server');
}

// Copy static assets and public folder (Next.js standalone doesn't include them)
const publicDir = path.join(webRoot, 'public');
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, path.join(destDir, 'web', 'public'), { recursive: true });
  console.log('✓ Copied public assets');
}

const staticDir = path.join(webRoot, '.next', 'static');
if (fs.existsSync(staticDir)) {
  fs.cpSync(staticDir, path.join(destDir, 'web', '.next', 'static'), { recursive: true });
  console.log('✓ Copied static assets');
}

// NOTE: Do NOT copy the .env file into the desktop bundle.
// This would leak secrets into the packaged app.
// Instead, rely on runtime-provided environment variables or a sanitized config.
// See: https://12factor.net/config

// Copy SQL schema files — Next.js standalone does NOT include files read via
// readFileSync (webpack only tracks import/require). Without this, the
// database initialization fails with ENOENT at runtime.
const dbSchemaDir = path.join(webRoot, 'lib', 'database');
const destDbDir = path.join(destDir, 'web', 'lib', 'database');
if (fs.existsSync(dbSchemaDir)) {
  // Copy schema.sql (core tables)
  const coreSchema = path.join(dbSchemaDir, 'schema.sql');
  if (fs.existsSync(coreSchema)) {
    fs.mkdirSync(path.join(destDbDir), { recursive: true });
    fs.copyFileSync(coreSchema, path.join(destDbDir, 'schema.sql'));
    console.log('✓ Copied schema.sql');
  }

  // Copy schema/*.sql (per-module schemas)
  const schemaSubdir = path.join(dbSchemaDir, 'schema');
  if (fs.existsSync(schemaSubdir)) {
    const destSchemaSubdir = path.join(destDbDir, 'schema');
    fs.mkdirSync(destSchemaSubdir, { recursive: true });
    for (const file of fs.readdirSync(schemaSubdir)) {
      if (file.endsWith('.sql')) {
        fs.copyFileSync(path.join(schemaSubdir, file), path.join(destSchemaSubdir, file));
      }
    }
    console.log('✓ Copied schema/*.sql files');
  }

  // Copy migrations/*.sql
  const migrationsDir = path.join(dbSchemaDir, 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const destMigrationsDir = path.join(destDbDir, 'migrations');
    fs.mkdirSync(destMigrationsDir, { recursive: true });
    for (const file of fs.readdirSync(migrationsDir)) {
      if (file.endsWith('.sql')) {
        fs.copyFileSync(path.join(migrationsDir, file), path.join(destMigrationsDir, file));
      }
    }
    console.log('✓ Copied migrations/*.sql files');
  }
}

// CRITICAL: Remove the 'data' folder and any .db files from the bundled output
// These should be created fresh at runtime to avoid file locks during installation
const bundledDataDir = path.join(destDir, 'web', 'data');
if (fs.existsSync(bundledDataDir)) {
  console.log('Cleaning bundled data directory...');
  fs.rmSync(bundledDataDir, { recursive: true, force: true });
}

fs.writeFileSync(
  path.join(destDir, '.keep'),
  'Static desktop build assets.\n',
  'utf8'
);

console.log(`Desktop web assets prepared at ${destDir}`);
