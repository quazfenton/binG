import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname);

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: false,
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
    optimizeCss: true,
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'date-fns',
      'lodash',
    ],
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? {
          exclude: ['error', 'warn'],
        }
      : false,
  },
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
  },
  serverExternalPackages: [
    'livekit-server-sdk',
    '@anthropic-ai/sdk',
    'openai',
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
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      config.externals = [
        ...(config.externals || []),
        'fs',
        'fs/promises',
        'child_process',
        'crypto',
        'stream',
        'stream/promises',
        'net',
        'node:net',
        'tls',
        'node:tls',
        'http',
        'https',
        'url',
        'zlib',
        'os',
        'path',
        'assert',
        'buffer',
        'util',
        'events',
        'module',
        'node:module',
        'vm',
        'timers/promises',
        'dns',
      ];

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
        buffer: false,
        util: false,
        events: false,
        module: false,
        'node:module': false,
        vm: false,
        'timers/promises': false,
        dns: false,
        'node:fs': false,
        'node:fs/promises': false,
        'node:child_process': false,
      };
    }

    if (dev) {
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
          return message.includes('viewport');
        },
      ];
    }

    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.tsx', '.jsx'],
      '.mjs': ['.mjs', '.mts'],
      '.cjs': ['.cjs', '.cts'],
    };

    // Resolve monorepo workspace packages (matches tsconfig paths)
    const packagesRoot = resolve(projectRoot, '..', 'packages');
    config.resolve.alias = {
      ...config.resolve.alias,
      '@bing/platform': resolve(packagesRoot, 'platform/src/env.ts'),
      '@bing/shared/agent/v2-executor': resolve(packagesRoot, 'shared/agent/v2-executor.ts'),
      '@bing/shared/agent/workforce-manager': resolve(packagesRoot, 'shared/agent/workforce-manager.ts'),
      '@bing/shared/agent/workforce-state': resolve(packagesRoot, 'shared/agent/workforce-state.ts'),
      '@bing/shared/agent/orchestration-mode-handler': resolve(packagesRoot, 'shared/agent/orchestration-mode-handler.ts'),
      '@bing/shared/agent/prompt-parameters': resolve(packagesRoot, 'shared/agent/prompt-parameters.ts'),
      '@bing/shared/agent/prompt-parameters.codec': resolve(packagesRoot, 'shared/agent/prompt-parameters.codec.ts'),
      '@bing/shared/agent/nullclaw-integration': resolve(packagesRoot, 'shared/agent/nullclaw-integration.ts'),
      '@bing/shared/agent/enhanced-background-jobs': resolve(packagesRoot, 'shared/agent/enhanced-background-jobs.ts'),
      '@bing/shared/agent/background-jobs': resolve(packagesRoot, 'shared/agent/background-jobs.ts'),
      '@bing/shared/agent/general-domain-prompts': resolve(packagesRoot, 'shared/agent/general-domain-prompts.ts'),
      '@bing/shared/agent/general-domain-prompts-v2': resolve(packagesRoot, 'shared/agent/general-domain-prompts-v2.ts'),
      '@bing/shared/agent/general-domain-prompts-v3': resolve(packagesRoot, 'shared/agent/general-domain-prompts-v3.ts'),
      '@bing/shared/agent/general-domain-prompts-v4': resolve(packagesRoot, 'shared/agent/general-domain-prompts-v4.ts'),
      '@bing/shared/agent/system-prompts': resolve(packagesRoot, 'shared/agent/system-prompts.ts'),
      '@bing/shared/agent/system-prompts-supplementary': resolve(packagesRoot, 'shared/agent/system-prompts-supplementary.ts'),
      '@bing/shared/agent/agent-kernel': resolve(packagesRoot, 'shared/agent/agent-kernel.ts'),
      '@bing/shared/agent/agent-workspace': resolve(packagesRoot, 'shared/agent/agent-workspace.ts'),
      '@bing/shared/agent/agent-fs-bridge': resolve(packagesRoot, 'shared/agent/agent-fs-bridge.ts'),
      '@bing/shared/agent/cloud-agent-offload': resolve(packagesRoot, 'shared/agent/cloud-agent-offload.ts'),
      '@bing/shared/agent/execution-graph': resolve(packagesRoot, 'shared/agent/execution-graph.ts'),
      '@bing/shared/agent/unified-agent': resolve(packagesRoot, 'shared/agent/unified-agent.ts'),
      '@bing/shared/agent/loop-detection': resolve(packagesRoot, 'shared/agent/loop-detection.ts'),
      '@bing/shared/agent/timeout-escalation': resolve(packagesRoot, 'shared/agent/timeout-escalation.ts'),
      '@bing/shared/agent/capability-chain': resolve(packagesRoot, 'shared/agent/capability-chain.ts'),
      '@bing/shared/agent/bootstrapped-agency': resolve(packagesRoot, 'shared/agent/bootstrapped-agency.ts'),
      '@bing/shared/agent/productive-scripts': resolve(packagesRoot, 'shared/agent/productive-scripts.ts'),
      '@bing/shared/agent/task-router': resolve(packagesRoot, 'shared/agent/task-router.ts'),
      '@bing/shared/agent/task-classifier': resolve(packagesRoot, 'shared/agent/task-classifier.ts'),
      '@bing/shared/agent/multi-agent-collaboration': resolve(packagesRoot, 'shared/agent/multi-agent-collaboration.ts'),
      '@bing/shared/agent/mastra-workflow-integration': resolve(packagesRoot, 'shared/agent/mastra-workflow-integration.ts'),
      '@bing/shared/agent/opencode-direct': resolve(packagesRoot, 'shared/agent/opencode-direct.ts'),
      '@bing/shared/agent/nullclaw-integration': resolve(packagesRoot, 'shared/agent/nullclaw-integration.ts'),
      '@bing/shared/agent/git-manager': resolve(packagesRoot, 'shared/agent/git-manager.ts'),
      '@bing/shared/agent/workflow-templates': resolve(packagesRoot, 'shared/agent/workflow-templates.ts'),
      '@bing/shared/agent/simulated-orchestration': resolve(packagesRoot, 'shared/agent/simulated-orchestration.ts'),
      '@bing/shared/agent/orchestration/agent-orchestrator': resolve(packagesRoot, 'shared/agent/orchestration/agent-orchestrator.ts'),
      '@bing/shared/agent/services/agent-worker/src': resolve(packagesRoot, 'shared/agent/services/agent-worker/src/index.ts'),
      '@bing/shared/agent/services/agent-gateway/src': resolve(packagesRoot, 'shared/agent/services/agent-gateway/src/index.ts'),
      '@bing/shared/agent/tool-router/tool-router': resolve(packagesRoot, 'shared/agent/tool-router/tool-router.ts'),
    };

    config.resolve.mainFields = ['module', 'main'];

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
        buffer: false,
        util: false,
        events: false,
        child_process: false,
        'node:child_process': false,
        module: false,
        'node:module': false,
        vm: false,
        'timers/promises': false,
        dns: false,
        'node:fs/promises': false,
      };

      config.resolve.alias = {
        ...config.resolve.alias,
        'node:crypto': false,
        'node:fs': false,
        'node:path': false,
        'node:os': false,
        'node:url': false,
        'node:buffer': false,
        'node:stream': false,
        'node:util': false,
        'node:events': false,
        'node:http': false,
        'node:https': false,
        'node:net': false,
        'node:tls': false,
        'node:zlib': false,
        'node:assert': false,
      };
    }

    return config;
  },
  async headers() {

    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization",
          },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
