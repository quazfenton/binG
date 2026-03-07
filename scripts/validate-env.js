/**
 * Environment Variable Validation Script
 *
 * Validates that all required environment variables are set and properly formatted.
 * Run this script before starting the application to catch configuration issues early.
 *
 * Usage: node scripts/validate-env.js
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const ENV_FILE = path.join(__dirname, '..', '.env');
const ENV_EXAMPLE_FILE = path.join(__dirname, '..', 'env.example');

// Required environment variables for production
const REQUIRED_VARS = {
  // Authentication
  JWT_SECRET: {
    required: true,
    validate: (value) => {
      if (!value || value.length < 32) {
        return 'Must be at least 32 characters for security';
      }
      if (value === 'your-secret-key-change-in-production') {
        return 'Must be changed from default value';
      }
      return null;
    },
  },
  ENCRYPTION_KEY: {
    required: true,
    validate: (value) => {
      if (!value || value.length !== 64) {
        return 'Must be exactly 64 characters (32 bytes hex-encoded)';
      }
      if (!/^[a-f0-9]{64}$/i.test(value)) {
        return 'Must be a valid hex string';
      }
      if (value.includes('your-64-char')) {
        return 'Must be changed from placeholder value';
      }
      return null;
    },
  },
  SESSION_HASH_SECRET: {
    required: true,
    validate: (value) => {
      if (!value || value.length < 32) {
        return 'Must be at least 32 characters';
      }
      if (value.includes('your_SESSION_HASH_SECRET')) {
        return 'Must be changed from placeholder value';
      }
      return null;
    },
  },

  // Database
  DATABASE_URL: {
    required: false, // SQLite doesn't need this
    validate: (value) => {
      if (value && value.includes('your_secure_db_password')) {
        return 'Must be changed from placeholder value';
      }
      return null;
    },
  },
  DATABASE_PATH: {
    required: false,
    validate: (value) => {
      if (!value) return null;
      if (value.startsWith('/tmp/') || value.startsWith('C:\\\\temp\\\\')) {
        return 'Should not use temp directory for production database';
      }
      return null;
    },
  },

  // MinIO/S3 Storage
  MINIO_ROOT_USER: {
    required: false,
    validate: (value) => {
      if (value === 'minioadmin') {
        return 'Must be changed from default "minioadmin" value';
      }
      return null;
    },
  },
  MINIO_ROOT_PASSWORD: {
    required: false,
    validate: (value) => {
      if (value === 'minioadmin') {
        return 'Must be changed from default "minioadmin" value';
      }
      return null;
    },
  },
  MINIO_ENDPOINT: { required: false },
  MINIO_ACCESS_KEY: { required: false },
  MINIO_SECRET_KEY: { required: false },

  // LLM Providers (at least one required)
  OPENAI_API_KEY: { required: false },
  ANTHROPIC_API_KEY: { required: false },
  GEMINI_API_KEY: { required: false },
  MISTRAL_API_KEY: { required: false },
  OPENROUTER_API_KEY: { required: false },
  OPENCODE_API_KEY: { required: false },

  // Sandbox Providers (at least one required)
  DAYTONA_API_KEY: { required: false },
  E2B_API_KEY: { required: false },
  BLAXEL_API_KEY: { required: false },
  CSB_API_KEY: { required: false },
  SPRITES_TOKEN: { required: false },
  RUNLOOP_API_KEY: { required: false },
  MICROSANDBOX_DAEMON_URL: { required: false },

  // Email Providers (at least one required for production)
  BREVO_API_KEY: { required: false },
  MAILERSEND_API_KEY: { required: false },
  SMTP_HOST: { required: false },
  SMTP_USER: { required: false },
  SMTP_PASS: { required: false },

  // MCP Integration
  MCP_AUTH_TOKEN: {
    required: false,
    validate: (value) => {
      if (value && value.includes('your-mcp-auth-token')) {
        return 'Must be changed from placeholder value';
      }
      return null;
    },
  },

  // Blaxel Callback Secret (required if using Blaxel async)
  BLAXEL_CALLBACK_SECRET: {
    required: false,
    validate: (value) => {
      if (value && value.includes('your-64-char')) {
        return 'Must be changed from placeholder value';
      }
      return null;
    },
  },

  // Visual Editor Security
  VISUAL_EDITOR_SECRET: {
    required: false,
    validate: (value) => {
      if (value && value.includes('your_vis_editor_secret')) {
        return 'Must be changed from placeholder value';
      }
      return null;
    },
  },

  // Redis (for checkpointing)
  REDIS_URL: { required: false },

  // Livekit (for voice features)
  LIVEKIT_API_KEY: { required: false },
  LIVEKIT_API_SECRET: { required: false },
  LIVEKIT_URL: { required: false },

  // Tambo (for generative UI)
  TAMBO_API_KEY: { required: false },

  // Arcade (for tool integration)
  ARCADE_API_KEY: { required: false },

  // Nango (for unified API)
  NANGO_SECRET_KEY: { required: false },

  // Composio (for tool integration)
  COMPOSIO_API_KEY: { required: false },

  // Smithery (for MCP marketplace)
  SMITHERY_API_KEY: { required: false },
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const env = {};

  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });

  return env;
}

function validateEnvVars(env) {
  const errors = [];
  const warnings = [];
  const info = [];

  // Validate required variables
  for (const [varName, config] of Object.entries(REQUIRED_VARS)) {
    const value = env[varName];

    if (config.required && !value) {
      errors.push(`${varName} is required but not set`);
      continue;
    }

    if (value && config.validate) {
      const error = config.validate(value);
      if (error) {
        errors.push(`${varName}: ${error}`);
      }
    }
  }

  // Check that at least one LLM provider is configured
  const llmProviders = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY', 'OPENCODE_API_KEY'];
  const hasLlmProvider = llmProviders.some((key) => env[key] && !env[key].includes('your_'));
  if (!hasLlmProvider) {
    warnings.push('No LLM provider API key configured. AI features will not work.');
  }

  // Check that at least one sandbox provider is configured
  const sandboxProviders = ['DAYTONA_API_KEY', 'E2B_API_KEY', 'BLAXEL_API_KEY', 'CSB_API_KEY', 'SPRITES_TOKEN', 'RUNLOOP_API_KEY'];
  const hasSandboxProvider = sandboxProviders.some((key) => env[key] && !env[key].includes('your_'));
  if (!hasSandboxProvider) {
    warnings.push('No sandbox provider API key configured. Sandbox features will not work.');
  }

  // Check that at least one email provider is configured (for production)
  const emailProviders = ['BREVO_API_KEY', 'MAILERSEND_API_KEY', 'SMTP_HOST'];
  const hasEmailProvider = emailProviders.some((key) => env[key] && !env[key].includes('your_'));
  if (process.env.NODE_ENV === 'production' && !hasEmailProvider) {
    warnings.push('No email provider configured. Email features (verification, password reset) will not work.');
  }

  // Check for insecure default values
  const insecureDefaults = {
    MINIO_ROOT_PASSWORD: 'minioadmin',
    MINIO_ROOT_USER: 'minioadmin',
    JWT_SECRET: ['your-secret-key-change-in-production', 'your-32-char-secret-key-here-change-this', 'dev-secret-key-change-in-production'],
    DATABASE_URL: 'your_secure_db_password',
    ENCRYPTION_KEY: 'your-64-char',
    POSTGRES_PASSWORD: 'your_secure_db_password_change_me',
  };

  for (const [varName, insecureValue] of Object.entries(insecureDefaults)) {
    const value = env[varName];
    if (value) {
      const matches = Array.isArray(insecureValue) 
        ? insecureValue.some(v => value.includes(v))
        : value.includes(insecureValue);
      if (matches) {
        errors.push(`${varName} is set to an insecure default/placeholder value. Please change it.`);
      }
    }
  }

  // Check for exposed secrets patterns (warning only)
  const secretPatterns = {
    OPENAI_API_KEY: { pattern: /^sk-/, message: 'OpenAI-style API key detected' },
    GITHUB_TOKEN: { pattern: /^gh[ps]_/, message: 'GitHub token detected' },
    AWS_ACCESS_KEY: { pattern: /^AKIA/, message: 'AWS access key detected' },
    ANTHROPIC_API_KEY: { pattern: /^sk-ant-/, message: 'Anthropic API key detected' },
  };

  for (const [varName, { pattern, message }] of Object.entries(secretPatterns)) {
    const value = env[varName];
    if (value && pattern.test(value)) {
      info.push(`${varName} ${message}. Ensure this file is not committed to version control.`);
    }
  }

  // Check NODE_ENV for production without proper secrets
  if (process.env.NODE_ENV === 'production') {
    const criticalSecrets = ['JWT_SECRET', 'ENCRYPTION_KEY', 'SESSION_HASH_SECRET'];
    const missingSecrets = criticalSecrets.filter(key => !env[key] || env[key].includes('your_'));
    if (missingSecrets.length > 0) {
      errors.push(`Production environment missing critical secrets: ${missingSecrets.join(', ')}`);
    }
  }

  // Check for proper database configuration
  if (env.DATABASE_URL && env.DATABASE_URL.includes('localhost') && process.env.NODE_ENV === 'production') {
    warnings.push('DATABASE_URL points to localhost. This is not suitable for production.');
  }

  // Check WebSocket port configuration
  if (env.WEBSOCKET_PORT === '3000') {
    errors.push('WEBSOCKET_PORT cannot be the same as Next.js HTTP port (3000). Use a different port (e.g., 8080).');
  }

  return { errors, warnings, info };
}

function checkGitIgnore() {
  const gitignorePath = path.join(__dirname, '..', '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return { valid: false, message: '.gitignore file not found' };
  }

  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
  const hasEnvIgnored = gitignoreContent.includes('.env') || gitignoreContent.includes('*.env');

  if (!hasEnvIgnored) {
    return { valid: false, message: '.env is not in .gitignore - this is a security risk!' };
  }

  return { valid: true, message: '.env is properly ignored by git' };
}

function checkEnvFileExists() {
  if (!fs.existsSync(ENV_FILE)) {
    return {
      exists: false,
      message: '.env file not found. Copy env.example to .env and configure your variables.',
    };
  }

  return { exists: true, message: '.env file found' };
}

function generateSecureSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

function main() {
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║     Environment Variable Validation                    ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════════╝${colors.reset}\n`);

  // Check if .env exists
  const envCheck = checkEnvFileExists();
  console.log(`${colors.blue}ℹ${colors.reset} ${envCheck.message}\n`);

  if (!envCheck.exists) {
    console.log(`${colors.yellow}⚠ To create a .env file, run:${colors.reset}`);
    console.log(`   cp env.example .env\n`);
    console.log(`${colors.yellow}⚠ Then generate secure secrets:${colors.reset}`);
    console.log(`   JWT_SECRET: ${generateSecureSecret()}`);
    console.log(`   ENCRYPTION_KEY: ${generateEncryptionKey()}\n`);
    process.exit(1);
  }

  // Check .gitignore
  const gitignoreCheck = checkGitIgnore();
  if (gitignoreCheck.valid) {
    console.log(`${colors.green}✓${colors.reset} ${gitignoreCheck.message}\n`);
  } else {
    console.log(`${colors.red}✗${colors.reset} ${gitignoreCheck.message}\n`);
  }

  // Load and validate environment
  const env = loadEnvFile(ENV_FILE);
  if (!env) {
    console.log(`${colors.red}✗${colors.reset} Failed to load .env file\n`);
    process.exit(1);
  }

  const { errors, warnings, info } = validateEnvVars(env);

  // Display results
  if (errors.length > 0) {
    console.log(`${colors.red}╔════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.red}║  ERRORS - These must be fixed before running          ║${colors.reset}`);
    console.log(`${colors.red}╚════════════════════════════════════════════════════════╝${colors.reset}`);
    errors.forEach((error) => console.log(`${colors.red}✗${colors.reset} ${error}`));
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`${colors.yellow}╔════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.yellow}║  WARNINGS - Recommended to fix                        ║${colors.reset}`);
    console.log(`${colors.yellow}╚════════════════════════════════════════════════════════╝${colors.reset}`);
    warnings.forEach((warning) => console.log(`${colors.yellow}⚠${colors.reset} ${warning}`));
    console.log('');
  }

  if (info.length > 0) {
    console.log(`${colors.blue}╔════════════════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.blue}║  INFO                                                 ║${colors.reset}`);
    console.log(`${colors.blue}╚════════════════════════════════════════════════════════╝${colors.reset}`);
    info.forEach((item) => console.log(`${colors.blue}ℹ${colors.reset} ${item}`));
    console.log('');
  }

  // Exit with error code if there are critical errors
  if (errors.length > 0 || !gitignoreCheck.valid) {
    console.log(`${colors.red}\n✗ Validation failed. Please fix the errors above before running the application.${colors.reset}\n`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(`${colors.yellow}\n⚠ Validation completed with warnings. The application may run but some features will be limited.${colors.reset}\n`);
    process.exit(0);
  }

  console.log(`${colors.green}✓ All environment variables are properly configured!\n${colors.reset}`);
  process.exit(0);
}

main();
