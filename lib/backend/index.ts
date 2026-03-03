/**
 * Backend Module Index
 * Exports all backend adapters, managers, and routers
 */

// Preview Router
export {
  PreviewRouter,
  PreviewRegistry,
  FallbackOrchestrator,
  previewRouter,
  type PreviewTarget,
  type PreviewRegistration,
} from './preview-router';

// Sandbox Manager
export {
  SandboxManager,
  sandboxManager,
  type Sandbox,
  type SandboxConfig,
  type ExecResult,
  type FileEntry,
} from './sandbox-manager';

// Adapters
export {
  FlaskAdapter,
  DjangoAdapter,
  NodeWasmAdapter,
  PreviewMountManager,
  createFlaskAdapter,
  createDjangoAdapter,
  createNodeWasmAdapter,
  createPreviewMountManager,
  type FlaskApp,
  type DjangoASGIApp,
  type QuickJSRuntime,
  type PreviewMount,
} from './adapters';
