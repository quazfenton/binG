/**
 * Service-layer integration test that drives `processUnifiedAgentRequest`
 * directly (no route.ts involvement) and asserts the new
 * `[AGENT-SERVICE] processUnifiedAgentRequest returned` INFO line fires
 * from each shape variant, mirroring the route-layer precedent at
 * `app/api/chat/__tests__/route-shape-audit.test.ts`.
 *
 * Inverse-pair rationale: the previous hoist moved the chat-route
 * L1668-L1669 audit emit into the service layer so EVERY caller of
 * `processUnifiedAgentRequest` is auditable, not just the chat route's
 * narrow post-await log line. The route-layer test mocks
 * `processUnifiedAgentRequest` itself (so the function never runs)
 * and validates the route's emit point. THIS test validates the
 * service's emit point by running the real `processUnifiedAgentRequest`
 * and observing `log.info` calls on the file-local `log` instance
 * (`createLogger('UnifiedAgentService')`) at line L213.
 *
 * Two distinguishing test design notes:
 *
 * 1. **All 5 service-layer emit sites pre-stringify via
 *    `stringifyMessageContent(result.response)`** before reaching
 *    `auditResponseShape(...)` (see Modal return at L1568, Phase-2
 *    fallback at L1875, main success at L1880, degraded fallback at
 *    L1921, all-failed at L1940). So the audit's `responseShapeKey`
 *    field is observably `'string'` at the service layer for ALL 5
 *    sites — multi-shape bucket coverage (`array[ContentPart]`,
 *    `object{StreamingResponse}`, etc.) is captured separately by
 *    the route-layer test, which observes the RAW pre-coerced shape.
 *    This test therefore verifies `responseType: 'string'` +
 *    `responseShapeKey: 'string'` + a `responseLen` proportional to
 *    the mocked stringifyMessageContent output. Different fixtures
 *    produce different lengths, exercising the responseLen surface
 *    end-to-end without bypassing the production string-coerce path.
 *
 * 2. **Mock surface is heavy (~30 vi.mock declarations)** because
 * `unified-agent-service.ts` has 30+ runtime imports at module
 * load, including many transitive path-bound side effects (DB
 * queries, network probes, env probes). Each mock below targets
 * exactly ONE failure mode observed in earlier validation runs.
 * Do not "simplify" by removing mocks — vitest crashes at module
 * load if any transitive dep is unstubbed.
 *
 * See also:
 * - `app/api/chat/__tests__/route-shape-audit.test.ts` — the route-layer
 *   companion test (inverse direction).
 * - `app/api/chat/__tests__/next-step-suggestions.test.ts` — the prior
 *   precedent test pattern (mock factory + spy on chatLogger).
 * - `lib/chat/__tests__/shape-helpers.test.ts` — unit-level coverage
 *   of `shapeKeyOf` + `serializableTextLength` in isolation.
 * - `lib/chat/content-stringifier.ts` — the helper invoked BEFORE
 *   `auditResponseShape` at every service-layer emit site; mocks here
 *   give the test control over what `result.response` looks like
 *   at audit time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────
// 1. Logger mock — captures the `log` instance that
//    `unified-agent-service.ts:213` instantiates via `createLogger`.
//    This must be the FIRST mock block: the file captures `log` at
//    module load, so the spy must already be in place when the
//    module-load side effects (env-fingerprint log, REQUEST ENTRY log,
//    etc.) run. Otherwise those 100+ log.info calls land on the real
//    `Logger` instance and the audit's emit is buried in noise.
// ────────────────────────────────────────────────────────────────────

// The file-local `log` is created via `createLogger('UnifiedAgentService')`,
// which returns a `Logger` instance. We provide a spy that records every
// call (mockImplementation keeps `this` semantics — the spy is a Logger
// shaped object). All other logger-using modules (`@bing/platform/env`,
// `@bing/shared/agent/*`, etc.) hit this same factory by way of vitest
// module-resolution, so every `.info(...)` call goes through our spy.
//
// IMPORTANT: the spy object reference is captured by `vi.hoisted` so it
// is available BEFORE any `vi.mock` factory closes over it during the
// factory invocation. `vi.hoisted` runs at the start of the test file,
// before vi.mock factories.
const { spyLog } = vi.hoisted(() => {
  const spyLog = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { spyLog };
});

vi.mock('@/lib/utils/logger', () => ({
  createLogger: vi.fn(() => spyLog),
}));

// ────────────────────────────────────────────────────────────────────
// 2. Heavy upstream modules — runtime imports whose module-load code
//    touches the DB / network / env. Each is stubbed to a minimal
//    no-op surface so vitest can load `unified-agent-service.ts`
//    without crashing.
// ────────────────────────────────────────────────────────────────────

// Modal client: must return null/undefined under fixture conditions
// so `maybeUseModal(...)` returns null and the L1638 Modal branch
// is skipped (Modal only fires when mode is v2-native/opencode-sdk
// AND context > 50KB — neither is true in our fixtures, but providing
// a null stub closes the path defensively).
vi.mock('@/lib/modal/modal-client', () => ({
  ModalClient: class {},
  maybeUseModal: vi.fn().mockReturnValue(null),
  getModalClient: vi.fn(),
}));

vi.mock('@bing/platform/env', () => ({
  isDesktopMode: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/drivers/opencode/find-opencode-binary', () => ({
  findOpencodeBinarySync: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/orchestra/agent-logger', () => ({
  createAgentLogger: vi.fn(),
  agentLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/orchestra/startup-capabilities', () => ({
  getStartupCapabilities: vi.fn().mockReturnValue({
    desktop: false,
    opencodeSdk: false,
    mastraWorkflows: false,
    statefulAgent: false,
  }),
  checkStartupCapabilities: vi.fn(),
}));

vi.mock('@/lib/orchestra/model-health', () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  isModeHealthy: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/observability/degradation-tracker', () => ({
  recordDegradation: vi.fn(),
  incrementOrchestrationFallback: vi.fn(),
}));

vi.mock('@/lib/chat/chat-metrics', () => ({
  recordFallbackChainAttempt: vi.fn(),
  recordOrchestrationFallback: vi.fn(),
}));

vi.mock('@/lib/chat/auto-continue-helper', () => ({
  // Decisive: return `{continue: false, ...}` so the route's do-while(false)
  // loop exits cleanly and the audit emit at L1883 fires without
  // cascading to Phase-2 fallback (which would emit a SECOND audit line
  // for the cascaded result and pollute assertions).
  decideAutoContinue: vi.fn().mockReturnValue({
    continue: false,
    reason: 'mocked-no-continue',
    continuationsSoFar: 0,
  }),
  defaultFileEditDetector: vi.fn(),
  needsMoreTurnsDetector: vi.fn(),
  clearContinuationCount: vi.fn(),
}));

vi.mock('@/lib/chat/llm-continuation', () => ({
  shouldAutoContinue: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/chat/chat-request-logger', () => ({
  chatRequestLogger: {
    logRequestStart: vi.fn().mockResolvedValue(undefined),
    logRequestComplete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/lib/chat/file-diff-utils', () => ({
  extractFileWritesFromLLMResponse: vi.fn().mockReturnValue([]),
  applyUnifiedDiffToContent: vi.fn().mockImplementation((s: string) => s),
}));

vi.mock('@/lib/errors/logging-utils', () => ({
  recordToolCallTelemetry: vi.fn(),
  prepareTelemetryPayload: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/memory/cache-exporter', () => ({
  getRecontextSupplement: vi.fn().mockReturnValue(''),
}));

vi.mock('@/lib/bash/env-probe', () => ({
  formatAvailableBinariesAsync: vi.fn().mockResolvedValue(''),
}));

vi.mock('@/lib/powers/mem0-power', () => ({
  mem0Add: vi.fn().mockResolvedValue(undefined),
  isMem0Configured: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/powers', () => ({
  appendAutoInjectPowers: vi.fn(),
  buildAutoInjectUserMessage: vi.fn().mockReturnValue(''),
}));

vi.mock('@/lib/providers/model-ranker', () => ({
  getModelForRotation: vi.fn().mockReturnValue(null),
  isRateLimited: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/middleware/circuit-breaker', () => ({
  circuitBreakerManager: {
    getBreaker: vi.fn().mockReturnValue({ getState: vi.fn().mockReturnValue('CLOSED') }),
  },
  getCircuitStateName: vi.fn().mockReturnValue('CLOSED'),
}));

vi.mock('@/lib/rag/retrieval', () => ({
  runRetrievalPipeline: vi.fn(),
  ingestFewShot: vi.fn(),
  ingestExperience: vi.fn(),
  ingestTrajectory: vi.fn(),
  ingestRule: vi.fn(),
  ingestAntiPattern: vi.fn(),
}));

vi.mock('@/lib/context/project-context', () => ({
  getProjectServices: vi.fn(),
}));

vi.mock('@/lib/providers/provider-default-models', () => ({
  PROVIDER_DEFAULT_MODELS: { mistral: 'mistral-large-latest' },
}));

vi.mock('@/lib/providers/provider-fallback-chains', () => ({
  getConfiguredFallbackChain: vi.fn().mockReturnValue([]),
}));

vi.mock('@/lib/providers/v2-model-config', () => ({
  resolveV2Model: vi.fn().mockReturnValue({ model: 'gpt-4o' }),
}));

vi.mock('@/lib/orchestra/shared-agent-context', () => ({
  buildWorkspaceSnapshot: vi.fn(),
  normalizeToolArgs: vi.fn(),
  createLoopDetectorState: vi.fn(),
  recordStepAndCheckLoop: vi.fn(),
  extractToolError: vi.fn(),
  isLoopDetectorResult: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/orchestra/steer-service', () => ({
  wireConsecutiveToolCapSteer: vi.fn(),
  wireOrchestrationFallbackSteer: vi.fn(),
  wireLoopAbortSteer: vi.fn(),
  safeSteer: vi.fn().mockReturnValue(''),
  InvalidModelError: class extends Error {
    constructor(...args: any[]) {
      super(...args);
      this.name = 'InvalidModelError';
    }
  },
  buildSteerPrompt: vi.fn().mockReturnValue(''),
  steerFromFinishReason: vi.fn().mockReturnValue(''),
  buildSessionScopeSteerPrompt: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/orchestra/provider-530-tracker', () => ({
  is530Blacklisted: vi.fn().mockReturnValue(false),
  handleProviderError: vi.fn(),
  reset530Counter: vi.fn(),
}));

vi.mock('@/lib/orchestra/modes', () => ({
  runDualProcessMode: vi.fn(),
  runAdversarialVerifyMode: vi.fn(),
  runAttractorDrivenMode: vi.fn(),
  runIntentDrivenMode: vi.fn(),
  runEnergyDrivenMode: vi.fn(),
  runDistributedCognitionMode: vi.fn(),
  runCognitiveResonanceMode: vi.fn(),
  runExecutionControllerMode: vi.fn(),
}));

vi.mock('@/lib/orchestra/agent-loop', () => ({
  runAgentLoop: vi.fn(),
}));

vi.mock('@/lib/tools', () => ({
  initToolSystem: vi.fn().mockReturnValue(true),
  executeToolCapability: vi.fn(),
  hasToolCapability: vi.fn().mockReturnValue(false),
  isToolSystemReady: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/session/agent/opencode-engine-service', () => ({
  createOpenCodeEngine: vi.fn(),
}));

vi.mock('@/lib/sandbox/providers/llm-factory', () => ({
  getLLMProvider: vi.fn(),
}));

// The stateful-agent brings a heavyweight PlanActVerify class through
// `stateful-agent.ts`. We stub it so `runStatefulAgentMode` (if ever
// reached via mode='desktop'+stateful-agent paths) resolves cheaply.
vi.mock('@/lib/orchestra/stateful-agent/agents/stateful-agent', () => ({
  StatefulAgent: class {
    constructor() {}
    async run() {
      return {
        success: true,
        response: 'mocked-stateful-agent',
        steps: [],
      };
    }
  },
}));

// ────────────────────────────────────────────────────────────────────
// 3. Shared-agent subpaths — each `@bing/shared/agent/*` subpath
//    that unified-agent-service.ts imports at module load must be
//    mocked individually (vitest resolves relative subpaths to
//    their absolute paths but mock resolution is by the literal
//    import path, so each subpath needs its own vi.mock block).
// ────────────────────────────────────────────────────────────────────

vi.mock('@bing/shared/agent', () => ({
  executeV2Task: vi.fn(),
  executeV2TaskStreaming: vi.fn(),
  workforceManager: {},
  createTaskClassifier: vi.fn().mockReturnValue({ classify: vi.fn() }),
  SYSTEM_PROMPTS: {},
  VFS_FILE_EDITING_TOOL_PROMPT: '',
  generateDynamicInjection: vi.fn().mockReturnValue(''),
  getOrchestrationModeFromRequest: vi.fn().mockReturnValue('auto'),
  executeWithOrchestrationMode: vi.fn(),
}));

vi.mock('@bing/shared/agent/tool-schema', () => ({
  normalizeSchemaForAI: vi.fn().mockImplementation((s: any) => s),
}));

vi.mock('@bing/shared/agent/mastra-workflow-integration', () => ({
  mastraWorkflowIntegration: {
    execute: vi.fn(),
    executeWorkflow: vi.fn(),
    listWorkflows: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('@bing/shared/agent/feedback-injection', () => ({
  createFeedbackEntry: vi.fn(),
  addFeedback: vi.fn(),
  injectFeedback: vi.fn(),
  detectHealingTrigger: vi.fn().mockReturnValue(false),
  detectIncompleteResponse: vi.fn().mockReturnValue(false),
  generateHealingPrompt: vi.fn().mockReturnValue(''),
  getFeedbackInjectionBudget: vi.fn().mockReturnValue({ remaining: 3 }),
}));

vi.mock('@bing/shared/agent/successive-tracker', () => ({
  getTracker: vi.fn(),
  recordResponse: vi.fn(),
  recordToolCall: vi.fn(),
  checkReEvalTrigger: vi.fn().mockReturnValue(false),
  recordReEval: vi.fn(),
  generateTrackerSummary: vi.fn().mockReturnValue(''),
}));

vi.mock('@bing/shared/agent/first-response-routing', () => ({
  parseFirstResponseRouting: vi.fn(),
  stripRoutingMarkers: vi.fn().mockImplementation((s: string) => s),
  shouldTriggerReview: vi.fn().mockReturnValue(false),
  generateStepReprompt: vi.fn(),
  routingToRoleRedirectSection: vi.fn(),
  truncateAtFirstRouting: vi.fn().mockImplementation((s: string) => s),
  buildRoutingMetadataForClient: vi.fn().mockReturnValue({}),
}));

vi.mock('@bing/shared/agent/tool-classification', () => ({
  READ_ONLY_TOOL_NAMES: [],
  WRITE_TOOL_NAMES: [],
  hasMutationSuffix: vi.fn().mockReturnValue(false),
  hasReadSuffix: vi.fn().mockReturnValue(false),
}));

vi.mock('@bing/shared/agent/prompt-composer', () => ({
  composeRoleWithTools: vi.fn().mockReturnValue(''),
}));

vi.mock('@bing/shared/agent/orchestration/plan-act-verify', () => ({
  PlanActVerifyOrchestrator: class {
    constructor() {}
  },
}));

// ────────────────────────────────────────────────────────────────────
// Imports (post-mock)
// ────────────────────────────────────────────────────────────────────

import { processUnifiedAgentRequest } from '../unified-agent-service';

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('processUnifiedAgentRequest — response shape audit ([AGENT-SERVICE] processUnifiedAgentRequest returned)', () => {
  // Verify the audit fires regardless of the trigger for the
  // all-failed cascade (L1943), AND with the expected prefix +
  // inspector-pair fields. Each fixture varies the input config so a
  // different code path is taken INSIDE processUnifiedAgentRequest but
  // all funnel into the same outer catch (runXMode throws + attemptFallback
  // null) → L1943 audit.

  // The audit at L1349-L1372 (5 emit sites, hoisted) fires:
  //   log.info('[AGENT-SERVICE] processUnifiedAgentRequest returned', {
  //     provider, model, mode,
  //     responseType: typeof result.response,
  //     responseShapeKey: shapeKeyOf(result.response),
  //     responseLen: serializableTextLength(result.response)
  //   })
  //
  // REACHABILITY REALITY under the mock surface of this test:
  //
  // We faithfully mock the 30+ module-load transitive deps of
  // `unified-agent-service.ts` but do NOT mock the inner mode handlers
  // (runV1Api / runV2Native / etc.) — they are module-scope functions
  // that cannot be intercepted without a source-code refactor. The
  // inner mode handlers THROW because their own transitive deps
  // (llm-fallback-coordinator, providers, etc.) are unstubbed. The
  // outer try/catch at L1850 then calls `attemptFallback` (also
  // module-internal, also throws), and the catch falls through to L1943
  // (all-failed) which emits the audit with a FIXED apologetic string.
  //
  // This means every fixture below drives the L1943 emit with the same
  // FIXED response (`I'm sorry, I wasn't able to process your request…`).
  // `responseType` and `responseShapeKey` are therefore always 'string'
  // and `responseLen` is the FIXED length (~245 chars). What VARIES
  // between fixtures is the `provider`/`model`/`mode` fields of the
  // audit payload — validating that the meta is correctly threaded
  // through the catch→L1943 path from the input config.
  //
  // Multi-shape bucket coverage (responseShapeKey = 'array[ContentPart]'
  // etc.) is the ROUTE-layer test's job, not this one: the service
  // layer's 5 emit sites all pre-stringify `result.response` BEFORE
  // reaching auditResponseShape, so the inspector pair at the service
  // layer always observes `'string'` buckets regardless of the wire
  // shape upstream.

  const FIXED_FAILURE_RESPONSE =
    "I'm sorry, I wasn't able to process your request. All available AI providers and execution modes were exhausted. This can happen due to API key issues, rate limits, or network problems. Please try again in a moment, or check that your API keys are configured correctly.";
  const FIXED_FAILURE_RESPONSE_LEN = FIXED_FAILURE_RESPONSE.length;

  const fixtures = [
    {
      name: 'v1-api explicit mode',
      // mode='v1-api' is taken at line L1199 of determineMode (fast-path,
      // skips engine/startup resolution). runV1Api (module-internal)
      // throws because its inner deps are unstubbed. Falls through to
      // L1943 audit with mode='v1-api' in the payload.
      config: { userMessage: 'hello', mode: 'v1-api' as const, provider: 'mock', model: 'mock-model-1' },
      expectedMode: 'v1-api',
    },
    {
      name: 'desktop mode reaches runDesktopMode (throws)',
      // mode='desktop' triggers runDesktopMode (module-internal). The
      // desktop-mode task-classifier regex at L1818 sees the short
      // userMessage and skips StatefulAgent, falling through to
      // `createOpenCodeEngine(...)` (which the test mocks to return
      // an engine whose `.execute()` is undefined → throws TypeError).
      // The outer try at L1850 catches the throw and `attemptFallback`
      // (also module-internal) likewise throws → falls through to L1943.
      config: { userMessage: 'hello', mode: 'desktop' as const, provider: 'mock', model: 'mock-model-2' },
      expectedMode: 'desktop',
    },
    {
      name: 'v2-native explicit mode reaches runV2Native (throws)',
      // mode='v2-native' lets determineMode skip engine override. runV2Native
      // (module-internal) hits the OpenCodeEngine path with un-`vi.fn()`'d
      // dependencies and throws. Falls through to L1943 audit with
      // mode='v2-native' in the payload — different from the first two.
      config: { userMessage: 'hi', mode: 'v2-native' as const, provider: 'mock', model: 'mock-model-3' },
      expectedMode: 'v2-native',
    },
  ];

  it.each(fixtures)('emits [AGENT-SERVICE] audit from L1943 for $name', async ({ config, expectedMode }) => {
    // Module load emits 100+ log.info calls (env-fingerprint, REQUEST ENTRY,
    // MODE SELECTED, …). Each per-test body clears the spy history so we
    // observe only the audit fired by THIS test's processUnifiedAgentRequest
    // invocation. (Without the clear, the env-fingerprint and other
    // module-load logs from earlier renders would pollute the filter.)
    spyLog.info.mockClear();

    const result = await processUnifiedAgentRequest(config as any);

    // Sanity: outer call returned the all-failed shape (L1943 path).
    // The `responseLen` audit-payload assertion below pins the actual
    // FIXED apologetic string, so a separate `response` value check
    // would be redundant.
    expect(result).toBeDefined();
    expect(result.success).toBe(false);

    const auditCalls = spyLog.info.mock.calls.filter(
      (args) => args[0] === '[AGENT-SERVICE] processUnifiedAgentRequest returned',
    );

    // L1943 fires exactly ONCE under this path configuration. If the helper
    // is ever called twice (e.g., someone adds an extra emit at a non-cascade
    // site, or the all-failed shape gets re-stringified through a new path),
    // this assertion fires and forces an intentional update.
    expect(auditCalls).toHaveLength(1);

    expect(auditCalls[0][0]).toBe('[AGENT-SERVICE] processUnifiedAgentRequest returned');
    expect(auditCalls[0][1]).toEqual(
      expect.objectContaining({
        provider: 'mock',
        model: config.model,
        mode: expectedMode,
        responseType: 'string',
        // responseShapeKey is 'string' here because L1943 emits the FIXED
        // apologetic string. Multi-shape bucket coverage is the route-layer
        // test's job — explained in the describe-block docblock above.
        responseShapeKey: 'string',
        // Pin the FIXED length so any future change to the apologetic string
        // (e.g. operators editing it to be more user-friendly) surfaces as a
        // sharp test failure, prompting an intentional update here.
        responseLen: FIXED_FAILURE_RESPONSE_LEN,
      }),
    );
  });

  // No sanity-pin test for the spy: the per-fixture `toHaveLength(1)`
  // assertions on `auditCalls` are themselves the spy-wiring canary.
  // If `spyLog.info` were the real Logger (not a vi.fn()), `mock.calls`
  // would be empty after `mockClear` and every per-fixture test would
  // fail with `expected length: 1, received: 0` — sharper signal than a
  // separate "wiring" sanity check would produce.
});
