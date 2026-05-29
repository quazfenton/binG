/**
 * Sub-provider prefix → human-readable label for grouping ninerouter models in the UI.
 *
 * Used by both llm-selector.tsx and interaction-panel.tsx to provide
 * consistent visual grouping of the 130+ ninerouter models by internal provider.
 */
export const SUBPROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini API',
  ag: 'Antigravity OAuth',
  gc: 'Gemini CLI',
  gh: 'GitHub Copilot',
  kc: 'Kilo Code',
  kr: 'Kiro (Amazon)',
  oc: 'Opencode Free',
  openrouter: 'OpenRouter',
  nvidia: 'NVIDIA',
  ollama: 'Ollama Cloud',
  cf: 'Cloudflare',
  mistral: 'Mistral',
};

/**
 * Check if a model ID indicates a free-tier model (ends with :free).
 * OpenRouter convention — free models are rate-limited but cost $0.
 * Used by ninerouter model lists to identify toggleable free variants.
 */
export function isFreeTierModel(modelId: string): boolean {
  return modelId.endsWith(':free');
}
