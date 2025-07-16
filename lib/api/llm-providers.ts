import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { CohereClient } from 'cohere-ai'
import Together from 'together-ai'
import Replicate from 'replicate'

export interface LLMProvider {
  id: string
  name: string
  models: string[]
  supportsStreaming: boolean
  maxTokens: number
  description: string
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LLMRequest {
  messages: LLMMessage[]
  model: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  provider: string
}

export interface LLMResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  model: string
  provider: string
}

export interface StreamingResponse {
  content: string
  isComplete: boolean
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// Available LLM Providers Configuration
export const PROVIDERS: Record<string, LLMProvider> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini'],
    supportsStreaming: true,
    maxTokens: 4096,
    description: 'Most capable and widely used AI models'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    supportsStreaming: true,
    maxTokens: 4096,
    description: 'Constitutional AI with strong reasoning capabilities'
  },
  google: {
    id: 'google',
    name: 'Google',
    models: ['gemini-pro', 'gemini-pro-vision', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    supportsStreaming: true,
    maxTokens: 2048,
    description: 'Google\'s multimodal AI models'
  },
  cohere: {
    id: 'cohere',
    name: 'Cohere',
    models: ['command-r-plus', 'command-r', 'command', 'command-nightly'],
    supportsStreaming: true,
    maxTokens: 4096,
    description: 'Enterprise-focused language models'
  },
  together: {
    id: 'together',
    name: 'Together AI',
    models: ['meta-llama/Llama-2-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO'],
    supportsStreaming: true,
    maxTokens: 4096,
    description: 'Open-source models with fast inference'
  },
  replicate: {
    id: 'replicate',
    name: 'Replicate',
    models: ['meta/llama-2-70b-chat', 'mistralai/mixtral-8x7b-instruct-v0.1'],
    supportsStreaming: false,
    maxTokens: 4096,
    description: 'Run open-source models in the cloud'
  }
}

class LLMService {
  private openai: OpenAI | null = null
  private anthropic: Anthropic | null = null
  private google: GoogleGenerativeAI | null = null
  private cohere: CohereClient | null = null
  private together: Together | null = null
  private replicate: Replicate | null = null

  constructor() {
    this.initializeProviders()
  }

  private initializeProviders() {
    // Initialize OpenAI
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        organization: process.env.OPENAI_ORG_ID,
      })
    }

    // Initialize Anthropic
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      })
    }

    // Initialize Google
    if (process.env.GOOGLE_API_KEY) {
      this.google = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)
    }

    // Initialize Cohere
    if (process.env.COHERE_API_KEY) {
      this.cohere = new CohereClient({
        token: process.env.COHERE_API_KEY,
      })
    }

    // Initialize Together AI
    if (process.env.TOGETHER_API_KEY) {
      this.together = new Together({
        apiKey: process.env.TOGETHER_API_KEY,
      })
    }

    // Initialize Replicate
    if (process.env.REPLICATE_API_TOKEN) {
      this.replicate = new Replicate({
        auth: process.env.REPLICATE_API_TOKEN,
      })
    }
  }

  getAvailableProviders(): LLMProvider[] {
    const available: LLMProvider[] = []

    if (this.openai) available.push(PROVIDERS.openai)
    if (this.anthropic) available.push(PROVIDERS.anthropic)
    if (this.google) available.push(PROVIDERS.google)
    if (this.cohere) available.push(PROVIDERS.cohere)
    if (this.together) available.push(PROVIDERS.together)
    if (this.replicate) available.push(PROVIDERS.replicate)

    return available
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const { provider, model, messages, temperature = 0.7, maxTokens = 2000 } = request

    try {
      switch (provider) {
        case 'openai':
          return await this.callOpenAI(messages, model, temperature, maxTokens)
        case 'anthropic':
          return await this.callAnthropic(messages, model, temperature, maxTokens)
        case 'google':
          return await this.callGoogle(messages, model, temperature, maxTokens)
        case 'cohere':
          return await this.callCohere(messages, model, temperature, maxTokens)
        case 'together':
          return await this.callTogether(messages, model, temperature, maxTokens)
        case 'replicate':
          return await this.callReplicate(messages, model, temperature, maxTokens)
        default:
          throw new Error(`Provider ${provider} not supported`)
      }
    } catch (error) {
      console.error(`Error calling ${provider}:`, error)
      throw new Error(`Failed to generate response from ${provider}: ${error}`)
    }
  }

  async *generateStreamingResponse(request: LLMRequest): AsyncGenerator<StreamingResponse> {
    const { provider, model, messages, temperature = 0.7, maxTokens = 2000 } = request

    try {
      switch (provider) {
        case 'openai':
          yield* this.streamOpenAI(messages, model, temperature, maxTokens)
          break
        case 'anthropic':
          yield* this.streamAnthropic(messages, model, temperature, maxTokens)
          break
        case 'google':
          yield* this.streamGoogle(messages, model, temperature, maxTokens)
          break
        case 'cohere':
          yield* this.streamCohere(messages, model, temperature, maxTokens)
          break
        case 'together':
          yield* this.streamTogether(messages, model, temperature, maxTokens)
          break
        default:
          throw new Error(`Streaming not supported for ${provider}`)
      }
    } catch (error) {
      console.error(`Error streaming from ${provider}:`, error)
      throw new Error(`Failed to stream response from ${provider}: ${error}`)
    }
  }

  private async callOpenAI(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): Promise<LLMResponse> {
    if (!this.openai) throw new Error('OpenAI not initialized')

    const response = await this.openai.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.choices[0]?.message?.content || '',
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      model,
      provider: 'openai'
    }
  }

  private async *streamOpenAI(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): AsyncGenerator<StreamingResponse> {
    if (!this.openai) throw new Error('OpenAI not initialized')

    const stream = await this.openai.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    let content = ''
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''
      content += delta

      yield {
        content: delta,
        isComplete: chunk.choices[0]?.finish_reason !== null,
        usage: chunk.usage ? {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        } : undefined,
      }
    }
  }

  private async callAnthropic(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): Promise<LLMResponse> {
    if (!this.anthropic) throw new Error('Anthropic not initialized')

    const response = await this.anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      })),
      system: messages.find(m => m.role === 'system')?.content,
    })

    return {
      content: response.content[0]?.type === 'text' ? response.content[0].text : '',
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      } : undefined,
      model,
      provider: 'anthropic'
    }
  }

  private async *streamAnthropic(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): AsyncGenerator<StreamingResponse> {
    if (!this.anthropic) throw new Error('Anthropic not initialized')

    const stream = await this.anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      })),
      system: messages.find(m => m.role === 'system')?.content,
      stream: true,
    })

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        yield {
          content: chunk.delta.text,
          isComplete: false,
        }
      } else if (chunk.type === 'message_stop') {
        yield {
          content: '',
          isComplete: true,
        }
      }
    }
  }

  private async callGoogle(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): Promise<LLMResponse> {
    if (!this.google) throw new Error('Google not initialized')

    const genModel = this.google.getGenerativeModel({ model })

    const chat = genModel.startChat({
      history: messages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    })

    const result = await chat.sendMessage(messages[messages.length - 1].content)
    const response = await result.response

    return {
      content: response.text(),
      model,
      provider: 'google'
    }
  }

  private async *streamGoogle(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): AsyncGenerator<StreamingResponse> {
    if (!this.google) throw new Error('Google not initialized')

    const genModel = this.google.getGenerativeModel({ model })

    const chat = genModel.startChat({
      history: messages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    })

    const result = await chat.sendMessageStream(messages[messages.length - 1].content)

    for await (const chunk of result.stream) {
      const chunkText = chunk.text()
      yield {
        content: chunkText,
        isComplete: false,
      }
    }

    yield {
      content: '',
      isComplete: true,
    }
  }

  private async callCohere(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): Promise<LLMResponse> {
    if (!this.cohere) throw new Error('Cohere not initialized')

    const response = await this.cohere.chatStream({
      model,
      message: messages[messages.length - 1].content,
      temperature,
      maxTokens,
      chatHistory: messages.slice(0, -1).map(m => ({
        role: m.role.toUpperCase() as 'USER' | 'CHATBOT',
        message: m.content
      })),
    })

    let content = ''
    for await (const chunk of response) {
      if (chunk.eventType === 'text-generation') {
        content += chunk.text
      }
    }

    return {
      content,
      model,
      provider: 'cohere'
    }
  }

  private async *streamCohere(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): AsyncGenerator<StreamingResponse> {
    if (!this.cohere) throw new Error('Cohere not initialized')

    const response = await this.cohere.chatStream({
      model,
      message: messages[messages.length - 1].content,
      temperature,
      maxTokens,
      chatHistory: messages.slice(0, -1).map(m => ({
        role: m.role.toUpperCase() as 'USER' | 'CHATBOT',
        message: m.content
      })),
    })

    for await (const chunk of response) {
      if (chunk.eventType === 'text-generation') {
        yield {
          content: chunk.text,
          isComplete: false,
        }
      } else if (chunk.eventType === 'stream-end') {
        yield {
          content: '',
          isComplete: true,
        }
      }
    }
  }

  private async callTogether(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): Promise<LLMResponse> {
    if (!this.together) throw new Error('Together AI not initialized')

    const response = await this.together.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    })

    return {
      content: response.choices[0]?.message?.content || '',
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      model,
      provider: 'together'
    }
  }

  private async *streamTogether(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): AsyncGenerator<StreamingResponse> {
    if (!this.together) throw new Error('Together AI not initialized')

    const stream = await this.together.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || ''

      yield {
        content: delta,
        isComplete: chunk.choices[0]?.finish_reason !== null,
        usage: chunk.usage ? {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        } : undefined,
      }
    }
  }

  private async callReplicate(messages: LLMMessage[], model: string, temperature: number, maxTokens: number): Promise<LLMResponse> {
    if (!this.replicate) throw new Error('Replicate not initialized')

    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n')

    const output = await this.replicate.run(model as `${string}/${string}`, {
      input: {
        prompt,
        temperature,
        max_tokens: maxTokens,
      },
    }) as string[]

    return {
      content: Array.isArray(output) ? output.join('') : String(output),
      model,
      provider: 'replicate'
    }
  }
}

export const llmService = new LLMService()
