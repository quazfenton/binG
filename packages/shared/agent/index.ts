/**
 * Agent V2 Module
 *
 * OpenCode V2 Engine with Nullclaw integration.
 * Provides containerized agentic capabilities with per-user isolation.
 */

// Task Classifier - Multi-Factor Complexity Detection
export {
  createTaskClassifier,
  classifyTask,
  TaskClassifier,
  type TaskClassification,
  type ClassificationContext,
  type TaskClassifierConfig,
} from './task-classifier';

// Session Management
export {
  agentSessionManager,
  AgentSessionManager,
  type AgentSession,
  type AgentSessionConfig,
} from '@/lib/session/agent/agent-session-manager';

// Filesystem Bridge
export {
  agentFSBridge,
  AgentFSBridge,
  type SyncResult,
  type SyncOptions,
} from './agent-fs-bridge';

// Nullclaw Integration
export {
  nullclawIntegration,
  type NullclawConfig,
  type NullclawTask,
  type NullclawStatus,
} from './nullclaw-integration';

// Cloud Offload
export {
  cloudAgentOffload,
  CloudAgentOffload,
  type CloudAgentConfig,
  type CloudAgentInstance,
  type CloudAgentResult,
} from './cloud-agent-offload';

// Orchestration Mode Handler - Multi-framework routing
export {
  getOrchestrationModeFromRequest,
  executeWithOrchestrationMode,
  type OrchestrationMode,
  type OrchestrationRequest,
  type OrchestrationResult,
} from './orchestration-mode-handler';

// Task Router (LEGACY — keyword-based detection, superseded by unified router)
export {
  taskRouter,
  type TaskRequest,
  type TaskRoutingResult,
} from './task-router';

// Intent Schema — Declarative intent definitions for two-stage classification
export {
  INTENT_SCHEMA,
  classifyIntent,
  classifyIntentStage1,
  classifyIntentStage2,
  getAllStage1Scores,
  type IntentDefinition,
  type IntentMatch,
} from './intent-schema';

// Unified Router (PRIMARY — replaces scattered routing logic)
export {
  routeChatRequest,
  classifyTask as unifiedClassifyTask,
  checkProviderHealth,
  type ChatRequest,
  type ChatResponse,
  type ProviderHealth,
  type UnifiedAgentResult,
} from './unified-router';

// V2 Executor
export {
  executeV2Task,
  executeV2TaskStreaming,
  type V2ExecuteOptions,
  type V2ExecutionResult,
} from './v2-executor';

// Workforce State + Manager
export {
  workforceManager,
} from './workforce-manager';
export {
  loadState,
  saveState,
  addTask,
  updateTask,
  type WorkforceTask,
  type WorkforceState,
} from './workforce-state';

// Stateful Agent (from orchestra) - Comprehensive Plan-Act-Verify agent
export {
  StatefulAgent,
  createStatefulAgent,
  runStatefulAgent,
  type StatefulAgentOptions,
  type StatefulAgentResult,
} from '@/lib/orchestra/stateful-agent/agents/stateful-agent';

// Execution Graph - DAG-based task execution with parallel support
export {
  executionGraphEngine,
  ExecutionGraphEngine,
  type ExecutionGraph,
  type ExecutionNode,
  type ExecutionNodeType,
  type NodeStatus,
  type GraphExecutionResult,
} from './execution-graph';

// Unified Agent - Multi-capability agent abstraction
export {
  createAgent,
  UnifiedAgent,
  type UnifiedAgentConfig,
  type AgentCapability,
} from './unified-agent';

// Loop Detection - Prevent infinite agent loops
export {
  createLoopDetector,
  LoopDetector,
  type LoopDetectionConfig,
  type LoopDetectionResult,
  type ToolCallRecord,
} from './loop-detection';

// Timeout Escalation - Staged timeout strategy
export {
  createTimeoutEscalation,
  TimeoutEscalation,
  ESCALATION_PROFILES,
  type EscalationConfig,
  type EscalationStage,
  type EscalationContext,
  type EscalationResult,
  type EscalationAction,
} from './timeout-escalation';

// Capability Chain - Chain multiple capabilities
export {
  createCapabilityChain,
  chain,
  CapabilityChain,
  type ChainConfig,
  type ChainStep,
  type ChainExecutionResult,
  type CapabilityExecutor,
} from './capability-chain';

// Bootstrapped Agency - Self-improving agency
export {
  createBootstrappedAgency,
  BootstrappedAgency,
  type AgencyConfig,
  type AgencyMetrics,
  type ExecutionRecord,
} from './bootstrapped-agency';

// Productive Scripts - Pre-defined script templates
export {
  runProductiveScript,
  runCustomScript,
  getAvailableScripts,
  getScriptTemplate,
  type ScriptType,
  type ScriptConfig,
  type ScriptStep,
  type ScriptExecutionResult,
} from './productive-scripts';

// System Prompts - Role-based agent prompts for multi-agent workflows
export {
  SYSTEM_PROMPTS,
  AGENT_ROLE_CONFIGS,
  ROLE_COMPATIBILITY,
  getSystemPrompt,
  getMinimalPrompt,
  getRoleConfig,
  composePrompt,
  listRoles,
  type AgentRole,
  type AgentRoleConfig,
} from './system-prompts';

// Prompt Composer — Structured, dynamic prompt composition with tool injection
export {
  // Composition API
  composeRole,
  composeRoleWithTools,
  composeMultiRole,
  // Section management
  getRoleSections,
  parseSections,
  registerSection,
  getSectionTemplate,
  invalidateSectionCache,
  // Dynamic tool generation
  generateDynamicToolBlock,
  generateToolHints,
  // Types
  type PromptSection,
  type RoleSections,
  type PromptContext,
  type ComposeRoleOptions,
  type DynamicToolBlockOptions,
} from './prompt-composer';

// Supplementary System Prompts — Specialized roles
export {
  SUPPLEMENTARY_PROMPTS,
  SUPPLEMENTARY_ROLE_CONFIGS,
  getSupplementaryPrompt,
  getSupplementaryRoleConfig,
  listSupplementaryRoles,
  type SupplementaryAgentRole,
  type SupplementaryRoleConfig,
} from './system-prompts-supplementary';

// General Domain Prompts — Non-technical specialized roles (Batch 1)
export {
  GENERAL_PROMPTS,
  GENERAL_ROLE_CONFIGS,
  getGeneralPrompt,
  getGeneralMinimalPrompt,
  getGeneralRoleConfig,
  listGeneralDomainRoles,
  type GeneralDomainRole,
  type GeneralDomainRoleConfig,
} from './general-domain-prompts';

// General Domain Prompts V2 — Additional non-technical roles with tool strategies
export {
  GENERAL_PROMPTS_V2,
  GENERAL_ROLE_CONFIGS_V2,
  getGeneralPromptV2,
  getGeneralMinimalPromptV2,
  getGeneralRoleConfigV2,
  listGeneralDomainRolesV2,
  type GeneralDomainRoleV2,
  type GeneralDomainRoleConfigV2,
} from './general-domain-prompts-v2';

// General Domain Prompts V3 — More non-technical roles with tool strategies
export {
  GENERAL_PROMPTS_V3,
  GENERAL_ROLE_CONFIGS_V3,
  getGeneralPromptV3,
  getGeneralMinimalPromptV3,
  getGeneralRoleConfigV3,
  listGeneralDomainRolesV3,
  type GeneralDomainRoleV3,
  type GeneralDomainRoleConfigV3,
} from './general-domain-prompts-v3';

// General Domain Prompts V4 — Advanced non-technical roles with full tool strategies
export {
  GENERAL_PROMPTS_V4,
  GENERAL_ROLE_CONFIGS_V4,
  getGeneralPromptV4,
  getGeneralMinimalPromptV4,
  getGeneralRoleConfigV4,
  listGeneralDomainRolesV4,
  type GeneralDomainRoleV4,
  type GeneralDomainRoleConfigV4,
} from './general-domain-prompts-v4';

// Prompt Parameters — Optional response modifiers for any role
export {
  // Enums
  ResponseDepth,
  ExpertiseLevel,
  ReasoningMode,
  CitationStrictness,
  Tone,
  CreativityLevel,
  RiskPosture,
  OutputFormat,
  SelfCorrection,
  ConfidenceExpression,
  // Types
  type PromptParameters,
  type PromptPresetKey,
  type TelemetryEvent,
  type TelemetryCallback,
  type PresetFragment,
  // Defaults & Presets
  DEFAULT_PROMPT_PARAMETERS,
  PROMPT_PRESETS,
  // Functions
  applyPromptModifiers,
  clearModifierCache,
  generateDebugHeaderValue,
  getPreset,
  applyPresetWithOverrides,
  mergePromptParameters,
  hasActiveModifiers,
  composePreset,
  // Telemetry
  onTelemetryEvent,
  emitTelemetryEvent,
} from './prompt-parameters';

// Prompt Parameter Codec — Serialization, fingerprinting, diffing
export {
  encodeParams,
  decodeParams,
  paramsFingerprint,
  diffParams,
  derivePreset,
  validateParams,
  appendParamsToUrl,
  extractParamsFromUrl,
  type ParamDiff,
  type PresetDerivation,
} from './prompt-parameters.codec';
