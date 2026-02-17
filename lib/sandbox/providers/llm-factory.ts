import type { LLMProvider } from './llm-provider'
import { GeminiProvider } from './gemini-provider'

export type LLMProviderType = 'gemini' | 'opencode'

let cachedLLMProvider: LLMProvider | null = null

export function getLLMProvider(type?: LLMProviderType): LLMProvider {
  const providerType = type ?? (process.env.LLM_PROVIDER as LLMProviderType) ?? 'gemini'

  if (cachedLLMProvider && cachedLLMProvider.name === providerType) {
    return cachedLLMProvider
  }

  switch (providerType) {
    case 'gemini':
      cachedLLMProvider = new GeminiProvider()
      break
    case 'opencode': {
      const { OpencodeProvider } = require('./opencode-provider')
      cachedLLMProvider = new OpencodeProvider()
      break
    }
    default:
      throw new Error(`Unknown LLM provider: ${providerType}`)
  }

  return cachedLLMProvider
}

export type { LLMProvider, LLMAgentOptions, LLMAgentResult } from './llm-provider'
