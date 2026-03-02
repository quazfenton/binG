/**
 * Mastra Integration Index
 *
 * Main entry point for Mastra workflow orchestration.
 * Reuses all existing tools, state, and infrastructure.
 *
 * @see https://mastra.ai
 */

// Mastra instance
export { mastra, getMastra } from './mastra-instance';

// Model router with memory integration
export { modelRouter, getModel, recommendModel } from './models/model-router';
export type { ModelTier, RequestContext, ModelSelector } from './models/model-router';

// Memory integration
export {
  getMemory,
  createMemory,
  addMessage,
  getHistory,
  getWorkingMemory,
  setWorkingMemory,
  searchMemory,
  deleteThread,
  withMemory,
  memoryMiddleware,
} from './memory';

// Evals & Scorers
export {
  scoreCodeQuality,
  scoreSecurity,
  scoreBestPractices,
  evaluateCode,
  passesEvaluation,
  DEFAULT_EVALS_CONFIG,
  type ScorerResult,
  type CodeQualityMetrics,
  type ComprehensiveEvalResult,
  type EvalsConfig,
} from './evals/code-quality';

// Tools
export {
  writeFileTool,
  readFileTool,
  deletePathTool,
  listFilesTool,
  executeCodeTool,
  syntaxCheckTool,
  installDepsTool,
  allTools,
  getTool,
  getToolsByCategory,
} from './tools';

// Workflows
export {
  codeAgentWorkflow,
  getCodeAgentWorkflow,
  plannerStep,
  executorStep,
  criticStep,
  selfHealingPlannerStep,
} from './workflows/code-agent-workflow';

export {
  hitlWorkflow,
  getHITLWorkflow,
  getApprovalStep,
  syntaxCheckStep,
  writeStep,
} from './workflows/hitl-workflow';

// Types
export type {
  WorkflowInput,
  PlanOutput,
  ToolResult,
} from './workflows/code-agent-workflow';

export type {
  HITLInput,
  ApprovalDecision,
  SuspendData,
} from './workflows/hitl-workflow';
