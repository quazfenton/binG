/**
 * Fast-Agent Service - External endpoint integration for advanced LLM capabilities
 * Provides tools, file handling, agent chaining, and MCP tools support
 */

export interface FastAgentRequest {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  context?: Record<string, any>;
  requestId?: string;
  qualityMode?: 'standard' | 'enhanced' | 'iterative';
  taskComplexity?: 'simple' | 'moderate' | 'complex';
  enableReflection?: boolean;
  stepByStep?: boolean;
  multiModal?: boolean;
}

export interface FastAgentResponse {
  success: boolean;
  content?: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  files?: Array<{
    path: string;
    content: string;
    type: string;
  }>;
  chainedAgents?: string[];
  error?: string;
  fallbackToOriginal?: boolean;
  qualityScore?: number;
  processingSteps?: Array<{
    step: string;
    status: 'pending' | 'processing' | 'completed';
    result?: string;
  }>;
  reflectionResults?: Array<{
    perspective: string;
    improvements: string[];
    confidence: number;
  }>;
  multiModalContent?: Array<{
    type: 'text' | 'image' | 'video' | 'audio' | 'file';
    content: string;
    metadata?: Record<string, any>;
  }>;
  estimatedDuration?: number;
  iterationCount?: number;
}

export interface FastAgentConfig {
  enabled: boolean;
  endpoint: string;
  timeout: number;
  apiKey?: string;
  fallbackOnError: boolean;
  supportedProviders: string[];
  capabilities: {
    tools: boolean;
    fileHandling: boolean;
    agentChaining: boolean;
    mcpTools: boolean;
    qualityOptimization: boolean;
    multiThreadedReflection: boolean;
    stepByStepProcessing: boolean;
    multiModalHandling: boolean;
  };
  qualitySettings: {
    defaultMode: 'standard' | 'enhanced' | 'iterative';
    reflectionEnabled: boolean;
    maxIterations: number;
    qualityThreshold: number;
  };
  processingSettings: {
    complexityDetection: boolean;
    adaptiveTimeout: boolean;
    parallelProcessing: boolean;
    stepBreakdown: boolean;
  };
}

import { ComplexityAnalyzer } from '../utils/complexity-analyzer';

class FastAgentService {
  // ... (existing properties)

  /**
   * Check if fast-agent should handle this request with enhanced complexity detection
   */
  shouldHandle(request: FastAgentRequest): boolean {
    if (!this.config.enabled || !this.isHealthy) {
      return false;
    }

    // Check if provider is supported
    if (request.provider && !this.config.supportedProviders.includes(request.provider)) {
      return false;
    }

    const content = request.messages[request.messages.length - 1]?.content || '';
    const metrics = ComplexityAnalyzer.analyze(content);

    // Determine if fast-agent should handle based on complexity score
    return metrics.score >= 3 || request.qualityMode === 'enhanced' || request.qualityMode === 'iterative';
  }

  /**
   * Perform multi-threaded reflection on a result
   * Gets diverse perspectives (Security, Logic, UX) in parallel
   */
  private async performMultiThreadedReflection(
    request: FastAgentRequest,
    initialContent: string
  ): Promise<FastAgentResponse['reflectionResults']> {
    const perspectives = [
      { name: 'Security', prompt: 'Analyze this response for security risks or sensitive data exposure.' },
      { name: 'Logic', prompt: 'Check this response for logical consistency and accuracy.' },
      { name: 'Style', prompt: 'Review this response for tone, clarity, and helpfulness.' }
    ];

    try {
      const results = await Promise.all(perspectives.map(async (p) => {
        const reflectionResponse = await fetch(`${this.config.endpoint}/reflect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: initialContent,
            perspective: p.name,
            instructions: p.prompt
          })
        });
        
        if (!reflectionResponse.ok) return null;
        return reflectionResponse.json();
      }));

      return results.filter(Boolean);
    } catch (error) {
      console.warn('[FastAgent] Reflection failed:', error);
      return [];
    }
  }

  /**
   * Send request to fast-agent endpoint with quality optimization
   */
  async processRequest(request: FastAgentRequest): Promise<FastAgentResponse> {
    try {
      // ... (existing logic)
      
      const result: FastAgentResponse = await response.json();

      // NEW: Trigger multi-threaded reflection if enabled and task is complex
      if (this.config.capabilities.multiThreadedReflection && metrics.complexity === 'complex') {
        const reflections = await this.performMultiThreadedReflection(request, result.content || '');
        if (reflections?.length) {
          result.reflectionResults = reflections;
          
          // If any reflection has low confidence, trigger iterative improvement
          const lowConfidence = reflections.some(r => r.confidence < 0.7);
          if (lowConfidence && this.config.qualitySettings.reflectionEnabled) {
             return await this.attemptQualityImprovement(adaptedRequest, result);
          }
        }
      }
      
      // ... (rest of the logic)
    } catch (error) { /* ... */ }
  }

  /**
   * Detect task complexity for adaptive processing (Deprecated - use ComplexityAnalyzer)
   */
  private detectComplexity(request: FastAgentRequest): 'simple' | 'moderate' | 'complex' {
    if (request.taskComplexity) return request.taskComplexity;
    const content = request.messages[request.messages.length - 1]?.content || '';
    return ComplexityAnalyzer.analyze(content).complexity;
  }

  /**
   * Adapt request parameters for quality optimization
   */
  private adaptRequestForQuality(request: FastAgentRequest, complexity: string): FastAgentRequest {
    const adapted = { ...request };
    
    // Set quality mode based on complexity if not specified
    if (!adapted.qualityMode) {
      adapted.qualityMode = complexity === 'complex' ? 'iterative' : 
                           complexity === 'moderate' ? 'enhanced' : 'standard';
    }
    
    // Enable reflection for complex tasks
    if (complexity === 'complex' && this.config.capabilities.multiThreadedReflection) {
      adapted.enableReflection = true;
    }
    
    // Enable step-by-step for moderate to complex tasks
    if (complexity !== 'simple' && this.config.capabilities.stepByStepProcessing) {
      adapted.stepByStep = true;
    }
    
    return adapted;
  }

  /**
   * Calculate adaptive timeout based on complexity
   */
  private calculateAdaptiveTimeout(complexity: string): number {
    const baseTimeout = this.config.timeout;
    switch (complexity) {
      case 'complex': return baseTimeout * 2;
      case 'moderate': return baseTimeout * 1.5;
      default: return baseTimeout;
    }
  }

  /**
   * Attempt to improve response quality through iteration
   */
  private async attemptQualityImprovement(request: FastAgentRequest, previousResult: FastAgentResponse): Promise<FastAgentResponse> {
    if (!previousResult.iterationCount || previousResult.iterationCount < this.config.qualitySettings.maxIterations) {
      // Create improvement request
      const improvementRequest = {
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant' as const, content: previousResult.content || '' },
          { role: 'user' as const, content: 'Please improve the previous response for better quality and completeness.' }
        ],
        qualityMode: 'iterative' as const,
        context: {
          ...request.context,
          previousQualityScore: previousResult.qualityScore,
          iterationCount: (previousResult.iterationCount || 0) + 1
        }
      };
      
      try {
        return await this.processRequest(improvementRequest);
      } catch (error) {
        console.warn('[FastAgent] Quality improvement failed, returning original result');
        return previousResult;
      }
    }
    
    return previousResult;
  }

  /**
   * Health check for fast-agent service
   */
  async healthCheck(): Promise<boolean> {
    const now = Date.now();
    
    // Skip if recently checked
    if (now - this.lastHealthCheck < this.HEALTH_CHECK_INTERVAL) {
      return this.isHealthy;
    }

    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      this.isHealthy = response.ok;
      this.lastHealthCheck = now;
      
      return this.isHealthy;
    } catch (error) {
      console.warn('[FastAgent] Health check failed:', error);
      this.isHealthy = false;
      this.lastHealthCheck = now;
      return false;
    }
  }

  /**
   * Get service configuration
   */
  getConfig(): FastAgentConfig {
    return { ...this.config };
  }

  /**
   * Check if service is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if service is enabled and healthy
   */
  isAvailable(): boolean {
    return this.config.enabled && this.isHealthy;
  }

  /**
   * Create streaming response for Fast-Agent
   */
  createStreamingResponse(fastAgentResponse: FastAgentResponse, requestId?: string): ReadableStream {
    const encoder = new TextEncoder();
    const content = fastAgentResponse.content || '';
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    return new ReadableStream({
      start(controller) {
        const streamId = requestId || `fast-agent-${Date.now()}`;

        // Send initial event
        const initEvent = `event: init\ndata: ${JSON.stringify({
          requestId: streamId,
          startTime: Date.now(),
          provider: 'fast-agent',
          model: 'fast-agent',
          source: 'fast-agent'
        })}\n\n`;
        controller.enqueue(encoder.encode(initEvent));

        const chunkSize = 30;
        let offset = 0;

        const sendChunk = () => {
          if (cancelled) return;
          try {
            if (offset < content.length) {
              const endOffset = Math.min(offset + chunkSize, content.length);
              const chunk = content.slice(offset, endOffset);

              const tokenEvent = `data: ${JSON.stringify({
                type: "token",
                content: chunk,
                requestId: streamId,
                timestamp: Date.now(),
                offset
              })}\n\n`;
              controller.enqueue(encoder.encode(tokenEvent));

              offset = endOffset;
              timerId = setTimeout(sendChunk, 80);
            } else {
              const doneEvent = `event: done\ndata: ${JSON.stringify({
                requestId: streamId,
                success: true,
                totalTokens: content.length,
                source: 'fast-agent'
              })}\n\n`;
              controller.enqueue(encoder.encode(doneEvent));
              controller.close();
            }
          } catch (error) {
            const errorEvent = `event: error\ndata: ${JSON.stringify({
              requestId: streamId,
              message: error instanceof Error ? error.message : 'Streaming error',
              source: 'fast-agent'
            })}\n\n`;
            controller.enqueue(encoder.encode(errorEvent));
            controller.close();
          }
        };

        timerId = setTimeout(sendChunk, 200);
      },
      cancel() {
        cancelled = true;
        if (timerId !== undefined) clearTimeout(timerId);
      }
    });
  }

  /**
   * Format Fast-Agent response for API consumption
   */
  formatResponse(fastAgentResponse: FastAgentResponse, requestId?: string) {
    const response: any = {
      success: fastAgentResponse.success,
      data: {
        content: fastAgentResponse.content || '',
        usage: {
          promptTokens: 0,
          // Note: These are character counts, not actual token counts
          // Fast-Agent doesn't provide token usage, so we use character estimates
          completionTokens: fastAgentResponse.content?.length || 0,
          totalTokens: fastAgentResponse.content?.length || 0
        },
        model: 'fast-agent',
        provider: 'fast-agent'
      },
      timestamp: new Date().toISOString(),
      source: 'fast-agent'
    };

    // Add tool calls if present
    if (fastAgentResponse.toolCalls?.length) {
      response.data.toolCalls = fastAgentResponse.toolCalls;
    }

    // Add file operations if present
    if (fastAgentResponse.files?.length) {
      response.data.files = fastAgentResponse.files;
    }

    // Add chained agents if present
    if (fastAgentResponse.chainedAgents?.length) {
      response.data.chainedAgents = fastAgentResponse.chainedAgents;
    }

    // Propagate error and fallback metadata on failure
    if (!fastAgentResponse.success) {
      response.error = fastAgentResponse.error || 'Fast-Agent request failed';
      if (fastAgentResponse.fallbackToOriginal !== undefined) {
        response.fallbackToOriginal = fastAgentResponse.fallbackToOriginal;
      }
    }

    return response;
  }
}

export const fastAgentService = new FastAgentService();
