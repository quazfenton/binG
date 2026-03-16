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
 * @example
 * ```typescript
 * import { livePreviewOffloading } from '@/lib/previews/live-preview-offloading';
 *
 * // Detect project and select preview mode
 * const previewMode = livePreviewOffloading.detectPreviewMode(files, packageJson);
 * // Returns: 'sandpack', 'webcontainer', 'pyodide', 'devbox', etc.
 *
 * // Get framework from project files
 * const framework = livePreviewOffloading.detectFramework(files, packageJson);
 * // Returns: 'react', 'vue', 'next', 'flask', etc.
 *
 * // Detect entry point with relative path normalization
 * const entryPoint = livePreviewOffloading.detectEntryPoint(files, framework);
 * // Returns: '/src/main.tsx', '/src/index.js', etc.
 *
 * // Get preview mode configuration for Sandpack
 * const sandpackConfig = livePreviewOffloading.getSandpackConfig(files, framework);
 * // Returns: { template, files, customSetup }
 * ```
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('Previews:LivePreview');

// ============================================================================
// Types
// ============================================================================

/**
 * Preview mode types
 */
export type PreviewMode = 
  | 'sandpack' 
  | 'iframe' 
  | 'raw' 
  | 'parcel' 
  | 'devbox' 
  | 'pyodide' 
  | 'vite' 
  | 'webpack' 
  | 'webcontainer' 
  | 'nextjs' 
  | 'codesandbox' 
  | 'local' 
  | 'cloud';

/**
 * Supported frameworks
 */
export type AppFramework = 
  | 'react' 
  | 'vue' 
  | 'angular' 
  | 'svelte' 
  | 'solid' 
  | 'vanilla' 
  | 'next' 
  | 'nuxt' 
  | 'gatsby' 
  | 'vite' 
  | 'astro' 
  | 'remix' 
  | 'qwik' 
  | 'gradio' 
  | 'streamlit' 
  | 'flask' 
  | 'fastapi' 
  | 'django' 
  | 'vite-react'
  | 'unknown';

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
 */
const FRAMEWORK_TO_TEMPLATE: Record<AppFramework, string> = {
  react: 'react',
  'vite-react': 'react',
  next: 'nextjs',
  nuxt: 'nuxt',
  vue: 'vue',
  svelte: 'svelte',
  angular: 'angular',
  solid: 'solid',
  astro: 'astro',
  remix: 'remix',
  gatsby: 'gatsby',
  vanilla: 'vanilla',
  vite: 'react', // Vite projects use React template for frontend
  unknown: 'vanilla',
};

/**
 * Framework default entry points
 */
const FRAMEWORK_ENTRY_POINTS: Record<AppFramework, string[]> = {
  react: ['/src/main.tsx', '/src/main.jsx', '/src/index.tsx', '/src/index.jsx', '/src/App.tsx', '/src/App.jsx', '/index.tsx', '/index.jsx'],
  'vite-react': ['/src/main.tsx', '/src/main.jsx', '/src/index.tsx', '/src/index.jsx'],
  next: ['/src/app/page.tsx', '/src/app/page.jsx', '/pages/index.tsx', '/pages/index.jsx', '/src/pages/index.tsx', '/src/pages/index.jsx'],
  nuxt: ['/src/main.ts', '/src/main.js', '/src/App.vue', '/app.vue'],
  vue: ['/src/main.ts', '/src/main.js', '/src/App.vue', '/main.ts', '/main.js'],
  svelte: ['/src/main.ts', '/src/main.js', '/src/App.svelte', '/App.svelte'],
  angular: ['/src/main.ts', '/src/main.js', '/src/app/app.component.ts'],
  solid: ['/src/index.tsx', '/src/index.jsx', '/src/App.tsx'],
  astro: ['/src/pages/index.astro', '/pages/index.astro', '/index.astro'],
  remix: ['/app/routes/_index.tsx', '/app/routes/_index.jsx', '/app/root.tsx'],
  gatsby: ['/src/pages/index.js', '/src/pages/index.tsx', '/pages/index.js'],
  vite: ['/src/main.ts', '/src/main.js', '/src/index.ts', '/src/index.js'],
  vanilla: ['/index.html', '/index.js', '/main.js', '/app.js'],
  unknown: ['/index.html', '/index.js'],
  gradio: ['/main.py', '/app.py'],
  streamlit: ['/main.py', '/app.py'],
  flask: ['/main.py', '/app.py'],
  fastapi: ['/main.py', '/app.py'],
  django: ['/manage.py', '/main.py'],
  qwik: ['/src/root.tsx', '/src/index.tsx'],
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
 * Server file patterns
 */
const SERVER_FILES = ['server.js', 'app.js', 'index.js', 'main.js', 'main.py', 'app.py', 'manage.py'];

/**
 * Heavy computation patterns
 */
const HEAVY_COMPUTATION_PATTERNS = ['tensorflow', 'pytorch', 'cuda', 'gpu', 'torch', 'keras'];

/**
 * API key patterns
 */
const API_KEY_PATTERNS = ['OPENAI_API_KEY', 'process.env', 'API_KEY', 'SECRET_KEY', 'AWS_ACCESS_KEY'];

// ============================================================================
// Live Preview Offloading Class
// ============================================================================

export class LivePreviewOffloading {
  /**
   * Detect project configuration from files
   * 
   * Analyzes project files to determine:
   * - Framework (React, Vue, Next.js, Flask, etc.)
   * - Bundler (Vite, Webpack, Parcel)
   * - Entry point (main.tsx, app.py, etc.)
   * - Recommended preview mode
   * - Normalized file paths
   */
  detectProject(request: PreviewRequest): ProjectDetection {
    const { files, scopePath } = request;
    const filePaths = Object.keys(files);
    const fileCount = filePaths.length;

    // Detect package manager
    const packageManager = this.detectPackageManager(filePaths);

    // Parse package.json if exists
    const packageJson = this.parsePackageJson(files['package.json'] || files['/package.json']);

    // Detect framework
    const framework = this.detectFramework(filePaths, files, packageJson);

    // Detect bundler
    const bundler = this.detectBundler(filePaths, files, packageJson);

    // Detect entry point
    const entryPoint = this.detectEntryPoint(filePaths, framework);

    // Compute root directory scores
    const rootScores = this.computeRootScores(files);

    // Select best root
    const selectedRoot = this.selectRoot(rootScores);

    // Normalize files relative to selected root
    const normalizedFiles = this.normalizeFiles(files, selectedRoot, scopePath);

    // Detect project characteristics
    const hasPython = filePaths.some(p => p.endsWith('.py'));
    const hasNodeServer = filePaths.some(p => SERVER_FILES.includes(p));
    const hasNextJS = this.detectNextJS(filePaths, packageJson);
    const hasBackend = hasPython || hasNodeServer || framework === 'next' || framework === 'nuxt' || framework === 'remix';
    const hasHeavyComputation = this.detectHeavyComputation(Object.values(files));
    const hasAPIKeys = this.detectAPIKeys(Object.values(files));

    // Detect preview mode
    const previewMode = this.detectPreviewMode(
      filePaths, 
      framework, 
      bundler, 
      hasPython, 
      hasNodeServer, 
      hasNextJS,
      packageJson,
      hasHeavyComputation,
      hasAPIKeys
    );

    logger.debug(`[detectProject] framework=${framework}, bundler=${bundler}, previewMode=${previewMode}, files=${fileCount}`);

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
   */
  detectFramework(
    filePaths: string[], 
    files: Record<string, string>,
    packageJson: Record<string, any> | null
  ): AppFramework {
    // Check package.json dependencies first
    const deps = packageJson ? { ...packageJson.dependencies, ...packageJson.devDependencies } : {};
    
    if (deps.next || deps['next']) return 'next';
    if (deps.nuxt || deps['@nuxt/core'] || deps.nuxt3) return 'nuxt';
    if (deps.gatsby) return 'gatsby';
    if (deps.astro) return 'astro';
    if (deps['@remix-run/react']) return 'remix';
    if (deps.svelte || deps['@sveltejs/kit']) return 'svelte';
    if (deps['solid-js']) return 'solid';
    if (deps['@builder.io/qwik']) return 'qwik';
    if (deps['@angular/core']) return 'angular';
    if (deps.gradio) return 'gradio';
    if (deps.streamlit) return 'streamlit';
    if (deps.flask || deps.Flask) return 'flask';
    if (deps.fastapi || deps.fastapi) return 'fastapi';
    if (deps.django || deps.Django) return 'django';
    if (deps.react) return 'react';
    if (deps.vue || deps['@vue/core']) return 'vue';

    // Check file extensions and patterns
    const hasJsx = filePaths.some(p => p.endsWith('.jsx') || p.endsWith('.tsx'));
    const hasVue = filePaths.some(p => p.endsWith('.vue'));
    const hasSvelte = filePaths.some(p => p.endsWith('.svelte'));
    const hasPython = filePaths.some(p => p.endsWith('.py'));
    const hasTsx = filePaths.some(p => p.endsWith('.tsx'));
    
    // Check for config files
    const hasViteConfig = filePaths.some(p => p.includes('vite.config'));
    const hasNextConfig = filePaths.some(p => p.includes('next.config'));
    const hasNuxtConfig = filePaths.some(p => p.includes('nuxt.config'));

    // Python frameworks
    if (hasPython) {
      const pythonContent = Object.entries(files)
        .filter(([p]) => p.endsWith('.py'))
        .map(([, c]) => c)
        .join('\n');
      
      if (pythonContent.includes('import gradio')) return 'gradio';
      if (pythonContent.includes('import streamlit')) return 'streamlit';
      if (pythonContent.includes('from flask import') || pythonContent.includes('Flask(')) return 'flask';
      if (pythonContent.includes('from fastapi import') || pythonContent.includes('FastAPI(')) return 'fastapi';
      if (pythonContent.includes('from django import') || pythonContent.includes('django.setup()')) return 'django';
    }

    // JavaScript frameworks
    if (hasNextConfig || filePaths.some(p => p.startsWith('pages/') || p.startsWith('app/'))) return 'next';
    if (hasNuxtConfig) return 'nuxt';
    if (hasViteConfig && hasJsx) return 'vite-react';
    if (hasViteConfig) return 'vite';
    if (hasVue) return 'vue';
    if (hasSvelte) return 'svelte';
    if (hasTsx && hasJsx) return 'react';

    // Check code content for imports
    const jsContent = Object.entries(files)
      .filter(([p]) => p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx'))
      .map(([, c]) => c)
      .join('\n');

    if (jsContent.includes('from "react"') || jsContent.includes('from \'react\'')) return 'react';
    if (jsContent.includes('from "vue"') || jsContent.includes('from \'vue\'')) return 'vue';
    if (jsContent.includes('from "@sveltejs/')) return 'svelte';

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
   */
  computeRootScores(files: Record<string, string>): Map<string, number> {
    const scores = new Map<string, number>();
    scores.set('', 1); // Base score

    const addScore = (root: string, score: number) => {
      scores.set(root, (scores.get(root) || 0) + score);
    };

    for (const filePath of Object.keys(files)) {
      const cleanPath = filePath.replace(/^\/+/, '');
      const parts = cleanPath.split('/').filter(Boolean);
      if (parts.length === 0) continue;

      const fileName = parts[parts.length - 1];
      const dir = parts.slice(0, -1).join('/');

      // Score based on config files presence
      if (fileName === 'package.json') addScore(dir, 8);
      if (fileName === 'index.html') addScore(dir, 6);
      if (CONFIG_FILES.viteConfig.includes(fileName)) addScore(dir, 6);
      if (CONFIG_FILES.webpackConfig.includes(fileName)) addScore(dir, 6);
      if (CONFIG_FILES.parcelConfig.includes(fileName)) addScore(dir, 6);
      if (CONFIG_FILES.nextConfig.includes(fileName)) addScore(dir, 6);

      // Entry point scoring
      if (/^main\.(js|jsx|ts|tsx)$/.test(fileName)) {
        if (dir.endsWith('/src')) addScore(dir.replace(/\/src$/, ''), 5);
        addScore(dir, 2);
      }
      if (/^index\.(js|jsx|ts|tsx|html)$/.test(fileName)) {
        addScore(dir, 3);
      }
    }

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
    hasAPIKeys: boolean
  ): PreviewMode {
    const hasPackageJson = filePaths.some(p => p.endsWith('package.json'));
    const hasHtml = filePaths.some(p => p.endsWith('.html'));
    const hasJsx = filePaths.some(p => p.endsWith('.jsx') || p.endsWith('.tsx'));
    const hasVue = filePaths.some(p => p.endsWith('.vue'));
    const hasSvelte = filePaths.some(p => p.endsWith('.svelte'));
    const hasSimplePython = hasPython && !filePaths.some(f => f.includes('flask') || f.includes('django'));

    // Python with simple setup -> Pyodide
    if (hasSimplePython && !hasPackageJson) {
      return 'pyodide';
    }

    // HTML without framework -> Iframe
    if (hasHtml && !hasJsx && !hasVue && !hasSvelte) {
      return 'iframe';
    }

    // Next.js -> Next.js mode (WebContainer)
    if (hasNextJS || framework === 'next') {
      return 'nextjs';
    }

    // Framework projects (React/Vue/Svelte) -> Sandpack
    if (hasJsx || hasVue || hasSvelte) {
      return 'sandpack';
    }

    // Vite project with package.json -> Vite mode (redirects to Sandpack)
    if (bundler === 'vite' || (packageJson && packageJson.devDependencies?.vite)) {
      return 'vite';
    }

    // Webpack project -> Webpack mode (redirects to Sandpack)
    if (bundler === 'webpack' || (packageJson && packageJson.devDependencies?.webpack)) {
      return 'webpack';
    }

    // Parcel project -> Parcel mode
    if (bundler === 'parcel' || (packageJson && packageJson.devDependencies?.parcel)) {
      return 'parcel';
    }

    // Node.js server with package.json -> WebContainer
    if (hasNodeServer && hasPackageJson) {
      // Check for Docker or complex deps -> Cloud fallback
      const hasDocker = filePaths.some(f => f === 'Dockerfile' || f === 'docker-compose.yml');
      const hasComplexDeps = packageJson && (
        packageJson.dependencies?.prisma ||
        packageJson.dependencies?.sequelize ||
        packageJson.dependencies?.typeorm ||
        packageJson.dependencies?.mongodb ||
        packageJson.dependencies?.redis
      );
      
      if (hasDocker || hasComplexDeps) {
        return 'devbox'; // Cloud for complex apps
      }
      return 'webcontainer';
    }

    // Python or Node without simple setup -> DevBox (cloud)
    if (hasPython || hasNodeServer) {
      const hasDocker = filePaths.some(f => f === 'Dockerfile' || f === 'docker-compose.yml');
      const hasComplexDeps = packageJson && (
        packageJson.dependencies?.prisma ||
        packageJson.dependencies?.sequelize ||
        packageJson.dependencies?.mongodb
      );
      
      if (hasDocker || hasComplexDeps) {
        return 'codesandbox';
      }
      return 'devbox';
    }

    // Default to Sandpack
    return 'sandpack';
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
      'devbox',       // Cloud: CodeSandbox DevBox (first cloud option)
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
        return 'devbox'; // Cloud DevBox for complex frontend
      case 'webcontainer':
      case 'nextjs':
        return 'codesandbox'; // CodeSandbox for Node.js backends
      case 'pyodide':
        return 'devbox'; // DevBox for Python
      case 'parcel':
      case 'iframe':
        return 'devbox';
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
  hasAPIKeys: boolean
) => livePreviewOffloading.detectPreviewMode(
  filePaths, framework, bundler, hasPython, hasNodeServer, hasNextJS, packageJson, hasHeavyComputation, hasAPIKeys
);

export const detectFramework = (
  filePaths: string[],
  files: Record<string, string>,
  packageJson: Record<string, any> | null
) => livePreviewOffloading.detectFramework(filePaths, files, packageJson);

export const detectEntryPoint = (filePaths: string[], framework: AppFramework) => 
  livePreviewOffloading.detectEntryPoint(filePaths, framework);

export const shouldUseLocalPreview = (detection: ProjectDetection) => 
  livePreviewOffloading.shouldUseLocalPreview(detection);

export const getCloudFallback = (localMode: PreviewMode) => 
  livePreviewOffloading.getCloudFallback(localMode);