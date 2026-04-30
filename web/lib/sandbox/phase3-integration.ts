/**
 * Phase 3 Integration Module
 * 
 * Exports all Phase 3 modules with unified API:
 * - Cross-Provider Snapshot Portability
 * - LSP (Language Server Protocol) Integration
 * - GPU Task Routing
 * - Object Storage Integration
 * 
 * All modules are ADDITIVE and don't break existing functionality.
 * 
 * @example
 * ```typescript
 * import { phase3 } from '@/lib/sandbox/phase3-integration';
 * 
 * // Migrate session between providers
 * const result = await phase3.migrateSession(sessionId, 'codesandbox');
 * 
 * // Get code completions
 * const completions = await phase3.getCompletions(sandboxId, {
 *   filePath: '/workspace/src/app.ts',
 *   line: 10,
 *   column: 5,
 * });
 * 
 * // Route ML task to GPU provider
 * const { provider, sandbox } = await phase3.routeMLTask({
 *   taskType: 'ml-training',
 *   requiredVRAM: 16,
 * });
 * 
 * // Upload large file to object storage
 * await phase3.uploadFile(sandboxId, {
 *   localPath: '/workspace/data/model.pkl',
 *   storageKey: 'my-project/model.pkl',
 * });
 * ```
 */

// ==================== Snapshot Portability ====================
export {
  SnapshotPortability,
  snapshotPortability,
  exportSnapshot,
  importSnapshot,
  migrateSession,
  verifySnapshot,
  type PortableSnapshot,
  type MigrationResult,
} from './snapshot-portability';

// ==================== LSP Integration ====================
export {
  LSPIntegration,
  lspIntegration,
  getCompletions,
  goToDefinition,
  findReferences,
  getHover,
  getDiagnostics,
  formatDocument,
  type Position,
  type CompletionItem,
  type Diagnostic,
  type Location,
  type Hover,
} from './lsp-integration';

// ==================== GPU Task Routing ====================
export {
  GPUTaskRouting,
  gpuTaskRouting,
  checkGPUAvailability,
  getGPUProviders,
  routeMLTask,
  getCostEstimate,
  shouldUseGPU,
  type GPUTaskType,
  type GPURequirements,
  type GPUAvailability,
} from '../management/gpu-task-routing';

// ==================== Object Storage Integration ====================
export {
  ObjectStorageIntegration,
  objectStorageIntegration,
  uploadFile,
  downloadFile,
  listFiles,
  deleteFile,
  getStorageUrl,
  isStorageSupported,
  type UploadResult,
  type DownloadResult,
  type StoredFile,
} from '../storage/object-storage-integration';

// Re-exports from underlying modules (these are actively used)
