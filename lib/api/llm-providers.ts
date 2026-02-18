import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { CohereClient } from 'cohere-ai'
import Together from 'together-ai'
import Replicate from 'replicate'
import { Portkey } from 'portkey-ai'
import { Mistral } from '@mistralai/mistralai'
import {
  createOrchestratorError,
  createStreamError,
  createLLMError,
  ERROR_CODES,
  LLMError
} from '../../enhanced-code-system/core/error-types'

import { initializeComposioService, getComposioService, type ComposioService } from './composio-service'

export interface LLMProvider {
  id: string
  name: string
  models: string[]
  supportsStreaming: boolean
  maxTokens: number
  description: string
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
}

export interface LLMResponse {
  content: string
  tokensUsed: number
  finishReason: string
  timestamp: Date
  provider?: string
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
  github?: {
    apiKey?: string
    baseURL?: string
  }
  opencode?: {
    apiKey?: string
    baseURL?: string
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
      'openai/gpt-oss-120b:free',
      'deepseek/deepseek-r1-0528:free',
      'qwen/qwen3-coder:free',
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
    maxTokens: 10096,
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
  composio: {
    id: 'composio',
    name: 'Composio (800+ Tools)',
    models: [
      'openai/gpt-oss-120b:free',
      'google/gemini-2.5-flash',
      'gpt-4o-mini',
      'claude-3-haiku-20240307'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Composio with 800+ toolkits and tool execution'
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    models: [
      'mistral-large-latest',
      'mistral-small-latest',
      'codestral-latest',
      'mistral-embed',
      'pixtral-large-latest',
      'ministral-3b-latest',
      'ministral-8b-latest'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Mistral AI models including Mistral Large, Small, and Codestral'
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
  opencode: {
    id: 'opencode',
    name: 'OpenCode API',
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
    description: 'OpenCode API - Access to Zen and Kimi 2.5 models with extended context windows'
  }
}

class LLMService {
  private openai: OpenAI | null = null
  private anthropic: Anthropic | null = null
  private google: GoogleGenerativeAI | null = null
  private cohere: CohereClient | null = null
  private together: Together | null = null
  private replicate: Replicate | null = null
  private portkey: Portkey | null = null
  private mistral: Mistral | null = null
  private opencodeClient: OpenAI | null = null
  private composioService: ComposioService | null = null

  constructor(config: ProviderConfig = {}) {
    // Initialize providers with API keys
    if (config.openai?.apiKey) {
      this.openai = new OpenAI({
        apiKey: config.openai.apiKey,
        baseURL: config.openai.baseURL
      })
    }

    if (config.anthropic?.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: config.anthropic.apiKey,
        baseURL: config.anthropic.baseURL
      })
    }

    if (config.google?.apiKey) {
      this.google = new GoogleGenerativeAI(config.google.apiKey)
    }

    if (config.cohere?.apiKey) {
      this.cohere = new CohereClient({
        token: config.cohere.apiKey
      })
    }

    if (config.together?.apiKey) {
      this.together = new Together({
        apiKey: config.together.apiKey
      })
    }

    if (config.replicate?.apiKey) {
      this.replicate = new Replicate({
        auth: config.replicate.apiKey
      })
    }

    if (config.portkey?.apiKey) {
      this.portkey = new Portkey({
        apiKey: config.portkey.apiKey
      })
    }

    if (config.mistral?.apiKey) {
      this.mistral = new Mistral({
        apiKey: config.mistral.apiKey,
        serverURL: config.mistral.baseURL
      })
    }

    if (config.opencode?.apiKey) {
      // OpenCode API is OpenAI-compatible
      this.opencodeClient = new OpenAI({
        apiKey: config.opencode.apiKey,
        baseURL: config.opencode.baseURL || 'https://api.opencode.ai/v1'
      })
    }
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const { provider = 'openai', model, messages, temperature = 0.7, maxTokens = 2000 } = request

    try {
      switch (provider) {
        case 'openai':
          return await this.generateOpenAIResponse(model, messages, temperature, maxTokens)
        case 'anthropic':
          return await this.generateAnthropicResponse(model, messages, temperature, maxTokens)
        case 'google':
          return await this.generateGoogleResponse(model, messages, temperature, maxTokens)
        case 'cohere':
          return await this.generateCohereResponse(model, messages, temperature, maxTokens)
        case 'together':
          return await this.generateTogetherResponse(model, messages, temperature, maxTokens)
        case 'replicate':
          return await this.generateReplicateResponse(model, messages, temperature, maxTokens)
        case 'portkey':
          return await this.generatePortkeyResponse(model, messages, temperature, maxTokens)
        case 'openrouter':
          return await this.generateOpenRouterResponse(model, messages, temperature, maxTokens)
        case 'chutes':
          return await this.generateChutesResponse(model, messages, temperature, maxTokens)
        case 'mistral':
          return await this.generateMistralResponse(model, messages, temperature, maxTokens)
        case 'github':
          return await this.generateGitHubResponse(model, messages, temperature, maxTokens)
        case 'opencode':
          return await this.generateOpenCodeResponse(model, messages, temperature, maxTokens)
        default:
          throw createLLMError(`Unsupported provider: ${provider}`, {
            code: ERROR_CODES.LLM.UNSUPPORTED_PROVIDER,
            severity: 'high',
            recoverable: false,
            context: { provider }
          });
      }
    } catch (error) {
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
    const { provider = 'openai', model, messages, temperature = 0.7, maxTokens = 2000 } = request

    try {
      switch (provider) {
        case 'openai':
          yield* this.streamOpenAIResponse(model, messages, temperature, maxTokens)
          break
        case 'anthropic':
          yield* this.streamAnthropicResponse(model, messages, temperature, maxTokens)
          break
        case 'google':
          yield* this.streamGoogleResponse(model, messages, temperature, maxTokens)
          break
        case 'cohere':
          yield* this.streamCohereResponse(model, messages, temperature, maxTokens)
          break
        case 'together':
          yield* this.streamTogetherResponse(model, messages, temperature, maxTokens)
          break
        case 'portkey':
          yield* this.streamPortkey(model, messages, temperature, maxTokens)
          break
        case 'openrouter':
          yield* this.streamOpenRouterResponse(model, messages, temperature, maxTokens)
          break
        case 'chutes':
          yield* this.streamChutesResponse(model, messages, temperature, maxTokens)
          break
        case 'mistral':
          yield* this.streamMistralResponse(model, messages, temperature, maxTokens)
          break
        case 'github':
          yield* this.streamGitHubResponse(model, messages, temperature, maxTokens)
          break
        case 'opencode':
          yield* this.streamOpenCodeResponse(model, messages, temperature, maxTokens)
          break
        default:
          throw new Error(`Streaming is not supported for provider: ${provider}`);
      }
    } catch (error) {
      throw createStreamError(`Streaming LLM request failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: ERROR_CODES.STREAMING.REQUEST_FAILED,
        severity: 'high',
        recoverable: true,
        context: { provider, error: error instanceof Error ? { message: error.message, name: error.name } : error }
      });
    }
  }

  private async generateOpenAIResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<LLMResponse> {
    if (!this.openai) throw new Error('OpenAI not initialized');

    const response = await this.openai.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      usage: response.usage
    }
  }

  private async generateAnthropicResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<LLMResponse> {
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

    const response = await this.anthropic.messages.create({
      model,
      messages: anthropicMessages,
      system,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.content[0]?.text || '',
      tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0,
      finishReason: response.stop_reason || 'stop',
      timestamp: new Date(),
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
    maxTokens: number
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

    return {
      content: result.text() || '',
      tokensUsed: result.usageMetadata?.totalTokenCount || 0,
      finishReason: result.candidates?.[0]?.finishReason || 'STOP',
      timestamp: new Date(),
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
    maxTokens: number
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
      chatHistory,
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
    maxTokens: number
  ): Promise<LLMResponse> {
    if (!this.together) throw new Error('Together AI not initialized');

    const response = await this.together.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      usage: response.usage
    }
  }

  private async generateReplicateResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<LLMResponse> {
    if (!this.replicate) throw new Error('Replicate not initialized');

    // Convert messages to Replicate format
    const prompt = messages.map(msg => 
      `${msg.role === 'user' ? 'User' : 'Assistant'}: ${typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('')}`
    ).join('\n\n')

    const output = await this.replicate.run(model, {
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
    maxTokens: number
  ): Promise<LLMResponse> {
    // OpenRouter is OpenAI-compatible, so we can use the OpenAI client with their base URL
    const openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY || '',
      baseURL: 'https://openrouter.ai/api/v1',
    });

    const response = await openrouter.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      usage: response.usage
    }
  }

  private async generateChutesResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<LLMResponse> {
    // Chutes is OpenAI-compatible, so we can use the OpenAI client with their base URL
    const chutes = new OpenAI({
      apiKey: process.env.CHUTES_API_KEY || '',
      baseURL: process.env.CHUTES_BASE_URL || 'https://api.chutes.ai/v1', // Using a hypothetical URL
    });

    const response = await chutes.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      usage: response.usage
    }
  }

  private async generatePortkeyResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<LLMResponse> {
    if (!this.portkey) throw new Error('Portkey not initialized');

    const response = await this.portkey.chatCompletions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      usage: response.usage
    }
  }

  private async generateMistralResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<LLMResponse> {
    if (!this.mistral) throw new Error('Mistral not initialized');

    const response = await this.mistral.chat.complete({
      model,
      messages: messages as any,
      temperature,
      maxTokens,
    })

    return {
      content: response.choices?.[0]?.message?.content || '',
      tokensUsed: response.usage?.totalTokens || 0,
      finishReason: response.choices?.[0]?.finishReason || 'stop',
      timestamp: new Date(),
      usage: response.usage ? {
        prompt_tokens: response.usage.promptTokens || 0,
        completion_tokens: response.usage.completionTokens || 0,
        total_tokens: response.usage.totalTokens || 0
      } : undefined
    }
  }

  private async generateGitHubResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<LLMResponse> {
    // GitHub Models is OpenAI-compatible via Azure endpoint
    const github = new OpenAI({
      apiKey: process.env.GITHUB_MODELS_API_KEY || process.env.AZURE_OPENAI_API_KEY || '',
      baseURL: process.env.GITHUB_MODELS_BASE_URL || 'https://models.inference.ai.azure.com'
    });

    const response = await github.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      usage: response.usage
    }
  }

  private async generateOpenCodeResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<LLMResponse> {
    if (!this.opencodeClient) throw new Error('OpenCode API not initialized');

    const response = await this.opencodeClient.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
      usage: response.usage
    }
  }

  private async *streamOpenRouterResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    // OpenRouter is OpenAI-compatible, so we can use the OpenAI client with their base URL
    const openrouter = new OpenAI({
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
    // Chutes is OpenAI-compatible, so we can use the OpenAI client with their base URL
    const chutes = new OpenAI({
      apiKey: process.env.CHUTES_API_KEY || '',
      baseURL: process.env.CHUTES_BASE_URL || 'https://api.chutes.ai/v1', // Using a hypothetical URL
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
      const delta = chunk.data?.choices?.[0]?.delta?.content || ''
      if (delta) {
        yield { content: delta, isComplete: false }
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
    // GitHub Models is OpenAI-compatible via Azure endpoint
    const github = new OpenAI({
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

  private async *streamOpenCodeResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    if (!this.opencodeClient) throw new Error('OpenCode API not initialized');

    const stream = await this.opencodeClient.chat.completions.create({
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
      messages: anthropicMessages,
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
      chatHistory,
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

    const stream = await this.together.chat.completions.create({
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
          return !!this.openai
        case 'anthropic':
          return !!this.anthropic
        case 'google':
          return !!this.google
        case 'cohere':
          return !!this.cohere
        case 'together':
          return !!this.together
        case 'replicate':
          return !!this.replicate
        case 'portkey':
          return !!this.portkey
        case 'mistral':
          return !!this.mistral
        case 'opencode':
          return !!this.opencodeClient
        case 'openrouter':
          return !!process.env.OPENROUTER_API_KEY
        case 'chutes':
          return !!process.env.CHUTES_API_KEY
        case 'github':
          return !!process.env.GITHUB_MODELS_API_KEY || !!process.env.AZURE_OPENAI_API_KEY
        case 'composio':
          return !!this.composioService
        default:
          return false
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
  }
})

export {
  LLMService
}
