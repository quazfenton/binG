/**
 * Provider Configuration — Client-Safe
 * 
 * Contains only the static PROVIDERS constant and type definitions.
 * NO SDK imports — safe for client components.
 * 
 * The actual LLM service with SDK imports lives in llm-providers.ts (server-only).
 */

export interface LLMProvider {
  id: string;
  name: string;
  models: string[];
  supportsStreaming: boolean;
  maxTokens: number;
  description: string;
  baseURL?: string;
}

/**
 * Static provider definitions — no SDK imports.
 * These are pure configuration objects.
 */
export const PROVIDERS: Record<string, LLMProvider> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'OpenAI GPT models',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    models: ['claude-sonnet-4-5', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-sonnet-latest'],
    supportsStreaming: true,
    maxTokens: 200000,
    description: 'Anthropic Claude models',
  },
  google: {
    id: 'google',
    name: 'Google',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'],
    supportsStreaming: true,
    maxTokens: 1000000,
    description: 'Google Gemini models',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    models: ['mistral-large-latest', 'mistral-small-latest', 'mistral-medium-latest', 'codestral-latest'],
    supportsStreaming: true,
    maxTokens: 128000,
    description: 'Mistral AI models',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    models: ['google/gemini-2.5-flash', 'mistralai/mistral-large', 'anthropic/claude-sonnet-4', 'openai/gpt-4o'],
    supportsStreaming: true,
    maxTokens: 200000,
    description: 'Multi-provider gateway via OpenRouter',
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA',
    models: ['meta/llama-3.1-405b-instruct', 'meta/llama-3.3-70b-instruct', 'mistralai/mistral-large-2-instruct'],
    supportsStreaming: true,
    maxTokens: 32000,
    description: 'NVIDIA NIM models',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    supportsStreaming: true,
    maxTokens: 32000,
    description: 'Groq ultra-fast inference',
  },
  together: {
    id: 'together',
    name: 'Together AI',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
    supportsStreaming: true,
    maxTokens: 32000,
    description: 'Together AI hosted models',
  },
};

/**
 * Get list of available provider IDs from env var availability.
 * This is a CLIENT-SAFE function — it checks env vars that are exposed
 * via NEXT_PUBLIC_ prefix.
 */
export function getClientAvailableProviders(): string[] {
  // In the browser, we can't check server-side env vars directly.
  // Return all defined providers — the server will validate availability.
  return Object.keys(PROVIDERS);
}
