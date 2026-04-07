/**
 * Unified Agent Service
 *
 * Unifies V1 (LLM Chat API), V2 (OpenCode Containerized), and StatefulAgent (Plan-Act-Verify)
 * into a single interface with intelligent routing.
 *
 * Features:
 * - Automatic routing based on task complexity and configuration
 * - StatefulAgent for complex multi-step tasks (primary for agentic work)
 * - Fallback chain: StatefulAgent → V2 Native → V2 Local → V1 API
 * - Tool execution support for all modes
 * - Streaming support
 * - Health checking for provider availability
 */

import type { ToolResult } from '../sandbox/types';
import type { LLMProvider } from '../sandbox/providers/llm-provider';
import { getLLMProvider } from '../sandbox/providers/llm-factory';

// Wire in centralized tool system for all execution paths (v1, v2, streaming, non-Mastra)
import { initToolSystem, executeToolCapability, hasToolCapability, isToolSystemReady } from '@/lib/tools';

import { runAgentLoop as runV2AgentLoop } from './agent-loop';
import { llmService, type LLMRequest } from '../chat/llm-providers';
import {
  createOpenCodeEngine,
  type OpenCodeEngineResult,
  type OpenCodeEngineConfig,
} from '../session/agent/opencode-engine-service';
import {
  StatefulAgent,
  type StatefulAgentOptions,
  type StatefulAgentResult,
} from './stateful-agent/agents/stateful-agent';
import { createLogger } from '@/lib/utils/logger';
import { mastraWorkflowIntegration } from '@bing/shared/agent/mastra-workflow-integration';

import {
  AgentOrchestrator,
  type OrchestratorConfig,
  type OrchestratorEvent
} from '@bing/shared/agent/orchestration/agent-orchestrator';

import {
  createTaskClassifier,
  type TaskClassification,
  type ClassificationContext,
} from '@bing/shared/agent/task-classifier';
import { getProjectServices, type ProjectContext } from '@/lib/project-context';

const log = createLogger('UnifiedAgentService');

/**
 * Task classifier instance (singleton)
 */
const taskClassifier = createTaskClassifier({
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

export interface UnifiedAgentConfig {
  // Core
  userMessage: string;
  sandboxId?: string;
  systemPrompt?: string;
  conversationHistory?: Array<{ role: string; content: string }>;

  // Project isolation (provides project-scoped vector memory and retrieval)
  projectContext?: ProjectContext;

  // Tools
  tools?: any[];
  executeTool?: (name: string, args: Record<string, any>) => Promise<ToolResult>;
  onToolExecution?: (name: string, args: Record<string, any>, result: ToolResult) => void;

  // Streaming
  onStreamChunk?: (chunk: string) => void;

  // Agent settings
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;

  // Mode override (optional - auto-detected from env if not specified)
  mode?: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'mastra-workflow' | 'desktop' | 'auto';

  // Mastra workflow options
  workflowId?: string; // Use specific Mastra workflow
  enableMastraWorkflows?: boolean; // Enable Mastra workflow routing
}

export interface UnifiedAgentResult {
  success: boolean;
  response: string;
  steps?: Array<{
    toolName: string;
    args: Record<string, any>;
    result: ToolResult;
  }>;
  totalSteps?: number;
  mode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'mastra-workflow' | 'desktop';
  error?: string;
  metadata?: {
    model?: string;
    provider?: string;
    duration?: number;
    workflowId?: string;
    workflowSteps?: Array<{ id: string; name: string; status: string }>;
    [key: string]: any;
  };
}


export interface ProviderHealth {
  v2Containerized: boolean;
  v2Local: boolean;
  v2Native: boolean;  // OpenCode CLI directly (new primary engine)
  v1Api: boolean;
  desktop: boolean;   // Tauri desktop local execution
  preferredMode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'desktop';
}

/**
 * Check provider health and availability
 */
export function checkProviderHealth(): ProviderHealth {
  const containerized = process.env.OPENCODE_CONTAINERIZED === 'true';
  const sandboxProvider = process.env.SANDBOX_PROVIDER || 'daytona';
  const sandboxKey = process.env[`${sandboxProvider.toUpperCase()}_API_KEY`];

  // Desktop: Tauri desktop mode with local execution
  const desktop = process.env.DESKTOP_MODE === 'true' || process.env.DESKTOP_LOCAL_EXECUTION === 'true';

  // V2 Containerized: requires sandbox provider + API key + opencode
  const v2Containerized = containerized && !!sandboxKey;

  // V2 Local: requires opencode CLI installed
  const v2Local = !containerized && process.env.LLM_PROVIDER === 'opencode';

  // V2 Native: OpenCode CLI available (primary agentic engine)
  const v2Native = v2Local || v2Containerized;

  // V1 API: requires API key for configured provider (fallback)
  const llmProvider = process.env.LLM_PROVIDER || 'mistral';
  const apiKeyEnv = `${llmProvider.toUpperCase()}_API_KEY`;
  const v1Api = !!process.env[apiKeyEnv] || !!process.env.OPENROUTER_API_KEY;

  // Determine preferred mode - Desktop takes priority when enabled
  let preferredMode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'desktop' = 'v1-api';

  if (desktop) {
    preferredMode = 'desktop';
  } else if (v2Native) {
    // OpenCode engine is primary for agentic tasks
    preferredMode = containerized ? 'v2-containerized' : (v2Local ? 'v2-local' : 'v2-native');
  } else if (v1Api) {
    // Fallback to V1 API for simple chat
    preferredMode = 'v1-api';
  }

  return {
    v2Containerized,
    v2Local,
    v2Native,
    v1Api,
    desktop,
    preferredMode,
  };
}

/**
 * Determine which mode to use based on config and task classification
 * 
 * Uses multi-factor task classifier instead of fragile regex matching.
 * Returns both mode and classification for logging/metrics.
 */
async function determineMode(config: UnifiedAgentConfig): Promise<{
  mode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'mastra-workflow' | 'desktop';
  classification?: TaskClassification;
}> {
  // Explicit mode override
  if (config.mode && config.mode !== 'auto') {
    return { mode: config.mode };
  }

  // Desktop mode takes priority when enabled
  const health = checkProviderHealth();
  if (health.desktop) {
    return { mode: 'desktop' };
  }

  // Check if Mastra workflow should be used
  if (config.enableMastraWorkflows !== false && config.workflowId) {
    return { mode: 'mastra-workflow' };
  }

  // Use task classifier for intelligent routing
  try {
    const classification = await taskClassifier.classify(config.userMessage, {
      projectSize: process.env.PROJECT_SIZE as any,
      userPreference: process.env.AGENT_PREFERENCE as any,
    });

    log.debug('Task classified', {
      complexity: classification.complexity,
      recommendedMode: classification.recommendedMode,
      confidence: classification.confidence,
      factors: classification.factors,
    });

    // Map classifier recommendation to actual mode
    // Note: classifier may return 'stateful-agent' but we need to map to valid execution modes
    const health = checkProviderHealth();
    let mode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'mastra-workflow';
    
    if (classification.recommendedMode === 'stateful-agent') {
      // StatefulAgent runs as v2-native mode
      mode = health.v2Native ? 'v2-native' : health.v2Containerized ? 'v2-containerized' : health.v2Local ? 'v2-local' : 'v1-api';
    } else if (classification.recommendedMode === 'mastra-workflow') {
      mode = 'mastra-workflow';
    } else {
      // v1-api or v2-native from classifier
      mode = classification.recommendedMode;
    }
    
    // Final health check - ensure mode is available
    if (mode === 'v2-native' && !health.v2Native) {
      mode = health.v2Containerized ? 'v2-containerized' : health.v2Local ? 'v2-local' : 'v1-api';
    } else if (mode === 'v2-containerized' && !health.v2Containerized) {
      mode = health.v2Local ? 'v2-local' : 'v1-api';
    } else if (mode === 'v2-local' && !health.v2Local) {
      mode = 'v1-api';
    }

    return { 
      mode,
      classification,
    };
  } catch (error) {
    log.warn('Task classification failed, using health-based fallback', error);
    // Fallback to health-based detection
    const health = checkProviderHealth();
    return { mode: health.preferredMode };
  }
}

/**
 * Unified agent request processor
 *
 * Routes to OpenCode V2 Engine (primary) or V1 API (fallback) based on configuration.
 * Implements fallback chain for reliability.
 * Uses task classifier for intelligent mode selection.
 */
export async function processUnifiedAgentRequest(
  config: UnifiedAgentConfig
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  const { mode, classification } = await determineMode(config);

  try {
    switch (mode) {
      case 'desktop':
        return await runDesktopMode(config, classification);

      case 'v2-native':
        return await runV2Native(config, classification);

      case 'v2-containerized':
        return await runV2Containerized(config);

      case 'v2-local':
        return await runV2Local(config);

      case 'mastra-workflow':
        return await runMastraWorkflow(config);

      case 'v1-api':
      default:
        return await runV1Api(config);
    }
  } catch (error) {
    // Attempt fallback on error
    const triedModes = new Set<string>([mode]);
    const fallbackResult = await attemptFallback(config, mode, error, triedModes);

    if (fallbackResult) {
      return {
        ...fallbackResult,
        metadata: {
          ...fallbackResult.metadata,
          fallbackFrom: mode,
          classification: classification ? {
            complexity: classification.complexity,
            confidence: classification.confidence,
          } : undefined,
        },
      };
    }

    // All modes failed
    return {
      success: false,
      response: '',
      mode,
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        duration: Date.now() - startTime,
        classification: classification ? {
          complexity: classification.complexity,
          confidence: classification.confidence,
        } : undefined,
      },
    };
  }
}

/**
 * Run V2 Native mode - OpenCode CLI as primary agentic engine
 * This is the MAIN mode for agentic tasks with native bash/file ops
 */
async function runV2Native(
  config: UnifiedAgentConfig,
  classification?: TaskClassification
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  log.info('Running V2 Native mode', {
    userMessageLength: config.userMessage.length,
    maxSteps: config.maxSteps,
    classification: classification ? {
      complexity: classification.complexity,
      confidence: classification.confidence,
      recommendedMode: classification.recommendedMode,
    } : undefined,
  });

  // Use classification to determine if StatefulAgent should be used
  // Fall back to regex-based detection if classification not provided
  let shouldUseStatefulAgent = false;
  
  if (classification) {
    // Use classifier recommendation
    shouldUseStatefulAgent = 
      classification.complexity === 'complex' ||
      classification.recommendedMode === 'stateful-agent';
    
    log.info('Task classification result', {
      complexity: classification.complexity,
      confidence: classification.confidence,
      reasoning: classification.reasoning?.slice(0, 3),
    });
  } else {
    // Fallback to regex-based detection (backward compatibility)
    const isComplexTask = /(create|build|implement|refactor|migrate|add feature|new file|multiple files|project structure|full-stack|application|service|api|component|page|dashboard|authentication|database|integration|deployment|setup|initialize|scaffold|generate|boilerplate)/i.test(config.userMessage);
    const hasMultipleSteps = /\b(and|then|after|before|first|next|finally|also|plus)\b/i.test(config.userMessage);
    const mentionsFiles = /\b(file|files|folder|directory|component|page|module|service|api)\b/i.test(config.userMessage);
    shouldUseStatefulAgent = isComplexTask || (hasMultipleSteps && mentionsFiles);
    
    log.info('Using fallback regex-based task detection', {
      isComplexTask,
      hasMultipleSteps,
      mentionsFiles,
    });
  }

  if (shouldUseStatefulAgent && process.env.ENABLE_STATEFUL_AGENT !== 'false') {
    log.info('Complex task detected, using StatefulAgent for Plan-Act-Verify workflow', {
      classification: classification?.complexity,
      confidence: classification?.confidence,
    });
    return await runStatefulAgentMode(config);
  }

  log.info('Simple task detected, using OpenCode Engine', { 
    classification: classification?.complexity || 'unknown',
  });

  // Use OpenCode Engine for simpler tasks
  const engineConfig: OpenCodeEngineConfig = {
    model: process.env.OPENCODE_MODEL,
    systemPrompt: config.systemPrompt || 'You are an expert software engineer with full bash and file system access. Use tools to complete tasks efficiently.',
    maxSteps: config.maxSteps || 20,
    timeout: 300000,
    enableBash: true,
    enableFileOps: true,
    enableCodegen: true,
    onStreamChunk: config.onStreamChunk,
    onToolCall: (tool, args) => {
      config.onToolExecution?.(tool, args, { success: true, output: 'Tool called' });
    },
  };


  const engine = createOpenCodeEngine(engineConfig);
  const result = await engine.execute(config.userMessage);

  if (!result.success) {
    throw new Error(result.error || 'OpenCode engine failed');
  }

  // Convert OpenCode result to unified format
  const steps = [
    ...(result.bashCommands || []).map(cmd => ({
      toolName: 'execute_bash' as const,
      args: { command: cmd.command },
      result: {
        success: cmd.exitCode === 0,
        output: cmd.output,
        exitCode: cmd.exitCode,
      },
    })),
    ...(result.fileChanges || []).map(file => ({
      toolName: 'file_operation' as const,
      args: { path: file.path, action: file.action },
      result: {
        success: true,
        output: `File ${file.action}: ${file.path}`,
      },
    })),
  ];

  return {
    success: true,
    response: result.response,
    steps,
    totalSteps: result.steps,
    mode: 'v2-native',
    metadata: {
      provider: 'opencode-engine',
      model: result.metadata?.model,
      duration: Date.now() - startTime,
      tokensUsed: result.metadata?.tokensUsed,
    },
  };
}

/**
 * Run Desktop mode - Local execution via Tauri desktop provider
 * Uses the user's local filesystem and shell directly without cloud sandboxes.
 */
async function runDesktopMode(
  config: UnifiedAgentConfig,
  classification?: TaskClassification
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  log.info('Running Desktop mode (local execution)', {
    userMessageLength: config.userMessage.length,
    classification: classification?.complexity,
  });

  // Desktop mode uses the StatefulAgent with a desktop sandbox provider
  // for complex tasks, or the OpenCode engine for simple tasks
  const shouldUseStatefulAgent = classification
    ? classification.complexity === 'complex' || classification.recommendedMode === 'stateful-agent'
    : /(create|build|implement|refactor|migrate)/i.test(config.userMessage);

  if (shouldUseStatefulAgent && process.env.ENABLE_STATEFUL_AGENT !== 'false') {
    log.info('Desktop: Complex task, routing to StatefulAgent with desktop provider');
    return await runStatefulAgentMode(config);
  }

  // For simple tasks, use the OpenCode engine with desktop sandbox
  try {
    const engineConfig: OpenCodeEngineConfig = {
      model: process.env.OPENCODE_MODEL,
      systemPrompt: config.systemPrompt || 'You are an expert software engineer running on the user\'s desktop. You have direct access to the local filesystem and shell. Execute commands freely to complete tasks.',
      maxSteps: config.maxSteps || 25,
      timeout: 300000,
      enableBash: true,
      enableFileOps: true,
      enableCodegen: true,
      onStreamChunk: config.onStreamChunk,
      onToolCall: (tool, args) => {
        config.onToolExecution?.(tool, args, { success: true, output: 'Tool called' });
      },
    };

    const engine = createOpenCodeEngine(engineConfig);
    const result = await engine.execute(config.userMessage);

    if (!result.success) {
      throw new Error(result.error || 'Desktop execution failed');
    }

    const steps = [
      ...(result.bashCommands || []).map(cmd => ({
        toolName: 'execute_bash' as const,
        args: { command: cmd.command },
        result: {
          success: cmd.exitCode === 0,
          output: cmd.output,
          exitCode: cmd.exitCode,
        },
      })),
      ...(result.fileChanges || []).map(file => ({
        toolName: 'file_operation' as const,
        args: { path: file.path, action: file.action },
        result: {
          success: true,
          output: `File ${file.action}: ${file.path}`,
        },
      })),
    ];

    return {
      success: true,
      response: result.response,
      steps,
      totalSteps: result.steps,
      mode: 'desktop',
      metadata: {
        provider: 'desktop',
        model: result.metadata?.model,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    log.error('Desktop mode failed, falling back to V1 API', error);
    // Fall back to V1 API if desktop execution fails
    return await runV1Api(config);
  }
}

/**
 * Run StatefulAgent mode - Plan-Act-Verify workflow for complex tasks
 * Uses comprehensive orchestration with task decomposition, self-healing, and verification
 */
async function runStatefulAgentMode(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  // Initialize project-scoped services if projectContext provided
  let projectServices: ReturnType<typeof getProjectServices> | null = null;
  if (config.projectContext) {
    projectServices = getProjectServices(config.projectContext);
  }

  try {
    const agentOptions: StatefulAgentOptions = {
      sessionId: config.projectContext?.id || `unified-${Date.now()}`,
      maxSelfHealAttempts: parseInt(process.env.STATEFUL_AGENT_MAX_SELF_HEAL_ATTEMPTS || '3'),
      enforcePlanActVerify: true,
      enableReflection: process.env.STATEFUL_AGENT_ENABLE_REFLECTION !== 'false',
      enableTaskDecomposition: process.env.STATEFUL_AGENT_ENABLE_TASK_DECOMPOSITION !== 'false',
      enableCapabilityChaining: process.env.STATEFUL_AGENT_ENABLE_CAPABILITY_CHAINING !== 'false',
      enableBootstrappedAgency: process.env.STATEFUL_AGENT_ENABLE_BOOTSTRAPPED_AGENCY !== 'false',
      // Pass project-scoped retrieval for project-isolated memory access
      projectServices: projectServices || undefined,
    };

    const agent = new StatefulAgent(agentOptions);
    const result: StatefulAgentResult = await agent.run(config.userMessage);

    // Convert StatefulAgent result to unified format
    const steps = result.vfs ? Object.entries(result.vfs).map(([path, content]) => ({
      toolName: 'write_file' as const,
      args: { path, content },
      result: { success: true, output: `Written ${path}` },
    })) : [];

    // FIX: Throw on failure to trigger fallback instead of returning unsuccessful result
    if (!result.success) {
      const error = result.errors?.[0] || 'StatefulAgent failed';
      throw new Error(typeof error === 'string' ? error : JSON.stringify(error));
    }

    return {
      success: result.success,
      response: result.response,
      steps,
      totalSteps: result.steps,
      mode: 'v2-native',  // StatefulAgent runs as V2 native
      metadata: {
        provider: 'stateful-agent',
        duration: Date.now() - startTime,
        filesModified: result.vfs ? Object.keys(result.vfs).length : 0,
        errors: result.errors?.length || 0,
        reflectionEnabled: agentOptions.enableReflection,
        taskDecompositionEnabled: agentOptions.enableTaskDecomposition,
      },
    };
  } catch (error: any) {
    log.error('StatefulAgent mode failed:', error.message);
    throw error;  // Let fallback handle it
  }
}

/**
 * Run V2 containerized mode (OpenCode in sandbox) - PRIMARY ENGINE
 */
async function runV2Containerized(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  
  // Use OpenCode Engine as primary agentic engine
  const engineConfig: OpenCodeEngineConfig = {
    systemPrompt: config.systemPrompt,
    model: process.env.OPENCODE_MODEL,

    maxSteps: config.maxSteps,
    timeout: 300000,
  } as any;

  
  const engine = createOpenCodeEngine(engineConfig);
  const result = await engine.execute(config.userMessage);
  
  if (!result.success) {
    throw new Error(result.error || 'OpenCode engine failed');
  }
  
  return {
    success: true,
    response: result.response,
    steps: (result.bashCommands || []).map(cmd => ({
      toolName: 'execute_command',
      args: { command: cmd.command },
      result: {
        success: cmd.exitCode === 0,
        output: cmd.output,
        exitCode: cmd.exitCode,
      },
    })),
    totalSteps: result.steps,
    mode: 'v2-containerized',
    metadata: {
      provider: 'opencode-engine',
      duration: Date.now() - startTime,
      commandsExecuted: result.bashCommands?.length || 0,
      filesModified: result.fileChanges?.length || 0,
    },
  };
}

/**
 * Run V2 local mode (OpenCode CLI spawned locally) - PRIMARY ENGINE
 */
async function runV2Local(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  
  // Use OpenCode Engine as primary agentic engine
  const engineConfig: OpenCodeEngineConfig = {
    systemPrompt: config.systemPrompt,
    model: process.env.OPENCODE_MODEL,
    maxSteps: config.maxSteps,
    timeout: 300000,
  } as any;
  
  const engine = createOpenCodeEngine(engineConfig);
  const result = await engine.execute(config.userMessage);
  
  if (!result.success) {
    throw new Error(result.error || 'OpenCode engine failed');
  }
  
  return {
    success: true,
    response: result.response,
    steps: (result.bashCommands || []).map(cmd => ({
      toolName: 'execute_command',
      args: { command: cmd.command },
      result: {
        success: cmd.exitCode === 0,
        output: cmd.output,
        exitCode: cmd.exitCode,
      },
    })),
    totalSteps: result.steps,
    mode: 'v2-local',
    metadata: {
      provider: 'opencode-engine',
      duration: Date.now() - startTime,
    },
  };
}


/**
 * Run V1 API mode (LLM provider API)
 */
async function runV1Api(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  // Build messages from conversation history + current message
  const messages: any[] = [
    ...(config.conversationHistory || []),
    { role: 'user', content: config.userMessage },
  ];


  // Get LLM provider
  const llmProvider = getLLMProvider();

  // Ensure tool system is initialized before using capabilities
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: (config as any).userId || 'system', enableMCP: true, enableSandbox: true });
  }

  // Check if provider supports tools
  const supportsTools = 'supportsTools' in llmProvider && (llmProvider as any).supportsTools();

  if (supportsTools && config.tools && config.tools.length > 0 && config.executeTool) {
    // Use agent loop with tools
    return await runV1ApiWithTools(config, messages, llmProvider, startTime);
  } else {
    // Simple completion without tools
    return await runV1ApiCompletion(config, messages, llmProvider, startTime);
  }
}

/**
 * Run Mastra Workflow mode
 * Executes task via Mastra workflow engine with proper tracking
 */
async function runMastraWorkflow(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  const workflowId = config.workflowId || 'code-agent';

  try {
    log.info('Executing Mastra workflow', { workflowId, userMessage: config.userMessage.substring(0, 100) });

    // Execute workflow via Mastra integration
    const workflowResult = await mastraWorkflowIntegration.executeWorkflow(workflowId, {
      task: config.userMessage,
      ownerId: config.sandboxId || 'default',
      systemPrompt: config.systemPrompt,
      maxSteps: config.maxSteps,
    });

    // FIX: Throw on failure to trigger fallback instead of returning unsuccessful result
    if (!workflowResult.success) {
      throw new Error(workflowResult.error || 'Mastra workflow execution failed');
    }

    // Convert workflow result to unified format
    const steps = workflowResult.steps?.map(step => ({
      toolName: step.id,
      args: step.result || {},
      result: {
        success: step.status === 'completed',
        output: JSON.stringify(step.result),
      },
    })) || [];

    return {
      success: true,
      response: workflowResult.result?.response || 'Workflow executed successfully',
      steps,
      totalSteps: steps.length,
      mode: 'mastra-workflow',
      metadata: {
        provider: 'mastra',
        workflowId,
        duration: Date.now() - startTime,
        workflowSteps: workflowResult.steps?.map(s => ({
          id: s.id,
          name: s.name,
          status: s.status,
        })),
      },
    };
  } catch (error: any) {
    log.error('Mastra workflow execution failed', { workflowId, error: error.message });
    throw error; // Re-throw to trigger fallback
  }
}

/**
 * Create a capability-based tool executor that uses the centralized tool system
 * This enables all execution paths (v1, v2, streaming, non-Mastra) to use the same tool capabilities
 *
 * Expanded capability map covers: file operations, bash/terminal, search/glob, MCP tools
 */
function createCapabilityToolExecutor(config: UnifiedAgentConfig) {
  return async (name: string, args: Record<string, any>): Promise<ToolResult> => {
    const capabilityMap: Record<string, string> = {
      'file_operation': 'file.read', 'read_file': 'file.read', 'write_file': 'file.write',
      'edit_file': 'file.write', 'delete_file': 'file.delete', 'list_directory': 'file.list',
      'list_dir': 'file.list', 'ls': 'file.list',
      'search_files': 'file.search', 'grep': 'file.search', 'glob': 'file.search', 'find': 'file.search',
      'execute_bash': 'sandbox.execute', 'execute_command': 'sandbox.execute', 'execute': 'sandbox.execute',
      'bash': 'sandbox.execute', 'shell': 'sandbox.execute', 'terminal': 'sandbox.execute', 'run': 'sandbox.execute',
      'sandbox_execute': 'sandbox.execute', 'sandbox_shell': 'sandbox.shell', 'sandbox_session': 'sandbox.session',
      'mcp_tool': 'mcp.execute', 'mcp_execute': 'mcp.execute',
      'git': 'repo.git', 'git_clone': 'repo.clone', 'git_search': 'repo.search',
      'web_search': 'web.search', 'web_fetch': 'web.fetch',
    };

    const capabilityId = capabilityMap[name] || name;

    if (hasToolCapability(capabilityId)) {
      log.debug('Executing tool via capability', { tool: name, capability: capabilityId });
      const result = await executeToolCapability(capabilityId, args, {
        userId: config.sandboxId || 'system',
        workspaceId: config.projectContext?.id,
      });
      return { success: result.success, output: (result.output as string) || result.error, exitCode: result.exitCode };
    }

    log.debug('Capability not found, falling back to original executor', { tool: name, capability: capabilityId });
    if (config.executeTool) {
      return config.executeTool(name, args);
    }
    log.warn('No tool executor available', { tool: name, capability: capabilityId });
    return { success: false, output: 'No tool executor available', exitCode: 1 };
  };
}

/**
 * Run V1 API with tool support
 */
async function runV1ApiWithTools(
  config: UnifiedAgentConfig,
  messages: Array<{ role: string; content: string }>,
  llmProvider: LLMProvider,
  startTime: number
): Promise<UnifiedAgentResult> {
  // Ensure tool system is initialized for capability-based execution
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: (config as any).userId || 'system', enableMCP: true, enableSandbox: true });
  }

  // Use the shared capability-based tool executor (avoids code duplication)
  const capabilityExecuteTool = createCapabilityToolExecutor(config);

  // Use the agent loop from sandbox
  const options = {
    userMessage: config.userMessage,
    sandboxId: config.sandboxId || 'default',
    systemPrompt:
      config.systemPrompt ||
      'You are a helpful software engineering assistant. Prefer exact, minimal edits; inspect files before changing them; use diff-style self-healing by re-reading stale files and correcting only the smallest failing region.',
    tools: config.tools || [],
    maxSteps: config.maxSteps || 15,
    executeTool: capabilityExecuteTool,
    onToolExecution: config.onToolExecution,
    onStreamChunk: config.onStreamChunk,
  };

  
  const result = await runV2AgentLoop(options);
  
  return {
    success: true,
    response: result.response || 'No response generated',
    steps: result.steps,
    totalSteps: result.totalSteps,
    mode: 'v1-api',
    metadata: {
      provider: process.env.LLM_PROVIDER || 'unknown',
      duration: Date.now() - startTime,
    },
  };
}

/**
 * Run V1 API simple completion (no tools)
 */
async function runV1Orchestrated(
  config: UnifiedAgentConfig,
  messages: any[],
  startTime: number
): Promise<UnifiedAgentResult> {
  // Ensure tool system is initialized
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: (config as any).userId || 'system', enableMCP: true, enableSandbox: true });
  }

  // Use shared capability-based tool executor (avoids code duplication)
  const capabilityExecuteTool = createCapabilityToolExecutor(config);

  const orchestratorConfig: OrchestratorConfig = {
    iterationConfig: {
      maxIterations: config.maxSteps || parseInt(process.env.LLM_AGENT_TOOLS_MAX_ITERATIONS || '10', 10),
      maxTokens: config.maxTokens || 32000,
      maxDurationMs: parseInt(process.env.LLM_AGENT_TOOLS_TIMEOUT_MS || '60000', 10),
    },
    tools: config.tools || [],
    executeTool: capabilityExecuteTool,
  };

  const orchestrator = new AgentOrchestrator(orchestratorConfig);
  let content = '';
  let stepsCount = 0;
  const steps: any[] = [];

  try {
    for await (const event of orchestrator.execute(config.userMessage, messages)) {
      if (config.onStreamChunk) {
        if (event.type === 'token') {
          config.onStreamChunk((event as any).content);
        } else if (event.type === 'phase_change') {
          config.onStreamChunk(`\n[Phase: ${event.phase}]\n`);
        } else if (event.type === 'tool_result') {
          config.onStreamChunk(`\n[Tool Result: ${event.tool}]\n`);
        } else if (event.type === 'verification_failed') {
          config.onStreamChunk(`\n[Verification Failed: retrying...]\n`);
        }
      }

      if (event.type === 'done') {
        content = event.response;
        stepsCount = event.stats?.iterations || 0;
      } else if (event.type === 'tool_result') {
        steps.push({
          toolName: event.tool,
          args: {},
          result: { success: true, output: JSON.stringify(event.result), exitCode: 0 },
        });
      }
    }

    return {
      success: true,
      response: content,
      steps,
      totalSteps: stepsCount,
      mode: 'v1-api',
      metadata: {
        provider: process.env.LLM_PROVIDER || 'unknown',
        duration: Date.now() - startTime,
        orchestrator: true,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      response: content || 'Orchestration failed',
      mode: 'v1-api',
      error: err.message,
      metadata: { duration: Date.now() - startTime },
    };
  }
}

async function runV1ApiCompletion(
  config: UnifiedAgentConfig,
  messages: any[],
  llmProvider: LLMProvider,
  startTime: number
): Promise<UnifiedAgentResult> {
  if (process.env.ENABLE_V1_ORCHESTRATOR === 'true') {
    return runV1Orchestrated(config, messages, startTime);
  }

  const llmRequest: LLMRequest = {
    messages: messages as any,
    model: process.env.LLM_MODEL || 'gpt-4o',
    temperature: config.temperature || 0.7,

    maxTokens: config.maxTokens || 4096,
    stream: !!config.onStreamChunk,
  };
  
  let content = '';
  
  if (config.onStreamChunk) {
    // Stream response
    const stream = llmService.generateStreamingResponse(llmRequest);
    
    for await (const chunk of stream) {

      if (chunk.content) {
        content += chunk.content;
        config.onStreamChunk(chunk.content);
      }
    }
  } else {
    // Non-streaming
    const response = await llmService.generateResponse(llmRequest);
    content = response.content;
  }
  
  return {
    success: true,
    response: content || 'No response generated',
    mode: 'v1-api',
    metadata: {
      provider: process.env.LLM_PROVIDER || 'unknown',
      duration: Date.now() - startTime,
    },
  };
}

/**
 * Attempt fallback to other modes on error
 *
 * Fallback chain respects task complexity:
 * - Complex tasks: StatefulAgent → OpenCode Engine → V1 API
 * - Simple tasks: OpenCode Engine → V1 API
 */
async function attemptFallback(
  config: UnifiedAgentConfig,
  failedMode: string,
  error: any,
  triedModes: Set<string> = new Set()
): Promise<UnifiedAgentResult | null> {
  // Track tried modes to prevent infinite loops
  const visitedModes = new Set(triedModes);
  visitedModes.add(failedMode);

  const health = checkProviderHealth();

  // Use task classifier for complexity detection (with regex fallback)
  let isComplexTask = false;
  try {
    const classification = await taskClassifier.classify(config.userMessage);
    isComplexTask = classification.complexity === 'complex' || classification.complexity === 'moderate';
    log.debug('Fallback classification', {
      complexity: classification.complexity,
      isComplexTask,
    });
  } catch {
    // Fallback to regex
    isComplexTask = /create|build|implement|refactor|migrate|add feature|new file|multiple files|project structure|full-stack|application|service|api|component|page/i.test(config.userMessage);
  }

  // Try fallback chain based on what failed, excluding already tried modes
  // Priority: V2 Native (with StatefulAgent for complex) → V2 Containerized → V2 Local → V1 API
  const fallbackOrder: Array<'v2-native' | 'v2-containerized' | 'v2-local' | 'v1-api'> = [];

  if (!visitedModes.has('v2-native') && failedMode !== 'v2-native' && health.v2Native) {
    fallbackOrder.push('v2-native');
  }
  if (!visitedModes.has('v2-containerized') && failedMode !== 'v2-containerized' && health.v2Containerized) {
    fallbackOrder.push('v2-containerized');
  }
  if (!visitedModes.has('v2-local') && failedMode !== 'v2-local' && health.v2Local) {
    fallbackOrder.push('v2-local');
  }
  if (!visitedModes.has('v1-api') && failedMode !== 'v1-api' && health.v1Api) {
    fallbackOrder.push('v1-api');
  }

  // Try each fallback mode
  for (const fallbackMode of fallbackOrder) {
    try {
      console.log(`[UnifiedAgent] Falling back to ${fallbackMode} after ${failedMode} failed`);

      // For complex tasks, try StatefulAgent first in v2-native mode
      if (fallbackMode === 'v2-native' && isComplexTask && process.env.ENABLE_STATEFUL_AGENT !== 'false') {
        log.info(`Fallback: Complex task detected, using StatefulAgent in ${fallbackMode}`);
        const result = await runStatefulAgentMode(config);
        if (result.success) {
          return {
            ...result,
            metadata: {
              ...result.metadata,
              fallbackFrom: failedMode,
              triedModes: Array.from(visitedModes),
            },
          };
        }
      }

      // Execute the fallback mode directly instead of recursively calling attemptFallback
      let result: UnifiedAgentResult;
      switch (fallbackMode) {
        case 'v2-native':
          result = await runV2Native(config);
          break;
        case 'v2-containerized':
          result = await runV2Containerized(config);
          break;
        case 'v2-local':
          result = await runV2Local(config);
          break;
        case 'v1-api':
          result = await runV1Api(config);
          break;
        default:
          continue;
      }

      if (result.success) {
        // Update metadata to show the full chain of modes that were tried
        const fallbackTriedModes = result.metadata?.triedModes || [fallbackMode];
        return {
          ...result,
          metadata: {
            ...result.metadata,
            fallbackFrom: failedMode,
            // Combine current visitedModes with the fallback's triedModes
            triedModes: [...Array.from(visitedModes), ...fallbackTriedModes],
          },
        };
      }
    } catch (fallbackError) {
      console.warn(`[UnifiedAgent] Fallback to ${fallbackMode} also failed:`, fallbackError);
      // Add the failed fallback mode to visitedModes to prevent re-trying
      visitedModes.add(fallbackMode);
      // Continue to next fallback with updated visitedModes
    }
  }

  // No fallback succeeded
  return null;
}

/**
 * Get available modes based on current configuration
 */
export function getAvailableModes(): Array<{
  mode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native';
  name: string;
  description: string;
  available: boolean;
  recommended?: boolean;
}> {
  const health = checkProviderHealth();

  return [
    {
      mode: 'v2-native',
      name: 'OpenCode Engine (Recommended)',
      description: 'Full agentic capabilities with native bash, file ops, and tool execution',
      available: health.v2Native,
      recommended: true,
    },
    {
      mode: 'v2-containerized',
      name: 'OpenCode Containerized',
      description: 'OpenCode CLI in isolated sandbox (production-ready)',
      available: health.v2Containerized,
    },
    {
      mode: 'v2-local',
      name: 'OpenCode Local',
      description: 'OpenCode CLI on your local machine',
      available: health.v2Local,
    },
    {
      mode: 'v1-api',
      name: 'LLM API (Fallback)',
      description: 'Cloud LLM APIs - simple chat only, no agentic capabilities',
      available: health.v1Api,
    },
  ];
}