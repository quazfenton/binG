import NodePolyfillPlugin from 'node-polyfill-webpack-plugin';
import { env, nodeless } from 'unenv';

const { alias: turbopackAlias } = env(nodeless, {});

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
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
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  generateEtags: true,
  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  // Output optimization
  output: 'standalone',
  // Turbopack configuration (Next.js 16+)
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
    resolveAlias: {
      ...turbopackAlias,
    },
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
    CSP_REPORT_URI: process.env.CSP_REPORT_URI || '/api/csp-report',
    ENABLE_SRI: process.env.ENABLE_SRI || 'true',
  },
  serverExternalPackages: [
    "livekit-server-sdk",
    "@anthropic-ai/sdk",
    "openai",
    "cohere-ai",
    "together-ai",
    "replicate",
    "@google/generative-ai",
    "portkey-ai",
  ],
  webpack: (config, { isServer, dev }) => {
    // Add Node polyfills for Daytona SDK compatibility
    if (!isServer) {
      config.plugins.push(new NodePolyfillPlugin());
    }

    // Suppress specific warnings in development
    if (dev) {
      const existingIgnoreWarnings = config.ignoreWarnings || [];
      config.ignoreWarnings = [
        ...existingIgnoreWarnings,
        (warning) => {
          const moduleName = typeof warning.module === 'string' ? warning.module : (warning.module?.resource || '');
          const message = warning.message || '';

          if (moduleName && moduleName.includes('require-in-the-middle')) {
            return true;
          }
          if (message.includes('Critical dependency: require function is used')) {
            return true;
          }
          if (message.includes('module factory is not available')) {
            return true;
          }
          return false;
        },
        (warning) => {
          const message = warning.message || '';
          if (message.includes('viewport')) {
            return true;
          }
          return false;
        }
      ];
    }

    // Handle ESM modules with proper extension priority
    config.resolve.extensionAlias = {
      ".js": [".js", ".ts", ".tsx", ".jsx"],
      ".mjs": [".mjs", ".mts"],
      ".cjs": [".cjs", ".cts"]
    };

    config.resolve.mainFields = ['module', 'main'];

    // Fix for canvas and other node-specific modules
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
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, POST, PUT, DELETE, OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Authorization, X-Request-ID",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; script-src 'none'; style-src 'none'; frame-ancestors 'none';",
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
