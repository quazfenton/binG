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
  screenResolution?: { width: number; height: number };
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
      const desktop = await Desktop.create({
        template: config.template || 'desktop',
      });

      return {
        screen: {
          capture: async () => {
            const img = await desktop.screen.capture();
            return img.toBuffer();
          },
          resolution: async () => {
            return { width: 1920, height: 1080 };
          },
        },
        mouse: {
          click: async ({ x, y, button = 'left' }) => desktop.mouse.click({ x, y, button }),
          move: async ({ x, y }) => desktop.mouse.move({ x, y }),
          drag: async ({ from, to }) => desktop.mouse.drag({ from, to }),
        },
        keyboard: {
          type: async (text) => desktop.keyboard.type(text),
          press: async (key) => desktop.keyboard.press(key),
          hotkey: async (keys) => desktop.keyboard.hotkey(keys),
        },
        clipboard: {
          read: async () => desktop.clipboard.read(),
          write: async (text) => desktop.clipboard.write(text),
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

  async destroySession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
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
        const screenshot = await desktop.screen.capture();
        return {
          success: true,
          output: `Screenshot captured (${screenshot.length} bytes)`,
          binary: screenshot,
        };
      }

      case 'click': {
        const clickParams = {
          x: Number(params.x) || 0,
          y: Number(params.y) || 0,
          button: params.button || 'left',
        };
        await desktop.mouse.click(clickParams);
        return { 
          success: true, 
          output: `Clicked at (${clickParams.x}, ${clickParams.y}) with ${clickParams.button} button`,
        };
      }

      case 'type':
        await desktop.keyboard.type(params.text || '');
        return { success: true, output: `Typed: ${(params.text || '').substring(0, 50)}${(params.text || '').length > 50 ? '...' : ''}` };

      case 'keypress':
        await desktop.keyboard.press(params.key || 'Enter');
        return { success: true, output: `Pressed: ${params.key || 'Enter'}` };

      case 'move': {
        const moveParams = {
          x: Number(params.x) || 0,
          y: Number(params.y) || 0,
        };
        await desktop.mouse.move(moveParams);
        return { success: true, output: `Moved mouse to (${moveParams.x}, ${moveParams.y})` };
      }

      case 'drag': {
        const dragParams = {
          from: { x: Number(params.fromX) || 0, y: Number(params.fromY) || 0 },
          to: { x: Number(params.toX) || 0, y: Number(params.toY) || 0 },
        };
        await desktop.mouse.drag(dragParams);
        return { 
          success: true, 
          output: `Dragged from (${dragParams.from.x}, ${dragParams.from.y}) to (${dragParams.to.x}, ${dragParams.to.y})`,
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
