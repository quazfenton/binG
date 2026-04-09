/**
 * Unified Router - Primary entry point for all LLM request routing
 *
 * Combines:
 * - Multi-factor task classifier (keyword + semantic + context + historical)
 * - Provider health checks
 * - Mode selection (V2 native, StatefulAgent, AgentOrchestrator, V1 API)
 * - Fallback chain on failure
 *
 * This replaces the scattered routing logic in:
 * - api/chat/route.ts (was doing its own regex-based detection)
 * - task-router.ts (dead code keyword matching)
 * - orchestration-mode-handler.ts (header-gated, now uses this as default)
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
  checkProviderHealth,
  type UnifiedAgentConfig,
  type UnifiedAgentResult,
  type ProviderHealth,
} from '@/lib/orchestra/unified-agent-service';
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

// ============================================================================
// Exports
// ============================================================================

export {
  checkProviderHealth,
  type ProviderHealth,
  type UnifiedAgentResult,
} from '@/lib/orchestra/unified-agent-service';

export {
  createTaskClassifier,
  type TaskClassification,
  type ClassificationContext,
} from './task-classifier';
