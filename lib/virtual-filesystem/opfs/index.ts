/**
 * OPFS Module Exports
 * 
 * Central export point for all OPFS functionality
 */

// Core service
export {
  OPFSCore,
  OPFSError,
  opfsCore,
  getOPFSCore,
  type OPFSOptions,
  type OPFSStats,
  type OPFSFileHandle,
  type OPFSDirectoryEntry,
  type OPFSFileInfo,
  type OPFSWriteOptions,
  type OPFSEventMap,
} from './opfs-core';

// Adapter
export {
  OPFSAdapter,
  opfsAdapter,
  type OPFSAdapterOptions,
  type SyncOptions,
  type SyncResult,
  type ConflictInfo,
  type QueuedWrite,
  type SyncStatus,
} from './opfs-adapter';

// Storage backend
export {
  OPFSStorageBackend,
  opfsStorageBackend,
  type WorkspaceState,
  type VFSStorageBackend,
} from './opfs-storage-backend';

// Configuration
export {
  opfsConfigManager,
  getOPFSConfig,
  updateOPFSConfig,
  subscribeOPFSConfig,
  DEFAULT_OPFS_CONFIG,
  type OPFSConfig,
} from './opfs-config';

// Test utilities
export {
  createTestFiles,
  readTestFiles,
  deleteTestFiles,
  clearWorkspace,
  testOPFSPerformance,
  testSyncPerformance,
  generateTestContent,
  createTestDirectoryStructure,
  type TestFile,
  type OPFSTestResult,
} from './opfs-test-utils';

// Git integration
export {
  OPFSGitIntegration,
  getOPFSGit,
  opfsGit,
  type OPFSGitOptions,
  type GitConfig,
  type GitStatusFile,
  type GitStatusResult,
  type GitCommit,
  type GitLogEntry,
  type GitCloneResult,
  type GitPushResult,
  type GitPullResult,
  type GitBranchInfo,
  type GitDiffEntry,
} from './opfs-git';

// Git-VFS sync
export {
  GitVFSSync,
  getGitVFSSync,
  gitVFSSync,
  type GitVFSSyncOptions,
  type GitVFSCommitResult,
  type GitVFSRestoreResult,
  type GitVFSStatus,
} from './git-vfs-sync';

// OPFS Shadow Commit
export {
  OPFSShadowCommitManager,
  getOPFSShadowCommitManager,
  opfsShadowCommit,
  type OPFSTransactionEntry,
  type OPFSCommitOptions,
  type OPFSCommitResult,
  type OPFSCommitEntry,
  type OPFSRollbackResult,
} from './opfs-shadow-commit';

// Terminal sync
export {
  TerminalOPFSSync,
  getTerminalOPFSSync,
  terminalOPFSSync,
  parseTerminalCommand,
  type TerminalOPFSConfig,
  type TerminalOperation,
  type TerminalSyncResult,
} from './terminal-sync';

// Multi-tab broadcast
export {
  OPFSBroadcast,
  getOPFSBroadcast,
  opfsBroadcast,
  useOPFSBroadcast_DEPRECATED,
  type OPFSBroadcastConfig,
  type OPFSBroadcastMessage,
  type OPFSBroadcastMessageType,
  type TabPresence,
  type BroadcastChannelHandler,
} from './opfs-broadcast';

// Note: For React hook, use useOPFSBroadcast from hooks/use-opfs-broadcast.ts

// Migration utilities
export {
  migrateFromServerVFS,
  migrateToServerVFS,
  quickSync,
  getMigrationStatus,
  rollbackMigration,
  type MigrationResult,
  type MigrationProgress,
  type MigrationDirection,
  type MigrationOptions,
} from './migration';

// Path utilities
export {
  resolveOPFSPath,
  normalizePathParts,
  isValidPathComponent,
  sanitizePathForOPFS,
  relativePath,
  isPathUnderRoot,
  getCommonPathPrefix,
  safeJoinPath,
  getParentDirectory,
  getFileName,
  getFileExtension,
  getFileNameWithoutExtension,
  ensureLeadingSlash,
  ensureTrailingSlash,
  normalizePath,
  MountManager,
  type MountPoint,
  type PathResolutionOptions,
} from './path-utils';

// Utilities
export {
  formatBytes,
  formatStats,
  getOPFSSupportInfo,
  requestPersistentStorage,
  getFormattedStorageEstimate,
  sanitizePath,
  getFileExtension,
  getFileNameWithoutExtension,
  detectLanguageFromPath,
  debounce,
  throttle,
  sleep,
  retry,
} from './utils';

/**
 * Check if OPFS is available in current environment
 */
export function isOPFSAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  
  return 'storage' in window && 'getDirectory' in window.storage;
}

/**
 * Get OPFS readiness status
 */
export function getOPFSReadiness(): {
  available: boolean;
  supported: boolean;
  browser: string;
  minVersion: string;
  recommended: boolean;
} {
  const supportInfo = getOPFSSupportInfo();
  
  return {
    available: supportInfo.supported,
    supported: supportInfo.supported,
    browser: supportInfo.browser,
    minVersion: getMinimumVersion(supportInfo.browser),
    recommended: supportInfo.browser === 'Chrome' || supportInfo.browser === 'Edge',
  };
}

function getMinimumVersion(browser: string): string {
  switch (browser) {
    case 'Chrome':
    case 'Edge':
      return '119';
    case 'Firefox':
      return '123 (with flag)';
    case 'Safari':
      return '17.4';
    default:
      return 'Unknown';
  }
}
