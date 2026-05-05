/**
 * Client-safe types and constants for LLM providers.
 *
 * This file contains ONLY the types and constants needed by Client Components.
 * It does NOT import any SDK (openai, cohere-ai, etc.) so webpack won't
 * bundle Node.js-only modules (fs, node:fs/promises) into client bundles.
 *
 * Client components (conversation-interface.tsx, use-enhanced-chat.ts, etc.)
 * should import from this file, NOT from llm-providers.ts.
 *
 * Server-only code (API routes, streaming handlers) should continue to
 * import from llm-providers.ts directly.
 */

// Model configuration with optional tags
export interface ModelConfig {
  id: string;
  tags?: string[];
}

// Provider metadata — just config, no SDK
export interface LLMProviderConfig {
  id: string;
  name: string;
  models: Array<ModelConfig | string>;  // Support both object and string formats
  apiKeyEnv?: string;
  description?: string;
  supportsStreaming?: boolean;
  supportsFunctionCalling?: boolean;
  supportsEmbedding?: boolean;
  maxTokens?: number;
  maxOutputTokens?: number;
  endpoint?: string;
  isAvailable?: boolean;  // Whether the provider is currently available (set at runtime)
}

// LLM message types
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool' | 'function';

export interface LLMMessageContentPart {
  type: string;
  text?: string;
  image_url?: { url: string };
}

export interface LLMMessage {
  role: LLMRole;
  content: string | LLMMessageContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

// Streaming response type
export interface StreamingResponse {
  content?: string;
  reasoning?: string;
  isComplete?: boolean;
  finishReason?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolInvocations?: Array<{
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
  }>;
  tokensUsed?: number;
  usage?: { prompt: number; completion: number; total: number };
  metadata?: Record<string, unknown>;
  files?: Array<{ path: string; content: string }>;
  commands?: {
    request_files?: string[];
    write_diffs?: string[];
  };
}

// Provider constants — static config only, no SDK imports
export const PROVIDERS: Record<string, LLMProviderConfig> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    models: [
      'openai/gpt-oss-120b',
      'openai/gpt-5.2',
      'openai/gpt-5.2-codex',
      'google/gemini-3.1-flash-lite-preview',
      'google/gemini-3.1-pro',
      'meta-llama/llama-4-maverick',
      'meta-llama/llama-4-scout',
      'mistral/mistral-large-2',
      'mistral/mistral-small-3.2',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-opus-4-6-thinking',
    ],
    apiKeyEnv: 'OPENROUTER_API_KEY',
    description: 'OpenRouter — access to 200+ models via single API',
    supportsStreaming: true,
    supportsFunctionCalling: false,
  },
  google: {
    id: 'google',
    name: 'Google',
    models: [
      'gemini-3.1-flash-lite-preview',
      'gemini-3.1-flash',
      'gemini-3-pro',
      'gemini-2.5-flash-lite',
    ],
    apiKeyEnv: 'GOOGLE_API_KEY',
    description: 'Google Gemini — fast, multimodal, large context',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    models: [
      'mistral-small-latest',
      'mistral-large-latest',
      'mistral-medium-latest',
      'codestral-latest',
    ],
    apiKeyEnv: 'MISTRAL_API_KEY',
    description: 'Mistral AI — fast, efficient, open-weight models',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  github: {
    id: 'github',
    name: 'GitHub Models',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'meta-llama-3.3-70b-instruct',
      'meta-llama-3.1-405b-instruct',
      'Phi-4',
      'DeepSeek-R1',
    ],
    apiKeyEnv: 'GITHUB_MODELS_API_KEY',
    description: 'GitHub Models — free access to top models via Azure',
    supportsStreaming: true,
    supportsFunctionCalling: false,
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    models: [
      'meta/llama-3.3-70b-instruct',
      'meta/llama-3.1-405b-instruct',
      'mistralai/mistral-large-2',
      'google/gemma-2-27b-it',
    ],
    apiKeyEnv: 'NVIDIA_API_KEY',
    description: 'NVIDIA NIM — optimized inference for popular models',
    supportsStreaming: true,
    supportsFunctionCalling: false,
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    models: ['opencode'],
    description: 'OpenCode CLI — local agentic coding engine',
    supportsStreaming: false,
    supportsFunctionCalling: false,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'o1',
      'o1-mini',
    ],
    apiKeyEnv: 'OPENAI_API_KEY',
    description: 'OpenAI — GPT-4o, o1, and more',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  chutes: {
    id: 'chutes',
    name: 'Chutes',
    models: [
      'llama-3.3-70b-instruct',
      'mixtral-8x22b-instruct',
    ],
    apiKeyEnv: 'CHUTES_API_KEY',
    description: 'Chutes — decentralized GPU inference',
    supportsStreaming: true,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      'claude-sonnet-4-6',
      'claude-opus-4-6-thinking',
      'claude-3.5-sonnet',
      'claude-3.5-haiku',
    ],
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    description: 'Anthropic Claude — safe, reliable, high-quality',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    models: [
      'command-r-plus',
      'command-r',
      'command',
    ],
    apiKeyEnv: 'COHERE_API_KEY',
    description: 'Cohere — enterprise-grade language models',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  together: {
    id: 'together',
    name: 'Together AI',
    models: [
      'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
      'mistralai/Mixtral-8x22B-Instruct-v0.1',
    ],
    apiKeyEnv: 'TOGETHER_API_KEY',
    description: 'Together AI — open-source model inference',
    supportsStreaming: true,
  },
  replicate: {
    id: 'replicate',
    name: 'Replicate',
    models: [
      'meta/meta-llama-3-70b-instruct',
      'mistralai/mixtral-8x7b-instruct-v0.1',
    ],
    apiKeyEnv: 'REPLICATE_API_KEY',
    description: 'Replicate — serverless ML model hosting',
    supportsStreaming: false,
  },
  portkey: {
    id: 'portkey',
    name: 'Portkey',
    models: [
      'gpt-4o',
      'claude-3-5-sonnet',
      'gemini-pro',
    ],
    apiKeyEnv: 'PORTKEY_API_KEY',
    description: 'Portkey — AI gateway with routing & fallbacks',
    supportsStreaming: true,
  },
  azure: {
    id: 'azure',
    name: 'Azure OpenAI',
    models: [
      'gpt-4o',
      'gpt-4',
      'gpt-35-turbo',
    ],
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
    description: 'Azure OpenAI — enterprise-grade OpenAI models',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  vertex: {
    id: 'vertex',
    name: 'Vertex AI',
    models: [
      'gemini-pro',
      'gemini-ultra',
      'claude-3-5-sonnet',
    ],
    apiKeyEnv: 'VERTEX_API_KEY',
    description: 'Google Vertex AI — managed Gemini & Claude',
    supportsStreaming: true,
  },
  zo: {
    id: 'zo',
    name: 'Zo',
    models: ['zo'],
    apiKeyEnv: 'ZO_API_KEY',
    description: 'Zo — custom model provider',
    supportsStreaming: true,
  },
  zen: {
    id: 'zen',
    name: 'Zen',
    models: [
      'zen-gpt-4o',
      'zen-claude-sonnet',
    ],
    apiKeyEnv: 'ZEN_API_KEY',
    description: 'Zen — AI inference platform',
    supportsStreaming: true,
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    models: [
      '@cf/meta/llama-3.3-70b-instruct',
      '@cf/mistral/mistral-7b-instruct-v0.2',
      '@cf/qwen/qwen1.5-14b-chat-awq',
    ],
    apiKeyEnv: 'CLOUDFLARE_API_KEY',
    description: 'Cloudflare Workers AI — edge inference',
    supportsStreaming: true,
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity',
    models: [
      'antigravity-gemini-3-pro',
      'antigravity-gemini-3.1-pro',
      'antigravity-gemini-3-flash',
      'antigravity-claude-sonnet-4-6',
      'antigravity-claude-opus-4-6-thinking',
    ],
    description: 'Google Antigravity — Gemini 3 & Claude 4.6 via Google OAuth quota',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    models: [
      'minimax-m2.5',
      'gpt-oss:120b',
      'kimi-k2.5',
      'qwen3.5',
    ],
    apiKeyEnv: 'QUAZ_API_KEY',
    description: 'Ollama local LLM server via 9router proxy',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  kiro: {
    id: 'kiro',
    name: 'Kiro',
    models: [
      'kr/claude-sonnet-4.5',
      'kr/claude-haiku-4.5',
      'kr/glm-5',
      'kr/deepseek-3.2',
      'kr/MiniMax-M2.5',
    ],
    apiKeyEnv: 'QUAZ_API_KEY',
    description: 'Kiro LLM provider via 9router proxy',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  aihubmix: {
    id: 'aihubmix',
    name: 'AIHubMix',
    models: [
      'gpt-4o',
      'claude-3-5-sonnet',
      'gemini-1.5-pro',
      'deepseek-chat',
    ],
    apiKeyEnv: 'AIHUBMIX_API_KEY',
    description: 'AIHubMix OpenAI compatible provider',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  livekit: {
    id: 'livekit',
    name: 'LiveKit',
    models: [
      'deepseek-ai/deepseek-v3.1',
      'deepseek-ai/deepseek-v3',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-flash-lite',
      'google/gemini-2.5-pro',
      'google/gemini-3-flash-preview',
      'google/gemini-3.1-flash-lite-preview',
      'google/gemini-3.1-pro-preview',
      'moonshotai/kimi-k2.5',
      'openai/gpt-4.1',
      'openai/gpt-4.1-mini',
      'openai/gpt-4.1-nano',
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'openai/gpt-5',
      'openai/gpt-5-mini',
      'openai/gpt-5-nano',
    ],
    apiKeyEnv: 'LIVEKIT_API_KEY',
    description: 'LiveKit Inference API',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  pollinations: {
    id: 'pollinations',
    name: 'Pollinations AI',
    models: [
      'claude-fast',
      'claude-large',
      'claude-opus-4.7',
      'claude',
      'deepseek',
      'deepseek-pro',
      'gemini-fast',
      'gemini',
      'gemini-flash-lite-3.1',
      'gemini-large',
      'gemini-search',
      'openai-audio-large',
      'openai-audio',
      'openai-fast',
      'openai-large',
      'openai',
      'gpt-5.5',
      'grok',
      'grok-large',
      'llama',
      'llama-maverick',
      'llama-scout',
      'midijourney',
      'midijourney-large',
      'minimax',
      'mistral-large',
      'mistral',
      'kimi',
      'kimi-k2.6',
      'nova',
      'nova-fast',
      'perplexity-fast',
      'perplexity-reasoning',
      'polly',
      'qwen-coder',
      'qwen-coder-large',
      'qwen-vision',
      'qwen-large',
      'qwen-safety',
      'glm',
    ],
    apiKeyEnv: 'POLLINATIONS_API_KEY',
    description: 'Pollinations AI Free LLM API',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
};

export type VercelProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'openrouter' | 'github' | 'nvidia' | 'groq' | 'together' | 'chutes' | 'zo' | 'zen' | 'cloudflare' | 'antigravity' | 'cohere' | 'replicate' | 'portkey' | 'azure' | 'vertex' | 'ollama' | 'kiro' | 'aihubmix' | 'livekit' | 'pollinations';

/**
 * Get provider config by ID — safe for client use, no SDK imports.
 */
export function getProviderConfig(providerId: string): LLMProviderConfig | undefined {
  return PROVIDERS[providerId];
}

/**
 * Check if provider supports streaming — safe for client use.
 */
export function providerSupportsStreaming(providerId: string): boolean {
  return PROVIDERS[providerId]?.supportsStreaming ?? false;
}

/**
 * Check if provider supports function calling — safe for client use.
 */
export function providerSupportsFunctionCalling(providerId: string): boolean {
  return PROVIDERS[providerId]?.supportsFunctionCalling ?? false;
}

/**
 * Re-export CLI provider utilities for client-side filtering.
 * These are safe to import on the client since they only check env vars server-side.
 */
export { CLI_PROVIDERS, isCLIProvider, isCLIProviderConfigured } from './vercel-ai-streaming';
