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

// ==================== Unified Phase 3 Integration Class ====================

import { snapshotPortability, type PortableSnapshot, type MigrationResult } from './snapshot-portability';
import { lspIntegration, type Position, type CompletionItem, type Diagnostic, type Location, type Hover } from './lsp-integration';
import { gpuTaskRouting, type GPUTaskType, type GPURequirements, type GPUAvailability } from '../management/gpu-task-routing';
import { objectStorageIntegration, type UploadResult, type DownloadResult, type StoredFile } from '../storage/object-storage-integration';
import type { SandboxProviderType } from './providers';
import { createLogger } from '../utils/logger';

const logger = createLogger('Phase3:Integration');

/**
 * Phase 3 Integration Helper
 * 
 * Unified API for all Phase 3 features.
 */
export class Phase3Integration {
  // ==================== Snapshot Portability ====================
  
  /**
   * Export snapshot to portable format
   */
  async exportSnapshot(sessionId: string): Promise<PortableSnapshot> {
    return snapshotPortability.exportSnapshot(sessionId);
  }
  
  /**
   * Import portable snapshot
   */
  async importSnapshot(snapshot: PortableSnapshot, targetProvider: SandboxProviderType) {
    return snapshotPortability.importSnapshot(snapshot, targetProvider);
  }
  
  /**
   * Migrate session to different provider
   */
  async migrateSession(
    sessionId: string,
    targetProvider: SandboxProviderType,
    options?: { syncVFS?: boolean; vfsScopePath?: string }
  ): Promise<MigrationResult> {
    return snapshotPortability.migrateSession(sessionId, targetProvider, options);
  }
  
  /**
   * Verify snapshot integrity
   */
  async verifySnapshot(snapshot: PortableSnapshot) {
    return snapshotPortability.verifySnapshot(snapshot);
  }
  
  // ==================== LSP Integration ====================
  
  /**
   * Get code completions
   */
  async getCompletions(
    sandboxId: string,
    position: { filePath: string; line: number; column: number }
  ): Promise<CompletionItem[]> {
    return lspIntegration.getCompletions(sandboxId, position);
  }
  
  /**
   * Go to definition
   */
  async goToDefinition(
    sandboxId: string,
    position: { filePath: string; line: number; column: number }
  ): Promise<Location | null> {
    return lspIntegration.goToDefinition(sandboxId, position);
  }
  
  /**
   * Find references
   */
  async findReferences(
    sandboxId: string,
    position: { filePath: string; line: number; column: number }
  ): Promise<Location[]> {
    return lspIntegration.findReferences(sandboxId, position);
  }
  
  /**
   * Get hover documentation
   */
  async getHover(
    sandboxId: string,
    position: { filePath: string; line: number; column: number }
  ): Promise<Hover | null> {
    return lspIntegration.getHover(sandboxId, position);
  }
  
  /**
   * Get diagnostics
   */
  async getDiagnostics(sandboxId: string, filePath?: string): Promise<Diagnostic[]> {
    return lspIntegration.getDiagnostics(sandboxId, filePath ? { filePath } : undefined);
  }
  
  /**
   * Format document
   */
  async formatDocument(sandboxId: string, filePath: string) {
    return lspIntegration.formatDocument(sandboxId, filePath);
  }
  
  // ==================== GPU Task Routing ====================
  
  /**
   * Check GPU availability
   */
  async checkGPUAvailability(providerType: SandboxProviderType): Promise<GPUAvailability> {
    return gpuTaskRouting.checkGPUAvailability(providerType);
  }
  
  /**
   * Get GPU providers
   */
  getGPUProviders() {
    return gpuTaskRouting.getGPUProviders();
  }
  
  /**
   * Route ML task
   */
  async routeMLTask(requirements: GPURequirements) {
    return gpuTaskRouting.routeMLTask(requirements);
  }
  
  /**
   * Get cost estimate
   */
  getCostEstimate(taskType: GPUTaskType, durationHours: number, providerType?: SandboxProviderType) {
    return gpuTaskRouting.getCostEstimate(taskType, durationHours, providerType);
  }
  
  /**
   * Check if should use GPU
   */
  shouldUseGPU(requirements: GPURequirements): boolean {
    return gpuTaskRouting.shouldUseGPU(requirements);
  }
  
  // ==================== Object Storage ====================
  
  /**
   * Upload file
   */
  async uploadFile(
    sandboxId: string,
    options: { localPath: string; storageKey: string; contentType?: string }
  ): Promise<UploadResult> {
    return objectStorageIntegration.uploadFile(sandboxId, options);
  }
  
  /**
   * Download file
   */
  async downloadFile(
    sandboxId: string,
    options: { storageKey: string; localPath: string }
  ): Promise<DownloadResult> {
    return objectStorageIntegration.downloadFile(sandboxId, options);
  }
  
  /**
   * List files
   */
  async listFiles(sandboxId: string, prefix?: string): Promise<StoredFile[]> {
    return objectStorageIntegration.listFiles(sandboxId, prefix);
  }
  
  /**
   * Delete file
   */
  async deleteFile(sandboxId: string, storageKey: string) {
    return objectStorageIntegration.deleteFile(sandboxId, storageKey);
  }
  
  /**
   * Get storage URL
   */
  async getStorageUrl(sandboxId: string, storageKey: string) {
    return objectStorageIntegration.getStorageUrl(sandboxId, storageKey);
  }
  
  /**
   * Check storage support
   */
  isStorageSupported(providerType: SandboxProviderType): boolean {
    return objectStorageIntegration.isStorageSupported(providerType);
  }
}

/**
 * Singleton instance for convenience
 */
export const phase3 = new Phase3Integration();

/**
 * Quick helper: Migrate and sync
 */
export async function migrateAndSync(
  sessionId: string,
  targetProvider: SandboxProviderType,
  vfsScopePath: string
): Promise<MigrationResult> {
  return phase3.migrateSession(sessionId, targetProvider, {
    syncVFS: true,
    vfsScopePath,
  });
}

/**
 * Quick helper: Get code intelligence
 */
export async function getCodeIntelligence(
  sandboxId: string,
  filePath: string,
  line: number,
  column: number
): Promise<{
  completions: CompletionItem[];
  definition: Location | null;
  hover: Hover | null;
  diagnostics: Diagnostic[];
}> {
  const position = { filePath, line, column };
  
  const [completions, definition, hover, diagnostics] = await Promise.all([
    phase3.getCompletions(sandboxId, position),
    phase3.goToDefinition(sandboxId, position),
    phase3.getHover(sandboxId, position),
    phase3.getDiagnostics(sandboxId, filePath),
  ]);
  
  return { completions, definition, hover, diagnostics };
}
