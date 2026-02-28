/**
 * E2B Desktop Provider
 * 
 * Enables AI agents to interact with graphical desktop environments
 * Use cases:
 * - Claude Computer Use
 * - GUI automation
 * - Visual testing
 * - Browser automation
 * 
 * Documentation: docs/sdk/e2b-llms-full.txt
 * 
 * Note: Requires @e2b/desktop package. Install with: npm install @e2b/desktop
 */

import type { SandboxHandle } from './sandbox-provider';
import type { ToolResult } from '../types';

// Dynamic import for E2B Desktop SDK (optional package)
let DesktopSDK: any = null;

async function ensureDesktopSDK(): Promise<any> {
  if (DesktopSDK) return DesktopSDK;
  
  try {
    // Try to import from @e2b/desktop
    // @ts-ignore - Desktop export may not exist in all versions
    const module = await import('@e2b/desktop');
    // Try different export patterns
    // @ts-ignore - Try Desktop export
    DesktopSDK = module.Desktop || module.default || (module as any).Desktop;
    if (!DesktopSDK) {
      throw new Error('Desktop export not found');
    }
    return DesktopSDK;
  } catch (error: any) {
    console.warn('[E2B Desktop] @e2b/desktop not available. Desktop features disabled.');
    return null;
  }
}

export interface DesktopHandle {
  // High-level agentic API (Recommended)
  screenshot: () => Promise<Buffer>;
  leftClick: (x: number, y: number) => Promise<void>;
  rightClick: (x: number, y: number) => Promise<void>;
  middleClick: (x: number, y: number) => Promise<void>;
  doubleClick: (x: number, y: number) => Promise<void>;
  moveMouse: (x: number, y: number) => Promise<void>;
  drag: (from: [number, number], to: [number, number]) => Promise<void>;
  scroll: (direction: 'up' | 'down' | 'left' | 'right', ticks: number) => Promise<void>;
  write: (text: string) => Promise<void>;
  press: (key: string) => Promise<void>;
  hotkey: (keys: string[]) => Promise<void>;
  clipboardRead: () => Promise<string>;
  clipboardWrite: (text: string) => Promise<void>;
  /** Cleanup method to properly close desktop session */
  kill: () => Promise<void>;

  // Legacy nested API (Deprecated)
  screen: {
    capture: () => Promise<Buffer>;
    resolution: () => Promise<{ width: number; height: number }>;
  };
  mouse: {
    click: (opts: { x: number; y: number; button?: 'left' | 'right' | 'middle' }) => Promise<void>;
    move: (opts: { x: number; y: number }) => Promise<void>;
    drag: (opts: { from: { x: number; y: number }; to: { x: number; y: number } }) => Promise<void>;
  };
  keyboard: {
    type: (text: string) => Promise<void>;
    press: (key: string) => Promise<void>;
    hotkey: (keys: string[]) => Promise<void>;
  };
  clipboard: {
    read: () => Promise<string>;
    write: (text: string) => Promise<void>;
  };
}

export interface E2BDesktopConfig {
  template?: string;
  resolution?: [number, number]; // Matches E2B SDK expectations
  dpi?: number;
  timeout?: number;
}

export class E2BDesktopProvider {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.E2B_API_KEY;
  }

  async createDesktop(config: E2BDesktopConfig = {}): Promise<DesktopHandle | null> {
    if (!this.apiKey) {
      console.error('[E2B Desktop] E2B_API_KEY not configured');
      return null;
    }

    const Desktop = await ensureDesktopSDK();
    if (!Desktop) {
      console.error('[E2B Desktop] SDK not available. Install @e2b/desktop package.');
      return null;
    }

    try {
      // Per E2B Computer Use docs: Sandbox.create({ resolution: [1024, 768] })
      const desktop = await Desktop.create({
        template: config.template || 'desktop',
        resolution: config.resolution || [1920, 1080],
        dpi: config.dpi || 96,
      });

      console.log(`[E2B Desktop] Created desktop with resolution ${config.resolution?.[0] || 1920}x${config.resolution?.[1] || 1080}`);

      return {
        // High-level implementation
        screenshot: async () => desktop.screenshot(),
        leftClick: async (x, y) => desktop.leftClick(x, y),
        rightClick: async (x, y) => desktop.rightClick(x, y),
        middleClick: async (x, y) => desktop.middleClick(x, y),
        doubleClick: async (x, y) => desktop.doubleClick(x, y),
        moveMouse: async (x, y) => desktop.moveMouse(x, y),
        drag: async (from, to) => desktop.drag(from, to),
        scroll: async (dir, ticks) => desktop.scroll(dir, ticks),
        write: async (text) => desktop.write(text),
        press: async (key) => desktop.press(key),
        hotkey: async (keys) => desktop.hotkey(keys),
        clipboardRead: async () => desktop.clipboardRead(),
        clipboardWrite: async (text) => desktop.clipboardWrite(text),
        /** Properly cleanup desktop session to prevent resource leaks */
        kill: async () => {
          try {
            await desktop.kill();
          } catch (error: any) {
            console.error('[E2B Desktop] Kill error:', error.message);
          }
        },

        // Legacy implementation
        screen: {
          capture: async () => {
            const img = await desktop.screenshot();
            // Ensure we return Buffer for consistent binary handling
            return Buffer.isBuffer(img) ? img : Buffer.from(img);
          },
          resolution: async () => {
            const [width, height] = config.resolution || [1920, 1080];
            return { width, height };
          },
        },
        mouse: {
          click: async ({ x, y, button = 'left' }) => {
            if (button === 'left') await desktop.leftClick(x, y);
            else if (button === 'right') await desktop.rightClick(x, y);
            else await desktop.middleClick(x, y);
          },
          move: async ({ x, y }) => desktop.moveMouse(x, y),
          drag: async ({ from, to }) => desktop.drag([from.x, from.y], [to.x, to.y]),
        },
        keyboard: {
          type: async (text) => desktop.write(text),
          press: async (key) => desktop.press(key),
          hotkey: async (keys) => desktop.hotkey(keys),
        },
        clipboard: {
          read: async () => desktop.clipboardRead(),
          write: async (text) => desktop.clipboardWrite(text),
        },
      };
    } catch (error: any) {
      console.error('[E2B Desktop] Failed to create desktop:', error.message);
      return null;
    }
  }
}

/**
 * Desktop session manager for tracking active desktops
 */
export const desktopSessionManager = {
  sessions: new Map<string, DesktopHandle>(),

  async createSession(sessionId: string, config?: E2BDesktopConfig): Promise<DesktopHandle | null> {
    const provider = new E2BDesktopProvider();
    const desktop = await provider.createDesktop(config);
    if (desktop) {
      this.sessions.set(sessionId, desktop);
    }
    return desktop;
  },

  getSession(sessionId: string): DesktopHandle | undefined {
    return this.sessions.get(sessionId);
  },

  /** Properly destroy session and cleanup resources */
  async destroySession(sessionId: string): Promise<void> {
    const desktop = this.sessions.get(sessionId);
    if (desktop) {
      try {
        // Call kill to properly cleanup desktop session
        await desktop.kill();
      } catch (error: any) {
        console.error(`[E2B Desktop] Error destroying session ${sessionId}:`, error.message);
      } finally {
        this.sessions.delete(sessionId);
      }
    }
  },

  /** Destroy all active sessions */
  async destroyAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.destroySession(id)));
  },

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  },
};

/**
 * Execute desktop command via API route helper
 */
export async function executeDesktopCommand(
  sessionId: string,
  action: 'screenshot' | 'click' | 'type' | 'keypress' | 'move' | 'drag',
  params: Record<string, any>
): Promise<ToolResult> {
  const desktop = desktopSessionManager.getSession(sessionId);

  if (!desktop) {
    return {
      success: false,
      output: `Desktop session not found: ${sessionId}`,
    };
  }

  try {
    switch (action) {
      case 'screenshot': {
        const screenshot = await desktop.screenshot();
        return {
          success: true,
          output: `Screenshot captured (${screenshot.length} bytes)`,
          binary: screenshot,
        };
      }

      case 'click': {
        const x = Number(params.x) || 0;
        const y = Number(params.y) || 0;
        const button = params.button || 'left';
        
        if (button === 'right') await desktop.rightClick(x, y);
        else if (button === 'middle') await desktop.middleClick(x, y);
        else await desktop.leftClick(x, y);

        return { 
          success: true, 
          output: `Clicked at (${x}, ${y}) with ${button} button`,
        };
      }

      case 'type':
        await desktop.write(params.text || '');
        return { success: true, output: `Typed: ${(params.text || '').substring(0, 50)}${(params.text || '').length > 50 ? '...' : ''}` };

      case 'keypress':
        await desktop.press(params.key || 'Enter');
        return { success: true, output: `Pressed: ${params.key || 'Enter'}` };

      case 'move': {
        const x = Number(params.x) || 0;
        const y = Number(params.y) || 0;
        await desktop.moveMouse(x, y);
        return { success: true, output: `Moved mouse to (${x}, ${y})` };
      }

      case 'drag': {
        const fromX = Number(params.fromX) || 0;
        const fromY = Number(params.fromY) || 0;
        const toX = Number(params.toX) || 0;
        const toY = Number(params.toY) || 0;
        await desktop.drag([fromX, fromY], [toX, toY]);
        return { 
          success: true, 
          output: `Dragged from (${fromX}, ${fromY}) to (${toX}, ${toY})`,
        };
      }

      default:
        return { success: false, output: `Unknown action: ${action}` };
    }
  } catch (error: any) {
    return {
      success: false,
      output: `Desktop command failed: ${error.message}`,
    };
  }
}

/**
 * Get desktop session info
 */
export function getDesktopSessionInfo(sessionId: string): {
  exists: boolean;
  active: boolean;
} {
  const desktop = desktopSessionManager.getSession(sessionId);
  
  return {
    exists: desktopSessionManager.sessions.has(sessionId),
    active: !!desktop,
  };
}

/**
 * List all active desktop sessions
 */
export function listDesktopSessions(): string[] {
  return desktopSessionManager.getActiveSessions();
}
