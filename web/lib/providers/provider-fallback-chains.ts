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
  cloudflare: 'CLOUDFLARE_API_KEY',
  cohere: 'COHERE_API_KEY',
  aihubmix: 'AIHUBMIX_API_KEY',
  livekit: 'LIVEKIT_API_KEY',
  pollinations: 'POLLINATIONS_API_KEY',
  chatanywhere: 'CHATANYWHERE_API_KEY',
  // 9router proxy providers
  ollama: 'QUAZ_API_KEY',
  kiro: 'QUAZ_API_KEY',
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
  openrouter: ['nvidia', 'mistral', 'google', 'github', 'groq', 'zen', 'aihubmix', 'together', 'deepinfra'],
  chutes: ['anthropic', 'google', 'mistral', 'github', 'nvidia', 'openrouter', 'aihubmix'],
  anthropic: ['nvidia', 'github', 'mistral', 'google', 'openrouter', 'aihubmix', 'groq'],
  google: ['mistral', 'openai', 'github', 'nvidia', 'groq', 'openrouter', 'aihubmix', 'together'],
  mistral: ['google', 'openai', 'github', 'nvidia', 'groq', 'openrouter', 'aihubmix', 'together'],
  github: ['nvidia', 'mistral', 'google', 'groq', 'zen', 'openrouter', 'aihubmix'],
  portkey: ['google', 'mistral', 'github', 'nvidia', 'openrouter', 'aihubmix', 'groq'],
  zen: ['mistral', 'google', 'github', 'nvidia', 'groq', 'openrouter', 'aihubmix'],
  nvidia: ['google', 'mistral', 'groq', 'together', 'deepinfra', 'fireworks', 'openrouter', 'aihubmix'],
  groq: ['nvidia', 'together', 'fireworks', 'deepinfra', 'mistral', 'openrouter', 'aihubmix'],
  together: ['nvidia', 'groq', 'fireworks', 'deepinfra', 'mistral', 'openrouter', 'aihubmix'],
  fireworks: ['nvidia', 'groq', 'together', 'deepinfra', 'mistral', 'openrouter', 'aihubmix'],
  deepinfra: ['nvidia', 'groq', 'together', 'fireworks', 'mistral', 'openrouter', 'aihubmix'],
  anyscale: ['nvidia', 'groq', 'together', 'mistral', 'google', 'openrouter', 'aihubmix'],
  lepton: ['nvidia', 'groq', 'together', 'mistral', 'google', 'openrouter', 'aihubmix'],
  openai: ['google', 'mistral', 'github', 'nvidia', 'groq', 'openrouter', 'aihubmix', 'together'],
  // Newer providers with broader fallback chains
  cloudflare: ['nvidia', 'mistral', 'google', 'openrouter', 'github', 'groq', 'aihubmix'],
  cohere: ['anthropic', 'nvidia', 'google', 'mistral', 'openrouter', 'github', 'aihubmix'],
  aihubmix: ['openai', 'google', 'mistral', 'anthropic', 'nvidia', 'openrouter', 'groq', 'together'],
  livekit: ['nvidia', 'mistral', 'google', 'openrouter', 'github', 'groq', 'aihubmix', 'together'],
  pollinations: ['nvidia', 'mistral', 'google', 'openrouter', 'github', 'groq', 'aihubmix', 'together'],
  chatanywhere: ['openai', 'google', 'mistral', 'anthropic', 'nvidia', 'openrouter', 'github'],
  // 9router proxy providers (via QUAZ_API_KEY)
  ollama: ['nvidia', 'mistral', 'google', 'openrouter', 'github', 'groq', 'aihubmix'],
  kiro: ['nvidia', 'mistral', 'google', 'openrouter', 'anthropic', 'github', 'aihubmix'],
};

/**
 * Get fallback chain for a provider (raw, unfiltered).
 * Use getConfiguredFallbackChain instead for production fallback chains.
 */
export function getFallbackChain(provider: string): string[] {
  return PROVIDER_FALLBACK_CHAINS[provider.toLowerCase()] || [];
}
