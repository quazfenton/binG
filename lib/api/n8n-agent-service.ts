/**
 * n8n Agent Service - External agent chaining and workflow orchestration
 * Handles complex workflows, agent chaining, and external integrations via n8n
 */

export interface N8nAgentRequest {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  requestId?: string;
  capabilities?: {
    chaining?: boolean;
    external?: boolean;
    optimization?: boolean;
    classification?: boolean;
    iteration?: boolean;
  };
}

export interface N8nAgentResponse {
  success: boolean;
  content?: string;
  chainedAgents?: string[];
  iterations?: number;
  classifications?: Record<string, any>;
  optimizations?: Record<string, any>;
  error?: string;
  metadata?: Record<string, any>;
}

export interface N8nAgentConfig {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  timeout: number;
  healthCheckInterval: number;
  capabilities: {
    chaining: boolean;
    external: boolean;
    optimization: boolean;
    classification: boolean;
    iteration: boolean;
  };
}

class N8nAgentService {
  private config: N8nAgentConfig;
  private isHealthy: boolean = true;
  private lastHealthCheck: number = 0;

  constructor() {
    this.config = {
      enabled: process.env.N8N_ENABLED === 'true',
      endpoint: process.env.N8N_ENDPOINT || '',
      apiKey: process.env.N8N_API_KEY,
      timeout: parseInt(process.env.N8N_TIMEOUT || '60000'),
      healthCheckInterval: 30000, // 30 seconds
      capabilities: {
        chaining: process.env.N8N_CHAINING !== 'false',
        external: process.env.N8N_EXTERNAL !== 'false',
        optimization: process.env.N8N_OPTIMIZATION !== 'false',
        classification: process.env.N8N_CLASSIFICATION !== 'false',
        iteration: process.env.N8N_ITERATION !== 'false',
      }
    };
  }

  /**
   * Check if n8n should handle this request
   */
  shouldHandle(request: N8nAgentRequest): boolean {
    if (!this.config.enabled || !this.isHealthy) {
      return false;
    }

    const content = request.messages[request.messages.length - 1]?.content || '';
    
    // n8n handles complex workflows and agent chaining
    const patterns = {
      workflow: /\b(workflow|orchestrate|coordinate|automate)\b/i,
      chain: /\b(chain|sequence|pipeline|multi-step|multi-agent)\b/i,
      complex: /\b(comprehensive|detailed|thorough|in-depth)\b/i,
      external: /\b(search|fetch|api|external|integrate|data)\b/i,
      classification: /\b(classify|categorize|analyze|identify)\b/i,
      optimization: /\b(optimize|improve|enhance|refine)\b/i
    };
    
    // Count matches
    let matchCount = 0;
    Object.values(patterns).forEach(pattern => {
      if (pattern.test(content)) matchCount++;
    });
    
    // n8n should handle if 2+ patterns match
    return matchCount >= 2;
  }

  /**
   * Process request through n8n agent chaining
   */
  async processRequest(request: N8nAgentRequest): Promise<N8nAgentResponse> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: request.messages,
          provider: request.provider,
          model: request.model,
          parameters: {
            temperature: request.temperature,
            maxTokens: request.maxTokens
          },
          capabilities: {
            ...this.config.capabilities,
            ...request.capabilities
          },
          requestId: request.requestId,
          source: 'binG-chat'
        }),
        signal: AbortSignal.timeout(this.config.timeout)
      });

      if (!response.ok) {
        throw new Error(`n8n responded with ${response.status}: ${response.statusText}`);
      }

      const result: N8nAgentResponse = await response.json();
      
      // Update health status
      this.isHealthy = true;
      this.lastHealthCheck = Date.now();

      return result;
    } catch (error) {
      console.error('[N8nAgent] Request failed:', error);
      this.isHealthy = false;
      
      throw error;
    }
  }

  /**
   * Health check for n8n service
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    const now = Date.now();
    
    // Skip if recently checked
    if (now - this.lastHealthCheck < this.config.healthCheckInterval) {
      return this.isHealthy;
    }

    try {
      const healthEndpoint = `${this.config.endpoint.replace(/\/webhook\/.*$/, '')}/healthz`;
      const response = await fetch(healthEndpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      this.isHealthy = response.ok;
      this.lastHealthCheck = now;
      
      return this.isHealthy;
    } catch (error) {
      console.warn('[N8nAgent] Health check failed:', error);
      this.isHealthy = false;
      this.lastHealthCheck = now;
      return false;
    }
  }

  /**
   * Get service configuration
   */
  getConfig(): N8nAgentConfig {
    return { ...this.config };
  }

  /**
   * Check if service is enabled and healthy
   */
  isAvailable(): boolean {
    return this.config.enabled && this.isHealthy;
  }
}

export const n8nAgentService = new N8nAgentService();
