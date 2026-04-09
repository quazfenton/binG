/**
 * Universal Project Detection & Auto-Context
 *
 * Used by ANY agent/provider (OpenCode, Daytona, E2B, sandbox.shell, sandbox.execute)
 * to auto-detect project structure, entry points, frameworks, package managers,
 * Docker/Compose modes, and generate smart-context for LLM consumption.
 *
 * This consolidates the scattered detection logic from:
 * - live-preview-offloading.ts (detectEntryPoint, computeRootScores, detectNextJS)
 * - code-preview-panel.tsx (detectEntryFile, detectFrameworkFromFiles)
 * - opencode-cli.ts (detectProjectCommand, translateNaturalLanguageToCommand)
 *
 * @module project-detection
 */

import type { ToolExecutionContext } from '@/lib/tools/tool-integration/types';

// ============================================================================
// Package Manager Detection
// ============================================================================

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'deno' | 'unknown';

const LOCKFILE_MAP: Record<string, PackageManager> = {
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
  'deno.lock': 'deno',
};

/**
 * Detect package manager from lockfiles in file paths.
 */
export function detectPackageManager(filePaths: string[]): PackageManager {
  for (const [lockfile, pm] of Object.entries(LOCKFILE_MAP)) {
    if (filePaths.some(p => p.endsWith(lockfile) || p.endsWith('/' + lockfile))) {
      return pm;
    }
  }

  // Fallback: check package.json packageManager field if available
  return 'unknown';
}

/**
 * Detect package manager from package.json content (packageManager field).
 */
export function detectPackageManagerFromPackageJson(packageJsonContent?: string): PackageManager {
  if (!packageJsonContent) return 'unknown';

  try {
    const pkg = JSON.parse(packageJsonContent);
    const pmField = pkg.packageManager;
    if (pmField) {
      if (pmField.startsWith('pnpm@')) return 'pnpm';
      if (pmField.startsWith('yarn@')) return 'yarn';
      if (pmField.startsWith('bun@')) return 'bun';
      if (pmField.startsWith('npm@')) return 'npm';
      if (pmField.startsWith('deno@')) return 'deno';
    }
  } catch { /* parse error */ }

  return 'unknown';
}

/**
 * Get the install command for the detected package manager.
 */
export function getInstallCommand(pm: PackageManager): string {
  const effectivePm = pm === 'unknown' ? 'npm' : pm;
  switch (effectivePm) {
    case 'pnpm': return 'pnpm install';
    case 'yarn': return 'yarn install';
    case 'bun': return 'bun install';
    case 'deno': return 'deno install';
    default: return 'npm install';
  }
}

/**
 * Get the run command prefix for the detected package manager.
 */
export function getRunCommandPrefix(pm: PackageManager, script: string): string {
  // npm has shorthand for test, start, and stop — also treat 'unknown' as npm
  const effectivePm = pm === 'unknown' ? 'npm' : pm;
  if (effectivePm === 'npm' && (script === 'test' || script === 'start' || script === 'stop')) {
    return `npm ${script}`;
  }
  switch (effectivePm) {
    case 'pnpm': return `pnpm run ${script}`;
    case 'yarn': return `yarn ${script}`;
    case 'bun': return `bun run ${script}`;
    case 'deno': return `deno task ${script}`;
    default: return `npm run ${script}`;
  }
}

// ============================================================================
// Runtime Mode Detection (Docker, Compose, Monorepo, etc.)
// ============================================================================

export type RuntimeMode =
  | 'docker'          // Single Dockerfile
  | 'docker-compose'  // docker-compose.yml
  | 'monorepo-pnpm'   // pnpm-workspace.yaml
  | 'monorepo-turborepo' // turbo.json
  | 'monorepo-nx'     // nx.json
  | 'monorepo-lerna'  // lerna.json
  | 'serverless'      // serverless.yml
  | 'vercel'          // vercel.json
  | 'netlify'         // netlify.toml
  | 'standard';       // Standard project (no special runtime)

const RUNTIME_CONFIG_MAP: Record<string, RuntimeMode> = {
  'docker-compose.yml': 'docker-compose',
  'docker-compose.yaml': 'docker-compose',
  'compose.yml': 'docker-compose',
  'compose.yaml': 'docker-compose',
  'Dockerfile': 'docker',
  'Dockerfile.dev': 'docker',
  'Dockerfile.prod': 'docker',
  'Dockerfile.production': 'docker',
  '.dockerignore': 'docker',
  'pnpm-workspace.yaml': 'monorepo-pnpm',
  'turbo.json': 'monorepo-turborepo',
  'nx.json': 'monorepo-nx',
  'lerna.json': 'monorepo-lerna',
  'serverless.yml': 'serverless',
  'serverless.yaml': 'serverless',
  'serverless.ts': 'serverless',
  'vercel.json': 'vercel',
  'netlify.toml': 'netlify',
};

/**
 * Detect runtime mode from file paths.
 */
export function detectRuntimeMode(filePaths: string[]): RuntimeMode {
  // Check for compose first (takes priority over single docker)
  const hasCompose = filePaths.some(p =>
    p.endsWith('docker-compose.yml') || p.endsWith('docker-compose.yaml') ||
    p.endsWith('compose.yml') || p.endsWith('compose.yaml')
  );
  if (hasCompose) return 'docker-compose';

  // Check for monorepo configs
  if (filePaths.some(p => p.endsWith('pnpm-workspace.yaml'))) return 'monorepo-pnpm';
  if (filePaths.some(p => p.endsWith('turbo.json'))) return 'monorepo-turborepo';
  if (filePaths.some(p => p.endsWith('nx.json'))) return 'monorepo-nx';
  if (filePaths.some(p => p.endsWith('lerna.json'))) return 'monorepo-lerna';

  // Check for serverless/PaaS configs
  if (filePaths.some(p => p.endsWith('serverless.yml') || p.endsWith('serverless.yaml'))) return 'serverless';
  if (filePaths.some(p => p.endsWith('vercel.json'))) return 'vercel';
  if (filePaths.some(p => p.endsWith('netlify.toml'))) return 'netlify';

  // Check for Docker
  if (filePaths.some(p =>
    p === 'Dockerfile' || p.endsWith('/Dockerfile') ||
    p === 'Dockerfile.dev' || p.endsWith('/Dockerfile.dev') ||
    p === 'Dockerfile.prod' || p.endsWith('/Dockerfile.prod') ||
    p === '.dockerignore' || p.endsWith('/.dockerignore')
  )) {
    return 'docker';
  }

  return 'standard';
}

/**
 * Get Docker-related commands based on detected mode.
 */
export function getDockerCommands(mode: RuntimeMode): { up: string; down: string; build: string } | null {
  if (mode === 'docker-compose') {
    return {
      up: 'docker compose up -d',
      down: 'docker compose down',
      build: 'docker compose build',
    };
  }
  if (mode === 'docker') {
    return {
      up: 'docker build -t app . && docker run -p 3000:3000 app',
      down: 'docker stop app && docker rm app',
      build: 'docker build -t app .',
    };
  }
  return null;
}

// ============================================================================
// Framework Detection
// ============================================================================

export type AppFramework =
  | 'next' | 'react' | 'vite-react' | 'vue' | 'nuxt' | 'svelte' | 'angular'
  | 'solid' | 'astro' | 'qwik' | 'vite' | 'vanilla' | 'node'
  | 'gradio' | 'streamlit' | 'flask' | 'fastapi' | 'django' | 'rust' | 'go'
  | 'python' | 'unknown';

const CONFIG_FILE_MAP: Record<string, string[]> = {
  next: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
  nuxt: ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'],
  vite: ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'],
  webpack: ['webpack.config.js', 'webpack.config.ts'],
  astro: ['astro.config.mjs', 'astro.config.js', 'astro.config.ts'],
  svelte: ['svelte.config.js', 'svelte.config.ts'],
  angular: ['angular.json'],
  remix: ['remix.config.js', 'remix.config.mjs'],
  gatsby: ['gatsby-config.js', 'gatsby-config.ts'],
  qwik: ['qwik.config.ts', 'qwik.config.js'],
};

const DEPENDENCY_FRAMEWORK_MAP: Record<string, AppFramework> = {
  next: 'next',
  'next-auth': 'next',
  nuxt: 'nuxt',
  'nuxt3': 'nuxt',
  '@remix-run/node': 'remix',
  gatsby: 'gatsby',
  '@angular/core': 'angular',
  '@angular/compiler': 'angular',
  vite: 'vite',
  'vite-plugin-react': 'vite-react',
  '@vitejs/plugin-react': 'vite-react',
  '@vitejs/plugin-vue': 'vue',
  '@vitejs/plugin-svelte': 'svelte',
  '@sveltejs/kit': 'svelte',
  'solid-js': 'solid',
  '@solidjs/start': 'solid',
  astro: 'astro',
  '@builder.io/qwik': 'qwik',
  vue: 'vue',
  'react-dom': 'react',
  svelte: 'svelte',
  'flask': 'flask',
  'fastapi': 'fastapi',
  'django': 'django',
  'streamlit': 'streamlit',
  'gradio': 'gradio',
};

const EXTENSION_FRAMEWORK_MAP: Record<string, AppFramework> = {
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
  '.tsx': 'react',
  '.jsx': 'react',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
};

/**
 * Detect framework from file list and package.json content.
 */
export function detectFrameworkFromFiles(
  filePaths: string[],
  packageJsonContent?: string,
): AppFramework {
  // Check package.json dependencies FIRST (highest confidence)
  if (packageJsonContent) {
    try {
      const pkg = JSON.parse(packageJsonContent);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [dep, fw] of Object.entries(DEPENDENCY_FRAMEWORK_MAP)) {
        if (allDeps[dep]) return fw;
      }
    } catch { /* parse error, continue */ }
  }

  // Check config files
  for (const [framework, configs] of Object.entries(CONFIG_FILE_MAP)) {
    for (const config of configs) {
      if (filePaths.some(p => p.endsWith(config) || p.endsWith('/' + config))) {
        return framework as AppFramework;
      }
    }
  }

  // Check file extensions (heuristic)
  const extCounts: Record<string, number> = {};
  for (const path of filePaths) {
    const ext = '.' + path.split('.').pop()?.toLowerCase();
    if (ext && EXTENSION_FRAMEWORK_MAP[ext]) {
      extCounts[EXTENSION_FRAMEWORK_MAP[ext]] = (extCounts[EXTENSION_FRAMEWORK_MAP[ext]] || 0) + 1;
    }
  }

  // Python project detection
  if (filePaths.some(p => p.endsWith('manage.py'))) return 'django';
  if (filePaths.some(p => p.endsWith('app.py') || p.endsWith('main.py'))) {
    if (filePaths.some(p => p.endsWith('requirements.txt'))) return 'python';
    return 'python';
  }

  // Rust/Go
  if (filePaths.some(p => p.endsWith('Cargo.toml'))) return 'rust';
  if (filePaths.some(p => p.endsWith('go.mod'))) return 'go';

  // Pick most common framework by file count
  let bestFramework: AppFramework = 'unknown';
  let bestCount = 0;
  for (const [fw, count] of Object.entries(extCounts)) {
    if (count > bestCount) {
      bestCount = count;
      bestFramework = fw as AppFramework;
    }
  }

  return bestFramework;
}

// ============================================================================
// Entry Point Detection
// ============================================================================

const FRAMEWORK_ENTRY_POINTS: Record<AppFramework, string[]> = {
  react: ['/src/main.tsx', '/src/main.jsx', '/src/index.tsx', '/src/index.jsx', '/src/App.tsx', '/src/App.jsx', '/index.tsx', '/index.jsx', '/main.tsx', '/main.jsx'],
  'vite-react': ['/src/main.tsx', '/src/main.jsx', '/src/index.tsx', '/src/index.jsx', '/src/App.tsx', '/src/App.jsx'],
  next: ['/src/app/page.tsx', '/src/app/page.jsx', '/src/app/layout.tsx', '/src/app/layout.jsx', '/pages/index.tsx', '/pages/index.jsx', '/src/pages/index.tsx', '/src/pages/index.jsx'],
  vue: ['/src/main.ts', '/src/main.js', '/src/App.vue', '/main.ts', '/main.js', '/src/index.ts'],
  nuxt: ['/app.vue', '/App.vue', '/src/app.vue', '/src/main.ts', '/pages/index.vue', '/nuxt.config.ts'],
  svelte: ['/src/main.ts', '/src/main.js', '/src/App.svelte', '/main.ts', '/main.js'],
  angular: ['/src/main.ts', '/src/app/app.component.ts', '/main.ts', '/angular.json'],
  solid: ['/src/index.tsx', '/src/index.jsx', '/src/App.tsx', '/src/root.tsx'],
  astro: ['/src/pages/index.astro', '/pages/index.astro', '/index.astro'],
  qwik: ['/src/root.tsx', '/src/index.tsx', '/src/routes/index.tsx'],
  vite: ['/src/main.ts', '/src/main.js', '/src/index.ts', '/vite.config.ts'],
  vanilla: ['/index.html', '/index.js', '/main.js', '/app.js'],
  node: ['/server.js', '/app.js', '/index.js', '/main.js', '/src/index.js'],
  gradio: ['/main.py', '/app.py', '/demo.py'],
  streamlit: ['/main.py', '/app.py', '/streamlit_app.py'],
  flask: ['/main.py', '/app.py', '/run.py'],
  fastapi: ['/main.py', '/app.py', '/server.py'],
  django: ['/manage.py', '/main.py'],
  python: ['/main.py', '/app.py'],
  rust: ['/src/main.rs'],
  go: ['/main.go'],
  gatsby: ['/src/pages/index.js', '/src/pages/index.tsx', '/gatsby-config.js'],
  remix: ['/app/routes/_index.tsx', '/app/root.tsx'],
  unknown: ['/index.html', '/index.js', '/main.py', '/main.js', '/app.js'],
};

/**
 * Detect entry file from file paths and detected framework.
 */
export function detectEntryFile(
  filePaths: string[],
  framework: AppFramework = 'unknown',
): string | null {
  const candidates = FRAMEWORK_ENTRY_POINTS[framework] || FRAMEWORK_ENTRY_POINTS.unknown;

  for (const candidate of candidates) {
    const withSlash = candidate.startsWith('/') ? candidate : '/' + candidate;
    const withoutSlash = candidate.startsWith('/') ? candidate.slice(1) : candidate;

    if (filePaths.includes(withSlash) || filePaths.includes(withoutSlash)) {
      return withSlash;
    }
    const found = filePaths.find(p => p.endsWith(candidate));
    if (found) return found;
  }

  // Fallback to common patterns
  const fallbackPatterns = ['index.html', 'index.js', 'main.js', 'app.js', 'main.py', 'app.py', 'server.js'];
  for (const pattern of fallbackPatterns) {
    const found = filePaths.find(p => p.endsWith(pattern));
    if (found) return found;
  }

  return null;
}

// ============================================================================
// Project Root Detection
// ============================================================================

const ROOT_INDICATORS = [
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'CMakeLists.txt',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  '.git',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'nuxt.config.ts',
  'angular.json',
  'svelte.config.js',
  'astro.config.mjs',
  'remix.config.js',
  'gatsby-config.js',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  'deno.lock',
  'turbo.json',
  'nx.json',
  'lerna.json',
  'serverless.yml',
  'vercel.json',
  'netlify.toml',
];

/**
 * Compute root scores for all directories in file list.
 */
export function computeRootScores(filePaths: string[]): Array<{ dir: string; score: number; indicators: string[] }> {
  const dirScores = new Map<string, { score: number; indicators: Set<string> }>();

  for (const filePath of filePaths) {
    const parts = filePath.split('/');
    // Walk up the directory tree
    for (let i = 0; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!dirScores.has(dir)) {
        dirScores.set(dir, { score: 0, indicators: new Set() });
      }
    }

    // Check if this file is a root indicator
    const fileName = parts[parts.length - 1];
    for (const indicator of ROOT_INDICATORS) {
      if (fileName === indicator || fileName === indicator.replace(/^\./, '')) {
        // Find the directory containing this file
        const dir = parts.slice(0, -1).join('/');
        const entry = dirScores.get(dir);
        if (entry) {
          entry.score += 1;
          entry.indicators.add(indicator);
        }
        // Also score parent directories (lower weight)
        for (let j = parts.length - 2; j >= 0; j--) {
          const parentDir = parts.slice(0, j).join('/');
          const parentEntry = dirScores.get(parentDir);
          if (parentEntry) {
            parentEntry.score += 0.5;
            parentEntry.indicators.add(indicator);
          }
        }
      }
    }
  }

  return Array.from(dirScores.entries())
    .map(([dir, data]) => ({ dir, score: data.score, indicators: Array.from(data.indicators) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Get the best project root directory from file paths.
 */
export function detectProjectRoot(filePaths: string[]): string {
  const scored = computeRootScores(filePaths);
  if (scored.length > 0 && scored[0].score > 0) {
    return scored[0].dir;
  }
  // Fallback: use the most common directory
  const dirCounts = new Map<string, number>();
  for (const path of filePaths) {
    const parts = path.split('/');
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join('/');
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
    }
  }
  let bestDir = '';
  let bestCount = 0;
  for (const [dir, count] of dirCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestDir = dir;
    }
  }
  return bestDir || '.';
}

// ============================================================================
// Run Command Detection
// ============================================================================

/**
 * Detect the appropriate run command, aware of package manager.
 */
export function detectRunCommand(
  packageJsonContent?: string,
  framework?: AppFramework,
  packageManager?: PackageManager,
): string | null {
  const pm = packageManager || 'npm';
  const run = (script: string) => getRunCommandPrefix(pm, script);
  const install = getInstallCommand(pm);

  if (!packageJsonContent) {
    // Fallback based on framework
    if (framework === 'next') return run('dev');
    if (framework === 'nuxt') return run('dev');
    if (framework === 'vite' || framework === 'vite-react') return run('dev');
    if (framework === 'vue') return run('dev');
    if (framework === 'svelte') return run('dev');
    if (framework === 'astro') return run('dev');
    if (framework === 'remix') return run('dev');
    if (framework === 'node') return 'node server.js';
    if (framework === 'rust') return 'cargo run';
    if (framework === 'go') return 'go run main.go';
    if (framework === 'python' || framework === 'flask' || framework === 'fastapi') return 'python main.py';
    if (framework === 'django') return 'python manage.py runserver';
    return null;
  }

  try {
    const pkg = JSON.parse(packageJsonContent);
    const scripts = pkg.scripts || {};

    // Priority order for web projects
    if (scripts.dev) return run('dev');
    if (scripts.start) return run('start');
    if (scripts.serve) return run('serve');
    if (scripts['dev:next']) return run('dev:next');
    if (scripts['dev:server']) return run('dev:server');
    if (scripts.preview) return run('preview');

    // Build projects
    if (scripts.build) return `${install} && ${run('build')}`;

    // Fallback
    return install;
  } catch {
    return null;
  }
}

/**
 * Detect the test command.
 */
export function detectTestCommand(packageJsonContent?: string, packageManager?: PackageManager): string {
  const pm = packageManager || 'npm';

  if (!packageJsonContent) return getRunCommandPrefix(pm, 'test');

  try {
    const pkg = JSON.parse(packageJsonContent);
    const scripts = pkg.scripts || {};

    if (scripts.test) return getRunCommandPrefix(pm, 'test');
    if (scripts['test:unit']) return getRunCommandPrefix(pm, 'test:unit');
    if (scripts['test:e2e']) return getRunCommandPrefix(pm, 'test:e2e');
    if (scripts.vitest) return pm === 'bun' ? 'bun vitest run' : `npx vitest run`;
    if (scripts.jest) return pm === 'bun' ? 'bun jest' : `npx jest`;

    return getRunCommandPrefix(pm, 'test');
  } catch {
    return getRunCommandPrefix(pm, 'test');
  }
}

/**
 * Detect the build command.
 */
export function detectBuildCommand(packageJsonContent?: string, packageManager?: PackageManager): string {
  const pm = packageManager || 'npm';

  if (!packageJsonContent) return getRunCommandPrefix(pm, 'build');

  try {
    const pkg = JSON.parse(packageJsonContent);
    const scripts = pkg.scripts || {};

    if (scripts.build) return getRunCommandPrefix(pm, 'build');
    if (scripts['build:prod']) return getRunCommandPrefix(pm, 'build:prod');
    if (scripts['build:production']) return getRunCommandPrefix(pm, 'build:production');
    if (scripts.compile) return getRunCommandPrefix(pm, 'compile');

    return getRunCommandPrefix(pm, 'build');
  } catch {
    return getRunCommandPrefix(pm, 'build');
  }
}

// ============================================================================
// Smart Context for LLM
// ============================================================================

/**
 * Smart context file format that the LLM can read or receive as system prompt.
 * Combines project detection results with actionable recommendations.
 */
export interface SmartContextFile {
  /** Generated summary for LLM */
  summary: string;
  /** Detected framework */
  framework: AppFramework;
  /** Detected package manager */
  packageManager: PackageManager;
  /** Detected runtime mode (Docker, Compose, Monorepo, etc.) */
  runtimeMode: RuntimeMode;
  /** Entry file path */
  entryFile: string | null;
  /** Project root directory */
  projectRoot: string;
  /** Available scripts from package.json */
  availableScripts: string[];
  /** Recommended commands for common tasks */
  recommendedCommands: {
    install: string;
    run: string | null;
    test: string;
    build: string;
    dockerUp?: string;
    dockerDown?: string;
  };
  /** Key configuration files detected */
  configFileIndicators: string[];
  /** LLM action hints */
  hints: string[];
}

/**
 * Generate a smart context file for LLM consumption.
 * This can be written to a file or sent as system prompt.
 */
export function generateSmartContext(
  projectContext: ProjectContext,
  packageManager: PackageManager,
  runtimeMode: RuntimeMode,
): SmartContextFile {
  const install = getInstallCommand(packageManager);
  const dockerCmd = getDockerCommands(runtimeMode);

  const recommendedCommands = {
    install,
    run: projectContext.runCommand,
    test: projectContext.testCommand,
    build: projectContext.buildCommand,
    ...(dockerCmd ? { dockerUp: dockerCmd.up, dockerDown: dockerCmd.down } : {}),
  };

  const hints: string[] = [];

  // Framework-specific hints
  if (projectContext.framework === 'next') {
    hints.push('Next.js project — use `npm run dev` for HMR dev server');
    hints.push('App Router detected — entry is src/app/page.tsx');
  }
  if (projectContext.framework === 'nuxt') {
    hints.push('Nuxt.js project — uses Vue 3 + Vite');
  }
  if (projectContext.framework === 'django') {
    hints.push('Django project — use `python manage.py runserver`');
    hints.push('Entry point is manage.py for admin/migrations');
  }
  if (projectContext.framework === 'rust') {
    hints.push('Rust project — use `cargo run` to build and run');
  }
  if (projectContext.framework === 'go') {
    hints.push('Go project — use `go run main.go` to run');
  }

  // Package manager hints
  if (packageManager === 'pnpm') {
    hints.push('Uses pnpm — faster installs, disk-efficient');
  }
  if (packageManager === 'bun') {
    hints.push('Uses Bun — ultra-fast runtime + package manager');
  }

  // Runtime mode hints
  if (runtimeMode === 'docker-compose') {
    hints.push('Uses Docker Compose — use `docker compose up -d` to start all services');
  } else if (runtimeMode === 'docker') {
    hints.push('Has Dockerfile — can be containerized with `docker build`');
  } else if (runtimeMode === 'monorepo-pnpm') {
    hints.push('pnpm monorepo — use `pnpm install` at root to install all workspace deps');
  } else if (runtimeMode === 'monorepo-turborepo') {
    hints.push('Turborepo monorepo — use `turbo run dev` for parallel dev');
  } else if (runtimeMode === 'vercel') {
    hints.push('Deployed on Vercel — auto-deploys on push');
  }

  // Summary
  const summary = [
    `Project: ${projectContext.framework} app`,
    `Package Manager: ${packageManager}`,
    `Runtime: ${runtimeMode}`,
    `Entry: ${projectContext.entryFile || 'not detected'}`,
    `Scripts: ${projectContext.packageJsonScripts.join(', ') || 'none detected'}`,
  ].join('\n');

  return {
    summary,
    framework: projectContext.framework,
    packageManager,
    runtimeMode,
    entryFile: projectContext.entryFile,
    projectRoot: projectContext.projectRoot,
    availableScripts: projectContext.packageJsonScripts,
    recommendedCommands: recommendedCommands,
    configFileIndicators: projectContext.configFileIndicators,
    hints,
  };
}

/**
 * Format smart context as a markdown string for LLM system prompt.
 */
export function formatSmartContextAsMarkdown(ctx: SmartContextFile): string {
  const lines = [
    `## Project Context`,
    ``,
    `${ctx.summary}`,
    ``,
    `| Property | Value |`,
    `|----------|-------|`,
    `| Framework | \`${ctx.framework}\` |`,
    `| Package Manager | \`${ctx.packageManager}\` |`,
    `| Runtime Mode | \`${ctx.runtimeMode}\` |`,
    `| Entry File | \`${ctx.entryFile || 'not detected'}\` |`,
    `| Project Root | \`${ctx.projectRoot || '.'}\` |`,
    ``,
    `### Available Scripts`,
    ``,
    ctx.availableScripts.length > 0
      ? ctx.availableScripts.map(s => `- \`${s}\``).join('\n')
      : '- No scripts detected',
    ``,
    `### Recommended Commands`,
    ``,
    `- **Install**: \`${ctx.recommendedCommands.install}\``,
    ctx.recommendedCommands.run ? `- **Run**: \`${ctx.recommendedCommands.run}\`` : '',
    `- **Test**: \`${ctx.recommendedCommands.test}\``,
    `- **Build**: \`${ctx.recommendedCommands.build}\``,
    ctx.recommendedCommands.dockerUp ? `- **Docker Up**: \`${ctx.recommendedCommands.dockerUp}\`` : '',
    ctx.recommendedCommands.dockerDown ? `- **Docker Down**: \`${ctx.recommendedCommands.dockerDown}\`` : '',
    ``,
  ].filter(Boolean);

  if (ctx.hints.length > 0) {
    lines.push(`### Hints`, ``);
    for (const hint of ctx.hints) {
      lines.push(`- ${hint}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Auto-Context Builder
// ============================================================================

export interface ProjectContext {
  framework: AppFramework;
  entryFile: string | null;
  projectRoot: string;
  runCommand: string | null;
  testCommand: string;
  buildCommand: string;
  hasPackageJson: boolean;
  packageJsonScripts: string[];
  configFileIndicators: string[];
}

/**
 * Build complete project context from file paths and optional file reader.
 * Detects:
 * - Framework (Next, Vue, Nuxt, Svelte, React, Django, Rust, Go, etc.)
 * - Package manager (npm, yarn, pnpm, bun, deno) from lockfiles
 * - Runtime mode (Docker, Docker Compose, Monorepo, Serverless, Vercel, Netlify)
 * - Entry file, project root, run/test/build commands
 *
 * The LLM can use this to make informed decisions about what commands to run.
 */
export async function buildProjectContext(
  filePaths: string[],
  readFileFn?: (path: string) => Promise<string | null>,
): Promise<ProjectContext & {
  packageManager: PackageManager;
  runtimeMode: RuntimeMode;
  smartContext: SmartContextFile;
}> {
  const projectRoot = detectProjectRoot(filePaths);

  // Detect package manager from lockfiles
  const packageManager = detectPackageManager(filePaths);

  // Detect runtime mode
  const runtimeMode = detectRuntimeMode(filePaths);

  // Try to read package.json
  let packageJsonContent: string | undefined;
  let hasPackageJson = false;
  let packageJsonScripts: string[] = [];

  if (readFileFn) {
    const pkgPath = projectRoot === '/' ? '/package.json' : `${projectRoot}/package.json`;
    packageJsonContent = await readFileFn(pkgPath);
    if (packageJsonContent) {
      hasPackageJson = true;
      try {
        const pkg = JSON.parse(packageJsonContent);
        if (pkg.scripts) {
          packageJsonScripts = Object.keys(pkg.scripts);
        }
      } catch { /* parse error */ }
    }
  }

  // Refine package manager from package.json packageManager field
  const detectedFromPkgJson = packageJsonContent
    ? detectPackageManagerFromPackageJson(packageJsonContent)
    : 'unknown';
  const refinedPackageManager = detectedFromPkgJson !== 'unknown'
    ? detectedFromPkgJson
    : packageManager;

  const framework = detectFrameworkFromFiles(filePaths, packageJsonContent);
  const entryFile = detectEntryFile(filePaths, framework);
  const runCommand = detectRunCommand(packageJsonContent, framework, refinedPackageManager);
  const testCommand = detectTestCommand(packageJsonContent, refinedPackageManager);
  const buildCommand = detectBuildCommand(packageJsonContent, refinedPackageManager);

  // Collect config file indicators
  const scored = computeRootScores(filePaths);
  const configFileIndicators = scored.length > 0 ? scored[0].indicators : [];

  const baseContext: ProjectContext = {
    framework,
    entryFile,
    projectRoot,
    runCommand,
    testCommand,
    buildCommand,
    hasPackageJson,
    packageJsonScripts,
    configFileIndicators,
  };

  // Generate smart context
  const smartContext = generateSmartContext(baseContext, refinedPackageManager, runtimeMode);

  return {
    ...baseContext,
    packageManager: refinedPackageManager,
    runtimeMode,
    smartContext,
  };
}

// ============================================================================
// Natural Language → Command Translation
// ============================================================================

/**
 * Translate natural language task descriptions into shell commands.
 *
 * @deprecated This was the rule-based NL→command path. The primary path is now:
 *   1. LLM receives the original command (not translated)
 *   2. LLM has access to EXTENDED_SANDBOX_TOOLS (project_analyze, terminal_*, etc.)
 *   3. LLM calls project_analyze to get structured project context
 *   4. LLM decides what command to run based on that context
 *
 * This function is kept as a fallback for standalone code paths that don't
 * have access to the extended tool system (e.g., opencode-cli.ts direct usage).
 *
 * Uses detected project context to generate the correct command.
 */
export function translateNaturalLanguageToCommand(
  task: string,
  context: ProjectContext & { packageManager?: PackageManager; runtimeMode?: RuntimeMode },
): string {
  const lower = task.toLowerCase().trim();
  const pm = context.packageManager || 'npm';
  const mode = context.runtimeMode || 'standard';
  const install = getInstallCommand(pm);
  const run = (script: string) => getRunCommandPrefix(pm, script);

  // Direct commands — pass through
  if (/^(npm|yarn|pnpm|npx|cargo|go|python|pip|node|deno|bun)\b/.test(lower)) {
    return task;
  }

  // Git commands — pass through
  if (/^(git\s|commit|push|pull|branch)/i.test(lower)) {
    return task;
  }

  // Docker commands
  if (mode === 'docker-compose' || mode === 'docker') {
    // "start docker", "start the container" → docker up
    if (/^(start\s*(the\s*)?(container|docker)|start\s+docker)/i.test(lower)) {
      const dockerCmd = getDockerCommands(mode);
      if (dockerCmd) return dockerCmd.up;
    }
    // "stop docker" → docker down
    if (/^(stop\s*docker|docker\s*down)/i.test(lower)) {
      const dockerCmd = getDockerCommands(mode);
      if (dockerCmd) return dockerCmd.down;
    }
    // "build docker", "docker build" → docker build
    if (/^(build\s*docker|docker\s*build)/i.test(lower)) {
      const dockerCmd = getDockerCommands(mode);
      if (dockerCmd) return dockerCmd.build;
    }
    // Direct docker compose commands — pass through
    if (/^(docker compose)/i.test(lower)) {
      return task;
    }
  }

  // "run the project", "start it", "debug the app"
  if (/(run|start|launch|debug|execute)\s*(the\s*)?(project|app|server|dev|it|this)?\s*$/i.test(lower) ||
      /^(run|start)$/.test(lower)) {
    return context.runCommand || run('dev');
  }

  // Build
  if (/^(build|compile|package)\b/i.test(lower)) {
    return context.buildCommand;
  }

  // Test
  if (/^(test|run\s*tests?)\b/i.test(lower)) {
    return context.testCommand;
  }

  // Install
  if (/^(install|add\s*dependency|npm\s*install|yarn\s*add|pnpm\s*add|bun\s*add|bun\s*install)/i.test(lower)) {
    return install;
  }

  // Lint
  if (/^(lint|format|prettier|eslint)/i.test(lower)) {
    return run('lint') + ' || ' + run('format') + ' || echo "No lint script found"';
  }

  // File listing
  if (/^(list|ls|dir|show\s*files)/i.test(lower)) {
    return process.platform === 'win32' ? 'dir' : 'ls -la';
  }

  // Pass through as-is
  return task;
}

// ============================================================================
// CWD Resolution from VFS ScopedPath to Real Filesystem Path
// ============================================================================

/**
 * Resolve a VFS scoped path (e.g., "project/sessions/002") to a real filesystem path.
 * Used by any provider that needs to execute shell commands in the correct directory.
 */
export function resolveVfsPathToRealPath(
  vfsPath: string,
  workspaceBaseDir: string,
  isWindows: boolean = process.platform === 'win32',
): string {
  if (!vfsPath || !vfsPath.trim()) return workspaceBaseDir;

  // Normalize slashes
  let normalized = vfsPath.replace(/\\/g, '/');

  // Strip leading slash
  if (normalized.startsWith('/')) normalized = normalized.slice(1);

  // Handle VFS scoped paths like "project/sessions/002/src"
  if (normalized.startsWith('project/')) {
    const relativePart = normalized.replace(/^project\//, '');
    const segments = relativePart.split('/');
    return [workspaceBaseDir, ...segments].join(isWindows ? '\\' : '/');
  }

  // Handle /workspace/... paths
  if (vfsPath.startsWith('/workspace/')) {
    const relativePart = vfsPath.replace('/workspace/', '');
    const segments = relativePart.split('/');
    return [workspaceBaseDir, ...segments].join(isWindows ? '\\' : '/');
  }

  // Already absolute Windows path
  if (isWindows && /^[A-Z]:\\/i.test(vfsPath)) return vfsPath;
  // Already absolute Unix path
  if (vfsPath.startsWith('/')) return vfsPath;

  // Relative path — resolve against workspace base
  const segments = normalized.split('/');
  return [workspaceBaseDir, ...segments].join(isWindows ? '\\' : '/');
}
