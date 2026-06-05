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
 * VFS sync is handled by DesktopFileWatcher — a real filesystem watcher
 * (fs.watch with polling fallback) that detects actual file events instead
 * of parsing PTY stdout with regex patterns.
 */

import { 
  createPtySession, 
  writePtyInput, 
  resizePty, 
  closePtySession,
  isTauriAvailable,
  type PtyOutputEvent 
} from '@/lib/tauri/invoke-bridge';
import { listen, type UnlistenFn } from '@/lib/utils/tauri-api-stub';
import { isDesktopMode, getDefaultWorkspaceRoot } from '@bing/platform/env';
import { createLogger } from '@/lib/utils/logger';
import { emitFilesystemUpdated } from '@/lib/virtual-filesystem/sync/sync-events';
import { getDefaultWorkspaceRoot as getVfsWorkspaceRoot } from '@bing/platform/env';
import { invoke } from '@/lib/utils/tauri-api-stub';
import { startFileWatcher, type FileWatcherHandle, type FileChangeType } from '@/lib/terminal/desktop-file-watcher';

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

  // === Filesystem watcher: replaces regex-based PTY stdout parsing ===
  // Uses native fs.watch with polling fallback to detect real filesystem events
  // instead of guessing file changes from shell output patterns.
  const fileWatcher = startFileWatcher(
    workspaceRoot,
    'desktop-user',
    (filePath: string, type: FileChangeType) => {
      fileChangeCallback?.(filePath, type);
    }
  );

  // Listen for PTY output events from Rust (no more regex file detection)
  unlistenOutput = await listen<PtyOutputEvent>('pty-output', (event) => {
    if (event.payload.session_id === sessionId) {
      outputCallback?.(event.payload.data);
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
      // Stop the filesystem watcher
      await fileWatcher.stop();

      // Clean up listeners
      unlistenOutput?.();
      unlistenClose?.();

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
