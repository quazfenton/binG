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
      'deepseek/deepseek-r1-0528:free',
      'qwen/qwen3-coder:free',
      'openai/gpt-oss-120b:free',
      'z-ai/glm-4.5-air:free',
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'nvidia/nemotron-nano-12b-v2-vl:free',
      'mistralai/mistral-small-3.1-24b-instruct:free',
      'liquid/lfm-2.5-1.2b-instruct:free',
      'arcee-ai/trinity-large-preview:free',
      'meta-llama/llama-3.3-70b-instruct:free'
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
      'deepseek/deepseek-r1-0528:free',
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
  }
}