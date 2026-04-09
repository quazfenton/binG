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

// Map each provider to its required environment variable name
const PROVIDER_API_KEY_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  chutes: 'CHUTES_API_KEY',
  github: 'GITHUB_MODELS_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  anyscale: 'ANYSCALE_API_KEY',
  lepton: 'LEPTON_API_KEY',
  zen: 'ZEN_API_KEY',
  portkey: 'PORTKEY_API_KEY',
};

/**
 * Check if a provider is configured (has its required API key set).
 */
export function isProviderConfigured(provider: string): boolean {
  const envVar = PROVIDER_API_KEY_ENV[provider.toLowerCase()];
  if (!envVar) return false;
  return !!process.env[envVar];
}

/**
 * Get fallback chain for a provider, filtered to only configured providers.
 * This prevents trying providers that don't have their API keys set.
 */
export function getConfiguredFallbackChain(provider: string): string[] {
  const chain = PROVIDER_FALLBACK_CHAINS[provider.toLowerCase()] || [];
  return chain.filter(p => isProviderConfigured(p));
}

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
 * Get fallback chain for a provider (raw, unfiltered).
 * Use getConfiguredFallbackChain instead for production fallback chains.
 */
export function getFallbackChain(provider: string): string[] {
  return PROVIDER_FALLBACK_CHAINS[provider.toLowerCase()] || [];
}
