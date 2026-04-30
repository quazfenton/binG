/**
 * Phase 1 Integration Module
 * 
 * Exports all Phase 1 modules with convenience functions for easy integration.
 * 
 * Modules included:
 * - Per-user terminal session isolation
 * - Auto-snapshot service (Sprites/CodeSandbox)
 * - Provider-specific advanced MCP tools
 * - VFS sync-back for snapshot restoration
 * 
 * All modules are ADDITIVE and don't break existing functionality.
 * 
 * @example
 * ```typescript
 * // Quick integration in your code
 * import { phase1 } from '@/lib/sandbox/phase1-integration';
 * 
 * // Create user session with auto-snapshot
 * const session = await phase1.createUserSession({
 *   userId: 'user_123',
 *   autoSnapshot: true,
 * });
 * 
 * // Enable provider MCP tools
 * const tools = phase1.getProviderMCPTools();
 * 
 * // Sync sandbox to VFS after restore
 * await phase1.syncToVFS(session.sessionId, 'project');
 * ```
 */

// ==================== User Terminal Sessions ====================
export {
  UserTerminalSessionManager,
  userTerminalSessionManager,
  type UserTerminalSession,
  type CreateSessionOptions,
  type DisconnectSessionOptions,
  type RestoreResult,
} from '../terminal/session/user-terminal-sessions';

// ==================== Auto-Snapshot Service ====================
export {
  AutoSnapshotService,
  autoSnapshotService,
  enableAutoSnapshot,
  createSnapshot,
  type AutoSnapshotConfig,
  type SnapshotMetadata,
} from '../virtual-filesystem/sync/auto-snapshot-service';

// ==================== VFS Sync-Back ====================
export {
  VFSyncBackService,
  vfsSyncBackService,
  syncSandboxToVFS,
  type VFSFileEntry,
  type VFSyncConfig,
  type VFSyncResult,
  type VFSyncStatus,
} from '../virtual-filesystem/sync/vfs-sync-back';

// ==================== Provider Advanced MCP Tools ====================
export {
  getAllProviderAdvancedTools as getProviderAdvancedTools,
  callProviderTool,
  getE2BAmpToolDefinitions,
  getE2BCodexToolDefinitions,
  getDaytonaComputerUseToolDefinitions,
  getCodesandboxBatchToolDefinitions,
  getSpritesCheckpointToolDefinitions,
  executeE2BAmpAgent,
  executeE2BCodexAgent,
  executeDaytonaScreenshot,
  executeDaytonaStartRecording,
  executeDaytonaStopRecording,
  executeCodesandboxBatch,
  executeSpritesCreateCheckpoint,
  executeSpritesListCheckpoints,
  executeSpritesRestoreCheckpoint,
  type ProviderToolDefinition,
  type ProviderToolResult,
} from '../mcp/provider-advanced-tools';

// ==================== Enhanced PTY Terminal ====================
export {
  EnhancedPTYTerminalManager,
  enhancedPTYTerminalManager,
  createPTYTerminal,
  getPTYTerminal,
  connectPTYToSandbox,
  disconnectPTY,
  type PTYMode,
  type PTYTerminalConfig,
  type PTYConnectOptions,
  type PTYDisconnectOptions,
  type PTYTerminalInstance,
} from '../terminal/enhanced-pty-terminal';

// Re-exports from underlying modules (these are actively used)
