/**
 * n8n Client Library
 *
 * TypeScript client for n8n workflow automation API
 * @see https://n8n.io/api/
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('n8n:Client');

export interface n8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  triggerCount?: number;
  lastExecuted?: number;
}

export interface n8nExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'error' | 'running' | 'waiting' | 'canceled';
  startTime: number;
  endTime?: number;
  duration?: number;
  trigger: 'manual' | 'webhook' | 'schedule' | 'api';
  retryCount?: number;
  errorMessage?: string;
}

export interface n8nExecutionResult {
  data: any;
  outputData: any;
  executionTime: number;
}

export interface n8nConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

export class n8nClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(config: n8nConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000;
  }

  /**
   * Make authenticated request to n8n API
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.apiKey) {
      headers['X-N8N-API-KEY'] = this.apiKey;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        logger.error('n8n API error:', { status: response.status, error });
        throw new Error(`n8n API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('n8n request timeout');
      }
      logger.error('n8n request failed:', error);
      throw error;
    }
  }

  /**
   * List all workflows
   */
  async getWorkflows(): Promise<n8nWorkflow[]> {
    return this.request<n8nWorkflow[]>('/workflows');
  }

  /**
   * Get workflow by ID
   */
  async getWorkflow(id: string): Promise<n8nWorkflow> {
    return this.request<n8nWorkflow>(`/workflows/${id}`);
  }

  /**
   * Execute workflow manually
   */
  async executeWorkflow(
    workflowId: string,
    data?: Record<string, any>
  ): Promise<n8nExecution> {
    return this.request<n8nExecution>(`/workflows/${workflowId}/run`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
  }

  /**
   * Get workflow executions
   */
  async getExecutions(
    workflowId?: string,
    limit = 20,
    status?: n8nExecution['status']
  ): Promise<n8nExecution[]> {
    const params = new URLSearchParams();
    params.set('limit', limit.toString());
    
    if (workflowId) params.set('workflowId', workflowId);
    if (status) params.set('status', status);

    return this.request<n8nExecution[]>(`/executions?${params.toString()}`);
  }

  /**
   * Get execution details
   */
  async getExecution(id: string): Promise<n8nExecution & { data: any }> {
    return this.request(`/executions/${id}`);
  }

  /**
   * Delete execution
   */
  async deleteExecution(id: string): Promise<void> {
    await this.request(`/executions/${id}`, { method: 'DELETE' });
  }

  /**
   * Get execution statistics
   */
  async getStats(): Promise<{
    total: number;
    success: number;
    error: number;
    running: number;
    avgDuration: number;
  }> {
    return this.request('/executions/stats');
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getWorkflows();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create n8n client from environment variables
 */
export function createN8nClient(): n8nClient | null {
  const baseUrl = process.env.NEXT_PUBLIC_N8N_URL;
  const apiKey = process.env.N8N_API_KEY;

  if (!baseUrl) {
    logger.warn('n8n not configured: NEXT_PUBLIC_N8N_URL not set');
    return null;
  }

  return new n8nClient({
    baseUrl,
    apiKey,
    timeout: parseInt(process.env.N8N_TIMEOUT || '30000'),
  });
}

// Singleton instance
let n8nClientInstance: n8nClient | null = null;

/**
 * Get or create n8n client singleton
 */
export function getN8nClient(): n8nClient | null {
  if (!n8nClientInstance) {
    n8nClientInstance = createN8nClient();
  }
  return n8nClientInstance;
}
