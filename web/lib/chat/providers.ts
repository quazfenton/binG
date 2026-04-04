/**
 * LLM Provider Definitions
 * 
 * This file contains only provider metadata (names, models, capabilities)
 * with no SDK dependencies - safe to import in client components.
 * 
 * The actual SDK initialization happens server-side in llm-providers.ts
 */

export interface LLMProvider {
  id: string
  name: string
  models: string[]
  supportsStreaming: boolean
  maxTokens: number
  description: string
  isAvailable?: boolean
}

export const PROVIDERS: Record<string, LLMProvider> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    models: [
      'gpt-4',
      'gpt-4-turbo',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-instruct'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'OpenAI GPT models'
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    models: [
      'qwen/qwen3-30b-a3b:free',
      'qwen/qwen3-coder:free',
      'openai/gpt-oss-120b:free',
      'z-ai/glm-4.5-air:free',
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'nvidia/nemotron-nano-12b-v2-vl:free',
      'minimax/minimax-m2.5:free', 
      'nvidia/nemotron-3-super-120b-a12b:free', 
      'stepfun/step-3.5-flash:free', 
      'openai/gpt-oss-20b:free',  
      'qwen/qwen3-next-80b-a3b-instruct:free', 
      'arcee-ai/trinity-mini:free',
      'mistralai/mistral-small-3.1-24b-instruct:free',
      'liquid/lfm-2.5-1.2b-instruct:free',
      'arcee-ai/trinity-large-preview:free'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'OpenRouter gateway models'
  },
  chutes: {
    id: 'chutes',
    name: 'Chutes',
    models: ['deepseek-ai/DeepSeek-R1-0528', 'deepseek-ai/DeepSeek-Chat-V3-0324', 'tngtech/DeepSeek-TNG-R1T2-Chimera', 'gemma-3-27b-it', 'meta-llama/Llama-4-Maverick', 'meta-llama/Llama-3.3-70B-Instruct'],
    supportsStreaming: true,
    maxTokens: 100000,
    description: 'Chutes AI with high-performance models'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      'claude-3-5-sonnet-latest',
      'claude-3-5-sonnet-20240620',
      'claude-3-opus-latest',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307'
    ],
    supportsStreaming: true,
    maxTokens: 200000,
    description: 'Anthropic Claude models'
  },
  google: {
    id: 'google',
    name: 'Google',
    models: [
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-preview-09-2025',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash-lite-preview-09-2025'
    ],
    supportsStreaming: true,
    maxTokens: 2000000,
    description: 'Google Gemini models'
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    models: [
      'command-r-plus',
      'command-r',
      'command-nightly',
      'command'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Cohere Command models'
  },
  together: {
    id: 'together',
    name: 'Together AI',
    models: [
      'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      'mistralai/Mixtral-8x22B-Instruct-v0.1'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Together AI models'
  },
  replicate: {
    id: 'replicate',
    name: 'Replicate',
    models: [
      'meta/llama-2-70b-chat',
      'meta/llama-3-70b-instruct',
      'mistralai/mixtral-8x7b-instruct-v0.1'
    ],
    supportsStreaming: false,
    maxTokens: 4096,
    description: 'Replicate models'
  },
  portkey: {
    id: 'portkey',
    name: 'Portkey AI Gateway',
    models: ['openrouter/auto',
      'qwen/qwen3-30b-a3b:free',
      'chutes/gemini-1.5-flash:free',
      'chutes/openrouter-auto:free',
      'chutes/grok-beta:free',
      'chutes/flux-dev:free',
      'chutes/flux-schnell:free'],
    supportsStreaming: true,
    maxTokens: 32000,
    description: 'Portkey AI Gateway with free models'
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    models: [
      'mistral-large-latest',
      'mistral-small-latest',
      'codestral-latest',
      'pixtral-large-latest',
      'ministral-3b-latest',
      'ministral-8b-latest'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Mistral AI models including Mistral Large, Small, and Codestral'
  },
  azure: {
    id: 'azure',
    name: 'Azure OpenAI',
    models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Enterprise OpenAI models on Azure'
  },
  vertex: {
    id: 'vertex',
    name: 'Google Vertex AI',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    supportsStreaming: true,
    maxTokens: 2000000,
    description: 'Enterprise Google Gemini models on Vertex AI'
  },
  github: {
    id: 'github',
    name: 'GitHub Models',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'o1-mini',
      'o3-mini',
      'gpt-4',
      'gpt-4-turbo',
      'gpt-35-turbo',
      'llama-3.3-70b-instruct',
      'llama-3.2-90b-vision-instruct',
      'llama-3.2-11b-vision-instruct',
      'llama-3.1-405b-instruct',
      'llama-3.1-70b-instruct',
      'llama-3.1-8b-instruct',
      'mistral-large-2407',
      'mistral-small-2402',
      'codellama-34b-instruct',
      'phi-3.5-mini-instruct',
      'phi-3.5-moe-instruct',
      'phi-3-mini-4k-instruct',
      'phi-3-small-4k-instruct',
      'phi-3-small-8k-instruct',
      'phi-3-medium-4k-instruct',
      'phi-3-medium-128k-instruct',
      'ai21-jamba-1.5-large',
      'ai21-jamba-1.5-mini',
      'command-r-plus',
      'command-r',
      'deepseek-v3',
      'deepseek-r1',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-2.0-flash-exp',
      'llama-3.2-1b-instruct',
      'llama-3.2-3b-instruct'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'GitHub Models - Access to GPT-4, Llama, Mistral, Phi, and more via GitHub Azure'
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    models: [
      // NVIDIA Nemotron models
      'nvidia/nemotron-4-340b-instruct',
      'nvidia/nemotron-4-340b-reward',
      'nvidia/nemotron-3-super-120b-a12b',
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'nvidia/nemotron-nano-12b-v2-vl:free',
      // DeepSeek models
      'deepseek-ai/deepseek-v3.2',
      'deepseek-ai/deepseek-v3.1',
      'deepseek-ai/deepseek-v3.1-terminus',
      'deepseek-ai/deepseek-r1-distill-llama-8b',
      'deepseek-ai/deepseek-r1-distill-qwen-7b',
      'deepseek-ai/deepseek-r1-distill-qwen-14b',
      'deepseek-ai/deepseek-r1-distill-qwen-32b',
      'deepseek-ai/deepseek-coder-6.7b-instruct',
      // Meta Llama models
      'meta/llama-4-maverick-17b-128e-instruct',
      'meta/llama-3.3-70b-instruct',
      'meta/llama2-70b',
      // Mistral models
      'mistralai/mistral-large-2-instruct',
      'mistralai/mistral-large-3-675b-instruct-2512',
      'mistralai/mistral-large',
      'mistralai/mistral-medium-3-instruct',
      'mistralai/mistral-7b-instruct-v0.3',
      'mistralai/mistral-7b-instruct-v0.2',
      'mistralai/codestral-22b-instruct-v0.1',
      'mistralai/devstral-2-123b-instruct-2512',
      'mistralai/magistral-small-2506',
      'mistralai/mamba-codestral-7b-v0.1',
      'mistralai/mathstral-7b-v0.1',
      'mistralai/ministral-14b-instruct-2512',
      // Google models
      'google/gemma-3-27b-it',
      // Baichuan models
      'baichuan-inc/baichuan2-13b-chat',
      // BigCode models
      'bigcode/starcoder2-15b',
      // Microsoft models
      'microsoft/phi-4-multimodal-instruct',
      // Qwen models
      'qwen/qwen3.5-122b-a10b',
      // TII Falcon models
      'tiiuae/falcon3-7b-instruct',
      // Writer models
      'writer/palmyra-creative-122b',
      // OpenAI models
      'openai/gpt-oss-120b',
      // Moonshot models
      'moonshotai/kimi-k2-instruct',
      'moonshotai/kimi-k2-instruct-0905',
      'moonshotai/kimi-k2-thinking',
      'moonshotai/kimi-k2.5',
      // MiniMax models
      'minimaxai/minimax-m2.5',
      // IBM models
      'ibm/granite-guardian-3.0-8b',
      // iGenius models
      'igenius/colosseum_355b_instruct_16k',
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'NVIDIA NIM - Enterprise AI models optimized for NVIDIA GPUs'
  },
  zo: {
    id: 'zo',
    name: 'ZO AI',
    models: [
      'openai:gpt-5.4-mini-2026-03-17',
      'vercel:minimax/minimax-m2.7',
      'vercel:zai/glm-5',
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'ZO AI - Multi-provider gateway with GPT-5.4 Mini, MiniMax, and GLM-5'
  },
  zen: {
    id: 'zen',
    name: 'zen API',
    models: [
      'zen',
      'zen-32k',
      'zen-128k',
      'kimi-2.5',
      'kimi-2.5-32k',
      'kimi-2.5-128k',
      'kimi-2.5-turbo'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'zen API - Access to Zen and Kimi 2.5 models with extended context windows'
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode SDK',
    models: ['opencode/local'],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Local OpenCode instance via SDK - Full agentic capabilities with tool calling'
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    models: [
      // Meta Llama models
      '@cf/meta/llama-3.2-1b-instruct',
      '@cf/meta/llama-3.2-3b-instruct',
      '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
      '@cf/meta/llama-3.2-11b-vision-instruct',
      '@cf/meta/llama-3.1-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      '@cf/meta/llama-3.1-8b-instruct-awq',
      '@cf/meta/llama-3-8b-instruct',
      '@cf/meta/llama-3-8b-instruct-awq',
      '@cf/meta/llama-2-7b-chat-fp16',
      '@cf/meta/llama-guard-3-8b',
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      // DeepSeek models
      '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
      // Mistral models
      '@cf/mistral/mistral-7b-instruct-v0.1',
      '@cf/mistralai/mistral-small-3.1-24b-instruct',
      // Google Gemma models
      '@cf/google/gemma-3-12b-it',
      // Qwen models
      '@cf/qwen/qwq-32b',
      '@cf/qwen/qwen2.5-coder-32b-instruct',
      '@cf/qwen/qwen3-30b-a3b-fp8',
      // OpenAI models (via Cloudflare)
      '@cf/openai/gpt-oss-120b',
      '@cf/openai/gpt-oss-20b',
      // Other models
      '@cf/aisingapore/gemma-sea-lion-v4-27b-it',
      '@cf/ibm-granite/granite-4.0-h-micro',
      '@cf/zai-org/glm-4.7-flash',
      '@cf/nvidia/nemotron-3-120b-a12b',
      '@cf/moonshotai/kimi-k2.5',
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Cloudflare Workers AI - Serverless AI inference at the edge with 10,000 neurons/day free tier'
  }
}