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

class FastAgentService {
  private config: FastAgentConfig;
  private isHealthy: boolean = true;
  private lastHealthCheck: number = 0;
  private readonly HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

  constructor() {
    // Support both localhost and subdomain configurations
    const endpoint = process.env.FAST_AGENT_ENDPOINT || 'http://localhost:8080/api/chat';
    const isSubdomain = endpoint.includes('fast-agent.') || endpoint.includes('//agent.');
    
    if (isSubdomain) {
      console.log('[FastAgent] Using subdomain configuration:', endpoint);
    }
    
    this.config = {
      enabled: process.env.FAST_AGENT_ENABLED === 'true',
      endpoint,
      timeout: parseInt(process.env.FAST_AGENT_TIMEOUT || '30000'),
      apiKey: process.env.FAST_AGENT_API_KEY,
      fallbackOnError: process.env.FAST_AGENT_FALLBACK !== 'false',
      supportedProviders: (process.env.FAST_AGENT_PROVIDERS || 'openai,anthropic,google').split(','),
      capabilities: {
        tools: process.env.FAST_AGENT_TOOLS !== 'false',
        fileHandling: process.env.FAST_AGENT_FILES !== 'false',
        agentChaining: process.env.FAST_AGENT_CHAINING !== 'false',
        mcpTools: process.env.FAST_AGENT_MCP !== 'false',
        qualityOptimization: process.env.FAST_AGENT_QUALITY !== 'false',
        multiThreadedReflection: process.env.FAST_AGENT_REFLECTION !== 'false',
        stepByStepProcessing: process.env.FAST_AGENT_STEPS !== 'false',
        multiModalHandling: process.env.FAST_AGENT_MULTIMODAL !== 'false',
      },
      qualitySettings: {
        defaultMode: (process.env.FAST_AGENT_QUALITY_MODE as any) || 'enhanced',
        reflectionEnabled: process.env.FAST_AGENT_REFLECTION_ENABLED !== 'false',
        maxIterations: parseInt(process.env.FAST_AGENT_MAX_ITERATIONS || '3'),
        qualityThreshold: parseFloat(process.env.FAST_AGENT_QUALITY_THRESHOLD || '0.8'),
      },
      processingSettings: {
        complexityDetection: process.env.FAST_AGENT_COMPLEXITY_DETECTION !== 'false',
        adaptiveTimeout: process.env.FAST_AGENT_ADAPTIVE_TIMEOUT !== 'false',
        parallelProcessing: process.env.FAST_AGENT_PARALLEL !== 'false',
        stepBreakdown: process.env.FAST_AGENT_STEP_BREAKDOWN !== 'false',
      }
    };
  }

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
    
    // Enhanced detection patterns
    const patterns = {
      tools: /\b(file|create|write|read|execute|run|tool|command|script|api|database|search)\b/i,
      code: /\b(code|function|class|import|export|debug|test|refactor|algorithm|optimize|review)\b/i,
      files: /\b(save|load|download|upload|directory|folder|path|csv|json|xml|pdf)\b/i,
      chains: /\b(workflow|chain|sequence|pipeline|multi-step|orchestrate|coordinate)\b/i,
      complex: /\b(analyze|compare|evaluate|synthesize|integrate|comprehensive|detailed|thorough)\b/i,
      multimodal: /\b(image|video|audio|chart|graph|diagram|visualization|media)\b/i
    };

    // Calculate complexity score
    let complexityScore = 0;
    Object.values(patterns).forEach(pattern => {
      if (pattern.test(content)) complexityScore++;
    });

    // Word count and sentence complexity
    const wordCount = content.split(/\s+/).length;
    const sentenceCount = content.split(/[.!?]+/).length;
    
    if (wordCount > 50) complexityScore++;
    if (sentenceCount > 5) complexityScore++;
    if (content.includes('step by step') || content.includes('detailed')) complexityScore++;

    // Determine if fast-agent should handle based on complexity
    return complexityScore >= 2 || request.qualityMode === 'enhanced' || request.qualityMode === 'iterative';
  }

  /**
   * Send request to fast-agent endpoint with quality optimization
   */
  async processRequest(request: FastAgentRequest): Promise<FastAgentResponse> {
    try {
      // Detect task complexity and adjust parameters
      const complexity = this.detectComplexity(request);
      const adaptedRequest = this.adaptRequestForQuality(request, complexity);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      // Adaptive timeout based on complexity
      const timeout = this.config.processingSettings.adaptiveTimeout 
        ? this.calculateAdaptiveTimeout(complexity)
        : this.config.timeout;

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...adaptedRequest,
          capabilities: this.config.capabilities,
          qualitySettings: this.config.qualitySettings,
          source: 'binG-integration'
        }),
        signal: AbortSignal.timeout(timeout)
      });

      if (!response.ok) {
        throw new Error(`Fast-agent responded with ${response.status}: ${response.statusText}`);
      }

      const result: FastAgentResponse = await response.json();
      
      // Quality assessment and potential iteration
      if (this.config.qualitySettings.reflectionEnabled && result.qualityScore && result.qualityScore < this.config.qualitySettings.qualityThreshold) {
        console.log('[FastAgent] Quality below threshold, attempting improvement');
        return await this.attemptQualityImprovement(adaptedRequest, result);
      }
      
      // Update health status
      this.isHealthy = true;
      this.lastHealthCheck = Date.now();

      return result;
    } catch (error) {
      console.warn('[FastAgent] Request failed:', error);
      
      // Mark as unhealthy if multiple failures
      this.isHealthy = false;
      
      if (this.config.fallbackOnError) {
        return {
          success: false,
          fallbackToOriginal: true,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
      
      throw error;
    }
  }

  /**
   * Detect task complexity for adaptive processing
   */
  private detectComplexity(request: FastAgentRequest): 'simple' | 'moderate' | 'complex' {
    if (request.taskComplexity) return request.taskComplexity;
    
    const content = request.messages[request.messages.length - 1]?.content || '';
    const wordCount = content.split(/\s+/).length;
    const hasMultipleSteps = /\b(then|next|after|finally|step|phase)\b/gi.test(content);
    const hasComplexTerms = /\b(analyze|synthesize|optimize|integrate|comprehensive)\b/i.test(content);
    
    if (wordCount > 100 || hasComplexTerms || request.qualityMode === 'iterative') return 'complex';
    if (wordCount > 30 || hasMultipleSteps || request.qualityMode === 'enhanced') return 'moderate';
    return 'simple';
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
   * Check if service is enabled and healthy
   */
  isAvailable(): boolean {
    return this.config.enabled && this.isHealthy;
  }
}

export const fastAgentService = new FastAgentService();
