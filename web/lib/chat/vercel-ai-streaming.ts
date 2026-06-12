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
  stepCountIs,
  extractReasoningMiddleware,
  smoothStream,
  type Tool,
  type LanguageModelUsage,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import type { StreamingResponse, LLMMessage } from '../providers/llm-providers';
import { chatLogger } from './chat-logger';
import { recordCall } from './llm-provider-health';
// Pass-2 cross-cutting theme: record mid-stream stalls (TTFT/idle timeout)
// so the degradation chain shows the silent failure that contributed to
// the user reprompting. sessionId is best-effort — not always available
// inside the streaming generator.
import { recordDegradation } from '@/lib/observability/degradation-tracker';

import { getProviderForModel } from './openai-compat-wrapper';
import { getConfiguredFallbackChain } from '../providers/provider-fallback-chains';
import { tokenTracker } from '../middleware/ai-caching';
import { createReasoningMiddleware, withRetry, createSmoothStream, isTokenLimitError, handleTokenLimitError } from '../middleware/ai-middleware';
import { recordToolCall, shouldForceTextMode } from '../tools/tool-call-telemetry';
import { getModelsForPurpose } from './model-capability-registry';
import { isKnownGoodFC, shouldStripTools, getTextModeInstructions } from '../llm-compat';

/**
 * Tool execution context for Vercel AI SDK tools
 */
export interface ToolExecutionContext {
  userId?: string;
  conversationId?: string;
  sessionId?: string;
  requestId?: string;
  scopePath?: string;  // VFS scope path for session-scoped file operations (e.g., "workspace/sessions/001")
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
// ─── Healing instruction builder ───────────────────────────────────────────────

/**
 * Build a healing context string to inject into retry system prompts.
 * Provides the new model with diagnostic information about what failed
 * and what it should do differently.
 */
function buildHealingInstructions(consecutiveFailures: number): string {
  // Only inject context when there were actual failures
  if (consecutiveFailures < 1) return '';

  return `You are being asked to retry a task that failed ${consecutiveFailures} time${consecutiveFailures > 1 ? 's' : ''} previously due to tool-call errors.

CRITICAL INSTRUCTIONS FOR THIS RETRY:
- Use function calling tools EXACTLY as specified — follow the tool parameter schemas precisely
- For file operations: provide complete paths, non-empty content, and valid JSON arguments
- If a tool returns an error, diagnose it and retry with corrected arguments — do NOT give up
- Do NOT output tool calls as text — use the tool call format exclusively
- Always call at least one relevant tool if the user's request requires action

The previous attempt(s) may have failed due to: malformed arguments, missing required fields, wrong parameter types, or the model attempting text-output instead of tool calls.`;
}

// ─── Text-mode tool instructions (for models without native FC) ─────────────

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
  maxSteps?: number;  /**
   * Time-to-first-token (TTFT) timeout in milliseconds.
   * Fires when NO content (text, reasoning, tool-call, tool-result) arrives
   * within this window from stream start.
   * Defaults to LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS env var, or 30000 (30s).
   *
   * Kept tight (30s) so a misbehaving provider fails fast and the speculative
   * fallback chain can take over.
   */
  firstTokenTimeoutMs?: number;
  /** Request timeout in milliseconds (default: 90000). */
  timeoutMs?: number;
  /**
   * Rolling idle timeout in milliseconds.
   * Resets on every chunk after the first token. Fires when the stream goes
   * silent for this long (no text, tool, reasoning, or step activity).
   * Defaults to LLM_STREAM_IDLE_TIMEOUT_MS env var, or 75000 (75s — the
   * midpoint of the 60–90s band). Extends 2x during tool execution.
   *
   * Wider than the TTFT window because the model is allowed to "think"
   * between tool rounds and during long bash runs.
   */
  idleTimeoutMs?: number;
  /**
   * 'Model thinking' client-ping interval in milliseconds.
   * After this many ms of silence (no text/tool/reasoning/step activity),
   * the server yields a `thinking_ping` chunk so the client UI can show
   * a 'Model is thinking…' indicator instead of looking hung.
   * Defaults to LLM_STREAM_THINK_PING_MS env var, or 20000 (20s).
   * Set to 0 to disable. Must be < idleTimeoutMs to fire before the timeout.
   */
  thinkPingMs?: number;
  /** Provider-specific settings (e.g., Anthropic cache control) */
  providerOptions?: Record<string, any>;
  /**
   * Optional pre-extracted system prompt.
   * When provided, this takes priority over system-content from messages.
   * Avoids the fragile round-trip of extract->sanitize->re-attach->re-extract.
   */
  system?: string;
  /**
   * Speculative fallback timeout in ms.
   * After this many ms of silence (no first token), a fallback provider stream
   * is started in parallel. Whichever provider emits a chunk first wins.
   * Defaults to LLM_STREAM_SPECULATIVE_MS env var, or 20000 (20s).
   * Set to 0 to disable speculative fallback.
   */
  speculativeFallbackMs?: number;
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

// PROVIDER_TIMEOUT_OVERRIDES removed — replaced by the self-correcting derank loop in llm-provider-health.ts.
// Slow providers are now detected dynamically (3+ bad calls in last 5min) and moved to the end of the
// fallback chain in getConfiguredFallbackChain(), instead of being given extra timeout budget here.

/**
 * Split streaming timeouts (Bug #17, #23).
 *
 * Bug #17 split what was a single `timeoutMs` into:
 *   - firstTokenTimeoutMs — TTFT, kept tight (30s) so a slow provider fails
 *     fast and the speculative fallback chain can take over.
 *   - idleTimeoutMs       — Rolling idle window (60–90s; default 75s) that
 *     resets on every chunk. Wider than TTFT to allow the model to "think"
 *     between tool rounds.
 *   - thinkPingMs         — 'Model thinking' client-ping interval (20s).
 *     Fires a `thinking_ping` chunk so the client UI can show a "Model is
 *     thinking…" indicator during long thinking pauses. Must be < idleTimeoutMs.
 *
 * Per-provider tuning has been removed — replaced by the self-correcting
 * derank loop in `llm-provider-health.ts`.
 */
export const STREAM_TIMEOUTS = {
  firstTokenTimeoutMs: parseInt(process.env.LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS || '30000', 10),
  idleTimeoutMs: parseInt(process.env.LLM_STREAM_IDLE_TIMEOUT_MS || '75000', 10),
  thinkPingMs: parseInt(process.env.LLM_STREAM_THINK_PING_MS || '20000', 10),
  // Bug #45: after this many ms of silence (no text, no tool call), inject
  // a [STEER] stall_detected hint into the next-turn context. This MUST be
  // > thinkPingMs and < idleTimeoutMs so the stall steer fires between the
  // thinking ping and the hard idle abort.
  stallSteerMs: parseInt(process.env.LLM_STREAM_STALL_STEER_MS || '30000', 10),
  // Bug #45: mid-stream stall detection threshold. A stream that goes
  // stallThresholdMs+ between chunks with no meaningful content is
  // treated as effectively silent.
  stallThresholdMs: parseInt(process.env.LLM_STREAM_STALL_THRESHOLD_MS || '30000', 10),
} as const;

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
  xai: {
    baseURL: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
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
  ollama: {
    baseURL: process.env.OLLAMA_BASE_URL || process.env.NINEROUTER_BASE_URL || 'http://ninerouter:3000/v1',
    apiKeyEnv: 'NINEROUTER_API_KEY',
    useChatEndpoint: true,
  },
  kiro: {
    baseURL: process.env.KIRO_BASE_URL || process.env.NINEROUTER_BASE_URL || 'http://ninerouter:3000/v1',
    apiKeyEnv: 'NINEROUTER_API_KEY',
    useChatEndpoint: true,
  },
  aihubmix: {
    baseURL: process.env.AIHUBMIX_BASE_URL || 'https://aihubmix.com/v1',
    apiKeyEnv: 'AIHUBMIX_API_KEY',
    useChatEndpoint: true,
  },
  pollinations: {
    baseURL: process.env.POLLINATIONS_BASE_URL || 'https://gen.pollinations.ai/v1',
    apiKeyEnv: 'POLLINATIONS_API_KEY',
    useChatEndpoint: true,
  },
  zo: {
    baseURL: process.env.ZO_BASE_URL || 'https://api.zo.ai/v1',
    apiKeyEnv: 'ZO_API_KEY',
    useChatEndpoint: true,
  },
  ninerouter: {
    baseURL: process.env.NINEROUTER_BASE_URL || 'http://ninerouter:3000/v1',
    apiKeyEnv: 'NINEROUTER_API_KEY',
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
    'xai': 'XAI_API_KEY',
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
    // Self-correcting: when the primary provider is deprioritized, walk the chain to find the next healthy provider.
    try {
      chatLogger.info('Using Zo compatibility wrapper', { provider, model });
      return getProviderForModel('zo', model || 'zo');
    } catch (error: any) {
      chatLogger.warn('Zo wrapper failed, walking fallback chain', {
        error: error.message,
        provider,
      });
      const chain = getConfiguredFallbackChain(provider);
      for (let i = 1; i < chain.length; i++) {
        try {
          chatLogger.info('Trying fallback chain entry', { provider: chain[i], index: i });
          return getProviderForModel(chain[i], model);
        } catch (chainError: any) {
          chatLogger.warn('Chain entry failed, continuing', {
            provider: chain[i],
            error: chainError.message,
          });
          // continue to next chain entry
        }
      }
      // All chain entries failed — re-throw original error
      throw error;
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
      // CRITICAL: Strip 'vercel:' prefix from model ID - Vercel AI SDK expects just 'xai/grok-3', not 'vercel:xai/grok-3'
      const cleanModel = model.startsWith('vercel:') ? model.slice(7) : model;
      const openai = createOpenAI({
        apiKey: apiKey || currentEnv.VERCEL_API_KEY,
        baseURL: baseURL || currentEnv.VERCEL_BASE_URL || 'https://api.vercel.com/v1',
      });
      // Always use chat endpoint for OpenAI-compatible proxies
      return openai.chat(cleanModel);
    }

    default:
      const error = new Error(`Unsupported provider for Vercel AI SDK: ${provider}`);
      chatLogger.error('Unsupported provider', { provider, model });
      throw error;
  }
}

/**
 * Resolve the API base URL for a provider.
 * Mirrors the logic in getVercelModel but returns only the URL so it can be
 * used for health-checking without initialising the full SDK model object.
 * Returns null when the provider is unknown or custom (no base URL to check).
 */
function resolveProviderBaseUrl(provider: string, userBaseURL?: string): string | null {
  const currentEnv: any = typeof process !== 'undefined' ? process.env : {};

  // OpenAI-compatible providers (from the OPENAI_COMPATIBLE_PROVIDERS map)
  if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'google' && provider !== 'mistral' && provider !== 'vercel') {
    const config = OPENAI_COMPATIBLE_PROVIDERS[provider];
    if (config) return userBaseURL || config.baseURL;
    // Unknown provider — can't determine a base URL to ping
    return null;
  }

  // Direct Vercel AI SDK providers
  switch (provider) {
    case 'openai':
      return userBaseURL || currentEnv.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    case 'anthropic':
      return userBaseURL || currentEnv.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    case 'google':
      return userBaseURL || currentEnv.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com';
    case 'mistral':
      return userBaseURL || currentEnv.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1';
    case 'vercel':
      return userBaseURL || currentEnv.VERCEL_BASE_URL || 'https://api.vercel.com/v1';
    default:
      return null;
  }
}

/**
 * Pre-fetch health check: pings the provider endpoint with a short timeout
 * to quickly detect unreachable providers (DNS failure, connection refused,
 * TLS handshake timeout) before attempting the full streamText request.
 *
 * Start this as a speculative promise early in the request flow so it runs
 * in parallel with synchronous setup code (model resolution, message
 * conversion, etc.). Await the result right before the streamText call.
 *
 * When the endpoint is unreachable the caller should fail fast and let the
 * fallback chain skip to the next provider rather than waiting 30s for the
 * TTFT timeout.
 */
export async function preflightProviderHealthCheck(
  provider: string,
  userBaseURL?: string,
): Promise<{ reachable: boolean; latencyMs: number }> {
  const baseUrl = resolveProviderBaseUrl(provider, userBaseURL);
  if (!baseUrl) {
    // Can't determine base URL — assume reachable (don't block)
    // Self-correcting: feeds the llm-provider-health rolling window so next request can derank this provider if it's been bad.
    recordCall(provider, true, 0);
    return { reachable: true, latencyMs: 0 };
  }

  const startTime = Date.now();
  const HEALTH_CHECK_TIMEOUT_MS = 5000; // 5s — must be fast to be worthwhile
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('Health check timed out'));
  }, HEALTH_CHECK_TIMEOUT_MS);

  try {
    // Use HEAD with minimal overhead — we only need to know if the host is
    // reachable (DNS resolves, TCP handshake completes), not whether it
    // returns a valid API response. Don't follow redirects to keep it
    // lightweight and avoid hitting auth-gated endpoints.
    await fetch(baseUrl, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timeoutId);
    // Self-correcting: feeds the llm-provider-health rolling window so next request can derank this provider if it's been bad.
    recordCall(provider, true, Date.now() - startTime);
    return { reachable: true, latencyMs: Date.now() - startTime };
  } catch {
    clearTimeout(timeoutId);
    // Any failure (TypeError for DNS, connection refused, timeout, TLS error)
    // means the endpoint is unreachable. We don't distinguish between
    // different failure modes — they all mean "skip this provider".
    // Self-correcting: feeds the llm-provider-health rolling window so next request can derank this provider if it's been bad.
    recordCall(provider, false, Date.now() - startTime, 'unreachable');
    return { reachable: false, latencyMs: Date.now() - startTime };
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
      const entry: any = {
        role: msg.role === 'assistant' ? 'assistant' : msg.role === 'tool' ? 'tool' : 'user',
        content: msg.content,
      };
      if (msg.role === 'assistant' && Array.isArray((msg as any).tool_calls)) {
        entry.tool_calls = (msg as any).tool_calls;
      }
      if (msg.role === 'tool' && (msg as any).tool_call_id) {
        entry.tool_call_id = (msg as any).tool_call_id;
      }
      chatMessages.push(entry);
      continue;
    }

    // Handle multi-modal content — convert images to text placeholders for now
    // Also extract tool-call parts from array content for AI SDK compatibility
    const textParts: string[] = [];
    let toolCallsFromContent: any[] = [];
    for (const c of msg.content) {
      if (c.type === 'text') {
        textParts.push(c.text || '');
      } else if (c.type === 'image_url') {
        textParts.push('[Image]');
      } else if (c.type === 'tool-call') {
        // Extract tool-call parts from content array
        const toolCall = c as any;
        toolCallsFromContent.push({
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          arguments: toolCall.args || toolCall.arguments || {},
        });
      }
    }
    const textContent = textParts.join(' ');

    const hasSeparateToolCalls = Array.isArray((msg as any).tool_calls) && (msg as any).tool_calls.length > 0;
    const hasContentToolCalls = toolCallsFromContent.length > 0;

    // AI SDK v6 requires assistant content to be non-empty string or array of parts.
    // When only tool-call parts exist with no text, use [] instead of ''.
    const hasOnlyToolCalls = msg.role === 'assistant' && !textContent && (hasSeparateToolCalls || hasContentToolCalls);

    const entry: any = {
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: hasOnlyToolCalls ? [] : textContent,
    };
    // Use tool_calls from separate property OR extracted from content array
    if (msg.role === 'assistant' && hasSeparateToolCalls) {
      entry.tool_calls = (msg as any).tool_calls;
    } else if (msg.role === 'assistant' && hasContentToolCalls) {
      entry.tool_calls = toolCallsFromContent;
    }
    chatMessages.push(entry);
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
 * Wraps an async generator with speculative fallback support.
 *
 * Starts iterating the primary generator. If no chunk arrives within
 * `speculativeMs`, a fallback generator is created (from `createFallback`)
 * and the two are raced — the first to yield a chunk wins.
 *
 * The slower stream's underlying connection is aborted immediately so
 * API credits are not wasted on the loser.
 *
 * The winner's chunks are transparently yielded. `onFallbackWin` is called
 * when the fallback wins, allowing the caller to update metadata.
 * `onLoser` is called with timing info for the loser, allowing the caller
 * to record telemetry (e.g. model-ranker failure, latency tracking).
 */
async function* withSpeculativeFallback<T>(
  primaryGen: AsyncGenerator<T>,
  options: {
    speculativeMs: number;
    /**
     * Creates the fallback generator. Returns an object with:
     * - gen: the async generator to race
     * - abort: function to abort the fallback stream (called if primary wins)
     */
    createFallback: () => { gen: AsyncGenerator<T>; abort: () => void };
    /** Called when fallback wins — should provide a way to abort the primary */
    abortPrimary: () => void;
    onFallbackWin?: () => void;
    /**
     * Called whenever a loser is determined. Reports which stream lost
     * and how long it was running before being aborted.
     */
    onLoser?: (info: { source: 'primary' | 'fallback'; latencyMs: number }) => void;
    signal?: AbortSignal;
  }
): AsyncGenerator<T> {
  const { speculativeMs, createFallback, abortPrimary, signal } = options;
  const primaryIt = primaryGen[Symbol.asyncIterator]();

  // Stores the result from the first primaryIt.next() call so if the
  // speculative timeout fires but the primary produces a chunk between
  // the timeout and fallback setup, we don't orphan (i.e. lose) that chunk.
  let firstPrimaryResult: IteratorResult<T> | null = null;

  // Track when the speculative timeout fires so we can report the loser's latency.
  // `speculativeStartTime` ≈ the moment the primary was supposed to have first
  // produced output; anything after this is dead time from the primary.
  let speculativeStartTime = 0;
  let fallbackCreateTime = 0;

  // Race: first primary chunk vs speculative timeout
  const first = await Promise.race([
    primaryIt.next().then(r => {
      firstPrimaryResult = r;
      return { type: 'chunk' as const, value: r };
    }),
    new Promise<{ type: 'timeout' }>(resolve =>
      setTimeout(() => {
        speculativeStartTime = Date.now();
        resolve({ type: 'timeout' });
      }, speculativeMs)
    ),
  ]);

  if (first.type === 'timeout') {
    // Primary was silent for speculativeMs — start fallback
    let fallbackResult: { gen: AsyncGenerator<T>; abort: () => void };
    try {
      fallbackResult = createFallback();
      fallbackCreateTime = Date.now();
    } catch {
      // Fallback setup failed — continue with primary
      if (firstPrimaryResult && !firstPrimaryResult.done) {
        yield firstPrimaryResult.value;
      }
      while (true) {
        if (signal?.aborted) return;
        const n = await primaryIt.next();
        if (n.done) return;
        yield n.value;
      }
      return;
    }

    const fallbackIt = fallbackResult.gen[Symbol.asyncIterator]();

    // Race first chunks from both streams
    const winner = await Promise.race([
      firstPrimaryResult
        ? Promise.resolve({ ...firstPrimaryResult, source: 'primary' as const })
        : primaryIt.next().then(r => ({ ...r, source: 'primary' as const })),
      fallbackIt.next().then(r => ({ ...r, source: 'fallback' as const })),
    ]);

    if (winner.done) return;

    // ABORT THE LOSER immediately to stop wasting API credits
    if (winner.source === 'fallback') {
      abortPrimary();
      // Loser = primary. Approximate total time primary was running:
      // speculativeMs + time from timeout expiry to now.
      const primaryLatency = Date.now() - speculativeStartTime + speculativeMs;
      options.onLoser?.({ source: 'primary', latencyMs: primaryLatency });
      options.onFallbackWin?.();
    } else {
      fallbackResult.abort();
      // Loser = fallback. Time from when fallback was created to now.
      const fallbackLatency = Date.now() - fallbackCreateTime;
      options.onLoser?.({ source: 'fallback', latencyMs: fallbackLatency });
    }

    yield winner.value;

    // Continue with the winner
    const winnerIt = winner.source === 'primary' ? primaryIt : fallbackIt;
    while (true) {
      if (signal?.aborted) return;
      const next = await winnerIt.next();
      if (next.done) return;
      yield next.value;
    }
  }

  // Primary won before speculative timeout fired — yield first chunk and continue
  if (first.value && !first.value.done) {
    yield first.value.value;
  }

  // Continue with remaining primary chunks
  while (true) {
    if (signal?.aborted) return;
    const next = await primaryIt.next();
    if (next.done) return;
    yield next.value;
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
  // Bug #45: mid-stream stall detection. If a stream goes 30s+ between
  // chunks with no meaningful content, treat it as effectively silent and
  // set the incomplete flag so the next iteration can surface an
  // [INCOMPLETE-RESPONSE-FEEDBACK] to the LLM.
  const STALL_THRESHOLD_MS = STREAM_TIMEOUTS.stallThresholdMs;
  let firstChunkAt = 0;
  let lastChunkAt = 0;
  let totalChunks = 0;
  let streamStalled = false;
  function checkChunkStall(): boolean {
    const now = Date.now();
    if (firstChunkAt === 0) firstChunkAt = now;
    if (lastChunkAt !== 0 && now - lastChunkAt > STALL_THRESHOLD_MS) {
      streamStalled = true;
    }
    lastChunkAt = now;
    totalChunks += 1;
    return streamStalled;
  }

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
    firstTokenTimeoutMs = STREAM_TIMEOUTS.firstTokenTimeoutMs,
    idleTimeoutMs = STREAM_TIMEOUTS.idleTimeoutMs,
    thinkPingMs = STREAM_TIMEOUTS.thinkPingMs,
    speculativeFallbackMs = parseInt(process.env.LLM_STREAM_SPECULATIVE_MS || '20000', 10), // Default 20s, 0 to disable
    providerOptions,
    system: systemOverride,
  } = opts;

  const startTime = Date.now();
  const requestId = `vercel-ai-${Date.now()}`;

  // Start pre-fetch health check speculatively — runs in parallel with
  // synchronous setup (getVercelModel, convertMessages, build streamOptions).
  // If the provider endpoint is unreachable we fail fast in ~5s instead of
  // waiting 30s for the TTFT timeout.
  const healthCheckPromise = preflightProviderHealthCheck(provider, url);

  // Cache for tool call arguments - scoped to this stream invocation to prevent cross-request leaks
  const toolCallArgsCache = new Map<string, any>();
  let useCompatibilityFallback = false;

  // Time-to-first-token timeout: only cancels if NO content arrives within timeoutMs
  // Once first token arrives, timeout is cleared to allow long legitimate streams
  let ttftTimeoutId: NodeJS.Timeout | null = null;
  let timeoutController: AbortController | null = null;
  let firstTokenReceived = false;
  
  // ── Activity tracker for differentiated timeout diagnostics ──────────
  // Tracks what was happening when a timeout fires, so we can distinguish:
  //   - No initial token ever received (TTFT timeout)
  //   - Mid-stream after partial text (idle timeout with text)
  //   - Mid-stream after tool call (idle timeout waiting for tool result)
  //   - Mid-stream after successful tool result (should be rare — dynamic extension)
  let lastActivityTime = Date.now();
  let lastActivityType: 'ttft-waiting' | 'text' | 'tool-call' | 'tool-result' | 'reasoning' | 'step' = 'ttft-waiting';
  let lastActivityDetail: string = '';  // e.g. tool name, token preview
  let toolCallCount = 0;                // total tool calls made
  let toolResultSuccessCount = 0;       // successful tool results
  let toolResultFailCount = 0;          // failed tool results
  let totalTokensReceived = 0;          // total text tokens received

  if (firstTokenTimeoutMs > 0) {
    timeoutController = new AbortController();

    // Chain with existing signal if present
    if (signal) {
      signal.addEventListener('abort', () => {
        timeoutController?.abort(signal.reason);
        if (ttftTimeoutId) clearTimeout(ttftTimeoutId);
        if (idleTimeoutId) clearTimeout(idleTimeoutId);
        stopThinkPingInterval();
      }, { once: true });
    }

    // Set time-to-first-token timeout
    ttftTimeoutId = setTimeout(() => {
      if (!firstTokenReceived) {
        const ttftLatencyMs = Date.now() - startTime;
        chatLogger.warn('[TIMEOUT-TTFT] No first token received', {
          provider,
          model: modelName,
          firstTokenTimeoutMs,
          ttftLatencyMs,
          timeoutCategory: 'NO_INITIAL_TOKEN',
          startTime,
          healthCheckPassed: true,
        });
        // Pass-2 cross-cutting theme: record the mid-stream stall so the
        // degradation chain shows the silent failure. The sessionId is
        // not in scope here (we're inside a stream generator), so we use
        // 'default' — operators can correlate by timestamp.
        try {
          recordDegradation(
            'default',
            'mid_stream_stall',
            'vercel-ai-streaming',
            { kind: 'ttft', provider, model: modelName, ttftLatencyMs },
          );
        } catch { /* best-effort */ }
        timeoutController?.abort(new Error(
          `No response within ${firstTokenTimeoutMs}ms (time-to-first-token timeout). ` +
          `Provider=${provider}, model=${modelName}, elapsed=${ttftLatencyMs}ms. ` +
          `Possible causes: provider outage, incorrect API key, model unavailability, or network issue.`
        ));
      }
    }, firstTokenTimeoutMs);
  }

  // Bug fix: wire the internal timeoutController into the provider's HTTP
  // call via AbortSignal.any so firstTokenTimeoutMs / idleTimeoutMs actually
  // abort the network request. The provider (and fetch) sees an aborted
  // signal the moment we call timeoutController.abort(); without this
  // merge, the SDK could keep reading the stream after the timeout fires.
  // AbortSignal.any is a no-op (returns `signal` unchanged) when
  // timeoutController is absent, so this is safe in the disabled path too.
  const effectiveSignal = timeoutController
    ? AbortSignal.any([signal, timeoutController.signal])
    : signal;
  
  // Helper to clear TTFT timeout once first token arrives
  const onFirstToken = () => {
    if (!firstTokenReceived) {
      firstTokenReceived = true;
      if (ttftTimeoutId) {
        clearTimeout(ttftTimeoutId);
        ttftTimeoutId = null;
      }
      // Bug #17: Start the 'model thinking' client-ping interval now that
      // the first token has arrived. Long thinking pauses (tool execution,
      // multi-step reasoning) will now produce periodic ping chunks so the
      // client UI can show "Model is thinking…" instead of looking hung.
      startThinkPingInterval();
    }
  };

  // Rolling idle timeout: resets on every chunk (text, tool call, reasoning, etc.)
  // Once the first token arrives, the TTFT is replaced by this rolling timeout.
  // If no activity arrives for `idleTimeoutMs`, we abort -- this prevents hung
  // streams while allowing arbitrarily long multi-tool sessions.
  //
  // Bug #17: split out from the old single `timeoutMs` (which conflated TTFT
  // and idle). The split lets us keep TTFT tight (30s) for fast fallback while
  // giving the model a much wider idle window (60–90s) for legitimate "thinking"
  // pauses (tool execution, multi-step reasoning, etc.).
  let idleTimeoutId: NodeJS.Timeout | null = null;
  const IDLE_TIMEOUT_MS = idleTimeoutMs;

  // 'Model thinking' client-ping queue: an interval pushes a ping onto the
  // queue when the stream has been silent for `thinkPingMs`. The main iterator
  // loop yields pings before pulling the next chunk, so the client UI sees
  // a periodic "model is thinking…" signal during long thinking pauses.
  //
  // Bug #17: previously, a 60+ second thinking pause looked identical to a hung
  // stream to the client (no chunks, no progress). The think-ping fixes that
  // without changing abort semantics.
  const thinkPingQueue: Array<{ type: 'thinking_ping' | 'stall_steer'; elapsedMs: number; lastActivityType: string }> = [];
  let thinkPingIntervalId: NodeJS.Timeout | null = null;
  const THINK_PING_MS = thinkPingMs;
  const STALL_STEER_MS = STREAM_TIMEOUTS.stallSteerMs;
  let stallSteerFiredThisSilence = false;

  const startThinkPingInterval = () => {
    if (thinkPingIntervalId || THINK_PING_MS <= 0) return;
    thinkPingIntervalId = setInterval(() => {
      const silenceMs = Date.now() - lastActivityTime;
      if (silenceMs >= THINK_PING_MS) {
        thinkPingQueue.push({
          type: 'thinking_ping',
          elapsedMs: silenceMs,
          lastActivityType: lastActivityType,
        });
        chatLogger.debug('[THINK-PING] Model has been silent; emitting ping', {
          silenceMs,
          lastActivityType,
          lastActivityDetail: lastActivityDetail.slice(0, 40),
        });
      }
      // Bug #45: if silence exceeds the stall-steer threshold, inject a
      // [STEER] stall_detected hint. Fires once per silence period; resets
      // on any activity.
      if (silenceMs >= STALL_STEER_MS && !stallSteerFiredThisSilence) {
        stallSteerFiredThisSilence = true;
        thinkPingQueue.push({
          type: 'stall_steer',
          elapsedMs: silenceMs,
          lastActivityType: lastActivityType,
        });
        chatLogger.warn('[STALL-STEER] Model silent for >30s; injecting stall steer', {
          silenceMs,
          lastActivityType,
        });
      }
    }, THINK_PING_MS);
  };

  const stopThinkPingInterval = () => {
    if (thinkPingIntervalId) {
      clearInterval(thinkPingIntervalId);
      thinkPingIntervalId = null;
    }
  };

  // Dynamic extension multiplier: when a successful tool result arrives, the
  // idle timeout gets extended by 2x to give the model time to process the
  // result and produce the next step without being cut off mid-thought.
  const TOOL_SUCCESS_EXTENSION_MULTIPLIER = 2;
  let activeExtensionMultiplier = 1;

  const resetIdleTimeout = (extensionMultiplier?: number) => {
    if (idleTimeoutId) {
      clearTimeout(idleTimeoutId);
    }
    if (!timeoutController) return;
    const effectiveMultiplier = extensionMultiplier ?? activeExtensionMultiplier;
    const effectiveTimeout = IDLE_TIMEOUT_MS * effectiveMultiplier;
    idleTimeoutId = setTimeout(() => {
      if (!timeoutController?.signal.aborted) {
        // ── Differentiated timeout diagnostics ────────────────────────────
        // Log detailed activity context to distinguish between timeout causes:
        //   - No initial token ever received (TTFT handled separately, but this guards
        //     the case where TTFT was set to 0 or cleared but no first token arrived)
        //   - Mid-stream after partial text: lastActivityType='text', X tokens received
        //   - Mid-stream after tool call: lastActivityType='tool-call', Y tool calls made
        //   - Mid-stream waiting for tool result: lastActivityType='tool-call' with
        //     no tool-result seen yet (tool execution taking too long)
        //   - After successful tool result but model went silent: lastActivityType='tool-result'
        const timeSinceLastActivity = Date.now() - lastActivityTime;
        const diagnosticMsg = [
          `No activity for ${effectiveTimeout}ms (idle timeout)`,
          `lastActivityType=${lastActivityType}`,
          `lastActivityDetail="${lastActivityDetail}"`,
          `timeSinceLastActivity=${timeSinceLastActivity}ms`,
          `firstTokenReceived=${firstTokenReceived}`,
          `totalTokens=${totalTokensReceived}`,
          `toolCalls=${toolCallCount}`,
          `toolResultsOK=${toolResultSuccessCount}`,
          `toolResultsFAIL=${toolResultFailCount}`,
          `extensionMultiplier=${effectiveMultiplier}`,
          `firstTokenTimeoutMs=${firstTokenTimeoutMs}`,
          `idleTimeoutMs=${IDLE_TIMEOUT_MS}`,
        ].join(' | ');
        chatLogger.warn('[TIMEOUT] ' + diagnosticMsg, {
          provider,
          model: modelName,
          timeoutCategory: firstTokenReceived
            ? (lastActivityType === 'tool-call' ? 'MID_STREAM_TOOL_CALL'
              : lastActivityType === 'tool-result' ? 'POST_TOOL_RESULT'
              : lastActivityType === 'text' ? 'MID_STREAM_TEXT'
              : 'MID_STREAM_OTHER')
            : 'NO_INITIAL_TOKEN',
          lastActivityType,
          lastActivityDetail,
          timeSinceLastActivity,
          firstTokenReceived,
          totalTokensReceived,
          toolCallCount,
          toolResultSuccessCount,
          toolResultFailCount,
          extensionMultiplier: effectiveMultiplier,
          effectiveTimeout,
          idleTimeoutMs: IDLE_TIMEOUT_MS,
        });
        // Pass-2 cross-cutting theme: record the idle-timeout stall.
        try {
          recordDegradation(
            'default',
            'mid_stream_stall',
            'vercel-ai-streaming',
            { kind: 'idle', provider, model: modelName, lastActivityType, timeSinceLastActivity },
          );
        } catch { /* best-effort */ }
        timeoutController.abort(new Error(diagnosticMsg));
      }
    }, effectiveTimeout);
  };

  try {
    const vercelModel = getVercelModel(provider, modelName, key, url);
    // If the caller provided a pre-extracted system prompt, use it directly.
    // Otherwise, extract from the messages array via convertMessages().
    // This avoids the fragile round-trip pattern: extract → sanitize → re-attach → re-extract.
    const { chatMessages, systemPrompt: extractedSystemPrompt } = convertMessages(msgs);
    const systemPrompt = systemOverride ?? extractedSystemPrompt;

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
    if (checkChunkStall()) {
        // Bug #45: surface a mid-stream stall signal via a real consumer.
        // Logs the stall event AND calls recordDegradation so the per-stream
        // stall counter is surfaced in run.log. Without a real consumer, a
        // 5-min silent stream looks identical to a 1-sec success in run.log.
        chatLogger.warn('[streaming] mid-stream stall detected (>30s without chunks)', {
          totalChunks,
          elapsedMs: Date.now() - firstChunkAt,
        });
        recordDegradation(
          String(requestId ?? 'unknown'),
          'mid_stream_stall',
          'vercel-ai-streaming',
          { totalChunks, elapsedMs: Date.now() - firstChunkAt, thresholdMs: STALL_THRESHOLD_MS }
        );
      }
          if (effectiveSignal?.aborted) return;

          if (chunk.type === 'text-delta') {
            // Clear time-to-first-token timeout once we receive content
            onFirstToken();
            // Reset rolling idle timeout - activity detected
            resetIdleTimeout();
            
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
      // AI SDK v6 removed `maxSteps` from streamText; the multi-step tool loop
      // is now controlled via `stopWhen`. Without this the SDK defaults to
      // stepCountIs(1) — the model emits a tool call, the SDK runs the tool,
      // then STOPS before the model can read the result and produce text,
      // yielding responseLength: 0 (the "silent tool call" failure).
      stopWhen: stepCountIs(maxSteps),
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
      // Check FC compatibility via shared LLM compat module
      const knownGoodFC = isKnownGoodFC(modelName);
      chatLogger.info('[FC-KNOWN] Checking function calling support', {
        provider,
        model: modelName,
        isKnownGoodFC: knownGoodFC,
      });

      if (knownGoodFC) {
        chatLogger.info('[FC-KNOWN] Model is known to support function calling', {
          provider,
          model: modelName,
          action: 'Keeping tools enabled regardless of SDK capability flags',
        });
      }

      // Use shared shouldStripTools logic (handles NVIDIA, Mistral Small, GitHub Copilot)
      skipTools = shouldStripTools(provider, modelName);

      if (skipTools) {
        chatLogger.warn('[FC-BYPASS] Provider/model-specific tool stripping applied', {
          provider,
          model: modelName,
          action: 'Stripping tools and using text-mode fallback',
        });
      }

      // CRITICAL: If model is known good for FC, never skip tools regardless of SDK
      if (knownGoodFC) {
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
    } else if (provider === 'ninerouter' && modelName.startsWith('gh/')) {
      // gh/ via ninerouter: send explicit empty tools array so the ninerouter
      // server gets "tools": [] in the request body. This signals that we
      // don't want function definitions; the server may respect this and
      // skip injecting its own write_file schemas that GitHub Copilot rejects.
      streamOptions.tools = {} as any;
      chatLogger.warn('[TOOLS-STRIP] gh/ via ninerouter — sending explicit empty tools array to prevent server-side FC injection', {
        provider,
        model: modelName,
        reason: 'gh/ (GitHub Copilot) rejects function call schemas — sending tools:[]',
      });
    } else if (skipTools && tools) {
      chatLogger.warn('[TOOLS-STRIP] Provider-specific tool stripping applied', {
        provider,
        model: modelName,
        strippedToolCount: Object.keys(tools).length,
        reason: 'provider API returns 400 for tool calls on this model',
      });
      // Inject text-mode tool instructions plus general plain-text fallback
      const textModeInstructions = TEXT_MODE_TOOL_INSTRUCTIONS + '\n\n' + getTextModeInstructions();
      if (streamOptions.system) {
        streamOptions.system = streamOptions.system + '\n\n' + textModeInstructions;
      } else {
        streamOptions.system = textModeInstructions;
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

        // Inject text-mode tool instructions plus general plain-text fallback
        const textModeInstructions = TEXT_MODE_TOOL_INSTRUCTIONS + '\n\n' + getTextModeInstructions();
        if (streamOptions.system) {
          streamOptions.system = streamOptions.system + '\n\n' + textModeInstructions;
        } else {
          streamOptions.system = textModeInstructions;
        }
      } else if (supportsFC === undefined) {
        // Model doesn't report this capability — could be unknown provider.
        // POLICY (per user): always let the model TRY tools first. Don't pre-emptively
        // strip them based on telemetry. The Phase 2 fallback below already kicks in
        // after the fact if Phase 1 produces zero usable output.
        chatLogger.info('[FC-GATE] Function calling ability UNKNOWN — using two-phase strategy', {
          provider,
          model: modelName,
          toolCount,
          strategy: 'Phase 1: tools only (always); Phase 2: text-mode fallback only if file-edit tools failed',
        });
        // Do NOT inject text-mode instructions yet — let the model try native tool calls first.
      }
      // === COMMENTED OUT: Auto text-mode based on telemetry ===
      // This was removed in favor of letting the model TRY tools first and only
      // falling back after Phase 1 fails (see FC-GATE Phase 2 below).
      // Uncomment this block if you want to go back to proactively stripping
      // tools for models with >70% tool failure rates in telemetry.
      //
      // // Auto text-mode: if telemetry shows this model fails >70% of tool calls,
      // // strip tools and switch to text-mode proactively.
      // if (shouldForceTextMode(modelName)) {
      //   chatLogger.warn('[FC-GATE] Auto text-mode: model has >70% tool failure rate', {
      //     provider,
      //     model: modelName,
      //     toolCount,
      //     action: 'Stripping tools and using text-mode fallback based on telemetry',
      //   });
      //   delete streamOptions.tools;
      //   if (streamOptions.system) {
      //     streamOptions.system = streamOptions.system + '\n\n' + TEXT_MODE_TOOL_INSTRUCTIONS;
      //   } else {
      //     streamOptions.system = TEXT_MODE_TOOL_INSTRUCTIONS;
      //   }
      // } else {
      //   // TWO-PHASE STRATEGY:
      //   //   Phase 1: Use tools only (no text-mode instructions).
      //   //   Phase 2: After streaming, if zero tool calls produced, check if
      //   //            the response text contains tool-call patterns. If so,
      //   //            issue a second completion with text-mode instructions.
      // }
      // === END COMMENTED OUT ===
    } else {
      chatLogger.info('[FC-GATE] No tools provided, skipping function calling check', { provider, model: modelName });
    }

    // Provider-specific options (e.g., Anthropic cache control)
    if (providerOptions) {
      streamOptions.providerOptions = providerOptions;
    }

    // Await the health check before calling streamText. By this point the
    // promise has had ~200ms+ to resolve (while getVercelModel, convertMessages,
    // tools setup, and options building ran synchronously). If the endpoint
    // is unreachable we throw now rather than waiting for the TTFT timeout.
    const healthResult = await healthCheckPromise;
    if (!healthResult.reachable) {
      chatLogger.warn('[HEALTH-CHECK] Provider endpoint unreachable, failing fast', {
        provider,
        model: modelName,
        latencyMs: healthResult.latencyMs,
      });
      throw new Error(
        `Provider "${provider}" endpoint is unreachable ` +
        `(pre-fetch health check failed after ${healthResult.latencyMs}ms). ` +
        `Check network connectivity or DNS resolution for ${resolveProviderBaseUrl(provider, url)}.`
      );
    }

    const result = streamText(streamOptions);

    // ── Speculative fallback race ─────────────────────────────────────────
    // If the primary provider is silent for `speculativeFallbackMs`, start a
    // fallback provider stream in parallel. Whichever emits a chunk first wins.
    let actualProvider = provider;
    let actualModel = modelName;
    let fallbackResultRef: { result: any } | null = null;
    // Shared state for loser telemetry: the createFallback closure sets these
    // so onFallbackWin and onLoser can read them without re-resolving.
    const fbResolved = {
      provider: '',
      model: '',
    };
    // Populated by onLoser so the final metadata chunk can include loser details
    // alongside the winner for full observability.
    let speculativeLoserInfo: {
      provider: string;
      model: string;
      latencyMs: number;
    } | null = null;

    // Shared ref so createFallback and onFallbackWin can both access the fallback timeout.
    // The timeout is a TTFT-only guard (cleared on first chunk / when fallback wins),
    // NOT a hard lifetime cap — prevents premature cutoff of long tool-calling sessions.
    let fbTimeoutId: NodeJS.Timeout | null = null;

    const streamToIterate = (speculativeFallbackMs > 0 && !isCustomProvider)
      ? withSpeculativeFallback(result.fullStream as any, {
          speculativeMs: speculativeFallbackMs,
          createFallback: () => {
            const fbChain = getConfiguredFallbackChain(provider);
            if (fbChain.length === 0) {
              throw new Error('No fallback provider configured');
            }
            fbResolved.provider = fbChain[0];
            const currentEnv: any = typeof process !== 'undefined' ? process.env : {};
            fbResolved.model = currentEnv.FAST_MODEL || currentEnv.DEFAULT_MODEL || 'mistral-small-latest';
            const fbVercelModel = getVercelModel(fbResolved.provider, fbResolved.model);

            // Create a dedicated abort controller so the fallback stream can be
            // cancelled immediately if the primary wins the race.
            const fbController = new AbortController();
            // Add TTFT timeout to fallback too — prevents hanging if fallback provider also stalls.
            // This is a TTFT-only guard: cleared by onFallbackWin once the fallback produces
            // its first chunk. NOT a hard lifetime cap (avoids premature cutoff of long tool calls).
            // Use fallback provider's own timeout override, not the primary's            // Flat 60s for fallback too. Per-provider tuning removed; replaced by the self-correcting derank loop in llm-provider-health.ts.
            const fbTimeoutMs = parseInt(process.env.LLM_STREAM_TIMEOUT_MS || '60000', 10);
            fbTimeoutId = setTimeout(() => {
              if (!fbController.signal.aborted) {
                fbController.abort(new Error(`No response from fallback provider within ${fbTimeoutMs}ms (fallback TTFT timeout)`));
              }
            }, fbTimeoutMs);

    // Bug fix: the fallback's network request previously only honored
    // fbController.signal (the speculative-race cancel), so the global
    // firstTokenTimeoutMs / idleTimeoutMs never aborted it. Merge all
    // three signals so the provider sees the abort from ANY source:
    //   - fbController.signal  → primary wins the race, cancel fallback
    //   - signal               → user cancelled the request
    //   - timeoutController.signal → global TTFT/idle timeout fired
    // AbortSignal.any is a no-op (returns the single signal) when only
    // one source exists, so this is safe across the disabled paths too.
    const fallbackAbortSources: AbortSignal[] = [fbController.signal, signal];
    if (timeoutController) fallbackAbortSources.push(timeoutController.signal);
    const fbStreamOpts: any = {
      model: fbVercelModel,
      messages: chatMessages,
      temperature: temp,
      maxOutputTokens: maxT,
      maxRetries: 0,
      stopWhen: stepCountIs(maxSteps),
      toolCallStreaming,
      abortSignal: AbortSignal.any(fallbackAbortSources),
    };
            if (systemPrompt) fbStreamOpts.system = systemPrompt;
            if (tools && Object.keys(tools).length > 0) fbStreamOpts.tools = tools;

            chatLogger.warn('[SPEC-FALLBACK] Starting speculative fallback stream', {
              primaryProvider: provider,
              primaryModel: modelName,
              fallbackProvider: fbResolved.provider,
              fallbackModel: fbResolved.model,
              silenceMs: speculativeFallbackMs,
            });

            const fbResult = streamText(fbStreamOpts);
            fallbackResultRef = { result: fbResult };
            return {
              gen: fbResult.fullStream as any,
              abort: () => {
                if (fbTimeoutId) { clearTimeout(fbTimeoutId); fbTimeoutId = null; }
                fbController.abort();
              },
            };
          },
          abortPrimary: () => {
            if (timeoutController && !timeoutController.signal.aborted) {
              timeoutController.abort(new Error('Speculative fallback: primary lost the race'));
            }
          },
          onFallbackWin: () => {
            // Clear the TTFT guard now that the fallback is producing — this is NOT a hard
            // lifetime cap. The rolling idle timeout on the main controller (or the fallback's
            // own stream completion) will handle the long-running case.
            if (fbTimeoutId) { clearTimeout(fbTimeoutId); fbTimeoutId = null; }

            // Use the shared fbResolved values (already set by createFallback)
            actualProvider = fbResolved.provider || 'unknown';
            actualModel = fbResolved.model;
            chatLogger.warn('[SPEC-FALLBACK] 🏁 Fallback provider won the race', {
              primaryProvider: provider,
              primaryModel: modelName,
              winner: actualProvider,
              winnerModel: actualModel,
            });
          },
          onLoser: async (info: { source: 'primary' | 'fallback'; latencyMs: number }) => {
            if (info.source === 'primary') {
              // Primary lost — record its failure in model-ranker so the
              // stalling provider gets penalised for future selection.
              try {
                const { recordModelAttempt } = await import('@/lib/providers/model-ranker');
                void recordModelAttempt(provider, modelName, false);
              } catch { /* model-ranker import is best-effort */ }
              speculativeLoserInfo = {
                provider,
                model: modelName,
                latencyMs: info.latencyMs,
              };
              chatLogger.warn('[SPEC-FALLBACK] Primary recorded as loser', {
                loserProvider: provider,
                loserModel: modelName,
                loserLatencyMs: info.latencyMs,
              });
            } else {
              // Fallback lost — record its failure.
              try {
                const { recordModelAttempt } = await import('@/lib/providers/model-ranker');
                void recordModelAttempt(fbResolved.provider, fbResolved.model, false);
              } catch { /* model-ranker import is best-effort */ }
              speculativeLoserInfo = {
                provider: fbResolved.provider,
                model: fbResolved.model,
                latencyMs: info.latencyMs,
              };
              chatLogger.warn('[SPEC-FALLBACK] Fallback recorded as loser', {
                loserProvider: fbResolved.provider,
                loserModel: fbResolved.model,
                loserLatencyMs: info.latencyMs,
              });
            }
          },
          signal: signal, // user's signal only — NOT effectiveSignal (which includes timeoutController that gets aborted when fallback wins)
        })
      : result.fullStream;

    // Stream events including text, reasoning, and tool calls
    let reasoningContent = '';
    let textContent = ''; // Track text for two-phase FC fallback
    let consecutiveToolFailures = 0; // Track consecutive tool call failures for Phase 3 model-capability fallback
    const FC_MODEL_FALLBACK_THRESHOLD = 2; // Trigger Phase 3 reliable-model retry after this many consecutive failures

    // CRITICAL: Iterate the potentially-wrapped stream for speculative fallback support.
    // If the primary was silent for 20s+, the fallback generator transparently takes over.
    // Abort check uses the user's signal (not effectiveSignal) so that aborting the primary
    // controller (when fallback wins) doesn't kill the merged generator mid-stream.
    //
    // Bug #17: Before pulling the next chunk from the stream, drain any pending
    // 'thinking' pings first. Pings accumulate when the stream has been silent
    // for thinkPingMs — yielding them here keeps the client UI responsive
// without changing abort semantics.
try {
while (thinkPingQueue.length > 0) {
      if (signal?.aborted) return;
      const ping = thinkPingQueue.shift()!;
      if (ping.type === 'stall_steer') {
        yield {
          content: '[STEER] stall_detected: The model has been silent for 30s. If this was a thinking pause, continue with your response. If you were about to call a tool, invoke it now. If the response was already complete, re-state the conclusion.',
          isComplete: false,
          timestamp: new Date(),
          metadata: { type: 'stall_steer', elapsedMs: ping.elapsedMs },
        };
      } else {
        yield {
          content: '',
          isComplete: false,
          timestamp: new Date(),
          metadata: {
            type: 'thinking_ping',
            elapsedMs: ping.elapsedMs,
            lastActivityType: ping.lastActivityType,
          },
        };
      }
    }

    for await (const streamChunk of streamToIterate) {
      if (signal?.aborted) return;
      // Bug #45: any arriving chunk resets the stall-steer flag. The stall
      // only fires during absolute silence (>30s with no chunks at all).
      stallSteerFiredThisSilence = false;
      const chunk = streamChunk as any;

      switch (chunk.type as string) {
          case 'text-delta': {
          // Clear time-to-first-token timeout once we receive content
          onFirstToken();
          // Update activity tracker (Bug #45: resets stall-steer timer)
          lastActivityTime = Date.now();
          stallSteerFiredThisSilence = false;
          lastActivityType = 'text';
          const deltaText = (chunk as any).text ?? '';
          lastActivityDetail = deltaText.slice(0, 60);
          totalTokensReceived += deltaText.length;
          // Decay extension multiplier: if the model is actively producing text
          // (not waiting for a tool result), reset to 1x so we don't accumulate
          // inflated timeouts across multiple tool rounds.
          activeExtensionMultiplier = 1;
          // Reset rolling idle timeout - activity detected
          resetIdleTimeout();

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
          // Update activity tracker
          lastActivityTime = Date.now();
          lastActivityType = 'reasoning';
          // Reset rolling idle timeout - activity detected
          resetIdleTimeout();
          
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
          lastActivityTime = Date.now();
          lastActivityType = 'reasoning';
          const reasoningText = (chunk as any).text ?? (chunk as any).delta ?? '';
          lastActivityDetail = reasoningText.slice(0, 40) || '';
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
          lastActivityTime = Date.now();
          lastActivityType = 'reasoning';
          const reasoningText = (chunk as any).text ?? (chunk as any).delta ?? '';
          lastActivityDetail = reasoningText.slice(0, 40) || '';
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
          lastActivityTime = Date.now();
          lastActivityType = 'reasoning';
          lastActivityDetail = '[reasoning-end]';
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
            // Update activity tracker
            lastActivityTime = Date.now();
            lastActivityType = 'tool-call';
            lastActivityDetail = (chunk as any).toolName || '';
            toolCallCount++;
            // Dynamically extend idle timeout: tool execution (bash, file ops) can
            // take longer than the normal idle window. We extend by 2x so the model
            // has time to produce tool calls, the tool executor runs, and the result
            // comes back — without the idle timeout firing mid-execution.
                        activeExtensionMultiplier = TOOL_SUCCESS_EXTENSION_MULTIPLIER;
resetIdleTimeout(TOOL_SUCCESS_EXTENSION_MULTIPLIER);
            
            // AI SDK v6 uses 'input' (parsed object) in fullStream tool-call parts
            let callArgs = (() => {
              const raw = (chunk as any).input ?? (chunk as any).args ?? (chunk as any).arguments;
              if (typeof raw === 'string') {
                try { return JSON.parse(raw); } catch { return {}; }
              }
              return raw || {};
            })();
            const toolName = (chunk as any).toolName;
            const toolCallId = (chunk as any).toolCallId;
            const isInvalid = !!(chunk as any).invalid;

            // SELF-HEALING: Normalize tool args to fix common LLM mistakes
            // (wrong field names like "filename" → "path", "code" → "content")
            try {
              const { normalizeToolArgs } = await import('../mcp/vfs-mcp-tools');
              callArgs = normalizeToolArgs(toolName, callArgs);
              (chunk as any).input = callArgs;
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

            // CRITICAL: Only yield synthetic tool-result if the AI SDK itself
            // rejected this tool call (invalid=true). In that case no real
            // tool-result event will follow. When invalid is false/undefined
            // the AI SDK executed the tool and WILL emit a tool-result — we
            // must NOT duplicate it with a synthetic result here.
            const aiSdkRejected = isInvalid;

            // Check for validation errors (missing required fields)
            if (validationError || !hasArgs) {
              const isArgs = hasArgs;
              const errorCode = validationError ? 'INVALID_ARGS' : 'EMPTY_ARGS';
              const errorMsg = validationError
                ? validationError.message
                : `Tool "${toolName}" called with empty arguments. Please provide all required fields.`;

              chatLogger.error(`[TOOL-CALL] ✗ ${errorCode} — ${isArgs ? 'validation failed' : 'empty args'}`, {
                toolCallId,
                toolName,
                validationError: validationError || undefined,
                severity: 'HIGH',
                aiSdkRejected,
              });

              // Record failure in telemetry
              if (toolName && modelName) {
                recordToolCall(modelName, toolName, false, errorCode);
              }

              if (aiSdkRejected) {
                // No tool-result coming — yield a synthetic failure so the model sees the error
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
                        code: errorCode,
                        message: errorMsg,
                        retryable: true,
                        ...(validationError?.missing ? { missing: validationError.missing } : {}),
                        ...(validationError?.expectedSchema ? { expectedSchema: validationError.expectedSchema } : {}),
                        ...(validationError?.suggestedNextAction
                          ? { suggestedNextAction: validationError.suggestedNextAction }
                          : { suggestedNextAction: `Call ${toolName} again with proper arguments.` }),
                      },
                    },
                  }],
                  timestamp: new Date(),
                };
                break;
              }

              // AI SDK DID execute this tool — fall through to cache args and
              // yield toolCalls; the real tool-result will arrive next and our
              // tool-result handler will produce the real result.
            }

            if (hasArgs) {
              chatLogger.info('[TOOL-CALL] ✓ Tool invoked', {
                toolCallId,
                toolName,
                argsCount,
                argsKeys: Object.keys(callArgs),
                argsPreview: JSON.stringify(callArgs).slice(0, 500),
              });
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
          // Clear time-to-first-token timeout and reset rolling idle timeout.
          // A tool-result signifies the tool execution completed successfully —
          // the stream is alive and well. Without this reset, long multi-tool
          // workflows (read file → process → apply edits) get cut off because
          // the idle timeout fires during tool execution.
          onFirstToken();
          // Update activity tracker
          lastActivityTime = Date.now();
          const trName = (chunk as any).toolName || '';
          lastActivityType = 'tool-result';
          lastActivityDetail = trName;
          // Dynamically extend idle timeout: after a successful tool result, the
          // model needs time to read the result and produce the next step. Extending
          // by 2x prevents premature cutoff during multi-step reasoning.
          const trResult = (chunk as any).result;
          const trSuccess = trResult?.success ?? (trResult?.error === undefined);
          if (trSuccess) {
            toolResultSuccessCount++;
            activeExtensionMultiplier = TOOL_SUCCESS_EXTENSION_MULTIPLIER;
            resetIdleTimeout(TOOL_SUCCESS_EXTENSION_MULTIPLIER);
          } else {
            toolResultFailCount++;
            activeExtensionMultiplier = 1;
            resetIdleTimeout();
          }

          // Recover args from the earlier tool-call event since tool-result doesn't include them
          const resultToolCallId = (chunk as any).toolCallId;
          const cachedArgs = toolCallArgsCache.get(resultToolCallId);
          const finalArgs = (() => {
            const raw = cachedArgs ?? (chunk as any).input ?? (chunk as any).args ?? (chunk as any).arguments;
            if (typeof raw === 'string') {
              try { return JSON.parse(raw); } catch { return {}; }
            }
            return raw || {};
          })();
          const toolResult = (chunk as any).output ?? (chunk as any).result;
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

          // PHASE 3: Track consecutive tool call failures
          if (resultSuccess) {
            consecutiveToolFailures = 0; // Reset on success
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
              consecutiveFailures: consecutiveToolFailures + 1,
            });
            consecutiveToolFailures++;

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
          // Step transitions mark the start/end of a multi-step tool calling round.
          // Reset the idle timeout so long workflows with many tool rounds are not
          // cut off — each new step is evidence the stream is actively processing.
          onFirstToken();
          // Update activity tracker
          lastActivityTime = Date.now();
          lastActivityType = 'step';
          lastActivityDetail = '';
          activeExtensionMultiplier = 1;
          resetIdleTimeout();
          break;
        case 'start':
        case 'finish':
          // Skip these event types — handled elsewhere
  break;
}
}
} finally {
  if (ttftTimeoutId) clearTimeout(ttftTimeoutId);
  if (idleTimeoutId) clearTimeout(idleTimeoutId);
  stopThinkPingInterval();
}

// Get final usage and metadata (from the winner's result if speculative fallback was used)
const finalResult = fallbackResultRef?.result || result;
const usage = await finalResult.usage;
const finishReason = (await finalResult.finishReason) || 'stop';
const toolCalls = await finalResult.toolCalls;
const steps = await finalResult.steps;

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
        // Text-mode fallback ONLY makes sense for FILE-EDIT tools — those have a
        // parseable text equivalent (```file:/```diff:/```mkdir:/```delete:).
        // Other tools (web_search, bash_execute, read_file, search_files, …) have
        // no text representation: stripping them and "retrying in text-mode" cannot
        // recover the call. So we only trigger Phase 2 when at least one available
        // (or attempted) tool is in the file-edit set; otherwise we leave Phase 1's
        // result alone and let the upper-layer SelfHeal retry with feedback instead.
        const supportsFC = (vercelModel as any)?.supports?.functionCalling;
        const FILE_EDIT_TOOLS = new Set([
          'write_file', 'batch_write', 'apply_diff', 'delete_file',
        ]);
        const availableToolNames = Object.keys(tools);
        const failedToolNames = allToolCalls
          .filter((tc: any) => tc?.result && (tc.result.success === false || tc.result.error != null))
          .map((tc: any) => tc.name);
        const fileEditToolFailed = failedToolNames.some((n: string) => FILE_EDIT_TOOLS.has(n));
        const fileEditToolAvailable = availableToolNames.some((n) => FILE_EDIT_TOOLS.has(n));

        if (supportsFC === undefined) {
          const allToolCallsFailed = allToolCalls.length > 0 && allToolCalls.every((tc: any) => {
            const r = tc?.result;
            return r && (r.success === false || r.error != null);
          });
          const hasToolCallPattern = !!textContent && (
            textContent.includes('"tool"') ||
            textContent.includes('"function"') ||
            textContent.includes('"name"') ||
            textContent.includes('"tool_name"') ||
            textContent.includes('"arguments"') ||
            textContent.includes('"args"') ||
            textContent.includes('"input"') ||
            textContent.includes('"batch_write"') ||
            textContent.includes('"write_file"') ||
            /```(?:file|diff|mkdir|delete):/i.test(textContent)
          );
          const noOutputAtAll = !textContent && allToolCalls.length === 0;

          // Gate: text-mode can only substitute when a file-edit tool was actually
          // attempted-and-failed, OR (in the silent-output case) when at least one
          // file-edit tool was available so the model has *something* to express in text.
          const triggerFallback = hasToolCallPattern
            || (allToolCallsFailed && (!textContent || textContent.length < 20) && fileEditToolFailed)
            || (noOutputAtAll && fileEditToolAvailable);

          if (triggerFallback) {
            chatLogger.warn('[FC-GATE] Phase 2: Retrying in text-mode (file-edit tools only)', {
              provider,
              model: modelName,
              reason: hasToolCallPattern
                ? 'tool-call patterns in text'
                : (allToolCallsFailed
                  ? 'file-edit tool failed with empty response'
                  : 'silent output and file-edit tools available'),
              textContentLength: textContent?.length || 0,
              toolCallCount: allToolCalls.length,
              failedToolNames,
              fileEditToolAvailable,
            });

            // Issue second completion with text-mode instructions
            const fallbackStreamOptions = { ...streamOptions };
            delete fallbackStreamOptions.tools; // Strip tools
            const textModeInstructions = TEXT_MODE_TOOL_INSTRUCTIONS + '\n\n' + getTextModeInstructions();
            if (fallbackStreamOptions.system) {
              fallbackStreamOptions.system = fallbackStreamOptions.system + '\n\n' + textModeInstructions;
            } else {
              fallbackStreamOptions.system = textModeInstructions;
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

      // ── PHASE 3: After ≥2 consecutive tool call failures, retry with a telemetry-derived
      // reliable tool-calling model — independent of whether Phase 2 text-mode ran.
      // This surfaces models that have demonstrated >65% tool-call success rate
      // in the rolling 30-min window (from tool-call-telemetry).
      if (consecutiveToolFailures >= 2 && allToolCalls.length > 0 && (toolCallStreaming ?? true)) {
        const capableModels = getModelsForPurpose('tool-calling', { maxModels: 3 });
        const currentModelKey = `${provider}:${modelName}`;
        const betterModel = capableModels.find(
          m => `${m.provider}:${m.model}` !== currentModelKey && m.provider !== provider
        );

        if (betterModel) {
          chatLogger.warn('[FC-GATE] Phase 3: Retrying with telemetry-derived reliable FC model', {
            provider,
            model: modelName,
            consecutiveToolFailures,
            retryProvider: betterModel.provider,
            retryModel: betterModel.model,
            retryScore: betterModel.score,
            retryToolSuccessRate: betterModel.toolSuccessRate,
          });

          try {
            const { getVercelModel } = await import('./vercel-ai-streaming');
            const currentEnv: any = typeof process !== 'undefined' ? process.env : {};
            const apiKey = currentEnv[`${betterModel.provider.toUpperCase()}_API_KEY`];
            const baseURL = currentEnv[`${betterModel.provider.toUpperCase()}_BASE_URL`];
            const retryVercelModel = getVercelModel(
              betterModel.provider,
              betterModel.model,
              apiKey,
              baseURL,
            );

            if (!retryVercelModel) {
              chatLogger.warn('[FC-GATE] Phase 3: getVercelModel returned null — falling through to final chunk', {
                retryProvider: betterModel.provider,
                retryModel: betterModel.model,
                consecutiveToolFailures,
              });
              // Do NOT fall through — continue to Phase 4 final chunk which will use the
              // original stream's finishReason (may be 'stop' if original stream completed)
            } else {
              // Build clean retry options: same base, different model, tools stripped.
              // Inject healing context so the new model understands what failed and why.
              const healingInstructions = buildHealingInstructions(consecutiveToolFailures);
              const retrySystem = healingInstructions
                ? (systemPrompt ? `${systemPrompt}

${healingInstructions}` : healingInstructions)
                : systemPrompt;

              const retryOptions: any = {
                model: retryVercelModel,
                messages: chatMessages,
                temperature: temp,
                maxOutputTokens: maxT,
                maxRetries: 0,
                // v6: use stopWhen instead of the removed `maxSteps` option.
                stopWhen: stepCountIs(maxSteps),
                abortSignal: effectiveSignal,
                experimental_telemetry: {
                  isEnabled: false,
                  functionId: 'llm-stream-fallback',
                  metadata: {
                    provider,
                    model: modelName,
                    fallback: 'model-capability',
                    retryProvider: betterModel.provider,
                    retryModel: betterModel.model,
                    consecutiveToolFailures,
                    healingContext: !!healingInstructions,
                  },
                },
              };
              if (retrySystem) retryOptions.system = retrySystem;

              let phase3Yielded = false;
              let retryFinishReason: string | undefined = 'stop';
              const retryResult = streamText(retryOptions);
              for await (const retryChunk of retryResult.fullStream) {
                if (effectiveSignal?.aborted) break;
                if (retryChunk.type === 'finish') {
                  retryFinishReason = (retryChunk as any).finishReason ?? 'stop';
                }
                if (retryChunk.type === 'text-delta') {
                  phase3Yielded = true;
                  yield {
                    content: (retryChunk as any).text ?? '',
                    isComplete: false,
                    timestamp: new Date(),
                    metadata: {
                      fcFallback: 'model-capability',
                      originalProvider: provider,
                      originalModel: modelName,
                      retryProvider: betterModel.provider,
                      retryModel: betterModel.model,
                    },
                  };
                }
              }
              if (phase3Yielded) {
                // Phase 3 produced output — yield proper completion chunk so caller
                // receives finishReason + usage without waiting for a timeout.
                const retryUsage = await retryResult.usage;
                chatLogger.info('[FC-GATE] Phase 3 model-capability fallback completed', {
                  retryProvider: betterModel.provider,
                  retryModel: betterModel.model,
                  retryFinishReason,
                });
                yield {
                  content: '',
                  isComplete: true,
                  finishReason: retryFinishReason,
                  tokensUsed: retryUsage?.totalTokens || 0,
                  usage: {
                    promptTokens: (retryUsage as any)?.inputTokens || (retryUsage as any)?.promptTokens || 0,
                    completionTokens: (retryUsage as any)?.outputTokens || (retryUsage as any)?.completionTokens || 0,
                    totalTokens: retryUsage?.totalTokens || 0,
                  },
                  timestamp: new Date(),
                  metadata: {
                    vercelAI: true,
                    provider: betterModel.provider,
                    model: betterModel.model,
                    fcFallback: 'model-capability',
                    originalProvider: provider,
                    originalModel: modelName,
                    latencyMs: Date.now() - startTime,
                  },
                };
                return; // Phase 3 fully handled — done with this stream
              }
            }
          } catch (phase3Error) {
            chatLogger.error('[FC-GATE] Phase 3 fallback also failed', {
              retryProvider: betterModel.provider,
              retryModel: betterModel.model,
              error: phase3Error.message,
            });
          }
        } else {
          chatLogger.warn('[FC-GATE] Phase 3: No better model found in capability registry', {
            provider,
            model: modelName,
            consecutiveToolFailures,
            capableModelsCount: capableModels.length,
          });
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
        provider: actualProvider,
        model: actualModel,
        // Explicit `actualProvider`/`actualModel` fields for route.ts compatibility
        // (the route handler checks streamChunk.metadata.actualProvider to detect
        //  fallback-driven provider changes during streaming).
        actualProvider,
        actualModel,
        latencyMs: Date.now() - startTime,
        steps: steps?.length || 0,
        ...(actualProvider !== provider
          ? {
              speculativeFallback: true,
              originalProvider: provider,
              originalModel: modelName,
            }
          : {}),
        // Include loser details when a speculative fallback was used
        ...(speculativeLoserInfo
          ? {
              speculativeLoserProvider: speculativeLoserInfo.provider,
              speculativeLoserModel: speculativeLoserInfo.model,
              speculativeLoserLatencyMs: speculativeLoserInfo.latencyMs,
            }
          : {}),
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

      chatLogger.info('Streaming fallback activated. Using dynamic provider registry.', { 
        fallbackProvider: fallbackProviderName, 
        fallbackModel: fallbackModelName 
      });

      let fallbackModel: any;
      try {
        // Use the centralized provider registry instead of hardcoded factory calls
        const { getVercelModel } = await import('./vercel-ai-streaming');

        // Construct the key/URL dynamically using the same logic as the primary request
        const apiKey = currentEnv[`${fallbackProviderName.toUpperCase()}_API_KEY`];
        const baseURL = currentEnv[`${fallbackProviderName.toUpperCase()}_BASE_URL`];

        fallbackModel = await getVercelModel(
          fallbackProviderName, 
          fallbackModelName, 
          apiKey, 
          baseURL
        );

        if (!fallbackModel) {
          throw new Error(`Failed to initialize fallback provider: ${fallbackProviderName}`);
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
          // v6: use stopWhen instead of the removed `maxSteps` option.
          stopWhen: stepCountIs(maxSteps),
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
            const textModeInstructions = TEXT_MODE_TOOL_INSTRUCTIONS + '\n\n' + getTextModeInstructions();
            if (fallbackStreamOptions.system) {
              fallbackStreamOptions.system = fallbackStreamOptions.system + '\n\n' + textModeInstructions;
            } else {
              fallbackStreamOptions.system = textModeInstructions;
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
            let fbCallArgs = (() => {
              const raw = (chunk as any).input ?? (chunk as any).args ?? (chunk as any).arguments;
              if (typeof raw === 'string') {
                try { return JSON.parse(raw); } catch { return {}; }
              }
              return raw || {};
            })();
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
                args: (() => {
                  const r = (chunk as any).input ?? (chunk as any).args;
                  if (typeof r === 'string') { try { return JSON.parse(r); } catch { return {}; } }
                  return r || {};
                })(),
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
        if (idleTimeoutId) clearTimeout(idleTimeoutId);

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
        if (idleTimeoutId) clearTimeout(idleTimeoutId);

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
