/**
 * Custom Fallback Service - Last resort fallback to prevent API errors
 * This service ensures that users never see API errors by providing
 * graceful fallback responses in all scenarios
 */

export interface CustomFallbackRequest {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  requestId?: string;
  previousErrors?: string[];
}

export interface CustomFallbackResponse {
  success: boolean;
  content: string;
  provider: string;
  model: string;
  isFallback: boolean;
  fallbackReason?: string;
  metadata?: Record<string, any>;
}

export interface CustomFallbackConfig {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  timeout: number;
  alwaysAvailable: boolean;
}

class CustomFallbackService {
  private config: CustomFallbackConfig;
  private fallbackCount: number = 0;
  private lastFallbackTime: number = 0;

  constructor() {
    this.config = {
      enabled: process.env.CUSTOM_FALLBACK_ENABLED === 'true',
      endpoint: process.env.CUSTOM_FALLBACK_ENDPOINT || '',
      apiKey: process.env.CUSTOM_FALLBACK_API_KEY,
      timeout: parseInt(process.env.CUSTOM_FALLBACK_TIMEOUT || '30000'),
      alwaysAvailable: true // This service should always be available
    };
  }

  /**
   * Custom fallback always accepts requests (last resort)
   */
  shouldHandle(request: CustomFallbackRequest): boolean {
    return true; // Always handles as last resort
  }

  /**
   * Process request through custom fallback endpoint
   */
  async processRequest(request: CustomFallbackRequest): Promise<CustomFallbackResponse> {
    this.fallbackCount++;
    this.lastFallbackTime = Date.now();

    // Try the custom endpoint if configured
    if (this.config.enabled && this.config.endpoint) {
      try {
        const response = await this.tryCustomEndpoint(request);
        if (response.success) {
          return response;
        }
      } catch (error) {
        console.error('[CustomFallback] External endpoint failed:', error);
        // Continue to emergency fallback
      }
    }

    // Emergency fallback - always return something friendly
    return this.createEmergencyFallbackResponse(request);
  }

  /**
   * Try the custom external endpoint
   */
  private async tryCustomEndpoint(request: CustomFallbackRequest): Promise<CustomFallbackResponse> {
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
          temperature: request.temperature || 0.7,
          maxTokens: request.maxTokens || 2000
        },
        requestId: request.requestId,
        previousErrors: request.previousErrors,
        isFallbackRequest: true,
        source: 'binG-fallback'
      }),
      signal: AbortSignal.timeout(this.config.timeout)
    });

    if (!response.ok) {
      throw new Error(`Custom fallback responded with ${response.status}`);
    }

    const result = await response.json();
    
    return {
      success: true,
      content: result.content || result.response || 'Response processed.',
      provider: 'custom-fallback',
      model: result.model || 'fallback-model',
      isFallback: true,
      fallbackReason: 'previous_services_failed',
      metadata: result.metadata
    };
  }

  /**
   * Create emergency fallback response (always succeeds)
   */
  private createEmergencyFallbackResponse(request: CustomFallbackRequest): CustomFallbackResponse {
    const lastMessage = request.messages[request.messages.length - 1];
    const userContent = lastMessage?.content || '';
    
    // Create a context-aware friendly response
    let fallbackContent = this.generateContextAwareFallback(userContent);
    
    return {
      success: true,
      content: fallbackContent,
      provider: 'emergency-fallback',
      model: 'friendly-fallback',
      isFallback: true,
      fallbackReason: 'all_services_unavailable',
      metadata: {
        fallbackCount: this.fallbackCount,
        timestamp: Date.now()
      }
    };
  }

  /**
   * Generate context-aware fallback message
   */
  private generateContextAwareFallback(content: string): string {
    const lowerContent = content.toLowerCase();
    
    // Code-related request
    if (/\b(code|function|class|programming|debug)\b/i.test(content)) {
      return "I apologize, but I'm experiencing technical difficulties with my code processing capabilities at the moment. Please try again in a few moments, or rephrase your question. If this persists, you can try a simpler code-related query.";
    }
    
    // File-related request
    if (/\b(file|save|load|download|upload)\b/i.test(content)) {
      return "I'm currently having trouble with file operations. Please try again shortly. In the meantime, you can describe what you'd like to do and I'll help you prepare the steps.";
    }
    
    // Analysis/Research request
    if (/\b(analyze|research|study|investigate)\b/i.test(content)) {
      return "I'm experiencing some technical issues with my analysis capabilities right now. Please try again in a moment. You can also try breaking down your question into smaller, more specific parts.";
    }
    
    // Creative writing request
    if (/\b(write|create|story|article|content)\b/i.test(content)) {
      return "I'm having some difficulties with my creative capabilities at the moment. Please try your request again shortly. You might also try providing more specific details about what you'd like me to create.";
    }
    
    // General/Unknown request
    return "I apologize, but I'm experiencing technical difficulties processing your request at the moment. This is a temporary issue. Please try again in a few moments, or try rephrasing your question in a different way.";
  }

  /**
   * Health check - always returns true (always available)
   */
  async healthCheck(): Promise<boolean> {
    // Custom fallback always reports healthy since it has emergency response
    return true;
  }

  /**
   * Get service configuration
   */
  getConfig(): CustomFallbackConfig {
    return { ...this.config };
  }

  /**
   * Check if service is available
   */
  isAvailable(): boolean {
    return this.config.alwaysAvailable;
  }

  /**
   * Get fallback statistics
   */
  getStats() {
    return {
      fallbackCount: this.fallbackCount,
      lastFallbackTime: this.lastFallbackTime,
      enabled: this.config.enabled,
      hasCustomEndpoint: !!this.config.endpoint
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.fallbackCount = 0;
    this.lastFallbackTime = 0;
  }
}

export const customFallbackService = new CustomFallbackService();
