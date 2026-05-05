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

const MAPPINGS = [
  {
    sourceRoot: path.join(rootDir, 'packages/platform'),
    destRoot: path.join(webDir, '.bing-platform'),
    includePattern: '**/*.{ts,tsx,js,jsx,json,d.ts}',
    excludePattern: ['**/__tests__/**', '**/__mocks__/**', '**/node_modules/**', '**/.git/**'],
    transform: 'platform-package',
  },
  {
    sourceRoot: path.join(rootDir, 'packages/shared'),
    destRoot: path.join(webDir, '.bing-shared'),
    includePattern: '**/*.{ts,tsx,d.ts}',
    excludePattern: ['**/__tests__/**', '**/__mocks__/**', '**/node_modules/**', '**/.git/**'],
  },
  {
    sourceRoot: path.join(rootDir, 'packages/shared'),
    destRoot: path.join(webDir, '.bing-shared'),
    includePattern: 'package.json',
    transform: 'shared-package',
  },
];

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

async function copyFile(src, dest, options = {}) {
  await ensureDir(path.dirname(dest));

  if (options.transform === 'platform-package' && path.basename(src) === 'package.json') {
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
    console.log(`    📦 Transformed package.json -> ${path.relative(dest, dest)}`);
    return;
  }

  if (options.transform === 'shared-package' && path.basename(src) === 'package.json') {
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
    console.log(`    📦 Transformed package.json -> ${path.relative(dest, dest)}`);
    return;
  }

  await fs.copyFile(src, dest);
}

async function sync() {
  console.log('🔄 Syncing monorepo packages to vendored folders...\n');

  for (const mapping of MAPPINGS) {
    const { sourceRoot, destRoot, includePattern, excludePattern, transform } = mapping;

    console.log(`📁 Syncing: ${path.relative(rootDir, sourceRoot)} -> ${path.relative(webDir, destRoot)}`);

    // Check if source exists
    try {
      await fs.access(sourceRoot);
    } catch {
      console.log(`    ⚠️  Source not found, skipping...`);
      continue;
    }

    // Clean destination
    await rimraf(destRoot);
    await ensureDir(destRoot);

    // Build glob pattern
    const searchPattern = sourceRoot.replace(/\\/g, '/') + '/' + includePattern;

    // Build ignore patterns
    const ignorePatterns = (excludePattern || []).map(p => sourceRoot.replace(/\\/g, '/') + '/' + p);

    const files = await glob(searchPattern, {
      nodir: true,
      ignore: ignorePatterns,
    });

    console.log(`    Found ${files.length} files to copy`);

    let copied = 0;
    for (const file of files) {
      const relative = path.relative(sourceRoot, file);
      const target = path.join(destRoot, relative);
      try {
        await copyFile(file, target, { transform });
        copied++;
        if (copied % 50 === 0) {
          console.log(`    Copied ${copied}/${files.length}...`);
        }
      } catch (err) {
        console.error(`    ❌ ${relative}: ${err.message}`);
      }
    }

    console.log(`    ✅ Copied ${copied} files\n`);
  }

  console.log('✅ Vendored packages synced successfully!');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sync().catch(err => {
    console.error('❌ Sync failed:', err);
    process.exit(1);
  });
}

export { sync };