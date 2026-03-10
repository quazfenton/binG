/**
 * Enhanced PTY Terminal Manager
 * 
 * Provides real WebSocket-based PTY terminal connections with:
 * - Full PTY support via WebSocket to backend
 * - Local command-mode fallback when sandbox unavailable
 * - Smooth mode transitions (local ↔ PTY)
 * - Phase 1 integration (user sessions, auto-snapshot)
 * 
 * This is an ADDITIVE module - works alongside existing TerminalPanel.
 * 
 * @see components/terminal/TerminalPanel.tsx - Legacy terminal UI
 * @see lib/sandbox/phase1-integration.ts - Phase 1 features
 * @see lib/sandbox/terminal-manager.ts - Backend terminal management
 * 
 * @example
 * ```typescript
 * const ptyTerminal = createPTYTerminal('terminal-container');
 * 
 * // Start in local mode (fallback)
 * await ptyTerminal.startLocal();
 * 
 * // Upgrade to full PTY when sandbox available
 * await ptyTerminal.connectToSandbox({
 *   userId: 'user_123',
 *   autoSnapshot: true,
 * });
 * 
 * // Disconnect with auto-snapshot
 * await ptyTerminal.disconnect({ createSnapshot: true });
 * ```
 */

import { createLogger } from '../utils/logger';
import { userTerminalSessionManager, type UserTerminalSession } from './user-terminal-sessions';
import { autoSnapshotService } from './auto-snapshot-service';
import type { SandboxProviderType } from './providers';
import { LocalCommandExecutor, type LocalFilesystemEntry } from './local-filesystem-executor';

const logger = createLogger('PTYTerminal');

/**
 * Terminal mode
 */
export type PTYMode = 'local' | 'connecting' | 'pty' | 'disconnected';

/**
 * PTY terminal configuration
 */
export interface PTYTerminalConfig {
  /** Container element ID or ref */
  container: string | HTMLElement;
  
  /** Terminal columns */
  cols?: number;
  
  /** Terminal rows */
  rows?: number;
  
  /** Font size */
  fontSize?: number;
  
  /** Theme */
  theme?: 'dark' | 'light';
  
  /** User ID for session isolation */
  userId?: string;
  
  /** Preferred sandbox provider */
  providerType?: SandboxProviderType;
  
  /** Enable auto-snapshot */
  autoSnapshot?: boolean;
  
  /** WebSocket URL for PTY */
  wsUrl?: string;
}

/**
 * PTY connection options
 */
export interface PTYConnectOptions {
  /** User ID (required for isolation) */
  userId: string;
  
  /** Sandbox provider type */
  providerType?: SandboxProviderType;
  
  /** Enable auto-snapshot on disconnect */
  autoSnapshot?: boolean;
  
  /** Restore from existing snapshot */
  restoreFromSnapshot?: boolean;
  
  /** Working directory */
  cwd?: string;
}

/**
 * PTY disconnect options
 */
export interface PTYDisconnectOptions {
  /** Create snapshot before disconnect */
  createSnapshot?: boolean;
  
  /** Reason for disconnect */
  reason?: 'user_request' | 'idle_timeout' | 'error';
}

/**
 * PTY Terminal Instance
 */
export interface PTYTerminalInstance {
  /** Terminal ID */
  id: string;
  
  /** Current mode */
  mode: PTYMode;
  
  /** xterm.js terminal */
  terminal: any;
  
  /** Fit addon */
  fitAddon: any;
  
  /** WebSocket connection */
  websocket: WebSocket | null;
  
  /** User session */
  session?: UserTerminalSession;
  
  /** Connected to sandbox */
  isConnected: boolean;
}

/**
 * Enhanced PTY Terminal Manager
 */
export class EnhancedPTYTerminalManager {
  /** Active terminals */
  private terminals = new Map<string, PTYTerminalInstance>();

  /** Local command executors */
  private localExecutors = new Map<string, LocalCommandExecutor>();

  /** xterm.js module (lazy loaded) */
  private xtermModule: any = null;
  
  /** Fit addon module (lazy loaded) */
  private fitAddonModule: any = null;
  
  /**
   * Create PTY terminal
   */
  async createPTYTerminal(config: PTYTerminalConfig): Promise<PTYTerminalInstance> {
    // Lazy load xterm.js
    if (!this.xtermModule) {
      try {
        this.xtermModule = await import('xterm');
        this.fitAddonModule = await import('xterm-addon-fit');
      } catch (error: any) {
        logger.error('Failed to load xterm.js:', error?.message);
        throw new Error('xterm.js not available. Install with: npm install xterm xterm-addon-fit');
      }
    }
    
    const terminalId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Get container element
    const container = typeof config.container === 'string'
      ? document.getElementById(config.container)
      : config.container;
    
    if (!container) {
      throw new Error('Terminal container not found');
    }
    
    // Create xterm.js terminal
    const terminal = new this.xtermModule.Terminal({
      cols: config.cols || 120,
      rows: config.rows || 30,
      fontSize: config.fontSize || 14,
      theme: config.theme === 'light' ? this.getLightTheme() : this.getDarkTheme(),
      cursorBlink: true,
      scrollback: 10000,
    });
    
    // Create fit addon
    const fitAddon = new this.fitAddonModule.FitAddon();
    terminal.loadAddon(fitAddon);
    
    // Open terminal in container
    terminal.open(container);
    fitAddon.fit();
    
    // Create instance
    const instance: PTYTerminalInstance = {
      id: terminalId,
      mode: 'disconnected',
      terminal,
      fitAddon,
      websocket: null,
      isConnected: false,
    };
    
    this.terminals.set(terminalId, instance);
    
    // Create local command executor with write callbacks
    const executor = new LocalCommandExecutor({
      terminalId,
      onWrite: (text) => instance.terminal.write(text),
      onWriteLine: (text) => instance.terminal.write(text + '\r\n'),
      onWriteError: (text) => instance.terminal.write(`\x1b[31m${text}\x1b[0m\r\n`),
      syncToVFS: async (path, content) => {
        // Sync to VFS when files are created/modified
        logger.debug(`Syncing ${path} to VFS`)
        // VFS sync would be called here
      },
    })
    this.localExecutors.set(terminalId, executor)

    // Start in local mode
    await this.startLocal(terminalId)
    
    logger.info(`Created PTY terminal ${terminalId} in local mode`);
    
    return instance;
  }
  
  /**
   * Start local command-mode (fallback)
   */
  async startLocal(terminalId: string): Promise<void> {
    const instance = this.terminals.get(terminalId);
    if (!instance) {
      throw new Error(`Terminal ${terminalId} not found`);
    }

    instance.mode = 'local';

    const executor = this.localExecutors.get(terminalId)!;
    let inputBuffer = '';

    // Write prompt
    instance.terminal.writeln('\x1b[1;32m● Local Terminal\x1b[0m');
    instance.terminal.writeln('\x1b[90mType "help" for available commands. Type "connect" for full sandbox.\x1b[0m');
    instance.terminal.writeln('');
    this.writePrompt(instance.terminal, executor.getCwd());

    // Handle input
    instance.terminal.onData((data: string) => {
      if (data === '\r') {
        // Enter - execute command
        instance.terminal.write('\r\n');
        const command = inputBuffer;
        inputBuffer = '';

        // Execute command
        executor.execute(command).then(() => {
          this.writePrompt(instance.terminal, executor.getCwd());
        });
      } else if (data === '\u007f') {
        // Backspace
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          instance.terminal.write('\b \b');
        }
      } else if (data >= ' ') {
        // Regular character
        inputBuffer += data;
        instance.terminal.write(data);
      }
    });

    logger.debug(`Terminal ${terminalId} started in local mode`);
  }
  
  /**
   * Connect to sandbox (upgrade to full PTY)
   */
  async connectToSandbox(terminalId: string, options: PTYConnectOptions): Promise<{ success: boolean; error?: string }> {
    const instance = this.terminals.get(terminalId);
    if (!instance) {
      return { success: false, error: 'Terminal not found' };
    }
    
    try {
      instance.mode = 'connecting';
      instance.terminal.writeln('');
      instance.terminal.writeln('\x1b[33mConnecting to sandbox...\x1b[0m');
      
      // Create user session with Phase 1
      const session = await userTerminalSessionManager.createSession({
        userId: options.userId,
        providerType: options.providerType,
        autoSnapshot: options.autoSnapshot ?? false,
        restoreFromSnapshot: options.restoreFromSnapshot ?? false,
      });
      
      instance.session = session;
      
      // Enable auto-snapshot if requested
      if (options.autoSnapshot) {
        await autoSnapshotService.enableForSession(session.sessionId, {
          onDisconnect: true,
          onIdleTimeout: true,
        });
      }
      
      // Connect to WebSocket for PTY
      const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 
                    `ws://localhost:${process.env.NEXT_PUBLIC_WEBSOCKET_PORT || 8080}`;
      
      const ws = new WebSocket(`${wsUrl}/pty?sessionId=${session.sessionId}&sandboxId=${session.sandboxId}`);
      
      ws.onopen = () => {
        logger.info(`PTY WebSocket connected for terminal ${terminalId}`);
        
        instance.websocket = ws;
        instance.mode = 'pty';
        instance.isConnected = true;
        
        instance.terminal.writeln('\x1b[1;32m● Connected to Sandbox\x1b[0m');
        instance.terminal.writeln(`\x1b[90m  Session: ${session.sessionId.slice(0, 12)}...\x1b[0m`);
        instance.terminal.writeln(`\x1b[90m  Provider: ${session.providerType}\x1b[0m`);
        instance.terminal.writeln('');
        
        // Handle PTY output
        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.type === 'output') {
            instance.terminal.write(message.data);
          }
        };
        
        // Handle PTY input
        instance.terminal.onData((data: string) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'input',
              data,
            }));
          }
        });
        
        // Handle resize
        instance.fitAddon.onResize(({ cols, rows }) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'resize',
              cols,
              rows,
            }));
          }
        });
      };
      
      ws.onerror = (error) => {
        logger.error('PTY WebSocket error:', error);
        instance.terminal.writeln('\x1b[31mConnection failed. Falling back to local mode.\x1b[0m');
        instance.mode = 'local';
      };
      
      ws.onclose = () => {
        logger.info('PTY WebSocket closed');
        instance.websocket = null;
        instance.isConnected = false;
        instance.mode = 'disconnected';
      };
      
      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 30000);
        
        ws.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Connection failed'));
        };
      });
      
      logger.info(`Terminal ${terminalId} connected to sandbox ${session.sandboxId}`);
      
      return { success: true };
    } catch (error: any) {
      logger.error('Failed to connect to sandbox:', error);
      instance.terminal.writeln(`\x1b[31mError: ${error?.message || 'Connection failed'}\x1b[0m`);
      instance.terminal.writeln('\x1b[33mFalling back to local mode...\x1b[0m');
      instance.mode = 'local';
      
      return { success: false, error: error?.message };
    }
  }
  
  /**
   * Disconnect from sandbox
   */
  async disconnect(terminalId: string, options: PTYDisconnectOptions = {}): Promise<{ success: boolean; snapshotId?: string }> {
    const instance = this.terminals.get(terminalId);
    if (!instance) {
      return { success: false };
    }
    
    // Close WebSocket
    if (instance.websocket) {
      instance.websocket.close();
      instance.websocket = null;
    }
    
    // Create snapshot if requested
    let snapshotId: string | undefined;
    if (options.createSnapshot && instance.session) {
      try {
        const result = await userTerminalSessionManager.disconnectSession(instance.session.sessionId, {
          createSnapshot: true,
          reason: options.reason || 'user_request',
        });
        
        snapshotId = result.snapshotId;
        
        if (snapshotId) {
          instance.terminal.writeln('');
          instance.terminal.writeln('\x1b[1;32m✓ Session snapshot created\x1b[0m');
          instance.terminal.writeln(`\x1b[90m  Snapshot ID: ${snapshotId.slice(0, 12)}...\x1b[0m`);
        }
      } catch (error: any) {
        logger.error('Failed to create snapshot:', error);
        instance.terminal.writeln(`\x1b[31m✗ Snapshot failed: ${error?.message}\x1b[0m`);
      }
    }
    
    // Update state
    instance.isConnected = false;
    instance.mode = 'disconnected';
    instance.session = undefined;
    
    instance.terminal.writeln('');
    instance.terminal.writeln('\x1b[33mDisconnected from sandbox\x1b[0m');
    instance.terminal.writeln('\x1b[90mType "connect" to reconnect.\x1b[0m');
    instance.terminal.writeln('');
    
    // Return to local mode
    this.startLocal(terminalId);
    
    return { success: true, snapshotId };
  }
  
  /**
   * Get terminal instance
   */
  getTerminal(terminalId: string): PTYTerminalInstance | undefined {
    return this.terminals.get(terminalId);
  }
  
  /**
   * Get all terminals
   */
  getAllTerminals(): PTYTerminalInstance[] {
    return Array.from(this.terminals.values());
  }
  
  /**
   * Focus terminal
   */
  focus(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (instance) {
      instance.terminal.focus();
    }
  }
  
  /**
   * Clear terminal
   */
  clear(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (instance) {
      instance.terminal.clear();
    }
  }
  
  /**
   * Resize terminal
   */
  resize(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (instance) {
      instance.fitAddon.fit();
    }
  }
  
  /**
   * Dispose terminal
   */
  dispose(terminalId: string): void {
    const instance = this.terminals.get(terminalId);
    if (instance) {
      // Disconnect first
      this.disconnect(terminalId);
      
      // Dispose xterm
      instance.terminal.dispose();
      
      // Remove from maps
      this.terminals.delete(terminalId);
      this.localExecutors.delete(terminalId);
      
      logger.info(`Terminal ${terminalId} disposed`);
    }
  }
  
  /**
   * Write prompt
   */
  private writePrompt(terminal: any, cwd: string): void {
    const prompt = `\x1b[1;32m➜\x1b[0m \x1b[36m${cwd}\x1b[0m $ `;
    terminal.write(prompt);
  }
  
  /**
   * Get dark theme
   */
  private getDarkTheme() {
    return {
      background: '#1e1e1e',
      foreground: '#ffffff',
      cursor: '#ffffff',
      cursorAccent: '#1e1e1e',
      selection: 'rgba(255, 255, 255, 0.3)',
      black: '#1e1e1e',
      red: '#f44336',
      green: '#4caf50',
      yellow: '#ffeb3b',
      blue: '#2196f3',
      magenta: '#9c27b0',
      cyan: '#00bcd4',
      white: '#ffffff',
      brightBlack: '#666666',
      brightRed: '#ff5252',
      brightGreen: '#69f0ae',
      brightYellow: '#ffff00',
      brightBlue: '#448aff',
      brightMagenta: '#e040fb',
      brightCyan: '#18ffff',
      brightWhite: '#ffffff',
    };
  }
  
  /**
   * Get light theme
   */
  private getLightTheme() {
    return {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#333333',
      cursorAccent: '#ffffff',
      selection: 'rgba(0, 0, 0, 0.3)',
      black: '#333333',
      red: '#f44336',
      green: '#4caf50',
      yellow: '#ffeb3b',
      blue: '#2196f3',
      magenta: '#9c27b0',
      cyan: '#00bcd4',
      white: '#ffffff',
      brightBlack: '#666666',
      brightRed: '#ff5252',
      brightGreen: '#69f0ae',
      brightYellow: '#ffff00',
      brightBlue: '#448aff',
      brightMagenta: '#e040fb',
      brightCyan: '#18ffff',
      brightWhite: '#ffffff',
    };
  }
}

/**
 * Singleton instance
 */
export const enhancedPTYTerminalManager = new EnhancedPTYTerminalManager();

/**
 * Convenience function: Create PTY terminal
 */
export async function createPTYTerminal(config: PTYTerminalConfig): Promise<PTYTerminalInstance> {
  return enhancedPTYTerminalManager.createPTYTerminal(config);
}

/**
 * Convenience function: Get terminal by ID
 */
export function getPTYTerminal(terminalId: string): PTYTerminalInstance | undefined {
  return enhancedPTYTerminalManager.getTerminal(terminalId);
}

/**
 * Convenience function: Connect to sandbox
 */
export async function connectPTYToSandbox(
  terminalId: string,
  options: PTYConnectOptions
): Promise<{ success: boolean; error?: string }> {
  return enhancedPTYTerminalManager.connectToSandbox(terminalId, options);
}

/**
 * Convenience function: Disconnect from sandbox
 */
export async function disconnectPTY(
  terminalId: string,
  options?: PTYDisconnectOptions
): Promise<{ success: boolean; snapshotId?: string }> {
  return enhancedPTYTerminalManager.disconnect(terminalId, options);
}
