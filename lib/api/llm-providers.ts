import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { CohereClient } from 'cohere-ai'
import Together from 'together-ai'
import Replicate from 'replicate'
import { Portkey } from 'portkey-ai'
import {
  createOrchestratorError,
  createStreamError,
  ERROR_CODES
} from '../../enhanced-code-system/core/error-types'

export interface LLMProvider {
  id: string
  name: string
  models: string[]
  supportsStreaming: boolean
  maxTokens: number
  description: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
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
        models: ['deepseek/deepseek-r1-0528:free', 'deepseek/deepseek-chat-v3-0324:free', 'meta-llama/llama-4-maverick:free', 'gemma-3-27b-it:free', 'meta-llama/llama-3.3-70b-instruct:free', 'meta-llama/llama-3.2-11b-vision-instruct:free'],
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
    models: ['gemini-2.5-flash-preview-05-20', 'gemini-pro', 'gemini-pro-vision', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-vision'],
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
    models: [
      'openrouter/auto',
      'deepseek/deepseek-r1-0528:free',
      'chutes/gemini-1.5-flash:free',
      'chutes/openrouter-auto:free',
      'chutes/grok-beta:free',
      'chutes/flux-dev:free',
      'chutes/flux-schnell:free'
    ],
    supportsStreaming: true,
    maxTokens: 32000,
    description: 'Portkey AI Gateway with free models'
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
        default:
          throw createLLMError(`Unsupported provider: ${provider}`, {
            code: ERROR_CODES.LLM.UNSUPPORTED_PROVIDER,
            severity: 'high',
            recoverable: false,
            context: { provider }
          });
      }
    } catch (error) {
      throw createLLMError(`LLM request failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: ERROR_CODES.LLM.REQUEST_FAILED,
        severity: 'high',
        recoverable: true,
        context: { provider, error }
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
        default:
          throw new Error(`Streaming is not supported for provider: ${provider}`);
      }
    } catch (error) {
      throw createStreamError(`Streaming LLM request failed: ${error instanceof Error ? error.message : String(error)}`, {
        code: ERROR_CODES.STREAMING.REQUEST_FAILED,
        severity: 'high',
        recoverable: true,
        context: { provider, error }
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
      message: typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('')
    }))

    const message = typeof messages[messages.length - 1].content === 'string' 
      ? messages[messages.length - 1].content 
      : messages[messages.length - 1].content.map(c => c.text || '').join('')

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
      message: typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join('')
    }))

    const message = typeof messages[messages.length - 1].content === 'string' 
      ? messages[messages.length - 1].content 
      : messages[messages.length - 1].content.map(c => c.text || '').join('')

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

export const llmService = new LLMService()

export {
  LLMService,
  type LLMProvider,
  type LLMMessage,
  type LLMRequest,
  type LLMResponse,
  type StreamingResponse,
  type ProviderConfig
}
