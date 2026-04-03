/**
 * Daytona Preview Integration
 * 
 * Provides preview URL management for Daytona workspaces.
 * Daytona automatically exposes ports and provides public URLs.
 * 
 * @see https://docs.daytona.io/
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('Preview:Daytona');

// ============================================================================
// Types
// ============================================================================

export interface DaytonaPreviewConfig {
  /** Workspace ID */
  workspaceId: string;
  /** Port to expose (default: 3000) */
  port?: number;
  /** API key */
  apiKey: string;
  /** Daytona API base URL */
  baseUrl?: string;
}

export interface DaytonaPreviewResult {
  /** Public preview URL */
  url: string;
  /** Port number */
  port: number;
  /** Workspace name */
  workspaceName?: string;
  /** Provider type */
  provider?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BASE_URL = 'https://api.daytona.io';

/**
 * Default ports for common frameworks
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
    'vite': 5173,
    'vite-react': 5173,
    'astro': 4321,
    
    'flask': 5000,
    'fastapi': 8000,
    'django': 8000,
    'streamlit': 8501,
    
    'vanilla': 3000,
  };

  return portMap[framework] || 3000;
}

// ============================================================================
// Preview URL Helpers
// ============================================================================

/**
 * Get preview URL for Daytona workspace
 * 
 * Daytona provides preview URLs in the format:
 * https://{workspaceId}-{port}.{provider}.daytona.app
 */
export async function getWorkspacePreviewUrl(
  config: DaytonaPreviewConfig
): Promise<DaytonaPreviewResult> {
  const { workspaceId, port = 3000, apiKey, baseUrl = DEFAULT_BASE_URL } = config;

  if (!apiKey) {
    throw new Error('Daytona API key is required');
  }

  try {
    // Get workspace info to determine provider
    const workspaceInfo = await getWorkspaceInfo(workspaceId, apiKey, baseUrl);
    const provider = workspaceInfo?.provider || 'default';

    // Construct preview URL
    // Format: https://{workspaceId}-{port}.{provider}.daytona.app
    const previewUrl = `https://${workspaceId}-${port}.${provider}.daytona.app/`;

    logger.info(`Daytona preview URL: ${previewUrl}`, {
      workspaceId,
      port,
      provider,
    });

    return {
      url: previewUrl,
      port,
      workspaceName: workspaceInfo?.name,
      provider,
    };
  } catch (error: any) {
    logger.error(`Failed to get Daytona preview URL: ${error.message}`);
    throw error;
  }
}

/**
 * Get workspace info from Daytona API
 */
async function getWorkspaceInfo(
  workspaceId: string,
  apiKey: string,
  baseUrl: string
): Promise<{ name?: string; provider?: string } | null> {
  try {
    const response = await fetch(`${baseUrl}/workspaces/${workspaceId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.debug(`Failed to get workspace info: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return {
      name: data.name,
      provider: data.provider?.name || 'default',
    };
  } catch (error) {
    logger.debug(`getWorkspaceInfo failed: ${error}`);
    return null;
  }
}

/**
 * Start a service in Daytona workspace
 * 
 * This starts a long-running process (like a dev server) and exposes a port.
 */
export async function startDaytonaService(
  config: DaytonaPreviewConfig & {
    /** Service name */
    serviceName: string;
    /** Command to run */
    command: string;
    /** Working directory */
    cwd?: string;
    /** Environment variables */
    env?: Record<string, string>;
  }
): Promise<DaytonaPreviewResult> {
  const {
    workspaceId,
    port = 3000,
    serviceName,
    command,
    cwd,
    env,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
  } = config;

  if (!apiKey) {
    throw new Error('Daytona API key is required');
  }

  try {
    logger.info(`Starting Daytona service: ${serviceName} on port ${port}`);

    // Start the service
    const response = await fetch(
      `${baseUrl}/workspaces/${workspaceId}/services`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: serviceName,
          command,
          port,
          cwd: cwd || '/workspace',
          env,
          public: true, // Make service publicly accessible
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to start service: ${response.status} ${errorText}`);
    }

    const serviceInfo = await response.json();
    logger.info(`Service started: ${serviceInfo.name}`);

    // Wait for service to be ready
    await waitForService(workspaceId, serviceName, apiKey, baseUrl);

    // Get preview URL
    return await getWorkspacePreviewUrl({ workspaceId, port, apiKey, baseUrl });
  } catch (error: any) {
    logger.error(`Failed to start Daytona service: ${error.message}`);
    throw error;
  }
}

/**
 * Wait for service to be ready
 */
async function waitForService(
  workspaceId: string,
  serviceName: string,
  apiKey: string,
  baseUrl: string,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 1000
): Promise<void> {
  const startTime = Date.now();
  const maxAttempts = Math.floor(timeoutMs / pollIntervalMs);

  logger.debug(`Waiting for service ${serviceName} to be ready`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(
        `${baseUrl}/workspaces/${workspaceId}/services/${serviceName}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        }
      );

      if (response.ok) {
        const serviceInfo = await response.json();
        if (serviceInfo.status === 'running') {
          logger.info(`Service ${serviceName} is ready`);
          return;
        }
      }
    } catch (error) {
      logger.debug(`Service check attempt ${attempt} failed: ${error}`);
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  throw new Error(`Service ${serviceName} did not become ready within ${timeoutMs}ms`);
}

/**
 * Stop a service in Daytona workspace
 */
export async function stopDaytonaService(
  config: {
    workspaceId: string;
    serviceName: string;
    apiKey: string;
    baseUrl?: string;
  }
): Promise<void> {
  const { workspaceId, serviceName, apiKey, baseUrl = DEFAULT_BASE_URL } = config;

  try {
    logger.info(`Stopping Daytona service: ${serviceName}`);

    const response = await fetch(
      `${baseUrl}/workspaces/${workspaceId}/services/${serviceName}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to stop service: ${response.status}`);
    }

    logger.info(`Service ${serviceName} stopped`);
  } catch (error: any) {
    logger.error(`Failed to stop service: ${error.message}`);
    throw error;
  }
}

/**
 * List services in Daytona workspace
 */
export async function listDaytonaServices(
  config: {
    workspaceId: string;
    apiKey: string;
    baseUrl?: string;
  }
): Promise<Array<{ name: string; port: number; url?: string }>> {
  const { workspaceId, apiKey, baseUrl = DEFAULT_BASE_URL } = config;

  try {
    const response = await fetch(
      `${baseUrl}/workspaces/${workspaceId}/services`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      return [];
    }

    const services = await response.json();
    return services.map((s: any) => ({
      name: s.name,
      port: s.port,
      url: s.url,
    }));
  } catch (error) {
    logger.error(`Failed to list services: ${error}`);
    return [];
  }
}

// ============================================================================
// Exports
// ============================================================================

export const daytonaPreview = {
  getWorkspacePreviewUrl,
  startDaytonaService,
  stopDaytonaService,
  listDaytonaServices,
  getDefaultPort,
};

export default daytonaPreview;
