/**
 * Project Analysis Tools
 *
 * Exposes project-aware analysis capabilities that the LLM can query
 * instead of receiving a pre-baked markdown blob. Replaces the shallow
 * `buildProjectContext()` + `translateNaturalLanguageToCommand()` pipeline
 * with structured, queryable MCP tools.
 *
 * Tools:
 * - `project.analyze`    — Deep analysis: framework, dependencies, entry points, config
 * - `project.list_scripts` — All npm scripts, Makefile targets, pyproject.toml tasks
 * - `project.dependencies` — Installed packages, version conflicts, missing deps
 * - `project.structure`  — File tree with semantic understanding
 *
 * These tools are registered as built-in capabilities and can be called by
 * any agent (Vercel AI SDK, OpenCode agent loop, non-Mastra workflows).
 */

import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Tools:ProjectAnalysis');

// ============================================================================
// Shared Utilities
// ============================================================================

/**
 * Get file listing from the virtual filesystem for a given owner.
 * Returns relative paths from workspace root.
 */
async function getFileListing(userId: string): Promise<string[]> {
  const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
  const workspace = await virtualFilesystem.exportWorkspace(userId);
  return workspace.files.map(f => f.path);
}

/**
 * Read a file from the virtual filesystem, returning content or null.
 */
async function readVFSFile(userId: string, path: string): Promise<string | null> {
  const { virtualFilesystem } = await import('@/lib/virtual-filesystem/virtual-filesystem-service');
  try {
    const file = await virtualFilesystem.readFile(userId, path.replace(/^\//, ''));
    return file.content;
  } catch {
    return null;
  }
}

/**
 * Read and parse a JSON file from VFS, returning parsed object or null.
 */
async function readJSONFile<T = Record<string, unknown>>(userId: string, path: string): Promise<T | null> {
  const content = await readVFSFile(userId, path);
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

// ============================================================================
// 1. analyze_project — Deep Project Analysis
// ============================================================================

export interface ProjectAnalysisResult {
  /** Detected framework (e.g., 'next', 'django', 'rust') */
  framework: string;
  /** Package manager (npm, pnpm, bun, yarn, deno) */
  packageManager: string;
  /** Runtime mode (docker-compose, docker, monorepo-pnpm, standard, etc.) */
  runtimeMode: string;
  /** Entry file path */
  entryFile: string | null;
  /** Project root relative path */
  projectRoot: string;
  /** Available scripts from package.json */
  scripts: string[];
  /** Recommended commands for common operations */
  recommendedCommands: {
    install: string;
    run?: string;
    test?: string;
    build?: string;
    dockerUp?: string;
    dockerDown?: string;
  };
  /** Dependencies from package.json (name → version) */
  dependencies: Record<string, string>;
  /** Dev dependencies from package.json */
  devDependencies: Record<string, string>;
  /** Config files detected */
  configFiles: string[];
  /** Hints for the LLM */
  hints: string[];
  /** Potential issues the LLM should be aware of */
  potentialIssues: string[];
  /** Total file count */
  fileCount: number;
  /** Top-level directory structure */
  topDirs: string[];
}

export async function analyzeProject(
  userId: string,
  options?: { depth?: number; includeDependencies?: boolean },
): Promise<ProjectAnalysisResult> {
  const {
    buildProjectContext,
    detectFrameworkFromFiles,
    detectPackageManager,
    detectPackageManagerFromPackageJson,
    detectRuntimeMode,
    detectProjectRoot,
    detectEntryFile,
    detectRunCommand,
    detectTestCommand,
    detectBuildCommand,
    getInstallCommand,
    getRunCommandPrefix,
    getDockerCommands,
    formatSmartContextAsMarkdown,
    generateSmartContext,
  } = await import('@/lib/project-detection');

  const filePaths = await getFileListing(userId);
  if (filePaths.length === 0) {
    return {
      framework: 'unknown',
      packageManager: 'unknown',
      runtimeMode: 'standard',
      entryFile: null,
      projectRoot: '.',
      scripts: [],
      recommendedCommands: { install: 'npm install' },
      dependencies: {},
      devDependencies: {},
      configFiles: [],
      hints: ['Workspace is empty — no project detected'],
      potentialIssues: ['No files found in workspace'],
      fileCount: 0,
      topDirs: [],
    };
  }

  // Use the existing buildProjectContext for base analysis
  const pkgJson = await readJSONFile(userId, '/package.json');
  const pkgJsonStr = pkgJson ? JSON.stringify(pkgJson) : undefined;

  const projectCtx = await buildProjectContext(filePaths, async (path: string) => {
    if (path === 'package.json' || path === '/package.json') return pkgJsonStr || null;
    return null;
  });

  // Deepen the analysis with additional data
  const configFiles = detectConfigFiles(filePaths);
  const topDirs = getTopLevelDirectories(filePaths);
  const issues = detectPotentialIssues(filePaths, pkgJson);

  const dockerCmds = getDockerCommands(projectCtx.runtimeMode);

  return {
    framework: projectCtx.framework,
    packageManager: projectCtx.packageManager === 'unknown' ? 'npm' : projectCtx.packageManager,
    runtimeMode: projectCtx.runtimeMode,
    entryFile: projectCtx.entryFile,
    projectRoot: projectCtx.projectRoot || '.',
    scripts: projectCtx.packageJsonScripts,
    recommendedCommands: {
      install: getInstallCommand(
        projectCtx.packageManager === 'unknown' ? 'npm' : projectCtx.packageManager,
      ),
      run: projectCtx.runCommand || undefined,
      test: projectCtx.testCommand || undefined,
      build: projectCtx.buildCommand || undefined,
      ...(dockerCmds ? { dockerUp: dockerCmds.up, dockerDown: dockerCmds.down } : {}),
    },
    dependencies: (pkgJson?.dependencies as Record<string, string>) || {},
    devDependencies: (pkgJson?.devDependencies as Record<string, string>) || {},
    configFiles,
    hints: generateHints(projectCtx),
    potentialIssues: issues,
    fileCount: filePaths.length,
    topDirs,
  };
}

// ============================================================================
// 2. list_scripts — All Runnable Scripts/Tasks
// ============================================================================

export interface ScriptInfo {
  /** Script/task name */
  name: string;
  /** Command to execute */
  command: string;
  /** Source (npm-script, makefile, pyproject, deno-task, cargo, etc.) */
  source: 'npm-script' | 'makefile' | 'pyproject' | 'deno-task' | 'cargo' | 'go-task' | 'turbo' | 'nx';
  /** Description if available */
  description?: string;
}

export async function listScripts(userId: string): Promise<ScriptInfo[]> {
  const filePaths = await getFileListing(userId);
  const scripts: ScriptInfo[] = [];

  // 1. package.json scripts
  const pkgJson = await readJSONFile<{
    scripts?: Record<string, string>;
    description?: string;
  }>(userId, '/package.json');

  if (pkgJson?.scripts) {
    for (const [name, command] of Object.entries(pkgJson.scripts)) {
      scripts.push({
        name,
        command,
        source: 'npm-script',
      });
    }
  }

  // 2. Makefile targets
  if (filePaths.some(p => p.endsWith('Makefile') || p.endsWith('makefile'))) {
    const makefile = await readVFSFile(
      userId,
      filePaths.find(p => p.endsWith('Makefile') || p.endsWith('makefile')) || '/Makefile',
    );
    if (makefile) {
      const targetRegex = /^([a-zA-Z0-9_-]+)\s*:/gm;
      let match;
      while ((match = targetRegex.exec(makefile)) !== null) {
        const target = match[1];
        if (!target.startsWith('.')) {
          scripts.push({
            name: target,
            command: `make ${target}`,
            source: 'makefile',
          });
        }
      }
    }
  }

  // 3. pyproject.toml tasks (under [tool.poetry.scripts] or [project.scripts])
  if (filePaths.some(p => p.endsWith('pyproject.toml'))) {
    const pyproject = await readVFSFile(
      userId,
      filePaths.find(p => p.endsWith('pyproject.toml')) || '/pyproject.toml',
    );
    if (pyproject) {
      // Simple regex extraction of [tool.poetry.scripts] entries
      const poetryScriptRegex = /^\s*([a-zA-Z0-9_-]+)\s*=\s*["'](.+?)["']\s*$/gm;
      let match;
      while ((match = poetryScriptRegex.exec(pyproject)) !== null) {
        scripts.push({
          name: match[1],
          command: match[2],
          source: 'pyproject',
        });
      }
    }
  }

  // 4. Cargo tasks (cargo can list subcommands from Cargo.toml)
  if (filePaths.some(p => p.endsWith('Cargo.toml'))) {
    scripts.push({
      name: 'build',
      command: 'cargo build',
      source: 'cargo',
    });
    scripts.push({
      name: 'run',
      command: 'cargo run',
      source: 'cargo',
    });
    scripts.push({
      name: 'test',
      command: 'cargo test',
      source: 'cargo',
    });
    scripts.push({
      name: 'clippy',
      command: 'cargo clippy',
      source: 'cargo',
    });
  }

  // 5. Go tasks
  if (filePaths.some(p => p.endsWith('go.mod'))) {
    scripts.push({
      name: 'run',
      command: 'go run .',
      source: 'go-task',
    });
    scripts.push({
      name: 'build',
      command: 'go build',
      source: 'go-task',
    });
    scripts.push({
      name: 'test',
      command: 'go test ./...',
      source: 'go-task',
    });
  }

  // 6. Deno tasks (deno.json or deno.jsonc)
  const denoJson = await readJSONFile<{
    tasks?: Record<string, string>;
  }>(userId, '/deno.json');
  if (denoJson?.tasks) {
    for (const [name, command] of Object.entries(denoJson.tasks)) {
      scripts.push({
        name,
        command,
        source: 'deno-task',
      });
    }
  }

  // 7. Turbo tasks (if turbo.json exists and has pipeline)
  const turbo = await readJSONFile<{
    pipeline?: Record<string, unknown>;
  }>(userId, '/turbo.json');
  if (turbo?.pipeline) {
    for (const name of Object.keys(turbo.pipeline)) {
      if (!scripts.find(s => s.name === name)) {
        scripts.push({
          name,
          command: `turbo run ${name}`,
          source: 'turbo',
        });
      }
    }
  }

  // 8. Nx tasks (if nx.json exists)
  if (filePaths.some(p => p.endsWith('nx.json'))) {
    const nx = await readJSONFile<{
      targetDefaults?: Record<string, unknown>;
    }>(userId, '/nx.json');
    if (nx?.targetDefaults) {
      for (const name of Object.keys(nx.targetDefaults)) {
        if (!scripts.find(s => s.name === name)) {
          scripts.push({
            name,
            command: `nx run ${name}`,
            source: 'nx',
          });
        }
      }
    }
  }

  // Remove duplicates (keep first occurrence by source priority)
  const seen = new Set<string>();
  const unique = scripts.filter(s => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  return unique;
}

// ============================================================================
// 3. get_dependencies — Installed Packages & Issues
// ============================================================================

export interface DependencyAnalysisResult {
  /** Production dependencies (name → version) */
  dependencies: Record<string, string>;
  /** Dev dependencies (name → version) */
  devDependencies: Record<string, string>;
  /** Peer dependencies (name → version) */
  peerDependencies: Record<string, string>;
  /** Dependency-related issues */
  issues: DependencyIssue[];
  /** Lock file status */
  lockFile: {
    type: string | null;
    exists: boolean;
  };
  /** Package manager */
  packageManager: string;
}

export interface DependencyIssue {
  type: 'missing-lockfile' | 'conflict' | 'outdated' | 'missing' | 'unresolved' | 'circular';
  severity: 'error' | 'warning' | 'info';
  message: string;
  affectedPackages?: string[];
}

export async function getDependencies(
  userId: string,
): Promise<DependencyAnalysisResult> {
  const filePaths = await getFileListing(userId);
  const issues: DependencyIssue[] = [];

  // Detect package manager
  const { detectPackageManager } = await import('@/lib/project-detection');
  const pm = detectPackageManager(filePaths);

  // Detect lock file
  const lockFileMap: Record<string, string> = {
    'pnpm-lock.yaml': 'pnpm',
    'yarn.lock': 'yarn',
    'package-lock.json': 'npm',
    'bun.lockb': 'bun',
    'bun.lock': 'bun',
    'deno.lock': 'deno',
  };
  let lockFileType: string | null = null;
  let lockFileExists = false;
  for (const [lockName, pmType] of Object.entries(lockFileMap)) {
    if (filePaths.some(p => p.endsWith(lockName))) {
      lockFileType = pmType;
      lockFileExists = true;
      break;
    }
  }

  const hasPackageJson = filePaths.some(p => p.endsWith('package.json'));

  // Issue: no lock file for npm projects
  if (hasPackageJson && !lockFileExists && (pm === 'npm' || pm === 'unknown')) {
    issues.push({
      type: 'missing-lockfile',
      severity: 'warning',
      message: 'No lock file detected — installs may be non-deterministic. Run `npm install` to generate one.',
    });
  }

  // Read package.json
  const pkgJson = await readJSONFile<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    engines?: Record<string, string>;
  }>(userId, '/package.json');

  const dependencies = pkgJson?.dependencies || {};
  const devDependencies = pkgJson?.devDependencies || {};
  const peerDependencies = pkgJson?.peerDependencies || {};

  // Check for common dependency issues
  if (pkgJson?.engines) {
    const nodeVersion = pkgJson.engines.node;
    if (nodeVersion) {
      issues.push({
        type: 'info',
        severity: 'info',
        message: `Project requires Node.js ${nodeVersion}`,
      });
    }
  }

  // Check for potentially outdated or problematic packages
  const allDeps = { ...dependencies, ...devDependencies };
  const depNames = Object.keys(allDeps);

  // Check for known peer dependency requirements
  if (allDeps['react'] && allDeps['react-dom']) {
    const reactVer = allDeps['react'];
    const reactDomVer = allDeps['react-dom'];
    if (reactVer !== reactDomVer) {
      issues.push({
        type: 'conflict',
        severity: 'warning',
        message: 'react and react-dom versions differ — this may cause runtime issues',
        affectedPackages: ['react', 'react-dom'],
      });
    }
  }

  // Check for workspace references that may need resolution
  const workspaceDeps = depNames.filter(d => allDeps[d].startsWith('workspace:') || allDeps[d].startsWith('file:'));
  if (workspaceDeps.length > 0) {
    issues.push({
      type: 'info',
      severity: 'info',
      message: `${workspaceDeps.length} workspace/file dependency detected — ensure all local packages exist`,
      affectedPackages: workspaceDeps,
    });
  }

  return {
    dependencies,
    devDependencies,
    peerDependencies,
    issues,
    lockFile: {
      type: lockFileType,
      exists: lockFileExists,
    },
    packageManager: pm === 'unknown' ? 'npm' : pm,
  };
}

// ============================================================================
// 4. get_project_structure — Semantic File Tree
// ============================================================================

export interface ProjectStructureResult {
  /** Tree representation as nested object */
  tree: DirectoryNode;
  /** Total file count */
  fileCount: number;
  /** Total directory count */
  dirCount: number;
  /** Summary of file types */
  fileTypes: Record<string, number>;
  /** Top-level structure (first 2 levels) */
  summary: string;
  /** Notable directories and files */
  notableItems: string[];
}

export interface DirectoryNode {
  name: string;
  type: 'directory' | 'file';
  children?: DirectoryNode[];
  size?: number;
}

/**
 * Files and directories to consider "notable" for project understanding.
 */
const NOTABLE_PATTERNS = [
  // Config files
  'package.json', 'tsconfig.json', 'jsconfig.json', '.eslintrc', '.eslintrc.js',
  '.eslintrc.json', '.prettierrc', 'tailwind.config', 'postcss.config',
  'next.config', 'vite.config', 'webpack.config', 'babel.config',
  'nuxt.config', 'svelte.config', 'astro.config',
  // Build/deploy
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml',
  '.dockerignore', '.env', '.env.example', '.gitignore',
  // Documentation
  'README.md', 'README.txt', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LICENSE',
  // Entry points
  'index.html', 'main.ts', 'main.tsx', 'main.js', 'main.jsx', 'main.py',
  'app.py', 'server.js', 'app.js', 'index.ts', 'index.tsx',
  // Rust/Go
  'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum',
  // Python
  'requirements.txt', 'Pipfile', 'Pipfile.lock', 'pyproject.toml', 'setup.py',
  'poetry.lock', 'manage.py',
  // Monorepo
  'pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json',
];

/**
 * Directories to skip when building the tree.
 */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.svelte-kit',
  'dist', 'build', 'out', '.cache', 'coverage',
  '.vscode', '.idea', '__pycache__', '.pytest_cache',
  'vendor', '.turbo', '.nx',
]);

/**
 * Build a semantic file tree from file paths.
 */
export function buildProjectStructure(
  filePaths: string[],
  maxDepth: number = 5,
): ProjectStructureResult {
  const root: DirectoryNode = { name: '/', type: 'directory', children: [] };
  const fileTypeCounts: Record<string, number> = {};
  let fileCount = 0;
  let dirCount = 0;
  const notableItems = new Set<string>();

  for (const filePath of filePaths) {
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    // Skip files inside ignored directories
    const hasIgnoredAncestor = parts.slice(0, -1).some(p => IGNORED_DIRS.has(p));
    if (hasIgnoredAncestor) continue;

    // Check for notable files
    const fileName = parts[parts.length - 1];
    if (NOTABLE_PATTERNS.some(p => fileName.startsWith(p))) {
      notableItems.add(filePath);
    }

    // Build tree nodes
    let current = root;
    for (let i = 0; i < parts.length && i < maxDepth; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      let child = current.children?.find(c => c.name === part);
      if (!child) {
        child = {
          name: part,
          type: isFile ? 'file' : 'directory',
          children: isFile ? undefined : [],
        };
        current.children?.push(child);
        if (!isFile) dirCount++;
        else fileCount++;

        // Count file types
        if (isFile) {
          const ext = part.includes('.') ? '.' + part.split('.').pop()! : '(no extension)';
          fileTypeCounts[ext] = (fileTypeCounts[ext] || 0) + 1;
        }
      }

      if (!isFile && child.children) {
        current = child;
      }
    }
  }

  // Sort children: directories first, then files alphabetically
  const sortNodes = (node: DirectoryNode) => {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
      sortNodes(child);
    }
  };
  sortNodes(root);

  // Generate summary (top 2 levels as text)
  const summary = generateTreeSummary(root, 2);

  return {
    tree: root,
    fileCount,
    dirCount,
    fileTypes: fileTypeCounts,
    summary,
    notableItems: Array.from(notableItems),
  };
}

/**
 * Generate a text summary of the tree for LLM consumption.
 */
function generateTreeSummary(node: DirectoryNode, depth: number): string {
  if (depth <= 0 || !node.children || node.children.length === 0) return '';

  const lines: string[] = [];
  const indent = '  '.repeat(3 - depth + 2);

  for (const child of node.children) {
    if (child.type === 'directory') {
      lines.push(`${indent}📁 ${child.name}/`);
      if (depth > 1) {
        lines.push(generateTreeSummary(child, depth - 1));
      }
    } else {
      lines.push(`${indent}📄 ${child.name}`);
    }
  }

  return lines.filter(Boolean).join('\n');
}

/**
 * Get top-level directory names.
 */
function getTopLevelDirectories(filePaths: string[]): string[] {
  const dirs = new Set<string>();
  for (const path of filePaths) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length > 1) {
      dirs.add(parts[0]);
    }
  }
  return Array.from(dirs).sort();
}

/**
 * Detect config files from file paths.
 */
function detectConfigFiles(filePaths: string[]): string[] {
  const configPatterns = [
    'next.config', 'nuxt.config', 'vite.config', 'webpack.config',
    'svelte.config', 'astro.config', 'tailwind.config', 'postcss.config',
    'tsconfig.json', 'jsconfig.json', '.eslintrc', '.prettierrc',
    'babel.config', 'angular.json', 'remix.config', 'gatsby-config',
    'Dockerfile', 'docker-compose', 'compose.yml', '.dockerignore',
    'turbo.json', 'nx.json', 'lerna.json', 'vercel.json', 'netlify.toml',
    'pyproject.toml', 'poetry.toml', 'Cargo.toml', 'go.mod',
  ];
  return filePaths
    .filter(p => configPatterns.some(cp => p.includes(cp)))
    .slice(0, 20); // Cap at 20 config files
}

/**
 * Generate hints for the LLM based on project analysis.
 */
function generateHints(projectCtx: any): string[] {
  const hints: string[] = [];

  if (projectCtx.framework === 'next') {
    hints.push('Next.js project — use `npm run dev` for HMR dev server');
    hints.push('App Router detected — entry is src/app/page.tsx');
  }
  if (projectCtx.framework === 'nuxt') {
    hints.push('Nuxt.js project — uses Vue 3 + Vite');
  }
  if (projectCtx.framework === 'django') {
    hints.push('Django project — use `python manage.py runserver`');
  }
  if (projectCtx.framework === 'rust') {
    hints.push('Rust project — use `cargo run` to build and run');
  }
  if (projectCtx.framework === 'go') {
    hints.push('Go project — use `go run main.go` to run');
  }
  if (projectCtx.packageManager === 'pnpm') {
    hints.push('Uses pnpm — faster installs, disk-efficient');
  }
  if (projectCtx.packageManager === 'bun') {
    hints.push('Uses Bun — ultra-fast runtime + package manager');
  }
  if (projectCtx.runtimeMode === 'docker-compose') {
    hints.push('Uses Docker Compose — use `docker compose up -d` to start all services');
  }

  return hints;
}

/**
 * Detect potential issues in the project.
 */
function detectPotentialIssues(filePaths: string[], pkgJson: Record<string, unknown> | null): string[] {
  const issues: string[] = [];

  if (!filePaths.some(p => p.endsWith('package.json'))) {
    if (!filePaths.some(p => p.endsWith('Cargo.toml')) &&
        !filePaths.some(p => p.endsWith('go.mod')) &&
        !filePaths.some(p => p.endsWith('pyproject.toml')) &&
        !filePaths.some(p => p.endsWith('requirements.txt'))) {
      issues.push('No project configuration file detected');
    }
  }

  if (!filePaths.some(p => p.endsWith('.gitignore'))) {
    issues.push('No .gitignore detected — consider adding one');
  }

  if (!filePaths.some(p => p.endsWith('.env.example')) &&
      filePaths.some(p => p.endsWith('.env'))) {
    issues.push('.env file detected but no .env.example — secrets may be committed');
  }

  if (!filePaths.some(p => p === 'README.md' || p.endsWith('/README.md'))) {
    issues.push('No README.md detected');
  }

  return issues;
}

// ============================================================================
// Re-export capability definitions from capabilities.ts
// ============================================================================

export {
  PROJECT_ANALYZE_CAPABILITY,
  PROJECT_LIST_SCRIPTS_CAPABILITY,
  PROJECT_DEPENDENCIES_CAPABILITY,
  PROJECT_STRUCTURE_CAPABILITY,
} from '../capabilities';
