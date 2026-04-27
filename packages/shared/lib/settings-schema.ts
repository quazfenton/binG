/**
 * Unified Local Settings Schema
 * 
 * Shared settings format used by both CLI and Desktop (headless) modes.
 * This ensures consistent storage mechanism across platforms.
 * 
 * Storage locations:
 * - CLI: ~/.quaz/settings.json
 * - Desktop: OS app-data directory/settings.json
 * 
 * Schema version: 1.0.0
 */

/**
 * Provider API keys stored securely (BYOK - Bring Your Own Keys)
 */
export interface ProviderKeys {
  openai?: string;
  anthropic?: string;
  google?: string;
  mistral?: string;
  github?: string;
  cohere?: string;
  huggingface?: string;
  replicate?: string;
  // Extensible for additional providers
  [provider: string]: string | undefined;
}

/**
 * Authentication state for server/API communication
 */
export interface AuthState {
  token?: string | null;
  userId?: string | null;
  email?: string | null;
  expiresAt?: number | null;
}

/**
 * LLM Provider configuration
 */
export interface LLMProviderConfig {
  id: string;
  name: string;
  isDefault?: boolean;
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  root: string;
  lastOpened?: string;
}

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  provider: string;
  currentSandboxId?: string;
}

/**
 * UI/Display preferences
 */
export interface DisplayConfig {
  theme?: 'light' | 'dark' | 'auto';
  streamOutput?: boolean;
  verboseLogging?: boolean;
}

/**
 * Main unified settings interface
 */
export interface UnifiedSettings {
  version: string;
  workspace: WorkspaceConfig;
  auth: AuthState;
  llm: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  sandbox: SandboxConfig;
  display: DisplayConfig;
  // Metadata
  createdAt?: number;
  updatedAt?: number;
}

/**
 * Default settings factory
 */
export function createDefaultSettings(workspaceRoot?: string): UnifiedSettings {
  return {
    version: '1.0.0',
    workspace: {
      root: workspaceRoot || process.cwd(),
      lastOpened: new Date().toISOString(),
    },
    auth: {
      token: null,
      userId: null,
      email: null,
      expiresAt: null,
    },
    llm: {
      provider: process.env.DEFAULT_LLM_PROVIDER || 'anthropic',
      model: process.env.DEFAULT_MODEL || 'claude-3-5-sonnet-latest',
      temperature: parseFloat(process.env.DEFAULT_TEMPERATURE || '0.7'),
      maxTokens: parseInt(process.env.DEFAULT_MAX_TOKENS || '80000', 10),
    },
    sandbox: {
      provider: process.env.SANDBOX_PROVIDER || 'daytona',
      currentSandboxId: undefined,
    },
    display: {
      theme: 'auto',
      streamOutput: true,
      verboseLogging: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Schema version constant
 */
export const CURRENT_SETTINGS_VERSION = '1.0.0';

/**
 * Settings file name
 */
export const SETTINGS_FILENAME = 'settings.json';

/**
 * App data directory name
 */
export const APP_DATA_DIR = '.quaz';