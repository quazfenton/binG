/**
 * CodeSandbox Preview Integration
 * 
 * Provides preview URL management for CodeSandbox DevBox and regular sandboxes.
 * 
 * @see https://docs.codesandbox.io/
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('Preview:CodeSandbox');

// ============================================================================
// Types
// ============================================================================

export interface CodeSandboxPreviewConfig {
  /** Sandbox ID */
  sandboxId: string;
  /** Port to expose (default: 3000) */
  port?: number;
  /** API key */
  apiKey: string;
}

export interface CodeSandboxPreviewResult {
  /** Public preview URL */
  url: string;
  /** Port number */
  port: number;
  /** Branch name (if applicable) */
  branch?: string;
  /** Workspace ID */
  workspaceId?: string;
}

// ============================================================================
// CodeSandbox Template Mapping
// ============================================================================

/**
 * Map frameworks to CodeSandbox templates
 */
export function getCodeSandboxTemplate(framework: string): string {
  const templateMap: Record<string, string> = {
    // JavaScript/TypeScript
    'react': 'node',
    'react-ts': 'node',
    'vue': 'node',
    'vue-ts': 'node',
    'svelte': 'node',
    'svelte-ts': 'node',
    'angular': 'node',
    'next': 'node',
    'nextjs': 'node',
    'nuxt': 'node',
    'nuxtjs': 'node',
    'vite': 'node',
    'vite-react': 'node',
    'astro': 'node',
    'remix': 'node',
    'solid': 'node',
    'solidstart': 'node',
    
    // Python
    'python': 'python',
    'flask': 'python',
    'fastapi': 'python',
    'django': 'python',
    'streamlit': 'python',
    'gradio': 'python',
    
    // Other
    'vanilla': 'node',
    'static': 'static',
    'html': 'static',
  };

  return templateMap[framework] || 'node';
}

/**
 * Get default port for framework
 */
export function getDefaultPort(framework: string): number {
  const portMap: Record<string, number> = {
    'react': 3000,
    'vue': 8080,
    'svelte': 3000,
    'angular': 4200,
    'next': 3000,
    'nextjs': 3000,
    'nuxt': 3000,
    'nuxtjs': 3000,
    'vite': 5173,
    'vite-react': 5173,
    'astro': 4321,
    'remix': 3000,
    'solid': 3000,
    'solidstart': 3000,
    
    'flask': 5000,
    'fastapi': 8000,
    'django': 8000,
    'streamlit': 8501,
    'gradio': 7860,
    
    'vanilla': 3000,
    'static': 8080,
  };

  return portMap[framework] || 3000;
}

// ============================================================================
// Preview URL Helpers
// ============================================================================

/**
 * Get preview URL for CodeSandbox DevBox
 * 
 * DevBox automatically exposes common ports (3000, 8080, etc.)
 * and provides public URLs.
 */
export async function getDevBoxPreviewUrl(
  config: CodeSandboxPreviewConfig
): Promise<CodeSandboxPreviewResult> {
  const { sandboxId, port = 3000, apiKey } = config;

  if (!apiKey) {
    throw new Error('CodeSandbox API key is required');
  }

  try {
    // CodeSandbox DevBox provides URLs in the format:
    // https://{sandboxId}-{port}.csb.app/
    const previewUrl = `https://${sandboxId}-${port}.csb.app/`;

    logger.info(`DevBox preview URL: ${previewUrl}`);

    return {
      url: previewUrl,
      port,
      workspaceId: sandboxId,
    };
  } catch (error: any) {
    logger.error(`Failed to get DevBox preview URL: ${error.message}`);
    throw error;
  }
}

/**
 * Get preview URL for regular CodeSandbox
 * 
 * Regular sandboxes use a different URL format.
 */
export async function getSandboxPreviewUrl(
  config: CodeSandboxPreviewConfig
): Promise<CodeSandboxPreviewResult> {
  const { sandboxId, port = 3000, apiKey } = config;

  if (!apiKey) {
    throw new Error('CodeSandbox API key is required');
  }

  try {
    // Regular sandbox URL format:
    // https://{sandboxId}.csb.app/
    const previewUrl = `https://${sandboxId}.csb.app/`;

    logger.info(`Sandbox preview URL: ${previewUrl}`);

    return {
      url: previewUrl,
      port,
      workspaceId: sandboxId,
    };
  } catch (error: any) {
    logger.error(`Failed to get sandbox preview URL: ${error.message}`);
    throw error;
  }
}

/**
 * Check if preview URL is accessible
 */
export async function checkPreviewAccessibility(
  url: string,
  timeoutMs: number = 5000
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    logger.debug(`Preview accessibility check failed: ${error}`);
    return false;
  }
}

// ============================================================================
// DevBox Service Configuration
// ============================================================================

/**
 * Configure DevBox service for preview
 * 
 * This helps set up the service configuration for CodeSandbox API.
 */
export interface DevBoxServiceConfig {
  /** Service name */
  name: string;
  /** Command to run */
  command: string;
  /** Port to expose */
  port: number;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Whether service is public */
  public?: boolean;
}

/**
 * Create DevBox service configuration
 */
export function createDevBoxServiceConfig(
  config: DevBoxServiceConfig
): Record<string, any> {
  return {
    name: config.name,
    command: config.command,
    port: config.port,
    cwd: config.cwd || '/workspace',
    env: config.env || {},
    public: config.public !== false, // Default to public
  };
}

/**
 * Get common framework service configurations
 */
export function getFrameworkServiceConfig(
  framework: string
): DevBoxServiceConfig | null {
  const configs: Record<string, DevBoxServiceConfig> = {
    'react': {
      name: 'dev-server',
      command: 'npm run dev',
      port: 3000,
      public: true,
    },
    'vue': {
      name: 'dev-server',
      command: 'npm run dev',
      port: 8080,
      public: true,
    },
    'next': {
      name: 'next-dev',
      command: 'npm run dev',
      port: 3000,
      public: true,
    },
    'nextjs': {
      name: 'next-dev',
      command: 'npm run dev',
      port: 3000,
      public: true,
    },
    'nuxt': {
      name: 'nuxt-dev',
      command: 'npm run dev',
      port: 3000,
      public: true,
    },
    'vite': {
      name: 'vite-dev',
      command: 'npm run dev',
      port: 5173,
      public: true,
    },
    'vite-react': {
      name: 'vite-dev',
      command: 'npm run dev',
      port: 5173,
      public: true,
    },
    'flask': {
      name: 'flask-app',
      command: 'python app.py',
      port: 5000,
      public: true,
    },
    'fastapi': {
      name: 'fastapi-app',
      command: 'uvicorn main:app --host 0.0.0.0 --port 8000',
      port: 8000,
      public: true,
    },
  };

  return configs[framework] || null;
}

// ============================================================================
// Exports
// ============================================================================

export const codeSandboxPreview = {
  getDevBoxPreviewUrl,
  getSandboxPreviewUrl,
  checkPreviewAccessibility,
  getCodeSandboxTemplate,
  getDefaultPort,
  createDevBoxServiceConfig,
  getFrameworkServiceConfig,
};

export default codeSandboxPreview;
