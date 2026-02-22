/**
 * Task-specific provider configuration
 * 
 * Allows using different providers optimized for specific tasks:
 * - Mistral for embeddings (mistral-embed is excellent)
 * - Mistral for agents (great agent support)
 * - Mistral for OCR (has dedicated OCR API)
 * - etc.
 */

export interface TaskProviderConfig {
  chat: string;
  code: string;
  embedding: string;
  image: string;
  tool: string;
  agent: string;
  ocr: string;
}

/**
 * Get provider for specific task
 * Falls back to DEFAULT_LLM_PROVIDER if task-specific provider not set
 */
export function getProviderForTask(task: keyof TaskProviderConfig): string {
  const taskProvider = process.env[`${task.toUpperCase()}_PROVIDER`];
  
  if (taskProvider && taskProvider.trim()) {
    return taskProvider.trim();
  }
  
  // Fall back to default provider
  return process.env.DEFAULT_LLM_PROVIDER || 'openrouter';
}

/**
 * Get model for specific task
 * Can be configured via TASK_MODEL env vars
 */
export function getModelForTask(task: string, defaultModel: string): string {
  const taskModel = process.env[`${task.toUpperCase()}_MODEL`];
  
  if (taskModel && taskModel.trim()) {
    return taskModel.trim();
  }
  
  return defaultModel;
}

/**
 * Get all task provider configuration
 */
export function getTaskProviderConfig(): TaskProviderConfig {
  return {
    chat: getProviderForTask('chat'),
    code: getProviderForTask('code'),
    embedding: getProviderForTask('embedding'),
    image: getProviderForTask('image'),
    tool: getProviderForTask('tool'),
    agent: getProviderForTask('agent'),
    ocr: getProviderForTask('ocr'),
  };
}

/**
 * Check if a provider is configured (has API key)
 */
export function isProviderConfigured(provider: string): boolean {
  const apiKeyEnvVars: Record<string, string> = {
    'openai': 'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'google': 'GOOGLE_API_KEY',
    'mistral': 'MISTRAL_API_KEY',
    'openrouter': 'OPENROUTER_API_KEY',
    'chutes': 'CHUTES_API_KEY',
    'portkey': 'PORTKEY_API_KEY',
    'opencode': 'OPENCODE_API_KEY',
    'github': 'GITHUB_MODELS_API_KEY',
    'cohere': 'COHERE_API_KEY',
    'together': 'TOGETHER_API_KEY',
    'replicate': 'REPLICATE_API_TOKEN',
    // Note: Composio is a tool integration platform, not an LLM provider
  };
  
  const envVar = apiKeyEnvVars[provider.toLowerCase()];
  return envVar ? !!process.env[envVar] : false;
}

/**
 * Get configured task providers (only those with API keys)
 */
export function getAvailableTaskProviders(): Partial<TaskProviderConfig> {
  const config = getTaskProviderConfig();
  const available: Partial<TaskProviderConfig> = {};
  
  (Object.keys(config) as Array<keyof TaskProviderConfig>).forEach(task => {
    if (isProviderConfigured(config[task])) {
      available[task] = config[task];
    }
  });
  
  return available;
}

// Export default config
export const taskProviders = getTaskProviderConfig();
