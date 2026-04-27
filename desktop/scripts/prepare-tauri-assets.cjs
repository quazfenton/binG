const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const webRoot = path.join(repoRoot, 'web');
const tauriRoot = path.join(repoRoot, 'desktop', 'src-tauri');
const destDir = path.join(tauriRoot, 'web-assets');

function run(command, args, cwd, ignoreErrors = false) {
  console.log(`Running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // Signals to web/next.config.mjs that this is the desktop bundling
      // build, so it relaxes type-check/lint gates that are otherwise too
      // strict for shipping the standalone server.
      DESKTOP_MODE: 'true',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !ignoreErrors) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  
  return result;
}

console.log('Preparing desktop web assets...');

// Clear stale build artifacts left by a previously crashed/canceled build:
//   .next/lock  -> "Unable to acquire lock" abort on next build
//   .next/trace -> EPERM on Windows when antivirus or another process held it
const nextDir = path.join(webRoot, '.next');
for (const stale of ['lock', 'trace']) {
  const p = path.join(nextDir, stale);
  if (fs.existsSync(p)) {
    try {
      fs.rmSync(p, { force: true, recursive: true });
      console.log(`Removed stale .next/${stale}`);
    } catch (err) {
      console.warn(`Warning: could not remove ${p}: ${err.message}`);
    }
  }
}

// Resolve a usable `next` CLI entry. In this monorepo `next` is hoisted to
// the repo-root node_modules, not web/node_modules, so `node web/node_modules/...`
// does not exist. Try a few well-known locations and fall back to `npx`.
const nextBinCandidates = [
  path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
  path.join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
];
const nextBin = nextBinCandidates.find((p) => fs.existsSync(p));
const standaloneDir = path.join(nextDir, 'standalone');
const frontendDir = path.join(destDir, 'frontend');

function runNextBuild(extraArgs = []) {
  const args = ['build', '--webpack', ...extraArgs];
  if (nextBin) {
    return run('node', [nextBin, ...args], webRoot, true);
  }
  return run('npx', ['next', ...args], webRoot, true);
}

// Run Next.js build in `compile` mode for the desktop bundle. Every route in
// this app is `export const dynamic = 'force-dynamic'`, so we don't need
// prerender. Skipping prerender also avoids the `_global-error` synthetic
// page crashing with `useContext is null` under React 19 + Next 16, which
// otherwise blocks producing the standalone server.
runNextBuild(['--experimental-build-mode', 'compile']);

if (!fs.existsSync(standaloneDir)) {
  console.log('No standalone build found. Retrying once with default build mode...');
  runNextBuild();
}

if (!fs.existsSync(standaloneDir)) {
  throw new Error('Build failed to produce standalone output. Please check build errors above.');
}

console.log('Copying standalone build to web-assets...');
fs.rmSync(destDir, {
  recursive: true,
  force: true,
});
fs.mkdirSync(destDir, {
  recursive: true,
});

// Copy standalone output
fs.cpSync(standaloneDir, destDir, { recursive: true });
console.log('✓ Copied standalone server');

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

// Create a Tauri-facing frontend directory that intentionally excludes
// the standalone server runtime and its node_modules tree.
fs.rmSync(frontendDir, {
  recursive: true,
  force: true,
});
fs.mkdirSync(frontendDir, {
  recursive: true,
});

const desktopShell = path.join(tauriRoot, 'static', 'index.html');
if (!fs.existsSync(desktopShell)) {
  throw new Error(`Missing desktop startup shell: ${desktopShell}`);
}
fs.copyFileSync(desktopShell, path.join(frontendDir, 'index.html'));
console.log('✓ Prepared frontend startup shell');

// Copy SQL schema files
const dbSchemaDir = path.join(webRoot, 'lib', 'database');
const destDbDir = path.join(destDir, 'web', 'lib', 'database');
if (fs.existsSync(dbSchemaDir)) {
  const coreSchema = path.join(dbSchemaDir, 'schema.sql');
  if (fs.existsSync(coreSchema)) {
    fs.mkdirSync(path.join(destDbDir), { recursive: true });
    fs.copyFileSync(coreSchema, path.join(destDbDir, 'schema.sql'));
    console.log('✓ Copied schema.sql');
  }

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
