// ============================================================
// CLIENT-SAFE SECTION — No SDK imports, no Node.js dependencies
// This section is safe for webpack to bundle in client components.
// ============================================================

// Note: SDK imports below are lazy-loaded via dynamic import() to prevent
// Edge Runtime bundling issues. However, webpack still statically analyzes
// them when this file is imported from a Client Component.
//
// If you see "node:fs/promises" or "fs" errors in the browser, it means
// this file is being bundled for the client. The fix is to ensure
// Client Components only import from llm-providers-types.ts instead.

// Lazy-loaded SDK variables — only initialized on the server
let OpenAI: any = null
let Anthropic: any = null
let GoogleGenerativeAI: any = null
let CohereClient: any = null
let Together: any = null
let Replicate: any = null
let Portkey: any = null
let Mistral: any = null
let LiveKit: any = null

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
} from '../../deprecated/enhanced-code-system/core/error-types'

import { initializeComposioService, getComposioService, type ComposioService } from '../integrations/composio-service'
import { chatLogger } from './chat-logger'
import { withRetry, isRetryableError } from '../vector-memory/retry'
// Binary finders for desktop CLI agents (used to determine availability)
import { findAmpBinarySync, findCodexBinarySync, findKilocodeBinarySync, findPiBinarySync, findClaudeCodeBinarySync, findOpencodeBinarySync } from '../agent-bins'

export interface LLMProvider {
  id: string
  name: string
  models: Array<{ id: string; tags?: string[] } | string>
  supportsStreaming: boolean
  maxTokens: number
  description: string
  isAvailable?: boolean
  modelConfigs?: Array<{ id: string; tags?: string[] }>
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
  tools?: any[]
  toolChoice?: any
  toolCalls?: any[]
  toolResults?: any[]
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
  // Additional fields for enhanced responses
  reasoning?: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, any>
  }>
  toolInvocations?: Array<{
    toolCallId: string
    toolName: string
    state: 'call' | 'result'
    args: Record<string, any>
    result?: any
  }>
  files?: Array<{
    path: string
    content: string
    operation: 'create' | 'update' | 'delete'
  }>
  commands?: {
    request_files?: string[]
    write_diffs?: Array<{ path: string; diff: string }>
  }
}

export interface StreamingResponse {
  content: string
  isComplete: boolean
  finishReason?: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  // All fields from LLMResponse for parity
  tokensUsed?: number
  timestamp?: Date
  provider?: string
  metadata?: Record<string, any>
  // Enhanced streaming fields
  reasoning?: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: Record<string, any> | string
  }>
  toolInvocations?: Array<{
    toolCallId: string
    toolName: string
    state: 'call' | 'result'
    args: Record<string, any> | string
    result?: any
  }>
  files?: Array<{
    path: string
    content: string
    operation: 'create' | 'update' | 'delete'
  }>
  commands?: {
    request_files?: string[]
    write_diffs?: Array<{ path: string; diff: string }>
  }
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
  aihubmix?: {
    apiKey?: string
    baseURL?: string
  }
  pollinations?: {
    apiKey?: string
    baseURL?: string
  }
  opencode?: {
    hostname?: string
    port?: number
    baseUrl?: string
    model?: string
  }
  antigravity?: {
    enabled?: boolean
    clientId?: string
    clientSecret?: string
    masterRefreshToken?: string
    masterEmail?: string
    defaultProjectId?: string
    // Per-user accounts are loaded from DB, not config
  }
  vercel?: {
    apiKey?: string
    baseURL?: string
  }
  livekit?: {
    apiKey?: string
    baseURL?: string
  }
  ollama?: {
    apiKey?: string
    baseURL?: string
  }
  kiro?: {
    apiKey?: string
    baseURL?: string
  }
}

export const PROVIDERS: Record<string, LLMProvider> = {
  vercel: {
    id: "vercel",
    name: "Vercel",
    models: [
      "alibaba/qwen-3-14b",
      "alibaba/qwen-3-235b",
      "alibaba/qwen-3-30b",
      "alibaba/qwen-3-32b",
      "alibaba/qwen-3.6-max-preview",
      "alibaba/qwen3-235b-a22b-thinking",
      "alibaba/qwen3-coder",
      "alibaba/qwen3-coder-30b-a3b",
      "alibaba/qwen3-coder-next",
      "alibaba/qwen3-coder-plus",
      "alibaba/qwen3-max",
      "alibaba/qwen3-max-preview",
      "alibaba/qwen3-max-thinking",
      "alibaba/qwen3-next-80b-a3b-instruct",
      "alibaba/qwen3-next-80b-a3b-thinking",
      "alibaba/qwen3-vl-instruct",
      "alibaba/qwen3-vl-thinking",
      "alibaba/qwen3.5-flash",
      "alibaba/qwen3.5-plus",
      "alibaba/qwen3.6-plus",
      "amazon/nova-2-lite",
      "amazon/nova-lite",
      "amazon/nova-micro",
      "amazon/nova-pro",
      "anthropic/claude-3-haiku",
      "anthropic/claude-3.5-haiku",
      "anthropic/claude-3.7-sonnet",
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-opus-4",
      "anthropic/claude-opus-4.1",
      "anthropic/claude-opus-4.5",
      "anthropic/claude-opus-4.6",
      "anthropic/claude-opus-4.7",
      "anthropic/claude-sonnet-4",
      "anthropic/claude-sonnet-4.5",
      "anthropic/claude-sonnet-4.6",
      "arcee-ai/trinity-large-preview",
      "arcee-ai/trinity-large-thinking",
      "arcee-ai/trinity-mini",
      "bytedance/seed-1.6",
      "bytedance/seed-1.8",
      "cohere/command-a",
      "deepseek/deepseek-r1",
      "deepseek/deepseek-v3",
      "deepseek/deepseek-v3.1",
      "deepseek/deepseek-v3.1-terminus",
      "deepseek/deepseek-v3.2",
      "deepseek/deepseek-v3.2-thinking",
      "deepseek/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "google/gemini-2.0-flash",
      "google/gemini-2.0-flash-lite",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-flash-image",
      "google/gemini-2.5-flash-lite",
      "google/gemini-2.5-pro",
      "google/gemini-3-flash",
      "google/gemini-3-pro-image",
      "google/gemini-3-pro-preview",
      "google/gemini-3.1-flash-image-preview",
      "google/gemini-3.1-flash-lite-preview",
      "google/gemini-3.1-pro-preview",
      "google/gemma-4-26b-a4b-it",
      "google/gemma-4-31b-it",
      "inception/mercury-2",
      "inception/mercury-coder-small",
      "interfaze/interfaze-beta",
      "kwaipilot/kat-coder-pro-v1",
      "kwaipilot/kat-coder-pro-v2",
      "meituan/longcat-flash-chat",
      "meituan/longcat-flash-thinking-2601",
      "meta/llama-3.1-70b",
      "meta/llama-3.1-8b",
      "meta/llama-3.2-11b",
      "meta/llama-3.2-1b",
      "meta/llama-3.2-3b",
      "meta/llama-3.2-90b",
      "meta/llama-3.3-70b",
      "meta/llama-4-maverick",
      "meta/llama-4-scout",
      "minimax/minimax-m2",
      "minimax/minimax-m2.1",
      "minimax/minimax-m2.1-lightning",
      "minimax/minimax-m2.5",
      "minimax/minimax-m2.5-highspeed",
      "minimax/minimax-m2.7",
      "minimax/minimax-m2.7-highspeed",
      "mistral/codestral",
      "mistral/devstral-2",
      "mistral/devstral-small",
      "mistral/devstral-small-2",
      "mistral/magistral-medium",
      "mistral/magistral-small",
      "mistral/ministral-14b",
      "mistral/ministral-3b",
      "mistral/ministral-8b",
      "mistral/mistral-large-3",
      "mistral/mistral-medium",
      "mistral/mistral-nemo",
      "mistral/mistral-small",
      "mistral/mixtral-8x22b-instruct",
      "mistral/pixtral-12b",
      "mistral/pixtral-large",
      "moonshotai/kimi-k2",
      "moonshotai/kimi-k2-0905",
      "moonshotai/kimi-k2-thinking",
      "moonshotai/kimi-k2-thinking-turbo",
      "moonshotai/kimi-k2-turbo",
      "moonshotai/kimi-k2.5",
      "moonshotai/kimi-k2.6",
      "morph/morph-v3-fast",
      "morph/morph-v3-large",
      "nvidia/nemotron-3-nano-30b-a3b",
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-nano-12b-v2-vl",
      "nvidia/nemotron-nano-9b-v2",
      "openai/gpt-3.5-turbo",
      "openai/gpt-3.5-turbo-instruct",
      "openai/gpt-4-turbo",
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-nano",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "openai/gpt-4o-mini-search-preview",
      "openai/gpt-5",
      "openai/gpt-5-chat",
      "openai/gpt-5-codex",
      "openai/gpt-5-mini",
      "openai/gpt-5-nano",
      "openai/gpt-5-pro",
      "openai/gpt-5.1-codex",
      "openai/gpt-5.1-codex-max",
      "openai/gpt-5.1-codex-mini",
      "openai/gpt-5.1-instant",
      "openai/gpt-5.1-thinking",
      "openai/gpt-5.2",
      "openai/gpt-5.2-chat",
      "openai/gpt-5.2-codex",
      "openai/gpt-5.2-pro",
      "openai/gpt-5.3-chat",
      "openai/gpt-5.3-codex",
      "openai/gpt-5.4",
      "openai/gpt-5.4-mini",
      "openai/gpt-5.4-nano",
      "openai/gpt-5.4-pro",
      "openai/gpt-5.5",
      "openai/gpt-5.5-pro",
      "openai/gpt-image-1",
      "openai/gpt-image-1-mini",
      "openai/gpt-image-1.5",
      "openai/gpt-image-2",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "openai/gpt-oss-safeguard-20b",
      "openai/o1",
      "openai/o3",
      "openai/o3-deep-research",
      "openai/o3-mini",
      "openai/o3-pro",
      "openai/o4-mini",
      "perplexity/sonar",
      "perplexity/sonar-pro",
      "perplexity/sonar-reasoning-pro",
      "prime-intellect/intellect-3",
      "xai/grok-3",
      "xai/grok-3-fast",
      "xai/grok-3-mini",
      "xai/grok-3-mini-fast"
    ],
    modelConfigs: [
      { id: "alibaba/qwen-3-14b", tags: ["reasoning", "tool-use"] },
      { id: "alibaba/qwen-3-235b", tags: ["tool-use", "implicit-caching"] },
      { id: "alibaba/qwen-3-30b", tags: ["reasoning", "tool-use"] },
      { id: "alibaba/qwen-3-32b", tags: ["reasoning", "tool-use"] },
      { id: "alibaba/qwen-3.6-max-preview", tags: ["reasoning", "tool-use", "implicit-caching", "file-input", "vision"] },
      { id: "alibaba/qwen3-235b-a22b-thinking", tags: ["tool-use", "vision", "file-input", "reasoning"] },
      { id: "alibaba/qwen3-coder", tags: ["tool-use"] },
      { id: "alibaba/qwen3-coder-30b-a3b", tags: ["reasoning", "tool-use"] },
      { id: "alibaba/qwen3-coder-next", tags: ["tool-use"] },
      { id: "alibaba/qwen3-coder-plus", tags: ["tool-use"] },
      { id: "alibaba/qwen3-max", tags: ["tool-use", "implicit-caching"] },
      { id: "alibaba/qwen3-max-preview", tags: ["tool-use", "implicit-caching"] },
      { id: "alibaba/qwen3-max-thinking", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "alibaba/qwen3-next-80b-a3b-instruct", tags: [] },
      { id: "alibaba/qwen3-next-80b-a3b-thinking", tags: [] },
      { id: "alibaba/qwen3-vl-instruct", tags: ["vision"] },
      { id: "alibaba/qwen3-vl-thinking", tags: ["vision", "reasoning", "tool-use"] },
      { id: "alibaba/qwen3.5-flash", tags: ["vision", "explicit-caching", "file-input", "reasoning", "tool-use"] },
      { id: "alibaba/qwen3.5-plus", tags: ["vision", "explicit-caching", "file-input", "reasoning", "tool-use"] },
      { id: "alibaba/qwen3.6-plus", tags: ["reasoning", "tool-use", "implicit-caching", "vision", "file-input"] },
      { id: "amazon/nova-2-lite", tags: ["reasoning", "vision"] },
      { id: "amazon/nova-lite", tags: [] },
      { id: "amazon/nova-micro", tags: [] },
      { id: "amazon/nova-pro", tags: [] },
      { id: "anthropic/claude-3-haiku", tags: ["tool-use", "vision", "explicit-caching"] },
      { id: "anthropic/claude-3.5-haiku", tags: ["file-input", "tool-use", "vision", "explicit-caching"] },
      { id: "anthropic/claude-3.7-sonnet", tags: ["file-input", "reasoning", "tool-use", "vision", "explicit-caching"] },
      { id: "anthropic/claude-haiku-4.5", tags: ["file-input", "reasoning", "tool-use", "vision", "explicit-caching"] },
      { id: "anthropic/claude-opus-4", tags: ["file-input", "reasoning", "tool-use", "vision", "explicit-caching"] },
      { id: "anthropic/claude-opus-4.1", tags: ["file-input", "reasoning", "tool-use", "vision", "explicit-caching"] },
      { id: "anthropic/claude-opus-4.5", tags: ["tool-use", "reasoning", "vision", "file-input", "explicit-caching"] },
      { id: "anthropic/claude-opus-4.6", tags: ["tool-use", "reasoning", "vision", "file-input", "explicit-caching", "web-search"] },
      { id: "anthropic/claude-opus-4.7", tags: ["tool-use", "reasoning", "vision", "file-input", "explicit-caching", "web-search"] },
      { id: "anthropic/claude-sonnet-4", tags: ["file-input", "reasoning", "tool-use", "vision", "explicit-caching"] },
      { id: "anthropic/claude-sonnet-4.5", tags: ["file-input", "reasoning", "tool-use", "vision", "explicit-caching"] },
      { id: "anthropic/claude-sonnet-4.6", tags: ["file-input", "reasoning", "tool-use", "vision", "explicit-caching", "web-search"] },
      { id: "arcee-ai/trinity-large-preview", tags: ["tool-use"] },
      { id: "arcee-ai/trinity-large-thinking", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "arcee-ai/trinity-mini", tags: [] },
      { id: "bytedance/seed-1.6", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "bytedance/seed-1.8", tags: ["reasoning", "vision", "implicit-caching"] },
      { id: "cohere/command-a", tags: ["tool-use"] },
      { id: "deepseek/deepseek-r1", tags: ["reasoning", "tool-use"] },
      { id: "deepseek/deepseek-v3", tags: ["tool-use"] },
      { id: "deepseek/deepseek-v3.1", tags: ["reasoning", "tool-use"] },
      { id: "deepseek/deepseek-v3.1-terminus", tags: ["reasoning", "tool-use"] },
      { id: "deepseek/deepseek-v3.2", tags: ["tool-use", "implicit-caching"] },
      { id: "deepseek/deepseek-v3.2-thinking", tags: ["tool-use"] },
      { id: "deepseek/deepseek-v4-flash", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "deepseek/deepseek-v4-pro", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "google/gemini-2.0-flash", tags: ["file-input", "tool-use", "vision", "web-search"] },
      { id: "google/gemini-2.0-flash-lite", tags: ["file-input", "tool-use", "vision", "web-search"] },
      { id: "google/gemini-2.5-flash", tags: ["file-input", "reasoning", "tool-use", "vision", "web-search", "implicit-caching"] },
      { id: "google/gemini-2.5-flash-image", tags: ["image-generation", "web-search"] },
      { id: "google/gemini-2.5-flash-lite", tags: ["file-input", "reasoning", "tool-use", "vision", "web-search", "implicit-caching"] },
      { id: "google/gemini-2.5-pro", tags: ["file-input", "reasoning", "tool-use", "vision", "web-search", "implicit-caching"] },
      { id: "google/gemini-3-flash", tags: ["reasoning", "tool-use", "file-input", "vision", "web-search", "implicit-caching"] },
      { id: "google/gemini-3-pro-image", tags: ["image-generation", "web-search"] },
      { id: "google/gemini-3-pro-preview", tags: ["file-input", "tool-use", "reasoning", "vision", "web-search", "implicit-caching"] },
      { id: "google/gemini-3.1-flash-image-preview", tags: ["image-generation", "web-search", "vision", "reasoning"] },
      { id: "google/gemini-3.1-flash-lite-preview", tags: ["reasoning", "tool-use", "implicit-caching", "vision", "file-input", "web-search"] },
      { id: "google/gemini-3.1-pro-preview", tags: ["file-input", "tool-use", "reasoning", "vision", "web-search", "implicit-caching"] },
      { id: "google/gemma-4-26b-a4b-it", tags: ["vision", "tool-use", "file-input"] },
      { id: "google/gemma-4-31b-it", tags: ["tool-use", "vision", "file-input"] },
      { id: "inception/mercury-2", tags: ["tool-use", "reasoning"] },
      { id: "inception/mercury-coder-small", tags: ["tool-use"] },
      { id: "interfaze/interfaze-beta", tags: ["reasoning"] },
      { id: "kwaipilot/kat-coder-pro-v1", tags: ["reasoning"] },
      { id: "kwaipilot/kat-coder-pro-v2", tags: ["tool-use", "reasoning", "implicit-caching"] },
      { id: "meituan/longcat-flash-chat", tags: ["tool-use"] },
      { id: "meituan/longcat-flash-thinking-2601", tags: ["reasoning"] },
      { id: "meta/llama-3.1-70b", tags: ["tool-use"] },
      { id: "meta/llama-3.1-8b", tags: ["tool-use"] },
      { id: "meta/llama-3.2-11b", tags: ["tool-use", "vision"] },
      { id: "meta/llama-3.2-1b", tags: [] },
      { id: "meta/llama-3.2-3b", tags: [] },
      { id: "meta/llama-3.2-90b", tags: ["tool-use", "vision"] },
      { id: "meta/llama-3.3-70b", tags: ["tool-use"] },
      { id: "meta/llama-4-maverick", tags: ["tool-use", "vision"] },
      { id: "meta/llama-4-scout", tags: ["tool-use", "vision"] },
      { id: "minimax/minimax-m2", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "minimax/minimax-m2.1", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "minimax/minimax-m2.1-lightning", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "minimax/minimax-m2.5", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "minimax/minimax-m2.5-highspeed", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "minimax/minimax-m2.7", tags: ["reasoning", "tool-use", "implicit-caching", "file-input", "vision"] },
      { id: "minimax/minimax-m2.7-highspeed", tags: ["reasoning", "tool-use", "implicit-caching", "vision"] },
      { id: "mistral/codestral", tags: ["tool-use"] },
      { id: "mistral/devstral-2", tags: ["tool-use"] },
      { id: "mistral/devstral-small", tags: ["tool-use"] },
      { id: "mistral/devstral-small-2", tags: ["tool-use"] },
      { id: "mistral/magistral-medium", tags: ["reasoning", "vision"] },
      { id: "mistral/magistral-small", tags: ["reasoning", "vision"] },
      { id: "mistral/ministral-14b", tags: ["vision", "file-input"] },
      { id: "mistral/ministral-3b", tags: ["tool-use"] },
      { id: "mistral/ministral-8b", tags: ["tool-use"] },
      { id: "mistral/mistral-large-3", tags: ["vision"] },
      { id: "mistral/mistral-medium", tags: ["tool-use", "vision"] },
      { id: "mistral/mistral-nemo", tags: [] },
      { id: "mistral/mistral-small", tags: ["tool-use", "vision"] },
      { id: "mistral/mixtral-8x22b-instruct", tags: [] },
      { id: "mistral/pixtral-12b", tags: ["tool-use", "vision"] },
      { id: "mistral/pixtral-large", tags: ["tool-use", "vision"] },
      { id: "moonshotai/kimi-k2", tags: ["tool-use"] },
      { id: "moonshotai/kimi-k2-0905", tags: ["tool-use"] },
      { id: "moonshotai/kimi-k2-thinking", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "moonshotai/kimi-k2-thinking-turbo", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "moonshotai/kimi-k2-turbo", tags: ["tool-use"] },
      { id: "moonshotai/kimi-k2.5", tags: ["reasoning", "vision", "tool-use", "implicit-caching"] },
      { id: "moonshotai/kimi-k2.6", tags: ["reasoning", "tool-use", "vision", "file-input", "implicit-caching"] },
      { id: "morph/morph-v3-fast", tags: [] },
      { id: "morph/morph-v3-large", tags: [] },
      { id: "nvidia/nemotron-3-nano-30b-a3b", tags: ["reasoning"] },
      { id: "nvidia/nemotron-3-super-120b-a12b", tags: [] },
      { id: "nvidia/nemotron-nano-12b-v2-vl", tags: ["vision", "reasoning", "tool-use"] },
      { id: "nvidia/nemotron-nano-9b-v2", tags: ["reasoning", "tool-use"] },
      { id: "openai/gpt-3.5-turbo", tags: [] },
      { id: "openai/gpt-3.5-turbo-instruct", tags: [] },
      { id: "openai/gpt-4-turbo", tags: ["tool-use", "vision"] },
      { id: "openai/gpt-4.1", tags: ["file-input", "tool-use", "vision", "implicit-caching", "web-search"] },
      { id: "openai/gpt-4.1-mini", tags: ["file-input", "tool-use", "vision", "implicit-caching", "web-search"] },
      { id: "openai/gpt-4.1-nano", tags: ["file-input", "tool-use", "vision", "implicit-caching", "web-search"] },
      { id: "openai/gpt-4o", tags: ["file-input", "tool-use", "vision", "implicit-caching", "web-search"] },
      { id: "openai/gpt-4o-mini", tags: ["file-input", "tool-use", "vision", "implicit-caching", "web-search"] },
      { id: "openai/gpt-4o-mini-search-preview", tags: ["web-search"] },
      { id: "openai/gpt-5", tags: ["file-input", "implicit-caching", "reasoning", "tool-use", "vision", "image-generation", "web-search"] },
      { id: "openai/gpt-5-chat", tags: ["tool-use", "implicit-caching", "file-input", "image-generation", "vision", "reasoning", "web-search"] },
      { id: "openai/gpt-5-codex", tags: ["file-input", "implicit-caching", "reasoning", "tool-use", "web-search"] },
      { id: "openai/gpt-5-mini", tags: ["file-input", "implicit-caching", "reasoning", "tool-use", "vision", "web-search"] },
      { id: "openai/gpt-5-nano", tags: ["file-input", "implicit-caching", "reasoning", "tool-use", "vision", "image-generation", "web-search"] },
      { id: "openai/gpt-5-pro", tags: ["file-input", "implicit-caching", "reasoning", "tool-use", "vision", "image-generation", "web-search"] },
      { id: "openai/gpt-5.1-codex", tags: ["file-input", "tool-use", "reasoning", "vision", "web-search", "implicit-caching"] },
      { id: "openai/gpt-5.1-codex-max", tags: ["reasoning", "file-input", "tool-use", "vision", "web-search", "implicit-caching"] },
      { id: "openai/gpt-5.1-codex-mini", tags: ["reasoning", "file-input", "vision", "tool-use", "web-search", "implicit-caching"] },
      { id: "openai/gpt-5.1-instant", tags: ["tool-use", "vision", "file-input", "reasoning", "implicit-caching", "web-search"] },
      { id: "openai/gpt-5.1-thinking", tags: ["tool-use", "implicit-caching", "file-input", "reasoning", "vision", "web-search", "image-generation"] },
      { id: "openai/gpt-5.2", tags: ["tool-use", "vision", "file-input", "reasoning", "implicit-caching", "web-search"] },
      { id: "openai/gpt-5.2-chat", tags: ["vision", "file-input", "tool-use", "reasoning", "implicit-caching", "web-search"] },
      { id: "openai/gpt-5.2-codex", tags: ["file-input", "tool-use", "reasoning", "vision", "web-search", "implicit-caching"] },
      { id: "openai/gpt-5.2-pro", tags: ["tool-use", "vision", "implicit-caching", "reasoning", "file-input", "web-search"] },
      { id: "openai/gpt-5.3-chat", tags: ["vision", "file-input", "tool-use", "reasoning", "implicit-caching", "web-search"] },
      { id: "openai/gpt-5.3-codex", tags: ["reasoning", "tool-use", "file-input", "vision", "web-search", "implicit-caching"] },
      { id: "openai/gpt-5.4", tags: ["reasoning", "tool-use", "vision", "file-input", "implicit-caching", "web-search"] },
      { id: "openai/gpt-5.4-mini", tags: ["reasoning", "tool-use", "vision", "file-input", "implicit-caching", "web-search"] },
      { id: "openai/gpt-5.4-nano", tags: ["reasoning", "tool-use", "implicit-caching", "web-search", "vision", "file-input"] },
      { id: "openai/gpt-5.4-pro", tags: ["reasoning", "tool-use", "vision", "file-input", "implicit-caching", "web-search"] },
      { id: "openai/gpt-5.5", tags: ["reasoning", "tool-use", "web-search", "implicit-caching", "file-input", "vision"] },
      { id: "openai/gpt-5.5-pro", tags: ["reasoning", "tool-use", "implicit-caching", "file-input", "web-search", "vision"] },
      { id: "openai/gpt-image-1", tags: ["image-generation"] },
      { id: "openai/gpt-image-1-mini", tags: ["image-generation"] },
      { id: "openai/gpt-image-1.5", tags: ["image-generation"] },
      { id: "openai/gpt-image-2", tags: ["image-generation"] },
      { id: "openai/gpt-oss-120b", tags: ["implicit-caching"] },
      { id: "openai/gpt-oss-20b", tags: ["reasoning", "tool-use"] },
      { id: "openai/gpt-oss-safeguard-20b", tags: ["reasoning", "tool-use"] },
      { id: "openai/o1", tags: ["file-input", "reasoning", "tool-use", "vision", "implicit-caching"] },
      { id: "openai/o3", tags: ["file-input", "reasoning", "tool-use", "vision", "implicit-caching"] },
      { id: "openai/o3-deep-research", tags: ["reasoning", "file-input", "tool-use", "vision", "implicit-caching"] },
      { id: "openai/o3-mini", tags: ["reasoning", "tool-use", "implicit-caching"] },
      { id: "openai/o3-pro", tags: ["reasoning", "vision", "file-input", "tool-use", "web-search"] },
      { id: "openai/o4-mini", tags: ["file-input", "reasoning", "tool-use", "vision", "implicit-caching", "web-search"] },
      { id: "perplexity/sonar", tags: ["tool-use", "vision"] },
      { id: "perplexity/sonar-pro", tags: ["tool-use", "vision"] },
      { id: "perplexity/sonar-reasoning-pro", tags: ["reasoning"] },
      { id: "prime-intellect/intellect-3", tags: ["reasoning", "tool-use"] },
      { id: "xai/grok-3", tags: ["tool-use"] },
      { id: "xai/grok-3-fast", tags: ["tool-use"] },
      { id: "xai/grok-3-mini", tags: ["tool-use"] },
      { id: "xai/grok-3-mini-fast", tags: ["tool-use"] }
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Vercel AI models'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    models: [
      'gpt-5-mini',
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
      'openai/gpt-5.1',
      'openai/gpt-5.1-chat-latest',
      'openai/gpt-5.2',
      'openai/gpt-5.2-chat-latest',
      'openai/gpt-5.3-chat-latest',
      'openai/gpt-5.4',
      'openai/gpt-5.4-mini',
      'openai/gpt-5.4-nano',
      'openai/gpt-oss-120b',
      'xai/grok-4-1-fast-non-reasoning',
      'xai/grok-4-1-fast-reasoning',
      'xai/grok-4.20-0309-non-reasoning',
      'xai/grok-4.20-0309-reasoning',
      'xai/grok-4.20-multi-agent-0309'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'LiveKit - Conversational intelligence for voice agents with low-latency inference'
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    models: [
      'ollama/minimax-m2.5',
      'ollama/gpt-oss:120b',
      'ollama/kimi-k2.5',
      'ollama/qwen3.5'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Ollama - Local LLM inference via 9router proxy (default: localhost:20128)'
  },
  kiro: {
    id: 'kiro',
    name: 'Kiro',
    models: [
      'kr/claude-sonnet-4.5',
      'kr/claude-haiku-4.5',
      'kr/glm-5',
      'kr/deepseek-3.2',
      'kr/MiniMax-M2.5'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Kiro - AI assistant via 9router proxy (default: localhost:20128)'
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    models: [
      'minimax/minimax-m2.5:free',
      'qwen/qwen3-coder:free',
      'openai/gpt-oss-120b:free',
      'z-ai/glm-4.5-air:free',
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'nvidia/nemotron-nano-12b-v2-vl:free',
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
      'claude-4.6-sonnet',
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
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-pro',
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
      'nvidia/nemotron-3-nano-30b-a3b',
      'nvidia/nemotron-nano-12b-v2-vl',
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
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Pollinations AI Free LLM API'
  },
  aihubmix: {
    id: 'aihubmix',
    name: 'AIHubMix',
    models: [
      'coding-glm-5.1-free',
      'coding-minimax-m2.7-free',
      'coding-glm-5-free',
      'coding-glm-5-turbo-free',
      'k2.6-code-preview-free',
      'coding-minimax-m2.5-free',
      'gpt-4.1-free',
      'gemini-3-flash-preview-free',
      'gpt-4.1-mini-free',
      'gpt-4.1-nano-free',
      'gpt-4o-free',
      'coding-glm-4.7-free',
      'glm-4.7-flash-free',
      'gemini-3.1-flash-image-preview-free',
      'qwen3.6-plus-preview-free',
      'mimo-v2-flash-free',
      'kimi-for-coding-free',
      'coding-minimax-m2.1-free',
      'coding-glm-4.6-free'
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'AIHubMix - Free coding models including GLM, MiniMax, GPT, Gemini, Qwen, and more'
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode SDK',
    models: ['opencode/local'],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Local OpenCode instance via SDK - Full agentic capabilities with tool calling'
  },
  // Spawn/CLI-style local agents (desktop-first). These can also be used remotely
  // if a BASE_URL env var is configured for the remote agent host.
  'opencode-cli': {
    id: 'opencode-cli',
    name: 'OpenCode (CLI)',
    models: [
      { id: 'claude-3-5-sonnet', tags: ['fast', 'balanced'] },
      { id: 'claude-sonnet-4-5-20250929', tags: ['balanced'] },
      { id: 'claude-opus-4-5-20250929', tags: ['powerful'] },
      { id: 'gpt-4o', tags: ['fast'] },
      { id: 'gemini-2.5-flash', tags: ['fast', 'balanced'] },
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'OpenCode CLI (spawned local binary). Desktop-only unless OPENCODE_CLI_BASE_URL is set. Uses OPENCODE_API_KEY env var.'
  },
  kilocode: {
    id: 'kilocode',
    name: 'Kilocode',
    models: [
      { id: 'local', tags: ['local', 'fast'] },
      { id: 'claude-3-5-sonnet', tags: ['cloud', 'balanced'] },
      { id: 'claude-sonnet-4-5-20250929', tags: ['cloud'] },
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Kilocode local CLI or remote Kilocode service. Uses KILO_API_KEY env var.'
  },
  pi: {
    id: 'pi',
    name: 'Pi Agent',
    models: [
      { id: 'local', tags: ['local', 'fast'] },
      { id: 'claude-sonnet-4-5-20250929', tags: ['anthropic'] },
      { id: 'claude-opus-4-5-20250929', tags: ['anthropic', 'powerful'] },
      { id: 'claude-3-5-sonnet', tags: ['anthropic', 'fast'] },
      { id: 'gpt-4o', tags: ['openai'] },
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Pi CLI agent (spawn) or remote Pi service. Uses ANTHROPIC_API_KEY for LLM access.'
  },
  codex: {
    id: 'codex',
    name: 'Codex Agent',
    models: [
      { id: 'local', tags: ['local', 'fast'] },
      { id: 'gpt-4o', tags: ['openai'] },
      { id: 'gpt-4-turbo', tags: ['openai'] },
      { id: 'claude-3-5-sonnet', tags: ['anthropic'] },
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Codex agent (spawned locally). Uses OPENAI_API_KEY env var.'
  },
  amp: {
    id: 'amp',
    name: 'Amp CLI',
    models: [
      { id: 'local', tags: ['local', 'fast'] },
      { id: 'amp-coder-1', tags: ['custom'] },
      { id: 'claude-3-5-sonnet', tags: ['anthropic'] },
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Amp CLI (local binary) or remote Amp agent. Uses AMP_API_KEY env var.'
  },
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    models: [
      { id: 'claude-sonnet-4-5-20250929', tags: ['balanced'] },
      { id: 'claude-opus-4-5-20250929', tags: ['powerful'] },
      { id: 'claude-3-5-sonnet', tags: ['fast'] },
      { id: 'claude-haiku-4-5', tags: ['fast', 'lightweight'] },
    ],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Anthropic Claude Code CLI. Uses ANTHROPIC_API_KEY env var.'
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
    supportsStreaming: true,
    maxTokens: 1048576,
    description: 'Google Antigravity — Gemini 3 & Claude 4.6 via Google OAuth quota'
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
  private vercel: any = null
  private livekit: any = null
  private ollama: any = null
  private kiro: any = null
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
      vercel: { ...this.config.vercel, apiKey: currentEnv.VERCEL_API_KEY || this.config.vercel?.apiKey, baseURL: currentEnv.VERCEL_BASE_URL || this.config.vercel?.baseURL },
      livekit: { ...this.config.livekit, apiKey: currentEnv.LIVEKIT_API_KEY || this.config.livekit?.apiKey, baseURL: currentEnv.LIVEKIT_BASE_URL || this.config.livekit?.baseURL },
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

    // Initialize Vercel (uses OpenAI client)
    if (config.vercel?.apiKey && !this.vercel) {
      const OpenAIClass = await getOpenAI()
      this.vercel = new OpenAIClass({
        apiKey: config.vercel.apiKey,
        baseURL: config.vercel.baseURL || 'https://api.vercel.com/v1'
      })
    }

    // Initialize LiveKit (uses OpenAI client with LiveKit Inference API)
    if (config.livekit?.apiKey && !this.livekit) {
      const OpenAIClass = await getOpenAI()
      this.livekit = new OpenAIClass({
        apiKey: config.livekit.apiKey,
        baseURL: config.livekit.baseURL || 'https://inference.livekit.io'
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

  private normalizeOpenAIToolCalls(toolCalls: any[] | undefined): Array<{ id: string; name: string; arguments: Record<string, any> }> {
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
          id: call?.id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: String(name),
          arguments: args as Record<string, any>,
        }
      })
      .filter((c): c is { id: string; name: string; arguments: Record<string, any> } => c !== null)
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

    const { provider = 'openai', model, messages, temperature = 0.7, maxTokens = 65536, requestId, apiKey } = request

    return withRetry(
      async () => {
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
          case 'aihubmix':
            response = await this.generateAihubmixResponse(model, messages, temperature, maxTokens, requestId, apiKey)
            break;
          case 'pollinations':
            response = await this.generatePollinationsResponse(model, messages, temperature, maxTokens, requestId, apiKey)
            break;
          case 'opencode':
            await this.initOpencodeClient()
            response = await this.opencodeClient.provider.generateResponse(request)
            break;
          case 'antigravity':
            response = await this.generateAntigravityResponse(model, messages, temperature, maxTokens, requestId)
            break;
          case 'vercel':
            response = await this.generateVercelResponse(model, messages, temperature, maxTokens, requestId, apiKey)
            break;
          case 'livekit':
            response = await this.generateLivekitResponse(model, messages, temperature, maxTokens, requestId, apiKey)
            break;
          case 'ollama':
            response = await this.generateOllamaResponse(model, messages, temperature, maxTokens, requestId, apiKey)
            break;
          case 'kiro':
            response = await this.generateKiroResponse(model, messages, temperature, maxTokens, requestId, apiKey)
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
      },
      {
        maxRetries: 2,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffFactor: 2,
        jitter: true,
        context: `LLM.generateResponse(${provider}/${model})`,
        shouldRetry: (error) => isRetryableError(error),
      }
    );
  }

  async *generateStreamingResponse(request: LLMRequest): AsyncGenerator<StreamingResponse> {
    // Initialize providers lazily on first use, with retry for transient failures
    const { provider = 'openai', model, messages, temperature = 0.7, maxTokens = 65536, requestId } = request

    await withRetry(
      async () => this.initializeProviders(),
      {
        maxRetries: 2,
        baseDelay: 500,
        maxDelay: 5000,
        backoffFactor: 2,
        jitter: true,
        context: `LLM.initializeProviders(for streaming)`,
        shouldRetry: (error) => isRetryableError(error),
      }
    );

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
        case 'aihubmix':
          for await (const chunk of this.streamAihubmixResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'pollinations':
          for await (const chunk of this.streamPollinationsResponse(model, messages, temperature, maxTokens)) {
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
        case 'antigravity':
          for await (const chunk of this.streamAntigravityResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'vercel':
          for await (const chunk of this.streamVercelResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'livekit':
          for await (const chunk of this.streamLivekitResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'ollama':
          for await (const chunk of this.streamOllamaResponse(model, messages, temperature, maxTokens)) {
            chunkCount++;
            yield chunk;
          }
          break
        case 'kiro':
          for await (const chunk of this.streamKiroResponse(model, messages, temperature, maxTokens)) {
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
        return currentEnv.ZEN_API_KEY || this.config.zen?.apiKey || '';
      case 'aihubmix':
        return currentEnv.AIHUBMIX_API_KEY || this.config.aihubmix?.apiKey || '';
      case 'pollinations':
        // Pollinations text generation technically works without API keys, but we allow an optional key
        return currentEnv.POLLINATIONS_API_KEY || this.config.pollinations?.apiKey || 'optional';
      case 'vercel':
        return currentEnv.VERCEL_API_KEY || this.config.vercel?.apiKey || '';
      case 'livekit':
        return currentEnv.LIVEKIT_API_KEY || this.config.livekit?.apiKey || '';
      case 'ollama':
        return currentEnv.QUAZ_API_KEY || this.config.ollama?.apiKey || '';
      case 'kiro':
        return currentEnv.QUAZ_API_KEY || this.config.kiro?.apiKey || '';
      case 'nvidia':
        return currentEnv.NVIDIA_API_KEY || '';
      case 'groq':
        return currentEnv.GROQ_API_KEY || '';
      case 'deepinfra':
        return currentEnv.DEEPINFRA_API_KEY || '';
      case 'fireworks':
        return currentEnv.FIREWORKS_API_KEY || '';
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

  private async generatePollinationsResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKeyOverride?: string
  ): Promise<LLMResponse> {
    const apiKey = this.getApiKey('pollinations', apiKeyOverride) || 'optional';

    const OpenAIClass = await getOpenAI();
    const pollinations = new OpenAIClass({
      apiKey,
      baseURL: this.config.pollinations?.baseURL || 'https://text.pollinations.ai/openai',
    });

    const response = await pollinations.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    });
    const toolCalls = this.normalizeOpenAIToolCalls(response.choices[0]?.message?.tool_calls as any[])

    return {
      content: response.choices[0]?.message?.content || '',
      tokensUsed: response.usage?.total_tokens || 0,
      toolCalls,
      finishReason: response.choices[0]?.finish_reason || 'stop',
      timestamp: new Date(),
    }
  }

  private async generateAihubmixResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKeyOverride?: string
  ): Promise<LLMResponse> {
    const apiKey = this.getApiKey('aihubmix', apiKeyOverride);
    if (!apiKey) {
      throw new Error('AIHubMix API key not configured. Please set AIHUBMIX_API_KEY in your environment variables.');
    }

    const OpenAIClass = await getOpenAI();
    const aihubmix = new OpenAIClass({
      apiKey,
      baseURL: this.config.aihubmix?.baseURL || 'https://aihubmix.com/v1',
    });

    const response = await aihubmix.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
    });
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

  private async *streamPollinationsResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    const apiKey = this.getApiKey('pollinations') || 'optional';

    const OpenAIClass = await getOpenAI();
    const pollinations = new OpenAIClass({
      apiKey,
      baseURL: this.config.pollinations?.baseURL || 'https://text.pollinations.ai/openai',
    });

    const stream = await pollinations.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      const toolCalls = this.normalizeOpenAIToolCalls(chunk.choices[0]?.delta?.tool_calls as any[])
      
      yield {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        isComplete: false
      }
    }
  }

  private async *streamAihubmixResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    const apiKey = this.getApiKey('aihubmix');
    if (!apiKey) {
      throw new Error('AIHubMix API key not configured. Please set AIHUBMIX_API_KEY in your environment variables.');
    }

    const OpenAIClass = await getOpenAI();
    const aihubmix = new OpenAIClass({
      apiKey,
      baseURL: this.config.aihubmix?.baseURL || 'https://aihubmix.com/v1',
    });

    const stream = await aihubmix.chat.completions.create({
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

    let toolCalls: StreamingResponse['toolCalls'] = [];
    let toolInvocations: StreamingResponse['toolInvocations'] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      
      // Stream content tokens
      if (delta?.content) {
        yield { 
          content: delta.content, 
          isComplete: false,
          timestamp: new Date(),
        };
      }
      
      // Collect tool calls (streamed in parts, accumulate them)
      if (delta?.tool_calls && delta.tool_calls.length > 0) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index || toolCalls.length;
          
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCallDelta.id || `tool-${index}`,
              name: toolCallDelta.function?.name || '',
              arguments: {},
            };
          }
          
          // Accumulate function arguments (streamed in chunks)
          if (toolCallDelta.function?.arguments) {
            const existingArgs = toolCalls[index].arguments || {};
            const argsStr = typeof existingArgs === 'string' ? existingArgs : JSON.stringify(existingArgs);
            try {
              toolCalls[index].arguments = JSON.parse(argsStr + toolCallDelta.function.arguments);
            } catch {
              // Partial JSON, keep accumulating
              toolCalls[index].arguments = argsStr + toolCallDelta.function.arguments;
            }
          }
        }
        
        // Emit tool calls as they're detected
        if (toolCalls.length > 0) {
          yield {
            content: '',
            isComplete: false,
            toolCalls: [...toolCalls],
            timestamp: new Date(),
          };
        }
      }
    }
    
    // Final chunk with completion status
    yield { 
      content: '', 
      isComplete: true,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
      timestamp: new Date(),
    };
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

    let toolCalls: StreamingResponse['toolCalls'] = [];
    let toolInvocations: StreamingResponse['toolInvocations'] = [];

    for await (const chunk of stream) {
      // Handle content deltas (text streaming)
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        yield { 
          content: chunk.delta.text, 
          isComplete: false,
          timestamp: new Date(),
        };
      }
      
      // Handle tool use blocks (Anthropic calls them "tool_use" not "tool_calls")
      if (chunk.type === 'content_block_start' && chunk.content_block?.type === 'tool_use') {
        const toolBlock = chunk.content_block;
        toolCalls.push({
          id: toolBlock.id || `tool-${toolCalls.length}`,
          name: toolBlock.name || '',
          arguments: toolBlock.input || {},
        });
        
        yield {
          content: '',
          isComplete: false,
          toolCalls: [...toolCalls],
          timestamp: new Date(),
        };
      }
      
      // Handle tool input deltas (arguments streamed in chunks)
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'input_json_delta') {
        // Update last tool call with accumulated JSON
        const lastToolCall = toolCalls[toolCalls.length - 1];
        if (lastToolCall) {
          const existingArgs = typeof lastToolCall.arguments === 'string' 
            ? lastToolCall.arguments 
            : JSON.stringify(lastToolCall.arguments || {});
          try {
            lastToolCall.arguments = JSON.parse(existingArgs + (chunk.delta.partial_json || ''));
          } catch {
            // Partial JSON, keep accumulating
            lastToolCall.arguments = existingArgs + (chunk.delta.partial_json || '');
          }
        }
      }
    }
    
    yield { 
      content: '', 
      isComplete: true,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
      timestamp: new Date(),
    };
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
      const text = typeof chunk.text === 'function' ? chunk.text() : (chunk.candidates?.[0]?.content?.parts?.[0]?.text || '')
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
      try {
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
            return !!process.env.ZEN_API_KEY;
          case 'aihubmix':
            return !!process.env.AIHUBMIX_API_KEY;
          case 'pollinations':
            return true; // Pollinations API is free and doesn't explicitly strictly require a key
          case 'openrouter':
            return !!process.env.OPENROUTER_API_KEY;
          case 'chutes':
            return !!process.env.CHUTES_API_KEY;
          case 'github':
            return !!process.env.GITHUB_MODELS_API_KEY || !!process.env.AZURE_OPENAI_API_KEY;
          case 'composio':
            return !!process.env.COMPOSIO_API_KEY;
          case 'vercel':
            return !!process.env.VERCEL_API_KEY;
          case 'livekit':
            return !!process.env.LIVEKIT_API_KEY;
          case 'ollama':
            return !!process.env.QUAZ_API_KEY;
          case 'kiro':
            return !!process.env.QUAZ_API_KEY;
          case 'cloudflare':
          case 'zo':
            // Providers with env vars configured but no request/stream handlers yet
            return false;
          case 'nvidia':
            return !!process.env.NVIDIA_API_KEY;
          case 'groq':
            return !!process.env.GROQ_API_KEY;
          case 'deepinfra':
            return !!process.env.DEEPINFRA_API_KEY;
          case 'fireworks':
            return !!process.env.FIREWORKS_API_KEY;
          case 'opencode':
            // OpenCode SDK - check if binary is available or server is running
            return !!process.env.OPENCODE_HOSTNAME || !!process.env.OPENCODE_PORT || !!findOpencodeBinarySync();
          case 'opencode-cli':
            return !!process.env.OPENCODE_CLI_BASE_URL || !!findOpencodeBinarySync();
          case 'amp':
            return !!process.env.AMP_BASE_URL || !!findAmpBinarySync();
          case 'codex':
            return !!process.env.CODEX_BASE_URL || !!findCodexBinarySync();
          case 'kilocode':
            return !!process.env.KILO_BASE_URL || !!findKilocodeBinarySync();
          case 'pi':
            return !!process.env.PI_BASE_URL || !!findPiBinarySync();
          case 'claude-code':
            return !!process.env.CLAUDE_CODE_BASE_URL || !!findClaudeCodeBinarySync();
          default:
            return false;
        }
      } catch (e) {
        // Any binary detection failures should simply mark provider unavailable
        return false;
      }
    })
  }

  /**
   * Pre-warm lazy-loaded provider SDKs
   * Triggers initialization of OpenAI, Anthropic, Google, etc. clients to avoid cold starts
   */
  async warmupProviders(): Promise<void> {
    await this.initializeProviders();
  }

  isProviderAvailable(providerId: string): boolean {
    return this.getAvailableProviders().some(p => p.id === providerId)
  }

  getProviderModels(providerId: string): string[] {
    const provider = PROVIDERS[providerId]
    return provider ? provider.models.map(m => typeof m === 'string' ? m : m.id) : []
  }

  // =========================================================================
  // Antigravity Provider — Google OAuth-based access to Gemini 3 & Claude 4.6
  // =========================================================================

  private async generateAntigravityResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string
  ): Promise<LLMResponse> {
    const { sendAntigravityChat, ANTIGRAVITY_MODELS } = await import('@/lib/llm/antigravity-provider');

    // FIX: Prevent webpack/turbopack from bundling better-sqlite3 into client.
    // The import path is constructed dynamically so the bundler cannot statically
    // analyze the dependency chain (antigravity-accounts → connection → better-sqlite3).
    const dbModulePath = '@/lib' + '/database/antigravity-accounts';
    const { getAntigravityAccounts } = await import(dbModulePath);

    const modelConfig = ANTIGRAVITY_MODELS[model];
    if (!modelConfig) {
      throw new Error(`Unknown Antigravity model: ${model}`);
    }

    // Load user's Antigravity accounts from DB
    const accounts = await getAntigravityAccounts(requestId || 'default');
    if (!accounts || accounts.length === 0) {
      throw new Error('No Antigravity accounts connected. Authenticate via /api/antigravity/login');
    }

    // Try each account with rate-limit fallback
    let lastError: Error | null = null;
    for (const account of accounts) {
      try {
        const response = await sendAntigravityChat({
          model,
          messages: messages as any,
          temperature,
          maxTokens,
          stream: false,
        }, account);

        return {
          content: response.content,
          reasoning: response.thinking,
          tokensUsed: response.usage?.promptTokens + response.usage?.completionTokens || 0,
          finishReason: response.finishReason,
          timestamp: new Date(),
          metadata: { provider: 'antigravity', model, email: account.email },
          usage: response.usage ? {
            prompt_tokens: response.usage.promptTokens,
            completion_tokens: response.usage.completionTokens,
            total_tokens: response.usage.promptTokens + response.usage.completionTokens,
          } : undefined,
        };
      } catch (e: any) {
        lastError = e;
        if (e.message?.includes('Rate limited')) {
          chatLogger.warn('Antigravity account rate limited, trying next', { email: account.email });
          continue;
        }
        throw e;
      }
    }

    throw lastError || new Error('All Antigravity accounts failed');
  }

  private async *streamAntigravityResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    const { sendAntigravityChat, ANTIGRAVITY_MODELS } = await import('@/lib/llm/antigravity-provider');

    // FIX: Guard server-only import to prevent webpack from bundling
    // better-sqlite3 into client components.
    if (typeof window !== 'undefined') {
      throw new Error('Antigravity provider is server-only');
    }

    // Dynamic import with webpack ignore — prevents webpack from statically
    // analyzing the dependency chain (antigravity-accounts → connection → better-sqlite3)
     
    const { getAntigravityAccounts } = await import(
      /* webpackIgnore: true */ '@/lib/database/antigravity-accounts'
    );

    const modelConfig = ANTIGRAVITY_MODELS[model];
    if (!modelConfig) {
      throw new Error(`Unknown Antigravity model: ${model}`);
    }

    const accounts = await getAntigravityAccounts('default');
    if (!accounts || accounts.length === 0) {
      throw new Error('No Antigravity accounts connected. Authenticate via /api/antigravity/login');
    }

    let lastError: Error | null = null;
    for (const account of accounts) {
      try {
        const response = await sendAntigravityChat({
          model,
          messages: messages as any,
          temperature,
          maxTokens,
          stream: true,
        }, account);

        yield {
          content: response.content,
          reasoning: response.thinking,
          isComplete: true,
          finishReason: response.finishReason,
          provider: 'antigravity',
          metadata: { model, email: account.email },
          usage: response.usage ? {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.promptTokens + response.usage.completionTokens,
          } : undefined,
        };
        return;
      } catch (e: any) {
        lastError = e;
        if (e.message?.includes('Rate limited')) continue;
        throw e;
      }
    }

    throw lastError || new Error('All Antigravity accounts failed');
  }

  private async generateVercelResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKeyOverride?: string
  ): Promise<LLMResponse> {
    const apiKey = this.getApiKey('vercel', apiKeyOverride);
    if (!apiKey) {
      throw new Error('Vercel API key not configured. Please set VERCEL_API_KEY in your environment variables.');
    }

    // Create request-scoped client to avoid race conditions with concurrent requests
    let vercelClient = this.vercel;
    if (apiKeyOverride && apiKey !== this.config.vercel?.apiKey) {
      const OpenAIClass = await getOpenAI();
      vercelClient = new OpenAIClass({ apiKey, baseURL: this.config.vercel?.baseURL });
    } else if (!vercelClient) {
      const OpenAIClass = await getOpenAI();
      vercelClient = new OpenAIClass({ apiKey, baseURL: this.config.vercel?.baseURL });
      this.vercel = vercelClient; // Only cache when using default key
    }

    const response = await vercelClient.chat.completions.create({
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

  private async *streamVercelResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    const apiKey = this.getApiKey('vercel');
    if (!apiKey) {
      throw new Error('Vercel API key not configured. Please set VERCEL_API_KEY in your environment variables.');
    }

    // Create request-scoped client to avoid race conditions with concurrent requests
    let vercelClient = this.vercel;
    if (!vercelClient) {
      const OpenAIClass = await getOpenAI();
      vercelClient = new OpenAIClass({ apiKey, baseURL: this.config.vercel?.baseURL });
      this.vercel = vercelClient;
    }

    const response = await vercelClient.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content || '';
      const toolCalls = this.normalizeOpenAIToolCalls(chunk.choices[0]?.delta?.tool_calls as any[])

      yield {
        content,
        isComplete: false,
        tokensUsed: chunk.usage?.total_tokens || 0,
        finishReason: chunk.choices[0]?.finish_reason || undefined,
        metadata: toolCalls.length ? { toolCalls } : undefined,
        usage: chunk.usage
      };
    }

    yield {
      content: '',
      isComplete: true,
      finishReason: 'stop',
    };
  }

  private async generateLivekitResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKeyOverride?: string
  ): Promise<LLMResponse> {
    const apiKey = this.getApiKey('livekit', apiKeyOverride);
    if (!apiKey) {
      throw new Error('LiveKit API key not configured. Please set LIVEKIT_API_KEY in your environment variables.');
    }

    const livekitBaseURL =
      this.config.livekit?.baseURL ||
      (typeof process !== 'undefined' ? process.env.LIVEKIT_BASE_URL : undefined) ||
      'https://inference.livekit.io';

    // Create request-scoped client to avoid race conditions with concurrent requests
    let livekitClient = this.livekit;
    if (apiKeyOverride && apiKey !== this.config.livekit?.apiKey) {
      const OpenAIClass = await getOpenAI();
      livekitClient = new OpenAIClass({ apiKey, baseURL: livekitBaseURL });
    } else if (!livekitClient) {
      const OpenAIClass = await getOpenAI();
      livekitClient = new OpenAIClass({ apiKey, baseURL: livekitBaseURL });
      this.livekit = livekitClient; // Only cache when using default key
    }

    const response = await livekitClient.chat.completions.create({
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

  private async *streamLivekitResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    const apiKey = this.getApiKey('livekit');
    if (!apiKey) {
      throw new Error('LiveKit API key not configured. Please set LIVEKIT_API_KEY in your environment variables.');
    }

    const livekitBaseURL =
      this.config.livekit?.baseURL ||
      (typeof process !== 'undefined' ? process.env.LIVEKIT_BASE_URL : undefined) ||
      'https://inference.livekit.io';

    let livekitClient = this.livekit;
    if (!livekitClient) {
      const OpenAIClass = await getOpenAI();
      livekitClient = new OpenAIClass({ apiKey, baseURL: livekitBaseURL });
      this.livekit = livekitClient;
    }

    const response = await livekitClient.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content || '';
      const toolCalls = this.normalizeOpenAIToolCalls(chunk.choices[0]?.delta?.tool_calls as any[])

      yield {
        content,
        isComplete: false,
        tokensUsed: chunk.usage?.total_tokens || 0,
        finishReason: chunk.choices[0]?.finish_reason || undefined,
        metadata: toolCalls.length ? { toolCalls } : undefined,
        usage: chunk.usage
      };
    }

    yield {
      content: '',
      isComplete: true,
      finishReason: 'stop',
    };
  }

  private async generateOllamaResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKeyOverride?: string
  ): Promise<LLMResponse> {
    const apiKey = this.getApiKey('ollama', apiKeyOverride);
    if (!apiKey) {
      throw new Error('Ollama API key not configured. Please set QUAZ_API_KEY in your environment variables.');
    }

    // Use custom base URL if provided (BYOK), otherwise default to local 9router proxy
    const ollamaBaseURL =
      this.config.ollama?.baseURL ||
      (typeof process !== 'undefined' ? process.env.OLLAMA_BASE_URL : undefined) ||
      'http://localhost:20128/v1';

    let ollamaClient = this.ollama;
    if (apiKeyOverride && apiKey !== this.config.ollama?.apiKey) {
      const OpenAIClass = await getOpenAI();
      ollamaClient = new OpenAIClass({ apiKey, baseURL: ollamaBaseURL });
    } else if (!ollamaClient) {
      const OpenAIClass = await getOpenAI();
      ollamaClient = new OpenAIClass({ apiKey, baseURL: ollamaBaseURL });
      this.ollama = ollamaClient;
    }

    const response = await ollamaClient.chat.completions.create({
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

  private async *streamOllamaResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    const apiKey = this.getApiKey('ollama');
    if (!apiKey) {
      throw new Error('Ollama API key not configured. Please set QUAZ_API_KEY in your environment variables.');
    }

    const ollamaBaseURL =
      this.config.ollama?.baseURL ||
      (typeof process !== 'undefined' ? process.env.OLLAMA_BASE_URL : undefined) ||
      'http://localhost:20128/v1';

    let ollamaClient = this.ollama;
    if (!ollamaClient) {
      const OpenAIClass = await getOpenAI();
      ollamaClient = new OpenAIClass({ apiKey, baseURL: ollamaBaseURL });
      this.ollama = ollamaClient;
    }

    const response = await ollamaClient.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content || '';
      const toolCalls = this.normalizeOpenAIToolCalls(chunk.choices[0]?.delta?.tool_calls as any[])

      yield {
        content,
        isComplete: false,
        tokensUsed: chunk.usage?.total_tokens || 0,
        finishReason: chunk.choices[0]?.finish_reason || undefined,
        metadata: toolCalls.length ? { toolCalls } : undefined,
        usage: chunk.usage
      };
    }

    yield {
      content: '',
      isComplete: true,
      finishReason: 'stop',
    };
  }

  private async generateKiroResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number,
    requestId?: string,
    apiKeyOverride?: string
  ): Promise<LLMResponse> {
    const apiKey = this.getApiKey('kiro', apiKeyOverride);
    if (!apiKey) {
      throw new Error('Kiro API key not configured. Please set QUAZ_API_KEY in your environment variables.');
    }

    // Use custom base URL if provided (BYOK), otherwise default to local 9router proxy
    const kiroBaseURL =
      this.config.kiro?.baseURL ||
      (typeof process !== 'undefined' ? process.env.KIRO_BASE_URL : undefined) ||
      'http://localhost:20128/v1';

    let kiroClient = this.kiro;
    if (apiKeyOverride && apiKey !== this.config.kiro?.apiKey) {
      const OpenAIClass = await getOpenAI();
      kiroClient = new OpenAIClass({ apiKey, baseURL: kiroBaseURL });
    } else if (!kiroClient) {
      const OpenAIClass = await getOpenAI();
      kiroClient = new OpenAIClass({ apiKey, baseURL: kiroBaseURL });
      this.kiro = kiroClient;
    }

    const response = await kiroClient.chat.completions.create({
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

  private async *streamKiroResponse(
    model: string,
    messages: LLMMessage[],
    temperature: number,
    maxTokens: number
  ): AsyncGenerator<StreamingResponse> {
    const apiKey = this.getApiKey('kiro');
    if (!apiKey) {
      throw new Error('Kiro API key not configured. Please set QUAZ_API_KEY in your environment variables.');
    }

    const kiroBaseURL =
      this.config.kiro?.baseURL ||
      (typeof process !== 'undefined' ? process.env.KIRO_BASE_URL : undefined) ||
      'http://localhost:20128/v1';

    let kiroClient = this.kiro;
    if (!kiroClient) {
      const OpenAIClass = await getOpenAI();
      kiroClient = new OpenAIClass({ apiKey, baseURL: kiroBaseURL });
      this.kiro = kiroClient;
    }

    const response = await kiroClient.chat.completions.create({
      model,
      messages: messages as any,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    })

    for await (const chunk of response) {
      const content = chunk.choices[0]?.delta?.content || '';
      const toolCalls = this.normalizeOpenAIToolCalls(chunk.choices[0]?.delta?.tool_calls as any[])

      yield {
        content,
        isComplete: false,
        tokensUsed: chunk.usage?.total_tokens || 0,
        finishReason: chunk.choices[0]?.finish_reason || undefined,
        metadata: toolCalls.length ? { toolCalls } : undefined,
        usage: chunk.usage
      };
    }

    yield {
      content: '',
      isComplete: true,
      finishReason: 'stop',
    };
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
    apiKey: process.env.ZEN_API_KEY,
    baseURL: process.env.ZEN_BASE_URL
  },
  pollinations: {
    apiKey: process.env.POLLINATIONS_API_KEY,
    baseURL: process.env.POLLINATIONS_BASE_URL || 'https://text.pollinations.ai/openai'
  },
  aihubmix: {
    apiKey: process.env.AIHUBMIX_API_KEY,
    baseURL: process.env.AIHUBMIX_BASE_URL
  },
  vercel: {
    apiKey: process.env.VERCEL_API_KEY,
    baseURL: process.env.VERCEL_BASE_URL
  },
  opencode: {
    hostname: process.env.OPENCODE_HOSTNAME || '127.0.0.1',
    port: parseInt(process.env.OPENCODE_PORT || '4096'),
    model: process.env.OPENCODE_MODEL || 'anthropic/claude-3-5-sonnet-20241022',
  },
  ollama: {
    apiKey: process.env.QUAZ_API_KEY,
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:20128/v1'
  },
  kiro: {
    apiKey: process.env.QUAZ_API_KEY,
    baseURL: process.env.KIRO_BASE_URL || 'http://localhost:20128/v1'
  },
  antigravity: {
    enabled: process.env.ANTIGRAVITY_ENABLED !== 'false',
    clientId: process.env.ANTIGRAVITY_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    masterRefreshToken: process.env.ANTIGRAVITY_REFRESH_TOKEN,
    masterEmail: process.env.ANTIGRAVITY_MASTER_EMAIL || 'master@antigravity.local',
    defaultProjectId: process.env.ANTIGRAVITY_DEFAULT_PROJECT_ID || 'rising-fact-p41fc',
  }
})

export {
  LLMService
}
