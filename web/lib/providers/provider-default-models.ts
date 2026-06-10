/**
 * Provider Default Models
 *
 * Default models for each provider when no specific model is configured.
 * Shared across all execution paths (runV1ApiWithTools, runV1ApiCompletion)
 * and the API routes.
 *
 * Extracted to a dedicated file to avoid circular dependencies between
 * lib/orchestra/unified-agent-service.ts and app/api/ routes.
 */

export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6-20250514',
  google: 'gemini-2.5-flash',
  mistral: 'mistral-large-latest',  // Large supports tools, small doesn't
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
  github: 'llama-3.3-70b-instruct',
  nvidia: 'nvidia/nemotron-4-340b-instruct',
  groq: 'llama-3.3-70b-versatile',
  together: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
  zen: 'zen',
  portkey: 'openrouter/auto',
  chutes: 'meta-llama/Llama-3.3-70B-Instruct',
  fireworks: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
  deepinfra: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
  anyscale: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
  lepton: 'llama3-70b',
};
