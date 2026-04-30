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
} from '../computer/daytona-computer-use-workflow';

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
  detectProject,
  getSandpackConfig,
  detectPreviewMode,
  detectFramework,
  detectEntryPoint,
  shouldUseLocalPreview,
  getCloudFallback,
  type AppFramework,
  type Bundler,
  type SandpackConfig,
  type PreviewMode,
  type PreviewRequest,
  type ProjectDetection,
} from '../previews/live-preview-offloading';

// Re-exports from underlying modules (these are actively used)
