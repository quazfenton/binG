/**
 * Vercel AI SDK Streaming Integration
 *
 * Provides unified streaming interface across all providers using Vercel AI SDK.
 * Benefits:
 * - Single interface for all providers (OpenAI, Anthropic, Google, Mistral, etc.)
 * - Automatic tool calling support with streaming tool calls
 * - Built-in reasoning stream support (Anthropic extended thinking, etc.)
 * - Better type safety with Zod validation
 * - Automatic retries and fallbacks
 * - Smooth streaming for natural token flow
 * - Edge runtime compatibility
 *
 * @see https://sdk.vercel.ai/docs
 */

import {
  streamText,
  extractReasoningMiddleware,
  smoothStream,
  type Tool,
  type LanguageModelUsage,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import type { StreamingResponse, LLMMessage } from './llm-providers';
import { chatLogger } from './chat-logger';

import { getProviderForModel } from './openai-compat-wrapper';
import { tokenTracker } from './ai-caching';
import { createReasoningMiddleware, withRetry, createSmoothStream, isTokenLimitError, handleTokenLimitError } from './ai-middleware';
import { recordToolCall, shouldForceTextMode } from './tool-call-telemetry';

/**
 * Tool execution context for Vercel AI SDK tools
 */
export interface ToolExecutionContext {
  userId?: string;
  conversationId?: string;
  sessionId?: string;
  requestId?: string;
  scopePath?: string;  // VFS scope path for session-scoped file operations (e.g., "project/sessions/001")
  /** The last user message — used for trigger-matching powers so only relevant
   *  action-tools are registered (avoids bloating the LLM tool list). */
  lastUserMessage?: string;
  [key: string]: any;
}

/**
 * Provider types supported by Vercel AI SDK
 */
export type VercelProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'openrouter' | 'vercel';

/**
 * CLI providers that spawn local binaries instead of using API calls.
 * These providers should NOT be routed through Vercel AI SDK streaming.
 * Instead, they need their own binary spawn logic.
 */
export const CLI_PROVIDERS = ['opencode-cli', 'pi', 'kilocode', 'codex', 'amp', 'claude-code'] as const;
export type CLIProvider = typeof CLI_PROVIDERS[number];

/**
 * Check if a provider is a CLI provider that spawns local binaries
 */
export function isCLIProvider(provider: string): boolean {
  return (CLI_PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Check if a CLI provider is properly configured with required env vars.
 * CLI providers that aren't configured should be hidden from the UI selector
 * to avoid confusing UX where options appear but don't work.
 * 
 * Each CLI provider requires different env vars:
 * - opencode-cli: OPENCODE_MODEL (optional, uses default if not set)
 * - pi: PI_BASE_URL or local pi binary
 * - kilocode: KILO_BASE_URL or local kilocode binary
 * - codex: CODEX_BASE_URL or local codex binary  
 * - amp: AMP_BASE_URL or local amp binary
 * - claude-code: CLAUDE_CODE_BASE_URL or local claude binary
 */
export function isCLIProviderConfigured(provider: string): boolean {
  if (!isCLIProvider(provider)) return true; // Non-CLI providers don't need filtering
  
  const currentEnv: any = typeof process !== 'undefined' ? process.env : {};
  
  switch (provider) {
    case 'opencode-cli':
      // Configured if OPENCODE_MODEL is set OR binary is available
      return !!(currentEnv.OPENCODE_MODEL || currentEnv.OPENCODE_CLI_BASE_URL);
    case 'pi':
      // Configured if PI_BASE_URL is set (SDK mode) OR binary is available
      return !!(currentEnv.PI_BASE_URL);
    case 'kilocode':
      // Configured if KILO_BASE_URL is set
      return !!(currentEnv.KILO_BASE_URL || currentEnv.KILO_API_KEY);
    case 'codex':
      // Configured if CODEX_BASE_URL is set
      return !!(currentEnv.CODEX_BASE_URL || currentEnv.CODEX_API_KEY);
    case 'amp':
      // Configured if AMP_BASE_URL is set
      return !!(currentEnv.AMP_BASE_URL || currentEnv.AMP_API_KEY);
    case 'claude-code':
      // Configured if CLAUDE_CODE_BASE_URL is set OR binary is available
      return !!(currentEnv.CLAUDE_CODE_BASE_URL || currentEnv.OPENAI_API_KEY);
    default:
      return false;
  }
}

/**
 * Error thrown when a CLI provider is routed to Vercel AI SDK
 */
export class CLIProviderError extends Error {
  readonly provider: string;
  readonly isCLIProvider: true = true;

  constructor(provider: string, message: string) {
    super(message);
    this.name = 'CLIProviderError';
    this.provider = provider;
  }
}

/**
 * Instructions for models that don't support function calling.
 * Tells the model to use text-based formats for file operations.
 */
const TEXT_MODE_TOOL_INSTRUCTIONS = `
## FILE OPERATIONS (REQUIRED FORMAT)

You do NOT have function calling. Use ONLY these exact formats for file operations:

### CREATE/OVERWRITE FILE
\`\`\`file: path/to/file.ext
complete file content here (no truncation)
\`\`\`

### EDIT FILE (unified diff format)
\`\`\`diff: path/to/file.ext
--- a/path/to/file.ext
+++ b/path/to/file.ext
@@ -1,3 +1,4 @@
 context line
-line to remove
+line to add
+new line
\`\`\`

### CREATE DIRECTORY
\`\`\`mkdir: path/to/directory
\`\`\`

### DELETE FILE
\`\`\`delete: path/to/file.ext
\`\`\`

### MULTIPLE FILES (use separate blocks)
\`\`\`file: src/a.ts
content of a.ts
\`\`\`

\`\`\`file: src/b.ts
content of b.ts
\`\`\`

### CRITICAL RULES
1. ONE file per \`\`\`file:\`\`\` or \`\`\`diff:\`\`\` block
2. Use COMPLETE file content (never truncate with "..." or "// rest of file")
3. Do NOT mix explanations inside file blocks
4. Do NOT describe file operations in plain text — use the block formats above
5. Paths are relative to workspace (e.g., "src/app.tsx", not "/src/app.tsx")
`;

/**
 * Options for Vercel AI SDK streaming
 */
export interface VercelStreamOptions {
  provider: VercelProvider | string;
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseURL?: string;
  signal?: AbortSignal;
  tools?: Record<string, Tool>;
  toolCallStreaming?: boolean;
  smoothStreaming?: boolean;
  maxRetries?: number;
  maxSteps?: number;
  /** Request timeout in milliseconds (default: 120s) */
  timeoutMs?: number;
  /** Provider-specific settings (e.g., Anthropic cache control) */
  providerOptions?: Record<string, any>;
}

/**
 * Provider configuration for OpenAI-compatible providers
 * 
 * NOTE: OpenRouter requires compatibility mode to use Chat Completions API
 * instead of the new Responses API (which some models don't support)
 */
interface OpenAICompatibleConfig {
  baseURL: string;
  apiKeyEnv: string;
  /** Use Chat Completions API (.chat) instead of Responses API (default) */
  useChatEndpoint?: boolean;
}

/**
 * Configuration for all OpenAI-compatible providers.
 * Providers with `useChatEndpoint: true` use the Chat Completions API
 * via `provider.chat(model)` instead of the Responses API `provider(model)`.
 */
const OPENAI_COMPATIBLE_PROVIDERS: Record<string, OpenAICompatibleConfig> = {
  chutes: {
    baseURL: process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1',
    apiKeyEnv: 'CHUTES_API_KEY',
  },
  github: {
    baseURL: process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com',
    apiKeyEnv: 'GITHUB_MODELS_API_KEY',
  },
  zen: {
    baseURL: process.env.ZEN_BASE_URL || 'https://api.zen.ai/v1',
    apiKeyEnv: 'ZEN_API_KEY',
  },
  nvidia: {
    baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    // NVIDIA only supports Chat Completions API — use .chat(model) instead of (model)
    useChatEndpoint: true,
  },
  together: {
    baseURL: process.env.TOGETHER_BASE_URL || 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    useChatEndpoint: true,
  },
  groq: {
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    useChatEndpoint: true,
  },
  fireworks: {
    baseURL: process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    useChatEndpoint: true,
  },
  anyscale: {
    baseURL: process.env.ANYSCALE_BASE_URL || 'https://api.endpoints.anyscale.com/v1',
    apiKeyEnv: 'ANYSCALE_API_KEY',
    useChatEndpoint: true,
  },
  deepinfra: {
    baseURL: process.env.DEEPINFRA_BASE_URL || 'https://api.deepinfra.com/v1/openai',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
    useChatEndpoint: true,
  },
  lepton: {
    baseURL: process.env.LEPTON_BASE_URL || 'https://models.lepton.ai/v1',
    apiKeyEnv: 'LEPTON_API_KEY',
    useChatEndpoint: true,
  },
  openrouter: {
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    useChatEndpoint: true,  // OpenRouter needs Chat Completions format for most models
  },
  livekit: {
    baseURL: process.env.LIVEKIT_BASE_URL || 'https://inference.livekit.io',
    apiKeyEnv: 'LIVEKIT_API_KEY',
  },
};

/**
 * Get Vercel AI SDK model from provider config
 *
 * Supports:
 * 1. Direct Vercel AI SDK providers (OpenAI, Anthropic, Google, Mistral)
 * 2. OpenAI-compatible providers (NVIDIA, GitHub, Groq, etc.)
 * 3. Custom providers via compatibility wrapper (Zo, etc.)
 * 
 * FIX: Added better error handling and provider validation for ToolLoopAgent compatibility
 * Also validates that model name doesn't look like a provider name
 * 
 * NOTE: CLI providers (opencode-cli, pi, etc.) should NOT be routed here.
 * Use their own binary spawn logic instead.
 */
export function getVercelModel(
  provider: VercelProvider | string,
  model: string,
  apiKey?: string,
  baseURL?: string
) {
  // CRITICAL: CLI providers should not be routed to Vercel AI SDK
  // They spawn local binaries and have their own streaming logic
  if (isCLIProvider(provider)) {
    chatLogger.error('[CLI-PROVIDER-ERROR] CLI provider routed to Vercel AI SDK', {
      provider,
      model,
      error: 'CLI providers (opencode-cli, pi, etc.) must use binary spawn path, not Vercel AI SDK',
      solution: 'Use the provider\'s spawn method (e.g., piProviders.runAgentLoop, OpencodeV2Provider.runAgentLoop)',
    });
    throw new CLIProviderError(
      provider,
      `Provider "${provider}" is a CLI provider that spawns local binaries. ` +
      `It must NOT be routed through Vercel AI SDK. ` +
      `Use the provider's native spawn method (e.g., opencode-cli spawn, pi binary) instead.`
    );
  }

  const currentEnv: any = typeof process !== 'undefined' ? process.env : {};

  // Guard against undefined/null model — use env default
  const modelName = model || currentEnv.DEFAULT_MODEL || 'gpt-4o';

  // Validate model name - catch common mistakes where provider is passed as model
  const providerNames = ['openai', 'anthropic', 'google', 'mistral', 'openrouter', 'groq', 'together', 'chutes'];
  if (providerNames.includes(modelName.toLowerCase())) {
    chatLogger.error('Model name appears to be a provider name', {
      provider,
      model: modelName,
      hint: `Did you mean to use a specific model like 'gpt-4o', 'claude-sonnet-4-5', or 'mistral-large-latest'?`,
    });
    // Don't throw - let it fail naturally if the provider accepts it
  }

  // Validate provider is configured (has API key)
  const requiredEnvVars: Record<string, string> = {
    'openai': 'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'google': 'GOOGLE_API_KEY',
    'mistral': 'MISTRAL_API_KEY',
    'openrouter': 'OPENROUTER_API_KEY',
    'vercel': 'VERCEL_API_KEY',
    'chutes': 'CHUTES_API_KEY',
    'github': 'GITHUB_MODELS_API_KEY',
    'nvidia': 'NVIDIA_API_KEY',
    'together': 'TOGETHER_API_KEY',
    'groq': 'GROQ_API_KEY',
    'fireworks': 'FIREWORKS_API_KEY',
    'anyscale': 'ANYSCALE_API_KEY',
    'deepinfra': 'DEEPINFRA_API_KEY',
    'lepton': 'LEPTON_API_KEY',
  };

  const requiredEnvVar = requiredEnvVars[provider.toLowerCase()];
  if (requiredEnvVar && !apiKey && !currentEnv[requiredEnvVar]) {
    chatLogger.warn(`Provider ${provider} may not be configured (missing ${requiredEnvVar})`);
  }

  // Check for custom providers requiring compatibility wrapper first
  if (provider === 'zo') {
    try {
      chatLogger.info('Using Zo compatibility wrapper', { provider, model });
      const zoProvider = getProviderForModel('zo', model || 'zo');
      return zoProvider;
    } catch (error: any) {
      chatLogger.warn('Zo wrapper failed, will use fallback', {
        error: error.message,
      });
      // Fall through to OpenAI fallback
    }
  }

  // Handle OpenAI-compatible providers
  if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'google' && provider !== 'mistral' && provider !== 'vercel') {
    const config = OPENAI_COMPATIBLE_PROVIDERS[provider];
    if (config) {
      const openai = createOpenAI({
        apiKey: apiKey || currentEnv[config.apiKeyEnv],
        baseURL: baseURL || config.baseURL,
      });
      // Some providers (NVIDIA, etc.) only support Chat Completions API, not Responses API
      return config.useChatEndpoint ? openai.chat(model) : openai(model);
    }

    // Unknown provider, try OpenAI as fallback
    chatLogger.warn('Unknown provider, using OpenAI as fallback', { provider, model });
    const openai = createOpenAI({
      apiKey: apiKey || currentEnv.OPENAI_API_KEY,
      baseURL: baseURL || currentEnv.OPENAI_BASE_URL,
    });
    return openai(model);
    }

    // Direct Vercel AI SDK providers
  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: apiKey || currentEnv.OPENAI_API_KEY,
        baseURL: baseURL || currentEnv.OPENAI_BASE_URL,
      });
      return openai(model);
    }

    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: apiKey || currentEnv.ANTHROPIC_API_KEY,
        baseURL: baseURL || currentEnv.ANTHROPIC_BASE_URL,
      });
      return anthropic(model);
    }

    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: apiKey || currentEnv.GOOGLE_API_KEY,
      });
      return google(model);
    }

    case 'mistral': {
      const mistral = createMistral({
        apiKey: apiKey || currentEnv.MISTRAL_API_KEY,
        baseURL: baseURL || currentEnv.MISTRAL_BASE_URL,
      });
      return mistral(model);
    }

    case 'vercel': {
      // CRITICAL: Strip 'vercel:' prefix from model ID — Vercel AI SDK expects just 'xai/grok-3', not 'vercel:xai/grok-3'
      const cleanModel = model.startsWith('vercel:') ? model.slice(7) : model;
      const openai = createOpenAI({
        apiKey: apiKey || currentEnv.VERCEL_API_KEY,
        baseURL: baseURL || currentEnv.VERCEL_BASE_URL || 'https://api.vercel.com/v1',
      });
      return openai(cleanModel);
    }

    default:
      const error = new Error(`Unsupported provider for Vercel AI SDK: ${provider}`);
      chatLogger.error('Unsupported provider', { provider, model });
      throw error;
  }
}

/**
 * Convert LLMMessage to Vercel AI SDK format.
 * Extracts system messages into a separate string for the `system` parameter,
 * which is more reliable across providers than system-role messages in the array.
 */
function convertMessages(messages: LLMMessage[]): {
  chatMessages: any[];
  systemPrompt?: string;
} {
  const systemParts: string[] = [];
  const chatMessages: any[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(c => c.type === 'text').map(c => c.text || '').join(' ');
      systemParts.push(text);
      continue;
    }

    if (typeof msg.content === 'string') {
      chatMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : msg.role === 'tool' ? 'tool' : 'user',
        content: msg.content,
      });
      continue;
    }

    // Handle multi-modal content — convert images to text placeholders for now
    const textContent = msg.content
      .map(c => {
        if (c.type === 'text') return c.text || '';
        if (c.type === 'image_url') return '[Image]';
        return '';
      })
      .join(' ');

    chatMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: textContent,
    });
  }

  return {
    chatMessages,
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
  };
}

/**
 * Detect reasoning tag for providers that support extended thinking
 */
function getReasoningTag(provider: string): { tagName: string; separator?: string; startWithReasoning?: boolean; } | undefined {
  switch (provider) {
    case 'anthropic':
      return { tagName: 'thinking', separator: '</thinking>' };
    case 'google':
      return { tagName: 'thought', separator: '</thought>' };
    case 'deepseek':
      return { tagName: 'reasoning', separator: '', startWithReasoning: true };
    default:
      return undefined;
  }
}

/**
 * Stream using Vercel AI SDK
 *
 * Unified streaming interface supporting all providers with:
 * - System prompt extraction
 * - Abort signal support
 * - Smooth streaming for natural token flow
 * - Reasoning extraction for supported providers
 * - Streaming tool calls
 * - Multi-step tool execution
 * - Automatic retries
 */
export async function* streamWithVercelAI(
  optionsOrProvider: VercelStreamOptions | VercelProvider | string,
  model?: string,
  messages?: LLMMessage[],
  temperature?: number,
  maxTokens?: number,
  apiKey?: string,
  baseURL?: string
): AsyncGenerator<StreamingResponse> {
  // Support both new options-object API and legacy positional API
  let opts: VercelStreamOptions;
  if (typeof optionsOrProvider === 'object') {
    opts = optionsOrProvider;
  } else {
    opts = {
      provider: optionsOrProvider,
      model: model!,
      messages: messages!,
      temperature,
      maxTokens,
      apiKey,
      baseURL,
    };
  }

  const providerName = opts.provider;

  // CRITICAL: CLI providers must NOT be routed through Vercel AI SDK
  // They spawn local binaries (opencode-cli, pi, kilocode, etc.)
  if (isCLIProvider(providerName)) {
    chatLogger.error('[CLI-PROVIDER-ERROR] streamWithVercelAI called with CLI provider', {
      provider: providerName,
      error: 'CLI providers must use their own binary spawn streaming, not streamWithVercelAI',
      solution: 'Route CLI providers to their spawn method in enhanced-llm-service.ts',
    });
    throw new CLIProviderError(
      providerName,
      `Cannot use streamWithVercelAI for CLI provider "${providerName}". ` +
      `This provider spawns a local binary and has its own streaming logic. ` +
      `Please route it to the provider's native spawn method instead.`
    );
  }

  const {
    provider,
    model: modelName,
    messages: msgs,
    temperature: temp = 0.7,
    maxTokens: maxT = 65536,
    apiKey: key,
    baseURL: url,
    signal,
    tools,
    toolCallStreaming = true,
    smoothStreaming = true,
    maxRetries = 0,
    maxSteps = 12,
    timeoutMs = 120000, // Default 120s timeout
    providerOptions,
  } = opts;

  const startTime = Date.now();
  const requestId = `vercel-ai-${Date.now()}`;
  // Cache for tool call arguments - scoped to this stream invocation to prevent cross-request leaks
  const toolCallArgsCache = new Map<string, any>();
  let useCompatibilityFallback = false;

  // Time-to-first-token timeout: only cancels if NO content arrives within timeoutMs
  // Once first token arrives, timeout is cleared to allow long legitimate streams
  let ttftTimeoutId: NodeJS.Timeout | null = null;
  let timeoutController: AbortController | null = null;
  let firstTokenReceived = false;

  if (timeoutMs > 0) {
    timeoutController = new AbortController();
    
    // Chain with existing signal if present
    if (signal) {
      signal.addEventListener('abort', () => {
        timeoutController?.abort(signal.reason);
        if (ttftTimeoutId) clearTimeout(ttftTimeoutId);
      }, { once: true });
    }
    
    // Set time-to-first-token timeout
    ttftTimeoutId = setTimeout(() => {
      if (!firstTokenReceived) {
        timeoutController?.abort(new Error(`No response within ${timeoutMs}ms (time-to-first-token timeout)`));
      }
    }, timeoutMs);
  }

  const effectiveSignal = timeoutController?.signal || signal;
  
  // Helper to clear TTFT timeout once first token arrives
  const onFirstToken = () => {
    if (!firstTokenReceived) {
      firstTokenReceived = true;
      if (ttftTimeoutId) {
        clearTimeout(ttftTimeoutId);
        ttftTimeoutId = null;
      }
    }
  };

  try {
    const vercelModel = getVercelModel(provider, modelName, key, url);
    const { chatMessages, systemPrompt } = convertMessages(msgs);

    // Custom provider handling (Zo, etc.)
    const isCustomProvider = provider === 'zo';

    if (isCustomProvider) {
      chatLogger.info('Using custom provider direct API', { provider, model: modelName });

      const { streamZoAPI } = await import('./openai-compat-wrapper');

      try {
        for await (const chunk of streamZoAPI(chatMessages as any, {
          temperature: temp,
          maxTokens: maxT,
          apiKey: key,
        })) {
          if (effectiveSignal?.aborted) return;

          if (chunk.type === 'text-delta') {
            // Clear time-to-first-token timeout once we receive content
            onFirstToken();
            
            yield {
              content: chunk.textDelta,
              isComplete: false,
              timestamp: new Date(),
            };
          } else if (chunk.type === 'finish') {
            yield {
              content: '',
              isComplete: true,
              finishReason: chunk.finishReason,
              tokensUsed: chunk.usage?.total_tokens || 0,
              usage: {
                promptTokens: chunk.usage?.prompt_tokens || 0,
                completionTokens: chunk.usage?.completion_tokens || 0,
                totalTokens: chunk.usage?.total_tokens || 0,
              },
              timestamp: new Date(),
              metadata: {
                vercelAI: true,
                provider,
                model: modelName,
                latencyMs: Date.now() - startTime,
              },
            };
          } else if (chunk.type === 'error') {
            throw new Error(chunk.error);
          }
        }
        return;
      } catch (error: any) {
        if (error.name === 'AbortError') return;
        chatLogger.error('Custom provider streaming failed', { provider, model: modelName, error: error.message });
        throw error;
      }
    }

    // Build middleware stack — skip transforms for providers with known incompatibilities.
    // Google (Gemini) throws "transform is not a function" with smoothStream in AI SDK v6.
    const supportsTransforms = provider !== 'google';
    const transforms: any[] = [];

    // Smooth streaming for natural token flow
    if (supportsTransforms && smoothStreaming && typeof smoothStream === 'function') {
      try {
        transforms.push(smoothStream({ delayInMs: 15 }));
      } catch (smoothError) {
        chatLogger.warn('smoothStream middleware failed, skipping', { error: smoothError });
      }
    }

    // Reasoning extraction for providers that support extended thinking
    const reasoningTag = getReasoningTag(provider);
    if (supportsTransforms && reasoningTag && typeof extractReasoningMiddleware === 'function') {
      try {
        transforms.push(extractReasoningMiddleware(reasoningTag));
      } catch (reasoningError) {
        chatLogger.warn('extractReasoningMiddleware failed, skipping', { error: reasoningError });
      }
    }

    // Build streamText options - only include experimental_transform if transforms exist
    const streamOptions: any = {
      model: vercelModel as any,
      messages: chatMessages,
      temperature: temp,
      maxOutputTokens: maxT,
      maxRetries,
      maxSteps,
      abortSignal: effectiveSignal,
      toolCallStreaming,
      ...(transforms.length > 0 ? { experimental_transform: transforms } : {}),
      experimental_telemetry: {
        isEnabled: false,
        functionId: 'llm-stream',
        metadata: { provider, model: modelName },
      },
    };

    // Add system prompt if present
    if (systemPrompt) {
      streamOptions.system = systemPrompt;
    }

    // Add tools if provided
    // Log the initial tools status
    const toolCount = tools ? Object.keys(tools).length : 0;
    chatLogger.info('[TOOLS-INIT] Tools configured for request', {
      provider,
      model: modelName,
      toolCount,
      toolNames: tools ? Object.keys(tools) : [],
    });

    // PROVIDER-SPECIFIC FC FIX: Some providers (NVIDIA NIM) report supportsFC=true
    // but specific models don't actually support function calling and return 400.
    // Strip tools upfront for known incompatible provider+model combos.
    let skipTools = false;
    if (tools && Object.keys(tools).length > 0) {
      // Explicit list of models that DO NOT support function calling
      const nonFCModels = [
        // NVIDIA NIM models that don't support FC
        'google/gemma-3-27b-it',
        'google/gemma-3-12b-it',
        'google/gemma-3-4b-it',
        'meta/llama-3.1-8b-instruct',
        'meta/llama-3.1-70b-instruct',
        'meta/llama-3.3-70b-instruct',
        // Mistral Small doesn't support FC reliably
        'mistral-small-latest',
        'mistral-small-2402',
        // OpenRouter free models often don't support FC
      ];

      // Explicit list of models that DO support function calling (known good)
      const knownGoodFCModels = [
        'mistral-large-latest',
        'mistral-large-2411',
        'mistral-large-2407',
        'mistral-medium-latest',
        'gpt-4',
        'gpt-3.5',
        'claude-3',
        'claude-sonnet',
        'claude-opus',
        'gemini-1.5',
        'gemini-2.0',
      ];

      // Check if current model IS in the known good list (not just substring match)
      const isKnownGoodFC = knownGoodFCModels.some(m => modelName.toLowerCase().includes(m.toLowerCase()));
      chatLogger.info('[FC-KNOWN] Checking function calling support', {
        provider,
        model: modelName,
        modelLower,
        isKnownGoodFC,
        knownGoodFCModels,
      });

      // If tool was passed BUT model is known good but SDK says unknown, force tools ON
      if (tools && Object.keys(tools).length > 0 && isKnownGoodFC && supportsFC === undefined) {
        chatLogger.info('[FC-FORCE] Model known to support FC, forcing tools ON despite SDK unknown');
        // Don't set skipTools - keep tools enabled
      }
      if (isKnownGoodFC) {
        chatLogger.info('[FC-KNOWN] Model is known to support function calling', {
          provider,
          model: modelName,
          action: 'Keeping tools enabled regardless of SDK capability flags',
        });
      }

      if (provider === 'nvidia' && nonFCModels.some(m => modelName.includes(m))) {
        skipTools = true;
        chatLogger.warn('[FC-BYPASS] NVIDIA model does not support function calling despite SDK reporting otherwise', {
          provider,
          model: modelName,
          action: 'Stripping tools and using text-mode fallback',
          knownIssue: 'NVIDIA NIM returns 400 "DEGRADED function cannot be invoked" for tool calls on these models',
        });
      }

      if (provider === 'mistral' && /mistral-small/.test(modelName) && !isKnownGoodFC) {
        skipTools = true;
        chatLogger.warn('[FC-BYPASS] Mistral Small does not support function calling reliably', {
          provider,
          model: modelName,
          action: 'Stripping tools and using text-mode fallback',
        });
      }

      // CRITICAL: If model is known good for FC, never skip tools regardless of SDK
      if (isKnownGoodFC) {
        skipTools = false;
      }
    }

    chatLogger.info('[TOOLS-FINAL] Tools assignment check', {
      hasToolsArg: !!tools,
      toolsCount: tools ? Object.keys(tools).length : 0,
      skipTools,
      provider,
      model: modelName,
    });

    chatLogger.info('[TOOLS-FINAL-BEFORE] Pre-assignment check', {
      hasToolsArg: !!tools,
      toolsCount: tools ? Object.keys(tools).length : 0,
      skipTools,
      provider,
      model: modelName,
      streamOptionsHasTools: !!streamOptions.tools,
    });

    if (tools && Object.keys(tools).length > 0 && !skipTools) {
      streamOptions.tools = tools;
      chatLogger.info('[TOOLS-FINAL] Tools assigned to streamOptions', {
        toolsCount: Object.keys(tools).length,
      });
    } else if (skipTools && tools) {
      chatLogger.warn('[TOOLS-STRIP] Provider-specific tool stripping applied', {
        provider,
        model: modelName,
        strippedToolCount: Object.keys(tools).length,
        reason: 'provider API returns 400 for tool calls on this model',
      });
      // Inject text-mode tool instructions since tools were stripped
      if (streamOptions.system) {
        streamOptions.system = streamOptions.system + '\n\n' + TEXT_MODE_TOOL_INSTRUCTIONS;
      } else {
        streamOptions.system = TEXT_MODE_TOOL_INSTRUCTIONS;
      }
    } else {
      // Log when tools are NOT provided (different from FC check)
      chatLogger.warn('[TOOLS] ⚠ No tools provided to stream - file operations will use text parsing only', {
        provider,
        model: modelName,
        hasToolsArg: !!tools,
        toolsKeys: tools ? Object.keys(tools) : [],
        implications: 'LLM will not use function calling - must rely on text-based tool parsing',
      });
    }

    // FIX: Detect if model supports function calling (Vercel AI SDK v6+).
    // If tools are passed but the model doesn't support function calling,
    // the LLM will output tool-like JSON as raw text instead of using native tool calls.
    // We detect this, strip tools, and inject text-mode instructions so the model
    // can still perform file actions using a parseable text format.
    if (streamOptions.tools) {
      const supportsFC = (vercelModel as any)?.supports?.functionCalling;
      const toolCount = Object.keys(streamOptions.tools).length;
      chatLogger.info('[FC-GATE] Checking function calling support', {
        provider,
        model: modelName,
        supportsFC,
        toolCount,
        toolNames: Object.keys(streamOptions.tools),
      });
      if (supportsFC === false) {
        // FC BYPASS - model doesn't support function calling, stripping tools
        chatLogger.error('[FC-GATE] ✗ FC BYPASSED - Model does NOT support function calling', {
          provider,
          model: modelName,
          toolCount,
          severity: 'HIGH',
          action: 'Stripping tools and using text-mode fallback',
          textModeFormats: ['```file: path\ncontent```', '```diff: path\n...```', '```mkdir: path```', '```delete: path```'],
        });
        // EXPLICITLY STRIP TOOLS - model doesn't support FC
        chatLogger.warn('[TOOLS-STRIP] Explicitly stripping tools from request (FC not supported)', {
          provider,
          model: modelName,
          strippedToolCount: toolCount,
          strippedTools: Object.keys(streamOptions.tools || {}),
          reason: 'model does not support function calling',
          fallbackMode: 'text-mode tool instructions injected into system prompt',
        });
        delete streamOptions.tools;

        // Inject text-mode tool instructions (reuse the same improved format)
        if (streamOptions.system) {
          streamOptions.system = streamOptions.system + '\n\n' + TEXT_MODE_TOOL_INSTRUCTIONS;
        } else {
          streamOptions.system = TEXT_MODE_TOOL_INSTRUCTIONS;
        }
      } else if (supportsFC === undefined) {
        // Model doesn't report this capability — could be unknown provider.
        // Auto text-mode: if telemetry shows this model fails >70% of tool calls,
        // strip tools and switch to text-mode proactively.
        if (shouldForceTextMode(modelName)) {
          chatLogger.warn('[FC-GATE] Auto text-mode: model has >70% tool failure rate', {
            provider,
            model: modelName,
            toolCount,
            action: 'Stripping tools and using text-mode fallback based on telemetry',
          });
          delete streamOptions.tools;
          if (streamOptions.system) {
            streamOptions.system = streamOptions.system + '\n\n' + TEXT_MODE_TOOL_INSTRUCTIONS;
          } else {
            streamOptions.system = TEXT_MODE_TOOL_INSTRUCTIONS;
          }
        } else {
          // TWO-PHASE STRATEGY:
          //   Phase 1: Use tools only (no text-mode instructions).
          //   Phase 2: After streaming, if zero tool calls produced, check if
          //            the response text contains tool-call patterns. If so,
          //            issue a second completion with text-mode instructions.
          chatLogger.info('[FC-GATE] Function calling ability UNKNOWN — using two-phase strategy', {
            provider,
            model: modelName,
            toolCount,
            strategy: 'Phase 1: tools only; Phase 2: text-mode fallback if no tool calls',
          });
          // Do NOT inject text-mode instructions yet — let the model try native tool calls first.
        }
      }
    } else {
      chatLogger.info('[FC-GATE] No tools provided, skipping function calling check', { provider, model: modelName });
    }

    // Provider-specific options (e.g., Anthropic cache control)
    if (providerOptions) {
      streamOptions.providerOptions = providerOptions;
    }

    const result = streamText(streamOptions);

    // Stream events including text, reasoning, and tool calls
    let reasoningContent = '';
    let textContent = ''; // Track text for two-phase FC fallback

    for await (const chunk of result.fullStream) {
      if (effectiveSignal?.aborted) return;

      switch (chunk.type as string) {
        case 'text-delta': {
          // Clear time-to-first-token timeout once we receive content
          onFirstToken();

          const deltaText = (chunk as any).text ?? '';
          textContent += deltaText; // Track for two-phase FC fallback

          yield {
            content: deltaText,
            isComplete: false,
            timestamp: new Date(),
          };
          break;
        }

        case 'reasoning-start': {
          // Clear time-to-first-token timeout once we receive any response
          onFirstToken();
          
          // reasoning-start contains reasoning content in text property for some providers
          const reasoningText = (chunk as any).text ?? '';
          reasoningContent += reasoningText;
          yield {
            content: '',
            isComplete: false,
            reasoning: reasoningText,
            timestamp: new Date(),
          };
          break;
        }

        case 'reasoning': {
          // Handle reasoning chunks emitted as 'reasoning' (not just 'reasoning-start')
          // Some providers emit reasoning as a continuous stream of 'reasoning' events
          const reasoningText = (chunk as any).text ?? (chunk as any).delta ?? '';
          reasoningContent += reasoningText;
          yield {
            content: '',
            isComplete: false,
            reasoning: reasoningText,
            timestamp: new Date(),
          };
          break;
        }

        case 'reasoning-delta': {
          // Handle reasoning-delta for providers that emit incremental reasoning
          const reasoningText = (chunk as any).text ?? (chunk as any).delta ?? '';
          reasoningContent += reasoningText;
          yield {
            content: '',
            isComplete: false,
            reasoning: reasoningText,
            timestamp: new Date(),
          };
          break;
        }

        case 'reasoning-end': {
          // Handle reasoning-end to mark reasoning completion
          yield {
            content: '',
            isComplete: false,
            reasoning: '',
            timestamp: new Date(),
          };
          break;
        }

        case 'tool-call': {
            // Clear time-to-first-token timeout once we receive any response
            onFirstToken();
            
            let callArgs = (chunk as any).args || (chunk as any).arguments || {};
            const toolName = (chunk as any).toolName;
            const toolCallId = (chunk as any).toolCallId;

            // SELF-HEALING: Normalize tool args to fix common LLM mistakes
            // (wrong field names like "filename" → "path", "code" → "content")
            try {
              const { normalizeToolArgs } = await import('../mcp/vfs-mcp-tools');
              callArgs = normalizeToolArgs(toolName, callArgs);
              (chunk as any).args = callArgs;
            } catch {
              // Normalization is best-effort
            }

            // VALIDATE REQUIRED FIELDS: Check for missing/invalid args and trigger self-healing
            let validationError = null;
            try {
              const { validateToolArgs } = await import('../orchestra/shared-agent-context');

              // Define required fields for common tools
              const requiredFields: Record<string, string[]> = {
                'write_file': ['path', 'content'],
                'read_file': ['path'],
                'list_files': ['path'],
                'delete_file': ['path'],
                'create_directory': ['path'],
                'batch_write': ['files'],
                'apply_diff': ['path', 'diff'],
                'execute_bash': ['command'],
                'search_files': ['query'],
              };

              const required = requiredFields[toolName];
              if (required) {
                validationError = validateToolArgs(toolName, callArgs, required);
              }
            } catch {
              // Validation is best-effort
            }

            const hasArgs = !!callArgs && Object.keys(callArgs).length > 0;
            const argsCount = Object.keys(callArgs).length;

            // Check for validation errors (missing required fields)
            if (validationError) {
              chatLogger.error('[TOOL-CALL] ✗ VALIDATION failed — blocking execution', {
                toolCallId,
                toolName,
                validationError,
                severity: 'HIGH',
              });

              // Record validation failure in telemetry
              if (toolName && modelName) {
                recordToolCall(modelName, toolName, false, 'INVALID_ARGS');
              }

              // Yield a synthetic tool-result failure so the model sees the error
              yield {
                content: '',
                isComplete: false,
                toolInvocations: [{
                  toolCallId,
                  toolName,
                  state: 'result',
                  args: callArgs,
                  result: {
                    success: false,
                    error: {
                      code: 'INVALID_ARGS',
                      message: validationError.message,
                      retryable: true,
                      missing: validationError.missing,
                      expectedSchema: validationError.expectedSchema,
                      suggestedNextAction: validationError.suggestedNextAction,
                    },
                  },
                }],
                timestamp: new Date(),
              };
              break;
            }

            if (hasArgs) {
              chatLogger.info('[TOOL-CALL] ✓ Tool invoked', {
                toolCallId,
                toolName,
                argsCount,
                argsKeys: Object.keys(callArgs),
                argsPreview: JSON.stringify(callArgs).slice(0, 500),
              });
            } else {
              // EMPTY ARGS — block execution, synthesize a failure result
              chatLogger.error('[TOOL-CALL] ✗ EMPTY args — blocking execution', {
                toolCallId,
                toolName,
                severity: 'HIGH',
              });

              // Record empty-args as a failure in telemetry
              if (toolName && modelName) {
                recordToolCall(modelName, toolName, false, 'EMPTY_ARGS');
              }

              // Yield a synthetic tool-result failure so the model sees the error
              // and can retry with correct args
              yield {
                content: '',
                isComplete: false,
                toolInvocations: [{
                  toolCallId,
                  toolName,
                  state: 'result',
                  args: callArgs,
                  result: {
                    success: false,
                    error: {
                      code: 'INVALID_ARGS',
                      message: `Tool "${toolName}" called with empty arguments. Please provide all required fields.`,
                      retryable: true,
                      suggestedNextAction: `Call ${toolName} again with proper arguments.`,
                    },
                  },
                }],
                timestamp: new Date(),
              };
              break;
            }

            // Cache args so tool-result can include them (AI SDK doesn't repeat args in result)
            toolCallArgsCache.set(toolCallId, callArgs);
          yield {
            content: '',
            isComplete: false,
            toolCalls: [{
              id: toolCallId,
              name: toolName,
              arguments: callArgs,
            }],
            timestamp: new Date(),
          };
          break;
        }

        case 'tool-result': {
          // Recover args from the earlier tool-call event since tool-result doesn't include them
          const resultToolCallId = (chunk as any).toolCallId;
          const cachedArgs = toolCallArgsCache.get(resultToolCallId);
          const finalArgs = cachedArgs || (chunk as any).args || (chunk as any).arguments || {};
          const toolResult = (chunk as any).result;
          const toolName = (chunk as any).toolName;
          const resultSuccess = toolResult?.success ?? (toolResult?.error === undefined);

          // Inject _recoveryHint into all failed tool results so the model sees actionable guidance
          if (!resultSuccess && toolResult && typeof toolResult === 'object') {
            const errObj = toolResult.error;
            const errMsg = typeof errObj === 'string' ? errObj : errObj?.message || '';
            if (!toolResult._recoveryHint) {
              toolResult._recoveryHint = errObj?.suggestedNextAction
                || (errObj?.code === 'PATH_NOT_FOUND' ? `Check the path and call list_files on the parent directory.` : undefined)
                || (errObj?.code === 'INVALID_ARGS' ? `Re-read the tool description and provide all required fields.` : undefined)
                || `Read the error carefully. Do NOT retry the exact same call — try a different approach.`;
            }
            // Wrap plain-string errors into structured format for consistency
            if (typeof errObj === 'string') {
              toolResult.error = {
                code: 'TOOL_ERROR',
                message: errObj,
                retryable: true,
                _recoveryHint: toolResult._recoveryHint,
              };
            }
          }

          // SELF-HEALING: Enhanced error result for validation-like errors.
          // Declared here so it's in scope for the yield below.
          let enhancedResult: unknown = toolResult;

          // ENHANCED: Log tool result with detailed info
          if (resultSuccess) {
            chatLogger.info('[TOOL-RESULT] ✓ Tool succeeded', {
              toolCallId: resultToolCallId,
              toolName,
              hasCachedArgs: !!cachedArgs,
              argsUsed: Object.keys(finalArgs),
              resultKeys: toolResult ? Object.keys(toolResult) : [],
            });
          } else {
            const errorObj = toolResult?.error;
            const errorMsg = typeof errorObj === 'string' ? errorObj : errorObj?.message || 'Unknown error';
            const isEmptyArgs = !finalArgs || Object.keys(finalArgs).length === 0;

            chatLogger.error('[TOOL-RESULT] ✗ Tool failed', {
              toolCallId: resultToolCallId,
              toolName,
              hasCachedArgs: !!cachedArgs,
              error: errorMsg,
              argsUsed: Object.keys(finalArgs),
              isEmptyArgs,
            });

            // SELF-HEALING: Enhance error message with retry guidance for validation-like errors.
            // Common validation failures: missing required fields, wrong types, empty args.
            // The AI SDK multi-step loop will let the model see this error and retry.
            const isValidationError =
              isEmptyArgs ||
              errorMsg.includes('required') ||
              errorMsg.includes('Expected') ||
              errorMsg.includes('Invalid') ||
              errorMsg.includes('validation') ||
              errorMsg.includes('EMPTY_ARGS') ||
              errorMsg.includes('cannot be');

            if (isValidationError && toolName) {
              enhancedResult = {
                ...toolResult,
                error: {
                  code: errorObj?.code || 'VALIDATION_ERROR',
                  message: `Tool "${toolName}" failed: ${errorMsg}. Please re-emit the same tool call with valid JSON arguments. Required fields: path (string), content (string) for file operations. Do not abbreviate or truncate content.`,
                  retryable: true,
                  originalError: typeof errorObj === 'string' ? errorObj : errorMsg,
                },
                _enhanced: true,
              };
            }
          }

          // Record telemetry for tool success/failure tracking
          if (toolName && modelName) {
            const errCode = typeof toolResult?.error === 'object' ? toolResult.error.code : undefined;
            recordToolCall(modelName, toolName, resultSuccess, errCode);
          }

          yield {
            content: '',
            isComplete: false,
            toolInvocations: [{
              toolCallId: resultToolCallId,
              toolName,
              state: 'result' as const,
              args: finalArgs,
              result: enhancedResult ?? toolResult,
            }],
            timestamp: new Date(),
          };
          if (cachedArgs) toolCallArgsCache.delete(resultToolCallId);
          break;
        }

        case 'error': {
          chatLogger.error('Stream error chunk', {
            requestId,
            provider,
            model: modelName,
            error: (chunk as any).error?.message || String((chunk as any).error),
          });
          throw (chunk as any).error;
        }

        case 'step-start':
        case 'step-finish':
        case 'start':
        case 'finish':
          // Skip these event types - handled elsewhere
          break;
      }
    }

    // Get final usage and metadata
    const usage = await result.usage;
    const finishReason = (await result.finishReason) || 'stop';
    const toolCalls = await result.toolCalls;
    const steps = await result.steps;

    // Cleanup timeout
    if (ttftTimeoutId) clearTimeout(ttftTimeoutId);

    // Collect all tool calls from steps (multi-step support)
    const allToolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> = [];
    if (steps) {
      for (const step of steps) {
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            allToolCalls.push({
              id: tc.toolCallId,
              name: tc.toolName,
              arguments: (tc as any).args || (tc as any).arguments || {},
            });
          }
        }
      }
    }
    // Fallback to top-level tool calls
    if (allToolCalls.length === 0 && toolCalls) {
      for (const tc of toolCalls) {
        allToolCalls.push({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: (tc as any).args || (tc as any).arguments || {},
        });
      }
    }

    // DIAGNOSTIC: Log tool call summary to help debug VFS MCP tool invocation issues
    if (tools) {
      const toolCount = Object.keys(tools).length;
      if (allToolCalls.length > 0) {
        chatLogger.info('[TOOL-SUMMARY] LLM invoked tools', {
          provider,
          model: modelName,
          toolsAvailable: toolCount,
          toolsCalled: allToolCalls.length,
          toolNames: allToolCalls.map(tc => tc.name),
        });
      } else {
        chatLogger.warn('[TOOL-SUMMARY] LLM did NOT call any tools despite tools being available', {
          provider,
          model: modelName,
          toolsAvailable: toolCount,
          toolNames: Object.keys(tools),
          finishReason,
          hint: 'Check if model supports function calling — see [FC-GATE] logs above',
        });

        // TWO-PHASE FC FALLBACK (Phase 2):
        // If supportsFC was undefined, zero tool calls were produced, and the
        // response text contains tool-call-like patterns, issue a second completion
        // with text-mode instructions.
        const supportsFC = (vercelModel as any)?.supports?.functionCalling;
        if (supportsFC === undefined && textContent) {
          // Check for tool-call patterns in text content
          const hasToolCallPattern =
            textContent.includes('"tool"') ||
            textContent.includes('"function"') ||
            textContent.includes('"name"') ||
            textContent.includes('"tool_name"') ||
            textContent.includes('"arguments"') ||
            textContent.includes('"args"') ||
            textContent.includes('"input"') ||
            textContent.includes('"batch_write"') ||
            textContent.includes('"write_file"') ||
            /```(?:file|diff|mkdir|delete):/i.test(textContent);

          if (hasToolCallPattern) {
            chatLogger.warn('[FC-GATE] Phase 2: No tool calls + tool-call patterns detected in text — retrying with text-mode instructions', {
              provider,
              model: modelName,
              textContentLength: textContent.length,
              patternsDetected: true,
            });

            // Issue second completion with text-mode instructions
            const fallbackStreamOptions = { ...streamOptions };
            delete fallbackStreamOptions.tools; // Strip tools
            if (fallbackStreamOptions.system) {
              fallbackStreamOptions.system = fallbackStreamOptions.system + '\n\n' + TEXT_MODE_TOOL_INSTRUCTIONS;
            } else {
              fallbackStreamOptions.system = TEXT_MODE_TOOL_INSTRUCTIONS;
            }

            try {
              const fallbackResult = streamText(fallbackStreamOptions);
              for await (const fallbackChunk of fallbackResult.fullStream) {
                if (effectiveSignal?.aborted) break;
                if (fallbackChunk.type === 'text-delta') {
                  yield {
                    content: (fallbackChunk as any).text ?? '',
                    isComplete: false,
                    timestamp: new Date(),
                    metadata: { fcFallback: 'text-mode' },
                  };
                }
              }
              chatLogger.info('[FC-GATE] Phase 2 fallback completed', {
                provider,
                model: modelName,
              });
            } catch (fallbackError: any) {
              chatLogger.error('[FC-GATE] Phase 2 fallback failed', {
                provider,
                model: modelName,
                error: fallbackError.message,
              });
            }
          }
        }
      }
    }

    // Final chunk with completion status and metadata
    yield {
      content: '',
      isComplete: true,
      finishReason,
      tokensUsed: usage?.totalTokens || 0,
      usage: {
        promptTokens: (usage as any).inputTokens || (usage as any).promptTokens || (usage as any).prompt_tokens || 0,
        completionTokens: (usage as any).outputTokens || (usage as any).completionTokens || (usage as any).completion_tokens || 0,
        totalTokens: usage?.totalTokens || 0,
      },
      reasoning: reasoningContent || undefined,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      timestamp: new Date(),
      metadata: {
        vercelAI: true,
        provider,
        model: modelName,
        latencyMs: Date.now() - startTime,
        steps: steps?.length || 0,
      },
    };

  } catch (error: any) {
    if (error.name === 'AbortError') {
      chatLogger.info('Vercel AI SDK streaming aborted', { requestId, provider, model: modelName });
      return;
    }

    // Check if this is a Responses API error that might work with Chat Completions format
    const isResponsesApiError = 
      error.message?.includes('Responses API') ||
      error.message?.includes('Invalid Responses API request') ||
      error.message?.includes('expected string, received array') ||
      error.message?.includes('expected reasoning_text') ||
      (error.statusCode === 400 && error.message?.includes('Invalid'));

    if (isResponsesApiError && !useCompatibilityFallback && provider === 'openrouter') {
      chatLogger.warn('Responses API failed, retrying with provider-agnostic fallback', {
        requestId,
        provider,
        model: modelName,
        error: error.message,
      });

      // Retry with provider-agnostic fallback — tries configured providers in order
      useCompatibilityFallback = true;

      const currentEnv: any = typeof process !== 'undefined' ? process.env : {};
      const fallbackProviderName = currentEnv.DEFAULT_FALLBACK_PROVIDER || 'mistral';
      const fallbackModelName = currentEnv.FAST_MODEL || currentEnv.DEFAULT_MODEL || 'mistral-small-latest';
      chatLogger.info('Streaming fallback activated. [EDIT] this may be FLAWED and may not pass matching provider model combo or or a similarly nonmatching DEFAULT_FALLBACK_PROVIDER and FAST_MODEL combo defaults to mistral-small always if these arent set', { fallbackProvider: fallbackProviderName, fallbackModel: fallbackModelName });

      let fallbackModel: any;
      try {
        const { createMistral } = await import('@ai-sdk/mistral');
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        const { createOpenAI } = await import('@ai-sdk/openai');

        const providerFactories: Record<string, () => any> = {
          mistral: () => createMistral({ apiKey: currentEnv.MISTRAL_API_KEY })(fallbackModelName),
          google: () => createGoogleGenerativeAI({ apiKey: currentEnv.GOOGLE_API_KEY })(fallbackModelName),
          anthropic: () => createAnthropic({ apiKey: currentEnv.ANTHROPIC_API_KEY })(fallbackModelName),
          openai: () => createOpenAI({ apiKey: currentEnv.OPENAI_API_KEY })(fallbackModelName), //[EDIT] Possibly WRONG if this case matches for the entire @ai-sdk/openai which may include other providers that happen to support openai format ie. trace if this may include all OPENAI_COMPATIBLE providers, ie. possible wrong assumption that this is matching only Openai as literal provider. createOpenAI sdk format includes OpenAI compatible providers with their own URL and key, shouldnt default to OPENAI_API_KEY
        };

        const factory = providerFactories[fallbackProviderName];
        if (factory) {
          fallbackModel = factory();
        } else {
          // Unknown provider — try OpenAI-compatible format
	  //[EDIT] Possibly WRONG if it sends OPENAI_COMPATIBLE to this route, but DEFINITELY wrong since it defaults to literal OpenAI key and URL call which possibly isnt set, rather than just falling back to regular non-AI SDK call if it doesnt support any of the 5 AI
          fallbackModel = createOpenAI({
            apiKey: currentEnv.OPENAI_API_KEY,
            baseURL: currentEnv.OPENAI_BASE_URL,
          })(fallbackModelName);
        }
      } catch (fallbackInitError: any) {
        chatLogger.error('All fallback provider initializations failed', { error: fallbackInitError.message });
        throw error; // Re-throw original error — no viable fallback
      }

      // Retry the stream with fallback model
      try {
        // Convert messages for fallback (need to extract system prompt)
        const { chatMessages: fallbackChatMessages, systemPrompt: fallbackSystemPrompt } = convertMessages(msgs);
        
        const fallbackStreamOptions: any = {
          model: fallbackModel as any,
          messages: fallbackChatMessages,
          temperature: temp,
          maxOutputTokens: maxT,
          maxRetries: 0,
          maxSteps,
          abortSignal: effectiveSignal,
          toolCallStreaming,
          experimental_telemetry: {
            isEnabled: false,
            functionId: 'llm-stream-fallback',
            metadata: { provider, model: modelName, fallback: 'compatibility' },
          },
        };

        if (fallbackSystemPrompt) fallbackStreamOptions.system = fallbackSystemPrompt;
        if (tools && Object.keys(tools).length > 0) fallbackStreamOptions.tools = tools;
        else {
          chatLogger.warn('[TOOLS] Fallback: No tools provided', {
            fallbackProvider: fallbackProviderName,
            fallbackModel: fallbackModelName,
          });
        }

        // Same function calling support check for fallback path
        if (fallbackStreamOptions.tools) {
          const supportsFC = (fallbackModel as any)?.supports?.functionCalling;
          if (supportsFC === false) {
            chatLogger.warn('Fallback model does not support function calling — using text-mode tool instructions', {
              fallbackProvider: fallbackProviderName,
              fallbackModel: fallbackModelName,
            });
            // EXPLICITLY STRIP TOOLS - fallback model doesn't support FC
            chatLogger.warn('[TOOLS-STRIP] Fallback: Explicitly stripping tools', {
              fallbackProvider: fallbackProviderName,
              fallbackModel: fallbackModelName,
              reason: 'fallback model does not support function calling',
            });
            delete fallbackStreamOptions.tools;

            // Inject same text-mode instructions as main path
            if (fallbackStreamOptions.system) {
              fallbackStreamOptions.system = fallbackStreamOptions.system + '\n\n' + TEXT_MODE_TOOL_INSTRUCTIONS;
            } else {
              fallbackStreamOptions.system = TEXT_MODE_TOOL_INSTRUCTIONS;
            }
          }
        }
        
        const fallbackResult = streamText(fallbackStreamOptions);
        
        // Yield all chunks from fallback (simplified - same as main stream)
        for await (const chunk of fallbackResult.fullStream) {
          if (effectiveSignal?.aborted) return;
          
          if (chunk.type === 'text-delta') {
            yield { content: (chunk as any).text, isComplete: false, timestamp: new Date() };
          } else if (chunk.type === 'tool-call') {
            const fbToolName = (chunk as any).toolName;
            let fbCallArgs = (chunk as any).args || (chunk as any).arguments || {};
            // Normalize args in fallback path (same as main path)
            try {
              const { normalizeToolArgs: fbNormalize } = await import('@/lib/orchestra/shared-agent-context');
              fbCallArgs = fbNormalize(fbToolName, fbCallArgs) ?? fbCallArgs;
            } catch { /* best effort */ }
            // Record telemetry for empty args
            if (!fbCallArgs || Object.keys(fbCallArgs).length === 0) {
              recordToolCall(fallbackModelName, fbToolName, false, 'EMPTY_ARGS');
            }
            yield {
              content: '',
              isComplete: false,
              toolCalls: [{
                id: (chunk as any).toolCallId,
                name: fbToolName,
                arguments: fbCallArgs,
              }],
              timestamp: new Date(),
            };
          } else if (chunk.type === 'tool-result') {
            // Record telemetry for fallback tool results
            const fbResultToolName = (chunk as any).toolName;
            const fbToolResult = (chunk as any).result;
            const fbSuccess = fbToolResult?.success ?? (fbToolResult?.error === undefined);
            const fbErrCode = typeof fbToolResult?.error === 'object' ? fbToolResult.error.code : undefined;
            recordToolCall(fallbackModelName, fbResultToolName, fbSuccess, fbErrCode);
            yield {
              content: '',
              isComplete: false,
              toolInvocations: [{
                toolCallId: (chunk as any).toolCallId,
                toolName: fbResultToolName,
                state: 'result' as const,
                args: (chunk as any).args || {},
                result: fbToolResult,
              }],
              timestamp: new Date(),
            };
          } else if (chunk.type === 'finish') {
            const usage = await fallbackResult.usage;
            yield {
              content: '',
              isComplete: true,
              finishReason: (await fallbackResult.finishReason) || 'stop',
              tokensUsed: usage?.totalTokens || 0,
              usage: {
                promptTokens: (usage as any).inputTokens || 0,
                completionTokens: (usage as any).outputTokens || 0,
                totalTokens: usage?.totalTokens || 0,
              },
              timestamp: new Date(),
              metadata: { vercelAI: true, provider, model: modelName, fallback: 'compatibility' },
            };
          }
        }
        return;
      } catch (fallbackError: any) {
        // Cleanup timeout
        if (ttftTimeoutId) clearTimeout(ttftTimeoutId);

        chatLogger.error('Fallback streaming also failed', {
          requestId,
          provider,
          model: modelName,
          error: fallbackError.message,
        });
        // Throw the fallback error (more specific/recent) rather than the original
        throw fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
      }
    }

    chatLogger.error('Vercel AI SDK streaming failed', { requestId, provider, model: modelName }, {
      error: error.message,
      statusCode: error.statusCode,
      latencyMs: Date.now() - startTime,
    });

    // Cleanup timeout
    if (ttftTimeoutId) clearTimeout(ttftTimeoutId);

    error.metadata = {
      ...error.metadata,
      vercelAI: true,
      provider,
      model: modelName,
      requestId,
      latencyMs: Date.now() - startTime,
    };
    throw error;
  }
}

/**
 * Stream with tools using Vercel AI SDK
 *
 * Convenience wrapper around streamWithVercelAI for tool-enabled streams.
 */
export async function* streamWithTools(
  provider: VercelProvider | string,
  model: string,
  messages: LLMMessage[],
  tools: Record<string, Tool>,
  temperature: number = 0.7,
  maxTokens: number = 65536,
  apiKey?: string,
  baseURL?: string,
  signal?: AbortSignal,
   maxSteps: number = 12,
): AsyncGenerator<StreamingResponse> {
  yield* streamWithVercelAI({
    provider,
    model,
    messages,
    temperature,
    maxTokens,
    apiKey,
    baseURL,
    signal,
    tools,
    toolCallStreaming: true,
    maxSteps,
  });
}
