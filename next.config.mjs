import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname);

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: projectRoot,
  },
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
        'net',
        'tls',
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
        'vm',
      ];
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
        net: false,
        tls: false,
        crypto: false,
        stream: false,
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
        // Apply cross-origin isolation headers to ALL routes including static assets
        // This is required for WebContainer API (SharedArrayBuffer support)
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          // Additional headers for full cross-origin isolation
          {
            key: "Cross-Origin-Resource-Policy",
            value: "cross-origin",
          },
        ],
      },
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
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
