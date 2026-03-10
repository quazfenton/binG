/**
 * Terminal OPFS Sync
 * 
 * Syncs terminal file operations to OPFS for instant persistence
 * Detects terminal-based file edits (nano, vim, echo, etc.) and syncs to OPFS
 * 
 * Features:
 * - Terminal command parsing for file operations
 * - OPFS write-first for instant persistence
 * - Background server sync
 * - Conflict detection with terminal edits
 */

import { opfsAdapter } from './opfs-adapter';
import { opfsCore } from './opfs-core';

export interface TerminalOperation {
  type: 'create' | 'edit' | 'delete' | 'mkdir' | 'move' | 'copy';
  path: string;
  content?: string;
  timestamp: number;
  command?: string;
}

export interface TerminalOPFSConfig {
  workspaceId: string;
  ownerId: string;
  autoSync?: boolean;
  syncDelay?: number;  // ms to wait before syncing (debounce)
}

export interface TerminalSyncResult {
  success: boolean;
  path: string;
  operation: string;
  error?: string;
}

/**
 * Parse terminal command to extract file operations
 */
export function parseTerminalCommand(command: string): TerminalOperation | null {
  const trimmed = command.trim();
  
  // echo "content" > file.txt
  const echoMatch = trimmed.match(/^echo\s+["']?(.+?)["']?\s*>\s*(.+)$/);
  if (echoMatch) {
    return {
      type: 'create',
      path: echoMatch[2].trim(),
      content: echoMatch[1],
      timestamp: Date.now(),
      command: trimmed,
    };
  }

  // cat > file.txt << EOF ... EOF
  if (trimmed.startsWith('cat > ') || trimmed.startsWith('cat >> ')) {
    const pathMatch = trimmed.match(/cat\s+>>?\s+(.+?)(?:\s*<<|$)/);
    if (pathMatch) {
      return {
        type: trimmed.includes('>>') ? 'edit' : 'create',
        path: pathMatch[1].trim(),
        timestamp: Date.now(),
        command: trimmed,
      };
    }
  }

  // nano file.txt
  const nanoMatch = trimmed.match(/^nano\s+(.+)$/);
  if (nanoMatch) {
    return {
      type: 'edit',
      path: nanoMatch[1].trim(),
      timestamp: Date.now(),
      command: trimmed,
    };
  }

  // vim file.txt / vi file.txt
  const vimMatch = trimmed.match(/^vi[m]?\s+(.+)$/);
  if (vimMatch) {
    return {
      type: 'edit',
      path: vimMatch[1].trim(),
      timestamp: Date.now(),
      command: trimmed,
    };
  }

  // touch file.txt
  const touchMatch = trimmed.match(/^touch\s+(.+)$/);
  if (touchMatch) {
    return {
      type: 'create',
      path: touchMatch[1].trim(),
      content: '',
      timestamp: Date.now(),
      command: trimmed,
    };
  }

  // mkdir dir
  const mkdirMatch = trimmed.match(/^mkdir\s+(?:-p\s+)?(.+)$/);
  if (mkdirMatch) {
    return {
      type: 'mkdir',
      path: mkdirMatch[1].trim(),
      timestamp: Date.now(),
      command: trimmed,
    };
  }

  // rm file.txt
  const rmMatch = trimmed.match(/^rm\s+(?:-rf?\s+)?(.+)$/);
  if (rmMatch) {
    return {
      type: 'delete',
      path: rmMatch[1].trim(),
      timestamp: Date.now(),
      command: trimmed,
    };
  }

  // mv src dest
  const mvMatch = trimmed.match(/^mv\s+(.+?)\s+(.+)$/);
  if (mvMatch) {
    return {
      type: 'move',
      path: mvMatch[2].trim(),
      timestamp: Date.now(),
      command: trimmed,
    };
  }

  // cp src dest
  const cpMatch = trimmed.match(/^cp\s+(?:-r\s+)?(.+?)\s+(.+)$/);
  if (cpMatch) {
    return {
      type: 'copy',
      path: cpMatch[2].trim(),
      timestamp: Date.now(),
      command: trimmed,
    };
  }

  return null;
}

/**
 * Terminal OPFS Sync Manager
 */
export class TerminalOPFSSync {
  private core: typeof opfsCore;
  private adapter: typeof opfsAdapter;
  private options: Required<TerminalOPFSConfig>;
  private operationQueue: TerminalOperation[] = [];
  private syncTimeout: NodeJS.Timeout | null = null;
  private enabled = false;

  constructor(options: TerminalOPFSConfig) {
    this.core = opfsCore;
    this.adapter = opfsAdapter;
    this.options = {
      workspaceId: options.workspaceId,
      ownerId: options.ownerId,
      autoSync: options.autoSync ?? true,
      syncDelay: options.syncDelay ?? 500,
    };
  }

  /**
   * Enable terminal sync
   */
  async enable(): Promise<void> {
    if (this.enabled) {
      return;
    }

    await this.core.initialize(this.options.workspaceId);
    
    if (!this.adapter.isEnabled()) {
      await this.adapter.enable(this.options.ownerId, this.options.workspaceId);
    }

    this.enabled = true;
    console.log('[Terminal OPFS] Enabled for workspace:', this.options.workspaceId);
  }

  /**
   * Disable terminal sync
   */
  async disable(): Promise<void> {
    this.enabled = false;
    
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }

    console.log('[Terminal OPFS] Disabled');
  }

  /**
   * Sync terminal file creation to OPFS
   */
  async syncFileCreate(path: string, content: string): Promise<TerminalSyncResult> {
    if (!this.enabled) {
      return { success: false, path, operation: 'create', error: 'Not enabled' };
    }

    try {
      await this.core.writeFile(path, content);
      
      // Queue for server sync
      this.adapter.queueWrite(this.options.ownerId, path, content, 1);

      console.log('[Terminal OPFS] File created:', path);

      return {
        success: true,
        path,
        operation: 'create',
      };
    } catch (error: any) {
      console.error('[Terminal OPFS] File create failed:', path, error.message);
      return {
        success: false,
        path,
        operation: 'create',
        error: error.message,
      };
    }
  }

  /**
   * Sync terminal file edit to OPFS
   */
  async syncFileEdit(path: string, content: string): Promise<TerminalSyncResult> {
    if (!this.enabled) {
      return { success: false, path, operation: 'edit', error: 'Not enabled' };
    }

    try {
      await this.core.writeFile(path, content);
      
      // Queue for server sync
      this.adapter.queueWrite(this.options.ownerId, path, content, 1);

      console.log('[Terminal OPFS] File edited:', path);

      return {
        success: true,
        path,
        operation: 'edit',
      };
    } catch (error: any) {
      console.error('[Terminal OPFS] File edit failed:', path, error.message);
      return {
        success: false,
        path,
        operation: 'edit',
        error: error.message,
      };
    }
  }

  /**
   * Sync terminal file delete to OPFS
   */
  async syncFileDelete(path: string): Promise<TerminalSyncResult> {
    if (!this.enabled) {
      return { success: false, path, operation: 'delete', error: 'Not enabled' };
    }

    try {
      await this.core.deleteFile(path);

      console.log('[Terminal OPFS] File deleted:', path);

      return {
        success: true,
        path,
        operation: 'delete',
      };
    } catch (error: any) {
      console.error('[Terminal OPFS] File delete failed:', path, error.message);
      return {
        success: false,
        path,
        operation: 'delete',
        error: error.message,
      };
    }
  }

  /**
   * Sync terminal directory creation to OPFS
   */
  async syncDirectoryCreate(path: string): Promise<TerminalSyncResult> {
    if (!this.enabled) {
      return { success: false, path, operation: 'mkdir', error: 'Not enabled' };
    }

    try {
      await this.core.createDirectory(path, { recursive: true });

      console.log('[Terminal OPFS] Directory created:', path);

      return {
        success: true,
        path,
        operation: 'mkdir',
      };
    } catch (error: any) {
      console.error('[Terminal OPFS] Directory create failed:', path, error.message);
      return {
        success: false,
        path,
        operation: 'mkdir',
        error: error.message,
      };
    }
  }

  /**
   * Process terminal command and sync to OPFS
   * 
   * Parses command and performs appropriate sync operation
   */
  async processCommand(command: string, content?: string): Promise<TerminalSyncResult | null> {
    if (!this.enabled) {
      return null;
    }

    const operation = parseTerminalCommand(command);
    
    if (!operation) {
      return null;  // Not a file operation
    }

    // Add to queue for debounced sync
    this.operationQueue.push(operation);

    // Debounce sync
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
    }

    if (this.options.autoSync) {
      this.syncTimeout = setTimeout(() => {
        this.flushQueue();
      }, this.options.syncDelay);
    }

    // Process immediately based on operation type
    switch (operation.type) {
      case 'create':
        return this.syncFileCreate(operation.path, content || operation.content || '');
      
      case 'edit':
        if (content || operation.content) {
          return this.syncFileEdit(operation.path, content || operation.content || '');
        }
        // For editors like nano/vim, we'll sync when we get the content
        return {
          success: true,
          path: operation.path,
          operation: 'edit_pending',
        };
      
      case 'delete':
        return this.syncFileDelete(operation.path);
      
      case 'mkdir':
        return this.syncDirectoryCreate(operation.path);
      
      case 'move':
      case 'copy':
        // These require reading source first
        return {
          success: true,
          path: operation.path,
          operation: operation.type,
        };
      
      default:
        return null;
    }
  }

  /**
   * Flush operation queue
   */
  private async flushQueue(): Promise<void> {
    if (this.operationQueue.length === 0) {
      return;
    }

    const operations = [...this.operationQueue];
    this.operationQueue = [];

    console.log('[Terminal OPFS] Flushing', operations.length, 'operations');

    // Server sync is handled by opfsAdapter's background sync
  }

  /**
   * Sync file content from terminal editor
   * 
   * Called after terminal editor (nano/vim) closes with updated content
   */
  async syncEditorContent(path: string, content: string): Promise<TerminalSyncResult> {
    return this.syncFileEdit(path, content);
  }

  /**
   * Get pending operations count
   */
  getPendingOperations(): number {
    return this.operationQueue.length;
  }

  /**
   * Check if path is being edited in terminal
   */
  isPathBeingEdited(path: string): boolean {
    return this.operationQueue.some(op => 
      (op.type === 'edit' || op.type === 'create') && op.path === path
    );
  }
}

// Singleton factory
const terminalSyncInstances = new Map<string, TerminalOPFSSync>();

export function getTerminalOPFSSync(
  workspaceId: string,
  ownerId: string,
  options?: Partial<TerminalOPFSConfig>
): TerminalOPFSSync {
  const key = `${workspaceId}:${ownerId}`;
  
  if (!terminalSyncInstances.has(key)) {
    terminalSyncInstances.set(key, new TerminalOPFSSync({ workspaceId, ownerId, ...options }));
  }
  
  return terminalSyncInstances.get(key)!;
}

export const terminalOPFSSync = getTerminalOPFSSync('default', 'default');
