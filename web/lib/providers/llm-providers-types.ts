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
  subProviders?: string[];  // For ninerouter: list of enabled sub-providers for UI filtering
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
      'openai/gpt-4o',
      'google/gemini-3.1-flash-lite-preview',
      'google/gemini-3.1-pro',
      'google/gemini-2.5-flash',
      'meta-llama/llama-4-maverick',
      'meta-llama/llama-4-scout',
      'mistral/mistral-large-2',
      'mistral/mistral-large',
      'mistral/mistral-small-3.2',
      'anthropic/claude-sonnet-4-6',
      'anthropic/claude-sonnet-4',
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
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-1.5-pro',
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
  groq: {
    id: 'groq',
    name: 'Groq',
    models: [
      'llama-3.3-70b-versatile',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
    apiKeyEnv: 'GROQ_API_KEY',
    description: 'Groq ultra-fast inference',
    supportsStreaming: true,
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    models: [
      'z-ai/glm-5.1',
      'minimaxai/minimax-m2.7',
      'moonshotai/kimi-k2.6',
      'deepseek-ai/deepseek-v4-flash',
      'qwen/qwen3.5-122b-a10b',
      'stepfun-ai/step-3.7-flash',
      'meta/llama-4-maverick-17b-128e-instruct',
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
      'gpt-3.5-turbo',
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
      'claude-sonnet-4-5',
      'claude-sonnet-4-20250514',
      'claude-opus-4-6-thinking',
      'claude-opus-4-20250514',
      'claude-3.5-sonnet',
      'claude-3-5-sonnet-latest',
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
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'mistralai/Mixtral-8x22B-Instruct-v0.1',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
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
      'qwen-safety',
      'nova-fast',
      'nova',
      'mistral',
      'qwen-coder',
      'llama-scout',
      'openai',
      'gemini-fast',
      'perplexity-fast',
      'qwen-vision',
      'openai-fast',
      'llama',
      'minimax',
      'kimi',
      'claude-fast',
      'perplexity-reasoning',
      'qwen-large',
      'gemini',
      'glm',
      'qwen-coder-large',
      'kimi-k2.6',
      'openai-large',
      'grok',
      'gpt-5.4-mini',
      'gpt-5.5',
      'mistral-4',
      'openai-audio',
      'openai-audio-large',
      'gemini-3.5-flash',
      'gemini-flash-lite-3.1',
      'deepseek',
      'gemma',
      'deepseek-pro',
      'grok-large',
      'grok-4.3',
      'gemini-search',
      'gemini-search-fast',
      'gemini-search-large',
      'midijourney',
      'midijourney-large',
      'claude',
      'claude-large',
      'claude-opus-4.7',
      'claude-opus-4.8',
      'perplexity-deep',
      'gemini-large',
      'llama-maverick',
      'minimax-m3',
      'mistral-large',
      'polly',
      'qwen-vision-pro',
      'step-flash',
      'step-3.5-flash',
    ],
    apiKeyEnv: 'POLLINATIONS_API_KEY',
    description: 'Pollinations AI Free LLM API',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  chatanywhere: {
    id: 'chatanywhere',
    name: 'ChatAnywhere',
    models: [
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
    ],
    apiKeyEnv: 'CHATANYWHERE_API_KEY',
    endpoint: 'https://api.chatanywhere.org',
    description: 'ChatAnywhere — OpenAI models via ChatAnywhere API with GPT-5.5, GPT-5.4, and GPT-5.4-mini',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
  ninerouter: {
    id: 'ninerouter',
    name: '9Router',
    subProviders: ['gemini', 'ag', 'gc', 'gh', 'kc', 'kr', 'oc', 'openrouter', 'nvidia', 'ollama', 'cf', 'mistral', 'cx', 'qd'],
    models: [
      // Gemini API models
      'gemini/gemini-3.1-flash-lite-preview',
      'gemini/gemini-3.1-pro-preview',
      'gemini/gemini-3-flash-preview',
      'gemini/gemini-2.5-pro',
      'gemini/gemini-2.5-flash',
      'gemini/gemini-2.5-flash-lite',
      'gemini/gemini-2.0-flash',
      'gemini/gemini-2.0-flash-lite',
      'gemini/gemma-4-31b-it',
      // Antigravity OAuth models
      'ag/gemini-3.1-pro-high',
      'ag/gemini-3.1-pro-low',
      'ag/gemini-3-flash',
      'ag/gemini-3.5-flash-low',
      'ag/gemini-3.5-flash-extra-low',
      'ag/gemini-3-flash-agent',
      'ag/claude-sonnet-4-6',
      'ag/claude-opus-4-6-thinking',
      'ag/gpt-oss-120b-medium',
      // Gemini CLI OAuth models
      'gc/gemini-3-flash-preview',
      'gc/gemini-3-pro-preview',
      // GitHub Copilot OAuth models
      'gh/gpt-3.5-turbo',
      'gh/gpt-4',
      'gh/gpt-4o',
      'gh/gpt-4o-mini',
      'gh/gpt-4.1',
      'gh/gpt-5-mini',
      'gh/gpt-5.2',
      'gh/gpt-5.2-codex',
      'gh/gpt-5.3-codex',
      'gh/gpt-5.4',
      'gh/gpt-5.4-mini',
      'gh/claude-haiku-4.5',
      'gh/claude-opus-4.5',
      'gh/claude-sonnet-4',
      'gh/claude-sonnet-4.5',
      'gh/claude-sonnet-4.6',
      'gh/claude-opus-4.6',
      'gh/claude-opus-4.7',
      'gh/gemini-2.5-pro',
      'gh/gemini-3-flash-preview',
      'gh/gemini-3.1-pro-preview',
      'gh/grok-code-fast-1',
      'gh/oswe-vscode-prime',
      'gh/goldeneye-free-auto',
      // Kilo Code OAuth models
      'kc/anthropic/claude-sonnet-4-20250514',
      'kc/anthropic/claude-opus-4-20250514',
      'kc/google/gemini-2.5-pro',
      'kc/google/gemini-2.5-flash',
      'kc/openai/gpt-4.1',
      'kc/openai/o3',
      'kc/deepseek/deepseek-chat',
      'kc/deepseek/deepseek-reasoner',
      'kc/kilo-auto/free',
      'kc/nvidia/nemotron-3-super-120b-a12b:free',
      'kc/poolside/laguna-m.1:free',
      'kc/stepfun/step-3.5-flash:free',
      'kc/baidu/cobuddy:free',
      'kc/openrouter/owl-alpha',
      'kc/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'kc/poolside/laguna-xs.2:free',
      'kc/deepseek/deepseek-v4-flash:free',
      'kc/openrouter/free',
      'kc/x-ai/grok-code-fast-1:optimized:free',
      'kc/qwen/qwen3.7-plus:free',
      'kc/nvidia/nemotron-3-ultra-550b-a55b:free',
      // Kiro (Amazon) models
      'kr/claude-sonnet-4.5',
      'kr/claude-haiku-4.5',
      'kr/deepseek-3.2',
      'kr/qwen3-coder-next',
      'kr/glm-5',
      'kr/MiniMax-M2.5',
      'kr/claude-sonnet-4.5-thinking',
      'kr/claude-haiku-4.5-thinking',
      'kr/claude-sonnet-4.5-agentic',
      'kr/claude-haiku-4.5-agentic',
      'kr/claude-sonnet-4.5-thinking-agentic',
      'kr/claude-haiku-4.5-thinking-agentic',
      // Opencode Free Models
      'oc/oc/<auto>',
      'oc/minimax-m2.5-free',
      'oc/oc/hy3-preview-free',
      'oc/ling-2.6-flash-free',
      'oc/trinity-large-preview-free',
      'oc/oc/nemotron-3-super-free',
      'oc/nemotron-3-super-free',
      'oc/deepseek-v4-flash-free',
      'oc/qwen3.6-plus-free',
      'oc/minimax-m3-free',
      'oc/big-pickle',
      'oc/nemotron-3-ultra-free',
      // OpenRouter models
      'openrouter/qwen/qwen3-next-80b-a3b-instruct:free',
      'openrouter/qwen/qwen3-coder:free',
      'openrouter/openrouter/free',
      'openrouter/z-ai/glm-5.1',
      'openrouter/nvidia/nemotron-3-nano-30b-a3b:free',
      'openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      'openrouter/google/gemma-4-31b-it:free',
      'openrouter/google/gemma-4-26b-a4b-it:free',
      'openrouter/nvidia/nemotron-3-super-120b-a12b:free',
      'openrouter/google/lyria-3-pro-preview',
      'openrouter/deepseek/deepseek-v4-flash:free',
      'openrouter/openrouter/owl-alpha',
      'openrouter/google/lyria-3-clip-preview',
      'openrouter/arcee-ai/trinity-large-thinking:free',
      'openrouter/moonshotai/kimi-k2.6:free',
      // Ollama Cloud models
      'ollama/gpt-oss:120b',
      'ollama/kimi-k2.5',
      'ollama/glm-5',
      'ollama/minimax-m2.5',
      'ollama/glm-4.7-flash',
      'ollama/qwen3.5',
      // Cloudflare Workers AI models — re-enabled after testing confirmed the
      // ninerouter server correctly handles cf/ routing (tested with 429 responses
      // from Cloudflare, proving end-to-end connectivity).
      'cf/@cf/meta/llama-3.2-1b-instruct',
      'cf/@cf/meta/llama-3.2-3b-instruct',
      'cf/@cf/meta/llama-3.1-8b-instruct-fp8-fast',
      'cf/@cf/meta/llama-3.1-8b-instruct-awq',
      'cf/@cf/mistralai/mistral-small-3.1-24b-instruct',
      'cf/@cf/meta/llama-3.1-70b-instruct-fp8-fast',
      'cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      'cf/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      'cf/@cf/moonshotai/kimi-k2.5',
      'cf/@cf/moonshotai/kimi-k2.6',
      'cf/@cf/zai-org/glm-4.7-flash',
      'cf/@cf/qwen/qwq-32b',
      'cf/@cf/qwen/qwen2.5-coder-32b-instruct',
      // Mistral models
      'mistral/mistral-large-latest',
      'mistral/codestral',
      'mistral/mistral-small',
      'mistral/codestral-latest',
      'mistral/mistral-medium-latest',
      // NVIDIA NIM models
      'nvidia/z-ai/glm-5.1',
      'nvidia/minimaxai/minimax-m2.7',
      'nvidia/moonshotai/kimi-k2.6',
      'nvidia/deepseek-ai/deepseek-v4-flash',
      'nvidia/qwen/qwen3.5-122b-a10b',
      'nvidia/stepfun-ai/step-3.7-flash',
      'nvidia/meta/llama-4-maverick-17b-128e-instruct',
      // Codex models
      'cx/gpt-5.5',
      'cx/gpt-5.4',
      'cx/gpt-5.5-review',
      'cx/gpt-5.4-review',
      'cx/gpt-5.4-mini-review',
      'cx/gpt-5.4-mini',
      'cx/gpt-5.3-codex',
      'cx/gpt-5.3-codex-review',
      'cx/gpt-5.3-codex-xhigh',
      'cx/gpt-5.3-codex-xhigh-review',
      'cx/gpt-5.3-codex-high',
      'cx/gpt-5.3-codex-low',
      'cx/gpt-5.3-codex-low-review',
      'cx/gpt-5.3-codex-none',
      'cx/gpt-5.3-codex-spark',
      'cx/gpt-5.3-codex-spark-review',
      // Qoder models
      'qd/auto',
      'qd/ultimate',
      'qd/performance',
      'qd/lite',
      'qd/dmodel',
      'qd/gm51model',
      'qd/mmodel',
      'qd/efficient',
      'qd/qmodel',
      'qd/dfmodel',
      'qd/kmodel',
      // Vercel-backed models
      'vercel/openai/gpt-5-nano',
      'vercel/deepseek/deepseek-v3.2-thinking',
      'vercel/deepseek/deepseek-v4-flash',
      'vercel/xiaomi/mimo-v2.5',
      'vercel/meta/llama-3.1-8b',
      'vercel/alibaba/qwen-3-14b',
      'vercel/minimax/minimax-m2.7-highspeed',
      'vercel/minimax/minimax-m2.7',
      'vercel/minimax/minimax-m3',
    ],
    apiKeyEnv: 'NINEROUTER_API_KEY',
    description: '9Router — Unified gateway to multiple AI providers via single endpoint',
    supportsStreaming: true,
    supportsFunctionCalling: true,
  },
};

export type VercelProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'openrouter' | 'github' | 'nvidia' | 'groq' | 'together' | 'chutes' | 'zo' | 'zen' | 'cloudflare' | 'antigravity' | 'cohere' | 'replicate' | 'portkey' | 'azure' | 'vertex' | 'ollama' | 'kiro' | 'aihubmix' | 'livekit' | 'pollinations' | 'chatanywhere' | 'ninerouter';

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

/* CLI_PROVIDERS, isCLIProvider, isCLIProviderConfigured — import directly from
 * lib/chat/vercel-ai-streaming if needed. Re-exporting from here would make
 * Turbopack follow the server-only dependency chain in the client bundle. */
