/**
 * E2E: Package Manager + Docker/Monorepo Detection + Smart Context
 *
 * Tests:
 * 1. Lockfile detection (pnpm, yarn, bun, deno, npm)
 * 2. package.json "packageManager" field detection
 * 3. Runtime mode detection (Docker, Compose, Monorepo, Serverless, Vercel, Netlify)
 * 4. Smart context generation for LLM
 * 5. NL → command translation with package manager awareness
 * 6. Docker command translation
 * 7. Full E2E: buildProjectContext → smartContext → translate → execute
 *
 * Run: npx vitest run __tests__/e2e-pkgmanager-docker-detection.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  detectPackageManager,
  detectPackageManagerFromPackageJson,
  getInstallCommand,
  getRunCommandPrefix,
  detectRuntimeMode,
  getDockerCommands,
  buildProjectContext,
  generateSmartContext,
  formatSmartContextAsMarkdown,
  translateNaturalLanguageToCommand,
  resolveVfsPathToRealPath,
  type ProjectContext,
  type PackageManager,
  type RuntimeMode,
  type SmartContextFile,
} from '@/lib/project-detection';

// ============================================================================
// Package Manager Detection Tests
// ============================================================================

describe('Package Manager Detection', () => {
  it('detects pnpm from pnpm-lock.yaml', () => {
    const files = ['pnpm-lock.yaml', 'package.json', 'src/index.ts'];
    expect(detectPackageManager(files)).toBe('pnpm');
  });

  it('detects pnpm from pnpm-workspace.yaml', () => {
    const files = ['pnpm-workspace.yaml', 'packages/web/package.json'];
    expect(detectPackageManager(files)).toBe('pnpm');
  });

  it('detects yarn from yarn.lock', () => {
    const files = ['yarn.lock', 'package.json', 'src/index.ts'];
    expect(detectPackageManager(files)).toBe('yarn');
  });

  it('detects npm from package-lock.json', () => {
    const files = ['package-lock.json', 'package.json', 'src/index.ts'];
    expect(detectPackageManager(files)).toBe('npm');
  });

  it('detects bun from bun.lockb', () => {
    const files = ['bun.lockb', 'package.json', 'src/index.ts'];
    expect(detectPackageManager(files)).toBe('bun');
  });

  it('detects bun from bun.lock', () => {
    const files = ['bun.lock', 'package.json', 'src/index.ts'];
    expect(detectPackageManager(files)).toBe('bun');
  });

  it('detects deno from deno.lock', () => {
    const files = ['deno.lock', 'main.ts'];
    expect(detectPackageManager(files)).toBe('deno');
  });

  it('returns unknown for no lockfile', () => {
    const files = ['package.json', 'src/index.ts'];
    expect(detectPackageManager(files)).toBe('unknown');
  });

  it('detects pnpm from packageManager field', () => {
    const pkg = JSON.stringify({ packageManager: 'pnpm@8.6.0' });
    expect(detectPackageManagerFromPackageJson(pkg)).toBe('pnpm');
  });

  it('detects bun from packageManager field', () => {
    const pkg = JSON.stringify({ packageManager: 'bun@1.0.0' });
    expect(detectPackageManagerFromPackageJson(pkg)).toBe('bun');
  });

  it('detects yarn from packageManager field', () => {
    const pkg = JSON.stringify({ packageManager: 'yarn@4.0.0' });
    expect(detectPackageManagerFromPackageJson(pkg)).toBe('yarn');
  });

  it('returns unknown for invalid packageManager field', () => {
    const pkg = JSON.stringify({ packageManager: 'invalid-pm@1.0.0' });
    expect(detectPackageManagerFromPackageJson(pkg)).toBe('unknown');
  });

  it('returns install commands for all package managers', () => {
    expect(getInstallCommand('npm')).toBe('npm install');
    expect(getInstallCommand('yarn')).toBe('yarn install');
    expect(getInstallCommand('pnpm')).toBe('pnpm install');
    expect(getInstallCommand('bun')).toBe('bun install');
    expect(getInstallCommand('deno')).toBe('deno install');
  });

  it('returns run command prefix for all package managers', () => {
    expect(getRunCommandPrefix('npm', 'dev')).toBe('npm run dev');
    expect(getRunCommandPrefix('yarn', 'dev')).toBe('yarn dev');
    expect(getRunCommandPrefix('pnpm', 'dev')).toBe('pnpm run dev');
    expect(getRunCommandPrefix('bun', 'dev')).toBe('bun run dev');
    expect(getRunCommandPrefix('deno', 'dev')).toBe('deno task dev');
  });
});

// ============================================================================
// Runtime Mode Detection Tests
// ============================================================================

describe('Runtime Mode Detection', () => {
  it('detects docker-compose from docker-compose.yml', () => {
    const files = ['docker-compose.yml', 'Dockerfile', 'package.json'];
    expect(detectRuntimeMode(files)).toBe('docker-compose');
  });

  it('detects docker-compose from compose.yaml', () => {
    const files = ['compose.yaml', 'Dockerfile', 'package.json'];
    expect(detectRuntimeMode(files)).toBe('docker-compose');
  });

  it('detects docker from Dockerfile (no compose)', () => {
    const files = ['Dockerfile', '.dockerignore', 'package.json'];
    expect(detectRuntimeMode(files)).toBe('docker');
  });

  it('detects docker from Dockerfile.dev', () => {
    const files = ['Dockerfile.dev', 'package.json'];
    expect(detectRuntimeMode(files)).toBe('docker');
  });

  it('detects monorepo-pnpm from pnpm-workspace.yaml', () => {
    const files = ['pnpm-workspace.yaml', 'packages/web/package.json', 'packages/api/package.json'];
    expect(detectRuntimeMode(files)).toBe('monorepo-pnpm');
  });

  it('detects monorepo-turborepo from turbo.json', () => {
    const files = ['turbo.json', 'package.json', 'apps/web/package.json'];
    expect(detectRuntimeMode(files)).toBe('monorepo-turborepo');
  });

  it('detects monorepo-nx from nx.json', () => {
    const files = ['nx.json', 'package.json', 'apps/web/project.json'];
    expect(detectRuntimeMode(files)).toBe('monorepo-nx');
  });

  it('detects monorepo-lerna from lerna.json', () => {
    const files = ['lerna.json', 'package.json', 'packages/core/package.json'];
    expect(detectRuntimeMode(files)).toBe('monorepo-lerna');
  });

  it('detects serverless from serverless.yml', () => {
    const files = ['serverless.yml', 'handler.ts', 'package.json'];
    expect(detectRuntimeMode(files)).toBe('serverless');
  });

  it('detects vercel from vercel.json', () => {
    const files = ['vercel.json', 'package.json', 'pages/index.tsx'];
    expect(detectRuntimeMode(files)).toBe('vercel');
  });

  it('detects netlify from netlify.toml', () => {
    const files = ['netlify.toml', 'package.json', 'src/index.tsx'];
    expect(detectRuntimeMode(files)).toBe('netlify');
  });

  it('returns standard for no special config', () => {
    const files = ['package.json', 'src/index.ts', 'README.md'];
    expect(detectRuntimeMode(files)).toBe('standard');
  });

  it('returns docker compose commands', () => {
    const cmds = getDockerCommands('docker-compose');
    expect(cmds).not.toBeNull();
    expect(cmds!.up).toBe('docker compose up -d');
    expect(cmds!.down).toBe('docker compose down');
    expect(cmds!.build).toBe('docker compose build');
  });

  it('returns docker single container commands', () => {
    const cmds = getDockerCommands('docker');
    expect(cmds).not.toBeNull();
    expect(cmds!.up).toContain('docker build');
    expect(cmds!.up).toContain('docker run');
    expect(cmds!.down).toContain('docker stop');
    expect(cmds!.build).toBe('docker build -t app .');
  });

  it('returns null for standard mode', () => {
    expect(getDockerCommands('standard')).toBeNull();
    expect(getDockerCommands('monorepo-pnpm')).toBeNull();
  });
});

// ============================================================================
// buildProjectContext + Smart Context Tests
// ============================================================================

describe('buildProjectContext + Smart Context', () => {
  it('detects pnpm monorepo with docker-compose', async () => {
    const files = [
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'docker-compose.yml',
      'Dockerfile',
      'package.json',
      'packages/web/package.json',
      'packages/web/src/main.ts',
      'packages/api/src/index.ts',
    ];

    const pkgContent = JSON.stringify({
      scripts: { dev: 'turbo run dev', build: 'turbo run build' },
      packageManager: 'pnpm@8.6.0',
    });

    const ctx = await buildProjectContext(files, async (p) => {
      if (p.endsWith('package.json')) return pkgContent;
      return null;
    });

    expect(ctx.packageManager).toBe('pnpm');
    expect(ctx.runtimeMode).toBe('docker-compose');
    expect(ctx.smartContext.packageManager).toBe('pnpm');
    expect(ctx.smartContext.runtimeMode).toBe('docker-compose');
    expect(ctx.smartContext.recommendedCommands.install).toBe('pnpm install');
    expect(ctx.smartContext.recommendedCommands.dockerUp).toBe('docker compose up -d');
  });

  it('detects bun + vercel deployment', async () => {
    const files = [
      'bun.lockb',
      'vercel.json',
      'package.json',
      'src/app/page.tsx',
      'next.config.js',
    ];

    const pkgContent = JSON.stringify({
      scripts: { dev: 'next dev', build: 'next build' },
      dependencies: { next: '^14.0.0' },
      packageManager: 'bun@1.0.0',
    });

    const ctx = await buildProjectContext(files, async (p) => {
      if (p.endsWith('package.json')) return pkgContent;
      return null;
    });

    expect(ctx.framework).toBe('next');
    expect(ctx.packageManager).toBe('bun');
    expect(ctx.runtimeMode).toBe('vercel');
    expect(ctx.smartContext.recommendedCommands.install).toBe('bun install');
    expect(ctx.smartContext.recommendedCommands.run).toBe('bun run dev');
  });

  it('generates smart context markdown for LLM', async () => {
    const files = [
      'pnpm-lock.yaml',
      'package.json',
      'src/app/page.tsx',
      'next.config.js',
    ];

    const pkgContent = JSON.stringify({
      scripts: { dev: 'next dev', build: 'next build', test: 'jest', lint: 'next lint' },
      dependencies: { next: '^14.0.0' },
    });

    const ctx = await buildProjectContext(files, async (p) => {
      if (p.endsWith('package.json')) return pkgContent;
      return null;
    });

    const markdown = formatSmartContextAsMarkdown(ctx.smartContext);

    expect(markdown).toContain('`pnpm`');
    expect(markdown).toContain('next');
    expect(markdown).toContain('`pnpm run dev`');
    expect(markdown).toContain('`pnpm install`');
    expect(markdown).toContain('App Router');
  });

  it('generates smart context for Docker Compose project', async () => {
    const files = [
      'docker-compose.yml',
      'Dockerfile',
      'package.json',
      'server.js',
    ];

    const pkgContent = JSON.stringify({
      scripts: { start: 'node server.js', test: 'mocha' },
    });

    const ctx = await buildProjectContext(files, async (p) => {
      if (p.endsWith('package.json')) return pkgContent;
      return null;
    });

    const markdown = formatSmartContextAsMarkdown(ctx.smartContext);

    expect(markdown).toContain('docker compose up -d');
    expect(markdown).toContain('docker compose down');
    expect(markdown).toContain('Docker Compose');
  });
});

// ============================================================================
// NL → Command Translation with Package Manager + Docker
// ============================================================================

describe('NL → Command Translation (with PM + Docker)', () => {
  it('uses pnpm for install command', () => {
    const ctx: ProjectContext & { packageManager: PackageManager } = {
      framework: 'next',
      entryFile: '/src/app/page.tsx',
      projectRoot: '',
      runCommand: 'pnpm run dev',
      testCommand: 'pnpm run test',
      buildCommand: 'pnpm run build',
      hasPackageJson: true,
      packageJsonScripts: ['dev', 'build', 'test'],
      configFileIndicators: ['next.config.js'],
      packageManager: 'pnpm',
    };

    expect(translateNaturalLanguageToCommand('install dependencies', ctx)).toBe('pnpm install');
    expect(translateNaturalLanguageToCommand('run the project', ctx)).toBe('pnpm run dev');
  });

  it('uses bun for install command', () => {
    const ctx: ProjectContext & { packageManager: PackageManager } = {
      framework: 'react',
      entryFile: '/src/main.tsx',
      projectRoot: '',
      runCommand: 'bun run dev',
      testCommand: 'bun run test',
      buildCommand: 'bun run build',
      hasPackageJson: true,
      packageJsonScripts: ['dev', 'build', 'test'],
      configFileIndicators: ['vite.config.ts'],
      packageManager: 'bun',
    };

    expect(translateNaturalLanguageToCommand('install', ctx)).toBe('bun install');
    expect(translateNaturalLanguageToCommand('run it', ctx)).toBe('bun run dev');
    expect(translateNaturalLanguageToCommand('test', ctx)).toBe('bun run test');
  });

  it('translates docker commands for docker-compose mode', () => {
    const ctx: ProjectContext & { packageManager: PackageManager; runtimeMode: RuntimeMode } = {
      framework: 'node',
      entryFile: '/server.js',
      projectRoot: '',
      runCommand: 'npm start',
      testCommand: 'npm test',
      buildCommand: 'npm run build',
      hasPackageJson: true,
      packageJsonScripts: ['start', 'build'],
      configFileIndicators: ['Dockerfile', 'docker-compose.yml'],
      packageManager: 'npm',
      runtimeMode: 'docker-compose',
    };

    // "docker compose up" is a direct command → pass through
    expect(translateNaturalLanguageToCommand('docker compose up -d', ctx)).toBe('docker compose up -d');
    // "start the container" → docker compose up
    expect(translateNaturalLanguageToCommand('start the container', ctx)).toBe('docker compose up -d');
    // "stop docker" → docker compose down
    expect(translateNaturalLanguageToCommand('stop docker', ctx)).toBe('docker compose down');
    // "docker build" → docker compose build
    expect(translateNaturalLanguageToCommand('build docker', ctx)).toBe('docker compose build');
  });

  it('translates docker commands for single Dockerfile mode', () => {
    const ctx: ProjectContext & { packageManager: PackageManager; runtimeMode: RuntimeMode } = {
      framework: 'python',
      entryFile: '/main.py',
      projectRoot: '',
      runCommand: 'python main.py',
      testCommand: 'npm test',
      buildCommand: 'npm run build',
      hasPackageJson: false,
      packageJsonScripts: [],
      configFileIndicators: ['Dockerfile'],
      packageManager: 'npm',
      runtimeMode: 'docker',
    };

    expect(translateNaturalLanguageToCommand('start docker', ctx)).toContain('docker build');
    expect(translateNaturalLanguageToCommand('start docker', ctx)).toContain('docker run');
    expect(translateNaturalLanguageToCommand('stop docker', ctx)).toContain('docker stop');
  });

  it('uses deno task for deno projects', () => {
    const ctx: ProjectContext & { packageManager: PackageManager } = {
      framework: 'unknown',
      entryFile: '/main.ts',
      projectRoot: '',
      runCommand: 'deno task dev',
      testCommand: 'deno task test',
      buildCommand: 'deno task build',
      hasPackageJson: false,
      packageJsonScripts: [],
      configFileIndicators: ['deno.lock'],
      packageManager: 'deno',
    };

    expect(translateNaturalLanguageToCommand('run it', ctx)).toBe('deno task dev');
    expect(translateNaturalLanguageToCommand('test', ctx)).toBe('deno task test');
    expect(translateNaturalLanguageToCommand('install', ctx)).toBe('deno install');
  });
});

// ============================================================================
// E2E: Full Pipeline — Lockfile Detection + Docker + Smart Context
// ============================================================================

describe('E2E: Full Pipeline — Lockfile + Docker + Smart Context', () => {
  it('simulates: "run the project" on pnpm + docker-compose Next.js repo', async () => {
    const files = [
      'pnpm-lock.yaml',
      'docker-compose.yml',
      'Dockerfile',
      'next.config.js',
      'package.json',
      'src/app/page.tsx',
    ];

    const pkgContent = JSON.stringify({
      scripts: { dev: 'next dev', build: 'next build' },
      dependencies: { next: '^14.0.0' },
      packageManager: 'pnpm@8.6.0',
    });

    const ctx = await buildProjectContext(files, async (p) => {
      if (p.endsWith('package.json')) return pkgContent;
      return null;
    });

    expect(ctx.packageManager).toBe('pnpm');
    expect(ctx.runtimeMode).toBe('docker-compose');
    expect(ctx.framework).toBe('next');

    // LLM says "run the project"
    const cmd = translateNaturalLanguageToCommand('run the project', ctx);
    expect(cmd).toBe('pnpm run dev');
  });

  it('simulates: "start docker" on bun + Dockerfile project', async () => {
    const files = [
      'bun.lockb',
      'Dockerfile',
      'package.json',
      'src/index.tsx',
    ];

    const pkgContent = JSON.stringify({
      scripts: { dev: 'vite', build: 'vite build' },
      packageManager: 'bun@1.0.0',
    });

    const ctx = await buildProjectContext(files, async (p) => {
      if (p.endsWith('package.json')) return pkgContent;
      return null;
    });

    expect(ctx.packageManager).toBe('bun');
    expect(ctx.runtimeMode).toBe('docker');

    // LLM says "start docker"
    const cmd = translateNaturalLanguageToCommand('start docker', ctx);
    expect(cmd).toContain('docker build');
    expect(cmd).toContain('docker run');
  });

  it('simulates: "install dependencies" on yarn + turborepo monorepo', async () => {
    const files = [
      'yarn.lock',
      'turbo.json',
      'package.json',
      'apps/web/package.json',
      'apps/web/src/main.tsx',
    ];

    const ctx = await buildProjectContext(files);

    expect(ctx.packageManager).toBe('yarn');
    expect(ctx.runtimeMode).toBe('monorepo-turborepo');

    const cmd = translateNaturalLanguageToCommand('install dependencies', ctx);
    expect(cmd).toBe('yarn install');
  });

  it('produces complete smart context for LLM system prompt', async () => {
    const files = [
      'pnpm-lock.yaml',
      'docker-compose.yml',
      'next.config.js',
      'package.json',
      'src/app/page.tsx',
      'src/app/layout.tsx',
    ];

    const pkgContent = JSON.stringify({
      scripts: { dev: 'next dev', build: 'next build', test: 'jest' },
      dependencies: { next: '^14.0.0' },
      packageManager: 'pnpm@8.6.0',
    });

    const ctx = await buildProjectContext(files, async (p) => {
      if (p.endsWith('package.json')) return pkgContent;
      return null;
    });

    const smartCtx = ctx.smartContext;

    // Verify all fields are populated
    expect(smartCtx.summary).toContain('next');
    expect(smartCtx.framework).toBe('next');
    expect(smartCtx.packageManager).toBe('pnpm');
    expect(smartCtx.runtimeMode).toBe('docker-compose');
    expect(smartCtx.entryFile).toContain('page.tsx');
    expect(smartCtx.recommendedCommands.install).toBe('pnpm install');
    expect(smartCtx.recommendedCommands.run).toBe('pnpm run dev');
    expect(smartCtx.recommendedCommands.dockerUp).toBe('docker compose up -d');
    expect(smartCtx.hints.length).toBeGreaterThan(0);

    // Verify markdown format
    const md = formatSmartContextAsMarkdown(smartCtx);
    expect(md).toContain('`pnpm`');
    expect(md).toContain('docker compose');
    expect(md).toContain('Next.js');
  });
});
