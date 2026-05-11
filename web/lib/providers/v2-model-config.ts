/**
 * V2 Model Configuration
 * 
 * Handles model selection across different V2 engine types:
 * - CLI spawns (local desktop binary)
 * - HTTP SDKs (local or remote)
 * - Containerized engines
 * 
 * Different engines handle model switching differently:
 * | Engine Type    | Model Config    | Live Switch? | Method          |
 * |--------------|----------------|--------------|----------------|
 * | CLI binary   | CLI arg        | No           | New spawn      |
 * | HTTP SDK     | Init config   | No           | New session   |
 * | Remote host | Init config  | No           | New session   |
 * | Container   | Env var      | No           | New container |
 */

import { createLogger } from '@/lib/utils/logger';
import { getHealthState, type Architecture } from '@/lib/orchestra/model-health';

const log = createLogger('V2:ModelConfig');

export interface V2ModelConfig {
  /** Model identifier (e.g., 'anthropic/claude-3-5-sonnet-20241022') */
  model: string;
  /** Provider/engine type */
  engine: 'opencode' | 'anthropic' | 'openai' | 'ollama' | 'custom';
  /** Architecture type */
  architecture: 'v2-cli' | 'v2-http-sdk' | 'v2-container';
}

export interface V2ModelSelector {
  /** Get the current model config */
  getModel(): V2ModelConfig;
  /** Get available models for this engine */
  getAvailableModels(): string[];
  /** Check if a model is healthy */
  isModelHealthy(model: string): boolean;
  /** Get the best model considering health */
  getBestModel(): string;
}

/**
 * Get model for V2 CLI spawns
 * Reads from OPENCODE_MODEL env or CLI-specific env
 */
export function getV2CLIModel(): V2ModelConfig {
  const model = process.env.OPENCODE_MODEL 
    || process.env.OPENCODE_CLI_MODEL 
    || 'anthropic/claude-3-5-sonnet-20241022';

  return {
    model,
    engine: 'opencode',
    architecture: 'v2-cli',
  };
}

/**
 * Get CLI args for model (if supported by the engine)
 */
export function getV2CLIArgs(model?: string): string[] {
  const m = model || getV2CLIModel().model;
  // OpenCode CLI uses --model flag
  return ['--model', m];
}

/**
 * Get model for V2 HTTP SDK engines
 * Uses config at initialization (not live switchable)
 */
export function getV2SDKModel(baseUrl?: string): V2ModelConfig {
  const model = process.env.OPENCODE_MODEL 
    || process.env.OPENCODE_SDK_MODEL 
    || 'anthropic/claude-3-5-sonnet-20241022';

  return {
    model,
    engine: 'opencode',
    architecture: 'v2-http-sdk',
  };
}

/**
 * Get model for containerized V2 engines
 * Passed via environment variable to container
 */
export function getV2ContainerModel(): V2ModelConfig {
  const model = process.env.OPENCODE_CONTAINER_MODEL
    || process.env.OPENCODE_MODEL
    || 'anthropic/claude-3-5-sonnet-20241022';

  return {
    model,
    engine: 'opencode',
    architecture: 'v2-container',
  };
}

/**
 * Factory to get model config based on architecture
 */
export function getV2ModelConfig(architecture: Architecture): V2ModelConfig {
  switch (architecture) {
    case 'v2-cli':
      return getV2CLIModel();
    case 'v2-http-sdk':
      return getV2SDKModel();
    case 'v2-container':
      return getV2ContainerModel();
    default:
      log.warn('Unknown architecture, defaulting to CLI', { architecture });
      return getV2CLIModel();
  }
}

/**
 * Get model config suitable for UI display
 * Used by settings UI to show available models
 * @param architecture - Optional filter to return only models for a specific architecture.
 *                       Pass 'v2-cli', 'v2-http-sdk', or 'v2-container' to filter.
 *                       Omit to return models for all V2 architectures.
 */
export function getV2ModelsForUI(
  architecture?: 'v2-cli' | 'v2-http-sdk' | 'v2-container'
): Array<{
  value: string;
  label: string;
  architecture: Architecture;
  healthy: boolean;
}> {
  const models: Array<any> = [];

  const cliModels = [
    'anthropic/claude-3-5-sonnet-20241022',
    'anthropic/claude-3-7-sonnet-20250514',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-pro',
  ];

  const addModels = (arch: 'v2-cli' | 'v2-http-sdk' | 'v2-container') => {
    for (const model of cliModels) {
      models.push({
        value: model,
        label: model.replace('/', ': '),
        architecture: arch as Architecture,
        healthy: getHealthState(arch, model) !== 'unhealthy',
      });
    }
  };

  // If architecture filter specified, only add models for that type
  if (architecture) {
    addModels(architecture);
  } else {
    // No filter — add all V2 architecture models
    addModels('v2-cli');
    addModels('v2-http-sdk');
    addModels('v2-container');
  }

  return models;
}

/**
 * Build model selection prompt for V2 modes
 * Injects current model into system prompt
 */
export function buildV2ModelPrompt(config: V2ModelConfig): string {
  return `Current model: ${config.model} (${config.engine} ${config.architecture})`;
}

/**
 * Single resolver used by every V2 execution path in unified-agent-service.ts.
 *
 * Priority order (caller's explicit override always wins so UI/per-call model
 * selection actually reaches the engine):
 *   1. Explicit `override` (e.g. config.model from the chat request)
 *   2. Architecture-specific env var (OPENCODE_CLI_MODEL / SDK_MODEL / CONTAINER_MODEL)
 *   3. Generic OPENCODE_MODEL env
 *   4. Hardcoded default
 *
 * Pass the architecture so each engine type can pick its preferred env namespace
 * without callers having to know the full env-var matrix.
 */
export function resolveV2Model(
  architecture: Architecture,
  override?: string | null,
): V2ModelConfig {
  if (override && typeof override === 'string' && override.trim()) {
    return {
      model: override.trim(),
      engine: 'opencode',
      architecture: architecture as 'v2-cli' | 'v2-http-sdk' | 'v2-container',
    };
  }
  return getV2ModelConfig(architecture);
}

/**
 * Build the spawn-time CLI args for a given V2-CLI engine.
 * Today only `opencode` is supported but accepts an `engine` parameter so callers
 * (e.g. an alternative `codex-cli` or `nullclaw-cli` adapter) can be added without
 * having to teach every callsite the per-binary flag matrix.
 */
export function buildV2CLISpawnArgs(
  options: { engine?: 'opencode' | 'codex' | 'nullclaw'; model?: string; extraArgs?: string[] } = {},
): string[] {
  const engine = options.engine || 'opencode';
  const model = options.model || resolveV2Model('v2-cli').model;
  const extra = options.extraArgs || [];

  switch (engine) {
    case 'opencode':
      return ['--model', model, ...extra];
    case 'codex':
      // codex CLI uses `-m` shorthand
      return ['-m', model, ...extra];
    case 'nullclaw':
      return ['--model', model, ...extra];
    default:
      return ['--model', model, ...extra];
  }
}

/**
 * UI-facing snapshot of every model the chat selector can pick from, grouped by
 * architecture. The chat route honors whatever string the user picks via
 * `config.model` and routes through `resolveV2Model()` so a single dropdown can
 * span both V1 (LLM-provider) and V2 (CLI/HTTP/container) engines.
 *
 * `v1Models` is intentionally optional — when the caller doesn't pass it, we
 * skip the V1 group rather than reach into model-ranker (which would couple this
 * file to the ranker's life-cycle).
 */
export function listAllAvailableModels(
  v1Models?: Array<{ value: string; label: string; provider?: string; healthy?: boolean }>,
): Array<{
  value: string;
  label: string;
  architecture: 'v1-api' | Architecture;
  provider?: string;
  healthy: boolean;
}> {
  const out: Array<{
    value: string;
    label: string;
    architecture: 'v1-api' | Architecture;
    provider?: string;
    healthy: boolean;
  }> = [];

  if (Array.isArray(v1Models)) {
    for (const m of v1Models) {
      out.push({
        value: m.value,
        label: m.label || m.value,
        architecture: 'v1-api',
        provider: m.provider,
        healthy: m.healthy !== false,
      });
    }
  }

  for (const m of getV2ModelsForUI()) {
    out.push({
      value: m.value,
      label: m.label,
      architecture: m.architecture,
      healthy: m.healthy,
    });
  }
  return out;
}