/**
 * prompt-orchestrator/index.ts
 *
 * Facade for the prompt-orchestrator foundation (brainstorm step 1).
 * Re-exports the 4 components + the shared types so callers can import
 * everything from `@/lib/orchestra/prompt-orchestrator`.
 *
 *   import { loadScript, applyScript, scanMarkers } from '@/lib/orchestra/prompt-orchestrator';
 *
 * Components:
 *   - `loadScript(filePath)`: read + validate a JSON prompt script from disk.
 *   - `applyScript(target, script)`: inject a script into a target string
 *     with idempotency (skips (promptId, step, sha) tuples already present).
 *   - `scanMarkers(target)`: parse all existing PO-INJECT markers in a target.
 *   - `calculateSha(payload)`: compute the idempotency key for a payload.
 *   - `formatMarker(...)`: build a single marker block (mostly for tests).
 *   - `idempotencyKey(...)`: build the (promptId, step, sha) tuple key.
 *
 * This module is pure / sync — no I/O beyond `loadScript` reading the file
 * the caller passes in. Async wrappers (for streaming, network-loaded scripts,
 * etc.) can be layered on top.
 */
export { scanMarkers, formatMarker, idempotencyKey } from './marker-scanner';
export { calculateSha, applyScript } from './injection-planner';
export { loadScript, ScriptLoadError } from './script-loader';
// Tier 8 step 8 observability — observeApplyScript (drop-in metrics wrapper
// around applyScript) + serializeMetrics (Prometheus text exposition).
export { observeApplyScript, serializeMetrics } from './observability';
export type {
  PromptStep,
  PromptScript,
  InjectedMarker,
  InjectionSegment,
  InsertMode,
} from './types';
