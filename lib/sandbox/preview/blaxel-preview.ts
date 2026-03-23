/**
 * Blaxel Preview Integration
 * 
 * Provides preview URL management for Blaxel boxes and services.
 * Blaxel provides ultra-fast box startup (<25ms resume) and automatic service exposure.
 * 
 * @see https://docs.blaxel.ai/
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('Preview:Blaxel');

// ============================================================================
// Types
// ============================================================================

export interface BlaxelPreviewConfig {
  /** Box ID */
  boxId: string;
  /** Port to expose (default: 3000) */
  port?: number;
  /** API key */
  apiKey: string;
  /** Blaxel API base URL */
  baseUrl?: string;
}

export interface BlaxelPreviewResult {
  /** Public service URL */
  url: string;
  /** Port number */
  port: number;
  /** Service ID */
  serviceId?: string;
  /** Box name */
  boxName?: string;
}

export interface BlaxelServiceConfig {
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
  /** Auto-stop mode: 'suspend' | 'stop' | undefined */
  autoStop?: 'suspend' | 'stop';
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_BASE_URL = 'https://api.blaxel.ai';

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
    'gradio': 7860,
    
    'vanilla': 3000,
  };

  return portMap[framework] || 3000;
}

// ============================================================================
// Preview URL Helpers
// ============================================================================

/**
 * Get service URL for Blaxel box
 * 
 * Blaxel services provide URLs in the format:
 * https://{serviceId}.{region}.blaxel.app
 */
export async function getServicePreviewUrl(
  config: BlaxelPreviewConfig & { serviceId: string }
): Promise<BlaxelPreviewResult> {
  const { boxId, serviceId, port = 3000, apiKey, baseUrl = DEFAULT_BASE_URL } = config;

  if (!apiKey) {
    throw new Error('Blaxel API key is required');
  }

  try {
    // Get service info
    const serviceInfo = await getServiceInfo(boxId, serviceId, apiKey, baseUrl);

    if (!serviceInfo?.url) {
      throw new Error('Service URL not available');
    }

    logger.info(`Blaxel service URL: ${serviceInfo.url}`, {
      boxId,
      serviceId,
      port,
    });

    return {
      url: serviceInfo.url,
      port,
      serviceId,
      boxName: serviceInfo.boxName,
    };
  } catch (error: any) {
    logger.error(`Failed to get Blaxel service URL: ${error.message}`);
    throw error;
  }
}

/**
 * Get service info from Blaxel API
 */
async function getServiceInfo(
  boxId: string,
  serviceId: string,
  apiKey: string,
  baseUrl: string
): Promise<{ url?: string; boxName?: string } | null> {
  try {
    const response = await fetch(
      `${baseUrl}/boxes/${boxId}/services/${serviceId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      logger.debug(`Failed to get service info: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return {
      url: data.url,
      boxName: data.box?.name,
    };
  } catch (error) {
    logger.debug(`getServiceInfo failed: ${error}`);
    return null;
  }
}

/**
 * Create and start a service in Blaxel box
 * 
 * This creates a long-running service with automatic port exposure.
 */
export async function createBlaxelService(
  config: BlaxelPreviewConfig & BlaxelServiceConfig
): Promise<BlaxelPreviewResult> {
  const {
    boxId,
    port = 3000,
    name,
    command,
    cwd,
    env,
    public: isPublic = true,
    autoStop,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
  } = config;

  if (!apiKey) {
    throw new Error('Blaxel API key is required');
  }

  try {
    logger.info(`Creating Blaxel service: ${name} on port ${port}`, {
      boxId,
      command,
      public: isPublic,
    });

    // Create the service
    const response = await fetch(
      `${baseUrl}/boxes/${boxId}/services`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          command,
          port,
          cwd: cwd || '/workspace',
          env: env || {},
          public: isPublic,
          autoStop,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create service: ${response.status} ${errorText}`);
    }

    const serviceInfo = await response.json();
    logger.info(`Service created: ${serviceInfo.id}`);

    // Wait for service to be ready
    await waitForService(boxId, serviceInfo.id, apiKey, baseUrl);

    // Get preview URL
    return await getServicePreviewUrl({
      boxId,
      serviceId: serviceInfo.id,
      port,
      apiKey,
      baseUrl,
    });
  } catch (error: any) {
    logger.error(`Failed to create Blaxel service: ${error.message}`);
    throw error;
  }
}

/**
 * Execute a batch job in Blaxel box
 * 
 * For one-time tasks that don't need a long-running service.
 */
export async function executeBlaxelBatchJob(
  config: {
    boxId: string;
    tasks: Array<{
      command: string;
      cwd?: string;
      env?: Record<string, string>;
    }>;
    apiKey: string;
    baseUrl?: string;
  }
): Promise<{ jobId: string; status: string }> {
  const { boxId, tasks, apiKey, baseUrl = DEFAULT_BASE_URL } = config;

  if (!apiKey) {
    throw new Error('Blaxel API key is required');
  }

  try {
    logger.info(`Executing batch job with ${tasks.length} tasks`);

    const response = await fetch(
      `${baseUrl}/boxes/${boxId}/jobs/batch`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tasks }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to execute batch job: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    logger.info(`Batch job created: ${result.jobId}`);

    return {
      jobId: result.jobId,
      status: result.status,
    };
  } catch (error: any) {
    logger.error(`Failed to execute batch job: ${error.message}`);
    throw error;
  }
}

/**
 * Execute async task with callback verification
 * 
 * For long-running tasks that need completion verification.
 */
export async function executeBlaxelAsync(
  config: {
    boxId: string;
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    callbackSecret?: string;
    apiKey: string;
    baseUrl?: string;
  }
): Promise<{ taskId: string; verified: boolean }> {
  const { boxId, command, cwd, env, callbackSecret, apiKey, baseUrl = DEFAULT_BASE_URL } = config;

  if (!apiKey) {
    throw new Error('Blaxel API key is required');
  }

  try {
    logger.info(`Executing async task: ${command}`);

    const response = await fetch(
      `${baseUrl}/boxes/${boxId}/exec/async`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command,
          cwd: cwd || '/workspace',
          env: env || {},
          callbackSecret,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to execute async task: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    logger.info(`Async task created: ${result.taskId}`);

    return {
      taskId: result.taskId,
      verified: result.verified || false,
    };
  } catch (error: any) {
    logger.error(`Failed to execute async task: ${error.message}`);
    throw error;
  }
}

/**
 * Wait for service to be ready
 */
async function waitForService(
  boxId: string,
  serviceId: string,
  apiKey: string,
  baseUrl: string,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 500
): Promise<void> {
  const startTime = Date.now();
  const maxAttempts = Math.floor(timeoutMs / pollIntervalMs);

  logger.debug(`Waiting for service ${serviceId} to be ready`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const serviceInfo = await getServiceInfo(boxId, serviceId, apiKey, baseUrl);

      if (serviceInfo?.url) {
        // Try to access the URL with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), Math.min(pollIntervalMs, 5000));
        try {
          const response = await fetch(serviceInfo.url, {
            method: 'HEAD',
            signal: controller.signal,
          });
          if (response.ok || response.status === 404) {
            // 404 is OK - means server is running but route doesn't exist
            logger.info(`Service ${serviceId} is ready`);
            return;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      }
    } catch (error) {
      logger.debug(`Service check attempt ${attempt} failed: ${error}`);
    }

    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }

  throw new Error(`Service ${serviceId} did not become ready within ${timeoutMs}ms`);
}

/**
 * List services in Blaxel box
 */
export async function listBlaxelServices(
  config: {
    boxId: string;
    apiKey: string;
    baseUrl?: string;
  }
): Promise<Array<{ id: string; name: string; port: number; url?: string; status: string }>> {
  const { boxId, apiKey, baseUrl = DEFAULT_BASE_URL } = config;

  if (!apiKey) {
    throw new Error('Blaxel API key is required');
  }

  try {
    const response = await fetch(
      `${baseUrl}/boxes/${boxId}/services`,
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
      id: s.id,
      name: s.name,
      port: s.port,
      url: s.url,
      status: s.status,
    }));
  } catch (error) {
    logger.error(`Failed to list services: ${error}`);
    return [];
  }
}

/**
 * Stop a service in Blaxel box
 */
export async function stopBlaxelService(
  config: {
    boxId: string;
    serviceId: string;
    apiKey: string;
    baseUrl?: string;
  }
): Promise<void> {
  const { boxId, serviceId, apiKey, baseUrl = DEFAULT_BASE_URL } = config;

  if (!apiKey) {
    throw new Error('Blaxel API key is required');
  }

  try {
    logger.info(`Stopping Blaxel service: ${serviceId}`);

    const response = await fetch(
      `${baseUrl}/boxes/${boxId}/services/${serviceId}`,
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

    logger.info(`Service ${serviceId} stopped`);
  } catch (error: any) {
    logger.error(`Failed to stop service: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// Framework Service Configs
// ============================================================================

/**
 * Get service configuration for common frameworks
 */
export function getFrameworkServiceConfig(
  framework: string
): Omit<BlaxelServiceConfig, 'port'> & { port: number } | null {
  const configs: Record<string, BlaxelServiceConfig> = {
    'react': {
      name: 'react-dev',
      command: 'npm run dev -- --host 0.0.0.0',
      port: 3000,
      public: true,
    },
    'vue': {
      name: 'vue-dev',
      command: 'npm run dev -- --host 0.0.0.0',
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
      command: 'npm run dev -- --host 0.0.0.0',
      port: 5173,
      public: true,
    },
    'vite-react': {
      name: 'vite-dev',
      command: 'npm run dev -- --host 0.0.0.0',
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

export const blaxelPreview = {
  getServicePreviewUrl,
  createBlaxelService,
  executeBlaxelBatchJob,
  executeBlaxelAsync,
  listBlaxelServices,
  stopBlaxelService,
  getDefaultPort,
  getFrameworkServiceConfig,
};

export default blaxelPreview;
