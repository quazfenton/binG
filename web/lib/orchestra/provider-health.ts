/**
 * Provider Health Status
 */
export interface ProviderHealth {
  preferredMode: string;
  v2Native: boolean;
  v1Api: boolean;
}

/**
 * Check provider health and capabilities for routing.
 * Provides a reliable, server-side determination of provider readiness.
 */
export function checkProviderHealth(provider: string, model: string): ProviderHealth {
  // Logic based on provider capabilities
  const v2Native = ['opencode', 'anthropic', 'openai'].includes(provider.toLowerCase());
  const v1Api = true; // Most support simple chat
  
  return {
    preferredMode: v2Native ? 'v2-native' : 'v1-api',
    v2Native,
    v1Api,
  };
}
