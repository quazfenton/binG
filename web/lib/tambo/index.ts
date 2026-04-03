/**
 * Tambo Module Index
 *
 * Central export for all Tambo functionality
 *
 * @see https://tambo.ai/docs
 */

// Local tools
export {
  formatCodeTool,
  validateInputTool,
  calculateTool,
  allTamboTools,
  getToolByName,
  registerTool,
} from './tambo-tools';
export type { TamboTool } from './tambo-tools';

// Unified registries (single source of truth)
export {
  tamboToolRegistry,
  getTamboToolRegistry,
  initializeDefaultTools,
} from './tambo-tool-registry';
export type { TamboTool as TamboToolType } from './tambo-tool-registry';

export {
  tamboComponentRegistry,
  getTamboComponentRegistry,
  initializeDefaultComponents,
  withInteractable,
} from './tambo-component-registry';
export type { TamboComponent } from './tambo-component-registry';

// React hooks
export {
  useTamboContextHelpers,
  useTamboContextAttachments,
  useTamboResources,
  currentTimeContextHelper,
  currentPageContextHelper,
  userSessionContextHelper,
  systemInfoContextHelper,
  type ContextHelper,
  type ContextAttachment,
  type Resource,
} from './tambo-hooks';

// Enhanced provider
export {
  EnhancedTamboProvider,
  useTamboContextAttachmentsHook,
  useTamboResourcesHook,
  useTamboContextHelpersHook,
  type EnhancedTamboProviderProps,
} from './tambo-provider';

// Error handling
export {
  tamboErrorHandler,
  withTamboErrorHandling,
  withRetry,
  createTamboError,
  categorizeError,
  type TamboError,
  type TamboErrorCategory,
  type RetryConfig,
} from './tambo-error-handler';

// Default components (for reference)
export {
  Chart,
  DataTable,
  SummaryCard,
  TaskBoard,
  ShoppingCart,
  CodeDisplay,
  DataCard,
  ActionList,
  StatusAlert,
  FileTree,
  ProgressDisplay,
} from './tambo-default-components';

// Legacy service (kept for backward compatibility)
export {
  TamboService,
  createTamboService,
  getTamboService,
  initializeTamboService,
  type TamboConfig,
  type TamboExecutionResult,
} from './tambo-service';
