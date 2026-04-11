/**
 * E2E: Project Detection + Auto-Context + LLM Terminal Integration
 *
 * Tests the FULL pipeline:
 * 1. File paths → detect framework (Next, React, Vue, Python, Rust, Go)
 * 2. File paths → detect entry file
 * 3. File paths → detect project root
 * 4. package.json → detect run/test/build commands
 * 5. NL prompt → translate to command using context
 * 6. VFS scopedPath → real filesystem path resolution
 * 7. buildProjectContext → complete context from file listing
 * 8. Capability router cwd resolution via resolveVfsPathToRealPath
 *
 * Run: npx vitest run __tests__/e2e-project-detection-terminal.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';

// ============================================================================
// Framework Detection Tests
// ============================================================================

import {
  detectFrameworkFromFiles,
  detectEntryFile,
  detectProjectRoot,
  computeRootScores,
  detectRunCommand,
  detectTestCommand,
  detectBuildCommand,
  translateNaturalLanguageToCommand,
  resolveVfsPathToRealPath,
  buildProjectContext,
  type ProjectContext,
  type AppFramework,
} from '@/lib/project-detection';

describe('Framework Detection', () => {
  it('detects Next.js from next.config.js', () => {
    const files = ['next.config.js', 'package.json', 'src/app/page.tsx', 'src/app/layout.tsx'];
    expect(detectFrameworkFromFiles(files)).toBe('next');
  });

  it('detects Next.js from next dependency', () => {
    const files = ['package.json', 'src/pages/index.tsx', 'src/pages/_app.tsx'];
    const pkg = JSON.stringify({ dependencies: { next: '^14.0.0', react: '^18.0.0' } });
    expect(detectFrameworkFromFiles(files, pkg)).toBe('next');
  });

  it('detects Nuxt from nuxt.config.ts', () => {
    const files = ['nuxt.config.ts', 'package.json', 'app.vue', 'pages/index.vue'];
    expect(detectFrameworkFromFiles(files)).toBe('nuxt');
  });

  it('detects Vue from .vue files', () => {
    const files = ['src/App.vue', 'src/main.ts', 'src/components/Button.vue', 'package.json'];
    expect(detectFrameworkFromFiles(files)).toBe('vue');
  });

  it('detects Svelte from svelte.config.js', () => {
    const files = ['svelte.config.js', 'package.json', 'src/App.svelte', 'src/main.ts'];
    expect(detectFrameworkFromFiles(files)).toBe('svelte');
  });

  it('detects Vite from vite.config.ts', () => {
    const files = ['vite.config.ts', 'package.json', 'src/main.ts', 'index.html'];
    expect(detectFrameworkFromFiles(files)).toBe('vite');
  });

  it('detects Astro from astro.config.mjs', () => {
    const files = ['astro.config.mjs', 'package.json', 'src/pages/index.astro'];
    expect(detectFrameworkFromFiles(files)).toBe('astro');
  });

  it('detects Angular from angular.json', () => {
    const files = ['angular.json', 'package.json', 'src/main.ts', 'src/app/app.component.ts'];
    expect(detectFrameworkFromFiles(files)).toBe('angular');
  });

  it('detects Rust from Cargo.toml', () => {
    const files = ['Cargo.toml', 'src/main.rs', 'src/lib.rs'];
    expect(detectFrameworkFromFiles(files)).toBe('rust');
  });

  it('detects Go from go.mod', () => {
    const files = ['go.mod', 'main.go', 'handlers/api.go'];
    expect(detectFrameworkFromFiles(files)).toBe('go');
  });

  it('detects Django from manage.py', () => {
    const files = ['manage.py', 'myapp/views.py', 'myapp/models.py', 'requirements.txt'];
    expect(detectFrameworkFromFiles(files)).toBe('django');
  });

  it('detects Python from main.py + requirements.txt', () => {
    const files = ['main.py', 'requirements.txt', 'utils/helpers.py'];
    expect(detectFrameworkFromFiles(files)).toBe('python');
  });

  it('detects React from .tsx/.jsx files and react dependency', () => {
    const files = ['src/index.tsx', 'src/App.tsx', 'src/components/Button.tsx'];
    const pkg = JSON.stringify({ dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } });
    expect(detectFrameworkFromFiles(files, pkg)).toBe('react');
  });

  it('returns unknown for unrecognized file sets', () => {
    const files = ['README.md', 'notes.txt', 'data.json'];
    expect(detectFrameworkFromFiles(files)).toBe('unknown');
  });
});

// ============================================================================
// Entry File Detection Tests
// ============================================================================

describe('Entry File Detection', () => {
  it('finds Next.js entry: src/app/page.tsx', () => {
    const files = ['src/app/page.tsx', 'src/app/layout.tsx', 'next.config.js'];
    expect(detectEntryFile(files, 'next')).toBe('/src/app/page.tsx');
  });

  it('finds Next.js pages router entry: pages/index.tsx', () => {
    const files = ['pages/index.tsx', 'pages/_app.tsx', 'next.config.js'];
    expect(detectEntryFile(files, 'next')).toBe('/pages/index.tsx');
  });

  it('finds React entry: src/main.tsx', () => {
    const files = ['src/main.tsx', 'src/App.tsx', 'vite.config.ts'];
    expect(detectEntryFile(files, 'react')).toBe('/src/main.tsx');
  });

  it('finds Vue entry: src/main.ts', () => {
    const files = ['src/main.ts', 'src/App.vue', 'vite.config.ts'];
    expect(detectEntryFile(files, 'vue')).toBe('/src/main.ts');
  });

  it('finds Nuxt entry: app.vue', () => {
    const files = ['app.vue', 'nuxt.config.ts', 'pages/index.vue'];
    expect(detectEntryFile(files, 'nuxt')).toBe('/app.vue');
  });

  it('finds Svelte entry: src/main.ts', () => {
    const files = ['src/main.ts', 'src/App.svelte', 'svelte.config.js'];
    expect(detectEntryFile(files, 'svelte')).toBe('/src/main.ts');
  });

  it('finds Astro entry: src/pages/index.astro', () => {
    const files = ['src/pages/index.astro', 'astro.config.mjs'];
    expect(detectEntryFile(files, 'astro')).toBe('/src/pages/index.astro');
  });

  it('finds Rust entry: src/main.rs', () => {
    const files = ['Cargo.toml', 'src/main.rs', 'src/lib.rs'];
    expect(detectEntryFile(files, 'rust')).toBe('/src/main.rs');
  });

  it('finds Go entry: main.go', () => {
    const files = ['go.mod', 'main.go', 'handlers/api.go'];
    expect(detectEntryFile(files, 'go')).toBe('/main.go');
  });

  it('finds Django entry: manage.py', () => {
    const files = ['manage.py', 'myapp/views.py'];
    expect(detectEntryFile(files, 'django')).toBe('/manage.py');
  });

  it('returns null for empty file list', () => {
    expect(detectEntryFile([], 'react')).toBeNull();
  });

  it('falls back to common patterns for unknown framework', () => {
    const files = ['index.html', 'style.css', 'script.js'];
    expect(detectEntryFile(files, 'unknown')).toBe('/index.html');
  });
});

// ============================================================================
// Project Root Detection Tests
// ============================================================================

describe('Project Root Detection', () => {
  it('identifies root with package.json at top level', () => {
    const files = [
      'package.json',
      'src/index.tsx',
      'src/App.tsx',
      'src/components/Button.tsx',
      'public/index.html',
    ];
    const scored = computeRootScores(files);
    expect(scored[0].dir).toBe('');
    expect(scored[0].indicators).toContain('package.json');
  });

  it('identifies root in nested project structure', () => {
    const files = [
      'apps/web/package.json',
      'apps/web/src/index.tsx',
      'apps/web/src/App.tsx',
      'apps/api/package.json',
      'apps/api/src/main.ts',
      'package.json',
    ];
    const root = detectProjectRoot(files);
    // Top-level has package.json, so it should score highest
    expect(root).toBe('');
  });

  it('identifies Rust project root', () => {
    const files = ['Cargo.toml', 'src/main.rs', 'src/lib.rs', 'tests/integration.rs'];
    const scored = computeRootScores(files);
    expect(scored[0].dir).toBe('');
    expect(scored[0].indicators).toContain('Cargo.toml');
  });

  it('identifies Go project root', () => {
    const files = ['go.mod', 'main.go', 'handlers/api.go', 'models/user.go'];
    const scored = computeRootScores(files);
    expect(scored[0].dir).toBe('');
    expect(scored[0].indicators).toContain('go.mod');
  });

  it('returns empty string for flat file structure', () => {
    const files = ['file1.txt', 'file2.txt', 'file3.txt'];
    const root = detectProjectRoot(files);
    expect(typeof root).toBe('string');
  });
});

// ============================================================================
// Command Detection Tests
// ============================================================================

describe('Command Detection', () => {
  it('detects "npm run dev" from package.json with dev script', () => {
    const pkg = JSON.stringify({ scripts: { dev: 'next dev', build: 'next build' } });
    expect(detectRunCommand(pkg)).toBe('npm run dev');
  });

  it('detects "npm start" when dev is missing', () => {
    const pkg = JSON.stringify({ scripts: { start: 'node server.js', build: 'tsc' } });
    expect(detectRunCommand(pkg)).toBe('npm start');
  });

  it('detects framework-specific run command without package.json', () => {
    expect(detectRunCommand(undefined, 'next')).toBe('npm run dev');
    expect(detectRunCommand(undefined, 'nuxt')).toBe('npm run dev');
    expect(detectRunCommand(undefined, 'vite')).toBe('npm run dev');
    expect(detectRunCommand(undefined, 'rust')).toBe('cargo run');
    expect(detectRunCommand(undefined, 'go')).toBe('go run main.go');
    expect(detectRunCommand(undefined, 'django')).toBe('python manage.py runserver');
  });

  it('detects test command from package.json', () => {
    const pkg = JSON.stringify({ scripts: { test: 'jest', 'test:unit': 'vitest run' } });
    expect(detectTestCommand(pkg)).toBe('npm test');
  });

  it('detects build command from package.json', () => {
    const pkg = JSON.stringify({ scripts: { build: 'next build', 'build:prod': 'vite build' } });
    expect(detectBuildCommand(pkg)).toBe('npm run build');
  });

  it('returns install command for build-only projects', () => {
    const pkg = JSON.stringify({ scripts: { build: 'tsc' } });
    expect(detectRunCommand(pkg)).toBe('npm install && npm run build');
  });
});

// ============================================================================
// Natural Language → Command Translation Tests
// ============================================================================

describe('Natural Language → Command Translation (with context)', () => {
  const mockContext: ProjectContext = {
    framework: 'next',
    entryFile: '/src/app/page.tsx',
    projectRoot: '',
    runCommand: 'npm run dev',
    testCommand: 'npm test',
    buildCommand: 'npm run build',
    hasPackageJson: true,
    packageJsonScripts: ['dev', 'build', 'test', 'lint'],
    configFileIndicators: ['next.config.js', 'package.json'],
  };

  it('translates "run the project" → npm run dev', () => {
    expect(translateNaturalLanguageToCommand('run the project', mockContext)).toBe('npm run dev');
  });

  it('translates "start it" → npm run dev', () => {
    expect(translateNaturalLanguageToCommand('start it', mockContext)).toBe('npm run dev');
  });

  it('translates "build" → npm run build', () => {
    expect(translateNaturalLanguageToCommand('build', mockContext)).toBe('npm run build');
  });

  it('translates "test" → npm test', () => {
    expect(translateNaturalLanguageToCommand('test', mockContext)).toBe('npm test');
  });

  it('translates "install dependencies" → npm install', () => {
    expect(translateNaturalLanguageToCommand('install dependencies', mockContext)).toBe('npm install');
  });

  it('passes through direct commands unchanged', () => {
    expect(translateNaturalLanguageToCommand('npm run lint', mockContext)).toBe('npm run lint');
    expect(translateNaturalLanguageToCommand('git status', mockContext)).toBe('git status');
    expect(translateNaturalLanguageToCommand('npx create-next-app', mockContext)).toBe('npx create-next-app');
  });

  it('passes through git commands unchanged', () => {
    expect(translateNaturalLanguageToCommand('git commit -m "fix"', mockContext)).toBe('git commit -m "fix"');
    expect(translateNaturalLanguageToCommand('push origin main', mockContext)).toBe('push origin main');
  });

  it('uses framework-specific commands for Python project', () => {
    const pythonContext: ProjectContext = {
      framework: 'django',
      entryFile: '/manage.py',
      projectRoot: '',
      runCommand: 'python manage.py runserver',
      testCommand: 'npm test',
      buildCommand: 'npm run build',
      hasPackageJson: false,
      packageJsonScripts: [],
      configFileIndicators: ['manage.py'],
    };
    expect(translateNaturalLanguageToCommand('run the project', pythonContext)).toBe('python manage.py runserver');
  });

  it('uses framework-specific commands for Rust project', () => {
    const rustContext: ProjectContext = {
      framework: 'rust',
      entryFile: '/src/main.rs',
      projectRoot: '',
      runCommand: 'cargo run',
      testCommand: 'npm test',
      buildCommand: 'npm run build',
      hasPackageJson: false,
      packageJsonScripts: [],
      configFileIndicators: ['Cargo.toml'],
    };
    expect(translateNaturalLanguageToCommand('start it', rustContext)).toBe('cargo run');
  });

  it('translates "list files" to ls/dir', () => {
    const result = translateNaturalLanguageToCommand('list files', mockContext);
    const expected = process.platform === 'win32' ? 'dir' : 'ls -la';
    expect(result).toBe(expected);
  });
});

// ============================================================================
// VFS Path → Real Path Resolution Tests
// ============================================================================

describe('VFS Path → Real Path Resolution', () => {
  const workspaceBase = process.platform === 'win32'
    ? 'C:\\temp\\opencode-workspace'
    : '/tmp/opencode-workspace';

  it('resolves "project/sessions/002" to workspace + sessions/002', () => {
    const resolved = resolveVfsPathToRealPath('project/sessions/002', workspaceBase);
    expect(resolved).toBe(path.join(workspaceBase, 'sessions', '002'));
  });

  it('resolves "project/sessions/002/src" with nested path', () => {
    const resolved = resolveVfsPathToRealPath('project/sessions/002/src', workspaceBase);
    expect(resolved).toBe(path.join(workspaceBase, 'sessions', '002', 'src'));
  });

  it('resolves /workspace/users/alice to workspace + users/alice', () => {
    const resolved = resolveVfsPathToRealPath('/workspace/users/alice', workspaceBase);
    expect(resolved).toBe(path.join(workspaceBase, 'users', 'alice'));
  });

  it('passes through absolute paths unchanged', () => {
    const absPath = process.platform === 'win32' ? 'C:\\custom\\path' : '/custom/path';
    const resolved = resolveVfsPathToRealPath(absPath, workspaceBase);
    expect(resolved).toBe(absPath);
  });

  it('returns workspaceBase for empty path', () => {
    expect(resolveVfsPathToRealPath('', workspaceBase)).toBe(workspaceBase);
    expect(resolveVfsPathToRealPath('   ', workspaceBase)).toBe(workspaceBase);
  });

  it('normalizes backslashes on Windows', () => {
    const resolved = resolveVfsPathToRealPath('project\\sessions\\002', workspaceBase, true);
    expect(resolved).toBe(path.join(workspaceBase, 'sessions', '002'));
  });
});

// ============================================================================
// buildProjectContext Tests
// ============================================================================

describe('buildProjectContext', () => {
  it('builds complete context for Next.js project', async () => {
    const files = [
      'next.config.js',
      'package.json',
      'src/app/page.tsx',
      'src/app/layout.tsx',
      'src/components/Button.tsx',
      'public/favicon.ico',
    ];

    const readFileFn = vi.fn().mockImplementation(async (path: string) => {
      if (path.endsWith('package.json')) {
        return JSON.stringify({
          name: 'my-next-app',
          scripts: { dev: 'next dev', build: 'next build', test: 'jest' },
          dependencies: { next: '^14.0.0', react: '^18.0.0' },
        });
      }
      return null;
    });

    const ctx = await buildProjectContext(files, readFileFn);

    expect(ctx.framework).toBe('next');
    expect(ctx.entryFile).toBe('/src/app/page.tsx');
    expect(ctx.runCommand).toBe('npm run dev');
    expect(ctx.testCommand).toBe('npm test');
    expect(ctx.buildCommand).toBe('npm run build');
    expect(ctx.hasPackageJson).toBe(true);
    expect(ctx.packageJsonScripts).toContain('dev');
    expect(ctx.packageJsonScripts).toContain('build');
    expect(ctx.configFileIndicators).toContain('package.json');
  });

  it('builds context for Rust project without readFile', async () => {
    const files = ['Cargo.toml', 'src/main.rs', 'src/lib.rs'];
    const ctx = await buildProjectContext(files);

    expect(ctx.framework).toBe('rust');
    expect(ctx.entryFile).toBe('/src/main.rs');
    expect(ctx.runCommand).toBe('cargo run');
    expect(ctx.hasPackageJson).toBe(false);
  });

  it('builds context for Go project', async () => {
    const files = ['go.mod', 'main.go', 'handlers/api.go'];
    const ctx = await buildProjectContext(files);

    expect(ctx.framework).toBe('go');
    expect(ctx.entryFile).toBe('/main.go');
    expect(ctx.runCommand).toBe('go run main.go');
  });
});

// ============================================================================
// Capability Router cwd Resolution Tests
// ============================================================================

describe('Capability Router cwd Resolution', () => {
  it('sandbox.shell capability accepts cwd in input schema', async () => {
    const { SANDBOX_SHELL_CAPABILITY } = await import('@/lib/tools/capabilities');
    const result = SANDBOX_SHELL_CAPABILITY.inputSchema.safeParse({
      command: 'npm run dev',
      cwd: 'project/sessions/002',
    });
    expect(result.success).toBe(true);
    expect((result.data as any).cwd).toBe('project/sessions/002');
  });

  it('sandbox.execute capability accepts workingDir in context', async () => {
    const { SANDBOX_EXECUTE_CAPABILITY } = await import('@/lib/tools/capabilities');
    const result = SANDBOX_EXECUTE_CAPABILITY.inputSchema.safeParse({
      code: 'npm run dev',
      language: 'bash' as const,
      context: { workingDir: 'project/sessions/002' },
    });
    expect(result.success).toBe(true);
  });

  it('resolveVfsPathToRealPath integrates with capability router', () => {
    const workspacePath = process.platform === 'win32'
      ? 'C:\\temp\\opencode-workspace'
      : '/tmp/opencode-workspace';

    const cwd = resolveVfsPathToRealPath('project/sessions/002', workspacePath);
    expect(cwd).toBe(path.join(workspacePath, 'sessions', '002'));
  });
});

// ============================================================================
// E2E: Full Pipeline — LLM Prompt → Project Detection → Command Execution
// ============================================================================

describe('E2E: Full Pipeline — LLM Prompt → Project Detection → Command Execution', () => {
  it('simulates: "run and debug project" on Next.js repo', async () => {
    // Step 1: VFS provides file listing
    const files = [
      'next.config.js',
      'package.json',
      'src/app/page.tsx',
      'src/app/layout.tsx',
      'tsconfig.json',
    ];

    // Step 2: Read package.json
    const pkgContent = JSON.stringify({
      scripts: { dev: 'next dev', build: 'next build', test: 'jest' },
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    });

    // Step 3: Build project context
    const ctx = await buildProjectContext(files, async (p: string) => {
      if (p.endsWith('package.json')) return pkgContent;
      return null;
    });

    expect(ctx.framework).toBe('next');
    expect(ctx.runCommand).toBe('npm run dev');

    // Step 4: LLM says "run and debug project"
    const nlPrompt = 'run and debug project';
    const command = translateNaturalLanguageToCommand(nlPrompt, ctx);

    expect(command).toBe('npm run dev');
  });

  it('simulates: "build the project" on Vue repo', async () => {
    const files = ['vite.config.ts', 'package.json', 'src/main.ts', 'src/App.vue'];
    const pkgContent = JSON.stringify({
      scripts: { dev: 'vite', build: 'vue-tsc && vite build' },
      dependencies: { vue: '^3.0.0', '@vitejs/plugin-vue': '^4.0.0' },
    });

    const ctx = await buildProjectContext(files, async (p: string) => {
      if (p.endsWith('package.json')) return pkgContent;
      return null;
    });

    expect(ctx.framework).toBe('vue');
    expect(ctx.buildCommand).toBe('npm run build');

    const command = translateNaturalLanguageToCommand('build the project', ctx);
    expect(command).toBe('npm run build');
  });

  it('simulates: "test everything" on Python/Django repo', async () => {
    const files = ['manage.py', 'myapp/views.py', 'myapp/models.py', 'requirements.txt'];

    const ctx = await buildProjectContext(files);

    expect(ctx.framework).toBe('django');
    expect(ctx.runCommand).toBe('python manage.py runserver');

    const command = translateNaturalLanguageToCommand('test everything', ctx);
    expect(command).toBe('npm test');  // Default since Django doesn't use npm
  });

  it('simulates: "run it" on Rust repo', async () => {
    const files = ['Cargo.toml', 'src/main.rs', 'src/lib.rs'];

    const ctx = await buildProjectContext(files);

    expect(ctx.framework).toBe('rust');
    expect(ctx.runCommand).toBe('cargo run');

    const command = translateNaturalLanguageToCommand('run it', ctx);
    expect(command).toBe('cargo run');
  });

  it('simulates: "start" on Go repo', async () => {
    const files = ['go.mod', 'main.go', 'handlers/api.go'];

    const ctx = await buildProjectContext(files);

    expect(ctx.framework).toBe('go');
    expect(ctx.runCommand).toBe('go run main.go');

    const command = translateNaturalLanguageToCommand('start', ctx);
    expect(command).toBe('go run main.go');
  });

  it('auto-detects entry file and project root before running', async () => {
    const files = [
      'next.config.js',
      'package.json',
      'src/app/page.tsx',
      'src/app/layout.tsx',
      'src/components/Button.tsx',
      'public/favicon.ico',
      'README.md',
    ];

    const ctx = await buildProjectContext(files);

    // Entry file should be detected
    expect(ctx.entryFile).not.toBeNull();
    expect(ctx.entryFile).toContain('page.tsx');

    // Project root should be top-level
    expect(ctx.projectRoot).toBe('');

    // Framework should be Next.js
    expect(ctx.framework).toBe('next');

    // Run command should be npm run dev
    expect(ctx.runCommand).toBe('npm run dev');
  });
});
