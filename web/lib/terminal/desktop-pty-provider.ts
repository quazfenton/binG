/**
 * Desktop PTY Terminal Provider
 * 
 * Provides real PTY terminal connections using Tauri backend.
 * Used in desktop mode for native shell execution without sandbox.
 * 
 * Bridges TerminalPanel to the Rust PTY commands:
 * - create_pty_session: Create new PTY session
 * - write_pty_input: Send input to PTY
 * - resize_pty: Resize terminal
 * - close_pty_session: Close PTY session
 * 
 * Also handles VFS sync - syncs files created/modified/deleted in the
 * real shell back to the virtual filesystem for UI updates.
 */

import { 
  createPtySession, 
  writePtyInput, 
  resizePty, 
  closePtySession,
  isTauriAvailable,
  type PtyOutputEvent 
} from '@/lib/tauri/invoke-bridge';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktopMode, getDefaultWorkspaceRoot } from '@bing/platform/env';
import { createLogger } from '@/lib/utils/logger';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { getDefaultWorkspaceRoot as getVfsWorkspaceRoot } from '@bing/platform/env';

// Lazy-loaded Tauri FS for file content sync in desktop mode only
// Uses Tauri's FS API directly (not fs-bridge) to avoid pulling server modules into client bundle
type TauriFsModule = {
  readTextFile(path: string, options?: { baseDir?: number }): Promise<string>;
};
let _tauriFsPromise: Promise<TauriFsModule> | null = null;
function getTauriFs(): Promise<TauriFsModule> {
  if (!_tauriFsPromise) {
    _tauriFsPromise = import('@tauri-apps/plugin-fs').then(
      m => m as unknown as TauriFsModule
    );
  }
  return _tauriFsPromise;
}

// Base directory for Tauri FS operations (0 = home directory)
const TAURI_BASE_DIR = 0;

const logger = createLogger('DesktopPTY');

// === SHELL CONFIG: User-configurable shell path ===
const SHELL_STORAGE_KEY = 'desktop-pty-shell';

/**
 * Get user's preferred shell path
 * Falls back to system default if not set
 */
export function getPreferredShell(): string {
  if (typeof window === 'undefined') return '/bin/bash';
  
  const stored = localStorage.getItem(SHELL_STORAGE_KEY);
  if (stored && stored.trim()) {
    return stored.trim();
  }
  
  // Detect available shells and pick best one
  const platform = typeof process !== 'undefined' ? process.platform : 'linux';
  if (platform === 'win32') {
    return 'powershell.exe';
  }
  
  // Check for available shells in order of preference
  const shells = ['/bin/zsh', '/bin/fish', '/bin/bash', '/bin/sh'];
  // Note: In production, we'd actually check which exists
  // For now, prefer zsh if on macOS, fish otherwise
  return platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

/**
 * Set user's preferred shell path
 */
export function setPreferredShell(shellPath: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SHELL_STORAGE_KEY, shellPath);
  logger.info('Set preferred shell', { shell: shellPath });
}

// === SHELL COMPLETION: Terminal auto-complete ===
// Shell completion uses the Tauri backend to get completions via shell's native
// completion mechanism (compgen for bash, compctl for zsh, etc.)

import { getShellCompletions } from '@/lib/tauri/invoke-bridge';

/**
 * Enable shell completion - logs that completion is available via backend
 */
export async function enableShellCompletion(terminal: any): Promise<boolean> {
  logger.info('Shell completion: enabled via Tauri backend');
  return true;  // Backend support is available
}

/**
 * Request shell completion from backend
 * Call this when user presses Tab in terminal
 * Returns completion candidates from the PTY backend
 */
export async function requestShellCompletion(
  _sessionId: string,
  currentLine: string,
  _cursorPosition: number,
  cwd?: string
): Promise<string[]> {
  if (!currentLine.trim()) {
    return [];  // No input to complete
  }

  // Get completions from Tauri backend using user's preferred shell
  const result = await getShellCompletions(currentLine, cwd);
  
  if (result.success && result.completions.length > 0) {
    logger.debug('Shell completions received', { count: result.completions.length, input: currentLine });
    return result.completions;
  }
  
  logger.debug('No shell completions found', { input: currentLine });
  return [];
}

// Debounce configuration
const SYNC_DEBOUNCE_MS = 500; // Wait 500ms after last change before syncing
const MAX_PENDING_FILES = 10; // Max files to batch in one sync cycle

// Pending sync state - tracks files waiting to be synced
interface PendingSync {
  path: string;
  type: 'create' | 'update' | 'delete';
  timestamp: number;
}

let pendingSyncs: Map<string, PendingSync> = new Map();
let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let isProcessingSyncs = false;

/**
 * Debounced file sync - queues files for sync and processes in batches
 * Avoids excessive reads during rapid file operations
 */
function queueFileSync(filePath: string, changeType: 'create' | 'update' | 'delete', workspaceRoot: string): void {
  // Update or add to pending sync queue
  pendingSyncs.set(filePath, {
    path: filePath,
    type: changeType,
    timestamp: Date.now(),
  });
  
  logger.debug('Queued file sync', { path: filePath, type: changeType, queueSize: pendingSyncs.size });
  
  // Clear existing timeout and set new one
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  
  // Process pending syncs after debounce delay
  syncTimeout = setTimeout(() => {
    processPendingSyncs(workspaceRoot);
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Process all pending file syncs in a batch
 */
async function processPendingSyncs(workspaceRoot: string): Promise<void> {
  if (isProcessingSyncs || pendingSyncs.size === 0) {
    return;
  }
  
  isProcessingSyncs = true;
  
  try {
    // Take up to MAX_PENDING_FILES from the queue
    const filesToSync = Array.from(pendingSyncs.values()).slice(0, MAX_PENDING_FILES);
    
    // Keep only files that weren't synced (in case more came in during processing)
    for (const file of filesToSync) {
      pendingSyncs.delete(file.path);
    }
    
    logger.info('Processing pending file syncs', { count: filesToSync.length });
    
    // Process deletions first (no read needed)
    const deletions = filesToSync.filter(f => f.type === 'delete');
    const createsOrUpdates = filesToSync.filter(f => f.type !== 'delete');
    
    for (const sync of deletions) {
      emitFilesystemUpdated({
        path: sync.path,
        paths: [sync.path],
        type: 'delete',
        source: 'desktop-pty-sync',
        sessionId: 'desktop-user',
        workspaceVersion: Date.now(),
      });
    }
    
    // Process creates/updates with actual file reads (limited concurrency)
    const readConcurrencyLimit = 3;
    for (let i = 0; i < createsOrUpdates.length; i += readConcurrencyLimit) {
      const batch = createsOrUpdates.slice(i, i + readConcurrencyLimit);
      await Promise.all(
        batch.map(sync => syncFileFromLocalFs(sync.path, workspaceRoot))
      );
    }
    
    // If more files pending, schedule another batch
    if (pendingSyncs.size > 0) {
      syncTimeout = setTimeout(() => {
        processPendingSyncs(workspaceRoot);
      }, SYNC_DEBOUNCE_MS);
    }
  } finally {
    // Reset processing flag when done or on error
    if (pendingSyncs.size === 0) {
      isProcessingSyncs = false;
    }
  }
}

/**
 * Read file content from local filesystem and update fsBridge state
 * This ensures the UI reflects actual file content when files are created/modified in the real shell
 */
async function syncFileFromLocalFs(filePath: string, workspaceRoot: string): Promise<void> {
  const { fsBridge, isUsingLocalFS } = await getFsBridge();
  if (!isDesktopMode() || !isUsingLocalFS()) {
    return; // Only sync in desktop mode with local FS
  }

  try {
    // Convert VFS path to local path (strip workspace root prefix)
    let relativePath = filePath;
    if (filePath.startsWith(workspaceRoot + '/')) {
      relativePath = filePath.slice(workspaceRoot.length + 1);
    }
    
    // Read actual file content from local filesystem via fsBridge
    // This triggers fsBridge's internal cache update and emits watch events for UI refresh
    const localFile = await fsBridge.readFile('desktop-user', relativePath);
    
    if (localFile && localFile.content !== undefined) {
      // Skip syncing very large files to avoid performance issues
      const maxFileSize = 5 * 1024 * 1024; // 5MB
      if (localFile.content.length > maxFileSize) {
        logger.debug('Skipped sync for large file', { path: filePath, size: localFile.content.length });
        return;
      }
      
      // Touch the file to ensure fsBridge state is current (triggers internal version bump)
      // Note: emitFilesystemUpdated is called in detection code, not here to avoid duplicates
      await fsBridge.writeFile('desktop-user', relativePath, localFile.content, localFile.language);
      logger.info('Synced file content from local FS', { path: filePath, size: localFile.content.length });
    }
  } catch (error) {
    // File might not exist yet or other error - that's OK for detection
    logger.debug('Could not sync file from local FS', { path: filePath, error: String(error) });
  }
}

export interface DesktopPtyOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  shell?: string;
}

export interface DesktopPtyInstance {
  sessionId: string;
  isConnected: boolean;
  writeInput: (data: string) => Promise<void>;
  resize: (cols: number, rows: number) => Promise<void>;
  close: () => Promise<void>;
  onOutput: (callback: (data: string) => void) => void;
  onClose: (callback: () => void) => void;
  onFileChange: (callback: (path: string, type: 'create' | 'update' | 'delete') => void) => void;
}

/**
 * Check if desktop PTY is available
 */
export function isDesktopPtyAvailable(): boolean {
  return isTauriAvailable() && isDesktopMode();
}

/**
 * Create a new desktop PTY session
 */
export async function createDesktopPty(options: DesktopPtyOptions = {}): Promise<DesktopPtyInstance | null> {
  if (!isDesktopPtyAvailable()) {
    logger.warn('Desktop PTY not available - falling back to simulated terminal');
    return null;
  }

  const workspaceRoot = getDefaultWorkspaceRoot() || options.cwd || '.';
  
  // === SHELL CONFIG: Use user's preferred shell, fallback to options or system default ===
  const shellPath = options.shell || getPreferredShell();
  
  logger.info('Creating desktop PTY session', { 
    cols: options.cols || 80, 
    rows: options.rows || 24,
    cwd: options.cwd || workspaceRoot,
    shell: shellPath
  });

  const result = await createPtySession(
    options.cols || 80,
    options.rows || 24,
    options.cwd || workspaceRoot,
    shellPath
  );

  if (!result.success || !result.session_id) {
    logger.error('Failed to create PTY session', { error: result.error });
    return null;
  }

  const sessionId = result.session_id;
  let outputCallback: ((data: string) => void) | null = null;
  let closeCallback: (() => void) | null = null;
  let fileChangeCallback: ((path: string, type: 'create' | 'update' | 'delete') => void) | null = null;
  
  let unlistenOutput: UnlistenFn | null = null;
  let unlistenClose: UnlistenFn | null = null;

  // Track file state to detect changes
  const knownFiles = new Set<string>();
  let lastCheckTime = Date.now();

  // Detect file changes from shell commands in PTY output
  const detectFileChanges = (output: string) => {
    // Only check periodically to avoid excessive filesystem calls
    const now = Date.now();
    if (now - lastCheckTime < 2000) return; // Check every 2 seconds max
    lastCheckTime = now;

    // Parse commands from output that indicate file changes
    const commandPatterns = [
      // touch, mkdir
      /(?:^|\n)\s*(?:touch|mkdir)\s+([\S]+)/g,
      // rm (with optional flags)
      /(?:^|\n)\s*rm\s+(?:-[\w]+\s+)*([\S]+)/g,
      // cp src dest
      /(?:^|\n)\s*cp\s+([\S]+)\s+([\S]+)/g,
      // mv src dest
      /(?:^|\n)\s*mv\s+([\S]+)\s+([\S]+)/g,
      // echo > file, printf > file, cat > file
      /(?:^|\n)\s*(?:echo|printf|cat)\s+.*?>\s*([\S]+)/g,
      // tee
      /(?:^|\n)\s*tee\s+([\S]+)/g,
      // Here-document: cat <<EOF > file ... EOF
      /(?:^|\n)\s*cat\s+<<\s*(\S+)\s*>\s*([\S]+)/g,
      // tee here-doc: tee <<EOF ... EOF
      /(?:^|\n)\s*tee\s+<<\s*(\S+)\s*([\S]+)/g,
    ];

    // Detect vim/nano saves from terminal output
    const editorSavePatterns = [
      // Vim save messages
      /"([^"]+\.\w+)".*\[New File\]/g,
      /"([^"]+\.\w+)".*saved/g,
      /\[ewFile\] ([^\s]+)/g,
      /Wrote:\s+([^\s]+)/g,
      // Nano save prompts (when user presses Ctrl+O)
      /File Name to Write:\s*([^\n]+)/g,
      /Saved as:\s*([^\n]+)/g,
      // VS Code / IDE file creation
      /Created:\s+([^.\n]+\.\w+)/g,
      /File created:\s+([^.\n]+\.\w+)/g,
      // Git operations that create/modify files
      /created file:\s+([^.\n]+\.\w+)/g,
      /new file:\s+([^.\n]+\.\w+)/g,
    ];

    const detectedPaths = new Set<string>();
    
    for (const pattern of commandPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        // Get last group (destination path for cp/mv)
        const path = match[match.length - 1]
          .replace(/^\~\//, workspaceRoot + '/')
          .replace(/^\.\.\//, '');
        // Skip if it looks like a flag or flag-like
        if (!path.startsWith('-') && path.length > 1 && !path.includes('*')) {
          detectedPaths.add(path);
        }
      }
    }

    // Check for deletions (rm command)
    const deletePattern = /(?:^|\n)\s*rm\s+(?:-[\w]+\s+)*([\S]+)/g;
    let delMatch;
    while ((delMatch = deletePattern.exec(output)) !== null) {
      const path = delMatch[1]
        .replace(/^\~\//, workspaceRoot + '/')
        .replace(/^\.\.\//, '');
      if (!path.startsWith('-') && path.length > 1 && !path.includes('*')) {
        if (knownFiles.has(path)) {
          knownFiles.delete(path);
          if (fileChangeCallback) {
            fileChangeCallback(path, 'delete');
          }
          emitFilesystemUpdated({
            path,
            paths: [path],
            type: 'delete',
            source: 'desktop-pty-delete',
            sessionId: 'desktop-user',
            workspaceVersion: Date.now(),
          });
        }
      }
    }

    // Report new/modified files and sync content to VFS (debounced)
    for (const path of detectedPaths) {
      const changeType = !knownFiles.has(path) ? 'create' : 'update';
      
      // Queue file sync with debouncing to avoid excessive reads
      queueFileSync(path, changeType, workspaceRoot);

      if (!knownFiles.has(path)) {
        knownFiles.add(path);
        if (fileChangeCallback) {
          fileChangeCallback(path, 'create');
        }
        emitFilesystemUpdated({
          path,
          paths: [path],
          type: 'create',
          source: 'desktop-pty-create',
          sessionId: 'desktop-user',
          workspaceVersion: Date.now(),
        });
      } else {
        if (fileChangeCallback) {
          fileChangeCallback(path, 'update');
        }
        emitFilesystemUpdated({
          path,
          paths: [path],
          type: 'update',
          source: 'desktop-pty-update',
          sessionId: 'desktop-user',
          workspaceVersion: Date.now(),
        });
      }
    }

    // Check for vim/nano/IDE save patterns and sync content
    for (const pattern of editorSavePatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const path = match[1]
          .replace(/^~\//, workspaceRoot + '/')
          .replace(/^\.\.\//, '');
        // Skip if it looks like a flag or URL
        if (!path.startsWith('-') && path.length > 1 && 
            !path.startsWith('http') && !path.includes('://')) {
          // Queue file sync with debouncing for editor saves
          const changeType = !knownFiles.has(path) ? 'create' : 'update';
          queueFileSync(path, changeType, workspaceRoot);

          if (!knownFiles.has(path)) {
            knownFiles.add(path);
            if (fileChangeCallback) {
              fileChangeCallback(path, 'create');
            }
            emitFilesystemUpdated({
              path,
              paths: [path],
              type: 'create',
              source: 'desktop-pty-editor-create',
              sessionId: 'desktop-user',
              workspaceVersion: Date.now(),
            });
          } else {
            if (fileChangeCallback) {
              fileChangeCallback(path, 'update');
            }
            emitFilesystemUpdated({
              path,
              paths: [path],
              type: 'update',
              source: 'desktop-pty-editor-update',
              sessionId: 'desktop-user',
              workspaceVersion: Date.now(),
            });
          }
        }
      }
    }

    // Detect IDE/tool file watcher events (e.g., VS Code, file watchers)
    const ideWatcherPatterns = [
      // VS Code file watcher
      /\[\w+\]"([^"]+\.\w+)"\s+created/g,
      /\[fs\]\s+createFile\s+([^.\n]+\.\w+)/g,
      // Node/npm file creation
      /created\s+([^.\n]+\.\w+)\s+in\s+\d+ms/g,
      // File watcher events
      /(?:added|created|modified):\s+([^.\n]+\.\w+)/gi,
    ];

    for (const pattern of ideWatcherPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const path = match[1]
          .replace(/^~\//, workspaceRoot + '/')
          .replace(/^\.\.\//, '');
        if (!path.startsWith('-') && path.length > 1 && !path.includes('node_modules')) {
          // Queue file sync with debouncing for IDE watcher events
          const changeType = !knownFiles.has(path) ? 'create' : 'update';
          queueFileSync(path, changeType, workspaceRoot);

          if (!knownFiles.has(path)) {
            knownFiles.add(path);
            if (fileChangeCallback) {
              fileChangeCallback(path, 'create');
            }
            emitFilesystemUpdated({
              path,
              paths: [path],
              type: 'create',
              source: 'desktop-pty-ide-create',
              sessionId: 'desktop-user',
              workspaceVersion: Date.now(),
            });
          }
        }
      }
    }
  };

  // Listen for PTY output events from Rust
  unlistenOutput = await listen<PtyOutputEvent>('pty-output', (event) => {
    if (event.payload.session_id === sessionId) {
      if (outputCallback) {
        outputCallback(event.payload.data);
      }
      // Detect file changes from output
      detectFileChanges(event.payload.data);
    }
  });

  unlistenClose = await listen<{ session_id: string }>('pty-closed', (event) => {
    if (event.payload.session_id === sessionId) {
      logger.info('PTY session closed', { sessionId });
      if (closeCallback) {
        closeCallback();
      }
    }
  });

  logger.info('Desktop PTY session created', { sessionId });

  return {
    sessionId,
    isConnected: true,

    writeInput: async (data: string) => {
      if (!isDesktopPtyAvailable()) return;
      const result = await writePtyInput(sessionId, data);
      if (!result.success) {
        logger.error('Failed to write PTY input', { error: result.error });
      }
    },

    resize: async (cols: number, rows: number) => {
      if (!isDesktopPtyAvailable()) return;
      const result = await resizePty(sessionId, cols, rows);
      if (!result.success) {
        logger.error('Failed to resize PTY', { error: result.error });
      }
    },

    close: async () => {
      // Clean up listeners
      unlistenOutput?.();
      unlistenClose?.();

      // Clear any pending debounced sync for this session
      if (syncTimeout) {
        clearTimeout(syncTimeout);
        syncTimeout = null;
      }

      if (isDesktopPtyAvailable()) {
        await closePtySession(sessionId);
      }
      logger.info('PTY session closed', { sessionId });
    },

    onOutput: (callback: (data: string) => void) => {
      outputCallback = callback;
    },

    onClose: (callback: () => void) => {
      closeCallback = callback;
    },

    onFileChange: (callback: (path: string, type: 'create' | 'update' | 'delete') => void) => {
      fileChangeCallback = callback;
    },
  };
}

/**
 * Desktop PTY Terminal Manager
 * Manages PTY sessions for multiple terminal instances
 */
class DesktopPtyManager {
  private sessions = new Map<string, DesktopPtyInstance>();
  private defaultCwd: string;

  constructor() {
    this.defaultCwd = getDefaultWorkspaceRoot() || '.';
  }

  /**
   * Create a new PTY session for a terminal
   */
  async createSession(terminalId: string, options: DesktopPtyOptions = {}): Promise<DesktopPtyInstance | null> {
    // Check if PTY is available
    if (!isDesktopPtyAvailable()) {
      logger.info('Desktop PTY not available, using simulated terminal');
      return null;
    }

    // Close existing session if any
    await this.closeSession(terminalId);

    const pty = await createDesktopPty({
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd || this.defaultCwd,
      shell: options.shell,
    });

    if (pty) {
      this.sessions.set(terminalId, pty);
      logger.info('Created PTY session for terminal', { terminalId, sessionId: pty.sessionId });
    }

    return pty;
  }

  /**
   * Get session for terminal
   */
  getSession(terminalId: string): DesktopPtyInstance | undefined {
    return this.sessions.get(terminalId);
  }

  /**
   * Check if terminal has PTY session
   */
  hasSession(terminalId: string): boolean {
    return this.sessions.has(terminalId);
  }

  /**
   * Close session for terminal
   */
  async closeSession(terminalId: string): Promise<void> {
    const session = this.sessions.get(terminalId);
    if (session) {
      await session.close();
      this.sessions.delete(terminalId);
      logger.info('Closed PTY session for terminal', { terminalId });
    }
  }

  /**
   * Close all sessions
   */
  async closeAll(): Promise<void> {
    for (const [terminalId, session] of this.sessions) {
      await session.close();
    }
    this.sessions.clear();
    logger.info('Closed all PTY sessions');
  }

  /**
   * Get default working directory
   */
  getDefaultCwd(): string {
    return this.defaultCwd;
  }

  /**
   * Set default working directory
   */
  setDefaultCwd(cwd: string): void {
    this.defaultCwd = cwd;
  }
}

// Singleton instance
export const desktopPtyManager = new DesktopPtyManager();

/**
 * Check if should use desktop PTY vs simulated terminal
 * Returns true if in desktop mode and PTY is available
 */
export function shouldUseDesktopPty(): boolean {
  return isDesktopPtyAvailable();
}
