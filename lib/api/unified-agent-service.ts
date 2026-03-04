/**
 * Unified Agent Service
 * 
 * Unifies V1 (LLM Chat API) and V2 (OpenCode Containerized) into a single interface.
 * Automatically routes requests based on configuration and availability.
 * 
 * Features:
 * - Automatic V1 ↔ V2 routing based on LLM_PROVIDER and OPENCODE_CONTAINERIZED
 * - Fallback chain: V2 (containerized) → V2 (local) → V1 (API)
 * - Tool execution support for both modes
 * - Streaming support
 * - Health checking for provider availability
 */

import type { ToolResult } from '../sandbox/types';
import type { LLMProvider } from '../sandbox/providers/llm-provider';
import { getLLMProvider } from '../sandbox/providers/llm-factory';

import { runAgentLoop as runV2AgentLoop } from '../sandbox/agent-loop';
import { llmService, type LLMRequest } from './llm-providers';
import { 
  createOpenCodeEngine, 
  type OpenCodeEngineResult,
  type OpenCodeEngineConfig,
} from './opencode-engine-service';

export interface UnifiedAgentConfig {
  // Core
  userMessage: string;
  sandboxId?: string;
  systemPrompt?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  
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
  mode?: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'auto';
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
  mode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native';
  error?: string;
  metadata?: {
    model?: string;
    provider?: string;
    duration?: number;
    [key: string]: any;
  };
}


export interface ProviderHealth {
  v2Containerized: boolean;
  v2Local: boolean;
  v2Native: boolean;  // OpenCode CLI directly (new primary engine)
  v1Api: boolean;
  preferredMode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native';
}

/**
 * Check provider health and availability
 */
export function checkProviderHealth(): ProviderHealth {
  const containerized = process.env.OPENCODE_CONTAINERIZED === 'true';
  const sandboxProvider = process.env.SANDBOX_PROVIDER || 'daytona';
  const sandboxKey = process.env[`${sandboxProvider.toUpperCase()}_API_KEY`];

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

  // Determine preferred mode - OPENCODE V2 IS PRIMARY FOR AGENCY
  let preferredMode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' = 'v1-api';

  if (v2Native) {
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
    preferredMode,
  };
}

/**
 * Determine which mode to use based on config and health
 */
function determineMode(config: UnifiedAgentConfig): 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' {
  // Explicit mode override
  if (config.mode && config.mode !== 'auto') {
    return config.mode;
  }

  // Auto-detect from environment
  const health = checkProviderHealth();
  return health.preferredMode;
}

/**
 * Unified agent request processor
 *
 * Routes to OpenCode V2 Engine (primary) or V1 API (fallback) based on configuration.
 * Implements fallback chain for reliability.
 */
export async function processUnifiedAgentRequest(
  config: UnifiedAgentConfig
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  const mode = determineMode(config);

  try {
    switch (mode) {
      case 'v2-native':
        return await runV2Native(config);

      case 'v2-containerized':
        return await runV2Containerized(config);

      case 'v2-local':
        return await runV2Local(config);

      case 'v1-api':
      default:
        return await runV1Api(config);
    }
  } catch (error) {
    // Attempt fallback on error
    const fallbackResult = await attemptFallback(config, mode, error);

    if (fallbackResult) {
      return {
        ...fallbackResult,
        metadata: {
          ...fallbackResult.metadata,
          fallbackFrom: mode,
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
      },
    };
  }
}

/**
 * Run V2 Native mode - OpenCode CLI as primary agentic engine
 * This is the MAIN mode for agentic tasks with native bash/file ops
 */
async function runV2Native(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  // Use OpenCode Engine as primary agentic engine
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
 * Run V1 API with tool support
 */
async function runV1ApiWithTools(
  config: UnifiedAgentConfig,
  messages: Array<{ role: string; content: string }>,
  llmProvider: LLMProvider,
  startTime: number
): Promise<UnifiedAgentResult> {
  // Use the agent loop from sandbox
  const options = {
    userMessage: config.userMessage,
    sandboxId: config.sandboxId || 'default',
    systemPrompt: config.systemPrompt || 'You are a helpful AI assistant.',
    tools: config.tools || [],
    maxSteps: config.maxSteps || 15,
    executeTool: config.executeTool!,
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
async function runV1ApiCompletion(
  config: UnifiedAgentConfig,
  messages: any[],
  llmProvider: LLMProvider,
  startTime: number
): Promise<UnifiedAgentResult> {
  // Use LLM service for simple completion
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
 */
async function attemptFallback(
  config: UnifiedAgentConfig,
  failedMode: string,
  error: any
): Promise<UnifiedAgentResult | null> {
  const health = checkProviderHealth();

  // Try fallback chain based on what failed
  // Priority: V2 Native → V2 Containerized → V2 Local → V1 API
  const fallbackOrder: Array<'v2-native' | 'v2-containerized' | 'v2-local' | 'v1-api'> = [];

  if (failedMode !== 'v2-native' && health.v2Native) {
    fallbackOrder.push('v2-native');
  }
  if (failedMode !== 'v2-containerized' && health.v2Containerized) {
    fallbackOrder.push('v2-containerized');
  }
  if (failedMode !== 'v2-local' && health.v2Local) {
    fallbackOrder.push('v2-local');
  }
  if (failedMode !== 'v1-api' && health.v1Api) {
    fallbackOrder.push('v1-api');
  }

  // Try each fallback mode
  for (const fallbackMode of fallbackOrder) {
    try {
      console.log(`[UnifiedAgent] Falling back to ${fallbackMode} after ${failedMode} failed`);

      const result = await processUnifiedAgentRequest({
        ...config,
        mode: fallbackMode,
      });

      if (result.success) {
        return result;
      }
    } catch (fallbackError) {
      console.warn(`[UnifiedAgent] Fallback to ${fallbackMode} also failed:`, fallbackError);
      // Continue to next fallback
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
