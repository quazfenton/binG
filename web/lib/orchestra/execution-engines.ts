/**
 * Execution Engine Adapter
 *
 * Implements the v1/v2 architecture split described in `v1v2.md`:
 * the v1 vs v2 distinction is about HOW we reach the LLM, not WHICH
 * orchestration mode wraps it. This adapter lets every orchestration
 * mode (dual-process, intent-driven, energy-driven, distributed-cognition,
 * adversarial-verify, attractor-driven, cognitive-resonance, execution-controller)
 * call a single `runWithEngine()` function and have it dispatched to the
 * correct architecture transparently.
 *
 * Architectures
 * -------------
 *  - v1-api       : Vercel-AI-SDK / llm-providers.ts model call (engineered fully in-app)
 *  - v2-cli       : opencode/codex/nullclaw CLI binary spawned via execFile (safer than spawn+shell)
 *  - v2-http-sdk  : opencode-sdk / pi remote engine (SDK call to a server)
 *  - v2-container : v2 engine running inside a docker/sandbox container with mounted workspace
 *
 * Model selection
 * ---------------
 * The same model name (e.g. `google/gemini-3-flash-preview`) is honored on every
 * architecture: v1 routes through llm-providers.ts; v2-cli passes `--model …`;
 * v2-http-sdk threads it into the SDK init/prompt; v2-container passes it via env.
 * See `web/lib/chat/v2-model-config.ts:resolveV2Model()`.
 *
 * Why a thin adapter (not a full polymorphic refactor)?
 * ----------------------------------------------------
 * The orchestration modes already call `processUnifiedAgentRequest()` recursively.
 * This file lets them set `engine` on each sub-call, so we can change architecture
 * without rewriting any mode. A future iteration can layer richer per-engine
 * features (new-session arg, skills, subagents) on top of this surface.
 */

import { createLogger } from '@/lib/utils/logger';
import { resolveV2Model } from '@/lib/chat/v2-model-config';

const log = createLogger('ExecutionEngines');

export type EngineArchitecture = 'v1-api' | 'v2-cli' | 'v2-http-sdk' | 'v2-container';

/** Default architecture for an orchestration mode when nothing else is specified. */
export function defaultEngineArchitecture(): EngineArchitecture {
  // Honor env override first so deployments can pin v2 globally.
  const envEngine = (process.env.AGENT_EXECUTION_ENGINE || '').split('#')[0].trim();
  if (envEngine === 'v2-cli' || envEngine === 'v2-http-sdk' || envEngine === 'v2-container') {
    return envEngine;
  }
  // Otherwise default to v1 — universally available, no binaries required.
  return 'v1-api';
}

/**
 * Map a chosen architecture to the concrete `mode` value `processUnifiedAgentRequest`
 * dispatches on. Centralizing this prevents every orchestration mode from having to
 * know the v1/v2 mode-name catalogue.
 */
export function modeForEngine(engine: EngineArchitecture): string {
  switch (engine) {
    case 'v1-api':
      return 'v1-api';
    case 'v2-cli':
      // Use v2-native on desktop where the binary is local; both names dispatch
      // to the same opencode-engine path inside unified-agent-service.
      return 'v2-native';
    case 'v2-http-sdk':
      return 'opencode-sdk';
    case 'v2-container':
      return 'v2-containerized';
    default:
      return 'v1-api';
  }
}

/**
 * Resolve the engine choice for a sub-call from an orchestration mode.
 * Order: explicit per-call override → parent config.engine → env → 'v1-api'.
 */
export function resolveEngine(
  override?: EngineArchitecture | null,
  parentEngine?: EngineArchitecture | null,
): EngineArchitecture {
  if (override) return override;
  if (parentEngine) return parentEngine;
  return defaultEngineArchitecture();
}

/**
 * Apply engine choice to a sub-call config — sets both `engine` and `mode`
 * coherently and resolves the model through `resolveV2Model()` for v2 paths
 * so the same user-selected model name flows to every architecture.
 *
 * Returns a NEW object; never mutates the input.
 */
export function configureSubCall<T extends { engine?: EngineArchitecture; mode?: any; model?: string }>(
  baseConfig: T,
  engine: EngineArchitecture,
  modelOverride?: string,
): T {
  const resolvedModel = engine === 'v1-api'
    ? (modelOverride || baseConfig.model)
    : resolveV2Model(engine, modelOverride || baseConfig.model).model;

  log.debug('Configuring sub-call', { engine, mode: modeForEngine(engine), model: resolvedModel });

  return {
    ...baseConfig,
    engine,
    mode: modeForEngine(engine) as any,
    model: resolvedModel,
  };
}

/**
 * Whether the engine supports live model switching mid-conversation.
 * v1 always does (each call is stateless). v2 architectures cannot — the
 * model is fixed at spawn/session-init time, so a mid-flight switch needs
 * a fresh sub-call (which `configureSubCall` already produces).
 */
export function supportsLiveModelSwitch(engine: EngineArchitecture): boolean {
  return engine === 'v1-api';
}

/**
 * Whether the engine writes files directly (true for v2 with mounted workspace)
 * or relies on text-mode parsing of fenced code blocks (true for v1).
 * Useful for orchestration modes that decide whether to enable extra
 * post-response file-edit extraction.
 */
export function writesFilesDirectly(engine: EngineArchitecture): boolean {
  return engine === 'v2-cli' || engine === 'v2-container';
}
