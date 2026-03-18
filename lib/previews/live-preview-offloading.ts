/**
 * Live Preview Offloading
 *
 * Smart preview provider selection with provider-specific mechanisms:
 * - Local/Client-side: Sandpack, WebContainer, Pyodide, Parcel, Iframe
 * - Cloud providers: DevBox (CodeSandbox), CodeSandbox, WebContainer fallback
 * - Auto-detection of app requirements
 * - Seamless fallback between providers
 * - Preview offloading decision logic
 * - Robust framework detection
 * - Enhanced entry point detection with relative path normalization
 * - Port detection for server previews
 * - CodeSandbox template mapping
 *
 * Priority:
 * 1. Local/Client-side (Sandpack, WebContainer, Pyodide) - preferred
 * 2. Cloud sandbox fallback (DevBox -> CodeSandbox -> WebContainer)
 *
 * Supported preview modes:
 * - sandpack: In-browser bundling (React, Vue, Svelte, etc.)
 * - webcontainer: In-browser Node.js runtime
 * - pyodide: In-browser Python runtime
 * - parcel: Zero-config bundler (inline HTML/CSS/JS)
 * - iframe: Raw HTML preview
 * - devbox: CodeSandbox DevBox cloud environment
 * - codesandbox: CodeSandbox cloud environment
 * - nextjs: Next.js via WebContainer
 *
 * Key Functions:
 * - detectProject(): Full project analysis with heuristics
 * - detectFramework(): Framework detection from files and package.json
 * - detectEntryPoint(): Entry point detection with path normalization
 * - detectPort(): Port detection from package.json or code content
 * - getCodeSandboxTemplate(): Map frameworks to CodeSandbox templates
 * - getSandpackConfig(): Get Sandpack configuration for project
 * - analyzeHeuristics(): Analyze project for cloud offload decision
 *
 * @example
 * ```typescript
 * import {
 *   detectProject,
 *   detectFramework,
 *   detectPort,
 *   getCodeSandboxTemplate,
 *   getSandpackConfig,
 *   analyzeHeuristics
 * } from '@/lib/previews/live-preview-offloading';
 *
 * // Full project analysis
 * const detection = detectProject({ files });
 * console.log(`Framework: ${detection.framework}, Port: ${detectPort(files)}`);
 *
 * // Get CodeSandbox template
 * const template = getCodeSandboxTemplate(detection.framework);
 *
 * // Check if should offload to cloud
 * const heuristics = analyzeHeuristics({ files });
 * if (heuristics.shouldOffload) {
 *   console.log(`Offload recommended: ${heuristics.offloadReason}`);
 * }
 * ```
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Previews:LivePreview');

// ============================================================================
// Types
// ============================================================================

/**
 * Preview mode types
 * Local/Client-side: sandpack, webcontainer, pyodide, parcel, iframe, raw, vite, webpack, nextjs, node
 * Cloud providers: devbox, codesandbox, opensandbox
 * Hybrid: local, cloud (auto-detect based on project requirements)
 */
export type PreviewMode = 
  | 'sandpack'     // Local: In-browser bundling (React, Vue, Svelte, etc.)
  | 'iframe'       // Local: Raw HTML preview
  | 'raw'          // Local: Raw code view
  | 'parcel'       // Local: Zero-config bundler (inline HTML/CSS/JS)
  | 'devbox'       // Cloud: CodeSandbox DevBox cloud environment
  | 'pyodide'      // Local: In-browser Python runtime
  | 'vite'         // Local: Vite bundler (redirects to Sandpack)
  | 'webpack'      // Local: Webpack bundler (redirects to Sandpack)
  | 'webcontainer' // Local: In-browser Node.js runtime
  | 'nextjs'       // Local: Next.js via WebContainer
  | 'codesandbox'  // Cloud: CodeSandbox cloud environment
  | 'opensandbox'  // Cloud: OpenSandbox container (self-hosted)
  | 'node'         // Local: Node.js execution (via WebContainer)
  | 'local'        // Auto: Prefer local execution
  | 'cloud';       // Auto: Require cloud execution

/**
 * Supported frameworks
 * JavaScript/TypeScript: react, vue, angular, svelte, solid, vanilla, next, nuxt, gatsby, vite, astro, remix, qwik
 * Python: gradio, streamlit, flask, fastapi, django
 * Special: vite-react (Vite with React), unknown
 */
export type AppFramework = 
  // JavaScript/TypeScript Frameworks
  | 'react'        // React (CRA, manual setup)
  | 'vue'          // Vue 2/3
  | 'angular'      // Angular
  | 'svelte'       // Svelte 3/4/5
  | 'solid'        // SolidJS
  | 'vanilla'      // Plain HTML/CSS/JS
  | 'next'         // Next.js (App Router or Pages Router)
  | 'nuxt'         // Nuxt 2/3
  | 'gatsby'       // Gatsby
  | 'vite'         // Vite (non-React)
  | 'astro'        // Astro
  | 'remix'        // Remix
  | 'qwik'         // Qwik
  // Python Frameworks
  | 'gradio'       // Gradio (ML UI)
  | 'streamlit'    // Streamlit
  | 'flask'        // Flask
  | 'fastapi'      // FastAPI
  | 'django'       // Django
  // Special
  | 'vite-react'   // Vite with React
  | 'node'         // Node.js backend (Express, etc.)
  | 'unknown';     // Unable to detect

/**
 * Bundler types
 */
export type Bundler = 'webpack' | 'vite' | 'parcel' | 'rollup' | 'esbuild' | 'unknown';

/**
 * Project detection result
 */
export interface ProjectDetection {
  /** Detected framework */
  framework: AppFramework;
  
  /** Detected bundler */
  bundler: Bundler;
  
  /** Detected package manager */
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  
  /** Detected entry point */
  entryPoint: string | null;
  
  /** Root directory score map */
  rootScores: Map<string, number>;
  
  /** Selected root directory */
  selectedRoot: string;
  
  /** Preview mode recommendation */
  previewMode: PreviewMode;
  
  /** Has backend/server */
  hasBackend: boolean;
  
  /** Has Python files */
  hasPython: boolean;
  
  /** Has Node server files */
  hasNodeServer: boolean;
  
  /** Has Next.js */
  hasNextJS: boolean;
  
  /** Has heavy computation */
  hasHeavyComputation: boolean;
  
  /** Has API keys */
  hasAPIKeys: boolean;
  
  /** Files count */
  fileCount: number;
  
  /** Normalized files (relative to root) */
  normalizedFiles: Record<string, string>;
}

/**
 * Sandpack configuration
 */
export interface SandpackConfig {
  /** Sandpack template */
  template: string;
  
  /** Files for Sandpack */
  files: Record<string, { code: string }>;
  
  /** Custom setup with dependencies */
  customSetup?: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

/**
 * Preview request
 */
export interface PreviewRequest {
  /** Files in the project */
  files: Record<string, string>;
  
  /** Scope path for VFS normalization */
  scopePath?: string;
  
  /** Requested preview mode (optional, auto-detect if not provided) */
  requestedMode?: PreviewMode;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Framework to Sandpack template mapping
 * Maps our AppFramework to CodeSandbox Sandpack templates
 */
const FRAMEWORK_TO_TEMPLATE: Record<AppFramework, string> = {
  // React-based
  react: 'react',
  'vite-react': 'react',
  next: 'nextjs',
  gatsby: 'react',
  remix: 'remix',
  // Vue-based
  vue: 'vue',
  nuxt: 'nuxt',
  // Other frameworks
  svelte: 'svelte',
  angular: 'angular',
  solid: 'solid',
  astro: 'astro',
  // Non-framework
  vite: 'vanilla',
  vanilla: 'vanilla',
  node: 'vanilla',  // Node.js -> use vanilla template (WebContainer handles runtime)
  unknown: 'vanilla',
  // Python - use vanilla (Pyodide handles these separately)
  gradio: 'vanilla',
  streamlit: 'vanilla',
  flask: 'vanilla',
  fastapi: 'vanilla',
  django: 'vanilla',
  qwik: 'vanilla',  // Qwik uses different template in Sandpack
};

/**
 * Framework default entry points
 * Prioritized list of entry files for each framework
 */
const FRAMEWORK_ENTRY_POINTS: Record<AppFramework, string[]> = {
  // React-based
  react: [
    '/src/main.tsx', '/src/main.jsx', '/src/index.tsx', '/src/index.jsx',
    '/src/App.tsx', '/src/App.jsx', '/index.tsx', '/index.jsx',
    '/main.tsx', '/main.jsx'
  ],
  'vite-react': [
    '/src/main.tsx', '/src/main.jsx', '/src/index.tsx', '/src/index.jsx',
    '/src/App.tsx', '/src/App.jsx'
  ],
  next: [
    '/src/app/page.tsx', '/src/app/page.jsx', '/src/app/layout.tsx', '/src/app/layout.jsx',
    '/pages/index.tsx', '/pages/index.jsx', '/src/pages/index.tsx', '/src/pages/index.jsx',
    '/src/index.tsx', '/src/index.jsx'
  ],
  gatsby: [
    '/src/pages/index.js', '/src/pages/index.tsx', '/pages/index.js', '/src/index.js'
  ],
  remix: [
    '/app/routes/_index.tsx', '/app/routes/_index.jsx', '/app/root.tsx', '/app/root.jsx',
    '/app/routes/index.tsx', '/app/routes/index.jsx'
  ],
  // Vue-based
  nuxt: [
    '/app.vue', '/App.vue', '/src/app.vue',
    '/src/main.ts', '/src/main.js', '/nuxt.config.ts',
    '/pages/index.vue', '/pages/index.ts', '/pages/index.js',
    '/pages/index.page.vue'
  ],
  vue: [
    '/src/main.ts', '/src/main.js', '/src/App.vue', '/main.ts', '/main.js',
    '/src/index.ts', '/src/index.js', '/index.html'
  ],
  // Other frameworks
  svelte: [
    '/src/main.ts', '/src/main.js', '/src/App.svelte', '/App.svelte',
    '/main.ts', '/main.js', '/src/index.ts', '/src/index.js'
  ],
  angular: [
    '/src/main.ts', '/src/main.js', '/src/app/app.component.ts', '/src/app/app.component.js',
    '/main.ts', '/main.js', '/angular.json'
  ],
  solid: [
    '/src/index.tsx', '/src/index.jsx', '/src/App.tsx', '/src/App.jsx',
    '/index.tsx', '/index.jsx', '/src/root.tsx', '/src/root.jsx'
  ],
  astro: [
    '/src/pages/index.astro', '/pages/index.astro', '/index.astro',
    '/src/layouts/index.astro', '/layouts/index.astro'
  ],
  qwik: [
    '/src/root.tsx', '/src/index.tsx', '/src/routes/index.tsx',
    '/root.tsx', '/index.tsx', '/src/root.jsx'
  ],
  // Non-framework
  vite: [
    '/src/main.ts', '/src/main.js', '/src/index.ts', '/src/index.js',
    '/main.ts', '/main.js', '/vite.config.ts', '/vite.config.js'
  ],
  vanilla: [
    '/index.html', '/index.js', '/main.js', '/app.js', '/script.js', '/main.ts'
  ],
  node: [
    '/server.js', '/app.js', '/index.js', '/main.js', '/src/index.js', '/src/server.js'
  ],
  // Python
  gradio: [
    '/main.py', '/app.py', '/demo.py', '/serve.py'
  ],
  streamlit: [
    '/main.py', '/app.py', '/streamlit_app.py'
  ],
  flask: [
    '/main.py', '/app.py', '/application.py', '/run.py'
  ],
  fastapi: [
    '/main.py', '/app.py', '/application.py', '/api.py', '/server.py'
  ],
  django: [
    '/manage.py', '/main.py', '/app/__init__.py'
  ],
  unknown: ['/index.html', '/index.js', '/main.py'],
};

/**
 * Config file patterns for root detection
 */
const CONFIG_FILES = {
  packageJson: 'package.json',
  viteConfig: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'],
  webpackConfig: ['webpack.config.js', 'webpack.config.ts'],
  parcelConfig: ['.parcelrc'],
  nextConfig: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
  nuxtConfig: ['nuxt.config.ts', 'nuxt.config.js'],
  astroConfig: ['astro.config.mjs', 'astro.config.js'],
  svelteConfig: ['svelte.config.js'],
  tsConfig: ['tsconfig.json'],
};

/**
 * Server file patterns - used to detect backend/runtime
 */
const SERVER_FILES = [
  // Node.js
  'server.js', 'app.js', 'index.js', 'main.js', 'index.mjs', 'server.mjs',
  // Python
  'main.py', 'app.py', 'manage.py', 'application.py', 'api.py', 'serve.py',
  // Special
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'
];

/**
 * Heavy computation patterns
 */
const HEAVY_COMPUTATION_PATTERNS = ['tensorflow', 'pytorch', 'cuda', 'gpu', 'torch', 'keras'];

/**
 * API key patterns
 */
const API_KEY_PATTERNS = ['OPENAI_API_KEY', 'process.env', 'API_KEY', 'SECRET_KEY', 'AWS_ACCESS_KEY'];

// ============================================================================
// Preview Offload Heuristics
// ============================================================================

/**
 * Heuristics for auto-offload decision
 */
export interface OffloadHeuristics {
  /** Estimated build time in seconds */
  estimatedBuildTime: number;
  /** Estimated memory usage in MB */
  estimatedMemoryMB: number;
  /** node_modules size in MB */
  nodeModulesSizeMB: number;
  /** Build log warnings count */
  buildWarningsCount: number;
  /** Build log errors count */
  buildErrorsCount: number;
  /** Should auto-offload to cloud */
  shouldOffload: boolean;
  /** Offload reason */
  offloadReason?: string;
}

/**
 * Thresholds for auto-offload
 */
export const OFFLOAD_THRESHOLDS = {
  /** Build time > 20s triggers offload */
  BUILD_TIME_SECONDS: 20,
  /** Memory > 1GB triggers offload */
  MEMORY_MB: 1024,
  /** node_modules > 500MB triggers offload */
  NODE_MODULES_MB: 500,
  /** Build warnings > 10 triggers offload */
  BUILD_WARNINGS: 10,
  /** Build errors > 0 triggers offload */
  BUILD_ERRORS: 0,
};

// ============================================================================
// Live Preview Offloading Class
// ============================================================================

export class LivePreviewOffloading {
  /**
   * Analyze project for offload heuristics
   * 
   * Detects:
   * - node_modules size
   * - Estimated build time
   * - Memory requirements
   * - Build log analysis
   */
  analyzeHeuristics(request: PreviewRequest): OffloadHeuristics {
    const { files } = request;
    const filePaths = Object.keys(files);
    const fileContents = Object.values(files);

    // Detect node_modules size
    const nodeModulesSizeMB = this.estimateNodeModulesSize(files);

    // Estimate build time based on project characteristics
    const estimatedBuildTime = this.estimateBuildTime(filePaths, fileContents);

    // Estimate memory usage
    const estimatedMemoryMB = this.estimateMemoryUsage(filePaths, fileContents);

    // Analyze build logs if available
    const buildLogs = this.extractBuildLogs(files);
    const buildWarningsCount = this.countBuildWarnings(buildLogs);
    const buildErrorsCount = this.countBuildErrors(buildLogs);

    // Determine if should offload
    const { shouldOffload, offloadReason } = this.shouldOffloadBasedOnHeuristics({
      nodeModulesSizeMB,
      estimatedBuildTime,
      estimatedMemoryMB,
      buildWarningsCount,
      buildErrorsCount,
    });

    return {
      estimatedBuildTime,
      estimatedMemoryMB,
      nodeModulesSizeMB,
      buildWarningsCount,
      buildErrorsCount,
      shouldOffload,
      offloadReason,
    };
  }

  /**
   * Estimate node_modules size from package.json and lock files
   */
  private estimateNodeModulesSize(files: Record<string, string>): number {
    const packageJson = this.parsePackageJson(files['package.json'] || files['/package.json']);
    if (!packageJson) return 0;

    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    const depCount = Object.keys(deps).length;
    
    // Rough estimate: average package is ~200KB
    // Heavy packages (typescript, react, etc.) can be 10-50MB each
    const heavyDeps = Object.keys(deps).filter(dep => 
      ['typescript', 'react', 'react-dom', '@angular/core', 'vue', 'next', 'nuxt'].includes(dep)
    ).length;

    const baseSize = depCount * 0.2; // 200KB per package
    const heavySize = heavyDeps * 20; // 20MB per heavy package
    
    return Math.round(baseSize + heavySize);
  }

  /**
   * Estimate build time based on project size and complexity
   */
  private estimateBuildTime(filePaths: string[], fileContents: string[]): number {
    const fileCount = filePaths.length;
    const totalSize = fileContents.reduce((sum, content) => sum + content.length, 0);
    
    // Base build time: 1 second per 100 files
    const baseTime = fileCount / 100;
    
    // TypeScript projects take longer
    const hasTypeScript = filePaths.some(p => p.endsWith('.ts') || p.endsWith('.tsx'));
    const tsMultiplier = hasTypeScript ? 1.5 : 1;
    
    // Large projects take exponentially longer
    const sizeMultiplier = totalSize > 1000000 ? 2 : 1; // >1MB
    
    // Heavy frameworks take longer
    const hasHeavyFramework = filePaths.some(p => 
      p.includes('next.config') || p.includes('nuxt.config') || p.includes('gatsby-config')
    );
    const frameworkMultiplier = hasHeavyFramework ? 2 : 1;
    
    return Math.round(baseTime * tsMultiplier * sizeMultiplier * frameworkMultiplier * 10); // seconds
  }

  /**
   * Estimate memory usage based on project characteristics
   */
  private estimateMemoryUsage(filePaths: string[], fileContents: string[]): number {
    const totalSize = fileContents.reduce((sum, content) => sum + content.length, 0);
    
    // Base memory: 100MB + 1MB per 100KB of code
    const baseMemory = 100 + (totalSize / 100000);
    
    // TypeScript requires more memory
    const hasTypeScript = filePaths.some(p => p.endsWith('.ts') || p.endsWith('.tsx'));
    const tsMemory = hasTypeScript ? 200 : 0;
    
    // Heavy frameworks require more memory
    const hasHeavyFramework = filePaths.some(p => 
      p.includes('next.config') || p.includes('nuxt.config') || p.includes('gatsby-config')
    );
    const frameworkMemory = hasHeavyFramework ? 300 : 0;
    
    // node_modules in project indicates larger memory needs
    const hasNodeModules = filePaths.some(p => p.includes('node_modules'));
    const nodeModulesMemory = hasNodeModules ? 500 : 0;
    
    return Math.round(baseMemory + tsMemory + frameworkMemory + nodeModulesMemory);
  }

  /**
   * Extract build logs from files
   */
  private extractBuildLogs(files: Record<string, string>): string {
    const buildLogFiles = Object.entries(files)
      .filter(([path]) => 
        path.includes('build.log') || 
        path.includes('npm-debug.log') || 
        path.includes('yarn-error.log')
      )
      .map(([, content]) => content)
      .join('\n');
    
    return buildLogFiles;
  }

  /**
   * Count build warnings from logs
   */
  private countBuildWarnings(buildLogs: string): number {
    if (!buildLogs) return 0;
    
    const warningPatterns = [
      /warning:/gi,
      /WARN/g,
      /⚠️/g,
      /deprecated/gi,
    ];
    
    let count = 0;
    for (const pattern of warningPatterns) {
      count += (buildLogs.match(pattern) || []).length;
    }
    
    return count;
  }

  /**
   * Count build errors from logs
   */
  private countBuildErrors(buildLogs: string): number {
    if (!buildLogs) return 0;
    
    const errorPatterns = [
      /error:/gi,
      /ERROR/g,
      /❌/g,
      /failed/gi,
      /failure/gi,
    ];
    
    let count = 0;
    for (const pattern of errorPatterns) {
      count += (buildLogs.match(pattern) || []).length;
    }
    
    return count;
  }

  /**
   * Determine if should offload based on heuristics
   */
  private shouldOffloadBasedOnHeuristics(heuristics: {
    nodeModulesSizeMB: number;
    estimatedBuildTime: number;
    estimatedMemoryMB: number;
    buildWarningsCount: number;
    buildErrorsCount: number;
  }): { shouldOffload: boolean; offloadReason?: string } {
    const {
      nodeModulesSizeMB,
      estimatedBuildTime,
      estimatedMemoryMB,
      buildWarningsCount,
      buildErrorsCount,
    } = heuristics;

    // Check each threshold
    if (buildErrorsCount > OFFLOAD_THRESHOLDS.BUILD_ERRORS) {
      return {
        shouldOffload: true,
        offloadReason: `Build errors detected (${buildErrorsCount}) - cloud environment recommended`,
      };
    }

    if (estimatedBuildTime > OFFLOAD_THRESHOLDS.BUILD_TIME_SECONDS) {
      return {
        shouldOffload: true,
        offloadReason: `Estimated build time (${estimatedBuildTime}s) exceeds threshold (${OFFLOAD_THRESHOLDS.BUILD_TIME_SECONDS}s)`,
      };
    }

    if (estimatedMemoryMB > OFFLOAD_THRESHOLDS.MEMORY_MB) {
      return {
        shouldOffload: true,
        offloadReason: `Estimated memory usage (${estimatedMemoryMB}MB) exceeds threshold (${OFFLOAD_THRESHOLDS.MEMORY_MB}MB)`,
      };
    }

    if (nodeModulesSizeMB > OFFLOAD_THRESHOLDS.NODE_MODULES_MB) {
      return {
        shouldOffload: true,
        offloadReason: `node_modules size (${nodeModulesSizeMB}MB) exceeds threshold (${OFFLOAD_THRESHOLDS.NODE_MODULES_MB}MB)`,
      };
    }

    if (buildWarningsCount > OFFLOAD_THRESHOLDS.BUILD_WARNINGS) {
      return {
        shouldOffload: true,
        offloadReason: `Excessive build warnings (${buildWarningsCount}) - cloud build recommended`,
      };
    }

    return { shouldOffload: false };
  }

  /**
   * Detect project configuration from files
   * 
   * Enhanced with heuristics analysis for auto-offload decision
   *
   * Analyzes project files to determine:
   * - Framework (React, Vue, Next.js, Flask, etc.)
   * - Bundler (Vite, Webpack, Parcel)
   * - Entry point (main.tsx, app.py, etc.)
   * - Recommended preview mode
   * - Normalized file paths
   * - Heuristics for offload decision
   */
  detectProject(request: PreviewRequest): ProjectDetection & { heuristics?: OffloadHeuristics } {
    const { files, scopePath } = request;
    
    // Handle both object format and array format for backward compatibility
    const filesObj = Array.isArray(files) 
      ? (files as Array<{name: string; content: string}>).reduce((acc, f) => {
          if (f.name && f.content !== undefined) acc[f.name] = f.content;
          return acc;
        }, {} as Record<string, string>)
      : files as Record<string, string>;
    
    const filePaths = Object.keys(filesObj);
    const fileCount = filePaths.length;

    // Detect package manager
    const packageManager = this.detectPackageManager(filePaths);

    // Parse package.json if exists
    const packageJson = this.parsePackageJson(filesObj['package.json'] || filesObj['/package.json']);

    // Detect framework
    const framework = this.detectFramework(filePaths, filesObj, packageJson);

    // Detect bundler
    const bundler = this.detectBundler(filePaths, filesObj, packageJson);

    // Detect entry point
    const entryPoint = this.detectEntryPoint(filePaths, framework);

    // Compute root directory scores
    const rootScores = this.computeRootScores(filesObj);

    // Select best root
    const selectedRoot = this.selectRoot(rootScores);

    // Normalize files relative to selected root
    const normalizedFiles = this.normalizeFiles(filesObj, selectedRoot, scopePath);

    // Detect project characteristics
    const hasPython = filePaths.some(p => p.endsWith('.py'));
    const hasNodeServer = filePaths.some(p => SERVER_FILES.includes(p));
    const hasNextJS = this.detectNextJS(filePaths, packageJson);
    const hasBackend = hasPython || hasNodeServer || framework === 'next' || framework === 'nuxt' || framework === 'remix';
    const hasHeavyComputation = this.detectHeavyComputation(Object.values(filesObj));
    const hasAPIKeys = this.detectAPIKeys(Object.values(filesObj));

    // Analyze heuristics for offload decision
    const heuristics = this.analyzeHeuristics(request);

    // Detect preview mode (with heuristics influence)
    const previewMode = this.detectPreviewMode(
      filePaths,
      framework,
      bundler,
      hasPython,
      hasNodeServer,
      hasNextJS,
      packageJson,
      hasHeavyComputation,
      hasAPIKeys,
      heuristics  // Pass heuristics for cloud offload decision
    );

    logger.debug(`[detectProject] framework=${framework}, bundler=${bundler}, previewMode=${previewMode}, files=${fileCount}, shouldOffload=${heuristics.shouldOffload}`);

    return {
      framework,
      bundler,
      packageManager,
      entryPoint,
      rootScores,
      selectedRoot,
      previewMode,
      hasBackend,
      hasPython,
      hasNodeServer,
      hasNextJS,
      hasHeavyComputation,
      hasAPIKeys,
      fileCount,
      normalizedFiles,
      heuristics,
    };
  }

  /**
   * Detect package manager from lock files
   */
  detectPackageManager(filePaths: string[]): 'npm' | 'yarn' | 'pnpm' | 'bun' {
    if (filePaths.some(p => p.includes('pnpm-lock.yaml') || p.includes('pnpm-workspace.yaml'))) return 'pnpm';
    if (filePaths.some(p => p.includes('yarn.lock'))) return 'yarn';
    if (filePaths.some(p => p.includes('bun.lockb') || p.includes('bun.lock'))) return 'bun';
    return 'npm';
  }

  /**
   * Parse package.json
   */
  parsePackageJson(content?: string): Record<string, any> | null {
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Detect framework from project files
   * Comprehensive detection using package.json, file patterns, and code content
   */
  detectFramework(
    filePaths: string[], 
    files: Record<string, string>,
    packageJson: Record<string, any> | null
  ): AppFramework {
    // Check package.json dependencies first (most reliable)
    const deps = packageJson ? { ...packageJson.dependencies, ...packageJson.devDependencies } : {};
    const devDeps = packageJson?.devDependencies || {};
    const prodDeps = packageJson?.dependencies || {};

    // Check for Node.js/Express backend - but NOT if there's a frontend framework
    // Must check ALL frontend frameworks to avoid misdetecting Next.js + Express as 'node'
    const hasExpress = deps.express || deps['express'] || deps['koa'] || deps['koa'] || deps['fastify'] || deps['fastify'];
    const hasServerFiles = filePaths.some(p => SERVER_FILES.slice(0, 4).includes(p));
    const hasFrontend = deps.react || deps['react'] || deps.vue || deps['@vue/core'] || deps.svelte || 
      deps['@sveltejs/kit'] || deps.next || deps['next'] || deps['@angular/core'] || deps['solid-js'] || 
      deps.astro || deps.gatsby || deps['@remix-run/react'] || deps['@builder.io/qwik'];
    
    // Only detect as 'node' if there's no frontend framework
    if ((hasExpress || hasServerFiles) && !hasFrontend) {
      return 'node';
    }
    
    // React-based frameworks (check before other JS frameworks)
    if (deps.next || deps['next']) return 'next';
    if (deps['@remix-run/react']) return 'remix';
    if (deps.gatsby) return 'gatsby';
    if (deps.react) return 'react';

    // Vue-based frameworks
    if (deps.nuxt || deps['@nuxt/core'] || deps.nuxt3) return 'nuxt';
    if (deps.vue || deps['@vue/core'] || deps['vue-loader']) return 'vue';

    // Other JavaScript frameworks
    if (deps.astro) return 'astro';
    if (deps.svelte || deps['@sveltejs/kit'] || devDeps['@sveltejs/kit']) return 'svelte';
    if (deps['solid-js']) return 'solid';
    if (deps['@builder.io/qwik'] || deps['@builder.io/qwik-city']) return 'qwik';
    if (deps['@angular/core']) return 'angular';

    // Vite detection (after framework detection)
    const hasViteConfig = filePaths.some(p => p.includes('vite.config'));
    const hasReactDeps = prodDeps['react'] || prodDeps['react-dom'];
    if (hasViteConfig && hasReactDeps) return 'vite-react';
    if (hasViteConfig) return 'vite';

    // Python frameworks
    if (deps.gradio || deps['gradio-client']) return 'gradio';
    if (deps.streamlit) return 'streamlit';
    if (deps.flask || deps.Flask) return 'flask';
    if (deps.fastapi || deps['fastapi']) return 'fastapi';
    if (deps.django || deps.Django) return 'django';

    // Check file extensions for additional detection
    const hasVue = filePaths.some(p => p.endsWith('.vue'));
    const hasSvelte = filePaths.some(p => p.endsWith('.svelte'));
    const hasPython = filePaths.some(p => p.endsWith('.py'));
    const hasJsx = filePaths.some(p => p.endsWith('.jsx') || p.endsWith('.tsx'));
    const hasTsx = filePaths.some(p => p.endsWith('.tsx'));
    const hasAngularFiles = filePaths.some(p => p.includes('.component.') || p.includes('.module.'));

    // Check for config files
    const hasNextConfig = filePaths.some(p => p.includes('next.config'));
    const hasNuxtConfig = filePaths.some(p => p.includes('nuxt.config'));
    const hasGatsbyConfig = filePaths.some(p => p.includes('gatsby-config'));

    // Python frameworks detection by code content
    if (hasPython) {
      const pythonContent = Object.entries(files)
        .filter(([p]) => p.endsWith('.py'))
        .map(([, c]) => c)
        .join('\n');
      
      if (pythonContent.includes('import gradio') || pythonContent.includes('gradio.Blocks')) return 'gradio';
      if (pythonContent.includes('import streamlit') || pythonContent.includes('st.')) return 'streamlit';
      if (pythonContent.includes('from flask import') || pythonContent.includes('Flask(') || pythonContent.includes('flask.')) return 'flask';
      if (pythonContent.includes('from fastapi import') || pythonContent.includes('FastAPI(') || pythonContent.includes('app = FastAPI')) return 'fastapi';
      if (pythonContent.includes('from django import') || pythonContent.includes('django.setup()') || pythonContent.includes('DJANGO_')) return 'django';
      
      // Default to flask if Python but no specific framework detected
      if (hasServerFiles) return 'node';  // Mixed Node + Python
    }

    // JavaScript/TypeScript frameworks by file patterns
    if (hasNextConfig || filePaths.some(p => p.startsWith('pages/') || p.startsWith('src/app/'))) return 'next';
    if (hasNuxtConfig) return 'nuxt';
    if (hasGatsbyConfig || filePaths.some(p => p.startsWith('src/pages/') && p.endsWith('.js'))) return 'gatsby';
    if (hasVue) return 'vue';
    if (hasSvelte) return 'svelte';
    if (hasAngularFiles) return 'angular';
    if (hasTsx && hasJsx) return 'react';
    
    // Check code content for imports
    const jsContent = Object.entries(files)
      .filter(([p]) => p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx'))
      .map(([, c]) => c)
      .join('\n');

    if (jsContent.includes('from "react"') || jsContent.includes('from \'react\'') || jsContent.includes('React.')) return 'react';
    if (jsContent.includes('from "vue"') || jsContent.includes('from \'vue\'') || jsContent.includes('createApp(')) return 'vue';
    if (jsContent.includes('from "@sveltejs/') || jsContent.includes('svelte/store')) return 'svelte';
    if (jsContent.includes('from "@angular/') || jsContent.includes('@Component(')) return 'angular';
    
    // Node.js/Express detection from code
    if (jsContent.includes('express()') || jsContent.includes('express.') || jsContent.includes('app.get(') || jsContent.includes('app.post(')) return 'node';

    // Check for HTML files - vanilla project
    if (filePaths.some(p => p.endsWith('.html'))) return 'vanilla';

    // Node.js detection from code content (fallback)
    if (hasServerFiles || jsContent.includes('express()') || jsContent.includes('app.get(')) {
      if (!hasVue && !hasSvelte && !hasAngular && !hasJsx) {
        return 'node';
      }
    }

    return 'unknown';
  }

  /**
   * Detect bundler from config files
   */
  detectBundler(
    filePaths: string[], 
    files: Record<string, string>,
    packageJson: Record<string, any> | null
  ): Bundler {
    // Check config files
    if (filePaths.some(p => p.includes('vite.config'))) return 'vite';
    if (filePaths.some(p => p.includes('webpack.config'))) return 'webpack';
    if (filePaths.some(p => p.includes('parcel') || p.endsWith('.parcelrc'))) return 'parcel';

    // Check devDependencies
    const devDeps = packageJson?.devDependencies || {};
    if (devDeps.vite) return 'vite';
    if (devDeps.webpack) return 'webpack';
    if (devDeps.parcel) return 'parcel';
    if (devDeps.rollup) return 'rollup';
    if (devDeps.esbuild) return 'esbuild';

    return 'unknown';
  }

  /**
   * Detect entry point for the project
   */
  detectEntryPoint(filePaths: string[], framework: AppFramework): string | null {
    const candidates = FRAMEWORK_ENTRY_POINTS[framework] || FRAMEWORK_ENTRY_POINTS.unknown;
    
    for (const candidate of candidates) {
      // Check with and without leading slash
      const withSlash = candidate.startsWith('/') ? candidate : '/' + candidate;
      const withoutSlash = candidate.startsWith('/') ? candidate.slice(1) : candidate;
      
      if (filePaths.includes(withSlash) || filePaths.includes(withoutSlash)) {
        return withSlash;
      }
      
      // Also check for nested paths
      const found = filePaths.find(p => p.endsWith(candidate));
      if (found) return found;
    }

    // Fallback to common patterns
    const fallbackPatterns = ['index.html', 'index.js', 'main.js', 'app.js', 'main.py', 'app.py'];
    for (const pattern of fallbackPatterns) {
      const found = filePaths.find(p => p.endsWith(pattern));
      if (found) return found;
    }

    return null;
  }

  /**
   * Detect if project is Next.js
   */
  detectNextJS(filePaths: string[], packageJson: Record<string, any> | null): boolean {
    if (packageJson && (packageJson.dependencies?.next || packageJson.devDependencies?.next)) return true;
    return filePaths.some(p => 
      p.includes('next.config') || 
      p.startsWith('pages/') || 
      p.startsWith('app/') ||
      p.includes('/_app.') ||
      p.includes('/_document.')
    );
  }

  /**
   * Detect heavy computation requirements
   */
  detectHeavyComputation(contents: string[]): boolean {
    return contents.some(c => 
      typeof c === 'string' && HEAVY_COMPUTATION_PATTERNS.some(p => c.toLowerCase().includes(p))
    );
  }

  /**
   * Detect API keys in code
   */
  detectAPIKeys(contents: string[]): boolean {
    return contents.some(c => 
      typeof c === 'string' && API_KEY_PATTERNS.some(p => c.includes(p))
    );
  }

  /**
   * Compute root directory scores based on config files
   * Enhanced to properly detect subdirectory projects (e.g., nuxt-app/)
   */
  computeRootScores(files: Record<string, string>): Map<string, number> {
    const scores = new Map<string, number>();
    scores.set('', 1); // Base score

    const addScore = (root: string, score: number) => {
      scores.set(root, (scores.get(root) || 0) + score);
    };

    // First pass: Identify all potential project roots (directories with config files)
    const projectRoots = new Set<string>();
    for (const filePath of Object.keys(files)) {
      const cleanPath = filePath.replace(/^\/+/, '');
      const parts = cleanPath.split('/').filter(Boolean);
      if (parts.length < 2) continue;

      const fileName = parts[parts.length - 1];
      const dir = parts.slice(0, -1).join('/');

      // High-value config files indicate a project root
      if (fileName === 'package.json' || 
          CONFIG_FILES.nuxtConfig.includes(fileName) ||
          CONFIG_FILES.nextConfig.includes(fileName) ||
          CONFIG_FILES.astroConfig.includes(fileName) ||
          CONFIG_FILES.viteConfig.includes(fileName)) {
        projectRoots.add(dir);
      }
    }

    for (const filePath of Object.keys(files)) {
      const cleanPath = filePath.replace(/^\/+/, '');
      const parts = cleanPath.split('/').filter(Boolean);
      if (parts.length === 0) continue;

      const fileName = parts[parts.length - 1];
      const dir = parts.slice(0, -1).join('/');

      // Check if this file's directory is a known project root
      const isInProjectRoot = projectRoots.has(dir);

      // Score based on config files presence - highest priority for framework configs
      if (fileName === 'package.json') addScore(dir, 8);
      if (fileName === 'index.html') {
        // Only score index.html in root if no other project root exists
        if (!projectRoots.size || dir === '') addScore(dir, 6);
      }
      if (CONFIG_FILES.viteConfig.includes(fileName)) addScore(dir, 6);
      if (CONFIG_FILES.webpackConfig.includes(fileName)) addScore(dir, 6);
      if (CONFIG_FILES.parcelConfig.includes(fileName)) addScore(dir, 6);
      if (CONFIG_FILES.nextConfig.includes(fileName)) addScore(dir, 8);
      
      // Nuxt config - highest score for Nuxt projects
      if (CONFIG_FILES.nuxtConfig.includes(fileName)) {
        addScore(dir, 10); // Nuxt config gets highest priority
      }
      if (CONFIG_FILES.astroConfig.includes(fileName)) addScore(dir, 8);

      // Docker files - moderate score but indicate a runnable project
      if (fileName === 'Dockerfile' || fileName === 'docker-compose.yml' || fileName === 'docker-compose.yaml') {
        // If in a known project root, give higher score; otherwise lower
        if (isInProjectRoot) {
          addScore(dir, 6);
        } else {
          addScore(dir, 3);
        }
      }

      // Entry point scoring - prioritize framework-specific entry files
      if (/^main\.(js|jsx|ts|tsx)$/.test(fileName)) {
        if (dir.endsWith('/src')) addScore(dir.replace(/\/src$/, ''), 5);
        addScore(dir, 2);
      }
      
      // Nuxt/Vue specific entry points - higher score
      if (fileName === 'app.vue' || fileName === 'App.vue') {
        addScore(dir, 7); // Higher score for app.vue
        // If app.vue is in a subdirectory and that directory has a project root, boost it
        if (dir && !projectRoots.has(dir)) {
          const parentDir = dir.split('/').slice(0, -1).join('/');
          if (projectRoots.has(parentDir)) {
            addScore(parentDir, 5);
          }
        }
      }
      
      // Pages directory indicates a framework app
      if (parts.includes('pages')) {
        const pagesIdx = parts.indexOf('pages');
        const appRoot = parts.slice(0, pagesIdx).join('/');
        addScore(appRoot, 6);
      }
      
      // Components directory also indicates a framework
      if (parts.includes('components') && !parts.includes('node_modules')) {
        const componentsIdx = parts.indexOf('components');
        const appRoot = parts.slice(0, componentsIdx).join('/');
        if (appRoot) addScore(appRoot, 5);
      }

      if (/^index\.(js|jsx|ts|tsx|html|vue)$/.test(fileName)) {
        // Don't score index files in hidden/dot directories as project roots
        if (!fileName.startsWith('.') && !dir.startsWith('.')) {
          addScore(dir, 3);
        }
      }
    }

    // Debug: Log scores for diagnosis
    logger.debug(`[computeRootScores] projectRoots: ${Array.from(projectRoots).join(', ')}`);
    
    return scores;
  }

  /**
   * Select best root directory based on scores
   */
  selectRoot(scores: Map<string, number>): string {
    const entries = Array.from(scores.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        // Prefer shallower paths
        const aDepth = a[0] ? a[0].split('/').length : 0;
        const bDepth = b[0] ? b[0].split('/').length : 0;
        return aDepth - bDepth;
      });

    return entries[0]?.[0] || '';
  }

  /**
   * Normalize files relative to selected root
   */
  normalizeFiles(
    files: Record<string, string>, 
    root: string, 
    scopePath?: string
  ): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const [filePath, content] of Object.entries(files)) {
      let relativePath = filePath.replace(/^\/+/, '');

      // Strip VFS scope prefix if present
      if (scopePath) {
        const scopeNormalized = scopePath.replace(/^\/+/, '');
        if (relativePath.startsWith(scopeNormalized + '/')) {
          relativePath = relativePath.slice(scopeNormalized.length + 1);
        }
        // Also handle project/sessions/ pattern
        if (relativePath.startsWith('project/sessions/')) {
          const sessionIdx = relativePath.indexOf('/', 17);
          if (sessionIdx > 0) {
            relativePath = relativePath.slice(sessionIdx + 1);
          }
        }
      }

      // Strip root directory if present
      if (root && relativePath.startsWith(root + '/')) {
        relativePath = relativePath.slice(root.length + 1);
      }

      // Ensure path starts with /
      if (!relativePath.startsWith('/')) {
        relativePath = '/' + relativePath;
      }

      normalized[relativePath] = content;
    }

    return normalized;
  }

  /**
   * Detect preview mode based on project characteristics
   * Enhanced with heuristics for auto-offload decision
   * Priority: Local first (Sandpack -> WebContainer -> Pyodide), then cloud fallback
   */
  detectPreviewMode(
    filePaths: string[],
    framework: AppFramework,
    bundler: Bundler,
    hasPython: boolean,
    hasNodeServer: boolean,
    hasNextJS: boolean,
    packageJson: Record<string, any> | null,
    hasHeavyComputation: boolean,
    hasAPIKeys: boolean,
    heuristics?: OffloadHeuristics
  ): PreviewMode {
    const hasPackageJson = filePaths.some(p => p.endsWith('package.json'));
    const hasHtml = filePaths.some(p => p.endsWith('.html'));
    const hasJsx = filePaths.some(p => p.endsWith('.jsx') || p.endsWith('.tsx'));
    const hasVue = filePaths.some(p => p.endsWith('.vue'));
    const hasSvelte = filePaths.some(p => p.endsWith('.svelte'));
    const hasAngular = filePaths.some(p => p.includes('.component.') || p.includes('.module.'));
    const hasAstro = filePaths.some(p => p.endsWith('.astro'));

    // Docker detection for cloud fallback decision
    const hasDocker = filePaths.some(f =>
      f === 'Dockerfile' ||
      f === 'docker-compose.yml' ||
      f === 'docker-compose.yaml'
    );

    // Complex dependencies that need cloud
    const hasComplexDeps = packageJson && (
      packageJson.dependencies?.prisma ||
      packageJson.dependencies?.sequelize ||
      packageJson.dependencies?.typeorm ||
      packageJson.dependencies?.mongodb ||
      packageJson.dependencies?.redis ||
      packageJson.dependencies?.mysql ||
      packageJson.dependencies?.postgres ||
      packageJson.dependencies?.dockerode
    );

    // Check heuristics for auto-offload
    const shouldOffload = heuristics?.shouldOffload || false;
    const offloadReason = heuristics?.offloadReason;

    // ========================================
    // AUTO-OFFLOAD BASED ON HEURISTICS
    // ========================================
    
    // If heuristics indicate cloud offload, prioritize cloud providers
    if (shouldOffload) {
      logger.info(`[detectPreviewMode] Auto-offload triggered: ${offloadReason}`);
      
      // Determine best cloud provider based on project type
      if (hasPython || framework === 'flask' || framework === 'fastapi' || framework === 'django') {
        return 'devbox';  // Python needs full VM
      }
      
      if (hasNodeServer || framework === 'next' || framework === 'nuxt') {
        return 'devbox';  // Backend needs cloud
      }
      
      if (hasDocker || hasComplexDeps) {
        return 'devbox';  // Docker/complex needs cloud
      }
      
      // Default to CodeSandbox for heavy frontend projects
      return 'codesandbox';
    }

    // ========================================
    // LOCAL PREVIEW MODES (Preferred)
    // ========================================

    // Python frameworks -> Pyodide (local)
    if (framework === 'gradio' || framework === 'streamlit' || framework === 'flask') {
      if (hasDocker || hasComplexDeps || hasHeavyComputation || hasAPIKeys) {
        return 'devbox';  // Cloud fallback for complex Python
      }
      return 'pyodide';  // Local Python execution
    }

    // FastAPI/Django -> DevBox (usually need server)
    if (framework === 'fastapi' || framework === 'django') {
      return 'devbox';   // Cloud - these need running server
    }

    // Next.js -> Next.js mode (local via WebContainer)
    if (framework === 'next' || hasNextJS) {
      if (hasDocker) return 'devbox';  // Docker needs cloud
      return 'nextjs';
    }

    // Node.js/Express backend -> WebContainer
    if (framework === 'node') {
      if (hasDocker || hasComplexDeps) return 'devbox';  // Cloud for Docker/complex
      return 'webcontainer';  // Local Node.js
    }

    // Nuxt with Docker -> DevBox (cloud)
    if (framework === 'nuxt' && hasDocker) {
      return 'devbox';
    }

    // Vue, Nuxt -> Sandpack
    if (framework === 'vue' || framework === 'nuxt') {
      return 'sandpack';
    }

    // Svelte -> Sandpack
    if (framework === 'svelte') {
      return 'sandpack';
    }

    // Angular -> Sandpack
    if (framework === 'angular') {
      return 'sandpack';
    }

    // Astro -> Iframe (Astro builds to static HTML)
    if (framework === 'astro' || hasAstro) {
      return 'iframe';
    }

    // Remix -> Sandpack
    if (framework === 'remix') {
      return 'sandpack';
    }

    // Gatsby -> Iframe (static site generator)
    if (framework === 'gatsby') {
      return 'iframe';
    }

    // React/Vite-React -> Sandpack
    if (framework === 'react' || framework === 'vite-react' || hasJsx) {
      return 'sandpack';
    }

    // SolidJS -> Sandpack
    if (framework === 'solid') {
      return 'sandpack';
    }

    // Qwik -> Sandpack
    if (framework === 'qwik') {
      return 'sandpack';
    }

    // ========================================
    // BUNDLER DETECTION
    // ========================================

    // Vite bundler -> Vite mode (redirects to Sandpack)
    if (bundler === 'vite') {
      return 'vite';
    }

    // Webpack bundler -> Webpack mode (redirects to Sandpack)
    if (bundler === 'webpack') {
      return 'webpack';
    }

    // Parcel bundler -> Parcel mode
    if (bundler === 'parcel') {
      return 'parcel';
    }

    // ========================================
    // FALLBACKS
    // ========================================

    // HTML without framework -> Iframe
    if (hasHtml && !hasJsx && !hasVue && !hasSvelte && !hasAngular) {
      return 'iframe';
    }

    // Simple Python (no package.json) -> Pyodide
    if (hasPython && !hasPackageJson) {
      return 'pyodide';
    }

    // Node.js server detected but framework unknown -> WebContainer
    if (hasNodeServer && hasPackageJson) {
      if (hasDocker || hasComplexDeps) return 'devbox';
      return 'webcontainer';
    }

    // Heavy computation or API keys -> Cloud required
    if (hasHeavyComputation || hasAPIKeys) {
      return 'devbox';
    }

    // Docker projects -> Cloud
    if (hasDocker) {
      return 'devbox';
    }

    // Default: Sandpack for frontend projects
    return 'sandpack';
  }

  /**
   * Detect port from package.json or code content
   * Migrated from preview-offloader.ts
   */
  detectPort(files: Record<string, string>): number {
    const packageJson = this.parsePackageJson(files['package.json'] || files['/package.json']);
    if (packageJson) {
      const scripts = packageJson.scripts || {};
      const startScript = scripts.dev || scripts.start || '';

      // Extract port from start script
      const portMatch = startScript.match(/-p\s+(\d+)|--port\s+(\d+)|PORT=(\d+)/);
      if (portMatch) {
        return parseInt(portMatch[1] || portMatch[2] || portMatch[3], 10);
      }

      // Framework defaults from dependencies
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      if (deps.next || deps['next']) return 3000;
      if (deps.nuxt || deps['@nuxt/core']) return 3000;
      if (deps.vite) return 5173;
      if (deps.react) return 3000;
      if (deps.vue) return 3000;
      if (deps.svelte) return 3000;
      if (deps.astro) return 4321;
      if (deps.gatsby) return 8000;
      if (deps.remix) return 3000;
    }

    // Check Python files for port
    for (const [path, content] of Object.entries(files)) {
      if (path.endsWith('.py')) {
        // Flask/FastAPI pattern: app.run(port=8000) or uvicorn.run(port=8000)
        const portMatch = content.match(/run\(.*port\s*=\s*(\d+)|app\.run\(.*(\d+)|port=(\d+)/);
        if (portMatch) {
          return parseInt(portMatch[1] || portMatch[2] || portMatch[3], 10);
        }
        // Streamlit default
        if (content.includes('import streamlit') || content.includes('st.')) return 8501;
        // Gradio default
        if (content.includes('import gradio')) return 7860;
      }
    }

    // Check JavaScript/TypeScript files for port
    for (const [path, content] of Object.entries(files)) {
      if (path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.jsx') || path.endsWith('.tsx')) {
        // Express pattern: app.listen(3000) or app.listen({ port: 3000 })
        const portMatch = content.match(/app\.listen\((\d+)|app\.listen\(\{.*port:\s*(\d+)/);
        if (portMatch) {
          return parseInt(portMatch[1] || portMatch[2], 10);
        }
        // HTTP server pattern: http.createServer().listen(3000)
        const httpMatch = content.match(/\.listen\((\d+)/);
        if (httpMatch) {
          return parseInt(httpMatch[1], 10);
        }
      }
    }

    // Default port
    return 3000;
  }

  /**
   * Get CodeSandbox template for framework
   * Migrated from preview-offloader.ts with enhancements
   *
   * Maps detected frameworks to CodeSandbox templates:
   * @see https://codesandbox.io/docs/sdk/templates
   */
  getCodeSandboxTemplate(framework: AppFramework): string {
    const templateMap: Record<AppFramework, string> = {
      // JavaScript/TypeScript frameworks
      'react': 'react',
      'vite-react': 'react',
      'next': 'nextjs',
      'nuxt': 'nuxt',
      'vue': 'vue',
      'svelte': 'svelte',
      'solid': 'solid',
      'angular': 'angular',
      'astro': 'astro',
      'remix': 'remix',
      'qwik': 'qwik',
      'gatsby': 'react',  // Gatsby uses React template
      'vite': 'vanilla-vite',
      'vanilla': 'vanilla',
      'node': 'node',
      // Python frameworks (use Python template)
      'gradio': 'python',
      'streamlit': 'python',
      'flask': 'python',
      'fastapi': 'python',
      'django': 'python',
      'unknown': 'node',  // Default to Node.js template
    };

    return templateMap[framework] || 'node';
  }

  /**
   * Get Sandpack configuration for the project
   */
  getSandpackConfig(detection: ProjectDetection): SandpackConfig {
    const template = FRAMEWORK_TO_TEMPLATE[detection.framework] || 'vanilla';
    
    // Filter out build outputs and node_modules
    const buildDirs = ['dist', 'build', '.next', '.nuxt', '.output', 'public'];
    const filteredFiles: Record<string, { code: string }> = {};
    
    for (const [path, content] of Object.entries(detection.normalizedFiles)) {
      // Skip build outputs
      if (buildDirs.some(dir => path.startsWith(dir + '/') || path.startsWith('/' + dir + '/'))) continue;
      // Skip node_modules
      if (path.includes('node_modules/')) continue;
      // Skip map files
      if (path.endsWith('.map') || path.includes('.map')) continue;
      
      if (typeof content === 'string' && content.trim()) {
        filteredFiles[path.startsWith('/') ? path : '/' + path] = { code: content };
      }
    }

    // Add entry point stub if missing
    const hasEntryFile = Object.keys(filteredFiles).some(path => {
      const fileName = path.split('/').pop() || '';
      return /^index\.(js|jsx|ts|tsx|mjs|cjs|vue)$/.test(fileName) ||
             /^main\.(js|jsx|ts|tsx|mjs|cjs|vue)$/.test(fileName) ||
             /^App\.(js|jsx|ts|tsx|vue)$/.test(fileName);
    });

    if (!hasEntryFile) {
      this.addEntryPointStub(filteredFiles, detection.framework);
    }

    return {
      template,
      files: filteredFiles,
      customSetup: {
        dependencies: this.getDependencies(detection),
      },
    };
  }

  /**
   * Add entry point stub files if missing
   */
  private addEntryPointStub(files: Record<string, { code: string }>, framework: AppFramework): void {
    switch (framework) {
      case 'vue':
      case 'nuxt':
        files['/src/App.vue'] = {
          code: `<template>
  <div id="app">
    <h1>Hello Vue!</h1>
    <p>This is a generated Vue application.</p>
  </div>
</template>

<script>
export default {
  name: 'App'
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>`,
        };
        files['/src/main.js'] = {
          code: `import { createApp } from 'vue';
import App from './App.vue';
createApp(App).mount('#app');`,
        };
        files['/index.html'] = {
          code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`,
        };
        break;
      case 'react':
      case 'next':
      case 'vite-react':
      default:
        files['/src/index.jsx'] = {
          code: `import React from 'react';
import ReactDOM from 'react-dom/client';

function App() {
  return (
    <div className="App">
      <h1>Hello React!</h1>
      <p>This is a generated React application.</p>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);`,
        };
        files['/index.html'] = {
          code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/index.jsx"></script>
  </body>
</html>`,
        };
    }
  }

  /**
   * Extract dependencies from package.json
   */
  private getDependencies(detection: ProjectDetection): Record<string, string> {
    const deps: Record<string, string> = {};
    
    // This would be populated from the actual package.json parsing
    // For now, return common defaults based on framework
    switch (detection.framework) {
      case 'react':
      case 'next':
      case 'vite-react':
        deps['react'] = 'latest';
        deps['react-dom'] = 'latest';
        break;
      case 'vue':
      case 'nuxt':
        deps['vue'] = 'latest';
        break;
      case 'svelte':
        deps['svelte'] = 'latest';
        break;
      case 'solid':
        deps['solid-js'] = 'latest';
        break;
    }

    return deps;
  }

  /**
   * Get preview mode priority (local first, then cloud fallback)
   */
  getPreviewModePriority(): PreviewMode[] {
    return [
      'sandpack',     // Local: In-browser bundling
      'webcontainer', // Local: In-browser Node.js
      'pyodide',      // Local: In-browser Python
      'parcel',       // Local: Inline bundling
      'iframe',       // Local: Raw HTML
      'nextjs',       // Local via WebContainer
      'opensandbox',  // Cloud: OpenSandbox container (self-hosted)
      'devbox',       // Cloud: CodeSandbox DevBox
      'codesandbox',  // Cloud: CodeSandbox
      'vite',         // Redirects to Sandpack
      'webpack',      // Redirects to Sandpack
    ];
  }

  /**
   * Decide if should use local or cloud preview
   */
  shouldUseLocalPreview(detection: ProjectDetection): boolean {
    // Use local if:
    // - Not heavy computation
    // - No API keys (security)
    // - Not complex backend
    // - Simple Python (Pyodide) or frontend (Sandpack)
    
    if (detection.hasHeavyComputation || detection.hasAPIKeys) {
      return false; // Use cloud for heavy/security-sensitive
    }

    // Local suitable for:
    // - Frontend-only (React, Vue, Svelte)
    // - Simple Python
    // - Lightweight backends
    
    const localModes: PreviewMode[] = ['sandpack', 'webcontainer', 'pyodide', 'parcel', 'iframe', 'nextjs'];
    return localModes.includes(detection.previewMode);
  }

  /**
   * Get fallback cloud mode for when local fails
   */
  getCloudFallback(localMode: PreviewMode): PreviewMode {
    switch (localMode) {
      case 'sandpack':
      case 'webpack':
      case 'vite':
        return 'opensandbox'; // OpenSandbox container (self-hosted first)
      case 'codesandbox':
      case 'nextjs':
        return 'devbox'; // OpenSandbox for Node.js backends
      case 'pyodide':
        return 'opensandbox'; // OpenSandbox for Python
      case 'parcel':
      case 'iframe':
        return 'opensandbox';
      default:
        return 'devbox';
    }
  }

  /**
   * Transform require() to import for browser compatibility
   */
  transformCommonJS(code: string): string {
    if (!/require\(/.test(code)) return code;

    return code
      // Handle: const x = require('module')
      .replace(/const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g, "import $1 from '$2'")
      // Handle: var x = require('module')
      .replace(/var\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g, "import $1 from '$2'")
      // Handle: let x = require('module')
      .replace(/let\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g, "import $1 from '$2'")
      // Handle: const { a, b } = require('module')
      .replace(/const\s*\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\)/g, "import { $1 } from '$2'");
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

export const livePreviewOffloading = new LivePreviewOffloading();

// ============================================================================
// Convenience Exports
// ============================================================================

export const detectProject = (request: PreviewRequest) =>
  livePreviewOffloading.detectProject(request);

export const getSandpackConfig = (detection: ProjectDetection) =>
  livePreviewOffloading.getSandpackConfig(detection);

export const detectPreviewMode = (
  filePaths: string[],
  framework: AppFramework,
  bundler: Bundler,
  hasPython: boolean,
  hasNodeServer: boolean,
  hasNextJS: boolean,
  packageJson: Record<string, any> | null,
  hasHeavyComputation: boolean,
  hasAPIKeys: boolean,
  heuristics?: OffloadHeuristics
) => livePreviewOffloading.detectPreviewMode(
  filePaths, framework, bundler, hasPython, hasNodeServer, hasNextJS, packageJson, hasHeavyComputation, hasAPIKeys, heuristics
);

export const detectFramework = (
  filePaths: string[],
  files: Record<string, string>,
  packageJson: Record<string, any> | null
) => livePreviewOffloading.detectFramework(filePaths, files, packageJson);

export const detectEntryPoint = (filePaths: string[], framework: AppFramework) =>
  livePreviewOffloading.detectEntryPoint(filePaths, framework);

/**
 * Analyze project heuristics for auto-offload decision
 * 
 * @param request - Preview request with files
 * @returns Heuristics analysis result
 * 
 * @example
 * ```typescript
 * import { analyzeHeuristics } from '@/lib/previews/live-preview-offloading';
 * 
 * const heuristics = analyzeHeuristics({ files });
 * if (heuristics.shouldOffload) {
 *   console.log(`Auto-offload recommended: ${heuristics.offloadReason}`);
 * }
 * ```
 */
export const analyzeHeuristics = (request: PreviewRequest): OffloadHeuristics =>
  livePreviewOffloading.analyzeHeuristics(request);

export const shouldUseLocalPreview = (detection: ProjectDetection) =>
  livePreviewOffloading.shouldUseLocalPreview(detection);

export const getCloudFallback = (localMode: PreviewMode) =>
  livePreviewOffloading.getCloudFallback(localMode);

export const detectPort = (files: Record<string, string>) =>
  livePreviewOffloading.detectPort(files);

export const getCodeSandboxTemplate = (framework: AppFramework) =>
  livePreviewOffloading.getCodeSandboxTemplate(framework);

/**
 * Extract YouTube video ID from URL or plain ID
 *
 * @param url - YouTube URL or video ID
 * @returns Video ID or null if invalid
 *
 * @example
 * ```typescript
 * extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ') // 'dQw4w9WgXcQ'
 * extractYouTubeId('https://youtu.be/dQw4w9WgXcQ') // 'dQw4w9WgXcQ'
 * extractYouTubeId('dQw4w9WgXcQ') // 'dQw4w9WgXcQ'
 * ```
 */
export function extractYouTubeId(url: string): string | null {
  if (!url) return null;

  // If it's already just an ID (11 characters, alphanumeric)
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }

  // Standard YouTube URL: https://www.youtube.com/watch?v=VIDEO_ID
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) {
    return watchMatch[1];
  }

  // Shortened URL: https://youtu.be/VIDEO_ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) {
    return shortMatch[1];
  }

  // Embed URL: https://www.youtube.com/embed/VIDEO_ID
  const embedMatch = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) {
    return embedMatch[1];
  }

  return null;
}