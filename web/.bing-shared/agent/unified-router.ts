/**
 * Unified Router - Primary entry point for all LLM request routing
 *
 * Combines:
 * - Multi-factor task classifier (keyword + semantic + context + historical)
 * - Provider health checks
 * - Mode selection (V2 native, StatefulAgent, PlanActVerify, V1 API)
 * - Fallback chain on failure
 *
 * This replaces the scattered routing logic in:
 * - api/chat/route.ts (was doing its own regex-based detection)
 * - task-router.ts (dead code keyword matching)
 * - modular.ts (header-gated, now uses this as default)
 *
 * @example
 * ```typescript
 * import { routeChatRequest } from '@bing/shared/agent/unified-router';
 *
 * const result = await routeChatRequest({
 *   userMessage: 'Add authentication to the app',
 *   messages: [{ role: 'user', content: 'Add authentication' }],
 *   provider: 'openai',
 *   model: 'gpt-4o',
 *   stream: true,
 *   userId: 'user_123',
 *   conversationId: 'conv_456',
 *   onStreamChunk: (chunk) => console.log(chunk),
 * });
 * ```
 */

import { createLogger } from '@/lib/utils/logger';
import {
  processUnifiedAgentRequest,
  type UnifiedAgentConfig,
  type UnifiedAgentResult,
} from '@/lib/orchestra/unified-agent-service';

// Local types: upstream `unified-agent-service` no longer exports these.
export interface ProviderHealth {
  preferredMode: string;
  v2Native: boolean;
  v1Api: boolean;
}

// Local stub: upstream `checkProviderHealth` was removed from unified-agent-service.
// Provide a permissive default so unified-router compiles and routing falls back gracefully.
export function checkProviderHealth(): ProviderHealth {
  return {
    preferredMode: 'v1-api',
    v2Native: false,
    v1Api: true,
  };
}
import {
  createTaskClassifier,
  type TaskClassification,
  type ClassificationContext,
} from './task-classifier';

const log = createLogger('UnifiedRouter');

// ============================================================================
// Types
// ============================================================================

export interface ChatRequest {
  /** The user's message */
  userMessage: string;
  /** Full conversation history */
  messages: Array<{ role: string; content: string }>;
  /** LLM provider name (openai, anthropic, google, mistral, etc.) */
  provider: string;
  /** Model name (gpt-4o, claude-sonnet-4-5, etc.) */
  model: string;
  /** Enable streaming response */
  stream?: boolean;
  /** User ID (authenticated or anonymous) */
  userId?: string;
  /** Conversation/session ID */
  conversationId?: string;
  /** Callback for streaming chunks */
  onStreamChunk?: (chunk: string) => void;
  /** Callback for tool execution */
  onToolExecution?: (toolName: string, args: Record<string, any>, result: any) => void;
  /** Tool definitions for the LLM */
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
  }>;
  /** Tool executor function */
  executeTool?: (name: string, args: Record<string, any>) => Promise<any>;
  /** System prompt override */
  systemPrompt?: string;
  /** Temperature for LLM */
  temperature?: number;
  /** Max tokens for LLM response */
  maxTokens?: number;
  /** Max steps for agent loop */
  maxSteps?: number;
  /** Project context for classification */
  projectContext?: {
    id?: string;
    size?: 'small' | 'medium' | 'large';
  };
  /** Enable Mastra workflows */
  enableMastraWorkflows?: boolean;
  /** Specific workflow ID */
  workflowId?: string;
}

export interface ChatResponse {
  success: boolean;
  response: string;
  steps?: Array<{
    toolName: string;
    args: Record<string, any>;
    result: any;
  }>;
  totalSteps?: number;
  mode: string;
  error?: string;
  classification?: TaskClassification;
  health?: ProviderHealth;
  metadata?: Record<string, any>;
}

// ============================================================================
// Classifier Singleton
// ============================================================================

let _classifier: ReturnType<typeof createTaskClassifier> | null = null;

function getClassifier() {
  if (!_classifier) {
    _classifier = createTaskClassifier({
      simpleThreshold: parseFloat(process.env.TASK_CLASSIFIER_SIMPLE_THRESHOLD || '0.3'),
      complexThreshold: parseFloat(process.env.TASK_CLASSIFIER_COMPLEX_THRESHOLD || '0.7'),
      keywordWeight: 0.4,
      semanticWeight: parseFloat(process.env.TASK_CLASSIFIER_SEMANTIC_WEIGHT || '0.3'),
      contextWeight: parseFloat(process.env.TASK_CLASSIFIER_CONTEXT_WEIGHT || '0.2'),
      historicalWeight: parseFloat(process.env.TASK_CLASSIFIER_HISTORY_WEIGHT || '0.1'),
      enableSemanticAnalysis: process.env.TASK_CLASSIFIER_ENABLE_SEMANTIC !== 'false',
      enableHistoricalLearning: process.env.TASK_CLASSIFIER_ENABLE_HISTORY !== 'false',
      enableContextAwareness: process.env.TASK_CLASSIFIER_ENABLE_CONTEXT !== 'false',
    });
  }
  return _classifier;
}

// ============================================================================
// Classification Helper
// ============================================================================

/**
 * Classify a task using multi-factor scoring.
 * Falls back to simple detection if classifier fails.
 */
export async function classifyTask(
  userMessage: string,
  context: ClassificationContext = {}
): Promise<TaskClassification> {
  // Empty message — treat as simple
  if (!userMessage || userMessage.trim().length === 0) {
    return {
      complexity: 'simple',
      recommendedMode: 'v1-api',
      confidence: 1,
      factors: { keywordScore: 0, semanticScore: 0, contextScore: 0, historicalScore: 0 },
      reasoning: ['Empty message'],
    };
  }

  try {
    const classifier = getClassifier();
    return await classifier.classify(userMessage, context);
  } catch (error: any) {
    log.warn('Task classification failed, using fallback', { error: error.message });
    // Fallback: treat as simple task
    return {
      complexity: 'simple',
      recommendedMode: 'v1-api',
      confidence: 0,
      factors: { keywordScore: 0, semanticScore: 0, contextScore: 0, historicalScore: 0 },
      reasoning: ['Classifier unavailable, using fallback'],
    };
  }
}

// ============================================================================
// Primary Router
// ============================================================================

/**
 * Route a chat request through the unified routing system.
 *
 * Flow:
 * 1. Classify task complexity (multi-factor scoring)
 * 2. Check provider health
 * 3. Select execution mode based on classification + health
 * 4. Execute with fallback chain
 *
 * @param request - Chat request configuration
 * @returns Chat response with result and metadata
 */
export async function routeChatRequest(request: ChatRequest): Promise<ChatResponse> {
  const startTime = Date.now();

  // 0. Check circuit breaker - skip if provider is in open circuit state
  if (!circuitBreaker.isAvailable(request.provider)) {
    const stats = circuitBreaker.getStats(request.provider);
    log.warn(`Provider ${request.provider} circuit is OPEN, skipping`);

    return {
      success: false,
      response: '',
      mode: 'circuit-open',
      error: `Provider ${request.provider} is temporarily unavailable (circuit open after ${stats.failures} failures)`,
      classification: {} as TaskClassification,
      health: {} as any,
      metadata: {
        duration: Date.now() - startTime,
        circuitBreaker: {
          state: stats.state,
          failures: stats.failures,
          lastFailureTime: stats.lastFailureTime,
        },
      },
    };
  }

  // 1. Classify the task
  const classification = await classifyTask(request.userMessage, {
    projectSize: request.projectContext?.size,
  });

  log.info('Task classified', {
    complexity: classification.complexity,
    recommendedMode: classification.recommendedMode,
    confidence: classification.confidence,
  });

  // 2. Check provider health
  const health = checkProviderHealth();

  log.debug('Provider health check', {
    preferredMode: health.preferredMode,
    v2Native: health.v2Native,
    v1Api: health.v1Api,
  });

  // 3. Build unified agent config
  const config: UnifiedAgentConfig = {
    userMessage: request.userMessage,
    // FIX: Pass userId and conversationId for proper VFS session scoping
    userId: request.userId,
    conversationId: request.conversationId,
    conversationHistory: request.messages,
    systemPrompt: request.systemPrompt,
    maxSteps: request.maxSteps || parseInt(process.env.AI_SDK_MAX_STEPS || '15', 10),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
    tools: request.tools,
    executeTool: request.executeTool,
    onStreamChunk: request.onStreamChunk,
    onToolExecution: request.onToolExecution,
    mode: 'auto', // Let unified agent select best mode
    enableMastraWorkflows: request.enableMastraWorkflows,
    workflowId: request.workflowId,
    // Project context — pass through if provided, omit if not
    ...(request.projectContext ? {
      projectContext: {
        id: request.projectContext.id,
        size: request.projectContext.size,
      } as any,
    } : {}),
  };

  // 4. Execute with unified agent (which handles fallback chain internally)
  try {
    const result = await processUnifiedAgentRequest(config);

    return {
      ...result,
      classification,
      health,
      metadata: {
        ...result.metadata,
        classification: {
          complexity: classification.complexity,
          confidence: classification.confidence,
          recommendedMode: classification.recommendedMode,
        },
        duration: Date.now() - startTime,
      },
    };
  } catch (error: any) {
    log.error('Unified routing failed', { error: error.message });

    return {
      success: false,
      response: '',
      mode: 'error',
      error: error.message,
      classification,
      health,
      metadata: {
        duration: Date.now() - startTime,
        classification: {
          complexity: classification.complexity,
          confidence: classification.confidence,
        },
      },
    };
  }
}

/**
 * Circuit breaker for provider fault tolerance
 *
 * Prevents cascading failures by opening the circuit after repeated
 * errors, allowing the provider to recover before retrying.
 */
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  successes: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  failureTimestamps: number[];
}

interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Time in ms before attempting recovery */
  recoveryTimeoutMs: number;
  /** Time window for counting failures */
  failureWindowMs: number;
}

const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
  failureWindowMs: 60000,
};

class ProviderCircuitBreaker {
  private states = new Map<string, CircuitBreakerState>();
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = DEFAULT_CB_CONFIG) {
    this.config = config;
  }

  private getState(provider: string): CircuitBreakerState {
    let state = this.states.get(provider);
    if (!state) {
      state = {
        state: 'closed',
        failures: 0,
        successes: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0,
        failureTimestamps: [],
      };
      this.states.set(provider, state);
    }
    return state;
  }

  /** Check if provider is available (circuit not open) */
  isAvailable(provider: string): boolean {
    const state = this.getState(provider);
    const now = Date.now();

    if (state.state === 'closed') return true;

    if (state.state === 'open') {
      const timeSinceLastFailure = now - state.lastFailureTime;
      if (timeSinceLastFailure >= this.config.recoveryTimeoutMs) {
        // Transition to half-open for probe
        state.state = 'half-open';
        log.info(`[CircuitBreaker] ${provider}: HALF-OPEN (probing)`);
        return true;
      }
      return false;
    }

    // half-open: allow one probe request
    return true;
  }

  /** Record successful request */
  recordSuccess(provider: string): void {
    const state = this.getState(provider);
    state.successes++;
    state.lastSuccessTime = Date.now();

    if (state.state === 'half-open') {
      state.state = 'closed';
      state.failures = 0;
      state.failureTimestamps = [];
      log.info(`[CircuitBreaker] ${provider}: CLOSED (recovered)`);
    } else if (state.state === 'closed') {
      // Clear old failures outside the window
      const cutoff = Date.now() - this.config.failureWindowMs;
      state.failureTimestamps = state.failureTimestamps.filter(t => t > cutoff);
      state.failures = state.failureTimestamps.length;
    }
  }

  /** Record failed request */
  recordFailure(provider: string): void {
    const state = this.getState(provider);
    state.failures++;
    state.lastFailureTime = Date.now();
    state.failureTimestamps.push(Date.now());

    // Clear old failures outside the window
    const cutoff = Date.now() - this.config.failureWindowMs;
    state.failureTimestamps = state.failureTimestamps.filter(t => t > cutoff);
    state.failures = state.failureTimestamps.length;

    if (state.failures >= this.config.failureThreshold && state.state !== 'open') {
      state.state = 'open';
      log.warn(`[CircuitBreaker] ${provider}: OPEN (${state.failures} failures in ${this.config.failureWindowMs / 1000}s)`);
    }
  }

  /** Reset circuit for provider */
  reset(provider: string): void {
    const state = this.getState(provider);
    state.state = 'closed';
    state.failures = 0;
    state.successes = 0;
    state.failureTimestamps = [];
    log.info(`[CircuitBreaker] ${provider}: RESET`);
  }

  /** Get all states */
  getAllStates(): Map<string, CircuitBreakerState> {
    return this.states;
  }

  /** Get stats for specific provider */
  getStats(provider: string): CircuitBreakerState {
    return this.getState(provider);
  }
}

const circuitBreaker = new ProviderCircuitBreaker();

export {
  circuitBreaker,
  ProviderCircuitBreaker,
  type CircuitBreakerState,
  type CircuitBreakerConfig,
};

// ============================================================================
// Exports
// ============================================================================

export {
  type UnifiedAgentResult,
} from '@/lib/orchestra/unified-agent-service';

export {
  createTaskClassifier,
  type TaskClassification,
  type ClassificationContext,
} from './task-classifier';
