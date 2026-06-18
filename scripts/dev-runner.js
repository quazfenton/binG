#!/usr/bin/env node
/**
 * SEV-12 dev-server fix: load /opt/bing/.env (root) into process.env before
 * spawning Turbo. Root cause was turbo 2.x's default `passThroughEnv=[]`
 * stripping custom env vars before backend/web workers spawned, leaving
 * `process.env.NODE_ENV === undefined` (visible as `nodeEnv: 'undefined'` in
 * the VFS Startup Fingerprint log) and the E2B sandbox provider reporting
 * "E2B_API_KEY not set" even when the key was configured in /opt/bing/.env.
 *
 * Why this wrapper instead of `dotenv-cli`: zero new dependencies — `dotenv`
 * is already a root devDependency and web devDependency. Pure ~10-line script.
 *
 * Behavior:
 *   1. dotenv.config() — populates process.env with keys from /opt/bing/.env
 *      if the file exists. Existing process.env values are NOT overwritten
 *      (dotenv's default), so explicit shell exports win (e.g. CI overrides).
 *   2. spawnSync('turbo', ['dev'], { stdio: 'inherit' }) — turbo inherits
 *      this Node process's env (including the dotenv-loaded vars).
 *   3. turbo.json's `passThroughEnv: ['*']` then forwards those vars into
 *      every workspace's dev worker (`next dev`, `tsx ... src/index.ts`).
 *
 * Usage: `pnpm dev` (which now calls this script). For the original
 * passthrough behavior without dotenv loading, use `pnpm dev:raw`.
 */
import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('.', import.meta.url).pathname, '..');
const envFile = resolve(root, '.env');

// Load root .env into process.env. dotenv.config() with no `path` argument
// resolves relative to CWD (which is typically /opt/bing when run via pnpm),
// but we pass it explicitly to be robust against `pnpm --filter` invocations
// that change CWD.
if (existsSync(envFile)) {
  const result = config({ path: envFile });
  if (result.error) {
    console.error('[dev-runner] dotenv failed to load .env:', result.error.message);
  } else {
    console.log(`[dev-runner] loaded ${Object.keys(result.parsed ?? {}).length} keys from ${envFile}`);
  }
} else {
  console.warn(`[dev-runner] no ${envFile} found — spawning turbo without .env preload`);
}

// Spawn turbo with the augmented env. stdio:'inherit' preserves stdout/stderr
// so the user's terminal shows the same logs as before. env is omitted so
// turbo inherits this Node process's process.env (with the dotenv additions).
const result = spawnSync('turbo', ['dev'], {
  stdio: 'inherit',
  // Default behavior: child inherits parent env. Explicit for clarity.
  env: process.env,
});

process.exit(result.status ?? 1);
