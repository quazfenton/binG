/**
 * Provider Fallback Chains
 *
 * Centralized fallback chain configuration for all LLM paths.
 * Each primary provider has an ordered list of fallback providers to try
 * when the primary fails.
 *
 * This module has NO imports from vercel-ai-streaming or llm-providers,
 * avoiding any circular dependency risk.
 */

export const PROVIDER_FALLBACK_CHAINS: Record<string, string[]> = {
  openrouter: ['nvidia', 'mistral', 'google', 'github', 'groq', 'zen'],
  chutes: ['anthropic', 'google', 'mistral', 'github', 'nvidia', 'openrouter'],
  anthropic: ['nvidia', 'github', 'mistral', 'google', 'openrouter'],
  google: ['mistral', 'openai', 'github', 'nvidia', 'groq', 'openrouter'],
  mistral: ['google', 'openai', 'github', 'nvidia', 'groq', 'openrouter'],
  github: ['nvidia', 'mistral', 'google', 'groq', 'zen', 'openrouter'],
  portkey: ['google', 'mistral', 'github', 'nvidia', 'openrouter'],
  zen: ['mistral', 'google', 'github', 'nvidia', 'groq', 'openrouter'],
  nvidia: ['google', 'mistral', 'groq', 'together', 'deepinfra', 'fireworks', 'openrouter'],
  groq: ['nvidia', 'together', 'fireworks', 'deepinfra', 'mistral', 'openrouter'],
  together: ['nvidia', 'groq', 'fireworks', 'deepinfra', 'mistral', 'openrouter'],
  fireworks: ['nvidia', 'groq', 'together', 'deepinfra', 'mistral', 'openrouter'],
  deepinfra: ['nvidia', 'groq', 'together', 'fireworks', 'mistral', 'openrouter'],
  anyscale: ['nvidia', 'groq', 'together', 'mistral', 'google', 'openrouter'],
  lepton: ['nvidia', 'groq', 'together', 'mistral', 'google', 'openrouter'],
  openai: ['google', 'mistral', 'github', 'nvidia', 'groq', 'openrouter'],
};

/**
 * Get fallback chain for a provider.
 * Returns the chain or empty array if provider not recognized.
 */
export function getFallbackChain(provider: string): string[] {
  return PROVIDER_FALLBACK_CHAINS[provider.toLowerCase()] || [];
}
