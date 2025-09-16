/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Performance optimizations
  compress: true,
  poweredByHeader: false,
  generateEtags: true,
  // Bundle optimization
  experimental: {
    optimizeCss: true,
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'date-fns',
      'lodash'
    ],
    turbo: {
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },
  },
  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  // Output optimization
  output: 'standalone',
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
    // Performance optimizations for production
    if (!dev) {
      // Enable tree shaking
      config.optimization.usedExports = true;
      config.optimization.sideEffects = false;
      
      // Optimize chunks
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        chunks: 'all',
        cacheGroups: {
          ...config.optimization.splitChunks.cacheGroups,
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            priority: 10,
          },
          common: {
            name: 'common',
            minChunks: 2,
            chunks: 'all',
            priority: 5,
            reuseExistingChunk: true,
          },
          performance: {
            test: /[\\/]lib[\\/]performance[\\/]/,
            name: 'performance',
            chunks: 'all',
            priority: 15,
          },
        },
      };
    }

    // Handle ESM modules
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };

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
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
        buffer: false,
        util: false,
        events: false,
      };
      
      // Handle node: protocol imports by mapping them to false (exclude from bundle)
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
        ],
      },
    ];
  },
};

export default nextConfig;
