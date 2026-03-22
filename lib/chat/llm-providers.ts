// Note: These imports are lazy-loaded to prevent Edge Runtime bundling issues
// @opencode-ai/sdk uses node:child_process which is incompatible with Edge/client
// AWS SDK (used by Cohere) uses node:fs/promises which is incompatible with Edge
let OpenAI: any = null
let Anthropic: any = null
let GoogleGenerativeAI: any = null
let CohereClient: any = null
let Together: any = null
let Replicate: any = null
let Portkey: any = null
let Mistral: any = null

/**
 * Lazy-load OpenAI SDK
 */
async function getOpenAI() {
  if (!OpenAI) OpenAI = (await import('openai')).default
  return OpenAI
}

/**
 * Lazy-load Anthropic SDK
 */
async function getAnthropic() {
  if (!Anthropic) Anthropic = (await import('@anthropic-ai/sdk')).Anthropic
  return Anthropic
}

/**
 * Lazy-load Google Generative AI SDK
 */
async function getGoogleGenerativeAI() {
  if (!GoogleGenerativeAI) GoogleGenerativeAI = (await import('@google/generative-ai')).GoogleGenerativeAI
  return GoogleGenerativeAI
}

/**
 * Lazy-load Cohere SDK - WARNING: Uses AWS SDK which has Node.js dependencies
 * Only use this on the server side
 */
async function getCohereClient() {
  if (!CohereClient) {
    // Check if we're in a browser environment
    if (typeof window !== 'undefined' && typeof process === 'undefined') {
      throw new Error('Cohere SDK is not available in browser. Use server-side rendering.')
    }
    CohereClient = (await import('cohere-ai')).CohereClient
  }
  return CohereClient
}

/**
 * Lazy-load Together AI SDK
 */
async function getTogether() {
  if (!Together) Together = (await import('together-ai')).default
  return Together
}

/**
 * Lazy-load Replicate SDK
 */
async function getReplicate() {
  if (!Replicate) Replicate = (await import('replicate')).default
  return Replicate
}

/**
 * Lazy-load Portkey SDK
 */
async function getPortkey() {
  if (!Portkey) Portkey = (await import('portkey-ai')).Portkey
  return Portkey
}

/**
 * Lazy-load Mistral SDK
 */
async function getMistral() {
  if (!Mistral) Mistral = (await import('@mistralai/mistralai')).Mistral
  return Mistral
}

import {
  createOrchestratorError,
  createStreamError,
  createLLMError,
  ERROR_CODES,
  LLMError
} from '../../enhanced-code-system/core/error-types'

import { initializeComposioService, getComposioService, type ComposioService } from '../platforms/composio-service'
import { chatLogger } from './chat-logger'

export interface LLMProvider {
  id: string
  name: string
  models: string[]
  supportsStreaming: boolean
  maxTokens: number
  description: string
  isAvailable?: boolean
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>
}

export interface LLMRequest {
  messages: LLMMessage[]
  model: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  provider?: string
  apiKeys?: Record<string, string>
  requestId?: string
  apiKey?: string
}

export interface LLMResponse {
  content: string
  tokensUsed: number
  finishReason: string
  timestamp: Date
  provider?: string
  metadata?: Record<string, any>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface StreamingResponse {
  content: string
  isComplete: boolean
  finishReason?: string
  usage?: any
}

export interface ProviderConfig {
  openai?: {
    apiKey?: string
    baseURL?: string
  }
  anthropic?: {
    apiKey?: string
    baseURL?: string
  }
  google?: {
    apiKey?: string
  }
  cohere?: {
    apiKey?: string
  }
  together?: {
    apiKey?: string
  }
  replicate?: {
    apiKey?: string
  }
  portkey?: {
    apiKey?: string
  }
  composio?: {
    apiKey?: string
    llmProvider?: 'openrouter' | 'google' | 'openai'
    llmModel?: string
    enableAllTools?: boolean
    restrictedToolkits?: string[]
  }
  chutes?: {
    apiKey?: string
    baseURL?: string
  }
  mistral?: {
    apiKey?: string
    baseURL?: string
  }
  openrouter?: {
    apiKey?: string
    baseURL?: string
  }
  github?: {
    apiKey?: string
    baseURL?: string
  }
  zen?: {
    apiKey?: string
    baseURL?: string
  }
  opencode?: {
    hostname?: string
    port?: number
    baseUrl?: string
    model?: string
  }
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
    maxTokens: 128000, // OpenRouter models can vary, setting a common high limit
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

class LLMService {
  private openai: any = null
  private anthropic: any = null
  private google: any = null
  private cohere: any = null
  private together: any = null
  private replicate: any = null
  private portkey: any = null
  private mistral: any = null
  private zenClient: any = null
  private composioService: ComposioService | null = null
  private opencodeClient: any = null
  private config: ProviderConfig = {}

  constructor(config: ProviderConfig = {}) {
    // Store config for lazy initialization
    this.config = config

    // OpenCode SDK configuration (initialized lazily)
    if (config.opencode) {
      this.opencodeClient = { config: config.opencode, initialized: false }
    }
  }

  /**
   * Initialize all lazy-loaded providers
   * This is called once when first needed
   * CRITICAL: Re-reads process.env to ensure latest values are used
   */
  private async initializeProviders(): Promise<void> {
    // CRITICAL FIX: Re-read environment variables at initialization time
    // This ensures we get the latest values, not stale values from module load time
    const currentEnv: any = typeof process !== 'undefined' ? process.env : {};

    const config: any = {
      ...this.config,
      // Override with current environment variable values
      openai: { ...this.config.openai, apiKey: currentEnv.OPENAI_API_KEY || this.config.openai?.apiKey },
      anthropic: { ...this.config.anthropic, apiKey: currentEnv.ANTHROPIC_API_KEY || this.config.anthropic?.apiKey },
      google: { ...this.config.google, apiKey: currentEnv.GOOGLE_API_KEY || this.config.google?.apiKey },
      cohere: { ...this.config.cohere, apiKey: currentEnv.COHERE_API_KEY || this.config.cohere?.apiKey },
      together: { ...this.config.together, apiKey: currentEnv.TOGETHER_API_KEY || this.config.together?.apiKey },
      replicate: { ...this.config.replicate, apiKey: currentEnv.REPLICATE_API_TOKEN || this.config.replicate?.apiKey },
      portkey: { ...this.config.portkey, apiKey: currentEnv.PORTKEY_API_KEY || this.config.portkey?.apiKey },
      mistral: { ...this.config.mistral, apiKey: currentEnv.MISTRAL_API_KEY || this.config.mistral?.apiKey, baseURL: currentEnv.MISTRAL_BASE_URL || this.config.mistral?.baseURL },
      chutes: { ...this.config.chutes, apiKey: currentEnv.CHUTES_API_KEY || this.config.chutes?.apiKey, baseURL: currentEnv.CHUTES_BASE_URL || this.config.chutes?.baseURL },
      openrouter: { ...this.config.openrouter, apiKey: currentEnv.OPENROUTER_API_KEY || this.config.openrouter?.apiKey, baseURL: currentEnv.OPENROUTER_BASE_URL || this.config.openrouter?.baseURL },
      github: { ...this.config.github, apiKey: currentEnv.GITHUB_MODELS_API_KEY || currentEnv.AZURE_OPENAI_API_KEY || this.config.github?.apiKey },
      zen: { ...this.config.zen, apiKey: currentEnv.ZEN_API_KEY || this.config.zen?.apiKey },
    };
    
    // Initialize OpenAI
    if (config.openai?.apiKey && !this.openai) {
      const OpenAIClass = await getOpenAI()
      this.openai = new OpenAIClass({
        apiKey: config.openai.apiKey,
        baseURL: config.openai.baseURL
      })
    }

    // Initialize Anthropic
    if (config.anthropic?.apiKey && !this.anthropic) {
      const AnthropicClass = await getAnthropic()
      this.anthropic = new AnthropicClass({
        apiKey: config.anthropic.apiKey,
        baseURL: config.anthropic.baseURL
      })
    }

    // Initialize Google
    if (config.google?.apiKey && !this.google) {
      const GoogleClass = await getGoogleGenerativeAI()
      this.google = new GoogleClass(config.google.apiKey)
    }

    // Initialize Cohere (server-side only)
    if (config.cohere?.apiKey && !this.cohere) {
      const CohereClass = await getCohereClient()
      this.cohere = new CohereClass({
        token: config.cohere.apiKey
      })
    }

    // Initialize Together
    if (config.together?.apiKey && !this.together) {
      const TogetherClass = await getTogether()
      this.together = new TogetherClass({
        auth: config.together.apiKey
      })
    }

    // Initialize Replicate
    if (config.replicate?.apiKey && !this.replicate) {
      const ReplicateClass = await getReplicate()
      this.replicate = new ReplicateClass({
        auth: config.replicate.apiKey
      })
    }

    // Initialize Portkey
    if (config.portkey?.apiKey && !this.portkey) {
      const PortkeyClass = await getPortkey()
      this.portkey = new PortkeyClass({
        apiKey: config.portkey.apiKey
      })
    }

    // Initialize Mistral
    if (config.mistral?.apiKey && !this.mistral) {
      const MistralClass = await getMistral()
      this.mistral = new MistralClass({
        apiKey: config.mistral.apiKey,
        serverURL: config.mistral.baseURL
      })
    }

    // Initialize zen (uses OpenAI client)
    if (config.zen?.apiKey && !this.zenClient) {
      const OpenAIClass = await getOpenAI()
      this.zenClient = new OpenAIClass({
        apiKey: config.zen.apiKey,
        baseURL: config.zen.baseURL || 'https://api.zen.ai/v1'
      })
    }
  }

  /**
   * Initialize OpenCode SDK client lazily
   */
  private async initOpencodeClient(): Promise<void> {
    if (!this.opencodeClient) {
      throw new Error('OpenCode SDK not configured')
    }

    if (this.opencodeClient.initialized) {
      return
    }

    const { createOpenCodeSDKProvider } = await import('./opencode-sdk-provider')
    const provider = createOpenCodeSDKProvider(this.opencodeClient.config)
    await provider.initialize()
    
    this.opencodeClient = {
      provider,
      initialized: true,
    }

    chatLogger.info('OpenCode SDK client initialized')
  }

  private normalizeOpenAIToolCalls(toolCalls: any[] | undefined): Array<{ id?: string; name: string; arguments: Record<string, any> }> {
    if (!Array.isArray(toolCalls)) return []
    return toolCalls
      .map((call: any) => {
        const name = call?.function?.name || call?.name
        if (!name) return null
        let args: any = call?.function?.arguments ?? call?.arguments ?? {}
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args)
          } catch {
            args = {}
          }
        }
        if (!args || typeof args !== 'object') args = {}
        return {
          id: call?.id,
          name: String(name),
          arguments: args as Record<string, any>,
        }
      })
      .filter(Boolean) as Array<{ id?: string; name: string; arguments: Record<string, any> }>
  }

  private extractAnthropicToolCalls(contentBlocks: any[] | undefined): Array<{ id?: string; name: string; arguments: Record<string, any> }> {
    if (!Array.isArray(contentBlocks)) return []
    return contentBlocks
      .filter((block: any) => block?.type === 'tool_use' && block?.name)
      .map((block: any) => ({
        id: block.id,
        name: String(block.name),
        arguments: (block.input && typeof block.input === 'object') ? block.input : {},
      }))
  }

  private extractGoogleToolCalls(result: any): Array<{ name: string; arguments: Record<string, any> }> {
    const candidates = result?.candidates
    if (!Array.isArray(candidates)) return []
    const calls: Array<{ name: string; arguments: Record<string, any> }> = []
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts
      if (!Array.isArray(parts)) continue
      for (const part of parts) {
        const fn = part?.functionCall
        if (fn?.name) {
          calls.push({
            name: String(fn.name),
            arguments: (fn.args && typeof fn.args === 'object') ? fn.args : {},
          })
        }
      }
    }
    return calls
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    // Initialize providers lazily on first use
    await this.initializeProviders()

    const { provider = 'openai', model, messages, temperature = 0.7, maxTokens = 2000, requestId, apiKey } = request
    const requestStartTime = Date.now();

    try {
      const responseStartTime = Date.now();
      let response: LLMResponse;

      switch (provider) {
        case 'openai':
          response = await this.generateOpenAIResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'anthropic':
          response = await this.generateAnthropicResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'google':
          response = await this.generateGoogleResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'cohere':
          response = await this.generateCohereResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'together':
          response = await this.generateTogetherResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'replicate':
          response = await this.generateReplicateResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'portkey':
          response = await this.generatePortkeyResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'openrouter':
          response = await this.generateOpenRouterResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'chutes':
          response = await this.generateChutesResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'mistral':
          response = await this.generateMistralResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'github':
          response = await this.generateGitHubResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'zen':
          response = await this.generatezenResponse(model, messages, temperature, maxTokens, requestId, apiKey)
          break;
        case 'opencode':
          await this.initOpencodeClient()
          response = await this.opencodeClient.provider.generateResponse(request)
          break;
        default:
          throw createLLMError(`Unsupported provider: ${provider}`, {
            code: ERROR_CODES.LLM.UNSUPPORTED_PROVIDER,
            severity: 'high',
            recoverable: false,
            context: { provider }
          });
      }

      const responseLatency = Date.now() - responseStartTime;
      response.provider = provider;
      response.timestamp = new Date();
      
      // Set metadata with actual provider/model that generated the response
      // This is critical for fallback scenarios to log correct provider/model
      response.metadata = {
        ...response.metadata,
        actualProvider: provider,
        actualModel: model,
      };

      chatLogger.info('LLM provider response generated', { requestId, provider, model }, {
        latencyMs: responseLatency,
        tokensUsed: response.tokensUsed,
        finishReason: response.finishReason,
        contentLength: response.content.length,
      });

      return response;
    } catch (error) {
      const requestLatency = Date.now() - requestStartTime;
      chatLogger.error('LLM provider request failed', { requestId, provider, model }, {
        latencyMs: requestLatency,
        error: error instanceof Error ? error.message : String(error),
      });

      // If it's already an LLMError, re-throw it instead of wrapping it again
      if (error instanceof LLMError) {
        throw error;
      }

      throw createLLMError(`LLM request failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: ERROR_CODES.LLM.REQUEST_FAILED,
        severity: 'high',
        recoverable: true,
        context: { provider, error: error instanceof Error ? { message: error.message, name: error.name } : error }
      });
    }
  }

  async *generateStreamingResponse(request: LLMRequest): AsyncGenerator<StreamingResponse> {
    // Initialize providers lazily on first use
    await this.initializeProviders()
    
    const { provider = 'openai', model, messages, temperature = 0.7, maxTokens = 2000, requestId } = request
    const streamStartTime = Date.now();
    let chunkCount = 0;

    chatLogger.debug('LLM streaming request started', { requestId, provider, model }, {
      messageCount: messages.length,
      temperature,
      maxTokens,
    });

    try {
      switch (provider) {
        case 'openai':
          for await (const chunk of this.streamOpenAIResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'anthropic':
          for await (const chunk of this.streamAnthropicResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'google':
          for await (const chunk of this.streamGoogleResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'cohere':
          for await (const chunk of this.streamCohereResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'together':
          for await (const chunk of this.streamTogetherResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'portkey':
          for await (const chunk of this.streamPortkey(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'openrouter':
          for await (const chunk of this.streamOpenRouterResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'chutes':
          for await (const chunk of this.streamChutesResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'mistral':
          for await (const chunk of this.streamMistralResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'github':
          for await (const chunk of this.streamGitHubResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'zen':
          for await (const chunk of this.streamzenResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'opencode':
          await this.initOpencodeClient()
          for await (const chunk of this.opencodeClient.provider.generateStreamingResponse(request)) {
            chunkCount++;
            yield chunk;
          }
          break
        default:
          throw new Error(`Streaming is not supported for provider: ${provider}`);
      }

      const streamLatency = Date.now() - streamStartTime;
      chatLogger.info('LLM streaming completed', { requestId, provider, model }, {
        latencyMs: streamLatency,
        chunkCount,
      });
    } catch (error) {
      const streamLatency = Date.now() - streamStartTime;
      chatLogger.error('LLM streaming failed', { requestId, provider, model }, {
        latencyMs: streamLatency,
        chunkCount,
        error: error instanceof Error ? error.message : String(error),
      });

      throw createStreamError(`Streaming LLM request failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: ERROR_CODES.STREAMING.REQUEST_FAILED,
        severity: 'high',
        recoverable: true,
        context: { provider, error: error instanceof Error ? { message: error.message, name: error.name } : error }
      });
    }
  }

  /**
   * Get API key with fallback logic
   * Priority: 1) Override parameter, 2) process.env, 3) config
   */
  private getApiKey(provider: string, apiKeyOverride?: string): string {
    if (apiKeyOverride) {
      return apiKeyOverride;
    }

    const currentEnv: any = typeof process !== 'undefined' ? process.env : {};

    switch (provider) {
      case 'openai':
        return currentEnv.OPENAI_API_KEY || this.config.openai?.apiKey || '';
      case 'anthropic':
        return currentEnv.ANTHROPIC_API_KEY || this.config.anthropic?.apiKey || '';
      case 'google':
        return currentEnv.GOOGLE_API_KEY || this.config.google?.apiKey || '';
      case 'cohere':
        return currentEnv.COHERE_API_KEY || this.config.cohere?.apiKey || '';
      case 'together':
        return currentEnv.TOGETHER_API_KEY || this.config.together?.apiKey || '';
      case 'replicate':
        return currentEnv.REPLICATE_API_TOKEN || this.config.replicate?.apiKey || '';
      case 'portkey':
        return currentEnv.PORTKEY_API_KEY || this.config.portkey?.apiKey || '';
      case 'openrouter':
        return currentEnv.OPENROUTER_API_KEY || this.config.openrouter?.apiKey || '';
      case 'chutes':
        return currentEnv.CHUTES_API_KEY || this.config.chutes?.apiKey || '';
      case 'mistral':
        return currentEnv.MISTRAL_API_KEY || this.config.mistral?.apiKey || '';
      case 'github':
        return currentEnv.GITHUB_MODELS_API_KEY || currentEnv.AZURE_OPENAI_API_KEY || this.config.github?.apiKey || '';
      case 'zen':
        return currentEnv.zen_API_KEY || this.config.zen?.apiKey || '';
      default:
        return '';
    }
  }

  private async generateOpenAIResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKeyOverride?: string
  ): Promise<LLMResponse> {
    const apiKey = this.getApiKey('openai', apiKeyOverride);
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Please set OPENAI_API_KEY in your environment variables.');
    }

    // Create request-scoped client to avoid race conditions with concurrent requests
    // Using override key or instance client - never mutate shared singleton
    let openaiClient = this.openai;
    if (apiKeyOverride && apiKey !== this.config.openai?.apiKey) {
      const OpenAIClass = await getOpenAI();
      openaiClient = new OpenAIClass({ apiKey, baseURL: this.config.openai?.baseURL });
    } else if (!openaiClient) {
      const OpenAIClass = await getOpenAI();
      openaiClient = new OpenAIClass({ apiKey, baseURL: this.config.openai?.baseURL });
      this.openai = openaiClient; // Only cache when using default key
    }

    const response = await openaiClient.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })
    const toolCalls = this.normalizeOpenAIToolCalls(response.choices[0]?.message?.tool_calls as any[])

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: response.usage
    }
  }

  private async generateAnthropicResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKeyOverride?: string
  ): Promise<LLMResponse> {
    const apiKey = this.getApiKey('anthropic', apiKeyOverride);
    if (!apiKey) {
      throw new Error('Anthropic API key not configured. Please set ANTHROPIC_API_KEY in your environment variables.');
    }

    // Create request-scoped client to avoid race conditions with concurrent requests
    // Using override key or instance client - never mutate shared singleton
    let anthropicClient = this.anthropic;
    if (apiKeyOverride && apiKey !== this.config.anthropic?.apiKey) {
      const AnthropicClass = await getAnthropic();
      anthropicClient = new AnthropicClass({ apiKey, baseURL: this.config.anthropic?.baseURL });
    } else if (!anthropicClient) {
      const AnthropicClass = await getAnthropic();
      anthropicClient = new AnthropicClass({ apiKey, baseURL: this.config.anthropic?.baseURL });
      this.anthropic = anthropicClient; // Only cache when using default key
    }

    // Convert messages to Anthropic format
    const anthropicMessages = messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('')
      }))

    const systemMessage = messages.find(msg => msg.role === 'system')
    const system = systemMessage ? typeof systemMessage.content === 'string' ? systemMessage.content : systemMessage.content.map(c => c.text || '').join('') : undefined

    const response = await this.anthropic.messages.create({
      model,
      messages: anthropicMessages as any,
      system,
      temperature,
      max_tokens: maxTokens,
    })
    const toolCalls = this.extractAnthropicToolCalls(response.content as any[])

    return {
      content: (response.content[0] as any)?.text || '',
      tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0,
      finishReason: response.stop_reason || 'stop',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: {
        prompt_tokens: response.usage?.input_tokens || 0,
        completion_tokens: response.usage?.output_tokens || 0,
        total_tokens: response.usage?.input_tokens + response.usage?.output_tokens || 0
      }
    }
  }

  private async generateGoogleResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKey?: string
  ): Promise<LLMResponse> {
    if (!this.google) throw new Error('Google not initialized');

    const geminiModel = this.google.getGenerativeModel({ model, generationConfig: { maxOutputTokens: maxTokens, temperature } })

    // Convert messages to Google format
    const googleMessages = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('') }]
    }))

    const response = await geminiModel.generateContent({
      contents: googleMessages,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature
      }
    })

    const result = response.response
    const toolCalls = this.extractGoogleToolCalls(result)

    return {
      content: result.text() || '',
      tokensUsed: result.usageMetadata?.totalTokenCount || 0,
      finishReason: result.candidates?.[0]?.finishReason || 'STOP',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: {
        prompt_tokens: result.usageMetadata?.promptTokenCount || 0,
        completion_tokens: result.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: result.usageMetadata?.totalTokenCount || 0
      }
    }
  }

  private async generateCohereResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKey?: string
  ): Promise<LLMResponse> {
    if (!this.cohere) throw new Error('Cohere not initialized');

    // Convert messages to Cohere format
    const chatHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'USER' : 'CHATBOT',
      message: typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map(c => c.text || '').join('') : '')
    }))

    const lastMessageContent = messages[messages.length - 1].content;
    const message = typeof lastMessageContent === 'string'
      ? lastMessageContent
      : (Array.isArray(lastMessageContent) ? lastMessageContent.map(c => c.text || '').join('') : '')

    const response = await this.cohere.chat({
      model,
      message,
      chatHistory: chatHistory as any,
      temperature,
      maxTokens
    })

    return {
      content: response.text || '',
      tokensUsed: response.meta?.billedUnits?.inputTokens + response.meta?.billedUnits?.outputTokens || 0,
      finishReason: response.finishReason || 'COMPLETE',
      timestamp: new Date(),
      usage: {
        prompt_tokens: response.meta?.billedUnits?.inputTokens || 0,
        completion_tokens: response.meta?.billedUnits?.outputTokens || 0,
        total_tokens: response.meta?.billedUnits?.inputTokens + response.meta?.billedUnits?.outputTokens || 0
      }
    }
  }

  private async generateTogetherResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKey?: string
  ): Promise<LLMResponse> {
    if (!this.together) throw new Error('Together AI not initialized');

    const response = await (this.together as any).chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })
    const toolCalls = this.normalizeOpenAIToolCalls(response.choices[0]?.message?.tool_calls as any[])

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: response.usage
    }
  }

  private async generateReplicateResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKey?: string
  ): Promise<LLMResponse> {
    if (!this.replicate) throw new Error('Replicate not initialized');

    // Convert messages to Replicate format
    const prompt = messages.map(msg => 
      `${msg.role === 'user' ? 'User' : 'Assistant'}: ${typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('')}`
    ).join('\n\n')

    const output = await this.replicate.run(model as any, {
      input: { prompt, max_length: maxTokens, temperature }
    })

    return {
      content: Array.isArray(output) ? output.join('') : String(output),
      tokensUsed: Math.ceil((Array.isArray(output) ? output.join('').length : String(output).length) / 4),
      finishReason: 'stop',
      timestamp: new Date()
    }
  }

  private async generateOpenRouterResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKeyOverride?: string  // NEW: Allow API key override
  ): Promise<LLMResponse> {
    // OpenRouter is OpenAI-compatible, lazy-load OpenAI client
    const OpenAIClass = await getOpenAI()

    // CRITICAL FIX: Use API key from override if provided, otherwise fall back to env var
    const apiKey = apiKeyOverride || process.env.OPENROUTER_API_KEY || '';

    if (!apiKey) {
      throw new Error('OpenRouter API key not configured. Please set OPENROUTER_API_KEY in your environment variables.');
    }
    
    // CRITICAL: Create NEW client instance with the API key for EVERY request
    // This ensures the API key is actually used (not cached from previous initialization)
    const openrouter = new OpenAIClass({
      apiKey: apiKey,  // Explicitly pass the API key
      baseURL: 'https://openrouter.ai/api/v1',
      dangerouslyAllowBrowser: true, // Allow in browser if needed
    });

    const response = await openrouter.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })
    const toolCalls = this.normalizeOpenAIToolCalls(response.choices[0]?.message?.tool_calls as any[])

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: response.usage
    }
  }

  private async generateChutesResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKey?: string
  ): Promise<LLMResponse> {
    // Chutes is OpenAI-compatible, lazy-load OpenAI client
    const OpenAIClass = await getOpenAI()
    const chutes = new OpenAIClass({
      apiKey: process.env.CHUTES_API_KEY || '',
      baseURL: process.env.CHUTES_BASE_URL || 'https://api.chutes.ai/v1',
    });

    const response = await chutes.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })
    const toolCalls = this.normalizeOpenAIToolCalls(response.choices[0]?.message?.tool_calls as any[])

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: response.usage
    }
  }

  private async generatePortkeyResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKey?: string
  ): Promise<LLMResponse> {
    if (!this.portkey) throw new Error('Portkey not initialized');

    const response = await this.portkey.chatCompletions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })
    const toolCalls = this.normalizeOpenAIToolCalls((response.choices[0]?.message as any)?.tool_calls as any[])

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: response.usage as any
    }
  }

  private async generateMistralResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKey?: string
  ): Promise<LLMResponse> {
    if (!this.mistral) throw new Error('Mistral not initialized');

    const response = await this.mistral.chat.complete({
      model,
      messages: messages as any,
      temperature,
      maxTokens,
    })
    const message = (response as any)?.choices?.[0]?.message
    const rawToolCalls = message?.toolCalls || message?.tool_calls
    const toolCalls = this.normalizeOpenAIToolCalls(rawToolCalls as any[])

    return {
      content: typeof response.choices?.[0]?.message?.content === 'string' ? response.choices[0].message.content : '',
      tokensUsed: response.usage?.totalTokens || 0,
      finishReason: response.choices?.[0]?.finishReason || 'stop',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: response.usage ? {
        prompt_tokens: (response.usage as any).promptTokens || (response.usage as any).prompt_tokens || 0,
        completion_tokens: (response.usage as any).completionTokens || (response.usage as any).completion_tokens || 0,
        total_tokens: (response.usage as any).totalTokens || (response.usage as any).total_tokens || 0
      } : undefined
    }
  }

  private async generateGitHubResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKey?: string
  ): Promise<LLMResponse> {
    // GitHub Models is OpenAI-compatible via Azure endpoint - lazy-load
    const OpenAIClass = await getOpenAI()
    const github = new OpenAIClass({
      apiKey: process.env.GITHUB_MODELS_API_KEY || process.env.AZURE_OPENAI_API_KEY || '',
      baseURL: process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com'
    });

    const response = await github.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })
    const toolCalls = this.normalizeOpenAIToolCalls(response.choices[0]?.message?.tool_calls as any[])

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: response.usage
    }
  }

  private async generatezenResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKey?: string
  ): Promise<LLMResponse> {
    if (!this.zenClient) throw new Error('zen API not initialized');

    const response = await this.zenClient.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })
    const toolCalls = this.normalizeOpenAIToolCalls(response.choices[0]?.message?.tool_calls as any[])

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      metadata: toolCalls.length ? { toolCalls } : undefined,
      usage: response.usage
    }
  }

  private async *streamOpenRouterResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    // OpenRouter is OpenAI-compatible - lazy-load
    const OpenAIClass = await getOpenAI()
    const openrouter = new OpenAIClass({
      apiKey: process.env.OPENROUTER_API_KEY || '',
      baseURL: 'https://openrouter.ai/api/v1',
    });

    const stream = await openrouter.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        yield { content: delta, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamChutesResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    // Chutes is OpenAI-compatible - lazy-load
    const OpenAIClass = await getOpenAI()
    const chutes = new OpenAIClass({
      apiKey: process.env.CHUTES_API_KEY || '',
      baseURL: process.env.CHUTES_BASE_URL || 'https://api.chutes.ai/v1',
    });

    const stream = await chutes.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        yield { content: delta, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamMistralResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    if (!this.mistral) throw new Error('Mistral not initialized');

    const stream = await this.mistral.chat.stream({
      model,
      messages: messages as any,
      temperature,
      maxTokens,
    })

    for await (const chunk of stream) {
      const delta = (chunk as any).data?.choices?.[0]?.delta?.content || (chunk as any).choices?.[0]?.delta?.content || ''
      const content = typeof delta === 'string' ? delta : ''
      if (content) {
        yield { content, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamGitHubResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    // GitHub Models is OpenAI-compatible via Azure endpoint - lazy-load
    const OpenAIClass = await getOpenAI()
    const github = new OpenAIClass({
      apiKey: process.env.GITHUB_MODELS_API_KEY || process.env.AZURE_OPENAI_API_KEY || '',
      baseURL: process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com'
    });

    const stream = await github.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        yield { content: delta, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamzenResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    if (!this.zenClient) throw new Error('zen API not initialized');

    const stream = await this.zenClient.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        yield { content: delta, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamOpenAIResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    if (!this.openai) throw new Error('OpenAI not initialized');

    const stream = await this.openai.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        yield { content: delta, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamAnthropicResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    if (!this.anthropic) throw new Error('Anthropic not initialized');

    // Convert messages to Anthropic format
    const anthropicMessages = messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('')
      }))

    const systemMessage = messages.find(msg => msg.role === 'system')
    const system = systemMessage ? typeof systemMessage.content === 'string' ? systemMessage.content : systemMessage.content.map(c => c.text || '').join('') : undefined

    const stream = await this.anthropic.messages.stream({
      model,
      messages: anthropicMessages as any,
      system,
      temperature,
      max_tokens: maxTokens,
    })

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        yield { content: chunk.delta.text, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamGoogleResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    if (!this.google) throw new Error('Google not initialized');

    const geminiModel = this.google.getGenerativeModel({ model, generationConfig: { maxOutputTokens: maxTokens, temperature } })

    // Convert messages to Google format
    const googleMessages = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('') }]
    }))

    const result = await geminiModel.generateContentStream({
      contents: googleMessages,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature
      }
    })

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) {
        yield { content: text, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamCohereResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    if (!this.cohere) throw new Error('Cohere not initialized');

    // Convert messages to Cohere format
    const chatHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'USER' : 'CHATBOT',
      message: typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.map(c => c.text || '').join('') : '')
    }))

    const lastMessageContent = messages[messages.length - 1].content;
    const message = typeof lastMessageContent === 'string'
      ? lastMessageContent
      : (Array.isArray(lastMessageContent) ? lastMessageContent.map(c => c.text || '').join('') : '')

    const stream = await this.cohere.chatStream({
      model,
      message,
      chatHistory: chatHistory as any,
      temperature,
      maxTokens
    })

    for await (const chunk of stream) {
      if (chunk.eventType === 'text-generation') {
        yield { content: chunk.text, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamTogetherResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    if (!this.together) throw new Error('Together AI not initialized');

    const stream = await (this.together as any).chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        yield { content: delta, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  private async *streamPortkey(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    if (!this.portkey) throw new Error('Portkey not initialized');

    const stream = await this.portkey.chatCompletions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      if (delta) {
        yield { content: delta, isComplete: false }
      }
    }
    yield { content: '', isComplete: true }
  }

  // Getter methods for UI integration
  getAvailableProviders(): LLMProvider[] {
    return Object.values(PROVIDERS).filter(provider => {
      switch (provider.id) {
        case 'openai':
          return !!process.env.OPENAI_API_KEY;
        case 'anthropic':
          return !!process.env.ANTHROPIC_API_KEY;
        case 'google':
          return !!process.env.GOOGLE_API_KEY;
        case 'cohere':
          return !!process.env.COHERE_API_KEY;
        case 'together':
          return !!process.env.TOGETHER_API_KEY;
        case 'replicate':
          return !!process.env.REPLICATE_API_TOKEN;
        case 'portkey':
          return !!process.env.PORTKEY_API_KEY;
        case 'mistral':
          return !!process.env.MISTRAL_API_KEY;
        case 'zen':
          return !!process.env.zen_API_KEY;
        case 'openrouter':
          return !!process.env.OPENROUTER_API_KEY;
        case 'chutes':
          return !!process.env.CHUTES_API_KEY;
        case 'github':
          return !!process.env.GITHUB_MODELS_API_KEY || !!process.env.AZURE_OPENAI_API_KEY;
        case 'composio':
          return !!process.env.COMPOSIO_API_KEY;
        case 'opencode':
          // OpenCode SDK - check if binary is available or server is running
          return true; // Always available as it's local
        default:
          return false;
      }
    })
  }

  isProviderAvailable(providerId: string): boolean {
    return this.getAvailableProviders().some(p => p.id === providerId)
  }

  getProviderModels(providerId: string): string[] {
    const provider = PROVIDERS[providerId]
    return provider ? provider.models : []
  }
}

export const llmService = new LLMService({
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: process.env.ANTHROPIC_BASE_URL
  },
  google: {
    apiKey: process.env.GOOGLE_API_KEY
  },
  cohere: {
    apiKey: process.env.COHERE_API_KEY
  },
  together: {
    apiKey: process.env.TOGETHER_API_KEY
  },
  replicate: {
    apiKey: process.env.REPLICATE_API_TOKEN
  },
  portkey: {
    apiKey: process.env.PORTKEY_API_KEY
  },
  chutes: {
    apiKey: process.env.CHUTES_API_KEY,
    baseURL: process.env.CHUTES_BASE_URL
  },
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY,
    baseURL: process.env.MISTRAL_BASE_URL
  },
  github: {
    apiKey: process.env.GITHUB_MODELS_API_KEY || process.env.AZURE_OPENAI_API_KEY,
    baseURL: process.env.GITHUB_MODELS_BASE_URL
  },
  zen: {
    apiKey: process.env.zen_API_KEY,
    baseURL: process.env.zen_BASE_URL
  },
  opencode: {
    hostname: process.env.OPENCODE_HOSTNAME || '127.0.0.1',
    port: parseInt(process.env.OPENCODE_PORT || '4096'),
    model: process.env.OPENCODE_MODEL || 'anthropic/claude-3-5-sonnet-20241022',
  }
})

export {
  LLMService
}
