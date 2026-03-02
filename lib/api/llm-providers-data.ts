/**
 * Local LLM Providers Data
 *
 * Configuration for local LLM providers that can be used with the enhanced code system.
 * This file should be customized based on your local LLM setup.
 */

// Define local providers with their models
const localProviders = {
  // OpenAI-compatible local provider (e.g., Ollama, LM Studio, LocalAI)
  openai_local: {
    id: 'openai_local',
    name: 'Local OpenAI-Compatible Provider',
    options: {
      baseURL: process.env.LOCAL_OPENAI_BASE_URL || 'http://localhost:11434/v1', // Default to Ollama
      apiKey: process.env.LOCAL_OPENAI_API_KEY || 'ollama', // Default to 'ollama' for Ollama
    },
    models: {
      'llama3.1': {
        id: 'llama3.1',
        name: 'Llama 3.1 (8B)',
        capabilities: {
          streaming: true,
          functionCalling: true,
          maxTokens: 8192,
        },
        meta: {
          provider: 'meta',
          family: 'llama',
          version: '3.1',
          parameters: '8B',
          contextWindow: 8192,
        },
      },
      'llama3.1:70b': {
        id: 'llama3.1:70b',
        name: 'Llama 3.1 (70B)',
        capabilities: {
          streaming: true,
          functionCalling: true,
          maxTokens: 8192,
        },
        meta: {
          provider: 'meta',
          family: 'llama',
          version: '3.1',
          parameters: '70B',
          contextWindow: 8192,
        },
      },
      'mistral-nemo': {
        id: 'mistral-nemo',
        name: 'Mistral NeMo',
        capabilities: {
          streaming: true,
          functionCalling: true,
          maxTokens: 128000,
        },
        meta: {
          provider: 'mistral',
          family: 'mistral',
          version: 'nemo',
          parameters: '12B',
          contextWindow: 128000,
        },
      },
      'phi3': {
        id: 'phi3',
        name: 'Phi-3',
        capabilities: {
          streaming: true,
          functionCalling: true,
          maxTokens: 4096,
        },
        meta: {
          provider: 'microsoft',
          family: 'phi',
          version: '3',
          parameters: '3.8B',
          contextWindow: 4096,
        },
      },
      'gemma2': {
        id: 'gemma2',
        name: 'Gemma 2',
        capabilities: {
          streaming: true,
          functionCalling: true,
          maxTokens: 8192,
        },
        meta: {
          provider: 'google',
          family: 'gemma',
          version: '2',
          parameters: '9B',
          contextWindow: 8192,
        },
      },
      'codellama': {
        id: 'codellama',
        name: 'CodeLlama',
        capabilities: {
          streaming: true,
          functionCalling: false,
          maxTokens: 16384,
        },
        meta: {
          provider: 'meta',
          family: 'llama',
          version: 'code',
          parameters: '7B-34B',
          contextWindow: 16384,
          specialization: 'code',
        },
      },
    },
  },

  // Anthropic-compatible local provider (if available)
  anthropic_local: {
    id: 'anthropic_local',
    name: 'Local Anthropic-Compatible Provider',
    options: {
      baseURL: process.env.LOCAL_ANTHROPIC_BASE_URL || 'http://localhost:8000/v1',
      apiKey: process.env.LOCAL_ANTHROPIC_API_KEY || 'local-anthropic-key',
    },
    models: {
      'claude-local': {
        id: 'claude-local',
        name: 'Claude (Local)',
        capabilities: {
          streaming: true,
          functionCalling: true,
          maxTokens: 200000,
        },
        meta: {
          provider: 'anthropic',
          family: 'claude',
          version: 'local',
          parameters: 'Unknown',
          contextWindow: 200000,
        },
      },
    },
  },

  // Google-compatible local provider (if available)
  google_local: {
    id: 'google_local',
    name: 'Local Google-Compatible Provider',
    options: {
      baseURL: process.env.LOCAL_GOOGLE_BASE_URL || 'http://localhost:8080/v1',
      apiKey: process.env.LOCAL_GOOGLE_API_KEY || 'local-google-key',
    },
    models: {
      'gemini-local': {
        id: 'gemini-local',
        name: 'Gemini (Local)',
        capabilities: {
          streaming: true,
          functionCalling: true,
          maxTokens: 32000,
        },
        meta: {
          provider: 'google',
          family: 'gemini',
          version: 'local',
          parameters: 'Unknown',
          contextWindow: 32000,
        },
      },
    },
  },

  // Custom/local provider
  custom_local: {
    id: 'custom_local',
    name: 'Custom Local Provider',
    options: {
      baseURL: process.env.CUSTOM_LOCAL_BASE_URL || 'http://localhost:3001/api',
      apiKey: process.env.CUSTOM_LOCAL_API_KEY || 'custom-local-key',
    },
    models: {
      'custom-model': {
        id: 'custom-model',
        name: 'Custom Model',
        capabilities: {
          streaming: true,
          functionCalling: true,
          maxTokens: 8000,
        },
        meta: {
          provider: 'custom',
          family: 'custom',
          version: '1.0',
          parameters: 'Unknown',
          contextWindow: 8000,
        },
      },
    },
  },
};

// Export local providers for use in the system
export default localProviders;

// Export individual provider configurations for direct access
export const OPENAI_LOCAL_PROVIDER = localProviders.openai_local;
export const ANTHROPIC_LOCAL_PROVIDER = localProviders.anthropic_local;
export const GOOGLE_LOCAL_PROVIDER = localProviders.google_local;
export const CUSTOM_LOCAL_PROVIDER = localProviders.custom_local;

// Export model lists for easy access
export const LOCAL_OPENAI_MODELS = Object.keys(localProviders.openai_local.models);
export const LOCAL_ANTHROPIC_MODELS = Object.keys(localProviders.anthropic_local.models);
export const LOCAL_GOOGLE_MODELS = Object.keys(localProviders.google_local.models);
export const LOCAL_CUSTOM_MODELS = Object.keys(localProviders.custom_local.models);

// Export all local models
export const ALL_LOCAL_MODELS = [
  ...LOCAL_OPENAI_MODELS,
  ...LOCAL_ANTHROPIC_MODELS,
  ...LOCAL_GOOGLE_MODELS,
  ...LOCAL_CUSTOM_MODELS,
];

// Export provider IDs for easy reference
export const LOCAL_PROVIDER_IDS = Object.keys(localProviders);

// Export utility functions
export function getLocalProvider(providerId: string) {
  return localProviders[providerId];
}

export function getLocalModel(providerId: string, modelId: string) {
  const provider = localProviders[providerId];
  return provider ? provider.models[modelId] : undefined;
}

export function isLocalModel(modelId: string): boolean {
  return ALL_LOCAL_MODELS.includes(modelId);
}

export function isLocalProvider(providerId: string): boolean {
  return LOCAL_PROVIDER_IDS.includes(providerId);
}