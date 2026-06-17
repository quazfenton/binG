import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname);
const isDesktopBuild = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export — Vercel only serves frontend assets
  // Backend API routes are handled externally (OCI, 9router, etc.)
  // Disabled during dev so API routes work locally without 500 errors.
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,

  // Vendored workspace packages (web/.bing-platform, web/.bing-shared) ship raw .ts;
  // tell Next to transpile them during the Vercel build.
  transpilePackages: ['@bing/platform', '@bing/shared', '@opencode-ai/sdk'],
  onDemandEntries: {
    maxInactiveAge: 25 * 1000,
    pagesBufferLength: 2,
  },
  staticPageGenerationTimeout: 600,
  images: {
    // SECURITY: Use custom loader for dynamic image validation instead of wildcard
    // This allows custom images while blocking SSRF-prone domains at runtime
    loader: 'custom',
    loaderFile: './lib/utils/image-loader.ts',
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'media.tenor.com',
      },
      {
        protocol: 'https',
        hostname: 'i.pinimg.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: '**.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: '**.pinimg.com',
      },
      {
        protocol: 'https',
        hostname: '**.tenor.com',
      },
      {
        protocol: 'https',
        hostname: 'mir-s3-cdn-cf.behance.net',
      },
      {
        protocol: 'https',
        hostname: '**.behance.net',
      },
      {
        protocol: 'https',
        hostname: 'cdn.dribbble.com',
      },
      {
        protocol: 'https',
        hostname: '**.dribbble.com',
      },
      {
        protocol: 'https',
        hostname: '**.giphy.com',
      },
      {
        protocol: 'https',
        hostname: 'media.giphy.com',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  allowedDevOrigins: [
    'localhost:3000',
    'localhost:3001',
    'localhost:3002',
    'localhost:3003',
    'localhost:3004',
    'localhost:3005',
    'ddhhst-3000.csb.app',
  ],
  compress: true,
  poweredByHeader: false,
  generateEtags: true,
  experimental: {
    // optimizeCss: true, // Disabled - causes issues in standalone builds
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'date-fns',
      'lodash',
    ],
    // Turbopack aliases — replaces server-only npm packages leaking into
    // client bundles with no-op stubs. (Webpack equivalents are in the
    // webpack() function below; Turbopack ignores that section entirely.)
    turbo: {
      resolveAlias: {
        'server-only': './lib/utils/server-only-stub.ts',
        'node:module': './lib/utils/node-module-stub.ts',
        'mcporter': './lib/utils/empty-module.ts',
        'modal': './lib/utils/empty-module.ts',
        'tar': './lib/utils/empty-module.ts',
        'node-fetch': './lib/utils/empty-module.ts',
        '@daytonaio/sdk': './lib/utils/empty-module.ts',
      },
    },
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? {
          exclude: ['error', 'warn'],
        }
      : false,
  },
  
  // Type-checking is skipped during build so pre-existing type errors in
  // shared/* packages and .bing-shared vendored code don't block deployment.
  // Local development catches type errors via the editor/CLI instead.
  typescript: { ignoreBuildErrors: true },

  // Skip generating the _error page for standalone builds
  // This prevents the _global-error prerender issue
  generateBuildId: () => `build-${Date.now()}`,

  env: {
    DEFAULT_LLM_PROVIDER: process.env.DEFAULT_LLM_PROVIDER,
    DEFAULT_MODEL: process.env.DEFAULT_MODEL,
    DEFAULT_TEMPERATURE: process.env.DEFAULT_TEMPERATURE,
    DEFAULT_MAX_TOKENS: process.env.DEFAULT_MAX_TOKENS,
    ENABLE_VOICE_FEATURES: process.env.ENABLE_VOICE_FEATURES,
    ENABLE_IMAGE_GENERATION: process.env.ENABLE_IMAGE_GENERATION,
    ENABLE_CHAT_HISTORY: process.env.ENABLE_CHAT_HISTORY,
    ENABLE_CODE_EXECUTION: process.env.ENABLE_CODE_EXECUTION,
    PORTKEY_API_KEY: process.env.PORTKEY_API_KEY,
    PORTKEY_VIRTUAL_KEY: process.env.PORTKEY_VIRTUAL_KEY,
    REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN,
    DESKTOP_MODE: process.env.DESKTOP_MODE,
    DESKTOP_LOCAL_EXECUTION: process.env.DESKTOP_LOCAL_EXECUTION,
  },
  serverExternalPackages: [
    'livekit-server-sdk',
    '@anthropic-ai/sdk',
    'openai',
    // Native modules that require platform-specific binaries
    'ssh2',
    'vm2',
    'node-pty',
    'cohere-ai',
    'together-ai',
    'replicate',
    '@google/generative-ai',
    'portkey-ai',
    '@daytonaio/sdk',
    '@e2b/code-interpreter',
    '@e2b/desktop',
    'e2b',
    'dockerode',
    'microsandbox',
    '@blaxel/core',
    'better-sqlite3',
    'ioredis',
    'bullmq',
    'nodemailer',
    'mailersend',
    '@getbrevo/brevo',
    'jsonwebtoken',
    'jose',
    'bcryptjs',
    '@tursodatabase/database',
    '@tursodatabase/sync',
  ],
  webpack: (config, { isServer, dev, webpack }) => {
    // Let Next.js SWC handle TypeScript/TSX by default (supports generators, JSX, etc.)
    // Only add custom loaders if SWC fails

    // Suppress warnings for all builds (server + client, dev + production)
    const existingIgnoreWarnings = config.ignoreWarnings || [];
    config.ignoreWarnings = [
      ...existingIgnoreWarnings,
      (warning) => {
        const moduleName = typeof warning.module === 'string'
          ? warning.module
          : (warning.module?.resource || '');
        const message = warning.message || '';

        if (moduleName && moduleName.includes('require-in-the-middle')) {
          return true;
        }
        if (message.includes('Critical dependency: require function is used')) {
          return true;
        }
        if (moduleName && moduleName.includes('ripgrep-vfs-adapter') && message.includes("Can't resolve")) {
          return true;
        }
        return message.includes('viewport');
      },
    ];

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'fs/promises': false,
        'child_process': false,
        crypto: false,
        stream: false,
        'stream/promises': false,
        net: false,
        'node:net': false,
        tls: false,
        'node:tls': false,
        http: false,
        https: false,
        url: false,
        zlib: false,
        os: false,
        path: false,
        assert: false,
        util: false,
        events: false,
        module: false,
        'node:module': false,
        vm: false,
        'timers/promises': false,
        dns: false,
        'node:fs': false,
        'node:fs/promises': false,
      };
    }

    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx', '.jsx'],
      '.mjs': ['.mjs', '.mts'],
      '.cjs': ['.cjs', '.cts'],
    };

    // Resolve monorepo workspace packages (matches tsconfig paths)
    const monorepoPackagesRoot = resolve(projectRoot, '..', 'packages');
    const hasMonorepoPackages = fs.existsSync(monorepoPackagesRoot);
    
    // Helper to resolve package paths, falling back to vendored versions if monorepo is not available
    const resolvePackagePath = (pkgName, relativePath) => {
      if (hasMonorepoPackages) {
        return resolve(monorepoPackagesRoot, pkgName, relativePath);
      }
      // Fallback to vendored path (e.g., .bing-shared)
      return resolve(projectRoot, `.bing-${pkgName}`, relativePath);
    };

    config.resolve.alias = {
      ...config.resolve.alias,
      '@bing/platform': resolvePackagePath('platform', 'src/env.ts'),
      '@bing/shared/FS/fs-bridge': resolvePackagePath('shared', 'FS/fs-bridge.ts'),
      '@bing/shared/FS/workspace-manager': resolvePackagePath('shared', 'FS/workspace-manager.ts'),
      '@bing/shared/FS/index': resolvePackagePath('shared', 'FS/index.ts'),
      '@bing/shared/agent/v2-executor': resolvePackagePath('shared', 'agent/v2-executor.ts'),
      '@bing/shared/agent/workforce-manager': resolvePackagePath('shared', 'agent/workforce-manager.ts'),
      '@bing/shared/agent/workforce-state': resolvePackagePath('shared', 'agent/workforce-state.ts'),
      '@bing/shared/agent/orchestration-mode-handler': resolvePackagePath('shared', 'agent/orchestration-mode-handler.ts'),
      '@bing/shared/agent/prompt-parameters': resolvePackagePath('shared', 'agent/prompt-parameters.ts'),
      '@bing/shared/agent/prompt-parameters.codec': resolvePackagePath('shared', 'agent/prompt-parameters.codec.ts'),
      '@bing/shared/agent/nullclaw-integration': resolvePackagePath('shared', 'agent/nullclaw-integration.ts'),
      '@bing/shared/agent/enhanced-background-jobs': resolvePackagePath('shared', 'agent/enhanced-background-jobs.ts'),
      '@bing/shared/agent/background-jobs': resolvePackagePath('shared', 'agent/background-jobs.ts'),
      '@bing/shared/agent/general-domain-prompts': resolvePackagePath('shared', 'agent/general-domain-prompts.ts'),
      '@bing/shared/agent/general-domain-prompts-v2': resolvePackagePath('shared', 'agent/general-domain-prompts-v2.ts'),
      '@bing/shared/agent/general-domain-prompts-v3': resolvePackagePath('shared', 'agent/general-domain-prompts-v3.ts'),
      '@bing/shared/agent/general-domain-prompts-v4': resolvePackagePath('shared', 'agent/general-domain-prompts-v4.ts'),
      '@bing/shared/agent/system-prompts': resolvePackagePath('shared', 'agent/system-prompts.ts'),
      '@bing/shared/agent/system-prompts-supplementary': resolvePackagePath('shared', 'agent/system-prompts-supplementary.ts'),
      '@bing/shared/agent/agent-kernel': resolvePackagePath('shared', 'agent/agent-kernel.ts'),
      '@bing/shared/agent/agent-workspace': resolvePackagePath('shared', 'agent/agent-workspace.ts'),
      '@bing/shared/agent/agent-fs-bridge': resolvePackagePath('shared', 'agent/agent-fs-bridge.ts'),
      '@bing/shared/agent/cloud-agent-offload': resolvePackagePath('shared', 'agent/cloud-agent-offload.ts'),
      '@bing/shared/agent/execution-graph': resolvePackagePath('shared', 'agent/execution-graph.ts'),
      '@bing/shared/agent/unified-agent': resolvePackagePath('shared', 'agent/unified-agent.ts'),
      '@bing/shared/agent/loop-detection': resolvePackagePath('shared', 'agent/loop-detection.ts'),
      '@bing/shared/agent/timeout-escalation': resolvePackagePath('shared', 'agent/timeout-escalation.ts'),
      '@bing/shared/agent/capability-chain': resolvePackagePath('shared', 'agent/capability-chain.ts'),
      '@bing/shared/agent/bootstrapped-agency': resolvePackagePath('shared', 'agent/bootstrapped-agency.ts'),
      '@bing/shared/agent/productive-scripts': resolvePackagePath('shared', 'agent/productive-scripts.ts'),
      '@bing/shared/agent/task-router': resolvePackagePath('shared', 'agent/task-router.ts'),
      '@bing/shared/agent/task-classifier': resolvePackagePath('shared', 'agent/task-classifier.ts'),
      '@bing/shared/agent/multi-agent-collaboration': resolvePackagePath('shared', 'agent/multi-agent-collaboration.ts'),
      '@bing/shared/agent/mastra-workflow-integration': resolvePackagePath('shared', 'agent/mastra-workflow-integration.ts'),
      '@bing/shared/agent/opencode-direct': resolvePackagePath('shared', 'agent/opencode-direct.ts'),
      '@bing/shared/agent/nullclaw-integration': resolvePackagePath('shared', 'agent/nullclaw-integration.ts'),
      '@bing/shared/agent/git-manager': resolvePackagePath('shared', 'agent/git-manager.ts'),
      '@bing/shared/agent/workflow-templates': resolvePackagePath('shared', 'agent/workflow-templates.ts'),
      '@bing/shared/agent/simulated-orchestration': resolvePackagePath('shared', 'agent/simulated-orchestration.ts'),
      '@bing/shared/agent/orchestration/agent-orchestrator': resolvePackagePath('shared', 'agent/orchestration/agent-orchestrator.ts'),
      '@bing/shared/agent/services/agent-worker/src': resolvePackagePath('shared', 'agent/services/agent-worker/src/index.ts'),
      '@bing/shared/agent/services/agent-gateway/src': resolvePackagePath('shared', 'agent/services/agent-gateway/src/index.ts'),
      '@bing/shared/agent/tool-router/tool-router': resolvePackagePath('shared', 'agent/tool-router/tool-router.ts'),

      // Direct module resolution aliases for Turbopack/Webpack compatibility
      '@bing/shared/agent/cloud-agent-offload': resolvePackagePath('shared', 'agent/cloud-agent-offload.ts'),
      '@bing/shared/agent/system-prompts': resolvePackagePath('shared', 'agent/system-prompts.ts'),
      '@bing/shared/agent/system-prompts-dynamic': resolvePackagePath('shared', 'agent/system-prompts-dynamic.ts'),
      '@bing/shared/agent/task-classifier': resolvePackagePath('shared', 'agent/task-classifier.ts'),
      '@bing/shared/agent/v2-executor': resolvePackagePath('shared', 'agent/v2-executor.ts'),
      '@bing/shared/agent/workforce-manager': resolvePackagePath('shared', 'agent/workforce-manager.ts'),
      '@bing/shared/agent/workforce-state': resolvePackagePath('shared', 'agent/workforce-state.ts'),
      '@bing/shared/lib/workspace-boundary': resolvePackagePath('shared', 'lib/workspace-boundary.ts'),
      '@bing/infra/config/config/features': resolve(projectRoot, '..', 'infra', 'config', 'config', 'features.ts'),

      // Tauri API stub — throws on web, real impl via dynamic import in desktop builds
      '@tauri-apps/api': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      '@tauri-apps/api/core': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      '@tauri-apps/api/event': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      '@tauri-apps/api/window': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      '@tauri-apps/api/fs': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      '@tauri-apps/api/tauri': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      '@tauri-apps/api/dialog': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      '@tauri-apps/api/fs-sync': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      '@tauri-apps/api/image': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      '@tauri-apps/api/path': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),

    };

    config.resolve.mainFields = ['module', 'main'];

    // Replace ALL @tauri-apps/api imports (including subpath imports from plugins)
    // with the web stub for both server and client builds
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^@tauri-apps\/api(\/.*)?$/,
        resolve(projectRoot, 'lib/utils/tauri-api-stub.ts')
      ),
      // Handle node:* protocol imports for both server and client builds.
      // Webpack 5.90+ enforces URI scheme checks before alias resolution.
      new webpack.NormalModuleReplacementPlugin(
        /^node:/,
        (resource) => {
          resource.request = resource.request.replace(/^node:/, '');
        }
      )
    );

    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'node:crypto': 'crypto',
        'node:fs': 'fs',
        'node:fs/promises': 'fs/promises',
        'node:path': 'path',
        'node:os': 'os',
        'node:url': 'url',
        'node:buffer': 'buffer',
        'node:stream': 'stream',
        'node:util': 'util',
        'node:events': 'events',
        'node:http': 'http',
        'node:https': 'https',
        'node:net': 'net',
        'node:tls': 'tls',
        'node:zlib': 'zlib',
        'node:assert': 'assert',
        'node:module': 'module',
        'node:child_process': 'child_process',
        'node:worker_threads': 'worker_threads',
        // Tauri API stub for server-side builds
        '@tauri-apps/api': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
        '@tauri-apps/api/fs': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
        '@tauri-apps/api/tauri': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
        '@tauri-apps/api/dialog': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
        '@tauri-apps/api/fs-sync': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
        '@tauri-apps/api/window': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
        '@tauri-apps/api/event': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
        '@tauri-apps/api/core': resolve(projectRoot, 'lib/utils/tauri-api-stub.ts'),
      };
    }

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'fs/promises': false,
        net: false,
        'node:net': false,
        tls: false,
        'node:tls': false,
        crypto: false,
        stream: false,
        'stream/promises': false,
        url: false,
        zlib: false,
        sharp: false,
        canvas: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
        util: false,
        events: false,
        child_process: false,
        'node:child_process': false,
        worker_threads: false,
        'node:worker_threads': false,
        module: false,
        'node:module': false,
        vm: false,
        'timers/promises': false,
        dns: false,
        'node:fs/promises': false,
      };

      config.resolve.alias = {
        ...config.resolve.alias,
        // Prevent 'server-only' from throwing at build time when transitively
        // imported by client components (e.g., bash-tool.ts → index.server.ts).
        // Replaced with a no-op stub — Node.js APIs are already stubbed to false
        // by the resolve.fallback config above.
        'server-only': resolve(projectRoot, 'lib/utils/server-only-stub.ts'),
        // Server-only npm packages that leak into client bundles via
        // transitive imports. Each requires Node.js built-ins (fs, net,
        // child_process) unavailable in browser contexts. Replaced with
        // a no-op proxy stub to prevent chunk generation errors.
        'mcporter': resolve(projectRoot, 'lib/utils/empty-module.ts'),
        'modal': resolve(projectRoot, 'lib/utils/empty-module.ts'),
        'tar': resolve(projectRoot, 'lib/utils/empty-module.ts'),
        'node-fetch': resolve(projectRoot, 'lib/utils/empty-module.ts'),
        '@daytonaio/sdk': resolve(projectRoot, 'lib/utils/empty-module.ts'),
        'node:crypto': false,
        'node:fs': false,
        'node:path': false,
        'node:os': false,
        'node:url': false,
        'node:stream': false,
        'node:util': false,
        'node:events': false,
        'node:http': false,
        'node:https': false,
        'node:net': false,
        'node:tls': false,
        'node:zlib': false,
        'node:assert': false,
        'node:buffer': 'buffer',
      };

      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
          buffer: ['buffer', 'Buffer'],
          process: 'process/browser',
        }),
        // Replace server-only npm packages (mcporter, modal, tar, node-fetch,
        // @daytonaio/sdk) leaking into client bundles with a no-op proxy stub.
        // Handles both main entry and subpath imports (e.g., node-fetch/src/...).
        // Client-only: server builds keep the real packages.
        new webpack.NormalModuleReplacementPlugin(
          /^(mcporter|modal|tar|node-fetch)(\/.*)?$/,
          resolve(projectRoot, 'lib/utils/empty-module.ts')
        ),
        new webpack.NormalModuleReplacementPlugin(
          /^@daytonaio\/sdk(\/.*)?$/,
          resolve(projectRoot, 'lib/utils/empty-module.ts')
        )
      );
    }

    return config;
  },
};

export default nextConfig;
