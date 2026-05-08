#!/usr/bin/env node
/**
 * Sync monorepo packages into vendored .bing-* folders for Vercel builds.
 * This script copies necessary files from packages/ to web/.bing-* folders.
 * Run this before `next build` in Vercel CI/CD.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(webDir, '..');

async function rimraf(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (err) {
    // Ignore errors
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyWithTransform(src, dest, transform) {
  await ensureDir(path.dirname(dest));

  if (transform === 'platform-package' && path.basename(src) === 'package.json') {
    const fresh = JSON.parse(await fs.readFile(src, 'utf8'));
    const output = {
      name: fresh.name,
      version: fresh.version,
      private: fresh.private,
      type: fresh.type,
      exports: fresh.exports,
      dependencies: fresh.dependencies || {},
      devDependencies: fresh.devDependencies || {},
      peerDependencies: fresh.peerDependencies || {},
    };
    await fs.writeFile(dest, JSON.stringify(output, null, 2) + '\n');
    console.log(`    📦 Transformed package.json`);
    return;
  }

  if (transform === 'shared-package' && path.basename(src) === 'package.json') {
    const fresh = JSON.parse(await fs.readFile(src, 'utf8'));
    const output = {
      name: fresh.name,
      version: fresh.version,
      type: fresh.type,
      exports: fresh.exports || {},
      dependencies: fresh.dependencies || {},
      peerDependencies: fresh.peerDependencies || {},
    };
    await fs.writeFile(dest, JSON.stringify(output, null, 2) + '\n');
    console.log(`    📦 Transformed package.json`);
    return;
  }

  await fs.copyFile(src, dest);
}

async function syncPackage(sourceRoot, destRoot, packageName) {
  console.log(`📁 Syncing: ${path.relative(rootDir, sourceRoot)} -> ${path.relative(webDir, destRoot)}`);

  // Check if source exists
  try {
    await fs.access(sourceRoot);
  } catch {
    console.log(`    ⚠️  Source not found, skipping...`);
    return;
  }

  // Clean destination
  await rimraf(destRoot);
  await ensureDir(destRoot);

  // Copy TypeScript files
  const tsPattern = sourceRoot.replace(/\\/g, '/') + '/**/*.{ts,tsx,d.ts}';
  const tsFiles = await glob(tsPattern, {
    nodir: true,
    ignore: [
      sourceRoot.replace(/\\/g, '/') + '/**/__tests__/**',
      sourceRoot.replace(/\\/g, '/') + '/**/node_modules/**',
    ],
  });

  console.log(`    Found ${tsFiles.length} TypeScript files`);

  let copied = 0;
  for (const file of tsFiles) {
    const relative = path.relative(sourceRoot, file);
    const target = path.join(destRoot, relative);
    try {
      await copyWithTransform(file, target, null);
      copied++;
      if (copied % 50 === 0) {
        console.log(`    Copied ${copied}/${tsFiles.length}...`);
      }
    } catch (err) {
      console.error(`    ❌ ${relative}: ${err.message}`);
    }
  }
  console.log(`    ✅ Copied ${copied} TypeScript files`);

  // Copy and transform package.json
  const pkgPath = path.join(sourceRoot, 'package.json');
  const destPkgPath = path.join(destRoot, 'package.json');
  const transform = packageName === 'platform' ? 'platform-package' : 'shared-package';
  try {
    await copyWithTransform(pkgPath, destPkgPath, transform);
  } catch (err) {
    console.error(`    ❌ package.json: ${err.message}`);
  }
}

async function sync() {
  console.log('🔄 Syncing monorepo packages to vendored folders...\n');

  // Sync platform
  await syncPackage(
    path.join(rootDir, 'packages/platform'),
    path.join(webDir, '.bing-platform'),
    'platform'
  );

  // Sync shared
  await syncPackage(
    path.join(rootDir, 'packages/shared'),
    path.join(webDir, '.bing-shared'),
    'shared'
  );

  console.log('\n✅ Vendored packages synced successfully!');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sync().catch(err => {
    console.error('❌ Sync failed:', err);
    process.exit(1);
  });
}

export { sync };