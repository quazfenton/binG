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
    sourceRoot: path.join(rootDir, 'packages/platform/src'),
    destRoot: path.join(webDir, '.bing-platform/src'),
    includePattern: '**/*.{ts,tsx,js,jsx,json,d.ts}',
  },
  {
    sourceRoot: path.join(rootDir, 'packages/platform'),
    destRoot: path.join(webDir, '.bing-platform'),
    includePattern: 'package.json',
    transform: 'platform-package',
  },
  {
    sourceRoot: path.join(rootDir, 'packages/shared'),
    destRoot: path.join(webDir, '.bing-shared'),
    includePattern: '**/*.{ts,tsx}',
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
  } catch (err) {}
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest, options = {}) {
  await ensureDir(path.dirname(dest));
  
  if (options.transform === 'platform-package') {
    const fresh = JSON.parse(await fs.readFile(src, 'utf8'));
    const output = {
      name: fresh.name,
      version: fresh.version,
      private: fresh.private,
      type: fresh.type,
      exports: fresh.exports,
      dependencies: fresh.dependencies || {},
      devDependencies: fresh.devDependencies || {},
    };
    await fs.writeFile(dest, JSON.stringify(output, null, 2) + '\n');
    return;
  }
  
  if (options.transform === 'shared-package') {
    const fresh = JSON.parse(await fs.readFile(src, 'utf8'));
    const output = {
      name: fresh.name,
      version: fresh.version,
      type: fresh.type,
      exports: fresh.exports || {},
      peerDependencies: fresh.peerDependencies || {},
    };
    await fs.writeFile(dest, JSON.stringify(output, null, 2) + '\n');
    return;
  }
  
  // Use copyFileSync for more reliable behavior
  await fs.copyFile(src, dest);
}

async function sync() {
  console.log('🔄 Syncing monorepo packages to vendored folders...');
  
  for (const mapping of MAPPINGS) {
    const { sourceRoot, destRoot, includePattern, transform } = mapping;
    
    console.log(`  Syncing ${path.relative(webDir, destRoot)}...`);
    
    await rimraf(destRoot);
    await ensureDir(destRoot);
    
    const forwardPattern = sourceRoot.replace(/\\/g, '/') + '/' + includePattern;
    const files = await glob(forwardPattern, {
      nodir: true,
      ignore: [
        '**/__tests__/**',
        '**/__mocks__/**',
        '**/node_modules/**',
        '**/.git/**',
      ].map(p => sourceRoot.replace(/\\/g, '/') + '/' + p),
    });
    
    for (const file of files) {
      const relative = path.relative(sourceRoot, file);
      const target = path.join(destRoot, relative);
      try {
        await copyFile(file, target, { transform });
      } catch (err) {
        console.error(`    ❌ ${target}: ${err.message}`);
        throw err;
      }
    }
    
    console.log(`    ✅ Copied ${files.length} files`);
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
