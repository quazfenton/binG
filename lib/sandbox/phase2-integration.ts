/**
 * Phase 2 Integration Module
 * 
 * Exports all Phase 2 modules with unified API:
 * - Provider Router (auto-selection by task type)
 * - E2B Deep Integration (AMP/Codex workflows)
 * - Daytona Computer Use (workflow automation)
 * - CodeSandbox Batch CI/CD (parallel execution)
 * - Live Preview Offloading (smart preview selection)
 * 
 * All modules are ADDITIVE and don't break existing functionality.
 * 
 * @example
 * ```typescript
 * import { phase2 } from '@/lib/sandbox/phase2-integration';
 * 
 * // Auto-select provider for task
 * const provider = await phase2.selectProvider({
 *   type: 'agent',
 *   requiresPersistence: true,
 * });
 * 
 * // Run AMP agent
 * const result = await phase2.runAmpAgent({
 *   prompt: 'Refactor the utils module',
 * });
 * 
 * // Take screenshot
 * const screenshot = await phase2.takeScreenshot(sandboxId);
 * 
 * // Run parallel tests
 * const testResults = await phase2.runParallelTests({
 *   testFiles: ['src/tests/*.test.ts'],
 *   command: 'npm test --',
 * });
 * 
 * // Get smart preview
 * const preview = await phase2.getPreview({
 *   framework: 'react',
 *   hasBackend: false,
 * });
 * ```
 */

// ==================== Provider Router ====================
export {
  ProviderRouter,
  providerRouter,
  selectOptimalProvider,
  selectProviderWithServices,
  getProviderRecommendations,
  checkServiceSupport,
  getProvidersForService,
  type TaskType,
  type TaskDuration,
  type ProviderService,
  type TaskContext,
  type ProviderSelectionResult,
  type ProviderProfile,
} from './provider-router';

// ==================== E2B Deep Integration ====================
export {
  E2BIntegration,
  e2bIntegration,
  runAmpAgent,
  runCodexAgent,
  cloneRepo,
  type AmpAgentConfig,
  type CodexAgentConfig,
  type GitCloneConfig,
  type DesktopConfig,
  type E2BResult,
  type AmpEvent,
  type CodexEvent,
  type GitOperationResult,
} from './e2b-deep-integration';

// ==================== Daytona Computer Use ====================
export {
  DaytonaComputerUseWorkflow,
  daytonaComputerUse,
  takeScreenshot,
  takeRegionScreenshot,
  startRecording,
  stopRecording,
  click,
  type,
  type ScreenRegion,
  type MousePosition,
  type KeyboardInput,
  type RecordingResult,
  type ScreenshotResult,
} from './daytona-computer-use-workflow';

// ==================== CodeSandbox Batch CI/CD ====================
export {
  CodeSandboxBatchCI,
  codesandboxBatch,
  runBatchJob,
  runParallelTests,
  runMultiEnvBuild,
  runCIPipeline,
  type BatchTask,
  type BatchResult,
  type BatchAggregatedResult,
  type ParallelTestConfig,
  type MultiEnvBuildConfig,
  type CIPipelineConfig,
} from './codesandbox-batch-ci';

// ==================== Live Preview Offloading ====================
export {
  LivePreviewOffloading,
  livePreviewOffloading,
  getPreviewProvider,
  getProviderPreviewUrl,
  getPreview,
  createSmartPreview,
  type PreviewProvider,
  type AppFramework,
  type PreviewContext,
  type PreviewResult,
  type SmartPreviewConfig,
} from './live-preview-offloading';

// ==================== Unified Phase 2 Integration Class ====================

import { providerRouter, type TaskContext, type ProviderService, type ProviderSelectionResult } from './provider-router';
import { e2bIntegration, type AmpAgentConfig, type CodexAgentConfig, type GitCloneConfig, type E2BResult } from './e2b-deep-integration';
import { daytonaComputerUse, type ScreenRegion, type MousePosition, type KeyboardInput, type ScreenshotResult, type RecordingResult } from './daytona-computer-use-workflow';
import { codesandboxBatch, type BatchTask, type ParallelTestConfig, type MultiEnvBuildConfig, type CIPipelineConfig, type BatchAggregatedResult } from './codesandbox-batch-ci';
import { livePreviewOffloading, type PreviewContext, type PreviewResult, type SmartPreviewConfig } from './live-preview-offloading';
import type { SandboxProviderType } from './providers';

/**
 * Phase 2 Integration Helper
 * 
 * Unified API for all Phase 2 features.
 */
export class Phase2Integration {
  // ==================== Provider Router ====================
  
  /**
   * Select optimal provider for task
   */
  async selectProvider(context: TaskContext): Promise<SandboxProviderType> {
    return providerRouter.selectOptimalProvider(context);
  }
  
  /**
   * Get provider with service capabilities
   */
  async selectProviderWithServices(
    context: TaskContext & { needsServices: ProviderService[] }
  ): Promise<ProviderSelectionResult> {
    return providerRouter.selectWithServices(context);
  }
  
  /**
   * Get provider recommendations
   */
  async getProviderRecommendations(context: TaskContext) {
    return providerRouter.getRecommendations(context);
  }
  
  /**
   * Check if provider supports services
   */
  checkServiceSupport(provider: SandboxProviderType, services: ProviderService[]) {
    return providerRouter.checkServiceSupport(provider, services);
  }
  
  // ==================== E2B Integration ====================
  
  /**
   * Run AMP (Anthropic) agent
   */
  async runAmpAgent(config: AmpAgentConfig): Promise<E2BResult<string>> {
    return e2bIntegration.runAmpAgent(config);
  }
  
  /**
   * Run Codex (OpenAI) agent
   */
  async runCodexAgent(config: CodexAgentConfig): Promise<E2BResult<string>> {
    return e2bIntegration.runCodexAgent(config);
  }
  
  /**
   * Clone git repository
   */
  async cloneRepo(config: GitCloneConfig) {
    return e2bIntegration.cloneRepo(config);
  }
  
  /**
   * Get cost estimate for agent task
   */
  async getAmpCostEstimate(prompt: string, model?: string) {
    return e2bIntegration.getCostEstimate(prompt, model);
  }
  
  // ==================== Daytona Computer Use ====================
  
  /**
   * Take screenshot
   */
  async takeScreenshot(sandboxId: string): Promise<ScreenshotResult> {
    return daytonaComputerUse.takeScreenshot(sandboxId);
  }
  
  /**
   * Take region screenshot
   */
  async takeRegionScreenshot(sandboxId: string, region: ScreenRegion): Promise<ScreenshotResult> {
    return daytonaComputerUse.takeRegionScreenshot(sandboxId, region);
  }
  
  /**
   * Start recording
   */
  async startRecording(sandboxId: string): Promise<RecordingResult> {
    return daytonaComputerUse.startRecording(sandboxId);
  }
  
  /**
   * Stop recording
   */
  async stopRecording(sandboxId: string, recordingId: string): Promise<RecordingResult & { videoUrl: string }> {
    return daytonaComputerUse.stopRecording(sandboxId, recordingId);
  }
  
  /**
   * Click at position
   */
  async click(sandboxId: string, position: MousePosition) {
    return daytonaComputerUse.click(sandboxId, position);
  }
  
  /**
   * Type text
   */
  async type(sandboxId: string, input: KeyboardInput) {
    return daytonaComputerUse.type(sandboxId, input);
  }
  
  // ==================== CodeSandbox Batch ====================
  
  /**
   * Run batch job
   */
  async runBatchJob(tasks: BatchTask[], options?: { maxConcurrent?: number }): Promise<BatchAggregatedResult> {
    return codesandboxBatch.runBatchJob(tasks, options);
  }
  
  /**
   * Run parallel tests
   */
  async runParallelTests(config: ParallelTestConfig): Promise<BatchAggregatedResult> {
    return codesandboxBatch.runParallelTests(config);
  }
  
  /**
   * Run multi-environment build
   */
  async runMultiEnvBuild(config: MultiEnvBuildConfig): Promise<BatchAggregatedResult> {
    return codesandboxBatch.runMultiEnvBuild(config);
  }
  
  /**
   * Run CI pipeline
   */
  async runCIPipeline(config: CIPipelineConfig) {
    return codesandboxBatch.runCIPipeline(config);
  }
  
  // ==================== Live Preview ====================
  
  /**
   * Get preview provider
   */
  getPreviewProvider(context: PreviewContext) {
    return livePreviewOffloading.getPreviewProvider(context);
  }
  
  /**
   * Get preview URL
   */
  async getProviderPreviewUrl(sandboxId: string, port: number, providerType?: SandboxProviderType) {
    return livePreviewOffloading.getProviderPreviewUrl(sandboxId, port, providerType);
  }
  
  /**
   * Get preview
   */
  async getPreview(context: PreviewContext): Promise<PreviewResult> {
    return livePreviewOffloading.getPreview(context);
  }
  
  /**
   * Create smart preview
   */
  async createSmartPreview(config: SmartPreviewConfig) {
    return livePreviewOffloading.createSmartPreview(config);
  }
}

/**
 * Singleton instance for convenience
 */
export const phase2 = new Phase2Integration();

/**
 * Quick helper: Run agent task with auto-provider selection
 */
export async function runAgentTaskWithAutoProvider(
  prompt: string,
  agentType: 'amp' | 'codex'
): Promise<E2BResult<string>> {
  // Auto-select provider
  const provider = await phase2.selectProvider({
    type: 'agent',
    requiresBackend: true,
  });
  
  logger.info(`Auto-selected provider: ${provider} for agent task`);
  
  // Run agent
  if (agentType === 'amp') {
    return phase2.runAmpAgent({ prompt });
  } else {
    return phase2.runCodexAgent({ prompt });
  }
}

/**
 * Quick helper: Run CI pipeline with auto-provider selection
 */
export async function runCIWithAutoProvider(config: CIPipelineConfig): Promise<any> {
  // Auto-select provider for CI/CD
  const provider = await phase2.selectProvider({
    type: 'ci-cd',
    needsServices: ['batch', 'preview'],
  });
  
  logger.info(`Auto-selected provider: ${provider} for CI pipeline`);
  
  // Run pipeline
  return phase2.runCIPipeline(config);
}

import { createLogger } from '../utils/logger';
const logger = createLogger('Phase2:Integration');
