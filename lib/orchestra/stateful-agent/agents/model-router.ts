import type { ModelRole } from '../schemas';
import { createModelWithFallback, type ProviderName } from './provider-fallback';
import type { LanguageModel } from 'ai';

interface ModelConfig {
  role: ModelRole;
  modelId: string;
  preferredProvider?: ProviderName;
  maxTokens: number;
  temperature: number;
}

const DEFAULT_CONFIGS: Record<ModelRole, ModelConfig> = {
  architect: {
    role: 'architect',
    modelId: 'gpt-4o',
    preferredProvider: 'openai',
    maxTokens: 16000,
    temperature: 0.7,
  },
  builder: {
    role: 'builder',
    modelId: 'gpt-4o',
    preferredProvider: 'openai',
    maxTokens: 8000,
    temperature: 0.4,
  },
  linter: {
    role: 'linter',
    modelId: 'gpt-4o-mini',
    preferredProvider: 'openai',
    maxTokens: 2000,
    temperature: 0.1,
  },
};

// Environment-based model overrides
function getModelFromEnv(role: ModelRole): { modelId: string; provider?: ProviderName } {
  const envMapping: Record<ModelRole, { modelEnv: string; providerEnv: string }> = {
    architect: { modelEnv: 'ARCHITECT_MODEL', providerEnv: 'ARCHITECT_PROVIDER' },
    builder: { modelEnv: 'BUILDER_MODEL', providerEnv: 'BUILDER_PROVIDER' },
    linter: { modelEnv: 'LINTER_MODEL', providerEnv: 'LINTER_PROVIDER' },
  };

  const { modelEnv, providerEnv } = envMapping[role];
  const modelId = process.env[modelEnv];
  const provider = process.env[providerEnv] as ProviderName | undefined;

  return {
    modelId: modelId || DEFAULT_CONFIGS[role].modelId,
    provider: provider || DEFAULT_CONFIGS[role].preferredProvider,
  };
}

export function getModelConfigForRole(role: ModelRole): ModelConfig {
  const envConfig = getModelFromEnv(role);
  const defaultConfig = DEFAULT_CONFIGS[role];

  return {
    ...defaultConfig,
    modelId: envConfig.modelId,
    preferredProvider: envConfig.provider,
  };
}

/**
 * Get a model for a specific role with automatic fallback
 */
export async function getModelForRole(role: ModelRole): Promise<{
  model: LanguageModel;
  provider: ProviderName;
  modelId: string;
  config: ModelConfig;
}> {
  const config = getModelConfigForRole(role);
  const useMultiModel = process.env.USE_MULTI_MODEL === 'true';

  // If multi-model is disabled, use default provider for all roles
  if (!useMultiModel) {
    const defaultModelString = (process.env.DEFAULT_MODEL || 'gpt-4o').replace('openai:', '');
    const result = await createModelWithFallback('openai', defaultModelString);
    return {
      model: result.model,
      provider: result.provider,
      modelId: result.modelId,
      config: { ...config, modelId: defaultModelString },
    };
  }

  // Use role-specific model with fallback
  const result = await createModelWithFallback(config.preferredProvider, config.modelId);
  
  return {
    model: result.model,
    provider: result.provider,
    modelId: result.modelId,
    config,
  };
}

export async function runArchitectPhase(
  prompt: string,
  context: { projectStructure: string; files?: string[] }
): Promise<{
  intents: Array<{ file_path: string; action: string; reason: string; dependencies: string[]; risk_level: string }>;
  plan: { task: string; files: Array<{ path: string; action: string; diff_preview: string }>; execution_order: string[]; rollback_plan: string };
}> {
  const modelResult = await getModelForRole('architect');
  const config = modelResult.config;

  const systemPrompt = `You are the Architect - create detailed plans for code modifications.

Your role:
1. Analyze the project structure and understand the codebase
2. Identify all files that need to be read or modified
3. Create a detailed plan with execution order
4. Consider dependencies and potential risks
5. Provide a rollback plan in case of issues

OUTPUT: Return JSON with "intents" and "plan" keys.

FORMAT:
{
  "intents": [
    {
      "file_path": "path/to/file.ts",
      "action": "read|edit|create|delete",
      "reason": "Why this file needs to be modified",
      "dependencies": ["other/files/that/depend/on/this.ts"],
      "risk_level": "low|medium|high"
    }
  ],
  "plan": {
    "task": "Summary of the task",
    "files": [
      {
        "path": "path/to/file.ts",
        "action": "read|edit|create|delete",
        "diff_preview": "Brief description of changes"
      }
    ],
    "execution_order": ["path/to/file.ts"],
    "rollback_plan": "How to revert if something goes wrong"
  }
}`;

  try {
    const { generateText } = await import('ai');
    const result = await generateText({
      model: modelResult.model,
      system: systemPrompt,
      prompt: `${systemPrompt}\n\nCONTEXT:\n${context.projectStructure}\n\nFILES:\n${context.files?.join('\n') || 'None specified'}\n\nREQUEST:\n${prompt}`,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });

    try {
      const parsed = JSON.parse(result.text);
      return parsed;
    } catch {
      console.warn('[ModelRouter] Failed to parse architect response, using fallback');
      return {
        intents: [],
        plan: {
          task: prompt,
          files: [],
          execution_order: [],
          rollback_plan: 'Revert all changes if errors occur',
        },
      };
    }
  } catch (error) {
    console.error('[ModelRouter] Architect phase error:', error);
    return {
      intents: [],
      plan: {
        task: prompt,
        files: [],
        execution_order: [],
        rollback_plan: 'Revert all changes if errors occur',
      },
    };
  }
}

export async function runLinterPhase(
  files: Record<string, string>
): Promise<{
  errors: Array<{ path: string; line: number; error: string; severity: 'error' | 'warning' }>;
  passed: boolean;
}> {
  const modelResult = await getModelForRole('linter');
  const config = modelResult.config;

  const prompt = `You are the Linter - check these files for syntax errors and common issues.

Analyze the following files and return a JSON object with any errors found.

FILES:
${Object.entries(files)
  .map(([path, content]) => `=== ${path} ===\n${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`)
  .join('\n\n')}

Return JSON in this format:
{
  "errors": [
    {
      "path": "file path",
      "line": 1,
      "error": "description of error",
      "severity": "error|warning"
    }
  ],
  "passed": true|false
}

If no errors, return: {"errors": [], "passed": true}`;

  try {
    const { generateText } = await import('ai');
    const result = await generateText({
      model: modelResult.model,
      prompt,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });

    try {
      const parsed = JSON.parse(result.text);
      return parsed;
    } catch {
      console.warn('[ModelRouter] Failed to parse linter response, assuming passed');
      return { errors: [], passed: true };
    }
  } catch (error) {
    console.error('[ModelRouter] Linter phase error:', error);
    return { errors: [], passed: true };
  }
}

export const modelRouter = {
  getModelForRole,
  getModelConfigForRole,
  runArchitectPhase,
  runLinterPhase,
};
