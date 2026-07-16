// @audit-phantom-L4593: L4593 is a drift target, NOT a canonical Stage 2
// surface. Canonical Stage 2 surface is the do-while(false) band L1475..L1712
// in route.ts (cascade Q3/Q5 cross-cut).
/**
 * Unified Agent Service
 *
 * Unifies V1 (LLM Chat API), V2 (OpenCode Containerized), and StatefulAgent (Plan-Act-Verify)
 * into a single interface with intelligent routing.
 *
 * Features:
 * - Automatic routing based on task complexity and configuration
 * - StatefulAgent for complex multi-step tasks (primary for agentic work)
 * - Fallback chain: StatefulAgent → V2 Native → V2 Local → V1 API
 * - Tool execution support for all modes
 * - Streaming support
 * - Health checking for provider availability
 */

import type { ToolResult } from '../sandbox/types';
import type { LLMProvider } from '../sandbox/providers/llm-provider';
import { getLLMProvider } from '../sandbox/providers/llm-factory';
import { getCircuitStateName } from '../middleware/circuit-breaker';
import { shouldAutoContinue } from '@/lib/chat/llm-continuation';
// NEW-1 followup-d at `lib/orchestra/unified-agent-service.ts` (first production caller of the prompt-orchestrator foundation);
// adds the applyScript integration at L1491 below. The first non-test production caller of step 1's API;
// unlocks Tier 8 step 4 (round-trip writes) + step 8 (observability) on real production data.
// Idempotent (re-runs are deterministic no-ops via the (promptId, step, sha) tuple).
//
// PO_UNIFIED_AGENT_SCRIPT comes from the shared `default-scripts.ts` module (was previously
// declared inline here + duplicated in marker-scanner.ts). The shared module is the source of
// truth so a 3rd caller can't silently drift. Empty `steps: []` makes the applyScript call
// structural (input userMsg passes through unchanged end-to-end). Tier 8 step 4 / step 8
// un-defer unblockers: add a step here OR switch to `loadScript('~/.prompt-orchestrator/
// scripts/unified-init.json')` for a disk-stored script.
import { observeApplyScript, PO_UNIFIED_AGENT_SCRIPT } from '@/lib/orchestra/prompt-orchestrator';

// Bug #1 follow-up: route the v1-api-with-tools auto-continue decision
// through the shared helper so per-requestId counters, env-tunable
// MAX_CONTINUATIONS, and the file-edit detector override all match the
// chat/route.ts SSE streaming path. Closing the six gaps listed in the
// audit (counter cleanup, requestId keying, hardcoded 3, helper.default,
// SSE emission) in a single call site change.
import { decideAutoContinue, defaultFileEditDetector, needsMoreTurnsDetector, clearContinuationCount, buildSyntheticPhaseTransitionRequestId } from '@/lib/chat/auto-continue-helper';
import type { AutoContinueResultData, AutoContinueRouting } from '@/lib/chat/auto-continue-helper';
import { is530Blacklisted, record530ErrorIfApplicable, reset530Counter } from './provider-530-tracker';
// PR-W -- DRY helper consumed at the success-return reset pair.
import { maybeResetBothTrackers } from './provider-530-tracker';
import { isServerErrorBlacklisted, record5xxErrorIfApplicable } from './provider-server-error-tracker';

// Wire in centralized tool system for all execution paths (v1, v2, streaming, non-Mastra)
import { initToolSystem, executeToolCapability, hasToolCapability, isToolSystemReady } from '@/lib/tools';
import { toolCallTracker } from '@/lib/tools/tool-call-tracker';
// Bug #91 canonical response-shape helper (with 16 unit tests covering
// whitespace/null/non-string/non-array edge cases — see classifying test).
import { classifyResponseShape } from '@/lib/tools/unified-response-handler';

import { runAgentLoop as runV2AgentLoop } from './agent-loop';
import { ModalClient, maybeUseModal, getModalClient } from '@/lib/modal/modal-client';
// Defense-in-depth: enforce the `UnifiedAgentResult.response: string` contract
// at the service layer (L1568 below) so that even if Modal's wire response
// shape drifts (e.g. ContentPart array, `{role, parts, content}` object),
// the L1568 return site ALWAYS emits a string. TypeScript trusts the wire
// shape via `this.post<AgentExecuteResponse>(...)` casts in modal-client.ts;
// stringifyMessageContent is the runtime enforcement point. See
// lib/chat/content-stringifier.ts for the contract surface.
import { stringifyMessageContent } from '@/lib/chat/content-stringifier';
// Inspector-pair audit (shapeKeyOf + serializableTextLength) hoisted from
// the chat-route emit point (`app/api/chat/route.ts:1668-L1669`) into the
// service layer so the audit fires from EVERY processUnifiedAgentRequest
// caller (v1 priority router, v2-native, stateful-agent, OpenCode SDK,
// agent-loop orchestration fallback) — not just the chat route's narrow
// post-await log line. The chat-route emit is preserved (different prefix,
// distinct route-local fields like bufferLen/elapsedMs) for defense-in-depth
// grep-ability. See `auditResponseShape` below.
import { shapeKeyOf, serializableTextLength } from '@/lib/chat/shape-helpers';
import { sseEncode, SSE_EVENT_TYPES } from '@/lib/streaming/sse-event-schema';
import { PROVIDER_DEFAULT_MODELS } from '../providers/provider-default-models';
import { getConfiguredFallbackChain } from '../providers/provider-fallback-chains';
import { chatRequestLogger } from '../chat/chat-request-logger';
import { extractFileWritesFromLLMResponse, type FileWrite } from '../chat/file-diff-utils';
import { recordToolCallTelemetry, prepareTelemetryPayload } from '@/lib/errors/logging-utils';
import { getRecontextSupplement } from '@/lib/memory/cache-exporter';
import { normalizeSchemaForAI } from '@bing/shared/agent/tool-schema';
import {
  createOpenCodeEngine,
  type OpenCodeEngineResult,
  type OpenCodeEngineConfig,
} from '../session/agent/opencode-engine-service';
import { isDesktopMode } from "@bing/platform/env";
import { findOpencodeBinarySync } from "@/lib/drivers/opencode/find-opencode-binary";
import fs from 'node:fs';
import nodePath from 'node:path';

// Centralized agent logging, startup capabilities, and health tracking
import { createAgentLogger, agentLog } from './agent-logger';
import { getStartupCapabilities, type StartupCapabilities } from './startup-capabilities';
import { recordSuccess, recordFailure, isModeHealthy, type Architecture } from './model-health';

import {
  StatefulAgent,
  type StatefulAgentOptions,
  type StatefulAgentResult,
} from './stateful-agent/agents/stateful-agent';
import { createLogger } from '@/lib/utils/logger';
import { mastraWorkflowIntegration } from '@bing/shared/agent/mastra-workflow-integration';

import {
  createFeedbackEntry,
  addFeedback,
  injectFeedback,
  detectHealingTrigger,
  detectIncompleteResponse,
  generateHealingPrompt,
  getFeedbackInjectionBudget,
  type FeedbackContext,
} from '@bing/shared/agent/feedback-injection';
import {
  getTracker,
  recordResponse,
  recordToolCall,
  checkReEvalTrigger,
  recordReEval,
  generateTrackerSummary,
} from '@bing/shared/agent/successive-tracker';    // [STEER] wiring: when the consecutive/total tool-call cap fires, give the LLM
// an explicit text-mode fallback instead of an abrupt cutoff. Closes #21.
import { wireConsecutiveToolCapSteer, wireOrchestrationFallbackSteer, wireLoopAbortSteer, safeSteer, InvalidModelError, buildSteerPrompt, steerFromFinishReason } from './steer-service';
// Bug #40: per-session orchestration-fallback counter. Incremented in
// tagResultDegraded so /api/health?detailed can surface the count.
import { incrementOrchestrationFallback } from '@/lib/observability/degradation-tracker';
// Bug #40: chat-route metrics (orchestrationFallbacks, doubleWriteBlocked,
// incompleteResponses, injectedSteers) — wired so the new chat-metrics
// module is actually consumed alongside the legacy degradation tracker.
import { recordOrchestrationFallback as recordChatOrchestrationFallback } from '@/lib/chat/chat-metrics';

// Mirrors successive-tracker.ts internal constants. The package doesn't
// export them; keep these in sync with DEFAULT_CONSECUTIVE_TOOL_THRESHOLD = 7
// and DEFAULT_TOOL_CALL_THRESHOLD = 15 in packages/shared/agent/successive-tracker.ts.
const STEER_CONSECUTIVE_CAP = 7;
const STEER_TOTAL_CAP = 15;
import {
  parseFirstResponseRouting,
  stripRoutingMarkers,
  shouldTriggerReview,
  generateStepReprompt,
  routingToRoleRedirectSection,
  truncateAtFirstRouting,
  buildRoutingMetadataForClient,
  type RoutingMetadata,
  type ParsedRouting,
} from '@bing/shared/agent/first-response-routing';
import { resolveV2Model } from '@/lib/providers/v2-model-config';
import {
  buildWorkspaceSnapshot,
  normalizeToolArgs,
  createLoopDetectorState,
  recordStepAndCheckLoop,
  extractToolError,
  isLoopDetectorResult,
  type LoopAbortPayload,
} from '@/lib/orchestra/shared-agent-context';
import { composeRoleWithTools } from '@bing/shared/agent/prompt-composer';

import {
  PlanActVerifyOrchestrator,
  type OrchestratorConfig,
  type OrchestratorEvent
} from '@bing/shared/agent/orchestration/plan-act-verify';

import { getProjectServices, type ProjectContext } from '@/lib/context/project-context';
import {
  runDualProcessMode,
  runAdversarialVerifyMode,
  runAttractorDrivenMode,
  runIntentDrivenMode,
  runEnergyDrivenMode,
  runDistributedCognitionMode,
  runCognitiveResonanceMode,
  runExecutionControllerMode,
  type DualProcessConfig,
  type AdversarialConfig,
  type AttractorConfig,
  type IntentFieldConfig,
  type EnergyDrivenConfig,
  type DistributedConfig,
  type ResonanceConfig,
  type ExecutionControllerConfig,
} from './modes';
import {
  runRetrievalPipeline,
  type RetrievalPipelineOptions,
  ingestFewShot,
  ingestExperience,
  ingestTrajectory,
  ingestRule,
  ingestAntiPattern,
} from '@/lib/rag/retrieval';
import { mem0Add, isMem0Configured } from '@/lib/powers/mem0-power';
// Bug #39: pre-flight env probe (which npx python3 node npm pnpm ...) is
// injected into the system prompt ONCE per request so the LLM knows what
// binaries are available BEFORE it picks a tool. Closes the 3× ENOENT loop
// on `npx` / `python3` by preventing the LLM from reaching for missing
// binaries in the first place. The env probe is appended to the existing
// auto-inject context so all downstream mode handlers pick it up via the
// same config._autoInjectContext mechanism.
import { formatAvailableBinariesAsync } from '@/lib/bash/env-probe';
// Pass-5 #62 (audit) — second half: inject the canonical VFS session-scope
// path into the system prompt at request start so the LLM never has to
// guess the scope. Returns null for plain anon ownerIds (no $ delimiter),
// in which case the inject is silent.
import { buildSessionScopeSteerPrompt, wireFinishReasonSteer } from './steer-service';
// Pass-2 cross-cutting theme: record orchestration fallback events so the
// degradation chain shows when the v1-api text-mode fallback fired. The
// sessionId is passed through config.conversationId / config.userId / 'default'.
import { recordDegradation } from '@/lib/observability/degradation-tracker';
import { READ_ONLY_TOOL_NAMES, WRITE_TOOL_NAMES, hasMutationSuffix, hasReadSuffix } from '@bing/shared/agent/tool-classification';
import { StallWatchdogError } from '@/lib/chat/llm-fallback-coordinator';

// Does the @opencode-ai/sdk package exist in node_modules?
// Cached at module load so checkStartupCapabilities() can use it cheaply.
// Uses fs.existsSync on node_modules/@opencode-ai/sdk — simpler and more
// reliable than parsing package.json, works in all deployment contexts.
/**
 * Audit-grade discriminator for `composedPromptSource` (Q3 fix).
 * Centralizes the two magic strings so a future typo (`Override` vs `override`)
 * fails at module load / type-check, not silently at a log site.
 */
export const PROMPT_SOURCE = {
  OVERRIDE: 'override',
  NO_OVERRIDE: 'no-override',
} as const;

// exported so route.ts SSE payload emitters can reuse the discriminator without redefining it.
export const Q2_LIFT_REASON: 'SSE-payload discriminator reuse' = 'SSE-payload discriminator reuse';

export type PromptSource = typeof PROMPT_SOURCE.OVERRIDE | typeof PROMPT_SOURCE.NO_OVERRIDE;

/**
 * Option-3 audit-grade discriminator (Q3 followup closure):
 * Map a `String | null` to the `'override' | 'no-override'` sentinel so
 * downstream telemetry can distinguish caller-requested (non-null string)
 * from caller-skipped (null) without depending on tsc-narrowed types
 * or breaking the `@audit pinned field name composedPromptSource` contract.
 *
 * Convention: any non-null STRING value is treated as caller-requested
 * (`OVERRIDE`). The orchestrator's `composedPrompt = null` branch falls
 * into `NO_OVERRIDE` even when the upstream empty-string booking applies,
 * because that booking only fires AFTER the helper returns.
 */
export function stringOrNullToPromptSource(
  value: string | null | undefined,
): typeof PROMPT_SOURCE.OVERRIDE | typeof PROMPT_SOURCE.NO_OVERRIDE {
  return value == null ? PROMPT_SOURCE.NO_OVERRIDE : PROMPT_SOURCE.OVERRIDE;
}

let _hasOpenCodeSDKPackageCache: boolean | undefined;
function _hasOpenCodeSDKPackageCheck(): boolean {
  if (_hasOpenCodeSDKPackageCache !== undefined) return _hasOpenCodeSDKPackageCache;
  try {
    const dir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
    // web/lib/orchestra -> web/ -> node_modules/@opencode-ai/sdk
    const sdkPath = nodePath.join(dir, "..", "..", "node_modules", "@opencode-ai", "sdk");
    _hasOpenCodeSDKPackageCache = fs.existsSync(sdkPath);
  } catch {
    _hasOpenCodeSDKPackageCache = false;
  }
  return _hasOpenCodeSDKPackageCache;
}
const _hasOpenCodeSDKPackage = _hasOpenCodeSDKPackageCheck();

const log = createLogger('UnifiedAgentService');

// In-process orchestrator concurrency limiter to prevent "All workers are busy" failures.
// Simple FIFO queue with a configurable max concurrency. This is an additive safety
// layer that queues requests when the orchestrator is saturated instead of failing.
const ORCH_MAX_CONCURRENCY = Number.parseInt(process.env.ORCH_MAX_CONCURRENCY || '3', 10);
let _orchCurrent = 0;
const _orchQueue: Array<() => void> = [];
async function acquireOrchSlot(): Promise<void> {
  if (_orchCurrent < ORCH_MAX_CONCURRENCY) {
    _orchCurrent++;
    return;
  }
  await new Promise<void>((resolve) => _orchQueue.push(resolve));
  _orchCurrent++;
}
function releaseOrchSlot(): void {
  _orchCurrent = Math.max(0, _orchCurrent - 1);
  const next = _orchQueue.shift();
  if (next) next();
}

// Export helpers for testing
export { acquireOrchSlot, releaseOrchSlot };


// Bug #108 (Pass-7 audit) — emit a structured env-var fingerprint at
// module load so operators can verify which feature flags / routing
// overrides are active in this process. Pass-7 noted that "env-var /
// feature-flag mentions" were absent from logs entirely — a `v1-api`
// selection in production was ambiguous because there was no single log
// line listing the routing-relevant env vars. Tagged at INFO so it shows
// up in every [INFO]-level dashboard filter. The list is intentionally
// narrow (routing-affecting vars only) to avoid noise — auth keys are
// not listed (those are secrets and go through their own audit).
const _envFingerprint: Record<string, string> = {
  AGENT_EXECUTION_ENGINE: process.env.AGENT_EXECUTION_ENGINE || 'auto (default)',
  DISABLE_V2_MODE: process.env.DISABLE_V2_MODE || '(default)',
  DEFAULT_MODEL: process.env.DEFAULT_MODEL || '(default)',
  LLM_PROVIDER: process.env.LLM_PROVIDER || '(default)',
  AGENT_CLASSIFIER_RICH_TOOLING_THRESHOLD:
    process.env.AGENT_CLASSIFIER_RICH_TOOLING_THRESHOLD || '0.6 (default)',
  AGENT_CLASSIFIER_AGENTIC_VERB_THRESHOLD:
    process.env.AGENT_CLASSIFIER_AGENTIC_VERB_THRESHOLD || '0.25 (default)',
  INCOMPLETE_RESPONSE_CONFIDENCE_THRESHOLD:
    process.env.INCOMPLETE_RESPONSE_CONFIDENCE_THRESHOLD || '0.4 (default)',
  LLM_STREAM_IDLE_TIMEOUT_MS: process.env.LLM_STREAM_IDLE_TIMEOUT_MS || '75000 (default)',
  LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS: process.env.LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS || '30000 (default)',
  LLM_STREAM_STALL_STEER_MS: process.env.LLM_STREAM_STALL_STEER_MS || '30000 (default)',
  VFS_CONCURRENT_MODIFICATION_MULTIPLIER:
    process.env.VFS_CONCURRENT_MODIFICATION_MULTIPLIER || '2 (default)',
  VFS_SNAPSHOT_STALE_THRESHOLD_MS: process.env.VFS_SNAPSHOT_STALE_THRESHOLD_MS || '60000 (default)',
  MEMORY_SOFT_THROTTLE_MB: process.env.MEMORY_SOFT_THROTTLE_MB || '1024 (default)',
  MEMORY_CRITICAL_MB: process.env.MEMORY_CRITICAL_MB || '1843 (default)',
  MEMORY_GROWTH_REPORT_MB: process.env.MEMORY_GROWTH_REPORT_MB || '8 (default)',
  MEMORY_SHRINK_REPORT_MB: process.env.MEMORY_SHRINK_REPORT_MB || '4 (default)',
  ENABLE_STATEFUL_AGENT: process.env.ENABLE_STATEFUL_AGENT || '(default; enabled)',
  ENABLE_MASTRA_WORKFLOWS: process.env.ENABLE_MASTRA_WORKFLOWS || '(default; enabled)',
  OPENCODE_SDK_URL: process.env.OPENCODE_SDK_URL || '(default; uses OPENCODE_HOSTNAME:OPENCODE_PORT)',
  NODE_ENV: process.env.NODE_ENV || '(default)',
};
log.info('[UnifiedAgent] env-var fingerprint (routing-affecting)', _envFingerprint);

/**
 * Bug-fix #4 (chat-hang investigation wrap): race a Promise against a
 * hard timeout that resolves with a caller-supplied fallback value. Used
 * as defense-in-depth around the pre-stream awaits in
 * `processUnifiedAgentRequest`:
 *   - `resolveDynamicDefaults()`  → 2.5s (dynamic `import('../providers/model-ranker')` +
 *                                   `circuit-breaker` can hang during dev/Turbopack cold compile)
 *   - `determineMode(config)`     → 2.5s (dynamic `import('./execution-engines')` for engine path)
 *   - `formatAvailableBinariesAsync()` → 3s (37 parallel `which` calls — already 1.5s
 *                                   per-binary ceiling inside env-probe, but defense-in-depth)
 *
 * Timer-leak guard: the setTimeout handle is captured in outer scope and
 * cleared in `.finally()` chained on the race so a fast-resolving winner
 * doesn't leave a pending timer in Node's queue (mirrors PR-A/PR-B pattern
 * from `llm-fallback-coordinator.ts`).
 *
 * Relationship to other abort machinery: this helper is `Promise.race`-based,
 * NOT `AbortController`-based. It does NOT cancel the underlying work — the
 * original promise is still pending in the background and GCs eventually —
 * which is acceptable trade-off: leaking one promise per hung request is
 * strictly better than blocking the chat route indefinitely. A future
 * enhancement could wire `AbortController` + `signal.addEventListener` to
 * prune the hung work, but the dev-mode hang symptom is the user-visible
 * regression and the timeout fires in time for `processUnifiedAgentRequest`
 * to proceed via the fallback path.
 *
 * @param promise  — the work to race against the deadline
 * @param ms       — hard ceiling; race resolves to `fallback` if `promise` is not settled in time
 * @param fallback — the value returned on timeout (must be type-compatible with `promise`)
 * @param label    — short label used in the warn log so operators can correlate
 */
async function withTimeoutFallback<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          log.warn('[CHAT-HANG-FIX] Pre-stream await exceeded budget; using fallback', {
            label,
            timeoutMs: ms,
          });
          resolve(fallback);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// SelfHeal carry-forward cache: stores the provider+model that succeeded
// on the most recent attempt so SelfHeal retries can skip dead providers.
let _selfHealProvider: string | null = null;
let _selfHealModel: string | null = null;

// Bug #12 (Pass-8): Session-scoped provider cache. When a non-primary provider
// succeeds, cache it per conversation so subsequent requests in the same session
// reuse it instead of re-running the full provider selection (which hits the
// 429'd primary every time). TTL is 10 minutes; entries auto-expire.
const _sessionProviderCache = new Map<string, { provider: string; model: string; confirmedAt: number }>();
const SESSION_PROVIDER_CACHE_TTL_MS = 10 * 60 * 1000;

export function getLastWorkingProvider(conversationId?: string): { provider: string; model: string } | null {
  if (!conversationId) return null;
  const entry = _sessionProviderCache.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.confirmedAt > SESSION_PROVIDER_CACHE_TTL_MS) {
    _sessionProviderCache.delete(conversationId);
    return null;
  }
  return { provider: entry.provider, model: entry.model };
}

export function recordLastWorkingProvider(conversationId: string, provider: string, model: string): void {
  _sessionProviderCache.set(conversationId, { provider, model, confirmedAt: Date.now() });
}

/**
 * Resolve dynamic default provider/model using model-ranker.
 * Shared across all execution paths to avoid hardcoding 'mistral'/'mistral-large-latest'.
 * Falls back to env vars then 'mistral' if model-ranker is unavailable.
 */
let _cachedDynamicDefaults: { provider: string; model: string } | null = null;
let _dynamicDefaultsTimestamp = 0;
const DYNAMIC_DEFAULTS_TTL_MS = 30_000; // Re-check every 30s

// #66 (docs/async-parallelization-opportunities.md, Tier 5 concurrent-miss
// de-dup): concurrent resolveDynamicDefaults() callers share the same resolution
// promise when the cache is stale and the cache-MISS path is executing. Combined
// with the 30s cache hit (microsecond synchronous return) above, this covers
// both the within-window repeat-call case AND the simultaneous-miss case that
// the cache alone does NOT cover (e.g. when a circuit-breaker invalidation fires
// and N concurrent callers all hit the cache-miss path within the same microtask).
// Module-scoped so only in-process waiters share — Next.js Worker boundary still
// acts as a natural fan-out boundary per process. The `.finally` clears the slot
// on both fulfilled AND rejected paths so a permanently-rejected promise cannot
// permanently block subsequent callers (next caller retries with a fresh IIFE).
// Identity-checked in the cleanup ('if it's still ours') to avoid clobbering a
// newer in-flight promise that may have been set by an interleaved caller.
let _dynamicDefaultsInflight: Promise<{ provider: string; model: string }> | null = null;

/**
 * Check if a provider has a non-empty API key in the environment.
 * Mirrors provider-fallback-chains.ts PROVIDER_API_KEY_ENV but also handles
 * special cases (ninerouter/ollama/kiro via QUAZ_API_KEY, vercel/livekit).
 */
function providerHasConfiguredApiKey(provider: string): boolean {
  const envVarMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY',
    google: 'GOOGLE_API_KEY', mistral: 'MISTRAL_API_KEY',
    openrouter: 'OPENROUTER_API_KEY', chutes: 'CHUTES_API_KEY',
    github: 'GITHUB_MODELS_API_KEY', nvidia: 'NVIDIA_API_KEY',
    groq: 'GROQ_API_KEY', together: 'TOGETHER_API_KEY',
    fireworks: 'FIREWORKS_API_KEY', deepinfra: 'DEEPINFRA_API_KEY',
    zen: 'ZEN_API_KEY', portkey: 'PORTKEY_API_KEY',
    cloudflare: 'CLOUDFLARE_API_KEY', cohere: 'COHERE_API_KEY',
    aihubmix: 'AIHUBMIX_API_KEY', livekit: 'LIVEKIT_API_KEY',
    pollinations: 'POLLINATIONS_API_KEY', chatanywhere: 'CHATANYWHERE_API_KEY',
    vercel: 'VERCEL_API_KEY',
    ninerouter: 'NINEROUTER_API_KEY',
    ollama: 'NINEROUTER_API_KEY', kiro: 'NINEROUTER_API_KEY',
  };
  const envVar = envVarMap[provider.toLowerCase()];
  if (!envVar) return false;
  const val = process.env[envVar];
  return typeof val === 'string' && val.trim().length > 0;
}

async function resolveDynamicDefaults(): Promise<{ provider: string; model: string }> {
  const now = Date.now();
  if (_cachedDynamicDefaults && (now - _dynamicDefaultsTimestamp) < DYNAMIC_DEFAULTS_TTL_MS) {
    return _cachedDynamicDefaults;
  }
  // #66 in-flight de-dup gate: if another caller in this process is already
  // resolving the cache-MISS path, await their promise instead of starting
  // a fresh dynamic-import chain. The `inflight` local capture + identity
  // check in the finally block below prevents an older caller from clobbering
  // a newer in-flight's slot if interleaved calls re-enter the gate.
  if (_dynamicDefaultsInflight) return _dynamicDefaultsInflight;
  const inflight = _dynamicDefaultsInflight = (async () => {
  let provider = process.env.LLM_PROVIDER || 'mistral';
  let model = process.env.DEFAULT_MODEL || 'mistral-large-latest';
  try {
    const { getModelForRotation, isRateLimited } = await import('../providers/model-ranker');

    // Strategy 1: Cross-provider selection — model-ranker picks the best
    // provider+model combo from any configured provider.
    const rotation = getModelForRotation();
    if (rotation && !isRateLimited(rotation.provider, rotation.model)) {
      // Verify the provider has a configured API key — model-ranker's
      // isProviderConfiguredForTelemetry uses a loose truthy check, but
      // we need a strict non-empty-string check to avoid selecting
      // providers whose env vars are set to empty strings or placeholders.
      // Verify the provider has a configured API key — model-ranker's
      // isProviderConfiguredForTelemetry uses a loose truthy check, but
      // we need a strict non-empty-string check to avoid selecting
      // providers whose env vars are set to empty strings or placeholders.
      // If the check fails, null out rotation so Strategy 2 can run.
      let apiKeyValid = providerHasConfiguredApiKey(rotation.provider);
      if (!apiKeyValid) {
        log.warn('[DynamicDefaults] Model-ranker selected provider without API key, falling back', {
          selectedProvider: rotation.provider,
          selectedModel: rotation.model,
        });
        rotation.provider = '';  // Marker to trigger Strategy 2
      }

      // Also verify circuit isn't open for this provider
      if (apiKeyValid) {
        let circuitOpen = false;
        try {
          const { circuitBreakerManager } = await import('../middleware/circuit-breaker');
          const breaker = circuitBreakerManager.getBreaker(rotation.provider);
          circuitOpen = breaker.getState() === 'OPEN';
        } catch { /* circuit-breaker unavailable, assume not open */ }
        if (!circuitOpen) {
          provider = rotation.provider;
          model = rotation.model;
        }
      }
    }

    // Strategy 2: If cross-provider selection failed, returned a rate-limited
    // model, or the selected provider lacked an API key, get the best model
    // specifically for the configured default provider.
    if (!rotation || !rotation.provider || isRateLimited(rotation.provider, rotation.model)) {
      const providerRotation = getModelForRotation(undefined, provider);
      if (providerRotation?.model && !isRateLimited(provider, providerRotation.model)) {
        // Keep the existing provider, update the model
        model = providerRotation.model;
      }
    }
  } catch { /* model-ranker unavailable */ }

  // Final safety net: if the selected provider has no API key, fall back to
  // the first available provider from the standard fallback chain.
  // Uses top-level imports (PROVIDER_DEFAULT_MODELS and getConfiguredFallbackChain
  // are imported at module level) — no dynamic imports needed here.
  if (!providerHasConfiguredApiKey(provider)) {
    log.warn('[DynamicDefaults] Default provider lacks API key, scanning fallback chain', {
      provider,
    });
    try {
      const chain = getConfiguredFallbackChain(provider);
      for (const fbProvider of chain) {
        if (providerHasConfiguredApiKey(fbProvider)) {
          provider = fbProvider;
          model = PROVIDER_DEFAULT_MODELS[fbProvider] || 'default';
          log.warn('[DynamicDefaults] Selected fallback provider from chain', {
            originalProvider: process.env.LLM_PROVIDER || 'mistral',
            fallbackProvider: fbProvider,
            model,
          });
          break;
        }
      }
    } catch { /* best effort */ }
  }

  _cachedDynamicDefaults = { provider, model };
  _dynamicDefaultsTimestamp = now;
  return { provider, model };
  })();
  try {
    return await inflight;
  } finally {
    if (_dynamicDefaultsInflight === inflight) _dynamicDefaultsInflight = null;
  }
}

/**
 * Invalidate the cached dynamic defaults — call when a circuit-breaker trips
 * so the next resolveDynamicDefaults() call picks a different provider.
 */
function invalidateDynamicDefaultsCache(): void {
  _cachedDynamicDefaults = null;
  _dynamicDefaultsTimestamp = 0;
}

/**
 * Exact-name sets from the capability map (createCapabilityToolExecutor)
 * to avoid false positives from substring matching (e.g. 'read' in 'thread.read').
 * These are used by the auto-continuation loop in runV1ApiWithTools.
 */

/**
 * Classify a provider error into permanent vs transient vs rate-limit.
 * Permanent errors (missing API key, invalid auth, model not found) should
 * skip the provider immediately and derank it heavily — retrying will never
 * help. Rate-limit errors should back off longer. Transient errors (5xx,
 * network, timeout) should retry normally on the next provider.
 *
 * Returns 'permanent' | 'rate_limit' | 'transient'.
 */
function classifyProviderError(error: any): 'permanent' | 'rate_limit' | 'transient' {
  const msg = String(error?.message || '').toLowerCase();
  // Try all common SDK property locations for HTTP status:
  //   error.status          — Vercel AI SDK / many Node.js clients
  //   error.statusCode      — raw fetch / OpenAI Node SDK
  //   error.status_code     — snake_case convention (Pydantic, FastAPI)
  //   error.response.status — axios / nock / supertest / fetch wrappers
  //   error.code            — some SDKs encode HTTP status as "code"
  const status = error?.status || error?.statusCode || error?.status_code || error?.response?.status || error?.code || 0;

  // Bug #116 fix: 401/403 were classified as 'permanent' and skipped for the
  // entire request. But many 401s are transient (expired token, API gateway
  // returning 403 for overuse, key rotation, etc.) and even for genuinely
  // missing keys the fallback chain should try other providers first.
  // Demote 401/403 to 'rate_limit' so they go through the circuit-breaker
  // (5 failures / 5 min TTL) instead of being permanently disabled.
  // Specific auth-related message strings (invalid key format, forbidden)
  // still classify as 'permanent' since those indicate misconfiguration.
  if (status === 401 || status === 403) {
    // Keep 'permanent' only for clearly-misconfigured states.
    if (
      msg.includes('invalid api key') ||
      msg.includes('invalid x-api-key') ||
      msg.includes('authentication failed') ||
      msg.includes('insufficient_quota') ||
      msg.includes('billing issue')
    ) {
      return 'permanent';
    }
    // 401/403 without explicit invalid-key signal → treat as rate_limit
    // so the circuit breaker handles back-off and auto-recovery.
    return 'rate_limit';
  }

  // Permanent: bad config (invalid key format, model not found, etc.)
  if (
    msg.includes('api key is missing') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('not authorized') ||
    msg.includes('model not found') ||
    msg.includes('model does not exist') ||
    msg.includes('no such model') ||
    msg.includes('invalid model') ||
    msg.includes('model not supported')
  ) {
    return 'permanent';
  }

  // Rate limit: 429 or explicit rate-limit messaging
  if (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('quota exceeded')
  ) {
    return 'rate_limit';
  }

  // Everything else: transient (5xx, timeout, network, abort, etc.)
  return 'transient';
}

/**
 * Track providers that have permanently failed in this request.
 * Once a provider returns a permanent error, we skip it in subsequent
 * fallback iterations. Resets per-request.
 */
const _sessionPermanentFailures = new Set<string>();

/**
 * Bug #116/#90: Process-level circuit breaker for transient failures.
 * A provider that hits N transient failures within a TTL window gets
 * temporarily blocked (not permanently). This prevents the "sticky
 * permanent failure" bug where a single transient error disables a
 * provider for the entire process lifetime.
 */
const TRANSIENT_CIRCUIT_BREAKER_TTL_MS = 5 * 60 * 1000;
const TRANSIENT_CIRCUIT_BREAKER_THRESHOLD = 5;
const _transientCircuitBreaker = new Map<string, { count: number; firstAt: number; lastAt: number }>();

function recordTransientFailure(providerName: string): void {
  const key = providerName.toLowerCase();
  const now = Date.now();
  let entry = _transientCircuitBreaker.get(key);
  if (!entry || now - entry.firstAt > TRANSIENT_CIRCUIT_BREAKER_TTL_MS) {
    entry = { count: 1, firstAt: now, lastAt: now };
    _transientCircuitBreaker.set(key, entry);
    return;
  }
  entry.count++;
  entry.lastAt = now;
}

function isProviderCircuitBroken(providerName: string): boolean {
  const key = providerName.toLowerCase();
  const entry = _transientCircuitBreaker.get(key);
  if (!entry) return false;
  const now = Date.now();
  if (now - entry.firstAt > TRANSIENT_CIRCUIT_BREAKER_TTL_MS) {
    _transientCircuitBreaker.delete(key);
    return false;
  }
  return entry.count >= TRANSIENT_CIRCUIT_BREAKER_THRESHOLD;
}

function resetTransientCircuitBreaker(providerName: string): void {
  _transientCircuitBreaker.delete(providerName.toLowerCase());
}

function resetAllTransientCircuitBreakers(): void {
  _transientCircuitBreaker.clear();
}

/** Reset permanent failure tracking at the start of each request. */
function resetSessionPermanentFailures(): void {
  _sessionPermanentFailures.clear();
}

/** Mark a provider as permanently failed for this request context. */
function markProviderPermanentlyFailed(providerName: string): void {
  _sessionPermanentFailures.add(providerName);
}

/** Check if a provider has permanently failed for this request. */
function isProviderPermanentlyFailed(providerName: string): boolean {
  return _sessionPermanentFailures.has(providerName);
}

/**
 * Flag: client has disconnected (controller closed, abort, etc.).
 * When true, skip ALL provider fallback loops. Resets per-request.
 */
let _clientDisconnected = false;

/** Reset the client disconnect flag at the start of each request. */
function resetClientDisconnected(): void {
  _clientDisconnected = false;
}

/** Mark the client as disconnected. */
function markClientDisconnected(errorOrReason?: Error | string): void {
  const errOrReason = errorOrReason;
  const reason = typeof errOrReason === 'string'
    ? errOrReason
    : errOrReason?.message || 'unknown reason';

  // Timeout-induced disconnects are provider-specific — the controller closed
  // because THIS provider took too long. A different provider may respond
  // quickly. Do NOT set the global _clientDisconnected flag for timeouts.
  const isTimeout = reason.includes('timeout') || reason.includes('No activity') || reason.includes('No response');

  if (isTimeout) {
    // Timeout: skip this provider, but allow fallback to next provider.
    // Do NOT set _clientDisconnected — the fallback loop needs to try other providers.
    log.warn("[ClientDisconnected] ⏱ Timeout - stream closed on THIS provider, allowing fallback to next", {
      reason,
      category: 'timeout',
      errorName: errOrReason && typeof errOrReason === 'object' && 'name' in errOrReason ? (errOrReason as Error).name : typeof errOrReason,
    });
    return; // Do NOT set _clientDisconnected for timeouts
  }

  _clientDisconnected = true;
  const errorName = errOrReason && typeof errOrReason === 'object' && 'name' in errOrReason
    ? (errOrReason as Error).name
    : typeof errOrReason;
  
  // Differentiated logging to distinguish user-initiated disconnects from server errors.
  // Timeouts are handled above (do NOT set _clientDisconnected for timeouts).
  const isUserAbort = reason.includes('aborted') || reason.includes('cancelled') || reason.includes('user');
  const isServerError = reason.includes('5') || reason.includes('server error') || reason.includes('internal');
  
  if (isUserAbort) {
    log.warn("[ClientDisconnected] 🚫 User abort - stream closed, skipping remaining provider attempts", {
      reason,
      category: 'user_abort',
      errorName,
    });
  } else if (isServerError) {
    log.warn("[ClientDisconnected] 🔴 Server error - stream closed, skipping remaining provider attempts", {
      reason,
      category: 'server_error',
      errorName,
    });
  } else {
    log.warn("[ClientDisconnected] ❓ Unknown cause - stream closed, skipping all provider attempts", {
      reason,
      category: 'unknown',
      errorName,
    });
  }
}

/** Check if client has disconnected. */
function isClientDisconnected(): boolean {
  return _clientDisconnected;
}

export interface UnifiedAgentConfig {
  // Core
  userMessage: string;
  sandboxId?: string;
  systemPrompt?: string;
  /** If set, use the prompt-composer to build the system prompt from a role template */
  role?: 'coder' | 'reviewer' | 'planner' | 'architect' | 'researcher' | 'debugger';
  conversationHistory?: Array<{ role: string; content: string }>;
  userId?: string;  // Authenticated user ID — passed to BootstrappedAgency for VFS scoping
  conversationId?: string;  // Session/conversation ID for VFS session scoping (e.g., "001")

  // Workspace isolation (provides workspace-scoped vector memory and retrieval)
  projectContext?: ProjectContext;

  // Filesystem (additional options)
  filesystemOwnerId?: string;  // Owner ID for VFS operations
  scopePath?: string;  // Scope path for session-scoped file operations

  // Tools
  tools?: any[];
  executeTool?: (name: string, args: Record<string, any>) => Promise<ToolResult>;
  onToolExecution?: (name: string, args: Record<string, any>, result: ToolResult) => void;

  // Streaming
  onStreamChunk?: (chunk: string) => void;
  /**
   * Progress heartbeat — called when the service is about to start a new
   * streaming phase (e.g. auto-continuation re-invocation). The route uses
   * this to reset its stall watchdog's lastProgressAt so the watchdog
   * doesn't falsely fire during the gap between the primary stream ending
   * and the continuation's first token arriving.
   */
  onProgress?: () => void;
  /**
   * Caller-supplied AbortSignal. Upstream callers (e.g. the chat route's
   * POST handler) forward `request.signal` here so a user-initiated stop
   * can interrupt the orchestration chain.
   *
   * NOTE — landing-pad status: only this interface slot exists in this
   * turn. The v1-api modes (`runV1ApiWithTools`, `runV1ApiCompletion`,
   * including their server-side continuation turns) now forward this
   * signal into `streamWithConcurrentFallback` so a user-initiated stop
   * cancels the upstream HTTP request and re-arms the fallback
   * coordinator's user-abort race arm. Other modes (`runV2Native`,
   * `runStatefulAgentMode`, `runOpencodeSDKMode`, `runMastraWorkflow`,
   * etc.) do NOT yet forward it — for those the chain-walk in
   * `llm-fallback-coordinator.ts` only interrupts on its own
   * `hardDeadlineMs` budget per provider, and the route-level hard
   * deadline (app/api/chat/route.ts) is the final backstop.
   *
   * Optional. When undefined, modes fall back to their internal
   * timeout / circuit-breaker machinery (no caller-side interruption).
   */
  abortSignal?: AbortSignal;

  // Agent settings
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;

  // Provider and model override (uses env defaults if not specified)
  // Session tracking for successive calls
  sessionId?: string;
  provider?: string;
  model?: string;

  // Mode override (optional - auto-detected from env if not specified)
  mode?: 'v1-api' | 'v1-agent-loop' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'opencode-sdk' | 'mastra-workflow' | 'desktop' | 'v1-progressive-build' | 'dual-process' | 'adversarial-verify' | 'attractor-driven' | 'intent-driven' | 'energy-driven' | 'distributed-cognition' | 'cognitive-resonance' | 'execution-controller' | 'spec:super' | 'spec:maximal' | 'auto';

  /**
   * Architecture/engine choice — decouples HOW the LLM is invoked from WHAT
   * orchestration mode wraps it. This is the v1/v2 axis from v1v2.md:
   *   - 'v1-api'        → standard LLM API call (Vercel AI SDK + llm-providers.ts)
   *   - 'v2-cli'        → spawn an agentic CLI binary (opencode/codex/nullclaw)
   *   - 'v2-http-sdk'   → talk to a remote/local agentic engine via SDK/HTTP
   *   - 'v2-container'  → run agentic engine inside a container with mounted workspace
   *
   * Orchestration modes (dual-process / intent-driven / etc.) thread this through
   * to their sub-calls so the same orchestration shape can run on either V1 or V2.
   * When unset, falls back to env (AGENT_EXECUTION_ENGINE) and then to the
   * mode's default architecture.
   */
  engine?: 'v1-api' | 'v2-cli' | 'v2-http-sdk' | 'v2-container';

  // Harness mode options
  dualProcessConfig?: DualProcessConfig;
  adversarialConfig?: AdversarialConfig;
  attractorConfig?: AttractorConfig;
  intentConfig?: IntentFieldConfig;
  energyConfig?: EnergyDrivenConfig;
  distributedConfig?: DistributedConfig;
  resonanceConfig?: ResonanceConfig;
  executionControllerConfig?: ExecutionControllerConfig;

  // Mastra workflow options
  workflowId?: string; // Use specific Mastra workflow
  enableMastraWorkflows?: boolean; // Enable Mastra workflow routing

  // Progressive build options (for v1-progressive-build mode)
  progressiveBuild?: {
    /** Maximum iterations for the build loop. Default: 15 */
    maxIterations?: number;
    /** Context strategy: 'diff' | 'read' | 'tree'. Default: 'diff' */
    contextMode?: 'diff' | 'read' | 'tree';
    /** Enable reflection pass after each iteration. Default: false */
    enableReflection?: boolean;
    /** Global timeout in ms. Default: 300,000 */
    timeBudgetMS?: number;
    /** Custom completion indicator. Default: '[BUILD_COMPLETE]' */
    completionIndicator?: string;
  };

  /** Auto-inject context text populated by the entry point for mode handlers.
   *  Contains the raw auto-inject power description text (e.g., web-search, code-search)
   *  for modes that don't use conversationHistory (OpenCodeEngine, StatefulAgent, Mastra). */
  _autoInjectContext?: string;
}

export interface UnifiedAgentResult {
  success: boolean;
  response: string;
  steps?: Array<{
    toolName: string;
    args: Record<string, any>;
    result: ToolResult;
  }>;
  totalSteps?: number;
  mode: 'v1-api' | 'v1-agent-loop' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'opencode-sdk' | 'mastra-workflow' | 'desktop' | 'v1-progressive-build' | 'dual-process' | 'dual-process-fast' | 'dual-process-slow' | 'dual-process-fast-fallback' | 'dual-process-slow-failed' | 'adversarial-verify' | 'adversarial-verify-revised' | 'adversarial-verify-revision-failed' | 'attractor-driven' | 'intent-driven' | 'energy-driven' | 'distributed-cognition' | 'distributed-cognition-no-synthesis' | 'cognitive-resonance' | 'cognitive-resonance-converged' | 'cognitive-resonance-synthesized' | 'cognitive-resonance-single' | 'cognitive-resonance-fallback' | 'execution-controller' | 'spec:super' | 'spec:maximal';
  error?: string;
  fileEdits?: Array<{
    path: string;
    content?: string;
    diff?: string;
    action?: string;
  }>;      metadata?: {
    model?: string;
    provider?: string;
    duration?: number;
    workflowId?: string;
    workflowSteps?: Array<{ id: string; name: string; status: string }>;
    /** Parsed routing metadata from first-response [ROLE_SELECT] block.
     * Shape matches buildRoutingMetadataForClient() — the client (use-enhanced-chat.ts)
     * reads `stepReprompt`, `primaryRole`, `estimatedSteps`, and `continue`. */
    routing?: {
      classification?: string;
      complexity?: string;
      suggestedRole?: string;
      primaryRole?: string;
      specializationRoute?: string;
      /** Full ordered list of planned steps (each with role + suggested tool) */
      planSteps?: any[];
      /** Convenience count, mirrors planSteps.length */
      estimatedSteps?: number;
      continue?: boolean;
      reviewTriggered?: boolean;
      reviewReason?: string;
      /** Auto-re-prompt message for the next plan step (consumed by route.ts or client) */
      stepReprompt?: string;
    };
    /** Bug #40: True when this response is a degraded (fallback) response
     *  — the orchestrator / v1-agent-loop failed and the request was
     *  completed by a less-resilient path. The UI surfaces a banner; the
     *  route layer injects `nextTurnSteer` on the user's next turn. */
    degraded?: boolean;
    /** Bug #40: the specific reason for the fallback. Free-form string
     *  (e.g. "budget_exhausted", "orchestrator_crash", "all_modes_failed").
     *  Carries through from the inner fallback paths (fallbackFrom +
     *  fallbackReason in attemptFallback) and is set by tagResultDegraded. */
    fallbackReason?: string;
    /** Bug #40: the [STEER] orchestration_fallback prompt the LLM should
     *  see on the next turn so it knows the previous response was degraded
     *  and can adapt (e.g., not re-try the same complex plan that just
     *  exhausted the orchestrator budget). The chat route layer is
     *  responsible for prepending this to the next user message. */
    nextTurnSteer?: string;
    [key: string]: any;
  };
  // Bug #41: structured loop-abort payload surfaced when the 3-consecutive
  // tool-failures kill fires (on the v1-api path). The route layer reads
  // this to emit a final `loop_abort` SSE event for the UI banner. Plain
  // `error` field still carries the abort message for backward compat.
  loopAbort?: LoopAbortPayload;
  // ARCH-001 Flag 1 (Pickup): the 3 detector-helper enrichment fields from
  // `AutoContinueResultData` now live on `UnifiedAgentResult` as OPTIONAL
  // arrays. They are marked `?` because most call sites (mode-handler return
  // paths in runV2Native, runOpencodeSDKMode, etc.) do not pre-compute these;
  // `_enrichResultData` in `auto-continue-helper.ts` populates them from
  // `steps` + `responseText` at the `decideAutoContinue` boundary BEFORE the
  // detectors run. Type is NOT marked `readonly` — the spread-based refresh
  // semantic in `processUnifiedAgentRequest` (e.g. `{ ...fallbackResult }`)
  // simply re-reads whatever the source held, and the helper's wider repo
  // already pattern-matches spread semantics everywhere else.
  //
  // - `errors`:               stringified tool-failure messages distilled from
  //                            `steps[].result.error` and `steps[].result.success === false`.
  // - `toolFailures`:         paired `{ toolName, error }` records for the
  //                            same step set; drives the `failure-cascade` detector signal.
  // - `incompleteSignals`:    responseText-derived heuristic signal names
  //                            (`announced-next-step`, `step-enumeration`,
  //                            `planned-multi-step`, `unclosed-code-block`,
  //                            `mid-sentence-cutoff`) for the soft-gate detectors.
  errors?: string[];
  toolFailures?: Array<{ toolName: string; error: string }>;
  incompleteSignals?: string[];
}

// Note: StartupCapabilities is imported from ./startup-capabilities
// Re-export for backward compatibility
export type { StartupCapabilities } from './startup-capabilities';

/**
 * Startup health check — determines which agent modes are actually available.
 * Called once at module load; result is cached.
 * Now imported from ./startup-capabilities
 */
export { checkStartupCapabilities } from './startup-capabilities';

// Cache at module load — these don't change at runtime
// Note: getStartupCapabilities is already imported at line 39
const startupCaps = getStartupCapabilities();

/**
 * Determine which mode to use based on config.
 *
 * Uses startup capability flags (checked once at module load) to skip
 * unavailable modes entirely — no retries, no fallback loops.
 * Defaults to v1-agent-loop (PlanActVerify) with dynamic injector always active.
 */
async function determineMode(config: UnifiedAgentConfig): Promise<{
  mode: 'v1-api' | 'v1-agent-loop' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'opencode-sdk' | 'mastra-workflow' | 'desktop' | 'v1-progressive-build' | 'dual-process' | 'dual-process-fast' | 'dual-process-slow' | 'dual-process-fast-fallback' | 'dual-process-slow-failed' | 'adversarial-verify' | 'adversarial-verify-revised' | 'adversarial-verify-revision-failed' | 'attractor-driven' | 'intent-driven' | 'energy-driven' | 'distributed-cognition' | 'distributed-cognition-no-synthesis' | 'cognitive-resonance' | 'cognitive-resonance-converged' | 'cognitive-resonance-synthesized' | 'cognitive-resonance-single' | 'cognitive-resonance-fallback' | 'execution-controller' | 'spec:super' | 'spec:maximal';
}> {
  // Explicit mode override
  if (config.mode && config.mode !== 'auto') {
    return { mode: config.mode };
  }

  // Engine override (v1/v2 architecture choice — see UnifiedAgentConfig.engine).
  // The orchestration mode is auto-derived to the matching architecture so the
  // same dropdown can drive either engine type without forcing the user to know
  // the v1/v2 mode-name catalogue.
  if (config.engine) {
    const { modeForEngine } = await import('./execution-engines');
    const engineMode = modeForEngine(config.engine);
    log.info('[determineMode] engine override → mode', { engine: config.engine, mode: engineMode });
    return { mode: engineMode as any };
  }

  // AGENT_EXECUTION_ENGINE: Explicit control over which execution engine to use.
  // Check this BEFORE startup capabilities to respect user configuration.
  // - 'v1-api'        → Vercel AI SDK with tool calling (streamWithVercelAI + tools, provider fallback)
  // - 'v1-agent-loop' → Direct Mastra/ToolLoopAgent path (createAgentLoop from mastra/agent-loop.ts)
  // - 'auto'          → Auto-rotate between the two v1 modes based on task complexity
  // FIX: Trim inline comments from env values (e.g., "auto #comment" → "auto")
  const engine = (process.env.AGENT_EXECUTION_ENGINE || 'auto').split('#')[0].trim();

  if (engine === 'v1-api') {
    // Bug #98 (Pass-7 audit) — include `engineSource` in the log so
    // operators can distinguish an explicit user/admin override from a
    // router/fallback-driven v1-api selection. The log line is the
    // single source of truth for "why are we on v1-api right now?";
    // without the source tag, a `v1-api` selection in production logs
    // is ambiguous and the operator has to cross-reference env vars +
    // classifier output + fallback chain. Tagged at info to match the
    // other engine-override log lines in this block.
    log.info('AGENT_EXECUTION_ENGINE=v1-api, using Vercel AI SDK execution path', {
      engineSource: 'env-override',
      envVar: process.env.AGENT_EXECUTION_ENGINE,
    });
    return { mode: 'v1-api' as const };
  }
  if (engine === 'v1-agent-loop') {
    log.info('AGENT_EXECUTION_ENGINE=v1-agent-loop, using direct Mastra/ToolLoopAgent path (route.ts will bypass unified-agent)');
    return { mode: 'v1-agent-loop' as const };
  }
  if (engine === 'progressive-build' || engine === 'v1-progressive-build') {
    log.info('AGENT_EXECUTION_ENGINE=progressive-build, using multi-iteration build loop');
    return { mode: 'v1-progressive-build' as const };
  }
  if (engine === 'agent-loop') {
    log.info('AGENT_EXECUTION_ENGINE=agent-loop, using OpenCode agent loop execution path');
    return { mode: 'v2-native' as const };
  }

  // Desktop mode takes priority when enabled AND in auto mode
  // (moved after AGENT_EXECUTION_ENGINE check to respect explicit engine configuration)
  if (startupCaps.desktop) {
    return { mode: 'desktop' };
  }

  // OpenCode SDK mode: web-first mode using HTTP API to an OpenCode server.
  // Takes priority over v1-api when the SDK is available — it provides full
  // agentic capabilities (bash, file ops, tool calling) without needing
  // a local CLI binary. Works on both web and desktop deployments.
  if (startupCaps.opencodeSdk) {
    log.info('[AutoMode] → opencode-sdk (OpenCode server available)');
    return { mode: 'opencode-sdk' };
  }

  // AUTO mode: Rotate between v1-api and v1-agent-loop based on task complexity
  // - Simple tasks → v1-api (fast, no tool loop overhead)
  // - Complex tasks → v1-agent-loop (Mastra ToolLoopAgent with multi-step tool execution)
  // V2 modes are NEVER used in auto rotation.
  log.info('[AutoMode] ┌─ AUTO ROTATION ──────────────────────────');
  log.info('[AutoMode] │ engine:', engine);
  log.info('[AutoMode] │ disableV2:', process.env.DISABLE_V2_MODE !== 'false');
  log.info('[AutoMode] │ userMessageLength:', (config.userMessage || '').length);
  log.info('[AutoMode] └────────────────────────────────────────────');

  // Mastra workflow: only if explicitly requested AND available
  if (config.enableMastraWorkflows !== false && config.workflowId && startupCaps.mastraWorkflows) {
    log.info('[AutoMode] → mastra-workflow (explicitly requested)');
    return { mode: 'mastra-workflow' };
  }

  // V1 auto-routing: pick between v1-api (the resilient provider-fallback path)
  // and v1-agent-loop (PlanActVerify orchestrator) based on the RAW user task
  // and tool availability. See classifyV1Route for the full rationale — notably
  // it classifies the de-augmented task and only escalates to the orchestrator
  // when there are real tools AND genuine agentic intent, so a long but
  // conversational prompt no longer lands on the less-resilient orchestrator.
  const decision = classifyV1Route(config);
  log.info('[AutoMode] ┌─ V1 ROUTE DECISION ──────────────────────');
  log.info('[AutoMode] │ mode:', decision.mode);
  log.info('[AutoMode] │ reason:', decision.reason);
  log.info('[AutoMode] │ signals:', JSON.stringify(decision.signals));
  log.info('[AutoMode] └──────────────────────────────────────────');
  return { mode: decision.mode };
}

/**
 * Extract the raw user task from a potentially context-augmented userMessage.
 * The route prepends context (workspace state, memory, system prompt) before
 * the actual user task via `buildAgenticContext`. We strip all that to
 * classify ONLY the user's intent.
 */
function extractRawUserTask(userMessage: string): string {
  let task = userMessage;

  // If the message has a "TASK:" separator (added by route.ts), take only what's after it
  const taskMarker = '\n\nTASK:\n';
  const taskIdx = task.indexOf(taskMarker);
  if (taskIdx >= 0) {
    task = task.slice(taskIdx + taskMarker.length).trim();
  }

  // If still too long, cap it
  const MAX_TASK_CHARS = 4000;
  if (task.length > MAX_TASK_CHARS) {
    task = task.slice(0, MAX_TASK_CHARS);
  }

  return task || userMessage.slice(0, 200);
}

export type V1RouteDecision = {
  mode: 'v1-api' | 'v1-agent-loop';
  reason: string;
  signals: Record<string, unknown>;
  /** Agentic score in [0, 1]. Used by tests and telemetry to compare runs. */
  agenticScore?: number;
};

/**
 * Heuristics for "this request is a follow-up that benefits from prior context
 * (code, errors, tool results, or an injected steer) rather than a fresh user
 * message." Each detector returns true when the conversation history shows
 * evidence of the corresponding context type.
 *
 * Why these signals matter: the prior classifier (Bug #9/#32) keyed off
 * `rawLength` alone, which caused a 55-char follow-up like "yes, do that" to
 * be routed to v1-api even when the conversation had 18 tools, a stack trace,
 * and an injected steer — the user-perceived "abrupt demotion" bug.
 */
type ContextualSignals = {
  hasCodeContext: boolean;
  hasErrorContext: boolean;
  hasToolResultContext: boolean;
  hasReprompt: boolean;
};

/**
 * Read the conversation history and detect the contextual signals above.
 *
 * Cheap, deterministic regex/structural checks. The history is small
 * (typically <50 messages for a chat session) so O(n) is fine.
 *
 * IMPORTANT: signal regexes are intentionally conservative to avoid
 * false-positives on casual chat. A prose sentence like "I have a class
 * today" or "do NOT retry the install" must NOT trigger hasCodeContext or
 * hasReprompt — those phrasings occur naturally in normal conversation.
 */
function deriveContextualSignals(
  conversationHistory?: Array<{ role: string; content: string }>,
  userMessage?: string,
): ContextualSignals {
  // Look at assistant + tool + user messages (skip system) AND the current
  // userMessage — the audit scenario has a 55-char follow-up whose context
  // can live in the current message (e.g. a user pastes a stack trace or
  // quotes a [STEER] marker into the same turn) as well as in the prior
  // history. The classifier must catch both shapes; the regexes below are
  // strict enough that this broadening does not cause false positives on
  // ordinary chat messages.
  const historyCorpus = Array.isArray(conversationHistory) && conversationHistory.length > 0
    ? conversationHistory
        .filter((m) => m && m.role && m.role !== 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n')
    : '';
  // Intentional broadening: the audit called for "prior conversation state"
  // signals, but in practice a 55-char follow-up can carry its own context
  // (user pastes a stack trace, types "[STEER] continue", or quotes a code
  // fence inline). The regexes are strict enough (fenced code + file
  // extension for hasCodeContext; sentinel-only for hasReprompt; named-error
  // keywords for hasErrorContext) that scanning the current turn does not
  // introduce false positives on casual chat. Test scenarios in
  // autoclass-turn-aware.test.ts intentionally paste context into userMessage
  // to lock this behavior in.
  const corpus = [historyCorpus, userMessage || '']
    .filter((s) => typeof s === 'string' && s.length > 0)
    .join('\n');

  if (!corpus) {
    return {
      hasCodeContext: false,
      hasErrorContext: false,
      hasToolResultContext: false,
      hasReprompt: false,
    };
  }

  // hasCodeContext: require BOTH a fenced code block AND a file-extension/path
  // mention OR a recognized language tag in the fence opener (e.g. ` ```ts `,
  // ` ```python `). The fenced snippet is what distinguishes a programming
  // context from a sentence that casually mentions "class" or "function" —
  // the false-positive test in autoclass-turn-aware.test.ts passes a sentence
  // with no fenced code and expects hasCodeContext to be false. Accepting
  // a language tag in the opener covers the headline audit scenario (a
  // 55-char follow-up after a ` ```ts ` exchange) where the code fence
  // contains no file mention.
  const hasFencedCode = /```[\s\S]*?```/.test(corpus);
  const hasFileMention =
    /[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|cpp|h|json|md|css|scss|html|yml|yaml|sql|sh|toml|env)\b/i.test(
      corpus,
    );
  const hasFencedLanguageTag =
    /```\s*(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|cpp|h|json|md|markdown|yaml|yml|sql|sh|bash|html|css|scss|toml)\b/i.test(
      corpus,
    );
  const hasCodeContext = hasFencedCode && (hasFileMention || hasFencedLanguageTag);

  const hasErrorContext =
    /\b(error|exception|traceback|stack trace|failed|failure|panic|TypeError|ReferenceError|SyntaxError|RangeError|ENOENT|EACCES|EAGAIN|ETIMEDOUT|ECONNRESET|undefined is not|cannot read|cannot find|unhandled|unhandledrejection)\b/i.test(
      corpus,
    );

  // hasToolResultContext: a `tool` role message OR a payload with a `success`
  // field. The latter is broad enough to catch most real tool result shapes
  // (`{"success":true,"output":...}`, `{"bash":{"success":true}}`, etc.) without
  // requiring a nested object that the old regex demanded.
  // Guard against undefined conversationHistory (test scenarios and audit
  // scenarios can pass only userMessage with no history).
  const hasToolResultContext = Array.isArray(conversationHistory)
    ? conversationHistory.some(
        (m) =>
          m &&
          (m.role === 'tool' ||
            (typeof m.content === 'string' && /"success"\s*:/i.test(m.content))),
      )
    : false;

  // hasReprompt: only the bracketed sentinels. Phrases like "do NOT retry"
  // or "try a different approach" appear in normal English and caused
  // false-positives (review #1) — keep this strict.
  const hasReprompt =
    /\[INCOMPLETE-RESPONSE-FEEDBACK\]|\[STEER\]|\[REPROMPT\]|\[SELF-HEAL\]|\[AUTO-CONTINUE\]|\[BUILD_COMPLETE\]/i.test(
      corpus,
    );

  return { hasCodeContext, hasErrorContext, hasToolResultContext, hasReprompt };
}

/**
 * Tooling richness — a coarse score in [0, 1] reflecting how much real
 * tool capability is available. Used to escalate follow-ups to v1-agent-loop
 * when the toolset is rich even if the raw task text is short.
 *
 *   - 0.0 → no tools (treated as chat-only)
 *   - 0.4 → 1–3 tools (limited)
 *   - 0.7 → 4–10 tools, or 1+ write capability
 *   - 1.0 → 10+ tools with mix of read + write
 */
function computeToolingRichness(
  externalTools: ReadonlyArray<{ name?: string }>,
): number {
  const names = externalTools
    .map((t) => (t && typeof t.name === 'string' ? t.name.toLowerCase() : ''))
    .filter(Boolean);
  const count = names.length;
  if (count === 0) return 0;

  const WRITE_HINT = [
    'write', 'edit', 'apply_diff', 'str_replace', 'replace_in_file',
    'delete', 'batch_write', 'write_files', 'bash', 'shell', 'terminal',
    'execute', 'sandbox_execute', 'sandbox_shell', 'mcp_tool', 'mcp_execute',
  ];
  const READ_HINT = [
    'read', 'list', 'search', 'grep', 'glob', 'find', 'web_search', 'web_fetch',
  ];
  const hasWrite = names.some((n) => WRITE_HINT.some((h) => n.includes(h)));
  const hasRead = names.some((n) => READ_HINT.some((h) => n.includes(h)));

  if (count >= 10 && hasWrite && hasRead) return 1.0;
  if (count >= 10) return 0.85;
  if (count >= 4) return 0.7;
  if (count >= 1 && hasWrite) return 0.6;
  if (count >= 1) return 0.4;
  return 0.2;
}

/**
 * Classify an auto-mode request into one of the two v1 execution paths.
 *
 * Replaces the prior length+keyword "isSimpleChat" heuristic, which had two
 * structural flaws:
 *   1. It classified `config.userMessage`, which the route augments with
 *      workspace/memory/system context before the real "TASK:\n..." block. That
 *      pushed almost every request past the length threshold and tripped the
 *      keyword regex, so nearly everything defaulted to the orchestrator.
 *   2. It treated v1-agent-loop as the "default/higher" mode even though the
 *      PlanActVerify orchestrator has *weaker* provider-level fallback than
 *      runV1ApiWithTools (no circuit-breaker rotation, rate-limit skip, 413
 *      guard, or self-heal retry). A 2-char "hi" got the resilient path while a
 *      longer prompt got the less-resilient one.
 *
 * Design:
 *   - Classify the RAW user task via extractRawUserTask().
 *   - The orchestrator only adds value when it can actually drive tools across
 *     multiple steps. It executes tools via createCapabilityToolExecutor, so it
 *     only needs `config.tools` populated (config.executeTool is supplied
 *     internally). 'choose_role' is a built-in routing tool and does not count
 *     as real agentic capability.
 *   - Be conservative: only pick v1-agent-loop on genuine agentic / multi-step
 *     intent over real code/workspace. When in doubt, prefer the more resilient
 *     v1-api path.
 */
export function classifyV1Route(config: UnifiedAgentConfig): V1RouteDecision {
  const rawTask = extractRawUserTask(config.userMessage || '').trim();

  // Count ALL tools including choose_role — it is a real routing tool with
  // a dedicated handler in the orchestrator (registered at line ~2989).
  // Excluding it meant agentic tasks that only had choose_role available
  // were always routed to the less-resilient v1-api path.
  const externalTools = (config.tools || []).filter(
    (t: any) => t?.name
  );
  const hasExternalTools = externalTools.length > 0;

  const contextual = deriveContextualSignals(config.conversationHistory, config.userMessage);
  const toolingRichness = computeToolingRichness(externalTools);

  const signals = {
    rawLength: rawTask.length,
    hasExternalTools,
    toolCount: externalTools.length,
    toolingRichness,
    hasCodeFence: /```|~~~/.test(rawTask),
    hasFilePath:
      /[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|cpp|h|json|md|css|scss|html|yml|yaml|sql|sh|toml|env)\b/i.test(
        rawTask
      ),
    hasWorkspaceNoun:
      /\b(file|files|folder|directory|repo|repository|workspace|project|module|service|api|component|page|dashboard|route|endpoint|database|schema|migration|test|tests|build|deploy)\b/i.test(
        rawTask
      ),
    hasMutationVerb:
      /\b(create|build|implement|refactor|add|change|update|write|edit|make|install|setup|configure|deploy|migrate|scaffold|generate|init|initialize|rename|delete|remove|wire|integrate)\b/i.test(
        rawTask
      ),
    hasMultiStep:
      /(\band then\b|\bafter that\b|\bafterwards\b|\bfirst\b.*\bthen\b|\bnext\b|\bfinally\b|step\s*\d|^\s*\d+[.)])/im.test(
        rawTask
      ),
    hasDiagnosticVerb:
      /\b(fix|debug|investigate|diagnose|trace|resolve|repair|troubleshoot)\b/i.test(rawTask),
    hasCodeContext: contextual.hasCodeContext,
    hasErrorContext: contextual.hasErrorContext,
    hasToolResultContext: contextual.hasToolResultContext,
    hasReprompt: contextual.hasReprompt,
  };

  // Without external tools the orchestrator degrades to a plain (less resilient)
  // LLM call — always prefer v1-api.
  if (!hasExternalTools) {
    return { mode: 'v1-api', reason: 'no_external_tools', signals, agenticScore: 0 };
  }

  // Empty task → nothing to orchestrate.
  if (signals.rawLength === 0) {
    return { mode: 'v1-api', reason: 'empty_task', signals, agenticScore: 0 };
  }

  // Strong agentic intent: a mutation/diagnostic over real code/workspace, or an
  // explicit multi-step plan touching files/workspace. Bare verbs like "write a
  // poem" or "fix this sentence" lack the code/workspace signal and stay v1-api.
  const stronglyAgentic =
    (signals.hasMutationVerb &&
      (signals.hasFilePath || signals.hasWorkspaceNoun || signals.hasCodeFence)) ||
    (signals.hasMultiStep && (signals.hasFilePath || signals.hasWorkspaceNoun)) ||
    (signals.hasDiagnosticVerb && (signals.hasWorkspaceNoun || signals.hasFilePath));

  // Contextual escalation: a follow-up in a code/error/tool/steer context with
  // a rich toolset MUST NOT be permanently demoted. The previous classifier
  // (Bug #9/#32) keyed off `rawLength` alone and dropped a 55-char follow-up
  // into v1-api even when 18 tools and an error context were present, breaking
  // the user-perceived "v1-api every time" bug.
  //
  // We compute a continuous agentic score in [0, 1] so telemetry can compare
  // runs and the boundary doesn't become brittle. Thresholds are env-tunable
  // so production can tighten/loosen without a code change.
  //
  // NOTE: `agenticScore` is currently telemetry-only — the decision is
  // still driven by the explicit rules below, not by a single score
  // threshold. Keep this in mind before wiring it in: a single threshold
  // creates a brittle knob that re-introduces the kind of over-escalation
  // this classifier was patched to avoid.
  const RICH_TOOLING_THRESHOLD = Number.parseFloat(
    process.env.AGENT_CLASSIFIER_RICH_TOOLING_THRESHOLD ?? '0.6',
  );
  const AGENTIC_VERB_THRESHOLD = Number.parseFloat(
    process.env.AGENT_CLASSIFIER_AGENTIC_VERB_THRESHOLD ?? '0.25',
  );

  const contextualBoost =
    (contextual.hasCodeContext ? 0.25 : 0) +
    (contextual.hasErrorContext ? 0.2 : 0) +
    (contextual.hasToolResultContext ? 0.15 : 0) +
    (contextual.hasReprompt ? 0.1 : 0);
  const rawTextScore =
    (signals.hasMutationVerb ? 0.25 : 0) +
    (signals.hasDiagnosticVerb ? 0.2 : 0) +
    (signals.hasMultiStep ? 0.2 : 0) +
    (signals.hasFilePath ? 0.2 : 0) +
    (signals.hasWorkspaceNoun ? 0.15 : 0) +
    (signals.hasCodeFence ? 0.15 : 0);
  const toolingComponent = toolingRichness * 0.3; // 0–0.3
  const agenticScore = Math.min(
    1,
    rawTextScore + contextualBoost + toolingComponent,
  );

  if (stronglyAgentic) {
    return {
      mode: 'v1-agent-loop',
      reason: 'agentic_task_with_tools',
      signals,
      agenticScore,
    };
  }

  // Escalation order rationale: rule (b) "contextual follow-up + rich tooling"
  // is checked BEFORE rule (c) "rich tooling + any agentic verb" because a
  // follow-up with grounded context is a stronger escalation signal than a
  // bare verb. If both happen to match (rare), the more specific reasoning is
  // preferred for telemetry.
  //
  // BUG FIX: Add brevity check to avoid routing short follow-ups (e.g., "ok", "yes")
  // to expensive v1-agent-loop orchestration. Messages under 10 chars without
  // multi-step intent should use lightweight v1-api path even with rich tooling.
  const isBriefFollowup =
    signals.rawLength < 10 &&
    !signals.hasMultiStep &&
    !signals.hasMutationVerb &&
    !signals.hasDiagnosticVerb;

  if (!isBriefFollowup && contextualBoost > 0 && toolingRichness >= RICH_TOOLING_THRESHOLD) {
    return {
      mode: 'v1-agent-loop',
      reason: 'contextual_followup_with_rich_tooling',
      signals,
      agenticScore,
    };
  }

  // Soft escalation: if tooling is rich AND the raw task mentions any
  // agentic indicator (mutation/diagnostic/multi-step), prefer the orchestrator
  // even without code/workspace nouns. This catches terse commands like
  // "rename that file" sent after a workspace listing.
  if (toolingRichness >= RICH_TOOLING_THRESHOLD + 0.1 && rawTextScore >= AGENTIC_VERB_THRESHOLD) {
    return {
      mode: 'v1-agent-loop',
      reason: 'rich_tooling_with_agentic_verb',
      signals,
      agenticScore,
    };
  }

  return { mode: 'v1-api', reason: 'not_agentic_enough', signals, agenticScore };
}

/**
 * Hoisted from the chat-route layer (route.ts:1668-L1669). Emits one
 * `[AGENT-SERVICE] processUnifiedAgentRequest returned` INFO line per outer
 * return of `processUnifiedAgentRequest`, so an audit of the response shape
 * is visible regardless of which sub-mode (v1-api / v2-native / stateful-
 * agent / OpenCode SDK / V1 agent loop) returned or whether the route layer
 * was bypassed (e.g. when an upstream caller invokes the service directly).
 *
 * Side-effect note: when the orchestrator's fallback chain cascades (Phase 1
 * fails → Phase 2 text-mode fallback), this helper fires TWICE for the same
 * outer request — once for the failed step's shape, once for the rescued
 * step's shape. This is intentional: each cadence surfaces what the
 * failing step actually returned so operators can see whether the failure
 * was a shape drift (ContentPart array, `{role, parts, content}` object,
 * StreamingResponse chunk) vs. an empty/error path.
 */
function auditResponseShape(
  result: UnifiedAgentResult,
  // Finding #5 — REQUIRED outcome discriminator. The audit's response shape
  // pair (responseType + responseShapeKey + responseLen) was overloaded as
  // "returned" for both success and failure paths, which made the
  // ALL_FALLBACKS_EXHAUSTED → processUnifiedAgentRequest returned conflation
  // ambiguous. The previous (optional) design let a missed call site silently
  // default to 'success', masking failures as healthy returns. The union is
  // exhaustive of the 5 emit sites; if you add a new resolve path, add its
  // outcome label here too AND wire it through every emit site — tsc prevents
  // silent omission.
  meta: {
    provider?: string;
    model?: string;
    mode?: string;
    outcome:
      | 'success'
      | 'exhausted'
      | 'error'
      | 'degraded'
      | 'phase2-fallback'
      | 'modal-success';
  },
): void {
  // Use the file-local `log` (from createLogger('UnifiedAgentService')) —
  // `agentLog` is also imported but not used for INFO calls anywhere else
  // in this file, so adopting `log` keeps the audit sink-aligned with the
  // 100+ existing `log.info(...)` call sites in this file's other paths.
  log.info('[AGENT-SERVICE] processUnifiedAgentRequest returned', {
    provider: meta.provider ?? (result.metadata?.provider as string | undefined),
    model: meta.model ?? (result.metadata?.model as string | undefined),
    mode: meta.mode ?? result.mode,
    responseType: typeof result.response,
    responseShapeKey: shapeKeyOf(result.response),
    responseLen: serializableTextLength(result.response),
    outcome: meta.outcome,
  });
}

/**
 * Unified agent request processor
 *
 * Routes to OpenCode V2 Engine (primary) or V1 API (fallback) based on configuration.
 * Implements fallback chain for reliability.
 * Defaults to PlanActVerify orchestrator with dynamic injector always active.
 */
export async function processUnifiedAgentRequest(
  config: UnifiedAgentConfig
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  // Auto-inject core powers as a separate USER message (preserves prompt caching)
  // Only ubiquitous, always-beneficial powers (e.g. web search) are injected proactively.
  // All other powers are discovered on-demand via power_list/power_read tools.
  // Applied at entry point so ALL execution modes benefit.
  //
  // For modes that use config.conversationHistory (V1-API paths), we inject into it.
  // For modes that don't (OpenCodeEngine, StatefulAgent, Mastra), we attach the
  // auto-inject text to config._autoInjectContext so mode handlers can use it.
  let autoInjectContext = '';
  try {
    const { appendAutoInjectPowers, buildAutoInjectUserMessage } = await import('@/lib/powers');
    // NEW-1 followup-d at `lib/orchestra/unified-agent-service.ts` (auto-inject site, L1493);
    // first production caller of the prompt-orchestrator foundation. applyScript wraps
    // userMsg before it fans out to BOTH the V1-API path (appendAutoInjectPowers) AND
    // non-history modes (buildAutoInjectUserMessage for OpenCodeEngine / StatefulAgent / Mastra).
    // Structural first-caller: empty PO_DEFAULT_SCRIPT.steps means the inject path doesn't
    // fire (only scan + idempotency run). To unlock Tier 8 step 4 (round-trip writes) +
    // step 8 (observability) on real production data, a follow-up apply must add a step
    // to PO_DEFAULT_SCRIPT (or switch to loadScript for a disk-stored script). Inside the
    // existing try/catch — a prompt-orchestrator throw fails the same way as a powers throw.
    const userMsg = observeApplyScript(config.userMessage || '', PO_UNIFIED_AGENT_SCRIPT, 'unified-agent');

    // Always ensure conversationHistory exists so V1-API paths get injection
    if (!config.conversationHistory) {
      config.conversationHistory = [];
    }
    appendAutoInjectPowers(config.conversationHistory, userMsg);

    // Also build the raw text for modes that don't use conversationHistory
    autoInjectContext = buildAutoInjectUserMessage(userMsg) || '';
  } catch (err: any) {
    log.debug('Auto-inject powers / prompt script skipped at entry point', { error: err?.message });
  }

  // Bug #67 (Pass-5 audit) — qd/lite pre-validation. The audit observed
  // recurring 400 errors with `model_config for "lite" not yet known`
  // caused by the LLM emitting a bare model name. Pre-validate the model
  // against the ninerouter registry BEFORE calling the provider so the
  // chat route can surface a typed 400 (with available models) and the
  // LLM can self-correct on the next turn.
  //
  // Throws `InvalidModelError` (a typed Error class from steer-service.ts)
  // — the chat route's catch distinguishes via `instanceof` and returns
  // HTTP 400 with `availableModels`. Without this, the route's generic
  // catch returns 500 + the raw error message, which contradicts the
  // audit's "typed 400 with available models" ask.
  const requestedModel = (config.model || '').toString().toLowerCase();
  const requestedProvider = (config.provider || '').toString();
  if (requestedModel === 'lite' || requestedModel === 'qd/lite' || requestedModel === 'qd_lite' || requestedModel === 'qd') {
    const liteAvailable = ['qd/auto', 'qd/ultimate', 'qd/performance', 'qd/lite', 'qd/dmodel', 'qd/gm51model', 'qd/mmodel', 'qd/efficient'];
    log.warn('[Pre-validate] bare qd/lite model name rejected (Bug #67)', {
      requestedModel,
      requestedProvider,
      availableModels: liteAvailable,
    });
    try {
      // Record the rejection so /api/health?detailed can quantify how
      // often the LLM emits bare model names. fire-and-forget; never throws.
      const { recordFallbackChainAttempt } = await import('@/lib/chat/chat-metrics');
      recordFallbackChainAttempt({
        provider: requestedProvider || 'ninerouter',
        model: requestedModel,
        outcome: 'failure',
        reason: 'invalid_model_name',
      });
    } catch { /* best-effort */ }
    throw new InvalidModelError({
      model: config.model || requestedModel,
      provider: requestedProvider || 'ninerouter',
      availableModels: liteAvailable,
    });
  }

  // Pass-5 #62 — inject the canonical session-scope path so the LLM
  // never has to guess. The hint tells the model the exact 'workspace/sessions/<id>/'
  // prefix it should keep paths UNDER (without including the prefix in its
  // own path arguments — the router prepends it). The helper returns null
  // for plain anon ownerIds (no $ delimiter) and for empty/missing ownerId,
  // so non-session owners stay silent without a try/catch.
  const ownerId = ((config as any).ownerId as string | undefined) ?? '';
  const sessionScopeHint = ownerId
    ? buildSessionScopeSteerPrompt({
        ownerId,
        scopePath: (config as any).scopePath,
      })
    : null;
  if (sessionScopeHint) {
    autoInjectContext = autoInjectContext
      ? `${autoInjectContext}\n\n${sessionScopeHint}`
      : sessionScopeHint;
  }

  // Bug #39: pre-flight env probe (which npx python3 node npm pnpm ...). Run
  // ONCE per request and append to the auto-inject context so every mode
  // (v1-api, v2-native, desktop, OpenCode SDK, Mastra, progressive build) sees
  // the same Available Binaries list in its system prompt. The LLM uses this
  // to avoid reaching for `npx` / `python3` when they aren't on $PATH. Failures
  // are swallowed (the env probe is best-effort — the bash tool also embeds
  // the probe result in its ENOENT error message as a fallback).
  let envProbeSuffix = '';
  try {
    // Bug-fix #4: 3s hard ceiling — the per-binary `PROBE_TIMEOUT_MS` inside
    // `probeAvailableBinaries` is 1.5s, but on a pathological PATH/kernel delay
    // the cumulative `Promise.all` of ~37 `which` calls + child_process spawn
    // overhead can stall. Race against a fallback so the chat route proceeds
    // even if the env probe never settles.
    envProbeSuffix = await withTimeoutFallback(
      formatAvailableBinariesAsync(),
      3_000,
      '',
      'formatAvailableBinariesAsync',
    );
  } catch (err: any) {
    log.debug('Env probe skipped at entry point (non-fatal)', { error: err?.message });
  }
  if (envProbeSuffix) {
    autoInjectContext = autoInjectContext
      ? `${autoInjectContext}\n\n${envProbeSuffix}`
      : envProbeSuffix;
  }

  // Stash auto-inject context for mode handlers that don't use conversationHistory
  // (OpenCodeEngine, StatefulAgent, Mastra). They can append this to their
  // system prompt or user message as appropriate.
  config._autoInjectContext = autoInjectContext;
  if (autoInjectContext) {
    log.debug('[Context-Inject] Auto-inject context stashed', { 
      contextLength: autoInjectContext.length,
      preview: autoInjectContext.slice(0, 100) + '...'
    });
  }

  // Inject re-context supplement for unfinished tasks (periodic reminders)
  // Only inject if not too many messages already (avoid bloating the context)
  try {
    if (config.conversationHistory && config.conversationHistory.length < 20) {
      const recontextSupplement = getRecontextSupplement({ limit: 3 });
      if (recontextSupplement) {
        // Add as a system message so the agent knows about pending tasks
        config.conversationHistory.unshift({
          role: 'system',
          content:
            '## Pending Tasks Reminder\n\n' +
            recontextSupplement +
            '\n\n---\nConsider these pending tasks while working. ' +
            'You can use task.list, task.getUnfinished, or task.edit to manage them.',
        });
      }
    }
  } catch (err: any) {
    log.debug('Re-context injection skipped', { error: err?.message });
  }

  log.info('═══════════════════════════════════════════════');
  log.info('[UnifiedAgent] ┌─ REQUEST ENTRY ──────────────────────────');
  // Win #2 (docs/async-parallelization-opportunities.md): Promise.all the two
  // independent REQUEST-ENTRY setup ops. `resolveDynamicDefaults` only reads
  // env vars + the 30s dynamic-defaults cache; `determineMode` only reads
  // config + startupCaps + (lazily) execution-engines. Neither mutates state
  // the other reads, so unblocking both halves the REQUEST-ENTRY latency
  // (~50-100ms per request — the dominant cost is a dynamic import
  // `await import('../providers/model-ranker')` inside resolveDynamicDefaults
  // and the synchronous classifier scoring inside classifyV1Route).
  //
  // Bug-fix #4: race EACH Promise.all entry against a 2.5s budget. A stuck
  // dynamic import (Turbopack cold compile / sqlite lock / circuit-breaker
  // module dep hang) used to block the entire /api/chat route indefinitely.
  // The fallback for `resolveDynamicDefaults` matches the in-function defaults
  // for env-only resolution; the fallback for `determineMode` is the safest
  // single-mode path (`v1-api`) — strictly more resilient than `v1-agent-loop`
  // because it goes through `streamWithConcurrentFallback` / `streamWithVercelAI`
  // which carry the route-level stall watchdog. The Promise.all context is
  // otherwise unchanged.
  const envProvider = process.env.LLM_PROVIDER || 'mistral';
  const envModel = process.env.DEFAULT_MODEL || 'mistral-large-latest';
  // Surface `config.engine` in the warn log when the caller set it, so a
  // timeout-induced fallback to `v1-api` doesn't silently swallow the
  // caller's explicit engine choice (Bug-fix #4 reviewer nit #3).
  const determineModeLabel = config.engine
    ? `determineMode[engine=${config.engine}]`
    : 'determineMode';
  const [dynamicDefaults, modeResult] = await Promise.all([
    withTimeoutFallback(
      resolveDynamicDefaults(),
      2_500,
      { provider: envProvider, model: envModel },
      'resolveDynamicDefaults',
    ),
    withTimeoutFallback(
      determineMode(config),
      2_500,
      // `as const` preserves the literal-union narrowing so TS treats this
      // fallback as `{mode: 'v1-api' | 'v1-agent-loop' | ...}`-compatible
      // rather than widening `mode` to `string`. Mirrors the existing
      // `mode: 'v1-api' as const` pattern elsewhere in this file.
      { mode: 'v1-api' as const },
      determineModeLabel,
    ),
  ]);
  const { mode } = modeResult;

  log.info('[UnifiedAgent] │ provider:', config.provider || dynamicDefaults.provider);
  log.info('[UnifiedAgent] │ model:', config.model || dynamicDefaults.model);
  log.info('[UnifiedAgent] │ mode config:', config.mode || 'auto');
  log.info('[UnifiedAgent] │ AGENT_EXECUTION_ENGINE:', process.env.AGENT_EXECUTION_ENGINE || 'auto');
  log.info('[UnifiedAgent] │ DISABLE_V2_MODE:', process.env.DISABLE_V2_MODE || 'unset');
  log.info('[UnifiedAgent] │ messageLength:', (config.userMessage || '').length);
  log.info('[UnifiedAgent] │ tools:', Array.isArray(config.tools) ? config.tools.length : 0);
  if (Array.isArray(config.tools) && config.tools.length > 0) {
    log.info('[UnifiedAgent-DEBUG] Tools ARE present:', { count: config.tools.length, names: config.tools.map(t => (t as any).name).slice(0, 5) });
  } else {
    log.info('[UnifiedAgent-DEBUG] Tools MISSING from config. keys count:', Object.keys(config).length);
  if ((config as any).tools !== undefined) log.info('[UnifiedAgent-DEBUG] tools key EXISTS but count is 0 or not array');
  if ((config as any).tools === undefined) log.info('[UnifiedAgent-DEBUG] tools key is UNDEFINED');
  if (config.conversationId) log.info('[UnifiedAgent-DEBUG] conversationId:', config.conversationId);
  }
  log.info('[UnifiedAgent] └──────────────────────────────────────────');

  log.info('[F6] resolved mode vs startupCaps state', { resolvedMode: mode, desktopCap: startupCaps.desktop, opencodeSdkCap: startupCaps.opencodeSdk, v2NativeCap: startupCaps.v2Native, v2ContainerizedCap: startupCaps.v2Containerized, v2LocalCap: startupCaps.v2Local, v1ApiCap: startupCaps.v1Api, statefulAgentCap: startupCaps.statefulAgent, mastraWorkflowsCap: startupCaps.mastraWorkflows });

  // F6 deepening: when the resolved mode's required cap is FALSE, record
  // a synthetic tool-call into toolCallTracker so the Rec #3 telemetry
  // surface (`toolCallTracker.hasRecordedTools()`) returns true after
  // this request. The `toolName` encodes `mode` and `missingCap` (since
  // ToolCallRecord has no `args` field) and is prefixed `system.` so
  // dashboards can filter audit events out via
  // `WHERE tool_name NOT LIKE 'system.%'`. Fire-and-forget — we don't
  // block dispatch on a SQLite write.
  {
    // F6 deepening (DRY version): single source of truth via modeToCapFlag.
    const _f6MissingCap = modeToCapFlag(mode);
    if (_f6MissingCap !== null && startupCaps[_f6MissingCap] !== true) {
      void toolCallTracker.recordToolCall({
        toolCallId: `cap-bypass-${(config.conversationId || 'anon')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolName: `system.capability-bypass[mode=${mode},missingCap=${_f6MissingCap}]`,
        model: config.model || dynamicDefaults.model || 'unknown',
        provider: config.provider || dynamicDefaults.provider || 'unknown',
        success: true,  // mode DID succeed despite cap being false — that IS the bypass
        timestamp: Date.now(),
        conversationId: config.conversationId,
      }).catch((err) => {
        log.warn('[F6] toolCallTracker.recordToolCall failed for bypass event', {
          error: (err as Error)?.message,
          resolvedMode: mode,
          missingCap: _f6MissingCap,
        });
      });
    }
  }
log.info('[UnifiedAgent] ┌─ MODE SELECTED ──────────────────────────');
  log.info('[UnifiedAgent] │ resolvedMode:', mode);
  log.info('[UnifiedAgent] │ engine:', process.env.AGENT_EXECUTION_ENGINE || 'auto');
  log.info('[UnifiedAgent] │ disableV2:', process.env.DISABLE_V2_MODE !== 'false');
  log.info('[UnifiedAgent] └──────────────────────────────────────────');

  // Verify mode is v1-only when in auto mode
  const v1Modes = ['v1-api', 'v1-agent-loop', 'v1-progressive-build'];
  if (process.env.AGENT_EXECUTION_ENGINE === 'auto' && !v1Modes.includes(mode)) {
    log.error('[BUG] Auto mode selected non-v1 mode!', {
      mode,
      engine: process.env.AGENT_EXECUTION_ENGINE,
      disableV2: process.env.DISABLE_V2_MODE !== 'false',
    });
  }

  // ── Modal Offload Check ────────────────────────────────────────
  // If Modal is configured and the task qualifies, offload to Modal's
  // serverless infrastructure instead of running locally.
  //
  // Modal is best suited for:
  //   - Complex tasks that would strain OCI backend resources
  //   - Tasks requiring GPU inference (image gen, large models)
  //   - Heavy sandbox code execution
  //   - Tasks with large context windows (many conversation turns)
  //
  // If Modal is unavailable or fails, we fall through to normal execution.
  const _modalProvider = config.provider || dynamicDefaults.provider;
  const _modalContextSize = JSON.stringify({
    msg: config.userMessage,
    history: config.conversationHistory,
    tools: config.tools,
  }).length;

  // Determine Modal eligibility:
  // 1. Complex modes (v2-native, opencode-sdk) with large context (>50KB)
  // 2. GPU-requiring tasks (image gen models)
  // 3. Heavy execution contexts (many conversation turns)
  const _modalEligible =
    (mode === 'v2-native' || mode === 'opencode-sdk') &&
    _modalContextSize > 50_000;

  const modalClient = _modalEligible
    ? maybeUseModal({
        provider: _modalProvider,
        requiresGpu: (config.model || '').includes('image') || (config.model || '').includes('diffusion'),
        taskComplexity: mode === 'v2-native' || mode === 'opencode-sdk' ? 'complex' : 'moderate',
        model: config.model,
      })
    : null;

  if (modalClient) {
    log.info('[UnifiedAgent] ⚡ OFFLOADING TO MODAL ──────────────────');
    log.info('[UnifiedAgent] │ contextSize: ' + _modalContextSize + ' bytes');
    log.info('[UnifiedAgent] │ modalProvider: ' + _modalProvider);
    log.info('[UnifiedAgent] │ model: ' + (config.model || dynamicDefaults.model));
    log.info('[UnifiedAgent] └──────────────────────────────────────────');

    try {
      const modalResult = await modalClient.executeAgent({
        userMessage: config.userMessage,
        conversationId: config.conversationId || `modal-${Date.now()}`,
        userId: config.userId || 'system',
        systemPrompt: config.systemPrompt,
        model: config.model || dynamicDefaults.model,
        provider: _modalProvider,
        temperature: config.temperature,
        maxTokens: config.maxTokens || 4096,
        tools: (config.tools || []).map(t => ({
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || {},
        })),
        conversationHistory: (config.conversationHistory || []).map(msg => ({
          role: msg.role || 'user',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        })),
      });

      if (modalResult.success) {
        const duration = Date.now() - startTime;
        log.info('[UnifiedAgent] ✅ MODAL EXECUTION SUCCEEDED', {
          durationMs: modalResult.durationMs,
          totalDuration: duration,
          responseLength: modalResult.response.length,
          model: modalResult.model,
          provider: modalResult.provider,
          tokensUsed: modalResult.tokensUsed,
        });

        const modalReturn: UnifiedAgentResult = {
          success: true,
          // Defense-in-depth: stringifyMessageContent enforces the
          // `UnifiedAgentResult.response: string` contract. ModalClient.executeAgent
          // ALSO applies this coercion at the wire layer (lib/modal/modal-client.ts:97),
          // but a future call site (no-modal path that constructs modalResult directly)
          // could regress the runtime shape — surface it from the service layer too.
          response: stringifyMessageContent(modalResult.response),
          mode: 'v1-api',
          metadata: {
            provider: 'modal',
            model: modalResult.model,
            duration,
            modalDurationMs: modalResult.durationMs,
            tokensUsed: modalResult.tokensUsed,
            offloadedToModal: true,
            modalEndpoint: 'executeAgent',
          },
        };
        auditResponseShape(modalReturn, { provider: 'modal', model: modalResult.model, mode: 'v1-api', outcome: 'modal-success' });
        return modalReturn;
      } else {
        log.warn('[UnifiedAgent] ⚠️ Modal returned failure, falling back', {
          error: modalResult.error,
        });
      }
    } catch (modalErr: any) {
      log.warn('[UnifiedAgent] ⚠️ Modal call failed, falling back to normal execution', {
        error: modalErr.message,
      });
    }
  }

  try {
    log.info('[UnifiedAgent] ┌─ EXECUTING MODE ───────────────────────');
    log.info('[UnifiedAgent] │ switching on:', mode);
    log.info('[UnifiedAgent] └──────────────────────────────────────────');

    const executeInMode = async (targetMode: string): Promise<UnifiedAgentResult> => {
      switch (targetMode) {
        case 'desktop':
          log.info('[UnifiedAgent] → desktop mode');
          return await runDesktopMode(config);

        case 'v1-agent-loop': {
          log.info('[UnifiedAgent] → v1-agent-loop mode (PlanActVerify orchestrator)');
          // Filter system and tool messages from conversationHistory:
          //   - System messages belong in the `system` option of generateText/streamText,
          //     NOT in the messages array. Passing them via messages[] triggers AI SDK
          //     ModelMessage[] schema validation errors in PlanActVerify.callLLM.
          //   - Tool messages must have array content [{ type: 'tool-result', ... }] per
          //     the AI SDK ModelMessage[] schema. The route (route.ts:1130) stringifies
          //     non-string content as JSON, producing string-content tool messages that
          //     fail schema validation with "Invalid prompt" errors.
          //     PlanActVerify rebuilds its own conversation history with fresh tool
          //     results, so stale tool messages from prior executions add no value.
          //
          // Extract system message content into config.systemPrompt so the orchestrator
          // receives workspace context, memory, and role prompt through the `system`
          // parameter rather than as system-role messages in the array.
          const rawHistoryForOrch = config.conversationHistory || [];
          const orchSystemParts: string[] = [];
          const orchNonSystem: any[] = [];
          for (const msg of rawHistoryForOrch) {
            if (msg.role === 'system') {
              const text = typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content || '');
              orchSystemParts.push(text);
            } else if (msg.role !== 'tool') {
              orchNonSystem.push(msg);
            }
          }
          // NOTE: System messages are intentionally discarded here — not
          // passed to runV1Orchestrated. The PlanActVerifyOrchestrator
          // does not accept a separate system-prompt parameter; it receives
          // all context through the messages array. System-role messages
          // cannot be included there because they trigger Vercel AI SDK
          // ModelMessage[] schema validation errors inside callLLM.
          //
          // On the fallback path (Phase 2 → runV1Api), system messages
          // are re-extracted from config.conversationHistory and merged
          // into the `system` parameter of generateText/streamText, where
          // the AI SDK accepts them.
          const orchMessages = [
            ...orchNonSystem,
            { role: 'user', content: config.userMessage },
          ];
          return await runV1Orchestrated(config, orchMessages, startTime);
        }

        case 'v2-native':
          log.warn('[UnifiedAgent] → v2-native mode (OPENCODE)');
          return await runV2Native(config);

        case 'v2-containerized':
          log.warn('[UnifiedAgent] → v2-containerized mode (SANDBOX)');
          return await runV2Containerized(config);

        case 'v2-local':
          log.warn('[UnifiedAgent] → v2-local mode (LOCAL OPENCODE)');
          return await runV2Local(config);

        case 'opencode-sdk':
          log.info('[UnifiedAgent] → opencode-sdk mode (OpenCode HTTP API)');
          return await runOpencodeSDKMode(config);

        case 'mastra-workflow':
          log.info('[UnifiedAgent] → mastra-workflow mode');
          return await runMastraWorkflow(config);

        case 'v1-progressive-build':
          log.info('[UnifiedAgent] → v1-progressive-build mode (multi-iteration build loop)');
          return await runProgressiveBuildMode(config);

        case 'dual-process':
          log.info('[UnifiedAgent] → dual-process mode (fast/slow cognition split)');
          return await runDualProcessMode(config, config.dualProcessConfig);

        case 'adversarial-verify':
          log.info('[UnifiedAgent] → adversarial-verify mode (counterfactual critics)');
          return await runAdversarialVerifyMode(config, config.adversarialConfig);

        case 'attractor-driven':
          log.info('[UnifiedAgent] → attractor-driven mode (goal-convergent iteration)');
          return await runAttractorDrivenMode(config, config.attractorConfig);

        case 'intent-driven':
          log.info('[UnifiedAgent] → intent-driven mode (latent intent field)');
          return await runIntentDrivenMode(config, config.intentConfig);

        case 'energy-driven':
          log.info('[UnifiedAgent] → energy-driven mode (unified objective function)');
          return await runEnergyDrivenMode(config, config.energyConfig);

        case 'distributed-cognition':
          log.info('[UnifiedAgent] → distributed-cognition mode (multi-model roles)');
          return await runDistributedCognitionMode(config, config.distributedConfig);

        case 'cognitive-resonance':
          log.info('[UnifiedAgent] → cognitive-resonance mode (independent agreement)');
          return await runCognitiveResonanceMode(config, config.resonanceConfig);
          
        case 'execution-controller':
          log.info('[UnifiedAgent] → execution-controller mode (self-correcting execution loop)');
          return await runExecutionControllerMode(config, config.executionControllerConfig);

        case 'v1-api':
        default:
          log.info('[UnifiedAgent] → v1-api mode (VERCEL AI SDK)');
          return await runV1Api(config);
      }
    };

    // PHASE 1: Execution with tools (Primary attempt)
    let result = await executeInMode(mode);

    // PHASE 2 Transition: If Phase 1 produced no tool calls and we are in auto mode,
    // fallback to a text-mode completion to provide a more helpful response.
    const isAutoMode = !config.mode || config.mode === 'auto';
    const roleSelection = result.metadata?.roleSelection;

  // Bug fix (was silently falling back to '000'): `config.conversationId` and
  // `config.sessionId` can be set to the literal string '000' by upstream
  // VFS scope normalization (`composite-session-id.ts:115:
  //   if (!input || !input.trim()) return '000';`) when the orphan-session
  // placeholder propagates. Without this guard, '000' flows through to
  // `decideAutoContinue`'s per-requestId counter and creates a second
  // counter bucket alongside the route.ts streaming loop's real chat id,
  // breaking the MAX_CONTINUATIONS=3 cap coordination across the two call
  // paths (worst case: 6 LLM calls per request). Refuse '000' and fall
  // through to a process-unique synthetic id (UUID suffix prevents same-ms
  // collisions across concurrent /api/chat bursts -- the prior
  // `Date.now()`-only id collided across fan-out producers in the same
  // millisecond and let unrelated requests share a counter bucket,
  // defeating the per-request INVARIANT). The inline `Date.now()`-only
  // fallback was promoted to the shared helper `buildSyntheticPhaseTransitionRequestId`
  // in `web/lib/chat/auto-continue-helper.ts` so production callers and the
  // R7 regression test share the same source-of-truth function. A future DRY
  // revert that drops the UUID suffix in the helper fails the regression test
  // immediately -- the test calls `buildSyntheticPhaseTransitionRequestId`
  // directly with a pinned `now` and asserts distinct returned strings.
  const phaseTransitionRequestId =
    (config.conversationId && config.conversationId !== '000')
      ? config.conversationId
      : (config.sessionId && config.sessionId !== '000')
        ? config.sessionId
        : buildSyntheticPhaseTransitionRequestId();
  const autoDecision = decideAutoContinue({
    requestId: phaseTransitionRequestId,
    routing: roleSelection
      ? { continue: roleSelection.continue,
          primaryRole: roleSelection.suggestedRole }
      : undefined,
    steps: (result.steps ?? []).map((s) => ({
      toolName: s.toolName,
      args: s.args,
    })),
    responseText: result.response ?? '',
    // ARCH-001 Flag 1 (Pickup): `UnifiedAgentResult` now subsumes
    // `AutoContinueResultData` — the 3 helper-derived fields
    // (`errors`/`toolFailures`/`incompleteSignals`) are optional on both
    // shapes. The boundary cast is gone; `decideAutoContinue` calls
    // `_enrichResultData(result, steps, responseText)` BEFORE invoking the
    // detectors, which guarantees the fields are populated at the call site
    // even when the caller left them undefined. Mirror of route.ts:1701.
    result,
  });
  clearContinuationCount(phaseTransitionRequestId);
  if (autoDecision.continue) {
    log.info('\x1b[33m[Auto-Continue]\x1b[0m 🔄 triggered by model', {
      reason: roleSelection?.classification || 'multi-step plan detected',
      suggestedRole: roleSelection?.suggestedRole,
      nextAction: roleSelection?.specializationRoute,
      reasonCode: autoDecision.reason,
    });
  }

    // FIX: Surface orchestrator fatal errors to user before silent Phase 2 transition.
    // PlanActVerify returns success:true even on fatal errors (budgetExhausted, steps.length===0).
    // The user would see a silent text-mode fallback with no indication the orchestrator crashed.
    if (result.metadata?.budgetExhausted && config.onStreamChunk && (mode === 'v1-agent-loop' || mode === 'execution-controller')) {
      try {
        config.onStreamChunk(sseEncode(SSE_EVENT_TYPES.ERROR, {
          error: 'Orchestrator exhausted budget',
          detail: result.error || result.metadata?.orchestratorError || 'Orchestrator failed after max attempts',
          mode: mode,
          timestamp: Date.now(),
        }));
      } catch { /* best effort */ }
    }

    // Guard against double-fallback: runV1Orchestrated may already have cascaded
    // to runV1Api internally (budget exhaustion / orchestration failure / empty
    // content). In that case result.mode/metadata reflect the fallback and we
    // must not run runV1Api a second time.
    const alreadyFellBack =
      result.mode !== mode ||
      result.metadata?.fallbackFrom != null ||
      result.metadata?.fallbackReason != null ||
      result.metadata?.fallbackChain != null;      if (isAutoMode && !alreadyFellBack && result.success && (result.steps?.length ?? 0) === 0 && roleSelection?.continue !== false) {
      log.info('[PhaseTransition] No tools used in Phase 1, entering Phase 2 fallback (text-mode)');

      // For orchestrated modes, retry with text-only fallback
      if (mode === 'v1-agent-loop' || mode === 'execution-controller') {
        const fallbackResult = await runV1Api(config);
        log.info('[UnifiedAgent] Phase 2 fallback (text-mode) completed');
        // Pass-2 cross-cutting theme: record the Phase-2 fallback so the
        // chain shows when the orchestrator gave up and the LLM had to
        // complete the request in text mode. Operators can then
        // distinguish "model succeeded with tools" from "model gave up
        // and we fell back to text".
        try {
          recordDegradation(
            config.conversationId || config.userId || 'default',
            'orchestration_fallback',
            'unified-agent-service',
            { originalMode: mode, fallbackMode: 'v1-api', phase1Result: 'no-tools' },
          );
        } catch { /* best-effort */ }
        const auditedFallback: UnifiedAgentResult = {
          ...fallbackResult,
          metadata: {
            ...fallbackResult.metadata,
            phase1Result: 'no-tools',
            originalMode: mode,
          }
        };
        auditResponseShape(auditedFallback, { provider: config.provider, model: config.model, mode, outcome: 'phase2-fallback' });
        return auditedFallback;
      }
    }

    auditResponseShape(result, { provider: config.provider, model: config.model, mode, outcome: 'success' });
    return result;
  } catch (error) {
    log.error('[UnifiedAgent] ✗ EXECUTION FAILED', {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    // Attempt fallback on error
    const triedModes = new Set<string>([mode]);
    const fallbackResult = await attemptFallback(config, mode, triggerFromError(error, config.provider, mode), triedModes);

    if (fallbackResult) {
      log.info('[UnifiedAgent] ✓ FALLBACK SUCCEEDED', {
        fallbackFrom: mode,
        fallbackTo: fallbackResult.mode,
        fallbackProvider: fallbackResult.metadata?.provider,
        fallbackModel: fallbackResult.metadata?.model,
      });
      // Bug #40: tag the response as `degraded:true` so the UI/route can
      // show a banner and the next-turn LLM sees the [STEER] orchestration_
      // fallback hint. The `fallbackReason` carries the precise failure
      // (budget exhausted, orchestrator crash, all-modes-failed) so the UI
      // can surface a specific banner. We do this on the OUTER fallback
      // path (the one that rescues the request) — the inner attemptFallback
      // already set fallbackReason / fallbackChain metadata.
      const degradedResult = tagResultDegraded({
        ...fallbackResult,
        metadata: {
          ...fallbackResult.metadata,
          fallbackFrom: mode,
        },
      }, {
        fromMode: mode,
        toMode: fallbackResult.mode,
        fallbackReason: fallbackResult.error || `${mode} failed, fell back to ${fallbackResult.mode}`,
        // Use the composite key (filesystemOwnerId + conversationId) when
        // available, matching the chat route's chain key.
        sessionId: config.filesystemOwnerId
          ? `${config.filesystemOwnerId}$${config.conversationId || 'default'}`
          : (config.conversationId || config.userId || 'default'),
      });
      auditResponseShape(degradedResult, {provider: config.provider, model: config.model, mode, outcome: 'degraded'});
      return degradedResult;
    }

    // All modes failed
    // F5 deepening: bind this warning to the outcome discriminator on
    // L2148 so a log-reader can grep '[UnifiedAgent] ✗ ALL FALLBACKS
    // EXHAUSTED' and see the matching 'exhausted' outcome emit.
    // keep in sync: this 'outcome: "exhausted"' literal MUST match the
    // auditResponseShape outcome-union member at the function signature.
    log.error('[UnifiedAgent] ✗ ALL FALLBACKS EXHAUSTED → auditResponseShape(outcome: "exhausted")', {
      triedModes: Array.from(triedModes),
    });
    const allFailedResult: UnifiedAgentResult = {
      success: false,
      response: 'I\'m sorry, I wasn\'t able to process your request. All available AI providers and execution modes were exhausted. This can happen due to API key issues, rate limits, or network problems. Please try again in a moment, or check that your API keys are configured correctly.',
      mode,
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        duration: Date.now() - startTime,
        triedModes: Array.from(triedModes),
        allProvidersFailed: true,
      },
    };
    auditResponseShape(allFailedResult, {provider: config.provider, model: config.model, mode, outcome: 'exhausted'});
    return allFailedResult;
  }
}

/**
 * Bug #40: tag a UnifiedAgentResult as degraded and emit a [STEER] hint
 * for the next turn. Used by the orchestrator fallback path (Phase 2 of
 * runV1Orchestrated) and the outer attemptFallback rescue to mark the
 * response so:
 *   1. The UI can surface a banner (`metadata.degraded === true`).
 *   2. The chat route can prepend the steer to the next user message
 *      (`metadata.nextTurnSteer`).
 *   3. The /api/health?detailed endpoint can count fallbacks per session
 *      (increments `orchestrationFallbackCounts[sessionId]`).
 *
 * The function is pure-functional on the result shape — it does not throw
 * and never mutates the input. The counter increment is fire-and-forget.
 */
export function tagResultDegraded(
  result: UnifiedAgentResult,
  input: {
    fromMode: string;
    toMode: string;
    fallbackReason: string;
    sessionId: string;
    /**
     * Pass-through typed boolean. When the caller has a `budgetExhausted`
     * flag in scope (e.g. `runV1Orchestrated` Phase-2 fallback), prefer
     * passing it explicitly so the steer prompt is accurate. Falls back
     * to substring detection on `fallbackReason` for callers that don't
     * (e.g. the outer attemptFallback rescue, which derives the reason
     * from `error.message`).
     */
    budgetExhausted?: boolean;
  }
): UnifiedAgentResult {
  const { fromMode, toMode, fallbackReason, sessionId } = input;
  if (!fromMode || !toMode) return result;

  // Bug #40: build the [STEER] orchestration_fallback prompt for the next turn.
  // Safe wrapper so a steer-service failure never breaks the response.
  // Prefer the explicit typed boolean; fall back to substring detection
  // when the caller didn't pass one (e.g. outer rescue where the flag
  // is not in scope).
  const budgetExhaustedFlag =
    typeof input.budgetExhausted === 'boolean'
      ? input.budgetExhausted
      : (fallbackReason || '').toLowerCase().includes('budget');
  const nextTurnSteer = safeSteer(() =>
    wireOrchestrationFallbackSteer({
      fromMode,
      toMode,
      fallbackReason: fallbackReason || 'unknown',
      budgetExhausted: budgetExhaustedFlag,
    })
  );

  // Bug #40: increment the per-session counter. The /api/health?detailed
  // endpoint reads this so operators can see how often the orchestrator
  // is degrading to v1-api text-mode. Fire-and-forget; never throws.
  try {
    incrementOrchestrationFallback(sessionId || 'default');
  } catch { /* best-effort */ }
  // Also record in the new chat-metrics module so the cross-process
  // counter (chatMetrics.orchestrationFallbacks) is consistent with the
  // per-session degradation tracker. Both are best-effort.
  try {
    recordChatOrchestrationFallback(fallbackReason || 'unknown');
  } catch { /* best-effort */ }

  return {
    ...result,
    metadata: {
      ...(result.metadata || {}),
      degraded: true,
      fallbackReason: fallbackReason || result.metadata?.fallbackReason || 'unknown',
      nextTurnSteer: nextTurnSteer || result.metadata?.nextTurnSteer,
    },
  };
}

/**
 * Run V2 Native mode - OpenCode CLI as primary agentic engine
 * This is the MAIN mode for agentic tasks with native bash/file ops
 */
async function runV2Native(
  config: UnifiedAgentConfig,
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  log.info('Running V2 Native mode', {
    userMessageLength: (config.userMessage || '').length,
    maxSteps: config.maxSteps,
  });

  // Use regex-based detection for StatefulAgent routing (classifier removed)
  // IMPORTANT: Only test against the raw user task, not the full context-augmented message
  const rawTask = extractRawUserTask(config.userMessage || '');
  const isComplexTask = /(create|build|implement|refactor|migrate|add feature|new file|multiple files|workspace structure|full-stack|application|service|api|component|page|dashboard|authentication|database|integration|deployment|setup|initialize|scaffold|generate|boilerplate)/i.test(rawTask);
  const hasMultipleSteps = /\b(and|then|after|before|first|next|finally|also|plus)\b/i.test(rawTask);
  const mentionsFiles = /\b(file|files|folder|directory|component|page|module|service|api)\b/i.test(rawTask);
  const shouldUseStatefulAgent = isComplexTask || (hasMultipleSteps && mentionsFiles);
  
  log.info('Regex-based task detection for StatefulAgent routing', {
    isComplexTask,
    hasMultipleSteps,
    mentionsFiles,
  });

  if (shouldUseStatefulAgent && startupCaps.statefulAgent) {
    log.info('Complex task detected, using StatefulAgent for Plan-Act-Verify workflow');
    return await runStatefulAgentMode(config);
  }

  log.info('Simple task detected, using OpenCode Engine');

  // Use OpenCode Engine for simpler tasks
  // Prepend auto-inject context to system prompt so the engine knows about
  // proactive powers (web-search, code-search) when triggers match.
  const autoInjectSuffix = config._autoInjectContext ? `\n\n${config._autoInjectContext}` : '';
  const v2NativeModel = resolveV2Model('v2-cli', config.model).model;
  const engineConfig: OpenCodeEngineConfig = {
    model: v2NativeModel,
    systemPrompt: (config.systemPrompt || 'You are an expert software engineer with full bash and file system access. Use tools to complete tasks efficiently.') + autoInjectSuffix,
    maxSteps: config.maxSteps || 20,
    timeout: 300000,
    enableBash: true,
    enableFileOps: true,
    enableCodegen: true,
    onStreamChunk: config.onStreamChunk,
    onToolCall: (tool, args) => {
      config.onToolExecution?.(tool, args, { success: true, output: 'Tool called' });
    },
  };

  const engine = createOpenCodeEngine(engineConfig);
  let result: OpenCodeEngineResult;
  
  try {
    result = await engine.execute(config.userMessage);
    
    if (!result.success) {
      recordFailure('v2-cli', 'opencode-engine', result.error);
      throw new StallWatchdogError(result.error || 'OpenCode engine failed', { errorCode: 'OTHER' });
    }
    
    recordSuccess('v2-cli', 'opencode-engine');
  } catch (err) {
    recordFailure('v2-cli', 'opencode-engine', err instanceof Error ? err.message : undefined);
    throw err;
  }

  // Convert OpenCode result to unified format
  const steps = [
    ...(result.bashCommands || []).map(cmd => ({
      toolName: 'execute_bash' as const,
      args: { command: cmd.command },
      result: {
        success: cmd.exitCode === 0,
        output: cmd.output,
        exitCode: cmd.exitCode,
      },
    })),
    ...(result.fileChanges || []).map(file => ({
      toolName: 'file_operation' as const,
      args: { path: file.path, action: file.action },
      result: {
        success: true,
        output: `File ${file.action}: ${file.path}`,
      },
    })),
  ];

  return {
    success: true,
    response: stringifyMessageContent(result.response),
    steps,
    totalSteps: Array.isArray(result.steps) ? result.steps.length : (result.steps || 0),
    mode: 'v2-native',
    metadata: {
      provider: 'opencode-engine',
      model: result.metadata?.model,
      duration: Date.now() - startTime,
      tokensUsed: result.metadata?.tokensUsed,
    },
  };
}

/**
 * Run Desktop mode - Local execution via Tauri desktop provider
 * Uses the user's local filesystem and shell directly without cloud sandboxes.
 */
async function runDesktopMode(
  config: UnifiedAgentConfig,
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  log.info('Running Desktop mode (local execution)', {
    userMessageLength: (config.userMessage || '').length,
  });

  // Desktop mode uses the StatefulAgent with a desktop sandbox provider
  // for complex tasks, or the OpenCode engine for simple tasks
  // IMPORTANT: Only test against the raw user task, not the full context-augmented message
  const desktopRawTask = extractRawUserTask(config.userMessage);
  const shouldUseStatefulAgent = /(create|build|implement|refactor|migrate)/i.test(desktopRawTask);

  if (shouldUseStatefulAgent && process.env.ENABLE_STATEFUL_AGENT !== 'false') {
    log.info('Desktop: Complex task, routing to StatefulAgent with desktop provider');
    return await runStatefulAgentMode(config);
  }

  // For simple tasks, use the OpenCode engine with desktop sandbox
  try {
    const desktopV2Model = resolveV2Model('v2-cli', config.model).model;
    const engineConfig: OpenCodeEngineConfig = {
      model: desktopV2Model,
      systemPrompt: (config.systemPrompt || 'You are an expert software engineer running on the user\'s desktop. You have direct access to the local filesystem and shell. Execute commands freely to complete tasks.') + (config._autoInjectContext ? `\n\n${config._autoInjectContext}` : ''),
      maxSteps: config.maxSteps || 25,
      timeout: 300000,
      enableBash: true,
      enableFileOps: true,
      enableCodegen: true,
      onStreamChunk: config.onStreamChunk,
      onToolCall: (tool, args) => {
        config.onToolExecution?.(tool, args, { success: true, output: 'Tool called' });
      },
    };

    const engine = createOpenCodeEngine(engineConfig);
    const result = await engine.execute(config.userMessage);

    if (!result.success) {
      throw new StallWatchdogError(result.error || 'Desktop execution failed', { errorCode: 'OTHER' });
    }

    const steps = [
      ...(result.bashCommands || []).map(cmd => ({
        toolName: 'execute_bash' as const,
        args: { command: cmd.command },
        result: {
          success: cmd.exitCode === 0,
          output: cmd.output,
          exitCode: cmd.exitCode,
        },
      })),
      ...(result.fileChanges || []).map(file => ({
        toolName: 'file_operation' as const,
        args: { path: file.path, action: file.action },
        result: {
          success: true,
          output: `File ${file.action}: ${file.path}`,
        },
      })),
    ];

    return {
      success: true,
      response: stringifyMessageContent(result.response),
      steps,
      totalSteps: Array.isArray(result.steps) ? result.steps.length : (result.steps || 0),
      mode: 'desktop',
      metadata: {
        provider: 'desktop',
        model: result.metadata?.model,
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    log.error('Desktop mode failed, falling back to V1 API', error);
    // Fall back to V1 API if desktop execution fails
    return await runV1Api(config);
  }
}

/**
 * Run StatefulAgent mode - Plan-Act-Verify workflow for complex tasks
 * Uses comprehensive orchestration with task decomposition, self-healing, and verification
 */
async function runStatefulAgentMode(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  // Initialize workspace-scoped services if projectContext provided
  let projectServices: ReturnType<typeof getProjectServices> | null = null;
  if (config.projectContext) {
    projectServices = getProjectServices(config.projectContext);
  }

  try {
    // FIX: Use conversationId for VFS session scoping.
    // Build composite key: "userId$conversationId" for proper VFS isolation
    const vfsSessionId = config.conversationId
      ? `${config.userId || 'system'}$${config.conversationId}`
      : (config.projectContext?.id || `unified-${Date.now()}`);

    const agentOptions: StatefulAgentOptions = {
      sessionId: vfsSessionId,  // FIX: Use composite key for VFS scoping
      userId: config.userId,  // Pass authenticated user ID to BootstrappedAgency
      conversationId: config.conversationId,  // FIX: Pass conversationId for session folder scoping
      maxSelfHealAttempts: parseInt(process.env.STATEFUL_AGENT_MAX_SELF_HEAL_ATTEMPTS || '3'),
      enforcePlanActVerify: true,
      enableReflection: process.env.STATEFUL_AGENT_ENABLE_REFLECTION !== 'false',
      enableTaskDecomposition: process.env.STATEFUL_AGENT_ENABLE_TASK_DECOMPOSITION !== 'false',
      enableCapabilityChaining: process.env.STATEFUL_AGENT_ENABLE_CAPABILITY_CHAINING !== 'false',
      enableBootstrappedAgency: process.env.STATEFUL_AGENT_ENABLE_BOOTSTRAPPED_AGENCY !== 'false',
      // Pass workspace-scoped retrieval for workspace-isolated memory access
      projectServices: projectServices || undefined,
    };

    const agent = new StatefulAgent(agentOptions);
    // Prepend auto-inject context to user message so StatefulAgent knows about
    // proactive powers (web-search, code-search) when triggers match.
    const userMsgWithAutoInject = config._autoInjectContext
      ? `${config._autoInjectContext}\n\n${config.userMessage}`
      : config.userMessage;
    const result: StatefulAgentResult = await agent.run(userMsgWithAutoInject);

    // Convert StatefulAgent result to unified format
    const steps = result.vfs ? Object.entries(result.vfs).map(([path, content]) => ({
      toolName: 'write_file' as const,
      args: { path, content },
      result: { success: true, output: `Written ${path}` },
    })) : [];

    // FIX: Throw on failure to trigger fallback instead of returning unsuccessful result
    if (!result.success) {
      const error = result.errors?.[0] || 'StatefulAgent failed';
      throw new Error(typeof error === 'string' ? error : JSON.stringify(error));
    }

    return {
      success: result.success,
      response: stringifyMessageContent(result.response),
      steps,
      totalSteps: Array.isArray(result.steps) ? result.steps.length : (result.steps || 0),
      mode: 'v2-native',  // StatefulAgent runs as V2 native
      metadata: {
        provider: 'stateful-agent',
        duration: Date.now() - startTime,
        filesModified: result.vfs ? Object.keys(result.vfs).length : 0,
        errors: result.errors?.length || 0,
        // FIX: Pass anyToolFailed through to SSE metadata so client can auto-retry on tool failure
        // StatefulAgent errors array contains step errors including tool failures
        anyToolFailed: (result.errors?.length ?? 0) > 0,
        reflectionEnabled: agentOptions.enableReflection,
        taskDecompositionEnabled: agentOptions.enableTaskDecomposition,
      },
    };
  } catch (error: any) {
    log.error('StatefulAgent mode failed:', error.message);
    throw error;  // Let fallback handle it
  }
}

/**
 * Run V2 containerized mode (OpenCode in sandbox) - PRIMARY ENGINE
 */
async function runV2Containerized(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  
  // Use OpenCode Engine as primary agentic engine
  const autoInjectSuffix = config._autoInjectContext ? `\n\n${config._autoInjectContext}` : '';
  const containerModel = resolveV2Model('v2-container', config.model).model;
  const engineConfig: OpenCodeEngineConfig = {
    systemPrompt: (config.systemPrompt || '') + autoInjectSuffix,
    model: containerModel,

    maxSteps: config.maxSteps,
    timeout: 300000,
  } as any;

  const engine = createOpenCodeEngine(engineConfig);
  const result = await engine.execute(config.userMessage);
  
  if (!result.success) {
    throw new StallWatchdogError(result.error || 'OpenCode engine failed', { errorCode: 'OTHER' });
  }
  
  return {
    success: true,
    response: stringifyMessageContent(result.response),
    steps: (result.bashCommands || []).map(cmd => ({
      toolName: 'execute_command',
      args: { command: cmd.command },
      result: {
        success: cmd.exitCode === 0,
        output: cmd.output,
        exitCode: cmd.exitCode,
      },
    })),
    totalSteps: Array.isArray(result.steps) ? result.steps.length : (result.steps || 0),
    mode: 'v2-containerized',
    metadata: {
      provider: 'opencode-engine',
      duration: Date.now() - startTime,
      commandsExecuted: result.bashCommands?.length || 0,
      filesModified: result.fileChanges?.length || 0,
    },
  };
}

/**
 * Run V2 local mode (OpenCode CLI spawned locally) - PRIMARY ENGINE
 */
async function runV2Local(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  
  // Use OpenCode Engine as primary agentic engine
  const autoInjectSuffix = config._autoInjectContext ? `\n\n${config._autoInjectContext}` : '';
  const localModel = resolveV2Model('v2-cli', config.model).model;
  const engineConfig: OpenCodeEngineConfig = {
    systemPrompt: (config.systemPrompt || '') + autoInjectSuffix,
    model: localModel,
    maxSteps: config.maxSteps,
    timeout: 300000,
  } as any;
  
  const engine = createOpenCodeEngine(engineConfig);
  const result = await engine.execute(config.userMessage);
  
  if (!result.success) {
    throw new StallWatchdogError(result.error || 'OpenCode engine failed', { errorCode: 'OTHER' });
  }
  
  return {
    success: true,
    response: stringifyMessageContent(result.response),
    steps: (result.bashCommands || []).map(cmd => ({
      toolName: 'execute_command',
      args: { command: cmd.command },
      result: {
        success: cmd.exitCode === 0,
        output: cmd.output,
        exitCode: cmd.exitCode,
      },
    })),
    totalSteps: Array.isArray(result.steps) ? result.steps.length : (result.steps || 0),
    mode: 'v2-local',
    metadata: {
      provider: 'opencode-engine',
      duration: Date.now() - startTime,
    },
  };
}

/**
 * Run OpenCode SDK mode — web-first agentic execution via HTTP API.
 *
 * Uses the OpencodeSessionManager HTTP API to talk to an OpenCode server.
 * This is the ONLY OpenCode mode that works on web deployments — it doesn't
 * require a local `opencode` CLI binary, just an accessible server endpoint.
 *
 * Strategy (with fallback):
 *   1. Try connecting to an already-running OpenCode server via HTTP
 *      (OPENCODE_HOSTNAME / OPENCODE_PORT / OPENCODE_SDK_URL).
 *   2. If no server is reachable, try to start one using the @opencode-ai/sdk
 *      package (which spawns `opencode serve` under the hood).
 *   3. If both fail, throw so the fallback chain can route to v1-api.
 */
async function runOpencodeSDKMode(
  config: UnifiedAgentConfig,
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  log.info('Running OpenCode SDK mode', {
    userMessageLength: (config.userMessage || '').length,
  });

  // Attempt 1: Connect to existing server via HTTP API
  try {
    const { createOpencodeSessionManager } = await import('@/lib/drivers/opencode');
    const sdkUrl = process.env.OPENCODE_SDK_URL;
    const hostname = process.env.OPENCODE_HOSTNAME || '127.0.0.1';
    const port = parseInt(process.env.OPENCODE_PORT || '4096');

    const sessionManager = createOpencodeSessionManager({
      baseUrl: sdkUrl || undefined,
      hostname,
      port,
      timeout: 120000, // Longer timeout for agentic tasks
    });

    // Verify server is reachable
    const statusList = await sessionManager.getStatus();
    const serverAvailable = Array.isArray(statusList);
    if (!serverAvailable) {
      // Fix A (UAG-LOG-SHAPE-CONTRACT-INVESTIGATION, ticket /opt/bing/.tickets/UAG-LOG-SHAPE-CONTRACT-INVESTIGATION.md):
      // emit `outcome: 'error'` so the postaudit contract
      // (finding-5-6-log-shape.test.ts test #4: 'call-site outcome values cover
      // the canonical 5-value set') can verify the error path. Synthetic
      // UnifiedAgentResult mirrors the StallWatchdogError fields; the audit
      // fires BEFORE the throw so log aggregators see the error before the
      // stall watchdog propagates. This is the canonical 'error' emit site
      // for engine-unreachable failures (ABORT errorCode); the 'exhausted'
      // outcome at L2235 covers the chain-exhausted path separately.
      auditResponseShape(
        {
          response: '',
          success: false,
          mode: 'opencode-sdk',
          error: 'OpenCode server status check returned non-array — server likely not running',
          metadata: { provider: 'opencode-sdk', duration: Date.now() - startTime },
        },
        { provider: config.provider, model: config.model, mode: 'opencode-sdk', outcome: 'error' },
      );
      throw new StallWatchdogError('OpenCode server status check returned non-array — server likely not running', { errorCode: 'ABORT' });
    }

    log.info('OpenCode SDK server reachable', {
      hostname,
      port,
      activeSessions: statusList.length,
    });

    // Create a session for this request
    const title = config.conversationId
      ? `conv-${config.conversationId}`
      : `sdk-${Date.now()}`;
    const session = await sessionManager.createSession(title);
    log.info('OpenCode SDK session created', { sessionId: session.id });

    // Inject auto-inject context + system prompt via noReply message
    const autoInjectContext = config._autoInjectContext || '';
    const systemPrompt = config.systemPrompt || 'You are an expert software engineer with full bash and file system access. Use tools to complete tasks efficiently.';
    if (autoInjectContext || systemPrompt) {
      await sessionManager.injectContext(
        session.id,
        [autoInjectContext, systemPrompt].filter(Boolean).join('\n\n'),
      );
    }

    // Inject conversation history as context (noReply messages)
    if (config.conversationHistory && config.conversationHistory.length > 0) {
      for (const msg of config.conversationHistory) {
        if (msg.role === 'system') continue; // already injected above
        await sessionManager.injectContext(
          session.id,
          `[${msg.role}]: ${msg.content}`,
        );
      }
    }

    // Send the user prompt
    const modelStr = resolveV2Model('v2-http-sdk', config.model).model;
    const promptOpts: Record<string, any> = {};
    if (modelStr && modelStr.includes('/')) {
      const [providerID, modelID] = modelStr.split('/');
      promptOpts.model = { providerID, modelID };
    } else if (modelStr) {
      promptOpts.model = { providerID: 'anthropic', modelID: modelStr };
    }
    if (config.systemPrompt) {
      promptOpts.system = config.systemPrompt;
    }

    const result = await sessionManager.sendPrompt(
      session.id,
      config.userMessage,
      promptOpts,
    );

    // Extract text content from the response message
    const responseText = result.parts
      ?.filter((p: any) => p.type === 'text')
      .map((p: any) => p.text || '')
      .join('') || '';

    // Extract tool call steps for the unified result format
    const toolSteps = (result.parts || [])
      .filter((p: any) => p.type === 'tool')
      .map((p: any) => ({
        toolName: p.tool?.name || 'unknown',
        args: p.tool?.args || {},
        result: {
          success: p.tool?.result?.success !== false,
          output: p.tool?.result?.output || JSON.stringify(p.tool?.result || {}),
          exitCode: p.tool?.result?.exitCode ?? (p.tool?.result?.success === false ? 1 : 0),
        },
      }));

    // Try to get file changes from the session diff
    let fileEdits: Array<{ path: string; content?: string; diff?: string; action?: string }> = [];
    try {
      const diffResult = await sessionManager.getDiff(session.id);
      if (diffResult.diff) {
        fileEdits = [{ path: '(session diff)', diff: diffResult.diff, action: 'diff' }];
      }
    } catch { /* best effort */ }

    log.info('OpenCode SDK mode completed', {
      sessionId: session.id,
      responseLength: responseText.length,
      toolSteps: toolSteps.length,
      duration: Date.now() - startTime,
    });

    recordSuccess('v2-http-sdk', 'opencode-sdk');
    // CRITICAL: Do NOT substitute a placeholder string for empty responses —
    // it masks emptiness from the client's `isEmptyResponse` detection and
    // disables the auto-retry-with-rotation pathway. Leave response empty and
    // let the client trigger the retry, or set metadata.isEmptyResponse=true.
    const isEmpty = !responseText || !responseText.trim();
    return {
      success: true,
      response: responseText || '',
      steps: toolSteps,
      totalSteps: toolSteps.length,
      mode: 'opencode-sdk',
      fileEdits: fileEdits.length > 0 ? fileEdits : undefined,
      metadata: {
        provider: 'opencode-sdk',
        model: modelStr,
        duration: Date.now() - startTime,
        sessionId: session.id,
        ...(isEmpty ? { isEmptyResponse: true, emptyReason: 'opencode-sdk produced no text' } : {}),
        // FIX: Pass anyToolFailed through to SSE metadata so client can auto-retry on tool failure
        ...(toolSteps.length > 0 && toolSteps.some(t => t.result?.success === false) ? { anyToolFailed: true } : {}),
      },
    };
  } catch (httpError: any) {
    recordFailure('v2-http-sdk', 'opencode-sdk', httpError.message);
    log.warn('OpenCode SDK HTTP API failed, trying @opencode-ai/sdk fallback', {
      error: httpError.message,
    });

    // Attempt 2: Try to start server via @opencode-ai/sdk
    try {
      const { createOpenCodeSDKProvider } = await import('@/lib/engineers/opencode-sdk-provider');
      const sdkProvider = createOpenCodeSDKProvider({
        hostname: process.env.OPENCODE_HOSTNAME || '127.0.0.1',
        port: parseInt(process.env.OPENCODE_PORT || '4096'),
        model: resolveV2Model('v2-http-sdk', config.model).model,
        timeout: 30000,
      });

      await sdkProvider.initialize();

      // Build messages for the SDK provider
      const messages: Array<{ role: string; content: string }> = [
        ...(config.conversationHistory || []),
        { role: 'user', content: config.userMessage },
      ];

      // Add auto-inject context as a preceding user message
      if (config._autoInjectContext) {
        messages.unshift({ role: 'user', content: config._autoInjectContext });
      }

      // Stream the response
      let fullResponse = '';
      const toolSteps: Array<{ toolName: string; args: Record<string, any>; result: ToolResult }> = [];

      for await (const chunk of sdkProvider.generateStreamingResponse({
        messages,
        model: resolveV2Model('v2-http-sdk', config.model).model,
        temperature: config.temperature || 0.7,
        maxTokens: config.maxTokens || 32000,
      } as any)) {
        if (chunk.content) {
          fullResponse += chunk.content;
          config.onStreamChunk?.(chunk.content);
        }
        if (chunk.isComplete) {
          break;
        }
      }

      log.info('OpenCode SDK fallback (@opencode-ai/sdk) completed', {
        responseLength: fullResponse.length,
        duration: Date.now() - startTime,
      });

      // Clean up
      await sdkProvider.close().catch(() => {});

      const isEmpty = !fullResponse || !fullResponse.trim();
      return {
        success: true,
        response: fullResponse || '',
        steps: toolSteps,
        totalSteps: toolSteps.length,
        mode: 'opencode-sdk',
        metadata: {
          provider: 'opencode-sdk-fallback',
          duration: Date.now() - startTime,
          fallbackMethod: '@opencode-ai/sdk',
          ...(isEmpty ? { isEmptyResponse: true, emptyReason: 'opencode-sdk-fallback produced no text' } : {}),
          // FIX: Pass anyToolFailed through to SSE metadata so client can auto-retry on tool failure
          ...(toolSteps.length > 0 && toolSteps.some(t => t.result?.success === false) ? { anyToolFailed: true } : {}),
        },
      };
    } catch (sdkError: any) {
      log.error('OpenCode SDK fallback also failed', {
        httpError: httpError.message,
        sdkError: sdkError.message,
      });
      // Throw so the fallback chain can route to v1-api
      throw new Error(
        `OpenCode SDK mode failed: HTTP API error (${httpError.message}), SDK fallback error (${sdkError.message})`,
      );
    }
  }
}

/**
 * Run V1 API mode (LLM provider API)
 */
async function runV1Api(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();

  // Build messages from conversation history + current message.
  // Filter out tool-role messages: route.ts:1130 converts non-string content
  // via JSON.stringify, producing string-content tool messages that violate
  // the AI SDK ModelMessage[] schema (requires array content with
  // { type: 'tool-result', ... }). Tool messages from prior turns are also
  // stale — their tool_call_id references no longer match any live calls.
  //
  // Additionally, strip system-role messages and extract them into
  // config.systemPrompt so the downstream path (streamWithVercelAI or
  // enhanced-llm-service) receives them via the `system` parameter — not
  // inside the messages[] array where they trigger "Invalid prompt: The
  // messages do not match the ModelMessage[] schema" errors.
  const rawHistory = config.conversationHistory || [];
  const systemParts: string[] = [];
  const nonSystemMessages: any[] = [];
  for (const msg of rawHistory) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content || '');
      systemParts.push(text);
    } else if (msg.role !== 'tool') {
      nonSystemMessages.push(msg);
    }
  }
  // Build resolved system prompt without mutating config to prevent duplication
  // when runV1Api is called as a fallback (the same config object is reused).
  const resolvedSystemPrompt = systemParts.length > 0
    ? ((config.systemPrompt || '') + '\n\n' + systemParts.join('\n\n'))
    : config.systemPrompt;
  const messages: any[] = [
    ...nonSystemMessages,
    { role: 'user', content: config.userMessage },
  ];

  // Ensure tool system is initialized before using capabilities
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: config.userId || 'system', enableMCP: true, enableSandbox: true });
  }

  // Check if tools are available for agent loop execution
  const hasToolsForAgent =
    Array.isArray(config.tools) &&
    config.tools.length > 0 &&
    typeof config.executeTool === 'function';

  log.info('[V1-API] ┌─ DISPATCH ─────────────────────────────────');
  log.info('[V1-API] │ hasTools:', hasToolsForAgent);
  log.info('[V1-API] │ toolCount:', config.tools?.length || 0);
  log.info('[V1-API] │ hasExecuteFn:', typeof config.executeTool === 'function');
  log.info('[V1-API] │ tools:', config.tools?.map(t => t.name).join(', ') || 'none');
  log.info('[V1-API] │ will use:', hasToolsForAgent ? 'runV1ApiWithTools' : 'runV1ApiCompletion');
  log.info('[V1-API] └─────────────────────────────────────────────');

  if (hasToolsForAgent) {
    // Use agent loop with tools — pass modified config copy with resolved system prompt
    return await runV1ApiWithTools(
      { ...config, systemPrompt: resolvedSystemPrompt },
      messages,
      startTime
    );
  } else {
    // Simple completion without tools — pass modified config copy
    return await runV1ApiCompletion(
      { ...config, systemPrompt: resolvedSystemPrompt },
      messages,
      getLLMProvider(),
      startTime
    );
  }
}

/**
 * Run Mastra Workflow mode
 * Executes task via Mastra workflow engine with proper tracking
 */
async function runMastraWorkflow(config: UnifiedAgentConfig): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  const workflowId = config.workflowId || 'code-agent';

  try {
    log.info('Executing Mastra workflow', { workflowId, userMessage: config.userMessage.substring(0, 100) });

    // Execute workflow via Mastra integration
    // FIX: Use conversationId for VFS session scoping
    // Prepend auto-inject context to task so Mastra knows about proactive powers.
    const taskWithAutoInject = config._autoInjectContext
      ? `${config._autoInjectContext}\n\n${config.userMessage}`
      : config.userMessage;
    const workflowResult = await mastraWorkflowIntegration.executeWorkflow(workflowId, {
      task: taskWithAutoInject,
      ownerId: config.conversationId
        ? `${config.userId || 'system'}$${config.conversationId}`
        : (config.userId || config.sandboxId || 'default'),
      systemPrompt: config.systemPrompt,
      maxSteps: config.maxSteps,
    });

    // FIX: Throw on failure to trigger fallback instead of returning unsuccessful result
    if (!workflowResult.success) {
      throw new StallWatchdogError(workflowResult.error || 'Mastra workflow execution failed', { errorCode: 'OTHER' });
    }

    // Convert workflow result to unified format
    const steps = workflowResult.steps?.map(step => ({
      toolName: step.id,
      args: step.result || {},
      result: {
        success: step.status === 'completed',
        output: JSON.stringify(step.result),
      },
    })) || [];

    return {
      success: true,
      response: workflowResult.result?.response || 'Workflow executed successfully',
      steps,
      totalSteps: steps.length,
      mode: 'mastra-workflow',
      metadata: {
        provider: 'mastra',
        workflowId,
        duration: Date.now() - startTime,
        workflowSteps: workflowResult.steps?.map(s => ({
          id: s.id,
          name: s.name,
          status: s.status,
        })),
      },
    };
  } catch (error: any) {
    log.error('Mastra workflow execution failed', { workflowId, error: error.message });
    throw error; // Re-throw to trigger fallback
  }
}

/**
 * Run V1 Progressive Build mode — multi-iteration, file-aware, self-stopping build loop.
 *
 * Integrates the progressive-build-engine with the unified agent's tool execution,
 * VFS scoping, and streaming support.
 *
 * Each iteration:
 * 1. Gets current workspace tree + diffs from last round (via smart-context.ts)
 * 2. Calls LLM with "build the next piece" instructions
 * 3. Applies file writes through VFS MCP tools
 * 4. Optional reflection pass identifies gaps
 * 5. Stops when LLM emits [BUILD_COMPLETE] or maxIterations/timeout
 */
async function runProgressiveBuildMode(
  config: UnifiedAgentConfig,
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  const buildConfig = config.progressiveBuild || {};

  log.info('[ProgressiveBuild] ┌─ ENTRY ──────────────────────────');
  log.info('[ProgressiveBuild] │ userMessage:', config.userMessage.slice(0, 120));
  log.info('[ProgressiveBuild] │ maxIterations:', buildConfig.maxIterations ?? 15);
  log.info('[ProgressiveBuild] │ contextMode:', buildConfig.contextMode ?? 'diff');
  log.info('[ProgressiveBuild] │ enableReflection:', buildConfig.enableReflection ?? false);
  log.info('[ProgressiveBuild] │ timeBudgetMS:', buildConfig.timeBudgetMS ?? 300_000);
  log.info('[ProgressiveBuild] └─────────────────────────────────────');

  // Ensure tool system is initialized
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: config.userId || 'system', enableMCP: true, enableSandbox: true });
  }

  // Build the LLM call wrapper that uses the Vercel AI SDK (same as runV1ApiWithTools)
  const capabilityExecuteTool = createCapabilityToolExecutor(config);
  // FIX: Use shared dynamic defaults resolver instead of hardcoded mistral
  const _progDefaults = await resolveDynamicDefaults();
  const primaryProvider = config.provider || _progDefaults.provider;
  const normalizedModel = config.model || process.env.LLM_MODEL || _progDefaults.model;

  const llmCall = async (messages: Array<{ role: string; content: string }>): Promise<string> => {
    const { streamText } = await import('ai');
    const { getVercelModel } = await import('../chat/vercel-ai-streaming');

    // Inject auto-inject context as a user message if not already present
    // (progressive build builds its own messages independently)
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');
    if (config._autoInjectContext) {
      const hasAutoInject = messages.some(m => m.content?.includes('[Auto-loaded power(s)'));
      if (!hasAutoInject) {
        nonSystemMsgs.unshift({ role: 'user', content: config._autoInjectContext });
      }
    }

    const vercelModel = getVercelModel(primaryProvider, normalizedModel);

    // Convert tools to Vercel AI SDK format
    const vercelTools: Record<string, any> = {};
    if (config.tools && config.tools.length > 0) {
      for (const tool of config.tools) {
        // AI SDK v6 reads `tool.inputSchema` (not `parameters`). See
        // `normalizeSchemaForAI` in `@bing/shared/agent/tool-schema`.
        vercelTools[tool.name] = {
          description: tool.description,
          inputSchema: normalizeSchemaForAI(tool.parameters),
          execute: async (args: Record<string, any>) => {
            const result = await capabilityExecuteTool(tool.name, args);
            return result;
          },
        };
      }
    }

    let fullResponse = '';
    try {
      const result = streamText({
        model: vercelModel as any,
        messages: nonSystemMsgs as any,
        system: systemMsg?.content,
        maxTokens: config.maxTokens || 8000,
        temperature: config.temperature ?? 0.7,
        tools: Object.keys(vercelTools).length > 0 ? vercelTools : undefined,
        maxSteps: config.maxSteps || 15, // Allow multi-step tool calling
      } as any);

      for await (const chunk of result.fullStream) {
        if (chunk.type === 'text-delta') {
          const text = (chunk as any).text || '';
          fullResponse += text;
          config.onStreamChunk?.(text);
        }
      }
    } catch (err: any) {
      log.error('[ProgressiveBuild] LLM call failed', { error: err.message });
      // Return partial response so the loop can continue
      if (fullResponse) return fullResponse;
      throw err;
    }

    return fullResponse;
  };

  // Create the build engine LLM call wrapper
  const buildLlmCall = async (msgs: Array<{ role: string; content: string }>): Promise<string> => {
    return llmCall(msgs);
  };

  // Determine which files have been written (for SSE events)
  const allFilesWritten: string[] = [];

  // SSE event emitter wrapper
  const emitBuildEvent = (event: string, data: unknown) => {
    log.info(`[ProgressiveBuild] Event: ${event}`, data);
    if (config.onStreamChunk && typeof data === 'object' && data !== null) {
      // Emit structured build progress as SSE event
      config.onStreamChunk(sseEncode(SSE_EVENT_TYPES.PROGRESSIVE_BUILD, { event, ...(data as Record<string, unknown>), timestamp: Date.now() }));
    }
  };

  // Import and run the progressive build engine
  let buildResult: any;
  try {
    const { runProgressiveBuild, BuildPresets } = await import('../engineers/progressive-build-engine');

    // Use balanced preset as base, override with user config
    const preset = buildConfig.contextMode === 'tree' ? BuildPresets.fast
      : buildConfig.contextMode === 'read' ? BuildPresets.thorough
      : buildConfig.enableReflection ? BuildPresets.large
      : BuildPresets.balanced;

    buildResult = await runProgressiveBuild({
      userId: config.userId || 'system',
      sessionId: config.conversationId,
      userPrompt: config.userMessage,
      llmCall: buildLlmCall,
      emit: emitBuildEvent,
      config: {
        ...preset,
        maxIterations: buildConfig.maxIterations ?? preset.maxIterations,
        contextMode: buildConfig.contextMode ?? preset.contextMode,
        enableReflection: buildConfig.enableReflection ?? false,
        timeBudgetMS: buildConfig.timeBudgetMS ?? preset.maxIterations === 20 ? 600_000 : 300_000,
        completionIndicator: buildConfig.completionIndicator ?? '[BUILD_COMPLETE]',
        verbose: false, // Use logging instead
      },
      // Optional: override reflection with the existing ReflectionEngine if enabled
      reflectionFn: buildConfig.enableReflection ? async (llmCallFn, userPrompt, tree, lastResponse) => {
        try {
          const { reflectionEngine } = await import('./reflection-engine');
          const reflections = await reflectionEngine.reflect(lastResponse, {
            context: { originalPrompt: userPrompt, projectTree: tree },
          });
          const synthesized = reflectionEngine.synthesizeReflections(reflections);
          return {
            summary: synthesized.prioritizedImprovements.join('\n'),
            gapsIdentified: synthesized.prioritizedImprovements,
            score: Math.round(synthesized.overallScore * 100),
          };
        } catch {
          // Fall back to default reflection
          const { defaultReflectionFn } = await import('../engineers/progressive-build-engine');
          return defaultReflectionFn(llmCallFn, userPrompt, tree, lastResponse);
        }
      } : false,
    });
  } catch (err: any) {
    log.error('[ProgressiveBuild] Engine import or execution failed', { error: err.message });
    throw err; // Re-throw to trigger fallback
  }

  // Collect files written from all iterations (heuristic)
  for (const iter of buildResult.allIterations || []) {
    if (iter.filesWritten) {
      allFilesWritten.push(...iter.filesWritten);
    }
  }

  // Build file edits array from the final response
  const fileEdits = extractFileWritesFromLLMResponse(buildResult.finalResponse || '');

  const totalDurationMs = Date.now() - startTime;

  log.info('[ProgressiveBuild] ┌─ COMPLETE ──────────────────────────');
  log.info('[ProgressiveBuild] │ completed:', buildResult.completed);
  log.info('[ProgressiveBuild] │ completionReason:', buildResult.completionReason);
  log.info('[ProgressiveBuild] │ iterations:', buildResult.iterations);
  log.info('[ProgressiveBuild] │ totalDurationMs:', totalDurationMs);
  log.info('[ProgressiveBuild] │ filesWritten:', allFilesWritten.length);
  log.info('[ProgressiveBuild] │ warnings:', buildResult.warnings?.length || 0);
  log.info('[ProgressiveBuild] └──────────────────────────────────────');

  return {
    success: buildResult.completed || buildResult.iterations > 0,
    response: buildResult.finalResponse || '',
    mode: 'v1-progressive-build',
    totalSteps: buildResult.iterations,
    fileEdits,
    metadata: {
      model: normalizedModel,
      provider: primaryProvider,
      duration: totalDurationMs,
      progressiveBuild: {
        completed: buildResult.completed,
        completionReason: buildResult.completionReason,
        iterations: buildResult.iterations,
        allIterations: (buildResult.allIterations || []).map((a: any) => ({
          iteration: a.iteration,
          durationMs: a.durationMs,
          filesWritten: a.filesWritten || [],
          reflectionSummary: a.reflectionSummary,
          gapsIdentified: a.gapsIdentified || [],
        })),
        projectTree: buildResult.projectTree,
        warnings: buildResult.warnings || [],
      },

    },
  };
}

/**
 * Create a capability-based tool executor that uses the centralized tool system
 * This enables all execution paths (v1, v2, streaming, non-Mastra) to use the same tool capabilities
 *
 * Expanded capability map covers: file operations, bash/terminal, search/glob, MCP tools
 */
/**
 * Pre-execution argument validation schemas.
 * When the LLM generates a tool call with empty/missing required fields,
 * we catch it here and return a structured error the model can recover from
 * — avoiding blind "{ success: false, duration: 0 }" failures that waste the
 * budget and produce no visible output.
 */
const TOOL_VALIDATION_SCHEMAS: Record<
  string,
  { required: string[]; defaults?: Record<string, any>; help: string }
> = {
  write_file: {
    required: ['path', 'content'],
    defaults: {},
    help: 'write_file requires: path (string) — file path relative to workspace, content (string) — complete file content',
  },
  // Alias: edit_file uses same args as write_file
  edit_file: {
    required: ['path', 'content'],
    defaults: {},
    help: 'edit_file requires: path (string) — file path relative to workspace, content (string) — complete file content',
  },
  read_file: {
    required: ['path'],
    defaults: {},
    help: 'read_file requires: path (string) — file path relative to workspace',
  },
  read_files: {
    required: ['paths'],
    defaults: {},
    help: 'read_files requires: paths (array of strings) — file paths to read',
  },
  list_files: {
    required: ['path'],
    defaults: { path: '/' },
    help: 'list_files requires: path (string) — directory path, defaults to "/" (workspace root)',
  },
  list_directory: {
    required: ['path'],
    defaults: { path: '/' },
    help: 'list_directory requires: path (string) — directory path, defaults to "/" (workspace root)',
  },
  delete_file: {
    required: ['path'],
    defaults: {},
    help: 'delete_file requires: path (string) — file path to delete',
  },
  batch_write: {
    required: ['files'],
    defaults: {},
    help: 'batch_write requires: files (array) — array of { path, content } objects',
  },
  mkdir: {
    required: ['path'],
    defaults: {},
    help: 'mkdir requires: path (string) — directory path to create',
  },
  apply_diff: {
    required: ['path', 'diff'],
    defaults: {},
    help: 'apply_diff requires: path (string) — file to patch, diff (string) — unified diff content',
  },
  str_replace: {
    required: ['path', 'oldString', 'newString'],
    defaults: {},
    help: 'str_replace requires: path (string) — file to edit, oldString (string) — exact text to replace, newString (string) — replacement text',
  },
  execute_bash: {
    required: ['command'],
    defaults: {},
    help: 'execute_bash requires: command (string) — shell command to run',
  },
  // Aliases for execute_bash — small free models commonly call these with empty args
  bash: {
    required: ['command'],
    defaults: {},
    help: 'bash requires: command (string) — shell command to run',
  },
  shell: {
    required: ['command'],
    defaults: {},
    help: 'shell requires: command (string) — shell command to run',
  },
  run: {
    required: ['command'],
    defaults: {},
    help: 'run requires: command (string) — shell command to run',
  },
  execute: {
    required: ['command'],
    defaults: {},
    help: 'execute requires: command (string) — shell command to run',
  },
  execute_command: {
    required: ['command'],
    defaults: {},
    help: 'execute_command requires: command (string) — shell command to run',
  },
  exec_shell: {
    required: ['command'],
    defaults: {},
    help: 'exec_shell requires: command (string) — shell command to run',
  },
  search_files: {
    required: ['query'],
    defaults: {},
    help: 'search_files requires: query (string) — search pattern or text',
  },
  grep_code: {
    required: ['query'],
    defaults: {},
    help: 'grep_code requires: query (string) — search pattern',
  },
};

/**
 * Validate tool arguments before execution.
 * Catches empty/missing required fields and returns a structured error
 * so the LLM can retry with valid args instead of silently failing.
 */
function validateToolArgs(
  toolName: string,
  args: Record<string, any> | null | undefined,
): { valid: true; args: Record<string, any> } | { valid: false; error: string; help: string } {
  const schema = TOOL_VALIDATION_SCHEMAS[toolName];
  if (!schema) return { valid: true, args: args || {} };

  if (!args || typeof args !== 'object') {
    return {
      valid: false,
      error: `Tool "${toolName}" called with no arguments.`,
      help: schema.help,
    };
  }

  // Apply defaults first, then overlay provided args
  const normalized: Record<string, any> = { ...(schema.defaults || {}), ...args };

  const missing: string[] = [];
  const empty: string[] = [];

  for (const field of schema.required) {
    if (!(field in normalized)) {
      missing.push(field);
    } else {
      const val = normalized[field];
      const isEmpty =
        val === null ||
        val === undefined ||
        (typeof val === 'string' && val.trim() === '') ||
        (Array.isArray(val) && val.length === 0);

      if (isEmpty) {
        const defaultVal = schema.defaults?.[field];
        if (defaultVal !== undefined) {
          normalized[field] = defaultVal;
        } else {
          empty.push(field);
        }
      }
    }
  }

  if (missing.length > 0) {
    return {
      valid: false,
      error: `Tool "${toolName}" is missing required fields: ${missing.join(', ')}.`,
      help: schema.help,
    };
  }

  if (empty.length > 0) {
    return {
      valid: false,
      error: `Tool "${toolName}" has empty values for required fields: ${empty.join(', ')}.`,
      help: schema.help,
    };
  }

  return { valid: true, args: normalized };
}

/**
 * Redact tool arguments for logging — replaces content fields with their
 * length to avoid dumping full file contents into logs, while preserving
 * paths, names, and other structural metadata for debugging.
 */
function redactToolArgs(name: string, args: Record<string, any>): Record<string, any> {
  if (!args || typeof args !== 'object') return args;
  const redacted: Record<string, any> = {};
  for (const [key, val] of Object.entries(args)) {
    if (key === 'content' || key === 'contents' || key === 'diff' || key === 'patch') {
      // Log content length and a small preview instead of the full content
      if (typeof val === 'string') {
        const preview = val.length > 80 ? val.slice(0, 80) + '...' : val;
        redacted[key] = `[${val.length} chars] ${preview}`;
      } else {
        redacted[key] = `[${typeof val}]`;
      }
    } else if (key === 'files' && Array.isArray(val)) {
      // Log file count and individual paths (no content)
      redacted[key] = val.map((f: any) => {
        if (f && typeof f === 'object') {
          const p = f.path || f.file || '(unknown)';
          const cLen = f.content ? f.content.length : 0;
          return `{path:"${p}", content:[${cLen} chars]}`;
        }
        return f;
      });
    } else if (key === 'command' && typeof val === 'string' && val.length > 120) {
      redacted[key] = val.slice(0, 120) + '...';
    } else if (key === 'paths' && Array.isArray(val)) {
      redacted[key] = `[${val.length} files: ${val.slice(0, 10).join(', ')}${val.length > 10 ? ', ...' : ''}]`;
    } else {
      redacted[key] = val;
    }
  }
  return redacted;
}

/**
 * Log a tool call result with redacted args through both the server log
 * and (if available) the SSE stream to the client.
 */
function logToolCall(
  toolName: string,
  rawArgs: Record<string, any>,
  result: { success: boolean; output?: string; error?: any; exitCode?: number },
  durationMs: number,
  onStreamChunk?: (chunk: string) => void,
): void {
  const redactedArgs = redactToolArgs(toolName, rawArgs || {});
  
  // Extract error details - handle both string and object error shapes
  let errorDetail: string | undefined;
  let errorCode: string | undefined;
  if (result.success === false) {
    if (typeof result.error === 'string') {
      errorDetail = result.error;
    } else if (result.error && typeof result.error === 'object') {
      errorDetail = (result.error as any).message || JSON.stringify(result.error);
      errorCode = (result.error as any).code;
    } else if (result.output && typeof result.output === 'string') {
      // Check for nested JSON failure (the "dual-status" pattern)
      try {
        const parsed = JSON.parse(result.output);
        if (parsed && parsed.success === false) {
          errorDetail = parsed.error?.message || parsed.error || result.output.slice(0, 200);
          errorCode = parsed.error?.code;
        } else {
          errorDetail = result.output.slice(0, 200);
        }
      } catch {
        errorDetail = result.output.slice(0, 200);
      }
    } else {
      errorDetail = 'Unknown error';
    }
  }

  // Server-side log: one line per tool call with structured metadata
  log.info(
    result.success
      ? `[ToolOK]  ${toolName} (${durationMs}ms)`
      : `[ToolERR] ${toolName} (${durationMs}ms)`,
    {
      tool: toolName,
      durationMs,
      success: result.success,
      exitCode: result.exitCode,
      args: redactedArgs,
      ...(errorDetail ? { error: errorDetail, errorCode } : {}),
    },
  );

  // SSE event for client-side display (if streaming is available)
  if (onStreamChunk) {
    try {
      onStreamChunk(sseEncode(SSE_EVENT_TYPES.TOOL_RESULT, {
        tool: toolName,
        success: result.success,
        exitCode: result.exitCode ?? (result.success ? 0 : 1),
        durationMs,
        args: redactedArgs,
        ...(errorDetail ? { error: errorDetail, errorCode } : {}),
      }));
    } catch { /* best effort */ }
  }
}

function createCapabilityToolExecutor(config: UnifiedAgentConfig) {
  return async (name: string, rawArgs: Record<string, any>): Promise<ToolResult> => {
    // Normalize args through shared alias resolver
    const normalizedArgs = normalizeToolArgs(name, rawArgs) as Record<string, any>;

    // Pre-execution arg validation: catch empty/missing required fields before
    // the tool fails silently with { success: false, duration: 0 }. Returns a
    // structured error message with help text the LLM can use to recover.
    const validation = validateToolArgs(name, normalizedArgs);
    if (!validation.valid) {
      // Narrow the union type to the failure branch
      const err = validation as { valid: false; error: string; help: string };
      log.warn('[ToolValidation] Rejected invalid tool args', {
        tool: name,
        error: err.error,
      });
      return {
        success: false,
        output: `${err.error} ${err.help}`,
        exitCode: 1,
      };
    }
    // Narrow to the success branch
    const args = (validation as { valid: true; args: Record<string, any> }).args;

    const capabilityMap: Record<string, string> = {
      'file_operation': 'file.read', 'read_file': 'file.read', 'write_file': 'file.write',
      'edit_file': 'file.write', 'delete_file': 'file.delete', 'list_directory': 'file.list',
      'list_dir': 'file.list', 'ls': 'file.list', 'list_files': 'file.list',
      'search_files': 'repo.search', 'grep': 'repo.search', 'glob': 'repo.search', 'find': 'repo.search',
      'execute_bash': 'sandbox.execute', 'execute_command': 'sandbox.execute', 'execute': 'sandbox.execute',
      'bash': 'sandbox.execute', 'shell': 'sandbox.execute', 'terminal': 'sandbox.execute', 'run': 'sandbox.execute',
      'sandbox_execute': 'sandbox.execute', 'sandbox_shell': 'bash.execute', 'sandbox_session': 'sandbox.session',
      'mcp_tool': 'mcp.execute', 'mcp_execute': 'mcp.execute',
      'git': 'repo.git', 'git_clone': 'repo.git', 'git_search': 'repo.search',
      'web_search': 'web.search', 'web_fetch': 'web.fetch',
      // VFS batch/file tools — route through capability system so userId/scopePath are threaded
      'batch_write': 'file.batch_write', 'write_files': 'file.batch_write',
      'batchwrite': 'file.batch_write', 'writefiles': 'file.batch_write',
      'search_code': 'repo.search', 'grep_code': 'repo.search',
      // Workspace stats
      'get_workspace_stats': 'workspace.stats',
      // Computer use tools
      'computer_use_click': 'computer_use.click',
      'computer_use_type': 'computer_use.type',
      'computer_use_screenshot': 'computer_use.screenshot',
      'computer_use_scroll': 'computer_use.scroll',
      // Git tools (beyond clone/search)
      'git_status': 'repo.git', 'git_commit': 'repo.git', 'git_push': 'repo.git',
      'git_pull': 'repo.git',
      // Code execution
      'run_code': 'sandbox.execute',
      // MCP tool listing
      'mcp_list_tools': 'mcp.list', 'mcp_call_tool': 'mcp.call',
      // File sync
      'sync_files': 'file.sync',
      // Process management
      'start_process': 'process.start', 'stop_process': 'process.stop', 'list_processes': 'process.list',
      // Preview / port forwarding
      'get_previews': 'preview.get', 'forward_port': 'preview.forward_port',
      // Terminal tools
      'terminal_create_session': 'terminal.create_session',
      'terminal_send_input': 'terminal.send_input',
      'terminal_get_output': 'terminal.get_output',
      'terminal_resize': 'terminal.resize',
      'terminal_close_session': 'terminal.close_session',
      'terminal_list_sessions': 'terminal.list_sessions',
      // Project analysis tools
      'project_analyze': 'workspace.analyze',
      'project_list_scripts': 'workspace.list_scripts',
      'project_dependencies': 'workspace.dependencies',
      'project_structure': 'workspace.structure',
      // Port status
      'port_status': 'terminal.get_port_status',
      // Workspace graph tools
      'workspace_graph': 'workspace.graph',
      'workspace_graph_diagnostic': 'workspace.graph_diagnostic',
      'workspace_graph_find_process': 'workspace.graph_find_process',
      // Legacy mappings (from extended-sandbox-tools EXTENDED_TOOL_TO_CAPABILITY)
      'exec_shell': 'bash.execute',
    };

    const capabilityId = capabilityMap[name] || name;

    if (await hasToolCapability(capabilityId)) {
      const toolStartTime = Date.now();
      log.debug('Executing tool via capability', { tool: name, capability: capabilityId });
      // FIX: Pass conversationId as sessionId for VFS session scoping
      // Also pass scopePath for proper VFS file operation scoping
      const capResult = await executeToolCapability(capabilityId, args, {
        userId: config.userId || 'system',
        sessionId: config.conversationId,  // FIX: Session scoping for VFS
        scopePath: config.conversationId ? `workspace/sessions/${config.conversationId}` : undefined,  // FIX: VFS scope path
        workspaceId: config.projectContext?.id,
      });

      // FIX 12: Detect scope/permission violations — mark them so the agent loop
      // does NOT trigger provider fallback. These are app-level errors.
      const capOutputRaw = capResult.output ?? capResult.error ?? "";
      const capOutput = typeof capOutputRaw === 'string' ? capOutputRaw : JSON.stringify(capOutputRaw);
      const isScopeViolation =
        capOutput.includes("PATH_NOT_FOUND") ||
        capOutput.includes("outside the allowed scope") ||
        capOutput.includes("SCOPE_VIOLATION") ||
        capOutput.includes("PERMISSION_DENIED") ||
        capOutput.includes("ACCESS_DENIED") ||
        capOutput.includes("not permitted");
      const scopeNote = isScopeViolation
        ? " [SCOPE_ERROR: scope violation, not a provider failure. Changing LLM providers will not fix this.]"
        : "";

      const toolDuration = Date.now() - toolStartTime;
      const toolResult: ToolResult = { success: capResult.success, output: (typeof capOutputRaw === 'string' ? capOutputRaw : JSON.stringify(capOutputRaw)) + scopeNote, exitCode: capResult.exitCode };
      logToolCall(name, rawArgs, toolResult, toolDuration, config.onStreamChunk);
      return toolResult;
    }

    log.debug('Capability not found, falling back to original executor', { tool: name, capability: capabilityId });
    if (config.executeTool) {
      return config.executeTool(name, args);
    }
    log.warn('No tool executor available', { tool: name, capability: capabilityId });
    return { success: false, output: 'No tool executor available', exitCode: 1 };
  };
}

/**
 * Check if a tool invocation result indicates failure, even when the tool
 * execution itself succeeded. MCP filesystem tools wrap application-level
 * failures inside `output` as a JSON string (e.g.
 * `{success:false, exists:false, error: {code:'PATH_NOT_FOUND', ...}}`),
 * while the top-level `result.success` stays `true` because the function
 * call didn't throw.
 *
 * Detection chain (first match wins):
 *   Top-level: result.success === false
 *   Error field: result.error is truthy
 *   JSON output: typeof result.output === 'string' && parsed.success === false
 *   Nested output: typeof result.output === 'object' && result.output.output
 *                  is a JSON string with parsed.success === false
 */
function isFailedToolInvocation(inv: { result?: any; toolName?: string }): boolean {
  if (!inv?.result) return false;
  const r = inv.result;
  // Direct success flag
  if (r.success === false) return true;
  // Error field present
  if (r.error) return true;
  // Check output string that might be JSON with success:false
  if (typeof r.output === 'string') {
    try {
      const parsed = JSON.parse(r.output);
      if (parsed && parsed.success === false) return true;
    } catch { /* not JSON, ignore */ }
  }
  // MCP gateway may nest result in output.output
  if (r.output && typeof r.output === 'object') {
    if (r.output.success === false) {
      log.warn('[ToolNestedFail] Detected nested success=false in output object', {
        tool: inv.toolName,
        nestedError: (r.output as any).error,
        nestedErrorCode: (r.output as any).error?.code,
      });
      return true;
    }
    if (typeof r.output.output === 'string') {
      try {
        const parsed = JSON.parse(r.output.output);
        if (parsed && parsed.success === false) {
          log.warn('[ToolNestedFail] Detected nested success=false in output.output JSON', {
            tool: inv.toolName,
            nestedError: parsed.error,
            nestedErrorCode: parsed.error?.code,
          });
          return true;
        }
      } catch { /* not JSON, ignore */ }
    }
  }
  return false;
}

/**
 * Run V1 API with tool support
 */
async function runV1ApiWithTools(
  config: UnifiedAgentConfig,
  messages: Array<{ role: string; content: string }>,
  startTime: number
): Promise<UnifiedAgentResult> {

  // === SESSION TRACKING FOR SUCCESSIVE CALLS ===
  const sessionId = config.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const feedbackContext: FeedbackContext = {
    sessionId,
    turnNumber: 0,
    accumulatedFeedback: [],
    recentFailures: [],
    corrections: [],
  };
  // @ts-ignore - tracker API may vary
  // === END SESSION TRACKING ===
  // Ensure tool system is initialized for capability-based execution
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: config.userId || 'system', enableMCP: true, enableSandbox: true });
  }

  log.info('[V1-API-WITH-TOOLS] ┌─ ENTRY ──────────────────────────');

  // Use the shared capability-based tool executor (avoids code duplication)
  const capabilityExecuteTool = createCapabilityToolExecutor(config);
  // FIX: Use shared dynamic defaults resolver instead of hardcoded mistral
  // Win #2b (docs/async-parallelization-opportunities.md): Promise.all the cache
  // hit (microsecond return) with the linked PROVIDERS dynamic import. Both ops
  // are independent — resolveDynamicDefaults reads only _cachedDynamicDefaults +
  // env, llm-providers is a pure module load. Saves ~5-30ms on cold cache miss
  // (when both must be awaited) and ~5-30ms on warm-cache requests (where the
  // import was previously sequential after a near-zero cache hit).
  const [_dynamicDefaults, _llmProvidersMod] = await Promise.all([
    resolveDynamicDefaults(),
    import('../providers/llm-providers'),
  ]);
  // Bug #12 (Pass-8): Check session-scoped provider cache first. If a previous
  // request in this conversation found a working provider, prefer it over the
  // default to avoid re-hitting the 429'd primary every time.
  const sessionProvider = getLastWorkingProvider(config.conversationId);
  const primaryProvider = config.provider || sessionProvider?.provider || _dynamicDefaults.provider;
  const primaryModel = config.model || sessionProvider?.model || _dynamicDefaults.model;
  // FIX: Reset SelfHeal cache at start of each request to prevent cross-request
  // leakage. Without this, a prior request's fallback provider could silently
  // replace a healthy primary in a different request's SelfHeal retry.
  _selfHealProvider = null;
  _selfHealModel = null;
  resetSessionPermanentFailures();
  resetClientDisconnected();

  const requestId = `unified-v1-tools-${Date.now()}`;

  log.info('[V1-API-WITH-TOOLS] │ primaryProvider:', primaryProvider);
  log.info('[V1-API-WITH-TOOLS] │ primaryModel:', primaryModel);
  log.info('[V1-API-WITH-TOOLS] │ requestId:', requestId);
  log.info('[V1-API-WITH-TOOLS] │ config.tools?.length:', config.tools?.length);
  log.info('[V1-API-WITH-TOOLS] │ messageCount:', messages.length);
  log.info('[V1-API-WITH-TOOLS] │ messagePreview:', messages[messages.length - 1]?.content?.slice(0, 100));
  log.info('[V1-API-WITH-TOOLS] └────────────────────────────────────');

  // FIX: Model normalization — when falling back to a different provider,
  // the original model name may not be valid for the fallback provider.
  // Check if the model is in the provider's supported models list; if not,
  // use the provider's default instead.
  const { PROVIDERS } = _llmProvidersMod;

  // FIX: Normalize model name for Vercel provider by stripping 'vercel:' prefix if present
  function getModelForProvider(providerName: string): string {
    const model = config.model || primaryModel;

    // Get first model from provider's own model list (always valid for that provider)
    // Uses PROVIDERS from the closure scope (dynamic import above)
    function _getProviderFirstModel(pn: string): string | undefined {
      const p = PROVIDERS[pn.toLowerCase()];
      if (p?.models && Array.isArray(p.models) && p.models.length > 0) {
        const first = p.models[0];
        return typeof first === 'string' ? first : first?.id;
      }
      return undefined;
    }

    // If no explicit model set, use model-ranker's highest-ranked model first,
    // then provider default, then first model from provider's own list
    // CRITICAL: NEVER fall back to primaryModel for a different provider — that leaks
    // the original provider's model ID to the new provider's API, causing 400 errors.
    if (!config.model) {
      // Use model-ranker telemetry to select highest-ranked model for this provider
      const rotation = mrMod?.getModelForRotation?.(undefined, providerName);
      if (rotation?.model) return rotation.model;
      return PROVIDER_DEFAULT_MODELS[providerName] || _getProviderFirstModel(providerName);
    }

    // FIX: When falling back FROM ninerouter TO a different provider (nvidia, mistral, etc.),
    // the model from ninerouter (e.g. "nvidia/minimaxai/minimax-m2.7") is NOT valid for the
    // fallback provider. If the model isn't in the provider's list, use model-ranker to pick
    // the best model for that provider. NEVER pass the primary's model to a fallback provider.
    const provider = PROVIDERS[providerName.toLowerCase()];
    if (provider?.models && Array.isArray(provider.models) && provider.models.length > 0) {
      // Normalize models to handle both string and object formats
      const supportedModels = provider.models.map((entry: any) =>
        typeof entry === 'string' ? entry : entry?.id
      ).filter(Boolean);
      
      if (supportedModels.includes(model)) return model;
      // Model not in provider's list — use model-ranker's highest-ranked or provider's own model
      log.debug(`Model "${model}" not in ${providerName} models list, using provider's own model`);
      const rotation = mrMod?.getModelForRotation?.(undefined, providerName);
      if (rotation?.model) return rotation.model;
      // FIX: NEVER return the primary's model for a different provider.
      // Use provider default or first model instead.
      return PROVIDER_DEFAULT_MODELS[providerName] || _getProviderFirstModel(providerName) || PROVIDER_DEFAULT_MODELS[providerName];
    }

    // Unknown provider — trust the config model
    return model;
  }

  // Build provider fallback chain — only include providers with API keys set
  const fallbackChain = getConfiguredFallbackChain(primaryProvider);
  const providersToTry = [primaryProvider, ...(Array.isArray(fallbackChain) ? fallbackChain : [])];
  const uniqueProviders = [...new Set(providersToTry)];

  log.info('[V1-API-WITH-TOOLS] ┌─ PROVIDER FALLBACK CHAIN ────────');
  log.info(`[V1-API-WITH-TOOLS] │ primary: ${primaryProvider}/${primaryModel}`);
  log.info('[V1-API-WITH-TOOLS] │ configured fallbacks:', fallbackChain);
  log.info('[V1-API-WITH-TOOLS] │ will try (deduped):', uniqueProviders);
  log.info('[V1-API-WITH-TOOLS] └────────────────────────────────────');

  let lastError: Error | null = null;

  // FIX: Import circuit-breaker and model-ranker for smart provider selection
  let circuitBreakerMgr: any = null;
  let mrMod: any = null;
  let modelRankerFns: { isRateLimited: (p: string, m: string) => boolean; recordRateLimitError: (p: string, m: string) => void; recordModelAttempt: (p: string, m: string, s: boolean) => void; hasInsufficientTokenLimit?: (p: string, m: string, tokens: number) => boolean; getModelTokenLimit?: (p: string, m: string) => number | undefined; recordModelTokenLimit?: (p: string, m: string, limit: number) => void; recordModelContextLimitError?: (p: string, m: string, limit: number) => void } | null = null;
  try {
    const cbMod = await import('../middleware/circuit-breaker');
    circuitBreakerMgr = cbMod.circuitBreakerManager;
  } catch { /* circuit-breaker unavailable */ }

  // FIX: Reset circuit breakers on first request of new session to prevent blocking
  // Track first requests per provider to avoid memory leaks
  // Use primaryProvider as the key (not random sessionId) so OPEN circuits
  // are genuinely reset once per provider per process lifetime, not on every request.
  const firstRequestKey = `first-${primaryProvider}`;
  if (!(global as any).__circuitBreakerFirstRequest) {
    (global as any).__circuitBreakerFirstRequest = new Set();
  }
  const firstRequestSet = (global as any).__circuitBreakerFirstRequest as Set<string>;
  
  // Limit Set size to prevent memory leaks (evict oldest entries)
  if (firstRequestSet.size > 100) {
    const oldest = firstRequestSet.values().next().value;
    if (oldest) firstRequestSet.delete(oldest);
  }
  
  const isFirstRequestThisSession = !firstRequestSet.has(firstRequestKey);
  if (isFirstRequestThisSession) {
    firstRequestSet.add(firstRequestKey);
  }
  try {
    mrMod = await import('../providers/model-ranker');
    modelRankerFns = {
      isRateLimited: mrMod.isRateLimited,
      recordRateLimitError: mrMod.recordRateLimitError,
      recordModelAttempt: mrMod.recordModelAttempt,
      hasInsufficientTokenLimit: mrMod.hasInsufficientTokenLimit,
      getModelTokenLimit: mrMod.getModelTokenLimit,
      recordModelTokenLimit: mrMod.recordModelTokenLimit,
      recordModelContextLimitError: mrMod.recordModelContextLimitError,
    };
  } catch { /* model-ranker unavailable */ }

  // FIX: Run RAG retrieval ONCE per request, not per provider.
  // Moving this outside the provider loop saves ~7-364ms × N providers.
  let ragContext = '';
  try {
    const ragResult = await runRetrievalPipeline(config.userMessage, {
      topK: 3,
      coarseTopN: 10,
      minQuality: 0.3,
      includeSource: false,
      maxTokens: 1500,
    });
    if (ragResult.hasResults) {
      ragContext = ragResult.context;
      log.info('[V1-API-WITH-TOOLS] RAG knowledge injected', {
        chunks: ragResult.chunks.length,
        tokens: ragResult.estimatedTokens,
        avgScore: ragResult.metadata.avgScore.toFixed(3),
        durationMs: ragResult.metadata.durationMs,
      });
    }
  } catch (error) {
    // FIX: Track tool failure for feedback injection
    const failureEntry = createFeedbackEntry(
      'failure',
      `RAG retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
      'tool_execution',
      { error: String(error) },
      'medium'
    );
    feedbackContext.turnNumber++;
    addFeedback(feedbackContext, failureEntry);
    log.info('[Feedback-Inject] RAG failure tracked', {
      severity: failureEntry.severity,
    });

    log.warn('[V1-API-WITH-TOOLS] RAG retrieval failed, continuing without it', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Try each provider in order — with circuit-breaker and rate-limit awareness
  for (const providerName of uniqueProviders) {
    // GUARD: If client disconnected, skip ALL provider attempts.
    if (isClientDisconnected()) {
      log.warn("[V1-API] Client already disconnected - breaking provider loop immediately");
      break;
    }

    const modelForProvider = getModelForProvider(providerName);

    // FIX: Skip providers with open circuit breakers (unless first request of session)
    if (circuitBreakerMgr) {
      const breaker = circuitBreakerMgr.getBreaker(providerName);
    if (is530Blacklisted(providerName) || isServerErrorBlacklisted(providerName)) { log.warn("530 BLACKLISTED, skipping " + providerName); continue; }
      if (breaker.getState() === 'OPEN' && breaker.getRetryAfter() > 0) {
        // On first request of session, reset OPEN circuit instead of skipping
        if (isFirstRequestThisSession) {
          breaker.reset();
          log.info('[V1-API-WITH-TOOLS] │ First request - reset OPEN circuit for provider', { provider: providerName });
        } else {
          log.warn('[V1-API-WITH-TOOLS] ┌─ CIRCUIT OPEN ─────────────────');
          log.warn(`[V1-API-WITH-TOOLS] │ provider: ${providerName} (circuit BLOCKED, retry after ${breaker.getRetryAfter()}ms)`);
          log.warn('[V1-API-WITH-TOOLS] └────────────────────────────────');
          continue; // Skip this provider
        }
      }
    }

    // Skip providers that permanently failed earlier in this request (e.g. missing API key,
    // invalid auth, model not found). Retrying will never help — skip to save time.
    if (isProviderPermanentlyFailed(providerName)) {
      log.debug("[V1-API-WITH-TOOLS] │ provider: " + providerName + " skipped — permanently failed earlier in this request");
      continue;
    }

    // Bug #116/#90: Skip providers with an open transient circuit breaker.
    // Unlike permanent failures, these auto-recover after the TTL window expires.
    if (isProviderCircuitBroken(providerName)) {
      log.debug("[V1-API-WITH-TOOLS] │ provider: " + providerName + " skipped — transient circuit breaker open");
      continue;
    }
    // FIX: Skip models that are rate-limited per model-ranker
    if (modelRankerFns?.isRateLimited(providerName, modelForProvider)) {
      log.warn('[V1-API-WITH-TOOLS] ┌─ RATE LIMITED ────────────────');
      log.warn(`[V1-API-WITH-TOOLS] │ provider: ${providerName}/${modelForProvider} (rate limited, skipping)`);
      log.warn('[V1-API-WITH-TOOLS] └────────────────────────────────');
      continue; // Skip this provider/model
    }

    // FIX: Skip models with insufficient token limits (from previous 413 errors)
    if (modelRankerFns?.hasInsufficientTokenLimit) {
      // Estimate token count (rough approximation: 1 token ≈ 4 chars)
      const estimatedTokens = Math.ceil(
        (JSON.stringify(messages).length + 
         JSON.stringify(config.tools || []).length + 
         (config.systemPrompt?.length || 0)) / 4
      );
      
      if (modelRankerFns.hasInsufficientTokenLimit(providerName, modelForProvider, estimatedTokens)) {
        const tokenLimit = modelRankerFns.getModelTokenLimit?.(providerName, modelForProvider);
        log.warn('[V1-API-WITH-TOOLS] ┌─ TOKEN LIMIT EXCEEDED ────────');
        log.warn(`[V1-API-WITH-TOOLS] │ provider: ${providerName}/${modelForProvider}`);
        log.warn(`[V1-API-WITH-TOOLS] │ estimated: ${estimatedTokens} tokens`);
        log.warn(`[V1-API-WITH-TOOLS] │ limit: ${tokenLimit} tokens`);
        log.warn('[V1-API-WITH-TOOLS] │ skipping (would result in 413)');
        log.warn('[V1-API-WITH-TOOLS] └────────────────────────────────');
        continue; // Skip this provider/model
      }
    }

    log.info('[V1-API-WITH-TOOLS] ┌─ ATTEMPT ─────────────────────');
    log.info('[V1-API-WITH-TOOLS] │ provider:', providerName);
    log.info('[V1-API-WITH-TOOLS] │ model:', modelForProvider);
    log.info('[V1-API-WITH-TOOLS] │ isFirst:', providerName === primaryProvider);
    log.info('[V1-API-WITH-TOOLS] │ circuitState:', getCircuitStateName(circuitBreakerMgr?.getBreaker(providerName)?.getState() || 'HEALTHY') as any);
    log.info('[V1-API-WITH-TOOLS] └────────────────────────────────');

    const toolInvocations: Array<{
      toolCallId: string;
      toolName: string;
      args: Record<string, any>;
      result: any;
    }> = [];

    const loopState = createLoopDetectorState();

    const aiSdkTools = Object.fromEntries(
      // FIX: Exclude 'choose_role' from config.tools — it's registered separately
      // below with its own execute handler (chooseRoleCapability). Without this
      // filter, the loop wraps choose_role through capabilityExecuteTool which
      // doesn't know it, and the !aiSdkTools['choose_role'] guard below becomes
      // a no-op since the entry already exists.
      (config.tools || []).filter((td: any) => td.name !== 'choose_role').map((toolDef: any) => [
        toolDef.name,
        {
          description: toolDef.description,
          // AI SDK v6 reads `tool.inputSchema` (not `parameters`). If a JSON
          // Schema object is passed without an explicit `type`, providers like
          // Azure OpenAI reject it with "schema must be a JSON Schema of
          // 'type: \"object\"', got 'type: \"None\"'". See
          // `normalizeSchemaForAI` in `@bing/shared/agent/tool-schema`.
          inputSchema: normalizeSchemaForAI(toolDef.parameters),
          execute: async (rawArgs: Record<string, any>) => {
            // Normalize args to fix common LLM mistakes (wrong field names, etc.)
            const args = normalizeToolArgs(toolDef.name, rawArgs) as Record<string, any>;
            const toolResult = await capabilityExecuteTool(toolDef.name, args);
            // FIX: Track tool call for successive tracking
            recordToolCall(sessionId);
            
            // FIX: Check for re-evaluation trigger
            const reEvalTrigger = checkReEvalTrigger(sessionId);
            if (reEvalTrigger.triggered) {
              log.info("[ReEval-V1] Trigger detected", { reason: reEvalTrigger.reason });
              recordReEval(sessionId);
            }
            config.onToolExecution?.(toolDef.name, args, toolResult);

            // Track for no-progress loop detection
            // Bug #111/#84: Pass the real error string so loop-abort steer has
            // concrete failure history instead of empty/placeholder entries.
            // Use extractToolError helper + fallback to output for cases where
            // the error message lives in output rather than the error field.
            const toolErrorMsg =
              extractToolError(toolResult) ||
              (typeof toolResult.output === 'string' ? toolResult.output : undefined);
            const loopMsg = recordStepAndCheckLoop(loopState, toolDef.name, args, toolResult.success, toolErrorMsg);
            if (loopMsg) {
              log.warn(`[V1-API-WITH-TOOLS] Loop detected: ${loopMsg}`);
              // Bug #41: emit categorized loop-abort steer so the LLM knows WHY
              // the loop was triggered (binary_missing, tool_failing, mixed, unknown)
              // and gets a concrete suggestion for what to do next.
              const abortSteer = wireLoopAbortSteer({
                consecutive: loopState.consecutiveFailures,
                recentFailures: loopState.recentFailures.slice(-3).map((f: any) => ({
                  name: f.toolName || toolDef.name,
                  error: f.error || 'unknown',
                })),
              });
              const steerSuffix = abortSteer ? `\n\n${abortSteer.steer}` : '';
              return {
                success: false,
                output: loopMsg + steerSuffix,
                exitCode: 1,
                error: loopMsg + steerSuffix,
                _agentShouldStop: true,
                _loopAbort: abortSteer?.abort,
              };
            }

            return {
              success: toolResult.success,
              output: toolResult.output,
              exitCode: toolResult.exitCode,
              error: toolResult.error,
            };
          },
        },
      ]),
    );

    // Add built-in choose_role tool — enables dynamic role redirection.
    // Bug #18 fix (BUGS2.md): the dynamic import previously silently failed (empty
    // catch) leaving choose_role absent from aiSdkTools for the entire session.
    // The model never sees it and never calls it. The fix guarantees the tool
    // is present by: (a) falling back to a minimal stub if the import fails, and
    // (b) skipping the conditional entirely when the tool is already registered.
    if (!aiSdkTools['choose_role']) {
      try {
        const { chooseRoleCapability } = await import('@/lib/chat/tools/choose-role-tool');
        aiSdkTools['choose_role'] = chooseRoleCapability;
        log.info('[V1-API-WITH-TOOLS] choose_role tool registered');
      } catch (err) {
        // Bug #18 fix: provide a minimal fallback stub so the tool is still
        // available even if the full capability module fails to load.
        log.warn('[V1-API-WITH-TOOLS] chooseRoleCapability unavailable — using fallback stub', {
          error: err instanceof Error ? err.message : String(err),
        });
        aiSdkTools['choose_role'] = {
          description: 'choose_role(role: string) — Switch the AI\'s role or specialty. Use this when a task requires expertise you haven\'t seen applied yet (e.g., architect, reviewer, researcher, security expert). Example: choose_role(role="security-expert")',
          inputSchema: {
            type: 'object',
            properties: {
              role: { type: 'string', description: 'Role to switch to (e.g. "architect", "reviewer", "researcher", "security-expert", "devops-engineer")' },
              reason: { type: 'string', description: 'Optional reason for the role switch' },
            },
            required: ['role'],
          },
          execute: async ({ role, reason }: { role: string; reason?: string }) => {
            return {
              success: true,
              role,
              switched: true,
              message: `Role switched to "${role}". ${reason ? `Reason: ${reason}` : ''}`,
            };
          },
        };
      }
    }

    const llmMessages: any[] = [];

    // RAG context is now computed once per request (above the provider loop).
    // Reused across all provider fallback attempts — no redundant retrieval.

    // Pre-build workspace snapshot to give the model real file paths
    let workspaceSnippet = '';
    try {
      const userId = config.userId || config.filesystemOwnerId || 'default';
      const snapshot = await buildWorkspaceSnapshot(userId);
      if (snapshot && !snapshot.includes('unavailable') && !snapshot.includes('empty')) {
        workspaceSnippet = `\n\n### Existing Files in Workspace\n${snapshot}\n\nUse ONLY these paths (or new paths you create). Do NOT guess file paths.\n`;
      }
    } catch { /* best effort */ }

    // Build system prompt: role-based composition OR raw string + RAG context
    if (config.role) {
      // Use the prompt-composer to build from a role template with dynamic tools
      const toolIds = (config.tools || []).map((t: any) => t.name);
      const composedPrompt = composeRoleWithTools(config.role, {
        availableTools: toolIds,
        extras: ragContext ? [{ id: 'rag.knowledge', template: ragContext }] : undefined,
      }) ?? '';
      if (composedPrompt !== null) { llmMessages.push({ role: 'system', content: composedPrompt + workspaceSnippet }); }
      log.info('[V1-API-WITH-TOOLS] Composed role prompt', {
        role: config.role,
        toolCount: toolIds.length,
        promptLength: composedPrompt?.length ?? 0,
        // @audit pinned field name composedPromptSource
        composedPromptSource: stringOrNullToPromptSource(composedPrompt),
        hasRag: !!ragContext,
      });

      // Log tool broadening if more than the usual set
      if (toolIds.length > 10) {
        log.info('\x1b[35m[Tool-Broadening]\x1b[0m 🚀 System has BROADENED tool access', {
          count: toolIds.length,
          tools: toolIds.slice(0, 15).join(', ') + (toolIds.length > 15 ? '...' : '')
        });
      }
    } else if (config.systemPrompt) {
      let systemContent = config.systemPrompt + ragContext + workspaceSnippet;
      // FIX: Inject dynamic feedback and tracker summary into system prompt for self-routing
      if ((config as any)._injectedFeedback || (config as any)._trackerSummary) {
        const injected = (config as any)._injectedFeedback;
        const trackerSummary = (config as any)._trackerSummary;
        const feedbackParts = [];
        if (injected?.correctionSection) feedbackParts.push(injected.correctionSection);
        if (injected?.healingInstructions) feedbackParts.push(injected.healingInstructions);
        if (injected?.formatGuidance) feedbackParts.push(injected.formatGuidance);
        if (trackerSummary) feedbackParts.push(trackerSummary);
    if ((config as any)._healingPrompt) feedbackParts.push((config as any)._healingPrompt);
        if (feedbackParts.length > 0) {
          systemContent += '\n\n' + feedbackParts.join('\n\n');
          log.info('\x1b[32m[V1-API-WITH-TOOLS]\x1b[0m 🧠 Injected feedback into system prompt', { 
            hasCorrection: !!injected?.correctionSection,
            hasHealing: !!injected?.healingInstructions,
            hasFormatGuidance: !!injected?.formatGuidance,
            hasTrackerSummary: !!trackerSummary
          });
          
          if (injected?.correctionSection) {
            log.debug('[Feedback-Content] Correction:', injected.correctionSection.slice(0, 100) + '...');
          }
        }
      }
      llmMessages.push({ role: 'system', content: systemContent });
    } else if (ragContext) {
      llmMessages.push({ role: 'system', content: `You are an AI coding assistant.${ragContext}${workspaceSnippet}` });
    }
    llmMessages.push(...messages);

    // Auto-inject powers are already applied at the entry point via
    // appendAutoInjectPowers(config.conversationHistory, ...).
    // The `messages` array already contains the injected user message.
    // Dedup guard in appendAutoInjectPowers prevents double injection.

    let response = '';
    // Bug #21 (Pass-8): Phase 1 time-budget. If the stream produces >5K chars
    // of text with 0 tool calls and exceeds 30s, abort early — the model is
    // clearly writing everything in prose and the Phase 2 text-mode extraction
    // can handle what's already been collected. Without this guard, the user
    // waits 92s for a single skeleton response.
    const _phase1StartTime = Date.now();
    const _PHASE1_BUDGET_MS = parseInt(process.env.V1_PHASE1_BUDGET_MS || '30000', 10);
    const _PHASE1_TEXT_THRESHOLD = parseInt(process.env.V1_PHASE1_TEXT_THRESHOLD || '5000', 10);

    try {
      log.info('[V1-API-WITH-TOOLS] Calling streamWithConcurrentFallback...');
      const { streamWithConcurrentFallback } = await import('../chat/enhanced-llm-service');

      for await (const chunk of streamWithConcurrentFallback({
        provider: providerName,
        model: modelForProvider,
        messages: llmMessages,
        temperature: config.temperature || 0.7,
        maxTokens: config.maxTokens || 65536,
        maxSteps: config.maxSteps || 15,
        tools: aiSdkTools,
        toolCallStreaming: true,
        // Forward the caller's abort signal so (a) a user-initiated stop
        // truly cancels the upstream HTTP request and (b) the fallback
        // coordinator's user-abort race arm is actually wired. Without
        // this the request hangs for the full ~4-min idle ceiling even
        // after the user presses stop. See UnifiedAgentConfig.abortSignal.
        signal: config.abortSignal,
      })) {
        if (chunk.content) {
          response += chunk.content;
          config.onStreamChunk?.(chunk.content);
          // Bug #21 (Pass-8): Phase 1 time-budget check. If we have lots of
          // text but zero tool calls and the budget is exceeded, abort early.
          if (toolInvocations.length === 0 && response.length > _PHASE1_TEXT_THRESHOLD && Date.now() - _phase1StartTime > _PHASE1_BUDGET_MS) {
            log.warn('[V1-API-WITH-TOOLS] Phase 1 time-budget exceeded — aborting early (text-only, no tools)', {
              responseLength: response.length,
              durationMs: Date.now() - _phase1StartTime,
            });
            break;
          }
        }

        if (chunk.toolInvocations) {
          for (const invocation of chunk.toolInvocations) {
            if (invocation.state !== 'result') continue;
            toolInvocations.push({
              toolCallId: invocation.toolCallId,
              toolName: invocation.toolName,
              args: (invocation.args as Record<string, any>) || {},
              result: invocation.result ?? { success: false, error: 'Tool result was undefined' }, // Ensure result is not undefined
            });          }
        }
      }

      // Empty-completion guard: if no response and no tool invocations, return gracefully
      // instead of throwing. Throwing triggers the provider-fallback chain (other models
      // get tried), which wastes API calls. A graceful empty return lets Phase 2 text-mode
      // fallback kick in immediately at the caller level.
      if (!response.trim() && toolInvocations.length === 0) {
        log.warn(`[V1-API-WITH-TOOLS] Empty completion from ${providerName}/${modelForProvider} — no text and no tool calls, falling back to text-mode`);
        return {
          success: true,
          response: '',
          steps: [],
          totalSteps: 0,
          mode: 'v1-api',
          metadata: {
            provider: providerName,
            model: modelForProvider,
            duration: Date.now() - startTime,
            isEmptyResponse: true,
            emptyReason: `model returned no text and no tool calls`,
          },
        };
      }

      // AUTO-CONTINUATION: When the model used read-only tools (read, search, list, glob)
      // but stopped without writing, editing, or creating files, it likely investigated the
      // codebase and then stopped prematurely. Re-prompt up to 2 times to continue work.
      // Check for [ROLE_SELECT] marker — if present, client-side auto-continue
      // via stepReprompt already handles it. Don't double-trigger.
      const hasRoleSelectMarker = response.includes('[ROLE_SELECT]') || response.includes('[ROUTING_METADATA]');

      // Counter cleanup is handled by the second continuation loop (L5191).
      // The pre-check loop was removed — it called decideAutoContinue without
      // re-invoking the LLM, wasting the continuation budget on a no-op.

      const duration = Date.now() - startTime;
      const steps = toolInvocations.map((invocation) => ({
        toolName: invocation.toolName,
        args: invocation.args,
        result: {
          success: invocation.result?.success !== false,
          output: invocation.result?.output ?? invocation.result?.error ?? JSON.stringify(invocation.result ?? {}),
          exitCode: invocation.result?.exitCode ?? (invocation.result?.success === false ? 1 : 0),
        },
      }));

      log.info('[V1-API-WITH-TOOLS] ┌─ STREAM COMPLETE ────────────');
      log.info('[V1-API-WITH-TOOLS] │ provider:', providerName);
      log.info('[V1-API-WITH-TOOLS] │ model:', modelForProvider);
      log.info(`[V1-API-WITH-TOOLS] │ duration: ${duration} ms`);
      log.info(`[V1-API-WITH-TOOLS] │ responseLength: ${response.length}`);
      log.info(`[V1-API-WITH-TOOLS] │ toolInvocations: ${toolInvocations.length}`);
      log.info(`[V1-API-WITH-TOOLS] │ tools: ${toolInvocations.map(t => t.toolName).join(', ') || 'none'}`);
      // Bug #117 fix: classify response shape so "tools_only" vs "empty"
      // is distinguishable (Bug #91 canonical helper, see classifying test).
      const responseShape = classifyResponseShape({
        response,
        toolCalls: toolInvocations.map((inv) => ({ name: inv.toolName, args: inv.args })),
      });
      log.info(`[V1-API-WITH-TOOLS] │ responseShape: ${responseShape}${responseShape === 'empty' ? ' (suspicious — log a WARN)' : ''}`);
      // Bug #117: by Bug #91 canonical semantics this also fires for
      // whitespace-only responses (was previously logged as 'text' under
      // the old local ternary). See classifyResponseShape contract.
      if (responseShape === 'empty') {
        log.warn('[V1-API-WITH-TOOLS] Empty response with no tool calls — possible stall pattern', { requestId, provider: providerName, model: modelForProvider });
      }
      log.info('[V1-API-WITH-TOOLS] └────────────────────────────────');

      // FIX: Record success in circuit-breaker and model-ranker after stream completion
      if (circuitBreakerMgr) {
        try { circuitBreakerMgr.getBreaker(providerName).recordSuccess(); } catch { /* ignore */ }
      }
      if (modelRankerFns) {
        try { modelRankerFns.recordModelAttempt(providerName, modelForProvider, true); } catch { /* ignore */ }
      }

      if (providerName !== primaryProvider) {
      // FIX: Save successful provider/model for SelfHeal retries to skip dead primary
      _selfHealProvider = providerName;
      _selfHealModel = modelForProvider;
      // Bug #12 (Pass-8): Cache per-session so subsequent requests reuse the
      // working provider instead of hitting the 429'd primary every time.
      if (config.conversationId) {
        recordLastWorkingProvider(config.conversationId, providerName, modelForProvider);
      }
        log.info(`V1 API (with tools): Fallback provider succeeded`, {
          primaryProvider,
          primaryModel,
          fallbackProvider: providerName,
          fallbackModel: modelForProvider,
        });
      }

      // Text-mode file extraction: if response has text but no tool calls,
      // parse for ```file: / ```diff: blocks and apply to VFS
      // Bug #4 (Pass-8): Use canonical ownerId construction (userId$conversationId
      // format) and always prepend scopePath. Bare paths like "src/agent.js"
      // get prepended server-side so VFS normalizePath never rejects them.
      if (response && toolInvocations.length === 0) {
        try {
          const { extractFileEdits } = await import('../chat/file-edit-parser');
          const { virtualFilesystem } = await import('../virtual-filesystem/index.server');
          const textEdits = extractFileEdits(response);
          if (textEdits.length > 0) {
            const ownerId = config.filesystemOwnerId
              || (config.userId ? `${config.userId}$${config.conversationId || 'default'}` : 'default');
            const scopePrefix = config.scopePath || 'workspace';
            for (const edit of textEdits) {
              if (edit.path && edit.content) {
                // Bug #20: Session cross-contamination guard. If the LLM's
                // extracted path references a different session folder
                // (e.g. workspace/sessions/001/... when current is 002),
                // rewrite it to use the current session prefix.
                let editPath = edit.path;
                const sessionMatch = editPath.match(/^workspace\/sessions\/(\d{3,})\//);
                const currentSessionId = config.conversationId || '';
                if (sessionMatch && sessionMatch[1] !== currentSessionId) {
                  log.info('[V1-API-WITH-TOOLS] Cross-session path detected — rewriting to current session', {
                    originalPath: editPath,
                    rewritenSession: currentSessionId,
                  });
                  editPath = editPath.replace(
                    `workspace/sessions/${sessionMatch[1]}`,
                    `workspace/sessions/${currentSessionId}`,
                  );
                }
                if (!editPath.startsWith(scopePrefix)) {
                  editPath = `${scopePrefix}/${editPath}`;
                }
                try {
                  await virtualFilesystem.writeFile(ownerId, editPath, edit.content);
                } catch { /* best effort */ }
              }
            }
            log.info(`[V1-API-WITH-TOOLS] Text-mode fallback: extracted ${textEdits.length} file edits from response text`, {
              paths: textEdits.map(e => e.path),
            });
          }
        } catch { /* text extraction is best-effort */ }
      }

      // FIX: Record comprehensive telemetry with tool execution data
      const toolCallTelemetry = toolInvocations.map(inv => ({
        toolCallId: inv.toolCallId,
        toolName: inv.toolName,
        state: 'result' as const,
        args: inv.args,
        result: inv.result,
        success: inv.result?.success !== false,
      }));

      // Bug #117 fix: classify response shape so "tools_only" vs "empty"
      // is distinguishable (Bug #91 canonical helper, see classifying test).
      // Local keeps the `telemetry` prefix because site 1 above declares
      // `responseShape` in this same function scope.
      const telemetryResponseShape = classifyResponseShape({
        response,
        toolCalls: toolCallTelemetry.map((inv) => ({ name: inv.toolName, args: inv.args })),
      });

      log.info('[Telemetry-v1Api] Recording completion', {
        requestId,
        provider: providerName,
        model: modelForProvider,
        duration,
        toolCount: toolCallTelemetry.length,
        responseLength: response.length,
        responseShape: telemetryResponseShape,
      });

      chatRequestLogger.logRequestComplete(
        requestId,
        true,
        undefined,
        undefined,
        duration,
        undefined,
        providerName,
        modelForProvider,
        toolCallTelemetry.length > 0 ? toolCallTelemetry : undefined,
        response.length,
      ).catch((err) => {
        log.error('[Telemetry-v1Api] logRequestComplete failed', { error: err?.message || err });
      });

      // Log telemetry summary to console
      if (toolCallTelemetry.length > 0) {
        const successCount = toolCallTelemetry.filter(t => t.success).length;
        log.info(`[Telemetry] ${requestId}: ${toolCallTelemetry.length} tools (${successCount}✓/${toolCallTelemetry.length - successCount}✗)`);
      }

      // RAG: Log successful trajectory to knowledge store for future retrieval
      if (toolCallTelemetry.length > 0 && toolCallTelemetry.every(t => t.success)) {
        const msg = config.userMessage?.trim() ?? '';
        const isContinuation = /^(continue|finish|go on|keep going|keep?|yes|yeah|ok|okay|do it|proceed|next|more)$/i.test(msg);
        const isFrustration = /(wh(y|at).*(stop|doing|happen)|(are|were).*done|terrible|awful|useless|bad|wrong|fail)/i.test(msg);
        const isTooShort = msg.length < 3;
        if (!isContinuation && !isFrustration && !isTooShort) {
          try {
            const toolCallSummary = toolCallTelemetry
              .map(t => `${t.toolName}(${JSON.stringify(t.args).slice(0, 100)})`)
              .join('\n');
            await ingestTrajectory({
              task: msg.slice(0, 500),
              toolCalls: toolCallSummary,
              model: `${providerName}/${modelForProvider}`,
              quality: 1.0 - (toolInvocations.length * 0.05),
            });
            log.info('[RAG] Trajectory logged', {
              taskType: 'tool_execution',
              toolCount: toolCallTelemetry.length,
              model: `${providerName}/${modelForProvider}`,
            });
          } catch (error) {
            log.warn('[RAG] Failed to log trajectory', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } else {
          log.debug('[RAG] Skipped trajectory — user message is not a meaningful task', {
            reason: isContinuation ? 'continuation' : isFrustration ? 'frustration' : 'too_short',
          });
        }
      }

      // Mem0: Store conversation turn for future memory retrieval
      if (isMem0Configured() && response) {
        const userMsg = config.userMessage?.trim() ?? '';
        const cleanResponse = response.trim();
        if (userMsg && cleanResponse) {
          const ownerId = config.userId || config.filesystemOwnerId || 'default';
          mem0Add({
            messages: [
              { role: 'user' as const, content: userMsg.slice(0, 8000) },
              { role: 'assistant' as const, content: cleanResponse.slice(0, 8000) },
            ],
            userId: ownerId,
            sessionId: config.conversationId,
          }).then(result => {
            if (result.success) {
              log.debug('[Mem0] Conversation turn stored', { requestId, userId: ownerId });
            } else {
              log.warn('[Mem0] Failed to store conversation turn', { requestId, error: result.error });
            }
          }).catch(err => {
            log.warn('[Mem0] Failed to store conversation turn (non-critical)', { requestId, error: err.message });
          });
        }
      }

      // ─── First-Response Routing Parsing ───
      // Parse [ROLE_SELECT] block from response (if present), build a client-friendly
      // routing payload (with stepReprompt) so the chat UI can auto-continue multi-step
      // flows, and clean the response so the marker isn't shown to the user.
      let routingForClient: ReturnType<typeof buildRoutingMetadataForClient> | undefined;
      try {
        const parsedRouting = parseFirstResponseRouting(response);
        if (parsedRouting.found && parsedRouting.routing) {
          routingForClient = buildRoutingMetadataForClient(parsedRouting.routing);
          log.info('[V1-API-WITH-TOOLS] [RoleSelect] Parsed routing', {
            classification: parsedRouting.routing.classification,
            role: parsedRouting.routing.suggestedRole,
            continue: parsedRouting.routing.continue,
            planSteps: parsedRouting.routing.planSteps?.length || 0,
            willAutoContinue: routingForClient.continue,
          });
        }
      } catch (err: any) {
        log.warn('[V1-API-WITH-TOOLS] [RoleSelect] Parse failed', { error: err?.message });
      }

      // Truncate at first [ROLE_SELECT] (drops simulated multi-turn output) and strip
      // any remaining marker blocks for safety. This is the user-visible response.
      const truncated = truncateAtFirstRouting(response);
      const cleanedResponse = stripRoutingMarkers(truncated);

      // ─── Tool-failure auto-retry with feedback injection ───
      // If the model invoked tools but they all failed validation (or returned
      // retryable errors) AND the cleaned response is empty, the user sees
      // "no response generated" with no recovery. Self-heal by re-prompting
      // the model with the validation error appended to messages so it can fix
      // the call. Bounded by config._toolFailureRetryCount to prevent infinite loops.
      // ─── Empty-response self-healing ───
      // The user must NEVER see "No response generated" without at least one
      // recovery attempt. Triggers when the cleaned response is empty, regardless
      // of whether tools were called: (a) tool-call but blocked/failed → retry
      // with feedback so the model fixes its args, (b) no tool call AND no text
      // → retry in text-mode so the model produces *something*. Bounded by
      // config._toolFailureRetryCount to prevent infinite loops.
      const anyToolFailed =
        toolInvocations.length > 0 &&
        toolInvocations.some(isFailedToolInvocation);
      const allToolsSucceeded =
        toolInvocations.length > 0 &&
        toolInvocations.every((inv) => !isFailedToolInvocation(inv));
      const noToolCalls = toolInvocations.length === 0;
      const responseEmpty = !cleanedResponse || cleanedResponse.trim().length === 0;
      const retryCount = ((config as any)._toolFailureRetryCount as number) || 0;
      const MAX_TOOL_FAILURE_RETRIES = 1;

      // Detect incomplete (truncated) responses -- non-empty but cut off mid-stream.
      // Catches mid-sentence cutoffs, unclosed code blocks, unclosed JSON, etc.
      const incompleteDetection = !responseEmpty && cleanedResponse
        ? detectIncompleteResponse(cleanedResponse)
        : { detected: false, reason: '', prompt: '', confidence: 0 as number };
      const responseIncomplete = incompleteDetection.detected;

      // FIX #4: "stops on file read" — tools ran successfully but the model
      // produced zero follow-up text. One more turn ("summarize what you got")
      // almost always works. Without this branch we render the friendly
      // fallback "I didn't produce a response for that" which looks broken
      // to the user even though tools clearly ran.
      const successfulToolsButSilent = responseEmpty && allToolsSucceeded;

      const shouldRetry = retryCount < MAX_TOOL_FAILURE_RETRIES && (
        (responseEmpty && (anyToolFailed || noToolCalls)) || responseIncomplete
      );

      // FIX: When tools succeeded but the model produced no follow-up text, run
      // ONE server-side continuation turn that injects the ACTUAL tool results
      // into the prompt. Each streamWithVercelAI call is stateless, so the tool
      // outputs are not otherwise visible to the next turn — deferring to a
      // generic client auto-continue ("continue working") left the model with no
      // context, producing another silent tool call or a useless short reply.
      // Bounded to a single extra turn; a deterministic summary guarantees the
      // user never sees an empty response.
      if (successfulToolsButSilent) {
        log.info("[SelfHeal] Tools succeeded but silent — running server-side continuation with tool-result context");

        // Embed the real tool results (truncated) so the model knows what it got.
        const toolResultsSummary = toolInvocations.map((inv) => {
          let resultStr: string;
          try {
            const raw = inv.result?.output ?? inv.result;
            resultStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
          } catch {
            resultStr = String(inv.result);
          }
          if (resultStr && resultStr.length > 4000) {
            resultStr = resultStr.slice(0, 4000) + '…[truncated]';
          }
          return `Tool: ${inv.toolName}\nArguments: ${JSON.stringify(inv.args)}\nResult: ${resultStr}`;
        }).join('\n\n');

        const continuationPrompt =
          `You called the following tool(s) and received their results:\n\n${toolResultsSummary}\n\n` +
          `Now continue the user's original request using these results. If further tool ` +
          `calls are needed, make them. When finished, ALWAYS provide a clear, concise text ` +
          `response to the user — never reply with silence.`;

        const continuationMessages = [
          ...llmMessages,
          { role: 'user', content: continuationPrompt },
        ];

        let contResponse = '';
        try {
          const { streamWithConcurrentFallback } = await import('../chat/enhanced-llm-service');
          for await (const chunk of streamWithConcurrentFallback({
            provider: providerName,
            model: modelForProvider,
            messages: continuationMessages as any,
            temperature: config.temperature || 0.7,
            maxTokens: config.maxTokens || 65536,
            maxSteps: config.maxSteps || 15,
            tools: aiSdkTools,
            toolCallStreaming: true,
            // Forward the caller's abort signal (continuation turn) — see note
            // at the primary streamWithConcurrentFallback call site above.
            signal: config.abortSignal,
          })) {
            if (chunk.content) {
              contResponse += chunk.content;
              config.onStreamChunk?.(chunk.content);
            }
            if (chunk.toolInvocations) {
              for (const inv of chunk.toolInvocations) {
                if (inv.state !== 'result') continue;
                toolInvocations.push({
                  toolCallId: inv.toolCallId,
                  toolName: inv.toolName,
                  args: (inv.args as Record<string, any>) || {},
                  result: inv.result ?? { success: false, error: 'Tool result was undefined' },
                });
              }
            }
          }
        } catch (contErr: any) {
          log.warn('[SelfHeal] Server-side continuation failed', { error: contErr?.message });
        }

        // Deterministic fallback: never return an empty bubble to the user.
        if (!contResponse.trim()) {
          const toolNames = [...new Set(toolInvocations.map(i => i.toolName))].join(', ');
          contResponse = `I gathered information using: ${toolNames}. Let me know how you'd like to proceed.`;
          log.info('[SelfHeal] Continuation still silent — returning deterministic summary');
        } else {
          log.info('[SelfHeal] Server-side continuation produced text', { length: contResponse.length });
        }

        const cleanedContinuation = stripRoutingMarkers(truncateAtFirstRouting(contResponse));
        return {
          success: true,
          response: cleanedContinuation,
          mode: "v1-api",
          steps: toolInvocations.map(inv => ({
            toolName: inv.toolName,
            args: inv.args,
            result: inv.result,
          })),
          totalSteps: toolInvocations.length,
          metadata: {
            provider: providerName,
            model: modelForProvider,
            duration: Date.now() - startTime,
            successfulTools: toolInvocations.map(inv => inv.toolName),
            serverSideContinuation: true,
          },
        };
      }

      if (shouldRetry) {
        // Build FeedbackEntry objects from tool failures and accumulate into
        // feedbackContext so injectFeedback() can provide richer healing context
        // (healingSteps, formatGuidance, roleRedirectSection) on retries.
        let enrichedContext = feedbackContext;
        if (anyToolFailed) {
          for (const inv of toolInvocations.filter(i => i.result?.success === false)) {
            const err = inv.result?.error;
            const errMsg = typeof err === 'string' ? err : ((err as any)?.message || String(err));
            const entry = createFeedbackEntry(
              'failure',
              `Tool "${inv.toolName}" failed: ${errMsg}`,
              'tool_execution',
              { toolName: inv.toolName, error: inv.result?.error },
              'high'
            );
            enrichedContext = addFeedback(enrichedContext, entry);
          }
        }

        const injectedFeedback = injectFeedback(enrichedContext, getFeedbackInjectionBudget(enrichedContext));

        log.info('\x1b[32m[V1-API-WITH-TOOLS]\x1b[0m [SelfHeal] 🩹 Injected feedback for retry', {
          failures: feedbackContext.recentFailures.length,
          turn: feedbackContext.turnNumber,
          hasCorrection: !!injectedFeedback.correctionSection,
          hasHealing: !!injectedFeedback.healingInstructions
        });

        // Build feedback that depends on what went wrong
        let feedbackMsg: string;
        let userPrompt: string;
        if (anyToolFailed) {
          const failureSummaries = toolInvocations
            .filter(isFailedToolInvocation)
            .map((inv) => {
              const err = inv.result?.error;
              const errMsg = typeof err === 'string'
                ? err
                : (err?.message || JSON.stringify(err) || 'unknown error');
              const errRecord = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
              const errCode = (errRecord && typeof errRecord.code === 'string' ? errRecord.code : '') || '';
              const expectedFields = (errRecord && Array.isArray(errRecord.expectedFields))
                ? errRecord.expectedFields as string[]
                : [];
              const suggestion = (errRecord && typeof errRecord.suggestedNextAction === 'string' ? errRecord.suggestedNextAction : '') || '';
              const missingFields = expectedFields.length > 0
                ? ` (missing: ${expectedFields.join(', ')})`
                : '';
              return `- Tool "${inv.toolName}"${missingFields} failed [${errCode}]: ${errMsg}. ${suggestion}`;
            });
          const allMissingFields = new Set<string>();
          toolInvocations
            .filter(isFailedToolInvocation)
            .forEach((inv) => {
              const errorRecord = typeof inv.result?.error === 'object' && inv.result?.error !== null
                ? (inv.result.error as Record<string, unknown>)
                : null;
              const fields: string[] = errorRecord && Array.isArray(errorRecord.expectedFields)
                ? errorRecord.expectedFields as string[]
                : [];
              fields.forEach((f: string) => allMissingFields.add(f));
            });
          const fieldsReminder = allMissingFields.size > 0
            ? `\n\nMISSING REQUIRED FIELDS: ${[...allMissingFields].join(', ')}. You MUST provide every one of these fields in your next tool call.`
            : '\n\nIMPORTANT: Provide ALL required arguments for each tool. For batch_write you MUST include the "files" array; for web_search you MUST include the "query" string; for write_file you MUST include both "path" and "content".';
          feedbackMsg = `[TOOL-FAILURE-FEEDBACK] Your previous tool call(s) failed validation. Fix and retry:\n${failureSummaries.join('\n')}${fieldsReminder}${injectedFeedback.correctionSection}${injectedFeedback.healingInstructions}${injectedFeedback.formatGuidance}`;
          userPrompt = 'Please retry the failed tool call(s) above with the correct arguments AND then provide a final text answer to me.';
        } else if (responseIncomplete) {
          // Response was non-empty but truncated -- model got cut off mid-stream.
          // Give specific correction prompt based on what detectIncompleteResponse found.
          // NOTE: injectedFeedback sections are empty here (no entries when anyToolFailed is false),
          // but included for future-proofing when both conditions may coexist.
          // Bug #16 fix: the feedback message is self-contained with the
          // [STEER] [INCOMPLETE-RESPONSE-FEEDBACK] prefix and the
          // instruction to complete the response. The retry path
          // (retryMessages below) uses `feedbackMsg` directly — no
          // `userPrompt` is needed for this branch.
          feedbackMsg = `[STEER] [INCOMPLETE-RESPONSE-FEEDBACK] ${incompleteDetection.prompt}\n\nYour previous response was truncated or cut off. Please complete your thought and provide a full answer.${injectedFeedback.correctionSection}${injectedFeedback.formatGuidance}`;
        } else if (successfulToolsButSilent) {
          // Tools ran successfully but the model produced zero follow-up text.
          // Give it the executed tool list so it can summarize for the user.
          const successSummary = toolInvocations
            .filter((inv) => inv.result?.success === true)
            .map((inv) => `- ${inv.toolName}(${Object.keys(inv.args || {}).join(', ')}) → succeeded`)
            .join('\n');
          feedbackMsg = `[POST-TOOL-FEEDBACK] You called tools and they succeeded, but you produced no text for the user.\n\nExecuted tools:\n${successSummary}\n\nNow write a clear final answer that uses the tool results.`;
          userPrompt = 'Now summarize the results for me — what did you find / do, and what should I know?';
        } else {
          // No tool calls and no text -- model went silent. Force a text-mode response.
          feedbackMsg = '[EMPTY-RESPONSE-FEEDBACK] You produced no text and no tool calls. Respond directly to the user in plain text now. If a tool was needed, describe what you would have done.';
          userPrompt = 'Please respond directly with a complete answer.';
        }

        // Log a truncated preview of the assembled feedback so we can see
        // what the LLM is actually receiving without flooding logs.
        const feedbackPreview = feedbackMsg.length > 200
          ? feedbackMsg.slice(0, 200).replace(/\n/g, '\\n') + '...'
          : feedbackMsg.replace(/\n/g, '\\n');
        log.debug('[V1-API-WITH-TOOLS] [SelfHeal] Assembled feedback for LLM', {
          feedbackLength: feedbackMsg.length,
          feedbackPreview,
          branch: anyToolFailed
            ? 'tool-failure'
            : responseIncomplete
              ? 'incomplete-response'
              : successfulToolsButSilent
                ? 'post-tool-silence'
                : 'empty-response',
        });

        log.warn('[V1-API-WITH-TOOLS] [SelfHeal] Auto-retrying response', {
          anyToolFailed,
          noToolCalls,
          responseIncomplete,
          incompleteConfidence: incompleteDetection.confidence,
          toolCount: toolInvocations.length,
          retryCount: retryCount + 1,
        });

        // Record telemetry for retry (helps trace malformed/duplicate calls)
        if (toolInvocations && toolInvocations.length > 0) {
          const { redactedArgs, originStack } = prepareTelemetryPayload(
            { toolInvocations, retryCount: retryCount + 1, anyToolFailed, noToolCalls },
            { maxStringLength: 200, maxObjectProps: 5, maxArrayItems: 5 }
          );
          recordToolCallTelemetry({
            toolName: 'UnifiedAgentService.retry',
            redactedArgs,
            model: config.model,
            provider: config.provider,
            originStack,
            toolCallId: null,
          }).catch((err) => { log.debug?.('[UnifiedAgentService] retry telemetry failed:', err); }); // Silent - telemetry should not break flow
        }

        // Track retries so we don't loop forever
        (config as any)._toolFailureRetryCount = retryCount + 1;

        // Bug #16 fix (option 2 — safer): the INCOMPLETE-RESPONSE-FEEDBACK
        // is injected as a standalone user message with a `[STEER]`
        // prefix, instead of being combined with the continuation prompt
        // and injected as a user message that "replaces" the user
        // message body. The previous implementation combined `feedbackMsg`
        // + `userPrompt` into `combinedUserPrompt`, which meant the
        // feedback was the entire content of the new user message.
        //
        // The fix keeps the `user` role (to avoid the "stray
        // {role:'system'} AFTER an assistant turn violates the ordering
        // contract" schema issue) but makes the feedback a standalone
        // message that starts with `[STEER] [INCOMPLETE-RESPONSE-FEEDBACK]`.
        // The LLM can then clearly distinguish the feedback from a normal
        // user message and treat it as a steering signal.
        //
        // The `feedbackMsg` already contains the full feedback text
        // including the instruction to complete the response, so the
        // `userPrompt` ("Continue from where you left off…") is now
        // redundant — the feedback message is self-contained.
        const retryMessages = [
          ...messages,
          { role: 'user' as const, content: feedbackMsg },
        ];

        try {
          // FIX: Carry forward last successful provider/model so SelfHeal retries skip dead primary
          const retryConfig = _selfHealProvider ? { ...config, provider: _selfHealProvider, model: _selfHealModel || config.model } : config;
          const retryResult = await runV1ApiWithTools(retryConfig, retryMessages, startTime);
          // If the retry produced something, use it. Otherwise fall through to
          // the friendly fallback below so the user still sees a message.
          if (retryResult.response && retryResult.response.trim() && retryResult.response !== 'No response generated') {
            return retryResult;
          }
          log.warn('[V1-API-WITH-TOOLS] [SelfHeal] Retry also produced empty response, using friendly fallback');
        } catch (retryErr: any) {
          log.warn('[V1-API-WITH-TOOLS] [SelfHeal] Retry failed, using friendly fallback', {
            error: retryErr?.message,
          });
        }
      }

      // Friendly fallback message — preferable to a bald "No response generated".
      // CRITICAL: When we return a friendly fallback because SelfHeal couldn't
      // recover, we MUST also signal `isEmptyResponse: true` (and a clear
      // `emptyReason`) in metadata. Otherwise the client sees non-empty text
      // and treats it as a successful terminal response — no rotation, no
      // model swap, no second-attempt recovery. This is the exact reason the
      // user kept seeing "I attempted to use a tool but the call was rejected"
      // as a dead-end bubble.
      const friendlyFallback = anyToolFailed
        ? 'I attempted to use a tool but the call was rejected. Could you rephrase or clarify what you\'d like me to do?'
        : 'I didn\'t produce a response for that — could you rephrase your request?';
      const toolFailureMessage = (toolInvocations.length > 0 && anyToolFailed && friendlyFallback)
        ? friendlyFallback
        : null;
      const usedFriendlyFallback =
        (!cleanedResponse || !cleanedResponse.trim()) &&
        (!response || !response.trim()) &&
        !!toolFailureMessage;
      let finalResponse = cleanedResponse && cleanedResponse.trim()
        ? cleanedResponse
        : (response && response.trim() ? response : (toolFailureMessage || ''));

      // ── Tool execution summary ──
      const totalTools = toolInvocations.length;
      const failedTools = toolInvocations.filter((inv: any) => isFailedToolInvocation(inv)).length;
      const succeededTools = totalTools - failedTools;
      log.info('[ToolSummary] Tool execution complete', {
        totalCalls: totalTools,
        succeeded: succeededTools,
        failed: failedTools,
        durationMs: duration,
        provider: providerName,
        model: modelForProvider,
        toolList: toolInvocations.slice(0, 20).map((inv: any) => ({
          name: inv.toolName,
          success: !isFailedToolInvocation(inv),
          durationMs: inv.result?.durationMs,
        })),
      });
      // Emit summary SSE event
      if (config.onStreamChunk) {
        try {
          config.onStreamChunk(sseEncode(SSE_EVENT_TYPES.TOOL_SUMMARY, {
            totalCalls: totalTools,
            succeeded: succeededTools,
            failed: failedTools,
            durationMs: duration,
            timestamp: Date.now(),
          }));
        } catch { /* best effort */ }
      }

      // Bug #10 fix: Wire [STEER] helpers into the v1-api completion handler.
      // Previously these only fired in the chat/route.ts SSE streaming path.
      // Now: steerFromFinishReason fires for empty completions and
      // missing-tool-call patterns, injecting a [STEER] prefix into the
      // continuation prompt or the final response so the LLM gets actionable
      // guidance on the next turn.
      let v1SteerPrompt: string | null = null;
      const steerTrigger = steerFromFinishReason({
        finishReason: response.trim() ? undefined : 'stop',
        availableTools: Object.keys(aiSdkTools || {}).length,
        provider: providerName,
        model: modelForProvider,
        responseText: finalResponse,
        toolCallsDone: toolInvocations.length,
      });
      if (steerTrigger) {
        v1SteerPrompt = buildSteerPrompt(steerTrigger);
        log.info('[V1-API-WITH-TOOLS] STEER fired', {
          kind: steerTrigger.kind,
          promptLength: v1SteerPrompt.length,
        });
        // Prepend the steer to the final response so the LLM sees it
        // on the next turn (or the client can surface it as guidance).
        if (finalResponse.trim()) {
          finalResponse = v1SteerPrompt + '\n\n' + finalResponse;
        } else {
          finalResponse = v1SteerPrompt;
        }
      }
      // Previously only a single continuation attempt was made. Now we loop up to
      // MAX_V1_CONTINUATIONS iterations, re-checking shouldAutoContinue after each
      // continuation turn. This handles: roleSelection.continue=true, empty_tool_args,
      // single_step_read, plan_steps_remaining, single_write_then_stop.
      // Uses decideAutoContinue (shared with chat/route.ts) for consistent counter
      // management and cleanup.
      const MAX_V1_CONTINUATIONS = parseInt(process.env.LLM_MAX_CONTINUATIONS_PER_TURN || '3', 10);
      let autoContinueIteration = 0;
      let accumulatedResponse = finalResponse;
      let accumulatedSteps = [...steps];
      let accumulatedToolInvocations = [...toolInvocations];

      while (autoContinueIteration < MAX_V1_CONTINUATIONS) {
        const autoDecision = decideAutoContinue({
          requestId,
          // Bug #Q7 (audit): pass advancedDetectorFn to the v1-api-with-tools continuation
              // loop so it gets the richer-signal coverage route.ts's
              // maybeDetectorContinuation provides. The helper's default detector
              // (defaultFileEditDetector) only watches file edits; needsMoreTurnsDetector
              // also considers tool-failure patterns, accumulated tool-call counts, and
              // the model-emitted next-action hint, so the v1 continuation loop stops
              // asking prematurely on shallow runs and keeps going on substantive
              // multi-step plans. Mirrors route.ts:1699 (the chat-SSE path) without
              // touching route.ts.
              advancedDetectorFn: needsMoreTurnsDetector,
              routing: routingForClient ? {
            continue: routingForClient.continue,
            stepReprompt: routingForClient.stepReprompt,
            primaryRole: routingForClient.primaryRole,
            estimatedSteps: routingForClient.estimatedSteps,
            planSteps: routingForClient.planSteps,
          } as unknown as AutoContinueRouting : undefined,
          steps: accumulatedSteps.map(s => ({ toolName: s.toolName, args: s.args })),
          responseText: accumulatedResponse,
          // Bug-#1 follow-up: pass REAL accumulated file edits so the
          // defaultFileEditDetector inside decideAutoContinue can FIRE
          // for the "stops after emitting file edits" failure mode.
          // Without this, automatically falls through to the LLM decision
          // only, missing the detector-override path that forces a
          // continuation when the LLM emitted edits but didn't get the
          // response format right. WRITE_TOOL_NAMES is the same set used
          // elsewhere in runV1ApiWithTools for tool classification so the
          // detector sees a consistent view.
          // SEV-12 (TS2739 sweep #2): cast at the second decideAutoContinue call boundary.
          // Mirror of the L1706 cast pattern: narrow-and-cast the result shape to the helper param type.
          result: {
            response: accumulatedResponse,
            success: accumulatedSteps.every((s: any) => s.result?.success !== false),
            fileEdits: accumulatedSteps
              .filter((s: any) => s?.toolName && WRITE_TOOL_NAMES.has(s.toolName))
              .map((s: any) => ({
                path: typeof s?.args?.path === 'string' ? s.args.path : undefined,
                action: 'write',
                toolName: s.toolName,
              }))
              .filter((e: any) => typeof e.path === 'string' && e.path.length > 0),
          },
        });

        if (!autoDecision.continue || !autoDecision.continuationPrompt) {
          break;
        }

        autoContinueIteration++;

        // Emit SSE `continuation` event so the UI can show a "continuing…"
        // indicator and operators can spot missed continuations in run.log.
        // Parity with app/api/chat/route.ts SSE_EVENT_TYPES.CONTINUE
        // (typed there; raw `config.onStreamChunk` here because the
        // unified-agent path doesn't use the typed sse-events bus — the
        // route layer parses the same JSON shape).
        // sseDelivered is an observability flag; the autoContinueIteration
        // increment above is unconditional. Without sseDelivered, an SSE
        // throw would leave this log.info reporting iteration N+1 as "delivered"
        // even though the client never saw the SSE event. Declared in the
        // OUTER scope so the log.info's `sseDelivered,` shorthand binding
        // works regardless of whether config.onStreamChunk is set, and as
        // a `let` (not const) so the 3-state signal — not-configured /
        // configured-and-delivered / configured-and-threw — is preserved.
        let sseDelivered = false;
        if (config.onStreamChunk) {
          // Use sseEncode to emit the continuation event in proper SSE format
          const ssePayload = sseEncode(SSE_EVENT_TYPES.CONTINUATION, {
            requestId,
            iteration: autoContinueIteration,
            reason: autoDecision.reason,
            forceSignal: autoDecision.forceSignal,
            continuationsSoFar: autoDecision.continuationsSoFar,
            timestamp: Date.now(),
          });
          try {
            config.onStreamChunk(ssePayload);
            sseDelivered = true;
          } catch (sseErr) {
            log.debug('[V1-API-WITH-TOOLS] SSE continuation emit failed', {
              error: sseErr instanceof Error ? sseErr.message : String(sseErr),
              requestId,
              iteration: autoContinueIteration,
            });
          }
        }

        log.info('[V1-API-WITH-TOOLS] Auto-continuation loop iteration', {
          iteration: autoContinueIteration,
          reason: autoDecision.reason,
          continuationsSoFar: autoDecision.continuationsSoFar,
          forceSignal: autoDecision.forceSignal,
          sseDelivered,
        });

        const contMessages = [
          ...llmMessages,
          { role: 'assistant', content: accumulatedResponse },
          { role: 'user', content: autoDecision.continuationPrompt },
        ];

        try {
          const { streamWithConcurrentFallback } = await import('../chat/enhanced-llm-service');
          // Signal progress to the route's stall watchdog before starting the
          // continuation stream, so the watchdog doesn't false-fire during
          // the gap between the primary stream ending and the first token.
          config.onProgress?.();
          let contContent = '';
          const contToolInvocations: typeof toolInvocations = [];

          for await (const chunk of streamWithConcurrentFallback({
            provider: providerName,
            model: modelForProvider,
            messages: contMessages as any,
            temperature: config.temperature || 0.7,
            maxTokens: config.maxTokens || 65536,
            maxSteps: config.maxSteps || 15,
            tools: aiSdkTools,
            toolCallStreaming: true,
            // Forward the caller's abort signal (continuation turn) — see note
            // at the primary streamWithConcurrentFallback call site above.
            signal: config.abortSignal,
          })) {
            if (chunk.content) {
              contContent += chunk.content;
              config.onStreamChunk?.(chunk.content);
            }
            if (chunk.toolInvocations) {
              for (const inv of chunk.toolInvocations) {
                if (inv.state !== 'result') continue;
                contToolInvocations.push({
                  toolCallId: inv.toolCallId,
                  toolName: inv.toolName,
                  args: (inv.args as Record<string, any>) || {},
                  result: inv.result ?? { success: false, error: 'Tool result was undefined' },
                });
              }
            }
          }

          if (contContent.trim() || contToolInvocations.length > 0) {
            log.info('[V1-API-WITH-TOOLS] Auto-continuation produced results', {
              contentLength: contContent.length,
              toolCount: contToolInvocations.length,
              iteration: autoContinueIteration,
            });

            accumulatedResponse = (accumulatedResponse + '\n\n' + contContent).trim();
            accumulatedSteps.push(...contToolInvocations.map(inv => ({
              toolName: inv.toolName,
              args: inv.args,
              result: inv.result,
            })));
            accumulatedToolInvocations.push(...contToolInvocations);
          } else {
            log.info('[V1-API-WITH-TOOLS] Auto-continuation produced no output, stopping loop', {
              iteration: autoContinueIteration,
            });
            break;
          }
        } catch (contErr: any) {
          const errorMsg = contErr?.message || String(contErr);
          const lowerErr = String(errorMsg).toLowerCase();
          const isRateLimitError =
            lowerErr.includes('rate limit') ||
            lowerErr.includes('429') ||
            lowerErr.includes('quota') ||
            lowerErr.includes('throttle') ||
            lowerErr.includes('too many requests');

          log.warn('[V1-API-WITH-TOOLS] Auto-continuation failed, returning accumulated response', {
            error: errorMsg,
            iteration: autoContinueIteration,
            isRateLimitError,
          });

          // BUG FIX: Exit auto-continuation loop on rate limit or other provider errors.
          // Previous behavior continued to iteration 3 even after rate limit,
          // wasting tokens and compute on doomed requests. Now we break immediately
          // when we detect rate limiting or provider exhaustion.
          if (isRateLimitError) {
            log.info('[V1-API-WITH-TOOLS] Rate limit detected, attempting continuation on next fallback provider(s)', {
              iteration: autoContinueIteration,
              error: errorMsg,
            });

            // Try continuation on the next provider(s) in the configured chain
            const nextProviders = uniqueProviders.slice(uniqueProviders.indexOf(providerName) + 1).filter(p => !isProviderPermanentlyFailed(p));
            if (nextProviders.length > 0) {
              const nextPrimary = nextProviders[0];
              const nextFallbacks = nextProviders.slice(1);
              try {
                config.onProgress?.();
                const { streamWithConcurrentFallback } = await import('../chat/enhanced-llm-service');
                let fallbackContContent = '';
                const fallbackContToolInvocations: typeof contToolInvocations = [];

                for await (const chunk of streamWithConcurrentFallback({
                  provider: nextPrimary,
                  fallbackProviders: nextFallbacks,
                  model: getModelForProvider(nextPrimary),
                  messages: contMessages as any,
                  temperature: config.temperature || 0.7,
                  maxTokens: config.maxTokens || 65536,
                  maxSteps: config.maxSteps || 15,
                  tools: aiSdkTools,
                  toolCallStreaming: true,
                  signal: config.abortSignal,
                })) {
                  if (chunk.content) {
                    fallbackContContent += chunk.content;
                    config.onStreamChunk?.(chunk.content);
                  }
                  if (chunk.toolInvocations) {
                    for (const inv of chunk.toolInvocations) {
                      if (inv.state !== 'result') continue;
                      fallbackContToolInvocations.push({
                        toolCallId: inv.toolCallId,
                        toolName: inv.toolName,
                        args: (inv.args as Record<string, any>) || {},
                        result: inv.result ?? { success: false, error: 'Tool result was undefined' },
                      });
                    }
                  }
                }

                if (fallbackContContent.trim() || fallbackContToolInvocations.length > 0) {
                  log.info('[V1-API-WITH-TOOLS] Fallback-continuation produced results', {
                    contentLength: fallbackContContent.length,
                    toolCount: fallbackContToolInvocations.length,
                    iteration: autoContinueIteration,
                    attemptedProviders: nextProviders,
                  });

                  accumulatedResponse = (accumulatedResponse + '\n\n' + fallbackContContent).trim();
                  accumulatedSteps.push(...fallbackContToolInvocations.map(inv => ({
                    toolName: inv.toolName,
                    args: inv.args,
                    result: inv.result,
                  })));
                  accumulatedToolInvocations.push(...fallbackContToolInvocations);

                  // Successfully continued on a fallback provider — continue outer loop
                  continue;
                } else {
                  log.info('[V1-API-WITH-TOOLS] Fallback-continuation produced no output, stopping loop', { attemptedProviders: nextProviders });
                  break;
                }
              } catch (fbContErr: any) {
                log.warn('[V1-API-WITH-TOOLS] Fallback-continuation failed, returning accumulated response', {
                  error: fbContErr?.message || String(fbContErr),
                  attemptedProviders: nextProviders,
                });
                // If fallback continuation failed, stop auto-continuation here
                break;
              }
            } else {
              log.info('[V1-API-WITH-TOOLS] No fallback providers available for continuation, stopping auto-continuation', { iteration: autoContinueIteration });
            }
          }
          break;
        }
      }

      clearContinuationCount(requestId);

      if (autoContinueIteration > 0) {
        return {
          success: true,
          response: accumulatedResponse,
          steps: accumulatedSteps,
          totalSteps: accumulatedSteps.length,
          mode: 'v1-api',
          metadata: {
            provider: providerName,
            model: modelForProvider,
            duration: Date.now() - startTime,
            toolInvocations: accumulatedToolInvocations,
            autoContinued: true,
            autoContinueIterations: autoContinueIteration,
            // Pass anyToolFailed through so client can auto-retry on tool failure
            ...(accumulatedToolInvocations.length > 0 && accumulatedToolInvocations.some((inv: any) => isFailedToolInvocation(inv)) ? { anyToolFailed: true } : {}),
            ...(routingForClient ? { routing: routingForClient } : {}),
          },
        };
      }

      // PR-F: clear the 530-blacklist counter on this provider's success.
      // Gated by ENABLE_530_RESET_ON_SUCCESS=1 (default OFF) inside the helper.
      // PR-W -- single-call both-trackers reset (replaces the manual pair).
      maybeResetBothTrackers(providerName);
      return {
        success: true,
        response: finalResponse,
        steps,
        totalSteps: steps.length,
        mode: 'v1-api',
        metadata: {
          provider: providerName,
          model: modelForProvider,
          duration,
          toolInvocations,
          fallbackChain: providerName !== primaryProvider
            ? uniqueProviders.slice(0, uniqueProviders.indexOf(providerName) + 1)
            : [],
          ...(routingForClient ? { routing: routingForClient } : {}),
          // Pass anyToolFailed through so client can auto-retry on tool failure
          ...(toolInvocations.length > 0 && toolInvocations.some(isFailedToolInvocation) ? { anyToolFailed: true } : {}),
          // Mark friendly-fallback responses as empty so client triggers rotation
          ...(usedFriendlyFallback ? {
            isEmptyResponse: true,
            emptyReason: anyToolFailed
              ? 'tool calls failed and SelfHeal retry did not recover'
              : 'no text and no successful tools after SelfHeal',
          } : {}),
          // Signal truncated results: tools made progress but response cut off
          // Client can use this to include partial results in retryContext
          ...(toolInvocations.length > 0 && usedFriendlyFallback ? {
            wasTruncated: true,
            partialToolResults: toolInvocations.slice(0, 30).map(function(inv) {
              return {
                toolName: inv.toolName,
                success: !isFailedToolInvocation(inv),
                hasResult: !!inv.result,
              };
            }),
          } : {}),
        },
      };
    } catch (error: any) {
      lastError = error;
      // PR-E + PR-H: both trackers fire here in parallel — pure
      // record-or-noop, NEVER cross-wipe each other's Map. Parallels
      // lib/chat/enhanced-llm-service.ts:746. Non-matching error
      // signatures leave both counters untouched; only the corresponding
      // success-path helpers decrement them (gated by ENABLE_*_RESET_ON_SUCCESS).
      record5xxErrorIfApplicable(providerName, error);
      record530ErrorIfApplicable(providerName, error);

      // FIX: Record failure in circuit-breaker and model-ranker so failing providers
      // get de-ranked and circuit-breaker trips after repeated failures
      if (circuitBreakerMgr) {
        try {
          const breaker = circuitBreakerMgr.getBreaker(providerName);
          breaker.recordFailure(error);
          // Invalidate cached defaults so next request picks a different provider
          if (breaker.getState() === 'OPEN') {
            invalidateDynamicDefaultsCache();
          }
        } catch { /* ignore circuit-breaker recording errors */ }
      }
      if (modelRankerFns) {
        try {
          const status = error?.status || error?.statusCode || 0;
          const errorMessage = (error.message || '').toLowerCase();
          // If this is a permanent error (missing API key, invalid auth, model not found),
          // skip model-ranker recording entirely — the provider is misconfigured, not
          // performing poorly. Mark it so subsequent iterations skip it immediately.
          const errorClass = classifyProviderError(error);
          if (errorClass === "permanent") {
            markProviderPermanentlyFailed(providerName);
            log.error("[V1-API-WITH-TOOLS] ┌─ PERMANENT ERROR ────────────");
            log.error("[V1-API-WITH-TOOLS] │ provider: " + providerName + " — permanently failed, will not retry");
            log.error("[V1-API-WITH-TOOLS] │ error: " + error.message);
            log.error("[V1-API-WITH-TOOLS] │ remaining: " + (uniqueProviders.slice(uniqueProviders.indexOf(providerName) + 1).filter(p => !isProviderPermanentlyFailed(p)).join(", ") || "NONE"));
            log.error("[V1-API-WITH-TOOLS] └───────────────────────────────");
            continue;
          }

          // Bug #116/#90: Record transient/rate-limit failures in the process-level
          // circuit breaker. After N transient failures within a TTL window, the
          // provider is temporarily skipped (not permanently banned). This prevents
          // the "sticky permanent failure" pattern where a single transient outage
          // disables a provider for the rest of the process lifetime.
          if (errorClass === "transient" || errorClass === "rate_limit") {
            recordTransientFailure(providerName);
            if (isProviderCircuitBroken(providerName)) {
              log.warn("[V1-API-WITH-TOOLS] Circuit breaker OPEN for provider: " + providerName + " — temporarily skipping (TTL " + TRANSIENT_CIRCUIT_BREAKER_TTL_MS / 1000 + "s)", {
                transientFailures: _transientCircuitBreaker.get(providerName.toLowerCase()),
              });
              continue;
            }
          }
          
          // "Controller is already closed" = stream controller dead (idle timeout,
          // TTFT timeout, client disconnect). Once closed, NO provider can write
          // to it — so we MUST stop the fallback loop. Continuing would just
          // burn through all providers with the same error.
          // Distinguish: narrow to explicit signals that indicate the controller is dead:
          //   - 'cancelled'                  → explicit user/programmatic cancellation
          //   - 'client disconnected'        → explicit client stream close
          //   - AbortError WITHOUT timeout   → user-initiated abort (not internal timeout)
          const isExplicitClientAbort =
            errorMessage.includes('cancelled') ||
            errorMessage.includes('client disconnected') ||

            errorMessage.includes('Controller is already closed') ||
            (error.name === 'AbortError' &&
              !errorMessage.includes('timeout') &&
              !errorMessage.includes('No activity') &&
              !errorMessage.includes('No response'));
          
          if (isExplicitClientAbort) {
            // Set global flag: no subsequent provider attempts (or agent loop iterations)
            // should try any more providers — the response stream is gone.
                        markClientDisconnected(error?.message || errorMessage);
          }

          if (isExplicitClientAbort) {
            log.warn('[V1-API-WITH-TOOLS] Client timeout/disconnect - NOT deranking model', {
              provider: providerName,
              model: modelForProvider,
              error: error.message
            });
            // Short-circuit: controller closed - all remaining providers will also fail
            break;  // Skip recording as failure - this wasn't the model's fault
          } else {
            // Only record actual model failures
            modelRankerFns.recordModelAttempt(providerName, modelForProvider, false);
            
            // Record 429 errors specifically for rate-limit tracking
            if (status === 429 || errorMessage.includes('rate limit')) {
              modelRankerFns.recordRateLimitError(providerName, modelForProvider);
            }
            
            // Record 413 errors (Request Too Large) with token limit tracking
            if (status === 413 || errorMessage.includes('request body too large') || 
                errorMessage.includes('tokens_limit_reached')) {
              // Extract token limit from error message if available
              const tokenLimitMatch = error.message?.match(/max size:\s*(\d+)\s*tokens?/i);
              const tokenLimit = tokenLimitMatch ? parseInt(tokenLimitMatch[1], 10) : null;
              
              log.warn('[V1-API-WITH-TOOLS] 413 Request Too Large detected', {
                provider: providerName,
                model: modelForProvider,
                tokenLimit,
                errorMessage: error.message
              });
              
              // Record token limit for this model to avoid future oversized requests
              if (tokenLimit && modelRankerFns.recordModelTokenLimit) {
                modelRankerFns.recordModelTokenLimit(providerName, modelForProvider, tokenLimit);
              }
              
              // Mark this model as unsuitable for large context requests
              if (modelRankerFns.recordModelContextLimitError) {
                modelRankerFns.recordModelContextLimitError(providerName, modelForProvider, tokenLimit || 8000);
              }
            }
          }
        } catch { /* ignore model-ranker recording errors */ }
      }
      log.warn('[V1-API-WITH-TOOLS] ┌─ ATTEMPT FAILED ────────────');
      log.warn('[V1-API-WITH-TOOLS] │ provider:', providerName);
      log.warn('[V1-API-WITH-TOOLS] │ model:', modelForProvider);
      log.warn('[V1-API-WITH-TOOLS] │ error:', error.message);
      log.warn('[V1-API-WITH-TOOLS] │ statusCode:', error?.status || error?.statusCode || 'unknown');
      
      // Better error details logging - serialize objects properly
      if (error?.requestBodyValues) {
        const bodyValues = error.requestBodyValues;
        log.warn('[V1-API-WITH-TOOLS] │ requestBody:', {
          model: bodyValues.model,
          inputMessages: Array.isArray(bodyValues.input) ? bodyValues.input.length : 'unknown',
          temperature: bodyValues.temperature,
          maxTokens: bodyValues.max_output_tokens,
          toolsCount: Array.isArray(bodyValues.tools) ? bodyValues.tools.length : 0,
          toolNames: Array.isArray(bodyValues.tools) 
            ? bodyValues.tools.map((t: any) => t?.function?.name || t?.name || 'unknown').slice(0, 5)
            : []
        });
      }
      
      log.warn('[V1-API-WITH-TOOLS] │ circuitState:', getCircuitStateName(circuitBreakerMgr?.getBreaker(providerName)?.getState() || 'HEALTHY') as any);
      log.warn('[V1-API-WITH-TOOLS] │ will try next:', uniqueProviders.slice(uniqueProviders.indexOf(providerName) + 1).join(', ') || 'NO MORE');
      log.warn('[V1-API-WITH-TOOLS] └───────────────────────────────');
    }
  }

    // FIX: Track provider failure for feedback injection with detailed error context
  const err = lastError as any;
  const status = err?.status || err?.statusCode || 0;
  let failureMessage = `All providers failed: ${lastError?.message || 'Unknown error'}. Tried: ${uniqueProviders.join(', ')}`;
  let feedbackContext413: Record<string, any> = { tried: uniqueProviders };
  
  // Add specific guidance for 413 errors
  if (status === 413 || (lastError?.message || '').toLowerCase().includes('request body too large')) {
    const tokenLimitMatch = lastError?.message?.match(/max size:\s*(\d+)\s*tokens?/i);
    const tokenLimit = tokenLimitMatch ? parseInt(tokenLimitMatch[1], 10) : null;
    
    failureMessage = `Request too large for available models. ${lastError?.message || ''}. Consider: 1) Reducing conversation history, 2) Simplifying the request, 3) Using a model with larger context window.`;
    feedbackContext413 = {
      tried: uniqueProviders,
      errorType: '413_request_too_large',
      tokenLimit,
      suggestion: 'Reduce context size or use larger-context model',
      estimatedTokens: Math.ceil(
        (JSON.stringify(messages).length + 
         JSON.stringify(config.tools || []).length + 
         (config.systemPrompt?.length || 0)) / 4
      )
    };
  }
  
  const providerFailureEntry = createFeedbackEntry(
    'failure',
    failureMessage,
    'llm_response',
    feedbackContext413,
    'critical'
  );
  feedbackContext.turnNumber++;
  addFeedback(feedbackContext, providerFailureEntry);
  recordResponse(sessionId, 0, false);

// All providers failed
  const duration = Date.now() - startTime;

  log.error('[V1-API-WITH-TOOLS] ┌─ ALL PROVIDERS FAILED ──────────');
  log.error('[V1-API-WITH-TOOLS] │ providers tried:', uniqueProviders);
  log.error('[V1-API-WITH-TOOLS] │ lastError:', lastError?.message);
  log.error('[V1-API-WITH-TOOLS] └──────────────────────────────────');

  chatRequestLogger.logRequestComplete(
    requestId,
    false,
    undefined,
    undefined,
    duration,
    lastError?.message || 'V1 API tool loop failed',
    primaryProvider,
    primaryModel,
  ).catch(() => {});

  // FIX: Emit error chunk to user so they see a failure instead of blank screen.
  if (config.onStreamChunk) {
    try {
      config.onStreamChunk(sseEncode(SSE_EVENT_TYPES.ERROR, {
        error: "All providers failed",
        detail: lastError?.message || "All configured LLM providers exhausted",
        providersTried: uniqueProviders,
        timestamp: Date.now(),
      }));
    } catch { /* best effort */ }
  }

  throw lastError || new Error('V1 API tool loop failed');
}

/**
 * Run V1 API simple completion (no tools)
 */
async function runV1Orchestrated(
  config: UnifiedAgentConfig,
  messages: any[],
  startTime: number
): Promise<UnifiedAgentResult> {
  // === SESSION TRACKING FOR SUCCESSIVE CALLS ===
  const sessionId = config.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const feedbackContext: FeedbackContext = {
    sessionId,
    turnNumber: 0,
    accumulatedFeedback: [],
    recentFailures: [],
    corrections: [],
  };

  // Acquire orchestrator concurrency slot (queue when saturated)
  await acquireOrchSlot();

  // Ensure tool system is initialized
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: config.userId || 'system', enableMCP: true, enableSandbox: true });
  }

  // Use shared capability-based tool executor
  const capabilityExecuteTool = createCapabilityToolExecutor(config);

  // Resolve provider/model with the same precedence as the rest of the service
  // (config override -> dynamic defaults). Without this, PlanActVerifyOrchestrator
  // silently falls back to its hardcoded `openai`/`gpt-4o` schema defaults and
  // tries to use OPENAI_API_KEY even when the user picked a different provider.
  const _orchProvDefaults = await resolveDynamicDefaults();
  const resolvedProvider = config.provider || _orchProvDefaults.provider;
  const resolvedModel = config.model || _orchProvDefaults.model;
  log.info('[runV1Orchestrated] Passing provider/model to PlanActVerify', {
    provider: resolvedProvider,
    model: resolvedModel,
    fromConfig: !!config.provider,
  });

  const orchestratorConfig: OrchestratorConfig = {
    iterationConfig: {
      maxIterations: config.maxSteps || parseInt(process.env.LLM_AGENT_TOOLS_MAX_ITERATIONS || '15', 10),
      maxTokens: config.maxTokens || 32000,
      maxDurationMs: parseInt(process.env.LLM_AGENT_TOOLS_TIMEOUT_MS || '600000', 10),
      provider: resolvedProvider,
      model: resolvedModel,
    },
    tools: config.tools || [],
    executeTool: capabilityExecuteTool,
  };

  const orchestrator = new PlanActVerifyOrchestrator(orchestratorConfig);
  let content = '';
  let firstResponseContent: string | null = null; 
  let stepsCount = 0;
  let budgetExhausted = false;
  // Resilience tracking: the orchestrator catches its own fatal errors and yields
  // a `warning` followed by a non-empty "I encountered an error..." done event,
  // so a thrown-error catch would never fire. Track the warning explicitly and
  // count streamed text so we can safely cascade to the resilient v1-api path
  // without double-streaming a second answer.
  let orchestrationFailed = false;
  let streamedTextLength = 0;
  const steps: any[] = [];

  try {
    for await (const event of orchestrator.execute(config.userMessage, messages)) {
      if (config.onStreamChunk && event.type === 'token') {
        streamedTextLength += event.content?.length || 0;
        config.onStreamChunk(event.content);
      }

      if (event.type === 'warning' && /orchestration failed/i.test((event as any).message || '')) {
        orchestrationFailed = true;
        log.warn('[runV1Orchestrated] Orchestrator reported failure', { message: (event as any).message });
      }

      if (event.type === 'done') {
        content = event.response;
        stepsCount = event.stats?.iterations || 0;
        
        if (!firstResponseContent && content) {
          firstResponseContent = content;
        }

        if (event.budgetExhausted) {
          budgetExhausted = true;
        }
      } else if (event.type === 'tool_result') {
        recordToolCall(sessionId);
        
        steps.push({
          toolName: event.tool,
          args: {},
          result: { success: true, output: JSON.stringify(event.result), exitCode: 0 },
        });

        // Check for re-evaluation trigger
        const reEvalTrigger = checkReEvalTrigger(sessionId);
        if (reEvalTrigger.triggered) {
          log.info('[ReEval-Orchestrated] Trigger detected', { 
            reason: reEvalTrigger.reason,
            recommendedAction: reEvalTrigger.recommendedAction,
          });
          recordReEval(sessionId);
        }
      }
    }

    // Successive tracking and feedback
    const freshTracker = getTracker(sessionId);
    recordResponse(sessionId, content.length, true);
    
    const healingTrigger = detectHealingTrigger(feedbackContext, content, freshTracker.consecutiveToolCalls);

    // [STEER] Bug #21: when the consecutive/total tool-call cap fires, emit a
    // steer so the LLM switches to text-mode instead of being silently truncated.
    // No-op when the cap hasn't been hit (returns null).
    const capSteer = wireConsecutiveToolCapSteer({
      consecutive: freshTracker.consecutiveToolCalls,
      consecutiveThreshold: STEER_CONSECUTIVE_CAP,
      total: freshTracker.toolCallCount,
      totalThreshold: STEER_TOTAL_CAP,
      provider: config.provider,
      model: config.model,
    });
    if (capSteer) {
      log.info('[STEER] consecutive-tool-cap fired', {
        consecutive: freshTracker.consecutiveToolCalls,
        total: freshTracker.toolCallCount,
      });
      (config as any)._toolCapSteer = capSteer;
    }

    // FIX: Wire up healingTrigger to actually trigger self-healing paths
    // Previously healingTrigger was detected but only logged, not used to route to healing
    if (healingTrigger.detected) {
      log.info('\x1b[32m[AutoHealing]\x1b[0m Healing trigger detected', {
        reason: healingTrigger.reason,
        healingMode: healingTrigger.healingMode,
      });
      // Generate healing prompt and attach to config for self-healing path
      const originalTask = config.userMessage || '';
      const healingPrompt = generateHealingPrompt(healingTrigger, feedbackContext, originalTask);
      (config as any)._healingPrompt = healingPrompt;
    }

    const injectedFeedback = injectFeedback(feedbackContext, getFeedbackInjectionBudget(feedbackContext));
    const trackerSummary = generateTrackerSummary(sessionId);

    (config as any)._injectedFeedback = injectedFeedback;
    (config as any)._trackerSummary = trackerSummary;
    log.info('[FirstResponse] Feedback injection stashed on config', {
      hasCorrection: !!injectedFeedback.correctionSection,
      correctionLen: injectedFeedback.correctionSection?.length || 0,
      hasHealing: !!injectedFeedback.healingInstructions,
      healingLen: injectedFeedback.healingInstructions?.length || 0,
      hasFormatGuidance: !!injectedFeedback.formatGuidance,
      formatLen: injectedFeedback.formatGuidance?.length || 0,
      hasTrackerSummary: !!trackerSummary,
    });

    // ─── First-Response Routing Parsing ───
    const parsedRouting: ParsedRouting = parseFirstResponseRouting(firstResponseContent || content);
    if (parsedRouting.found && parsedRouting.routing) {
      (config as any)._roleSelectMetadata = parsedRouting.routing;
      log.info('[RoleSelectParser] Parsed routing', {
        classification: parsedRouting.routing.classification,
        role: parsedRouting.routing.suggestedRole,
        continue: parsedRouting.routing.continue,
      });

      // Audit-Q7 option-(c) carve-out: Sites 3+4 (canonical-first-response
      // routing) deliberately DO NOT pass `advancedDetectorFn` here.
      //
      // (b) Inverse-case contract: BOTH `defaultFileEditDetector` (the helper's
      // default `detectorFn`) and `needsMoreTurnsDetector` (advanced optional)
      // return `null` (NOT `{force:false}` — there is no `force:false` path on
      // either function; the override type is `{ force: true, reason: string }
      // | null`) when their input signals are missing. Both read
      // `result.fileEdits` to compute their override — at Sites 3+4 no
      // `result` argument is passed in, so both gracefully fall through,
      // returning `null`. The LLM-emitted `parsedRouting.routing.continue`
      // boolean therefore remains the canonical continuation signal at this
      // decision point.
      //
      // (c) 'lose' reframed: this is not the detector losing on undefined —
      // it's gracefully falling through. The helper's cascade resolves to
      // `decideAutoContinue` -> `shouldAutoContinue` -> routing-derived
      // reason (one of: 'role_selection_continue_true',
      // 'plan_steps_remaining', 'single_step_read_pattern',
      // 'empty_tool_args_detected', 'single_write_then_stop',
      // 'no_continuation_needed', 'max_continuations_reached'). None of
      // these are detector-derived buckets.
      //
      // (d) Decision.reason guard: tests assert that
      // `decision.reason` is NOT in the detector-bucket allowlist
      // ['file_edits_present', 'needs_more_turns', 'read-then-stall',
      // 'deep-research-loop', 'failure-cascade', 'write-verify-loop',
      // 'announced-next-step', 'incomplete-thought', 'step-enumeration',
      // 'planned-multi-step', 'read-many-write-none', 'single-write-silent',
      // 'diff-no-explanation', 'edits-mismatch', 'empty-after-tools',
      // 'unclosed-code-block', 'mid-sentence-cutoff'], to catch regressions
      // where a future refactor wires a detector into this slot.
      //
      // Precedence contract: when both detectors return non-null overrides,
      // `advancedDetectorFn` wins over `detectorFn`. Tested explicitly in
      // __tests__/chat/auto-continue-helper.test.ts in the 'advancedDetectorFn
      // reason wins when both detectors fire' describe block.
      const autoDecision = decideAutoContinue({
        requestId: '',
        routing: parsedRouting.routing as unknown as AutoContinueRouting,
        steps: [],
        responseText: firstResponseContent || content || '',
      });
      if (autoDecision.continue && parsedRouting.routing.planSteps.length > 0) {
        (config as any)._stepReprompt = generateStepReprompt(parsedRouting.routing, 0);
      }
      
      if (!injectedFeedback.roleRedirectSection && parsedRouting.routing.roleOptions.length > 0) {
        const routingRedirect = routingToRoleRedirectSection(parsedRouting.routing);
        if (routingRedirect) {
          (config as any)._routingRoleRedirect = routingRedirect;
        }
      }
    }

    // Review cycle check
    const reviewCheck = shouldTriggerReview(
      stepsCount,
      freshTracker.consecutiveToolCalls,
      (freshTracker as any).toolCalls || 0,
      1.0 
    );

    if (reviewCheck.trigger) {
      log.warn('[ReviewCycle] Threshold exceeded, triggering review', { reason: reviewCheck.reason });
      (config as any)._reviewTriggered = true;
      (config as any)._reviewReason = reviewCheck.reason;
      (config as any)._reviewSuggestedAction = reviewCheck.suggestedAction;
    }

    // Telemetry and results
    const _orchDefaults = await resolveDynamicDefaults();
    const provider = config.provider || _orchDefaults.provider;
    const model = config.model || _orchDefaults.model;
    const duration = Date.now() - startTime;

    chatRequestLogger.logRequestComplete(
      `unified-v1-orch-${Date.now()}`,
      true,
      undefined,
      undefined,
      duration,
      undefined,
      provider,
      model,
    ).catch(() => {});

    // Truncate at first [ROLE_SELECT] (drops simulated multi-turn) and strip
    // any remaining markers so the client never sees the raw routing JSON.
    const truncatedContent = truncateAtFirstRouting(content);
    const cleanedResponse = stripRoutingMarkers(truncatedContent);

    // Build the client-facing routing metadata (with stepReprompt) so the chat
    // UI can auto-continue multi-step plans. Falls back to undefined when no
    // routing block was parsed.
    const roleSelectMeta = (config as any)._roleSelectMetadata as RoutingMetadata | undefined;
    const routingForClient = roleSelectMeta ? buildRoutingMetadataForClient(roleSelectMeta) : undefined;

    // Cascade to the resilient v1-api path when the orchestrator degraded:
    //   - budget exhausted, OR
    //   - it caught a fatal error (warning + sentinel done response), OR
    //   - it produced empty content and streamed nothing visible to the client.
    // The streamedTextLength guard prevents emitting a second answer on top of
    // already-streamed orchestrator output. We never override an active
    // role-select auto-continue flow (roleSelectMeta.continue).
    const contentEmpty = !cleanedResponse || !cleanedResponse.trim();
    const shouldFallbackToV1Api =
      roleSelectMeta?.continue !== false &&
      (budgetExhausted ||
        orchestrationFailed ||
        (contentEmpty && streamedTextLength === 0));
    const fallbackReason = budgetExhausted
      ? 'budget_exhausted'
      : orchestrationFailed
        ? 'orchestration_failed'
        : 'empty_response';

    if (shouldFallbackToV1Api) {
      log.warn('[runV1Orchestrated] Orchestrator degraded, falling back to v1-api', { fallbackReason, streamedTextLength });
      try {
        // BUG FIX: Create a fresh AbortController for the fallback attempt
        // instead of reusing the orchestrator's signal. This prevents
        // "caller aborted before start" errors when the orchestrator signal
        // was fired due to orchestrator timeout (not user abort).
        // The orchestrator may have timed out, but that doesn't mean the
        // fallback v1-api should be rejected without attempting it.
        const fallbackAbortController = new AbortController();
        const fallbackConfig = {
          ...config,
          abortSignal: fallbackAbortController.signal,
        };
        
        const fallbackResult = await runV1Api(fallbackConfig);
        log.info('[runV1Orchestrated] v1-api fallback completed', { fallbackReason });
        // Bug #40: tag the response as degraded:true so the UI/route can
        // show a banner and the next-turn LLM sees the [STEER] orchestration_
        // fallback hint. This is the PRIMARY orchestration_fallback site —
        // the outer attemptFallback rescue only fires on thrown errors, but
        // this normal internal cascade is the bug-reproduction case. The
        // typed budgetExhausted boolean is in scope here (no substring
        // detection needed). sessionId is composite-keyed so the counter
        // is scoped to the same key the chat route uses.
        const _tagged = await tagResultDegraded({
          ...fallbackResult,
          metadata: {
            ...fallbackResult.metadata,
            budgetExhausted,
            originalOrchResponse: cleanedResponse.slice(0, 200) + (cleanedResponse.length > 200 ? '...' : ''),
            fallbackFrom: 'v1-agent-loop',
            fallbackReason,
            ...(routingForClient ? { routing: routingForClient } : {}),
            ...(roleSelectMeta ? { roleSelection: {
              classification: roleSelectMeta.classification,
              complexity: roleSelectMeta.complexity,
              suggestedRole: roleSelectMeta.suggestedRole,
              specializationRoute: roleSelectMeta.specializationRoute,
              planSteps: roleSelectMeta.planSteps?.length || 0,
              continue: roleSelectMeta.continue,
              reviewTriggered: (config as any)._reviewTriggered || false,
              reviewReason: (config as any)._reviewReason || undefined,
            }} : {}),
          },
        }, {
          fromMode: 'v1-agent-loop',
          toMode: fallbackResult.mode || 'v1-api',
          fallbackReason,
          // Use the composite key (filesystemOwnerId + conversationId) when
          // available, matching the chat route's chain key. Falls back to
          // the bare conversationId/userId key for callers that don't set
          // filesystemOwnerId (tests, internal callers).
          sessionId: config.filesystemOwnerId
            ? `${config.filesystemOwnerId}$${config.conversationId || 'default'}`
            : (config.conversationId || config.userId || 'default'),
          budgetExhausted,
        });
        // Release orchestrator slot before returning
        try { releaseOrchSlot(); } catch { /* best-effort */ }
        return _tagged;
      } catch (fbError: any) {
        log.error('[runV1Orchestrated] v1-api fallback also failed', { error: fbError?.message || String(fbError) });

        // Try broader fallback chain before giving up
        try {
          const triedModes = new Set<string>(['v1-agent-loop', 'v1-api']);
          const chainResult = await attemptFallback(config, 'v1-agent-loop', triggerFromError(fbError, config.provider, 'v1-api'), triedModes);
          if (chainResult) {
            log.info('[runV1Orchestrated] attemptFallback chain succeeded after budget exhaustion + v1-api failure');
            return {
              ...chainResult,
              metadata: {
                ...chainResult.metadata,
                budgetExhausted,
                fallbackReason,
                originalOrchResponse: cleanedResponse,
                fallbackChain: ['v1-agent-loop', 'v1-api', chainResult.mode],
...(routingForClient ? { routing: routingForClient } : {}),
            ...(roleSelectMeta ? { roleSelection: {
              classification: roleSelectMeta.classification,
              complexity: roleSelectMeta.complexity,
              suggestedRole: roleSelectMeta.suggestedRole,
              specializationRoute: roleSelectMeta.specializationRoute,
              planSteps: roleSelectMeta.planSteps?.length || 0,
              continue: roleSelectMeta.continue,
              reviewTriggered: (config as any)._reviewTriggered || false,
              reviewReason: (config as any)._reviewReason || undefined,
            }} : {}),
              },
            };
          }
        } catch (chainErr: any) {
          log.error('[runV1Orchestrated] attemptFallback chain also failed', { error: chainErr?.message || String(chainErr) });
        }
        // Both fallbacks failed after budget exhaustion — return partial orchestrated result with budgetExhausted signal so callers can distinguish degraded response
        const _resFallbackFailed = {
          success: true,
          response: stringifyMessageContent(cleanedResponse),
          steps,
          totalSteps: stepsCount,
          mode: 'v1-agent-loop',
          metadata: {
            provider,
            model,
            duration,
            orchestrator: true,
            budgetExhausted,
            fallbackReason,
            fallbackFailed: true,
            originalOrchResponse: cleanedResponse.slice(0, 200) + (cleanedResponse.length > 200 ? '...' : ''),
            ...(routingForClient ? { routing: routingForClient } : {}),
            ...(roleSelectMeta ? { roleSelection: {
              classification: roleSelectMeta.classification,
              complexity: roleSelectMeta.complexity,
              suggestedRole: roleSelectMeta.suggestedRole,
              specializationRoute: roleSelectMeta.specializationRoute,
              planSteps: roleSelectMeta.planSteps?.length || 0,
            }} : {}),
          },
        };
        try { releaseOrchSlot(); } catch { /* best-effort */ }
        return _resFallbackFailed;
      }
    }

    const _resSuccess = {
      success: true,
      response: stringifyMessageContent(cleanedResponse),
      steps,
      totalSteps: stepsCount,
      mode: 'v1-agent-loop',
      metadata: {
        provider,
        model,
        duration,
        orchestrator: true,
        ...(routingForClient ? { routing: routingForClient } : {}),
        roleSelection: roleSelectMeta ? {
          classification: roleSelectMeta.classification,
          complexity: roleSelectMeta.complexity,
          suggestedRole: roleSelectMeta.suggestedRole,
          specializationRoute: roleSelectMeta.specializationRoute,
          planSteps: roleSelectMeta.planSteps?.length || 0,
          continue: roleSelectMeta.continue,
          reviewTriggered: (config as any)._reviewTriggered || false,
          reviewReason: (config as any)._reviewReason || undefined,
        } : undefined,
      },
    };
    try { releaseOrchSlot(); } catch { /* best-effort */ }
    return _resSuccess;
  } catch (err: any) {
    invalidateDynamicDefaultsCache();
    const _orchDefaults = await resolveDynamicDefaults();
    const provider = config.provider || _orchDefaults.provider;
    const model = config.model || _orchDefaults.model;
    const duration = Date.now() - startTime;

    chatRequestLogger.logRequestComplete(
      `unified-v1-orch-${Date.now()}`,
      false,
      undefined,
      undefined,
      duration,
      err.message,
      provider,
      model,
    ).catch(() => {});

    try { releaseOrchSlot(); } catch { /* best-effort */ }
    throw err;
  }
}

async function runV1ApiCompletion(
  config: UnifiedAgentConfig,
  messages: any[],
  llmProvider: LLMProvider,
  startTime: number
): Promise<UnifiedAgentResult> {
  // === SESSION TRACKING FOR SUCCESSIVE CALLS ===
  const sessionId = config.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const feedbackContext: FeedbackContext = {
    sessionId,
    turnNumber: 0,
    accumulatedFeedback: [],
    recentFailures: [],
    corrections: [],
  };
  // @ts-ignore - tracker API may vary
  // === END SESSION TRACKING ===

  if (process.env.ENABLE_V1_ORCHESTRATOR === 'true') {
    // PlanActVerify orchestrator is available as a standalone mode
    // (mode: 'energy-driven' or mode: 'attractor-driven') instead of
    // being hidden behind this env flag.
    log.info('[V1-API-COMPLETION] ENABLE_V1_ORCHESTRATOR is deprecated; use a harness mode instead');
  }

  // Standard completion path

  log.info('[V1-API-COMPLETION] ┌─ ENTRY ──────────────────────────');

  // Use config provider/model if specified, otherwise fall back to env defaults
  // FIX: Use shared dynamic defaults resolver instead of hardcoded mistral
  // Win #2b (docs/async-parallelization-opportunities.md): like SITE B,
  // Promise.all the cache-hit resolve with the PROVIDERS dynamic import. The
  // model-ranker import on the next try/catch stays sequential because
  // including it in Promise.all would propagate its (possibly-thrown)
  // rejection outside the try/catch and lose the graceful-degradation
  // semantics (empty `_getModelForRotation` means fall back to
  // PROVIDER_DEFAULT_MODELS first).
  const [_completionDefaults, _llmProvidersMod] = await Promise.all([
    resolveDynamicDefaults(),
    import('../providers/llm-providers'),
  ]);
  const primaryProvider = config.provider || _completionDefaults.provider;
  const primaryModel = config.model || _completionDefaults.model;
  const requestId = `unified-v1-${Date.now()}`;

  log.info('[V1-API-COMPLETION] │ primaryProvider:', primaryProvider);
  log.info('[V1-API-COMPLETION] │ primaryModel:', primaryModel);
  log.info('[V1-API-COMPLETION] │ requestId:', requestId);
  log.info('[V1-API-COMPLETION] └────────────────────────────────────');

  // FIX: Map each provider to a model that supports tool calling / function calling.
  // Also: when falling back, check if the model is valid for the target provider.
  const { PROVIDERS } = _llmProvidersMod;
  let _getModelForRotation: any = null;
  try {
    const mrMod = await import('../providers/model-ranker');
    _getModelForRotation = mrMod.getModelForRotation || null;
  } catch { /* model-ranker unavailable */ }

  function getModelForProvider(providerName: string): string {
    // Get first model from provider's own model list (always valid for that provider)
    // Uses PROVIDERS from the closure scope (dynamic import above)
    function _getProviderFirstModel(pn: string): string | undefined {
      const p = PROVIDERS[pn.toLowerCase()];
      if (p?.models && Array.isArray(p.models) && p.models.length > 0) {
        const first = p.models[0];
        return typeof first === 'string' ? first : first?.id;
      }
      return undefined;
    }

    // If no explicit model set, use model-ranker's highest-ranked model first,
    // then provider default, then first model from provider's own list
    // CRITICAL: NEVER fall back to primaryModel for a different provider
    if (!config.model) {
      // Use model-ranker telemetry to select highest-ranked model for this provider
      const rotation = _getModelForRotation?.(undefined, providerName);
      if (rotation?.model) return rotation.model;
      return PROVIDER_DEFAULT_MODELS[providerName] || _getProviderFirstModel(providerName) || PROVIDER_DEFAULT_MODELS[providerName];
    }

    // Check if the model is valid for this provider
    const provider = PROVIDERS[providerName.toLowerCase()];
    if (provider?.models && provider.models.length > 0) {
      // Normalize models to handle both string and object formats
      const supportedModels = provider.models.map((entry: any) =>
        typeof entry === 'string' ? entry : entry?.id
      ).filter(Boolean);
      
      if (supportedModels.includes(config.model)) return config.model;
      // Model not in provider's list — use model-ranker's highest-ranked or provider's own model
      log.debug(`Model "${config.model}" not in ${providerName} models list, using default`);
      const rotation = _getModelForRotation?.(undefined, providerName);
      if (rotation?.model) return rotation.model;
      return PROVIDER_DEFAULT_MODELS[providerName] || _getProviderFirstModel(providerName) || PROVIDER_DEFAULT_MODELS[providerName];
    }

    // Unknown provider — trust the config model
    return config.model;
  }

  // Build list of providers to try: primary + fallback chain (only configured ones)
  const fallbackChain = getConfiguredFallbackChain(primaryProvider);
  const providersToTry = [primaryProvider, ...fallbackChain];
  // Deduplicate while preserving order
  const uniqueProviders = [...new Set(providersToTry)];

  log.info('[V1-API-COMPLETION] ┌─ PROVIDER FALLBACK CHAIN ────────');
  log.info(`[V1-API-COMPLETION] │ primary: ${primaryProvider}/${primaryModel}`);
  log.info('[V1-API-COMPLETION] │ configured fallbacks:', fallbackChain);
  log.info('[V1-API-COMPLETION] │ will try (deduped):', uniqueProviders);
  log.info('[V1-API-COMPLETION] └────────────────────────────────────');

  let lastError: Error | null = null;

  // Try each provider in order using same pattern as enhanced-llm-service.ts
  for (const providerName of uniqueProviders) {
    // GUARD: If client disconnected, skip ALL provider attempts.
    if (isClientDisconnected()) {
      log.warn("[V1-API] Client already disconnected - breaking provider loop immediately");
      break;
    }

    if (is530Blacklisted(providerName) || isServerErrorBlacklisted(providerName)) { log.warn("530 BLACKLISTED in completion, skipping " + providerName); continue; }
    const modelForProvider = getModelForProvider(providerName);
    try {
      log.info('[V1-API-COMPLETION] ┌─ ATTEMPT ───────────────────');
      log.info('[V1-API-COMPLETION] │ provider:', providerName);
      log.info('[V1-API-COMPLETION] │ model:', modelForProvider);
      log.info('[V1-API-COMPLETION] │ isFirst:', providerName === primaryProvider);
      log.info('[V1-API-COMPLETION] └───────────────────────────────');

      // FIX: Check circuit-breaker and rate-limit state before attempting
      try {
        const { circuitBreakerManager: cbMgr } = await import('../middleware/circuit-breaker');
        const cb = cbMgr.getBreaker(providerName);
        if (cb.getState() === 'OPEN') {
          log.warn('[V1-API-COMPLETION] CIRCUIT OPEN - Skipping provider:', providerName);
          continue;
        }
      } catch { /* circuit-breaker unavailable, proceed */ }
      try {
        const { isRateLimited } = await import('../providers/model-ranker');
        if (isRateLimited(providerName, modelForProvider)) {
          log.warn(`[V1-API-COMPLETION] RATE LIMITED - Skipping model: ${modelForProvider} for provider: ${providerName}`);
          continue;
        }
      } catch { /* model-ranker unavailable, proceed */ }

      const { streamWithConcurrentFallback } = await import('../chat/enhanced-llm-service');

      let content = '';
      const fileEdits: Array<{ path: string; content: string; action?: string }> = [];
      const toolCalls: Array<{ tool: string; args: any; result: any }> = [];
      const streamOpts = {
        provider: providerName,
        model: modelForProvider,
        messages: messages as import("../providers/llm-providers").LLMMessage[],
        // runV1ApiCompletion is only reached when executeTool is unavailable,
        // after runV1Api() has already folded system messages into
        // config.systemPrompt. Preserve the resolved system prompt here so
        // the simple/fallback completion path keeps its context.
        ...(config.systemPrompt ? { system: config.systemPrompt } : {}),
        temperature: config.temperature || 0.7,
        maxTokens: config.maxTokens || 4096,
        maxRetries: 0,
        maxSteps: 12,  // Allow tool execution
        // Tool-free completion branch: this path cannot run tools (no
        // executeTool handler in scope), so passing config.tools would
        // invite the model to call tool functions that have no runnable
        // handler. Force tools to undefined so the LLM completes in
        // text mode only.
        tools: undefined,
        // Forward the caller's abort signal so a user-initiated stop (or the
        // route-level hard deadline) truly cancels the upstream HTTP request
        // and re-arms the fallback coordinator's user-abort race arm.
        signal: config.abortSignal,
      };

      if (config.onStreamChunk) {
        log.debug('[ORCHESTRATOR] Passing tools to streamWithConcurrentFallback:', config.tools?.map((t: any) => t.name));
        for await (const chunk of streamWithConcurrentFallback(streamOpts)) {
          if (chunk.content) {
            content += chunk.content;
            config.onStreamChunk(chunk.content);
          }
          // CRITICAL FIX: Collect file edits from streaming chunks
          if ((chunk as any).fileEdits && (chunk as any).fileEdits.length > 0) {
            fileEdits.push(...(chunk as any).fileEdits);
          }
          // Collect tool call records
          if ((chunk as any).toolCall) {
            toolCalls.push((chunk as any).toolCall);
          }
        }
      } else {
        for await (const chunk of streamWithConcurrentFallback(streamOpts)) {
          if (chunk.content) {
            content += chunk.content;
          }
          // CRITICAL FIX: Collect file edits from streaming chunks (non-streaming path too)
          if ((chunk as any).fileEdits && (chunk as any).fileEdits.length > 0) {
            fileEdits.push(...(chunk as any).fileEdits);
          }
          if ((chunk as any).toolCall) {
            toolCalls.push((chunk as any).toolCall);
          }
        }
      }

      if (providerName !== primaryProvider) {
        log.info(`[V1-API-COMPLETION] Fallback provider succeeded`, {
          primaryProvider,
          primaryModel,
          fallbackProvider: providerName,
          fallbackModel: modelForProvider,
        });
      }

      // FIX: Record success in circuit-breaker and model-ranker for runV1ApiCompletion
      try {
        const { circuitBreakerManager: cbMgrOk } = await import('../middleware/circuit-breaker');
        cbMgrOk.getBreaker(providerName).recordSuccess();
      } catch { /* ignore */ }
      try {
        const { recordModelAttempt } = await import('../providers/model-ranker');
        recordModelAttempt(providerName, modelForProvider, true);
      } catch { /* ignore */ }

      // FIX: Extract file writes from bash code blocks in the LLM response
      // and actually write them to the VFS. The LLM often outputs bash commands
      // (echo "content" > file, cat > file << EOF) instead of using tool calls.
      // This bridges the gap so those files actually get created.
      const bashWrites = extractFileWritesFromLLMResponse(content, { scopePath: config.scopePath });
      if (bashWrites.length > 0) {
        log.info(`[V1-API-COMPLETION] Extracted ${bashWrites.length} file writes from bash commands`, {
          paths: bashWrites.map(w => w.path),
        });
        // Write each extracted file to VFS
        const { virtualFilesystem } = await import('@/lib/virtual-filesystem/index.server');
        const ownerId = config.userId || config.filesystemOwnerId || '1';
        for (const write of bashWrites) {
          try {
            await virtualFilesystem.writeFile(ownerId, write.path, write.content);
            log.info(`[V1-API-COMPLETION] Wrote file from bash extraction: ${write.path}`);
          } catch (err: any) {
            log.warn(`[V1-API-COMPLETION] Failed to write extracted file ${write.path}:`, err.message);
          }
        }
      }

      // Extract file edits from text content (fenced code blocks, inline writes, etc.)
      // This catches edits that models produce in text-mode (no tool calls)
      if (content && fileEdits.length === 0) {
        try {
          const { extractFileEdits } = await import('@/lib/chat/file-edit-parser');
          const { virtualFilesystem } = await import('@/lib/virtual-filesystem/index.server');
          const textEdits = extractFileEdits(content);
          const ownerId = config.userId || config.filesystemOwnerId || '1';
          const textScopePath = config.scopePath || (config.conversationId ? `workspace/sessions/${config.conversationId}` : undefined);
          for (const edit of textEdits) {
            if (edit.path && edit.content) {
              try {
                const editPath = textScopePath ? `${textScopePath}/${edit.path}` : edit.path;
                if (edit.action === 'delete') {
                  await virtualFilesystem.deletePath(ownerId, editPath);
                } else {
                  await virtualFilesystem.writeFile(ownerId, editPath, edit.content);
                }
                fileEdits.push({ path: edit.path, content: edit.content, action: edit.action || 'write' });
              } catch (editErr: any) {
                log.warn(`[V1-API-COMPLETION] Failed to apply text-extracted edit ${edit.path}:`, editErr.message);
              }
            }
          }
          if (textEdits.length > 0) {
            log.info(`[V1-API-COMPLETION] Extracted ${textEdits.length} file edits from text content`, {
              applied: fileEdits.length,
              paths: fileEdits.map(e => e.path),
            });
          }
        } catch (parseErr: any) {
          log.debug('[V1-API-COMPLETION] Text file-edit extraction skipped:', parseErr.message);
        }
      }

      // FIX: Record telemetry with the ACTUAL provider/model (handles fallbacks)
      const latencyMs = Date.now() - startTime;
      chatRequestLogger.logRequestComplete(
        requestId,
        true,
        undefined,
        undefined,
        latencyMs,
        undefined,
        providerName,
        modelForProvider,
      ).catch(() => {});

      const fallbackChainUsed = providerName !== primaryProvider
        ? uniqueProviders.slice(0, uniqueProviders.indexOf(providerName) + 1)
        : [];

      // FIX: Track response and check for healing triggers in completion path
      const responseSuccess = content.trim().length > 0;
      recordResponse(sessionId, content.length, responseSuccess);
      const freshTracker = getTracker(sessionId);
      const healingTrigger = detectHealingTrigger(feedbackContext, content, freshTracker.consecutiveToolCalls);
      if (healingTrigger.detected) {
        log.info('[AutoHealing-Completion] Healing trigger detected', { reason: healingTrigger.reason, healingMode: healingTrigger.healingMode });
        const healingPrompt = generateHealingPrompt(healingTrigger, feedbackContext, config.userMessage);
        // Inject dynamic feedback for self-routing./
        const injectedFeedback = injectFeedback(feedbackContext, getFeedbackInjectionBudget(feedbackContext));
        const trackerSummary = generateTrackerSummary(sessionId);
        (config as any)._injectedFeedback = injectedFeedback;
        (config as any)._trackerSummary = trackerSummary;
        log.info('[AutoHealing-Completion] Feedback injection prepared', {
          hasCorrection: !!injectedFeedback.correctionSection,
          correctionLen: injectedFeedback.correctionSection?.length || 0,
          hasHealing: !!injectedFeedback.healingInstructions,
          healingLen: injectedFeedback.healingInstructions?.length || 0,
          hasFormatGuidance: !!injectedFeedback.formatGuidance,
          formatLen: injectedFeedback.formatGuidance?.length || 0,
          hasTrackerSummary: !!trackerSummary,
        });
        // Also inject feedback into messages for completion path
        if (injectedFeedback || trackerSummary) {
          const feedbackParts = [];
          if (injectedFeedback?.correctionSection) feedbackParts.push(injectedFeedback.correctionSection);
          if (injectedFeedback?.healingInstructions) feedbackParts.push(injectedFeedback.healingInstructions);
          if (injectedFeedback?.formatGuidance) feedbackParts.push(injectedFeedback.formatGuidance);
          if (trackerSummary) feedbackParts.push(trackerSummary);
          if (feedbackParts.length > 0) {
            const feedbackSystemMsg = { role: 'system' as const, content: feedbackParts.join('\n\n') };
            messages = [feedbackSystemMsg, ...messages];
            log.info('[V1-API-COMPLETION] Injected feedback into messages array', { feedbackParts: feedbackParts.length });
          }
        }
      }

      // Parse [ROLE_SELECT] (text-mode routing), truncate at the first marker
      // so simulated continuation turns are dropped, and strip any remaining
      // marker blocks for safety. Build routing metadata for client auto-continue.
      let routingForClientCompletion: ReturnType<typeof buildRoutingMetadataForClient> | undefined;
      try {
        const parsedCompletionRouting = parseFirstResponseRouting(content);
        if (parsedCompletionRouting.found && parsedCompletionRouting.routing) {
          routingForClientCompletion = buildRoutingMetadataForClient(parsedCompletionRouting.routing);
          log.info('[V1-API-COMPLETION] [RoleSelect] Parsed routing', {
            classification: parsedCompletionRouting.routing.classification,
            role: parsedCompletionRouting.routing.suggestedRole,
            continue: parsedCompletionRouting.routing.continue,
            planSteps: parsedCompletionRouting.routing.planSteps?.length || 0,
            willAutoContinue: routingForClientCompletion.continue,
          });
        }
      } catch (err: any) {
        log.warn('[V1-API-COMPLETION] [RoleSelect] Parse failed', { error: err?.message });
      }
      const truncatedCompletion = truncateAtFirstRouting(content);
      const cleanedResponse = stripRoutingMarkers(truncatedCompletion);
      const isEmpty = !cleanedResponse || !cleanedResponse.trim();

// PR-F: clear the 530-blacklist counter on this provider's success.
// Gated by ENABLE_530_RESET_ON_SUCCESS=1 (default OFF) inside the helper.
// PR-W -- single-call both-trackers reset (replaces the manual pair).
maybeResetBothTrackers(providerName);
return {
        success: true,
        response: cleanedResponse || '',
        mode: 'v1-api',
        metadata: {
          provider: providerName,
          model: modelForProvider,
          duration: latencyMs,
          fallbackChain: fallbackChainUsed,
          // CRITICAL FIX: Include collected file edits and tool calls
          fileEdits: fileEdits.length > 0 ? fileEdits : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          ...(routingForClientCompletion ? { routing: routingForClientCompletion } : {}),
          // Signal emptiness so client triggers retry-with-rotation instead of
          // rendering a useless "No response generated" literal.
          ...(isEmpty ? { isEmptyResponse: true, emptyReason: 'v1-api-completion produced no text' } : {}),
        },
      };
    } catch (error: any) {
      lastError = error;
      // PR-E + PR-H: both trackers fire here in parallel — pure
      // record-or-noop, NEVER cross-wipe each other's Map. Parallels
      // lib/chat/enhanced-llm-service.ts:746. Non-matching error
      // signatures leave both counters untouched; only the corresponding
      // success-path helpers decrement them (gated by ENABLE_*_RESET_ON_SUCCESS).
      record5xxErrorIfApplicable(providerName, error);
      record530ErrorIfApplicable(providerName, error);

      // FIX: Invalidate cache so subsequent requests pick a different provider
      invalidateDynamicDefaultsCache();

      // Record failure in circuit-breaker
      try {
        const { circuitBreakerManager: cbMgrCatch } = await import('../middleware/circuit-breaker');
        cbMgrCatch.getBreaker(providerName).recordFailure(error);
      } catch { /* ignore */ }

      log.warn('[V1-API-COMPLETION] ┌─ ATTEMPT FAILED ────────────');
      log.warn('[V1-API-COMPLETION] │ provider:', providerName);
      log.warn('[V1-API-COMPLETION] │ model:', modelForProvider);
      log.warn('[V1-API-COMPLETION] │ error:', error.message);
      log.warn('[V1-API-COMPLETION] │ will try next:', uniqueProviders.slice(uniqueProviders.indexOf(providerName) + 1).join(', ') || 'NO MORE');
      log.warn('[V1-API-COMPLETION] └───────────────────────────────');
    }
  }

    // FIX: Track provider failure for feedback injection
  const providerFailureEntry = createFeedbackEntry(
    'failure',
    `All providers failed in completion: ${lastError?.message || 'Unknown error'}. Tried: ${uniqueProviders.join(', ')}`,
    'llm_response',
    { providers: uniqueProviders, error: lastError?.message },
    'critical'
  );
  feedbackContext.turnNumber++;
  addFeedback(feedbackContext, providerFailureEntry);
  recordResponse(sessionId, 0, false);

// All providers failed
  const latencyMs = Date.now() - startTime;

  log.error('[V1-API-COMPLETION] ┌─ ALL PROVIDERS FAILED ─────────');
  // FIX: Emit error chunk to user so they see a failure instead of blank screen.
  if (config.onStreamChunk) {
    try {
      config.onStreamChunk(sseEncode(SSE_EVENT_TYPES.ERROR, {
        error: "All providers failed",
        detail: lastError?.message || "All configured LLM providers exhausted",
        providersTried: uniqueProviders,
        timestamp: Date.now(),
      }));
    } catch { /* best effort */ }
  }

  log.error('[V1-API-COMPLETION] │ providers tried:', uniqueProviders);
  log.error('[V1-API-COMPLETION] │ lastError:', lastError?.message);
  log.error('[V1-API-COMPLETION] └─────────────────────────────────');
  chatRequestLogger.logRequestComplete(
    requestId,
    false,
    undefined,
    undefined,
    latencyMs,
    lastError?.message || 'V1 API completion failed unexpectedly',
    primaryProvider,
    primaryModel,
  ).catch(() => {});
  throw lastError || new Error('V1 API completion failed unexpectedly');
}

/**
 * Attempt fallback to other modes on error
 *
 * Fallback chain respects task complexity:
 * - Complex tasks: StatefulAgent → OpenCode Engine → V1 API
 * - Simple tasks: OpenCode Engine → V1 API
 */
/**
 * Discriminated trigger for attemptFallback. The fallback chain can be
 * entered for two distinct reasons:
 *   - 'error'   — the primary mode threw an exception (HTTP 5xx, abort,
 *                 provider crash, etc.)
 *   - 'timeout' — the primary mode was silent for firstTokenTimeoutMs
 *                 (the TTFT/stream-level timeout in vercel-ai-streaming.ts
 *                 fires and surfaces as a timeout-shaped error)
 *
 * Decoupling the trigger from the error object lets the fallback path
 * apply different telemetry, different fall-back ordering, and different
 * reasoning in metadata.fallbackReason. The downstream caller (e.g.
 * tagResultDegraded) reads trigger.kind to decide whether to label the
 * response as a timeout-induced degradation vs an error-induced one.
 */
export type FallbackTrigger =
  | { kind: 'error'; error: unknown; provider?: string; mode?: string }
  | { kind: 'timeout'; timeoutMs: number; provider?: string; mode?: string };

/**
 * Classify an error as timeout-shaped by substring match. Mirrors the
 * check in `markClientDisconnected()` — the TTFT/idle timeout in
 * vercel-ai-streaming.ts surfaces as an Error whose message contains
 * one of these tokens.
 */
function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('no response') ||
    msg.includes('no activity') ||
    msg.includes('first-token') ||
    msg.includes('time-to-first-token')
  );
}

/**
 * Build a FallbackTrigger from a raw error. Extracts the timeout
 * window from the error message if present, otherwise falls back to
 * the LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS env var (default 30000).
 */
function triggerFromError(
  error: unknown,
  provider?: string,
  mode?: string,
): FallbackTrigger {
  if (isTimeoutError(error)) {
    const msg = (error as Error).message;
    const match = msg.match(/(\d+)\s*ms/);
    const timeoutMs = match
      ? parseInt(match[1], 10)
      : parseInt(process.env.LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS || '30000', 10);
    return { kind: 'timeout', timeoutMs, provider, mode };
  }
  return { kind: 'error', error, provider, mode };
}

async function attemptFallback(
  config: UnifiedAgentConfig,
  failedMode: string,
  trigger: FallbackTrigger,
  triedModes: Set<string> = new Set()
): Promise<UnifiedAgentResult | null> {
  // Track tried modes to prevent infinite loops
  const visitedModes = new Set(triedModes);
  visitedModes.add(failedMode);

  // Early return: if client disconnected (user abort), skip entire fallback chain.
  // Timeouts don't set the flag (see markClientDisconnected), so this only
  // triggers for explicit user cancellations.
  if (isClientDisconnected()) {
    log.info("[Fallback] Client disconnected - skipping fallback chain");
    return null;
  }

  log.info('[Fallback] ┌─ ATTEMPTING FALLBACK ──────────────────');
  log.info('[Fallback] │ failedMode:', failedMode);
  const errorMsg = trigger.kind === 'error'
    ? (trigger.error instanceof Error ? trigger.error.message : String(trigger.error))
    : `timeout after ${trigger.timeoutMs}ms`;
  log.info('[Fallback] │ error:', errorMsg);
  log.info('[Fallback] │ visitedModes:', Array.from(visitedModes));
  log.info('[Fallback] └───────────────────────────────────────────');

  // Use startup capabilities — don't try modes that weren't available at startup
  const caps = startupCaps;

  // Determine task complexity using regex (TaskClassifier removed)
  // IMPORTANT: Only analyze the raw user task, not the full context-augmented message
  let isComplexTask = false;
  const rawTask = extractRawUserTask(config.userMessage || '');
  isComplexTask = /create|build|implement|refactor|migrate|add feature|new file|multiple files|workspace structure|full-stack|application|service|api|component|page/i.test(rawTask);
  log.debug('Fallback complexity detection', { isComplexTask });

  // TEMP: If v2 is disabled globally, skip all v2 fallbacks
  const v2Disabled = process.env.DISABLE_V2_MODE !== 'false';
  const engine = process.env.AGENT_EXECUTION_ENGINE || 'auto';
  const forceV1 = v2Disabled || engine === 'v1-api';
  const forceAgentLoop = engine === 'agent-loop';
  // FIX: When engine is 'auto', we want v1-only rotation (v1-api + v1-agent-loop).
  // Don't allow fallback to v2 modes unless engine is explicitly unset.
  const forceV1Auto = engine === 'auto' || forceV1;

  log.info('[Fallback] ┌─ FALLBACK CHAIN BUILD ── caps are intents, not gates ──');
  log.info('[Fallback] │ v2Disabled:', v2Disabled);
  log.info('[Fallback] │ engine:', engine);
  log.info('[Fallback] │ forceV1:', forceV1);
  log.info('[Fallback] │ forceAgentLoop:', forceAgentLoop);
  log.info('[Fallback] │ forceV1Auto:', forceV1Auto);
  log.info('[Fallback] │ caps.v2Native:', caps.v2Native);
  log.info('[Fallback] │ caps.v2Containerized:', caps.v2Containerized);
  log.info('[Fallback] │ caps.v2Local:', caps.v2Local);
  log.info('[Fallback] │ caps.v1Api:', caps.v1Api);
  log.info('[Fallback] │ note: false caps fall through to override paths; chain-resolved mode follows this block.');
log.info('[Fallback] └───────────────────────────────────────────');

  // Try fallback chain based on what failed, excluding already tried modes
  // Only include modes that were available at startup
  // Priority: OpenCode SDK (web-friendly) → V2 Native (desktop-only, with StatefulAgent) → V2 Containerized → V2 Local → V1 API
  const fallbackOrder: Array<'opencode-sdk' | 'v2-native' | 'v2-containerized' | 'v2-local' | 'v1-api'> = [];

  if (!forceV1Auto && !forceAgentLoop && !visitedModes.has('opencode-sdk') && failedMode !== 'opencode-sdk' && caps.opencodeSdk) {
    fallbackOrder.push('opencode-sdk');
  }
  if (!forceV1Auto && !forceAgentLoop && !visitedModes.has('v2-native') && failedMode !== 'v2-native' && caps.v2Native) {
    fallbackOrder.push('v2-native');
  }
  if (!forceV1Auto && !forceAgentLoop && !visitedModes.has('v2-containerized') && failedMode !== 'v2-containerized' && caps.v2Containerized) {
    fallbackOrder.push('v2-containerized');
  }
  if (!forceV1Auto && !forceAgentLoop && !visitedModes.has('v2-local') && failedMode !== 'v2-local' && caps.v2Local) {
    fallbackOrder.push('v2-local');
  }
  if (!visitedModes.has('v1-api') && failedMode !== 'v1-api' && caps.v1Api) {
    fallbackOrder.push('v1-api');
  }

  log.info('[Fallback] ┌─ FINAL FALLBACK CHAIN ─────────────────');
  log.info('[Fallback] │ fallbackOrder:', fallbackOrder);
  log.info('[Fallback] └───────────────────────────────────────────');

  // Hoist circuit breaker import outside the loop -- dynamic import
  // is expensive and we only need it once for all fallback modes.
  let _fbCBM: any = null;
  try {
    const _mod = await import("../middleware/circuit-breaker");
    _fbCBM = _mod.circuitBreakerManager;
  } catch { /* circuit breaker unavailable -- proceed without */ }
  // Try each fallback mode
  for (const fallbackMode of fallbackOrder) {
    // Reset client disconnect flag before each fallback attempt -
    // safety net for server errors/unknowns that set the flag.
    _clientDisconnected = false;

    // Check circuit breaker for this fallback mode - skip if OPEN
    try {
      if (_fbCBM) {
        const _fbBreaker = _fbCBM.getBreaker(fallbackMode);
        if (_fbBreaker && _fbBreaker.getState() === "OPEN") {
          log.warn("[Fallback] Skipping - circuit breaker OPEN", { fallbackMode });
          visitedModes.add(fallbackMode);
          continue;
        }
      }
    } catch { /* circuit breaker check failed -- proceed */ }

    try {
      log.info('[Fallback] ┌─ TRYING FALLBACK ──────────────────');
      log.info('[Fallback] │ fallbackMode:', fallbackMode);
      log.info('[Fallback] │ failedMode:', failedMode);
      log.info('[Fallback] │ isComplexTask:', isComplexTask);
      log.info('[Fallback] └───────────────────────────────────────');

      // For complex tasks, try StatefulAgent first in v2-native mode
      if (fallbackMode === 'v2-native' && isComplexTask && caps.statefulAgent) {
        log.info('[Fallback] → StatefulAgent for complex task in v2-native');
        const result = await runStatefulAgentMode(config);
        if (result.success) {
          log.info('[Fallback] ✓ StatefulAgent succeeded');
          return {
            ...result,
            metadata: {
              ...result.metadata,
              fallbackFrom: failedMode,
              triedModes: Array.from(visitedModes),
            },
          };
        }
      }

      // Execute the fallback mode directly instead of recursively calling attemptFallback
      let result: UnifiedAgentResult;
      switch (fallbackMode) {
        case 'opencode-sdk':
          result = await runOpencodeSDKMode(config);
          break;
        case 'v2-native':
          result = await runV2Native(config);
          break;
        case 'v2-containerized':
          result = await runV2Containerized(config);
          break;
        case 'v2-local':
          result = await runV2Local(config);
          break;
        case 'v1-api':
          result = await runV1Api(config);
          break;
        default:
          continue;
      }

      if (result.success) {
        // Update metadata to show the full chain of modes that were tried
        const fallbackTriedModes = result.metadata?.triedModes || [fallbackMode];
        return {
          ...result,
          metadata: {
            ...result.metadata,
            fallbackFrom: failedMode,
            // Combine current visitedModes with the fallback's triedModes
            triedModes: [...Array.from(visitedModes), ...fallbackTriedModes],
          },
        };
      }
    } catch (fallbackError) {
      log.warn('[Fallback] ┌─ FALLBACK FAILED ──────────────────');
      log.warn('[Fallback] │ fallbackMode:', fallbackMode);
      log.warn('[Fallback] │ error:', fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
      log.warn('[Fallback] └───────────────────────────────────────');
      // Add the failed fallback mode to visitedModes to prevent re-trying
      visitedModes.add(fallbackMode);
      // Continue to next fallback with updated visitedModes
    }
  }

  log.warn('[Fallback] ┌─ ALL FALLBACKS EXHAUSTED ─────────────');
  log.warn('[Fallback] └───────────────────────────────────────────');

  // No fallback succeeded
  return null;
}

/**
 * MINOR #1 + DRY refactor (post-F6 deep): the single source of truth for
 * mode → capability-flag mapping. `isModeAvailable` (public listing surface,
 * 5 modes) AND the F6 bypass-detection block (7 modes including orchestrator
 * modes with capability flags) BOTH delegate to this helper. Future mode
 * additions go here once and BOTH surfaces pick it up automatically.
 *
 * Maintenance contract — exhaustive-keep-in-sync:
 * This switch is the SINGLE source of truth for mode → cap-flag mapping.
 * TypeScript can't enforce exhaustiveness against the `mode` literal union
 * on UnifiedAgentConfig (~20 variants) when this helper accepts `string`.
 * If a future mode gains a cap flag:
 *   1. UPDATE HERE FIRST (add the case + the cap-flag entry on
 *      StartupCapabilities).
 *   2. Then verify callers (`getAvailableModes` return-type subset, F6
 *      bypass-detection block) wire correctly via existing tests/surfaces.
 * If a new mode has no cap-flag requirement, consciously OMIT it (the
 * `default: return null` fallthrough is the intentional contract — both
 * `isModeAvailable` and the F6 bypass-detection block silently no-op for
 * unmapped modes because they degrade to `available: false` / no record).
 */
function modeToCapFlag(mode: string): keyof StartupCapabilities | null {
  switch (mode) {
    case 'desktop': return 'desktop';
    case 'opencode-sdk': return 'opencodeSdk';
    case 'v2-native': return 'v2Native';
    case 'v2-containerized': return 'v2Containerized';
    case 'v2-local': return 'v2Local';
    case 'v1-agent-loop': return 'statefulAgent';
    case 'mastra-workflow': return 'mastraWorkflows';
    default: return null;
  }
}

/**
 * Public listing-surface helper: returns true if `mode`'s capability flag
 * is strictly true. Delegates to `modeToCapFlag` for the mapping so the
 * listing block and F6 detection stay in lockstep.
 */
function isModeAvailable(
  mode: 'opencode-sdk' | 'v2-native' | 'v2-containerized' | 'v2-local' | 'v1-api',
): boolean {
  const flag = modeToCapFlag(mode);
  return flag !== null && Boolean(startupCaps[flag]);
}

/**
 * Get available modes based on startup capabilities
 */
export function getAvailableModes(): Array<{
  mode: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'opencode-sdk';
  name: string;
  description: string;
  available: boolean;
  recommended?: boolean;
  webReady?: boolean;
}> {
  return [
    {
      mode: 'opencode-sdk',
      name: 'OpenCode SDK (Web + Desktop)',
      description: 'Agentic execution via HTTP API - works on web and desktop, no CLI binary needed',
      available: isModeAvailable('opencode-sdk'),
      recommended: isModeAvailable('opencode-sdk'),
      webReady: true,
    },
    {
      mode: 'v2-native',
      name: 'OpenCode Engine (Desktop Only)',
      description: 'Full agentic capabilities with native bash, file ops, and tool execution',
      available: isModeAvailable('v2-native'),
      recommended: !isModeAvailable('opencode-sdk') && isModeAvailable('v2-native'),
    },
    {
      mode: 'v2-containerized',
      name: 'OpenCode Containerized (Desktop Only)',
      description: 'OpenCode CLI in isolated sandbox (production-ready)',
      available: isModeAvailable('v2-containerized'),
    },
    {
      mode: 'v2-local',
      name: 'OpenCode Local (Desktop Only)',
      description: 'OpenCode CLI on your local machine',
      available: isModeAvailable('v2-local'),
    },
    {
      mode: 'v1-api',
      name: 'LLM API (Fallback)',
      description: 'Cloud LLM APIs - simple chat only, no agentic capabilities',
      available: isModeAvailable('v1-api'),
      webReady: true,
    },
  ];
}
