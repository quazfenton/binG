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

// Wire in centralized tool system for all execution paths (v1, v2, streaming, non-Mastra)
import { initToolSystem, executeToolCapability, hasToolCapability, isToolSystemReady } from '@/lib/tools';

import { runAgentLoop as runV2AgentLoop } from './agent-loop';
import { getConfiguredFallbackChain } from '../chat/provider-fallback-chains';
import { chatRequestLogger } from '../chat/chat-request-logger';
import { extractFileWritesFromLLMResponse, type FileWrite } from '../chat/file-diff-utils';
import { getRecontextSupplement } from '@/lib/memory/cache-exporter';
import {
  createOpenCodeEngine,
  type OpenCodeEngineResult,
  type OpenCodeEngineConfig,
} from '../session/agent/opencode-engine-service';
import { isDesktopMode } from "@bing/platform/env";
import { findOpencodeBinarySync } from "@/lib/agent-bins/find-opencode-binary";


import {
  StatefulAgent,
  type StatefulAgentOptions,
  type StatefulAgentResult,
} from './stateful-agent/agents/stateful-agent';
import { createLogger } from '@/lib/utils/logger';
import { mastraWorkflowIntegration } from '@bing/shared/agent/mastra-workflow-integration';
import {
  buildWorkspaceSnapshot,
  normalizeToolArgs,
  createLoopDetectorState,
  recordStepAndCheckLoop,
} from '@/lib/orchestra/shared-agent-context';
import { composeRoleWithTools } from '@bing/shared/agent/prompt-composer';

import {
  PlanActVerifyOrchestrator,
  type OrchestratorConfig,
  type OrchestratorEvent
} from '@bing/shared/agent/orchestration/plan-act-verify';

import {
  createTaskClassifier,
  type TaskClassification,
  type ClassificationContext,
} from '@bing/shared/agent/task-classifier';
import { getProjectServices, type ProjectContext } from '@/lib/project-context';
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


// Does the @opencode-ai/sdk package exist in node_modules?
// Cached at module load so checkStartupCapabilities() can use it cheaply.
// Uses fs.existsSync on node_modules/@opencode-ai/sdk — simpler and more
// reliable than parsing package.json, works in all deployment contexts.
let _hasOpenCodeSDKPackageCache: boolean | undefined;
function _hasOpenCodeSDKPackageCheck(): boolean {
  if (_hasOpenCodeSDKPackageCache !== undefined) return _hasOpenCodeSDKPackageCache;
  try {
    const fs = require("fs");
    const nodePath = require("path");
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

/**
 * Task classifier instance (singleton)
 */
const taskClassifier = createTaskClassifier({
  simpleThreshold: parseFloat(process.env.TASK_CLASSIFIER_SIMPLE_THRESHOLD || '0.3'),
  complexThreshold: parseFloat(process.env.TASK_CLASSIFIER_COMPLEX_THRESHOLD || '0.7'),
  keywordWeight: 0.4,
  semanticWeight: parseFloat(process.env.TASK_CLASSIFIER_SEMANTIC_WEIGHT || '0.3'),
  contextWeight: parseFloat(process.env.TASK_CLASSIFIER_CONTEXT_WEIGHT || '0.2'),
  historicalWeight: parseFloat(process.env.TASK_CLASSIFIER_HISTORY_WEIGHT || '0.1'),
  enableSemanticAnalysis: process.env.TASK_CLASSIFIER_ENABLE_SEMANTIC !== 'false',
  enableHistoricalLearning: process.env.TASK_CLASSIFIER_ENABLE_HISTORY !== 'false',
  enableContextAwareness: process.env.TASK_CLASSIFIER_ENABLE_CONTEXT !== 'false',
});

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

  // Project isolation (provides project-scoped vector memory and retrieval)
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

  // Agent settings
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;

  // Provider and model override (uses env defaults if not specified)
  provider?: string;
  model?: string;

  // Mode override (optional - auto-detected from env if not specified)
  mode?: 'v1-api' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'opencode-sdk' | 'mastra-workflow' | 'desktop' | 'v1-progressive-build' | 'dual-process' | 'adversarial-verify' | 'attractor-driven' | 'intent-driven' | 'energy-driven' | 'distributed-cognition' | 'cognitive-resonance' | 'execution-controller' | 'auto';

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
  mode: 'v1-api' | 'v1-agent-loop' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'opencode-sdk' | 'mastra-workflow' | 'desktop' | 'v1-progressive-build' | 'dual-process' | 'dual-process-fast' | 'dual-process-slow' | 'dual-process-fast-fallback' | 'dual-process-slow-failed' | 'adversarial-verify' | 'adversarial-verify-revised' | 'adversarial-verify-revision-failed' | 'attractor-driven' | 'intent-driven' | 'energy-driven' | 'distributed-cognition' | 'distributed-cognition-no-synthesis' | 'cognitive-resonance' | 'cognitive-resonance-converged' | 'cognitive-resonance-synthesized' | 'cognitive-resonance-single' | 'cognitive-resonance-fallback';
  error?: string;
  fileEdits?: Array<{
    path: string;
    content?: string;
    diff?: string;
    action?: string;
  }>;
  metadata?: {
    model?: string;
    provider?: string;
    duration?: number;
    workflowId?: string;
    workflowSteps?: Array<{ id: string; name: string; status: string }>;
    [key: string]: any;
  };
}


export interface StartupCapabilities {
  v2Native: boolean;       // OpenCode CLI available and enabled (desktop-only)
  v2Containerized: boolean; // Container sandbox configured (desktop-only)
  v2Local: boolean;         // Local OpenCode with LLM_PROVIDER=opencode (desktop-only)
  opencodeSdk: boolean;     // OpenCode SDK HTTP API available (web + desktop)
  statefulAgent: boolean;   // StatefulAgent enabled
  mastraWorkflows: boolean; // Mastra workflow engine configured
  desktop: boolean;         // Tauri desktop mode enabled
  v1Api: boolean;           // At least one LLM provider API key configured
}

/**
 * Startup health check — determines which agent modes are actually available.
 * Called once at module load; result is cached.
 *
 * This prevents the system from attempting v2-native, containerized, or
 * remote agent modes when they're not even set up (causing 12-15 retries
 * before finally falling back to v1-api).
 */
export function checkStartupCapabilities(): StartupCapabilities {
  const llmProvider = process.env.LLM_PROVIDER || '';
  const sandboxProvider = process.env.SANDBOX_PROVIDER || '';
  const containerized = process.env.OPENCODE_CONTAINERIZED === 'true';
  const opencodeEnabled = llmProvider === 'opencode';

  // V2 Native: only if explicitly enabled (LLM_PROVIDER=opencode)
  // RESTRICTED to desktop-only — CLI binary required on the host
  const isDesktop = isDesktopMode();
  const _hasOpencodeBinary = !!findOpencodeBinarySync();
  const v2Native = opencodeEnabled && isDesktop && _hasOpencodeBinary;

  // V2 Containerized: requires containerized flag + sandbox provider + API key
  // RESTRICTED to desktop-only — sandbox runs locally
  const v2Containerized = containerized
    && !!sandboxProvider
    && !!process.env[`${sandboxProvider.toUpperCase()}_API_KEY`]
    && isDesktop;

  // V2 Local: only if LLM_PROVIDER=opencode and not containerized
  // RESTRICTED to desktop-only — CLI binary required on the host
  const v2Local = opencodeEnabled && !containerized && isDesktop && _hasOpencodeBinary;

  // OpenCode SDK: HTTP API to an OpenCode server — works on both web and desktop.
  // Available if OPENCODE_HOSTNAME or OPENCODE_PORT is set (server already running)
  // OR if @opencode-ai/sdk can be loaded (will try to start server as fallback).
  const opencodeSdk = !!(
    process.env.OPENCODE_HOSTNAME
    || process.env.OPENCODE_PORT
    || process.env.OPENCODE_SDK_URL
    // Also detect @opencode-ai/sdk package: if installed, runOpencodeSDKMode
    // can attempt to start a server even without explicit env vars.
    // We check package.json deps rather than require.resolve() because
    // require.resolve is unreliable in Next.js bundled/ESM contexts.
    || _hasOpenCodeSDKPackage
  );

  // StatefulAgent: enabled unless explicitly disabled
  const statefulAgent = process.env.ENABLE_STATEFUL_AGENT !== 'false'
    && process.env.STATEFUL_AGENT_DISABLED !== 'true';

  // Mastra workflows: explicitly enabled
  const mastraWorkflows = process.env.MASTRA_ENABLED === 'true'
    || !!process.env.DEFAULT_WORKFLOW_ID;

  // Desktop mode
  const desktop = isDesktop;

  // V1 API: at least one provider has an API key
  const providerKey = llmProvider ? process.env[`${llmProvider.toUpperCase()}_API_KEY`] : undefined;
  const v1Api = !!providerKey || !!process.env.OPENROUTER_API_KEY;

  // Log startup capabilities for observability
  log.info('Agent mode capabilities at startup', {
    v2Native,
    v2Containerized,
    v2Local,
    opencodeSdk,
    statefulAgent,
    mastraWorkflows,
    desktop,
    v1Api,
    llmProvider: llmProvider || '(none)',
    sandboxProvider: sandboxProvider || '(none)',
    containerized,
  });

  return {
    v2Native,
    v2Containerized,
    v2Local,
    opencodeSdk,
    statefulAgent,
    mastraWorkflows,
    desktop,
    v1Api,
  };
}

// Cache at module load — these don't change at runtime
const startupCaps = checkStartupCapabilities();

/**
 * Determine which mode to use based on config and task classification.
 *
 * Uses startup capability flags (checked once at module load) to skip
 * unavailable modes entirely — no retries, no fallback loops.
 * Returns both mode and classification for logging/metrics.
 */
async function determineMode(config: UnifiedAgentConfig): Promise<{
  mode: 'v1-api' | 'v1-agent-loop' | 'v2-containerized' | 'v2-local' | 'v2-native' | 'opencode-sdk' | 'mastra-workflow' | 'desktop' | 'v1-progressive-build' | 'dual-process' | 'dual-process-fast' | 'dual-process-slow' | 'dual-process-fast-fallback' | 'dual-process-slow-failed' | 'adversarial-verify' | 'adversarial-verify-revised' | 'adversarial-verify-revision-failed' | 'attractor-driven' | 'intent-driven' | 'energy-driven' | 'distributed-cognition' | 'distributed-cognition-no-synthesis' | 'cognitive-resonance' | 'cognitive-resonance-converged' | 'cognitive-resonance-synthesized' | 'cognitive-resonance-single' | 'cognitive-resonance-fallback';
  classification?: TaskClassification;
}> {
  // Explicit mode override
  if (config.mode && config.mode !== 'auto') {
    return { mode: config.mode };
  }

  // AGENT_EXECUTION_ENGINE: Explicit control over which execution engine to use.
  // Check this BEFORE startup capabilities to respect user configuration.
  // - 'v1-api'        → Vercel AI SDK with tool calling (streamWithVercelAI + tools, provider fallback)
  // - 'v1-agent-loop' → Direct Mastra/ToolLoopAgent path (createAgentLoop from mastra/agent-loop.ts)
  // - 'auto'          → Auto-rotate between the two v1 modes based on task complexity
  // FIX: Trim inline comments from env values (e.g., "auto #comment" → "auto")
  const engine = (process.env.AGENT_EXECUTION_ENGINE || 'auto').split('#')[0].trim();

  if (engine === 'v1-api') {
    log.info('AGENT_EXECUTION_ENGINE=v1-api, using Vercel AI SDK execution path');
    return { mode: 'v1-api' as const, classification: null as any };
  }
  if (engine === 'v1-agent-loop') {
    log.info('AGENT_EXECUTION_ENGINE=v1-agent-loop, using direct Mastra/ToolLoopAgent path (route.ts will bypass unified-agent)');
    return { mode: 'v1-agent-loop' as const, classification: null as any };
  }
  if (engine === 'progressive-build' || engine === 'v1-progressive-build') {
    log.info('AGENT_EXECUTION_ENGINE=progressive-build, using multi-iteration build loop');
    return { mode: 'v1-progressive-build' as const, classification: null as any };
  }
  if (engine === 'agent-loop') {
    log.info('AGENT_EXECUTION_ENGINE=agent-loop, using OpenCode agent loop execution path');
    return { mode: 'v2-native' as const, classification: null as any };
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
  log.info('[AutoMode] │ userMessageLength:', config.userMessage?.length || 0);
  log.info('[AutoMode] └────────────────────────────────────────────');

  // Mastra workflow: only if explicitly requested AND available
  if (config.enableMastraWorkflows !== false && config.workflowId && startupCaps.mastraWorkflows) {
    log.info('[AutoMode] → mastra-workflow (explicitly requested)');
    return { mode: 'mastra-workflow' };
  }

  // Use task classifier for intelligent routing
  // IMPORTANT: Only classify the raw user task, NOT the full userMessage
  // which may include context/workspace/memory prepended (see route.ts buildAgenticContext).
  // Classifying the full context would inflate sentence counts, technical terms, etc.
  // and produce bogus complexity scores.
  try {
    const rawUserTask = extractRawUserTask(config.userMessage);
    log.info('[AutoMode] ┌─ TASK CLASSIFIER ─────────────────────');
    log.info('[AutoMode] │ rawTaskLength:', rawUserTask.length);
    log.info('[AutoMode] │ rawTaskPreview:', rawUserTask.slice(0, 100));
    log.info('[AutoMode] └───────────────────────────────────────────');

    const classification = await taskClassifier.classify(rawUserTask, {
      projectSize: process.env.PROJECT_SIZE as any,
      userPreference: process.env.AGENT_PREFERENCE as any,
    });

    log.info('[AutoMode] ┌─ CLASSIFIER RESULT ──────────────────');
    log.info('[AutoMode] │ complexity:', classification.complexity);
    log.info('[AutoMode] │ recommendedMode:', classification.recommendedMode);
    log.info('[AutoMode] │ confidence:', classification.confidence);
    log.info('[AutoMode] │ factors:', JSON.stringify(classification.factors));
    log.info('[AutoMode] └───────────────────────────────────────────');

    // Map classifier recommendation to actual mode
    // For auto rotation: complex/code tasks go to v1-agent-loop, simple tasks go to v1-api
    const isComplex = classification.complexity === 'complex';
    if (isComplex) {
      log.info('[AutoMode] → v1-agent-loop (complex task)');
      return { mode: 'v1-agent-loop' as const, classification };
    }
    log.info('[AutoMode] → v1-api (simple task)');
    return { mode: 'v1-api' as const, classification };
  } catch (error) {
    log.warn('[AutoMode] → v1-api (classifier failed, fallback)', { error: error instanceof Error ? error.message : String(error) });
    return { mode: 'v1-api' as const };
  }
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

/**
 * Unified agent request processor
 *
 * Routes to OpenCode V2 Engine (primary) or V1 API (fallback) based on configuration.
 * Implements fallback chain for reliability.
 * Uses task classifier for intelligent mode selection.
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
    const userMsg = config.userMessage || '';

    // Always ensure conversationHistory exists so V1-API paths get injection
    if (!config.conversationHistory) {
      config.conversationHistory = [];
    }
    appendAutoInjectPowers(config.conversationHistory, userMsg);

    // Also build the raw text for modes that don't use conversationHistory
    autoInjectContext = buildAutoInjectUserMessage(userMsg) || '';
  } catch (err: any) {
    log.debug('Auto-inject powers skipped at entry point', { error: err?.message });
  }

  // Stash auto-inject context for mode handlers that don't use conversationHistory
  // (OpenCodeEngine, StatefulAgent, Mastra). They can append this to their
  // system prompt or user message as appropriate.
  config._autoInjectContext = autoInjectContext;

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
  log.info('[UnifiedAgent] │ provider:', config.provider || process.env.LLM_PROVIDER || 'mistral');
  log.info('[UnifiedAgent] │ model:', config.model || process.env.DEFAULT_MODEL || 'mistral-large-latest');
  log.info('[UnifiedAgent] │ mode config:', config.mode || 'auto');
  log.info('[UnifiedAgent] │ AGENT_EXECUTION_ENGINE:', process.env.AGENT_EXECUTION_ENGINE || 'auto');
  log.info('[UnifiedAgent] │ DISABLE_V2_MODE:', process.env.DISABLE_V2_MODE || 'unset');
  log.info('[UnifiedAgent] │ messageLength:', config.userMessage?.length || 0);
  log.info('[UnifiedAgent] │ tools:', Array.isArray(config.tools) ? config.tools.length : 0);
  log.info('[UnifiedAgent] └──────────────────────────────────────────');

  const { mode, classification } = await determineMode(config);

  log.info('[UnifiedAgent] ┌─ MODE SELECTED ──────────────────────────');
  log.info('[UnifiedAgent] │ resolvedMode:', mode);
  log.info('[UnifiedAgent] │ complexity:', classification?.complexity || 'n/a');
  log.info('[UnifiedAgent] │ confidence:', classification?.confidence?.toFixed(2) || 'n/a');
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

  try {
    log.info('[UnifiedAgent] ┌─ EXECUTING MODE ───────────────────────');
    log.info('[UnifiedAgent] │ switching on:', mode);
    log.info('[UnifiedAgent] └──────────────────────────────────────────');

    switch (mode) {
      case 'desktop':
        log.info('[UnifiedAgent] → desktop mode');
        return await runDesktopMode(config, classification);

      case 'v1-agent-loop':
        log.info('[UnifiedAgent] → v1-agent-loop mode (falling back to v1-api)');
        // This mode is handled by route.ts (bypasses unified-agent entirely).
        // Should never reach here via processUnifiedAgentRequest.
        // Fall back to v1-api if somehow called.
        return await runV1Api(config);

      case 'v2-native':
        log.warn('[UnifiedAgent] → v2-native mode (OPENCODE)');
        return await runV2Native(config, classification);

      case 'v2-containerized':
        log.warn('[UnifiedAgent] → v2-containerized mode (SANDBOX)');
        return await runV2Containerized(config);

      case 'v2-local':
        log.warn('[UnifiedAgent] → v2-local mode (LOCAL OPENCODE)');
        return await runV2Local(config);

      case 'opencode-sdk':
        log.info('[UnifiedAgent] → opencode-sdk mode (OpenCode HTTP API)');
        return await runOpencodeSDKMode(config, classification);

      case 'mastra-workflow':
        log.info('[UnifiedAgent] → mastra-workflow mode');
        return await runMastraWorkflow(config);

      case 'v1-progressive-build':
        log.info('[UnifiedAgent] → v1-progressive-build mode (multi-iteration build loop)');
        return await runProgressiveBuildMode(config, classification);

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
  } catch (error) {
    log.error('[UnifiedAgent] ✗ EXECUTION FAILED', {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    // Attempt fallback on error
    const triedModes = new Set<string>([mode]);
    const fallbackResult = await attemptFallback(config, mode, error, triedModes);

    if (fallbackResult) {
      log.info('[UnifiedAgent] ✓ FALLBACK SUCCEEDED', {
        fallbackFrom: mode,
        fallbackTo: fallbackResult.mode,
        fallbackProvider: fallbackResult.metadata?.provider,
        fallbackModel: fallbackResult.metadata?.model,
      });
      return {
        ...fallbackResult,
        metadata: {
          ...fallbackResult.metadata,
          fallbackFrom: mode,
          classification: classification ? {
            complexity: classification.complexity,
            confidence: classification.confidence,
          } : undefined,
        },
      };
    }

    // All modes failed
    log.error('[UnifiedAgent] ✗ ALL MODES FAILED', {
      triedModes: Array.from(triedModes),
    });
    return {
      success: false,
      response: '',
      mode,
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        duration: Date.now() - startTime,
        classification: classification ? {
          complexity: classification.complexity,
          confidence: classification.confidence,
        } : undefined,
      },
    };
  }
}

/**
 * Run V2 Native mode - OpenCode CLI as primary agentic engine
 * This is the MAIN mode for agentic tasks with native bash/file ops
 */
async function runV2Native(
  config: UnifiedAgentConfig,
  classification?: TaskClassification
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  log.info('Running V2 Native mode', {
    userMessageLength: config.userMessage.length,
    maxSteps: config.maxSteps,
    classification: classification ? {
      complexity: classification.complexity,
      confidence: classification.confidence,
      recommendedMode: classification.recommendedMode,
    } : undefined,
  });

  // Use classification to determine if StatefulAgent should be used
  // Fall back to regex-based detection if classification not provided
  let shouldUseStatefulAgent = false;
  
  if (classification) {
    // Use classifier recommendation
    shouldUseStatefulAgent = 
      classification.complexity === 'complex' ||
      classification.recommendedMode === 'stateful-agent';
    
    log.info('Task classification result', {
      complexity: classification.complexity,
      confidence: classification.confidence,
      reasoning: classification.reasoning?.slice(0, 3),
    });
  } else {
    // Fallback to regex-based detection (backward compatibility)
    // IMPORTANT: Only test against the raw user task, not the full context-augmented message
    const rawTask = extractRawUserTask(config.userMessage);
    const isComplexTask = /(create|build|implement|refactor|migrate|add feature|new file|multiple files|project structure|full-stack|application|service|api|component|page|dashboard|authentication|database|integration|deployment|setup|initialize|scaffold|generate|boilerplate)/i.test(rawTask);
    const hasMultipleSteps = /\b(and|then|after|before|first|next|finally|also|plus)\b/i.test(rawTask);
    const mentionsFiles = /\b(file|files|folder|directory|component|page|module|service|api)\b/i.test(rawTask);
    shouldUseStatefulAgent = isComplexTask || (hasMultipleSteps && mentionsFiles);
    
    log.info('Using fallback regex-based task detection', {
      isComplexTask,
      hasMultipleSteps,
      mentionsFiles,
    });
  }

  if (shouldUseStatefulAgent && startupCaps.statefulAgent) {
    log.info('Complex task detected, using StatefulAgent for Plan-Act-Verify workflow', {
      classification: classification?.complexity,
      confidence: classification?.confidence,
    });
    return await runStatefulAgentMode(config);
  }

  log.info('Simple task detected, using OpenCode Engine', { 
    classification: classification?.complexity || 'unknown',
  });

  // Use OpenCode Engine for simpler tasks
  // Prepend auto-inject context to system prompt so the engine knows about
  // proactive powers (web-search, code-search) when triggers match.
  const autoInjectSuffix = config._autoInjectContext ? `\n\n${config._autoInjectContext}` : '';
  const engineConfig: OpenCodeEngineConfig = {
    model: process.env.OPENCODE_MODEL,
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
  const result = await engine.execute(config.userMessage);

  if (!result.success) {
    throw new Error(result.error || 'OpenCode engine failed');
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
    response: result.response,
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
  classification?: TaskClassification
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  log.info('Running Desktop mode (local execution)', {
    userMessageLength: config.userMessage.length,
    classification: classification?.complexity,
  });

  // Desktop mode uses the StatefulAgent with a desktop sandbox provider
  // for complex tasks, or the OpenCode engine for simple tasks
  // IMPORTANT: Only test against the raw user task, not the full context-augmented message
  const desktopRawTask = extractRawUserTask(config.userMessage);
  const shouldUseStatefulAgent = classification
    ? classification.complexity === 'complex' || classification.recommendedMode === 'stateful-agent'
    : /(create|build|implement|refactor|migrate)/i.test(desktopRawTask);

  if (shouldUseStatefulAgent && process.env.ENABLE_STATEFUL_AGENT !== 'false') {
    log.info('Desktop: Complex task, routing to StatefulAgent with desktop provider');
    return await runStatefulAgentMode(config);
  }

  // For simple tasks, use the OpenCode engine with desktop sandbox
  try {
    const engineConfig: OpenCodeEngineConfig = {
      model: process.env.OPENCODE_MODEL,
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
      throw new Error(result.error || 'Desktop execution failed');
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
      response: result.response,
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

  // Initialize project-scoped services if projectContext provided
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
      // Pass project-scoped retrieval for project-isolated memory access
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
      response: result.response,
      steps,
      totalSteps: Array.isArray(result.steps) ? result.steps.length : (result.steps || 0),
      mode: 'v2-native',  // StatefulAgent runs as V2 native
      metadata: {
        provider: 'stateful-agent',
        duration: Date.now() - startTime,
        filesModified: result.vfs ? Object.keys(result.vfs).length : 0,
        errors: result.errors?.length || 0,
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
  const engineConfig: OpenCodeEngineConfig = {
    systemPrompt: (config.systemPrompt || '') + autoInjectSuffix,
    model: process.env.OPENCODE_MODEL,

    maxSteps: config.maxSteps,
    timeout: 300000,
  } as any;

  
  const engine = createOpenCodeEngine(engineConfig);
  const result = await engine.execute(config.userMessage);
  
  if (!result.success) {
    throw new Error(result.error || 'OpenCode engine failed');
  }
  
  return {
    success: true,
    response: result.response,
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
  const engineConfig: OpenCodeEngineConfig = {
    systemPrompt: (config.systemPrompt || '') + autoInjectSuffix,
    model: process.env.OPENCODE_MODEL,
    maxSteps: config.maxSteps,
    timeout: 300000,
  } as any;
  
  const engine = createOpenCodeEngine(engineConfig);
  const result = await engine.execute(config.userMessage);
  
  if (!result.success) {
    throw new Error(result.error || 'OpenCode engine failed');
  }
  
  return {
    success: true,
    response: result.response,
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
  classification?: TaskClassification,
): Promise<UnifiedAgentResult> {
  const startTime = Date.now();
  log.info('Running OpenCode SDK mode', {
    userMessageLength: config.userMessage.length,
    classification: classification?.complexity,
  });

  // Attempt 1: Connect to existing server via HTTP API
  try {
    const { createOpencodeSessionManager } = await import('@/lib/opencode');
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
      throw new Error('OpenCode server status check returned non-array — server likely not running');
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
    const modelStr = config.model || process.env.OPENCODE_MODEL;
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

    return {
      success: true,
      response: responseText || 'No response generated',
      steps: toolSteps,
      totalSteps: toolSteps.length,
      mode: 'opencode-sdk',
      fileEdits: fileEdits.length > 0 ? fileEdits : undefined,
      metadata: {
        provider: 'opencode-sdk',
        model: modelStr,
        duration: Date.now() - startTime,
        sessionId: session.id,
      },
    };
  } catch (httpError: any) {
    log.warn('OpenCode SDK HTTP API failed, trying @opencode-ai/sdk fallback', {
      error: httpError.message,
    });

    // Attempt 2: Try to start server via @opencode-ai/sdk
    try {
      const { createOpenCodeSDKProvider } = await import('@/lib/chat/opencode-sdk-provider');
      const sdkProvider = createOpenCodeSDKProvider({
        hostname: process.env.OPENCODE_HOSTNAME || '127.0.0.1',
        port: parseInt(process.env.OPENCODE_PORT || '4096'),
        model: config.model || process.env.OPENCODE_MODEL || 'anthropic/claude-3-5-sonnet-20241022',
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
        model: config.model || process.env.OPENCODE_MODEL || 'opencode/local',
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

      return {
        success: true,
        response: fullResponse || 'No response generated',
        steps: toolSteps,
        totalSteps: toolSteps.length,
        mode: 'opencode-sdk',
        metadata: {
          provider: 'opencode-sdk-fallback',
          duration: Date.now() - startTime,
          fallbackMethod: '@opencode-ai/sdk',
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

  // Build messages from conversation history + current message
  const messages: any[] = [
    ...(config.conversationHistory || []),
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
    // Use agent loop with tools
    return await runV1ApiWithTools(config, messages, startTime);
  } else {
    // Simple completion without tools
    return await runV1ApiCompletion(config, messages, getLLMProvider(), startTime);
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
      throw new Error(workflowResult.error || 'Mastra workflow execution failed');
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
 * 1. Gets current project tree + diffs from last round (via smart-context.ts)
 * 2. Calls LLM with "build the next piece" instructions
 * 3. Applies file writes through VFS MCP tools
 * 4. Optional reflection pass identifies gaps
 * 5. Stops when LLM emits [BUILD_COMPLETE] or maxIterations/timeout
 */
async function runProgressiveBuildMode(
  config: UnifiedAgentConfig,
  classification?: TaskClassification,
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
  const primaryProvider = config.provider || process.env.LLM_PROVIDER || 'mistral';
  const normalizedModel = config.model || process.env.LLM_MODEL || 'mistral-small-latest';

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
        vercelTools[tool.name] = {
          description: tool.description,
          parameters: tool.parameters,
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
      // Emit structured build progress as JSON through the stream chunk handler
      config.onStreamChunk(JSON.stringify({ type: 'progressive_build', event, ...data }));
    }
  };

  // Import and run the progressive build engine
  let buildResult: any;
  try {
    const { runProgressiveBuild, BuildPresets } = await import('../chat/progressive-build-engine');

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
          const { defaultReflectionFn } = await import('../chat/progressive-build-engine');
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
      classification: classification ? {
        complexity: classification.complexity,
        confidence: classification.confidence,
      } : undefined,
    },
  };
}

/**
 * Create a capability-based tool executor that uses the centralized tool system
 * This enables all execution paths (v1, v2, streaming, non-Mastra) to use the same tool capabilities
 *
 * Expanded capability map covers: file operations, bash/terminal, search/glob, MCP tools
 */
function createCapabilityToolExecutor(config: UnifiedAgentConfig) {
  return async (name: string, rawArgs: Record<string, any>): Promise<ToolResult> => {
    // Normalize args through shared alias resolver
    const args = normalizeToolArgs(name, rawArgs) as Record<string, any>;
    const capabilityMap: Record<string, string> = {
      'file_operation': 'file.read', 'read_file': 'file.read', 'write_file': 'file.write',
      'edit_file': 'file.write', 'delete_file': 'file.delete', 'list_directory': 'file.list',
      'list_dir': 'file.list', 'ls': 'file.list',
      'search_files': 'file.search', 'grep': 'file.search', 'glob': 'file.search', 'find': 'file.search',
      'execute_bash': 'sandbox.execute', 'execute_command': 'sandbox.execute', 'execute': 'sandbox.execute',
      'bash': 'sandbox.execute', 'shell': 'sandbox.execute', 'terminal': 'sandbox.execute', 'run': 'sandbox.execute',
      'sandbox_execute': 'sandbox.execute', 'sandbox_shell': 'sandbox.shell', 'sandbox_session': 'sandbox.session',
      'mcp_tool': 'mcp.execute', 'mcp_execute': 'mcp.execute',
      'git': 'repo.git', 'git_clone': 'repo.clone', 'git_search': 'repo.search',
      'web_search': 'web.search', 'web_fetch': 'web.fetch',
    };

    const capabilityId = capabilityMap[name] || name;

    if (hasToolCapability(capabilityId)) {
      log.debug('Executing tool via capability', { tool: name, capability: capabilityId });
      // FIX: Pass conversationId as sessionId for VFS session scoping
      // Also pass scopePath for proper VFS file operation scoping
      const result = await executeToolCapability(capabilityId, args, {
        userId: config.userId || 'system',
        sessionId: config.conversationId,  // FIX: Session scoping for VFS
        scopePath: config.conversationId ? `project/sessions/${config.conversationId}` : undefined,  // FIX: VFS scope path
        workspaceId: config.projectContext?.id,
      });
      return { success: result.success, output: (result.output as string) || result.error, exitCode: result.exitCode };
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
 * Run V1 API with tool support
 */
async function runV1ApiWithTools(
  config: UnifiedAgentConfig,
  messages: Array<{ role: string; content: string }>,
  startTime: number
): Promise<UnifiedAgentResult> {
  // Ensure tool system is initialized for capability-based execution
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: config.userId || 'system', enableMCP: true, enableSandbox: true });
  }

  log.info('[V1-API-WITH-TOOLS] ┌─ ENTRY ──────────────────────────');

  // Use the shared capability-based tool executor (avoids code duplication)
  const capabilityExecuteTool = createCapabilityToolExecutor(config);
  const primaryProvider = config.provider || process.env.LLM_PROVIDER || 'mistral';
  const primaryModel = config.model || process.env.DEFAULT_MODEL || 'mistral-large-latest';
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
  const { PROVIDERS } = await import('../chat/llm-providers');
  const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-6-20250514',
    google: 'gemini-2.5-flash',
    mistral: 'mistral-small-latest',
    openrouter: 'mistralai/mistral-small-latest',
    github: 'gpt-4o',
    nvidia: 'meta/llama-3.3-70b-instruct',
    groq: 'llama-3.3-70b-versatile',
    together: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    zen: 'zen',
    portkey: 'openrouter/auto',
    chutes: 'deepseek-ai/DeepSeek-R1-0528',
    fireworks: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    deepinfra: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
    anyscale: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
    lepton: 'llama3-70b',
  };

  function getModelForProvider(providerName: string): string {
    // If no explicit model set, use provider default
    if (!config.model) return PROVIDER_DEFAULT_MODELS[providerName] || primaryModel;

    // Check if the model is valid for this provider
    const provider = PROVIDERS[providerName.toLowerCase()];
    if (provider?.models && provider.models.length > 0) {
      if (provider.models.includes(config.model)) return config.model;
      // Model not in provider's list — use provider default
      log.debug(`Model "${config.model}" not in ${providerName} models list, using default`);
      return PROVIDER_DEFAULT_MODELS[providerName] || primaryModel;
    }

    // Unknown provider — trust the config model
    return config.model;
  }

  // Build provider fallback chain — only include providers with API keys set
  const fallbackChain = getConfiguredFallbackChain(primaryProvider);
  const providersToTry = [primaryProvider, ...fallbackChain];
  const uniqueProviders = [...new Set(providersToTry)];

  log.info('[V1-API-WITH-TOOLS] ┌─ PROVIDER FALLBACK CHAIN ────────');
  log.info(`[V1-API-WITH-TOOLS] │ primary: ${primaryProvider}/${primaryModel}`);
  log.info('[V1-API-WITH-TOOLS] │ configured fallbacks:', fallbackChain);
  log.info('[V1-API-WITH-TOOLS] │ will try (deduped):', uniqueProviders);
  log.info('[V1-API-WITH-TOOLS] └────────────────────────────────────');

  let lastError: Error | null = null;

  // Try each provider in order
  for (const providerName of uniqueProviders) {
    const modelForProvider = getModelForProvider(providerName);

    log.info('[V1-API-WITH-TOOLS] ┌─ ATTEMPT ─────────────────────');
    log.info('[V1-API-WITH-TOOLS] │ provider:', providerName);
    log.info('[V1-API-WITH-TOOLS] │ model:', modelForProvider);
    log.info('[V1-API-WITH-TOOLS] │ isFirst:', providerName === primaryProvider);
    log.info('[V1-API-WITH-TOOLS] └────────────────────────────────');

    const toolInvocations: Array<{
      toolCallId: string;
      toolName: string;
      args: Record<string, any>;
      result: any;
    }> = [];

    const loopState = createLoopDetectorState();

    const aiSdkTools = Object.fromEntries(
      (config.tools || []).map((toolDef: any) => [
        toolDef.name,
        {
          description: toolDef.description,
          parameters: toolDef.parameters,
          execute: async (rawArgs: Record<string, any>) => {
            // Normalize args to fix common LLM mistakes (wrong field names, etc.)
            const args = normalizeToolArgs(toolDef.name, rawArgs) as Record<string, any>;
            const toolResult = await capabilityExecuteTool(toolDef.name, args);
            config.onToolExecution?.(toolDef.name, args, toolResult);

            // Track for no-progress loop detection
            const loopMsg = recordStepAndCheckLoop(loopState, toolDef.name, args, toolResult.success);
            if (loopMsg) {
              log.warn(`[V1-API-WITH-TOOLS] Loop detected: ${loopMsg}`);
              return {
                success: false,
                output: loopMsg,
                exitCode: 1,
                error: loopMsg,
                _agentShouldStop: true,
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

    const llmMessages: any[] = [];

    // RAG Knowledge Retrieval — inject relevant knowledge into system prompt
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
      log.warn('[V1-API-WITH-TOOLS] RAG retrieval failed, continuing without it', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

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
      });
      llmMessages.push({ role: 'system', content: composedPrompt + workspaceSnippet });
      log.info('[V1-API-WITH-TOOLS] Composed role prompt', {
        role: config.role,
        toolCount: toolIds.length,
        promptLength: composedPrompt.length,
        hasRag: !!ragContext,
      });
    } else if (config.systemPrompt) {
      const systemContent = config.systemPrompt + ragContext + workspaceSnippet;
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

    try {
      log.info('[V1-API-WITH-TOOLS] Calling streamWithVercelAI...');
      const { streamWithVercelAI } = await import('../chat/vercel-ai-streaming');

      for await (const chunk of streamWithVercelAI({
        provider: providerName,
        model: modelForProvider,
        messages: llmMessages,
        temperature: config.temperature || 0.7,
        maxTokens: config.maxTokens || 65536,
        maxSteps: config.maxSteps || 15,
        tools: aiSdkTools,
        toolCallStreaming: true,
      })) {
        if (chunk.content) {
          response += chunk.content;
          config.onStreamChunk?.(chunk.content);
        }

        if (chunk.toolInvocations) {
          for (const invocation of chunk.toolInvocations) {
            if (invocation.state !== 'result') continue;
            toolInvocations.push({
              toolCallId: invocation.toolCallId,
              toolName: invocation.toolName,
              args: (invocation.args as Record<string, any>) || {},
              result: invocation.result,
            });
          }
        }
      }

      // Empty-completion guard: if no response and no tool invocations, throw to trigger fallback
      if (!response.trim() && toolInvocations.length === 0) {
        throw new Error(`Empty completion from ${providerName}/${modelForProvider} — no text and no tool calls`);
      }

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
      log.info('[V1-API-WITH-TOOLS] └────────────────────────────────');

      if (providerName !== primaryProvider) {
        log.info(`V1 API (with tools): Fallback provider succeeded`, {
          primaryProvider,
          primaryModel,
          fallbackProvider: providerName,
          fallbackModel: modelForProvider,
        });
      }

      // Text-mode file extraction: if response has text but no tool calls,
      // parse for ```file: / ```diff: blocks and apply to VFS
      if (response && toolInvocations.length === 0) {
        try {
          const { extractFileEdits } = await import('../chat/file-edit-parser');
          const { virtualFilesystem } = await import('../virtual-filesystem/index.server');
          const textEdits = extractFileEdits(response);
          if (textEdits.length > 0) {
            const ownerId = config.userId || config.filesystemOwnerId || '1';
            for (const edit of textEdits) {
              if (edit.path && edit.content) {
                try {
                  const editPath = config.scopePath ? `${config.scopePath}/${edit.path}` : edit.path;
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

      log.info('[Telemetry-v1Api] Recording completion', {
        requestId,
        provider: providerName,
        model: modelForProvider,
        duration,
        toolCount: toolCallTelemetry.length,
        responseLength: response.length,
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
        try {
          const toolCallSummary = toolCallTelemetry
            .map(t => `${t.toolName}(${JSON.stringify(t.args).slice(0, 100)})`)
            .join('\n');
          await ingestTrajectory({
            task: config.userMessage.slice(0, 500),
            toolCalls: toolCallSummary,
            model: `${providerName}/${modelForProvider}`,
            quality: 1.0 - (toolInvocations.length * 0.05), // Slightly lower quality for more retries
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
      }

      return {
        success: true,
        response: response || 'No response generated',
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
        },
      };
    } catch (error: any) {
      lastError = error;
      log.warn('[V1-API-WITH-TOOLS] ┌─ ATTEMPT FAILED ────────────');
      log.warn('[V1-API-WITH-TOOLS] │ provider:', providerName);
      log.warn('[V1-API-WITH-TOOLS] │ model:', modelForProvider);
      log.warn('[V1-API-WITH-TOOLS] │ error:', error.message);
      log.warn('[V1-API-WITH-TOOLS] │ will try next:', uniqueProviders.slice(uniqueProviders.indexOf(providerName) + 1).join(', ') || 'NO MORE');
      log.warn('[V1-API-WITH-TOOLS] └───────────────────────────────');
    }
  }

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
  // Ensure tool system is initialized
  if (!isToolSystemReady()) {
    await initToolSystem({ userId: config.userId || 'system', enableMCP: true, enableSandbox: true });
  }

  // Use shared capability-based tool executor (avoids code duplication)
  const capabilityExecuteTool = createCapabilityToolExecutor(config);

  const orchestratorConfig: OrchestratorConfig = {
    iterationConfig: {
      maxIterations: config.maxSteps || parseInt(process.env.LLM_AGENT_TOOLS_MAX_ITERATIONS || '10', 10),
      maxTokens: config.maxTokens || 32000,
      maxDurationMs: parseInt(process.env.LLM_AGENT_TOOLS_TIMEOUT_MS || '60000', 10),
    },
    tools: config.tools || [],
    executeTool: capabilityExecuteTool,
  };

  const orchestrator = new PlanActVerifyOrchestrator(orchestratorConfig);
  let content = '';
  let stepsCount = 0;
  const steps: any[] = [];

  try {
    for await (const event of orchestrator.execute(config.userMessage, messages)) {
      if (config.onStreamChunk) {
        if (event.type === 'token') {
          config.onStreamChunk((event as any).content);
        } else if (event.type === 'phase_change') {
          config.onStreamChunk(`\n[Phase: ${event.phase}]\n`);
        } else if (event.type === 'tool_result') {
          config.onStreamChunk(`\n[Tool Result: ${event.tool}]\n`);
        } else if (event.type === 'verification_failed') {
          config.onStreamChunk(`\n[Verification Failed: retrying...]\n`);
        }
      }

      if (event.type === 'done') {
        content = event.response;
        stepsCount = event.stats?.iterations || 0;
      } else if (event.type === 'tool_result') {
        steps.push({
          toolName: event.tool,
          args: {},
          result: { success: true, output: JSON.stringify(event.result), exitCode: 0 },
        });
      }
    }

    const provider = config.provider || process.env.LLM_PROVIDER || 'mistral';
    const model = config.model || process.env.DEFAULT_MODEL || 'mistral-large-latest';
    const duration = Date.now() - startTime;

    // FIX: Record telemetry for v1-orchestrator path
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

    return {
      success: true,
      response: content,
      steps,
      totalSteps: stepsCount,
      mode: 'v1-api',
      metadata: {
        provider,
        model,
        duration,
        orchestrator: true,
      },
    };
  } catch (err: any) {
    const provider = config.provider || process.env.LLM_PROVIDER || 'mistral';
    const model = config.model || process.env.DEFAULT_MODEL || 'mistral-large-latest';
    const duration = Date.now() - startTime;

    // FIX: Record failure telemetry for v1-orchestrator path
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

    return {
      success: false,
      response: content || 'Orchestration failed',
      mode: 'v1-api',
      error: err.message,
      metadata: { duration, provider, model },
    };
  }
}

async function runV1ApiCompletion(
  config: UnifiedAgentConfig,
  messages: any[],
  llmProvider: LLMProvider,
  startTime: number
): Promise<UnifiedAgentResult> {
  if (process.env.ENABLE_V1_ORCHESTRATOR === 'true') {
    // PlanActVerify orchestrator is available as a standalone mode
    // (mode: 'energy-driven' or mode: 'attractor-driven') instead of
    // being hidden behind this env flag.
    log.info('[V1-API-COMPLETION] ENABLE_V1_ORCHESTRATOR is deprecated; use a harness mode instead');
  }

  // Standard completion path

  log.info('[V1-API-COMPLETION] ┌─ ENTRY ──────────────────────────');

  // Use config provider/model if specified, otherwise fall back to env defaults
  const primaryProvider = config.provider || process.env.LLM_PROVIDER || 'mistral';
  const primaryModel = config.model || process.env.DEFAULT_MODEL || 'mistral-large-latest';
  const requestId = `unified-v1-${Date.now()}`;

  log.info('[V1-API-COMPLETION] │ primaryProvider:', primaryProvider);
  log.info('[V1-API-COMPLETION] │ primaryModel:', primaryModel);
  log.info('[V1-API-COMPLETION] │ requestId:', requestId);
  log.info('[V1-API-COMPLETION] └────────────────────────────────────');

  // FIX: Map each provider to a model that supports tool calling / function calling.
  // Also: when falling back, check if the model is valid for the target provider.
  const { PROVIDERS } = await import('../chat/llm-providers');
  const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
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

  function getModelForProvider(providerName: string): string {
    // If no explicit model set, use provider default
    if (!config.model) return PROVIDER_DEFAULT_MODELS[providerName] || primaryModel;

    // Check if the model is valid for this provider
    const provider = PROVIDERS[providerName.toLowerCase()];
    if (provider?.models && provider.models.length > 0) {
      if (provider.models.includes(config.model)) return config.model;
      // Model not in provider's list — use provider default
      log.debug(`Model "${config.model}" not in ${providerName} models list, using default`);
      return PROVIDER_DEFAULT_MODELS[providerName] || primaryModel;
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
    const modelForProvider = getModelForProvider(providerName);
    try {
      log.info('[V1-API-COMPLETION] ┌─ ATTEMPT ───────────────────');
      log.info('[V1-API-COMPLETION] │ provider:', providerName);
      log.info('[V1-API-COMPLETION] │ model:', modelForProvider);
      log.info('[V1-API-COMPLETION] │ isFirst:', providerName === primaryProvider);
      log.info('[V1-API-COMPLETION] └───────────────────────────────');

      const { streamWithVercelAI } = await import('../chat/vercel-ai-streaming');

      let content = '';
      const fileEdits: Array<{ path: string; content: string; action?: string }> = [];
      const toolCalls: Array<{ tool: string; args: any; result: any }> = [];
      const streamOpts = {
        provider: providerName,
        model: modelForProvider,
        messages: messages as any[],
        temperature: config.temperature || 0.7,
        maxTokens: config.maxTokens || 4096,
        maxRetries: 0,
        maxSteps: 12,  // Allow tool execution
        tools: config.tools?.length ? config.tools : undefined,
      };

      if (config.onStreamChunk) {
        log.debug('[ORCHESTRATOR] Passing tools to streamWithVercelAI:', config.tools?.map((t: any) => t.name));
        for await (const chunk of streamWithVercelAI(streamOpts as any)) {
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
        for await (const chunk of streamWithVercelAI(streamOpts as any)) {
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
          for (const edit of textEdits) {
            if (edit.path && edit.content) {
              try {
                const editPath = config.scopePath ? `${config.scopePath}/${edit.path}` : edit.path;
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

      return {
        success: true,
        response: content || 'No response generated',
        mode: 'v1-api',
        metadata: {
          provider: providerName,
          model: modelForProvider,
          duration: latencyMs,
          fallbackChain: fallbackChainUsed,
          // CRITICAL FIX: Include collected file edits and tool calls
          fileEdits: fileEdits.length > 0 ? fileEdits : undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        },
      };
    } catch (error: any) {
      lastError = error;
      log.warn('[V1-API-COMPLETION] ┌─ ATTEMPT FAILED ────────────');
      log.warn('[V1-API-COMPLETION] │ provider:', providerName);
      log.warn('[V1-API-COMPLETION] │ model:', modelForProvider);
      log.warn('[V1-API-COMPLETION] │ error:', error.message);
      log.warn('[V1-API-COMPLETION] │ will try next:', uniqueProviders.slice(uniqueProviders.indexOf(providerName) + 1).join(', ') || 'NO MORE');
      log.warn('[V1-API-COMPLETION] └───────────────────────────────');
    }
  }

  // All providers failed
  const latencyMs = Date.now() - startTime;

  log.error('[V1-API-COMPLETION] ┌─ ALL PROVIDERS FAILED ─────────');
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
async function attemptFallback(
  config: UnifiedAgentConfig,
  failedMode: string,
  error: any,
  triedModes: Set<string> = new Set()
): Promise<UnifiedAgentResult | null> {
  // Track tried modes to prevent infinite loops
  const visitedModes = new Set(triedModes);
  visitedModes.add(failedMode);

  log.info('[Fallback] ┌─ ATTEMPTING FALLBACK ──────────────────');
  log.info('[Fallback] │ failedMode:', failedMode);
  log.info('[Fallback] │ error:', error instanceof Error ? error.message : String(error));
  log.info('[Fallback] │ visitedModes:', Array.from(visitedModes));
  log.info('[Fallback] └───────────────────────────────────────────');

  // Use startup capabilities — don't try modes that weren't available at startup
  const caps = startupCaps;

  // Use task classifier for complexity detection (with regex fallback)
  // IMPORTANT: Only classify the raw user task, not the full context-augmented message
  let isComplexTask = false;
  try {
    const rawTask = extractRawUserTask(config.userMessage);
    const classification = await taskClassifier.classify(rawTask);
    isComplexTask = classification.complexity === 'complex' || classification.complexity === 'moderate';
    log.debug('Fallback classification', {
      complexity: classification.complexity,
      isComplexTask,
    });
  } catch {
    // Fallback to regex
    const rawTask = extractRawUserTask(config.userMessage);
    isComplexTask = /create|build|implement|refactor|migrate|add feature|new file|multiple files|project structure|full-stack|application|service|api|component|page/i.test(rawTask);
  }

  // TEMP: If v2 is disabled globally, skip all v2 fallbacks
  const v2Disabled = process.env.DISABLE_V2_MODE !== 'false';
  const engine = process.env.AGENT_EXECUTION_ENGINE || 'auto';
  const forceV1 = v2Disabled || engine === 'v1-api';
  const forceAgentLoop = engine === 'agent-loop';
  // FIX: When engine is 'auto', we want v1-only rotation (v1-api + v1-agent-loop).
  // Don't allow fallback to v2 modes unless engine is explicitly unset.
  const forceV1Auto = engine === 'auto' || forceV1;

  log.info('[Fallback] ┌─ FALLBACK CHAIN BUILD ─────────────────');
  log.info('[Fallback] │ v2Disabled:', v2Disabled);
  log.info('[Fallback] │ engine:', engine);
  log.info('[Fallback] │ forceV1:', forceV1);
  log.info('[Fallback] │ forceAgentLoop:', forceAgentLoop);
  log.info('[Fallback] │ forceV1Auto:', forceV1Auto);
  log.info('[Fallback] │ caps.v2Native:', caps.v2Native);
  log.info('[Fallback] │ caps.v2Containerized:', caps.v2Containerized);
  log.info('[Fallback] │ caps.v2Local:', caps.v2Local);
  log.info('[Fallback] │ caps.v1Api:', caps.v1Api);
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

  // Try each fallback mode
  for (const fallbackMode of fallbackOrder) {
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
      available: startupCaps.opencodeSdk,
      recommended: startupCaps.opencodeSdk,
      webReady: true,
    },
    {
      mode: 'v2-native',
      name: 'OpenCode Engine (Desktop Only)',
      description: 'Full agentic capabilities with native bash, file ops, and tool execution',
      available: startupCaps.v2Native,
      recommended: !startupCaps.opencodeSdk && startupCaps.v2Native,
    },
    {
      mode: 'v2-containerized',
      name: 'OpenCode Containerized (Desktop Only)',
      description: 'OpenCode CLI in isolated sandbox (production-ready)',
      available: startupCaps.v2Containerized,
    },
    {
      mode: 'v2-local',
      name: 'OpenCode Local (Desktop Only)',
      description: 'OpenCode CLI on your local machine',
      available: startupCaps.v2Local,
    },
    {
      mode: 'v1-api',
      name: 'LLM API (Fallback)',
      description: 'Cloud LLM APIs - simple chat only, no agentic capabilities',
      available: startupCaps.v1Api,
      webReady: true,
    },
  ];
}
