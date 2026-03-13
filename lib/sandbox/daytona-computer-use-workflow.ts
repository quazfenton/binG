/**
 * Phase 2: Daytona Computer Use Workflow Automation
 * 
 * Advanced computer use automation with:
 * - Screen capture (region, full-screen)
 * - Screen recording (start/stop/download)
 * - Mouse/keyboard simulation
 * - Visual element detection
 * - Desktop workflow automation
 * 
 * @see https://www.daytona.io/docs/computer-use
 * 
 * @example
 * ```typescript
 * import { daytonaComputerUse } from '@/lib/sandbox/phase2-integration';
 * 
 * // Take full-screen screenshot
 * const screenshot = await daytonaComputerUse.takeScreenshot(sandboxId);
 * 
 * // Take region screenshot
 * const region = await daytonaComputerUse.takeRegionScreenshot(sandboxId, {
 *   x: 100, y: 100, width: 800, height: 600,
 * });
 * 
 * // Start recording
 * const recording = await daytonaComputerUse.startRecording(sandboxId);
 * 
 * // ... perform actions ...
 * 
 * // Stop and get video
 * const video = await daytonaComputerUse.stopRecording(sandboxId, recording.recordingId);
 * 
 * // Mouse/keyboard automation
 * await daytonaComputerUse.click(sandboxId, { x: 500, y: 300 });
 * await daytonaComputerUse.type(sandboxId, 'Hello World');
 * ```
 */

import { getSandboxProvider } from './providers';
import { createLogger } from '../utils/logger';

const logger = createLogger('Phase2:DaytonaComputerUse');

/**
 * Screen region coordinates
 */
export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Mouse position
 */
export interface MousePosition {
  x: number;
  y: number;
}

/**
 * Keyboard input options
 */
export interface KeyboardInput {
  text: string;
  delay?: number; // ms between keystrokes
}

/**
 * Recording result
 */
export interface RecordingResult {
  recordingId: string;
  status: 'recording' | 'stopped' | 'processing';
  duration?: number;
  videoUrl?: string;
}

/**
 * Screenshot result
 */
export interface ScreenshotResult {
  imageUrl: string;
  width: number;
  height: number;
  timestamp: string;
}

/**
 * Computer Use Workflow Automation
 */
export class DaytonaComputerUseWorkflow {
  /**
   * Take full-screen screenshot
   */
  async takeScreenshot(sandboxId: string): Promise<ScreenshotResult> {
    try {
      const provider = await getSandboxProvider('daytona');
      const handle = await provider.getSandbox(sandboxId);
      
      const service = handle.getComputerUseService();
      if (!service) {
        throw new Error('Computer Use service not available');
      }
      
      const result = await service.takeRegion({ x: 0, y: 0, width: 1920, height: 1080 });
      
      return {
        imageUrl: result.image,
        width: 1920,
        height: 1080,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error('Screenshot failed:', error);
      throw error;
    }
  }
  
  /**
   * Take region screenshot
   */
  async takeRegionScreenshot(
    sandboxId: string,
    region: ScreenRegion
  ): Promise<ScreenshotResult> {
    try {
      const provider = await getSandboxProvider('daytona');
      const handle = await provider.getSandbox(sandboxId);
      
      const service = handle.getComputerUseService();
      if (!service) {
        throw new Error('Computer Use service not available');
      }
      
      const result = await service.takeRegion(region);
      
      return {
        imageUrl: result.image,
        width: region.width,
        height: region.height,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error('Region screenshot failed:', error);
      throw error;
    }
  }
  
  /**
   * Start screen recording
   */
  async startRecording(sandboxId: string): Promise<RecordingResult> {
    try {
      const provider = await getSandboxProvider('daytona');
      const handle = await provider.getSandbox(sandboxId);
      
      const service = handle.getComputerUseService();
      if (!service) {
        throw new Error('Computer Use service not available');
      }
      
      const result = await service.startRecording();
      
      return {
        recordingId: result.recordingId,
        status: 'recording',
      };
    } catch (error: any) {
      logger.error('Start recording failed:', error);
      throw error;
    }
  }
  
  /**
   * Stop screen recording
   */
  async stopRecording(
    sandboxId: string,
    recordingId: string
  ): Promise<RecordingResult & { videoUrl: string }> {
    try {
      const provider = await getSandboxProvider('daytona');
      const handle = await provider.getSandbox(sandboxId);
      
      const service = handle.getComputerUseService();
      if (!service) {
        throw new Error('Computer Use service not available');
      }
      
      const result = await service.stopRecording(recordingId);
      
      return {
        recordingId,
        status: 'stopped',
        videoUrl: result.video,
      };
    } catch (error: any) {
      logger.error('Stop recording failed:', error);
      throw error;
    }
  }
  
  /**
   * Click at position
   */
  async click(sandboxId: string, position: MousePosition): Promise<{ success: boolean }> {
    try {
      const provider = await getSandboxProvider('daytona');
      const handle = await provider.getSandbox(sandboxId);

      // SECURITY: Validate coordinates to prevent command injection
      const x = Number(position.x);
      const y = Number(position.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        logger.warn('Invalid click coordinates', { position });
        return { success: false };
      }

      // Use xdotool for mouse click with validated numeric values
      const result = await handle.executeCommand(
        `xdotool mousemove ${x} ${y} click 1`
      );

      return { success: result.success };
    } catch (error: any) {
      logger.error('Click failed:', error);
      return { success: false };
    }
  }

  /**
   * Double-click at position
   */
  async doubleClick(sandboxId: string, position: MousePosition): Promise<{ success: boolean }> {
    try {
      const provider = await getSandboxProvider('daytona');
      const handle = await provider.getSandbox(sandboxId);

      // SECURITY: Validate coordinates to prevent command injection
      const x = Number(position.x);
      const y = Number(position.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        logger.warn('Invalid double-click coordinates', { position });
        return { success: false };
      }

      const result = await handle.executeCommand(
        `xdotool mousemove ${x} ${y} click --repeat 2 1`
      );

      return { success: result.success };
    } catch (error: any) {
      logger.error('Double-click failed:', error);
      return { success: false };
    }
  }
  
  /**
   * Type text
   */
  async type(sandboxId: string, input: KeyboardInput): Promise<{ success: boolean }> {
    try {
      const provider = await getSandboxProvider('daytona');
      const handle = await provider.getSandbox(sandboxId);

      // SECURITY: Validate and escape text input to prevent command injection
      if (typeof input.text !== 'string') {
        logger.warn('Invalid text input type', { input });
        return { success: false };
      }

      // Escape single quotes and backslashes for safe shell interpolation
      const escapedText = input.text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "'\\''")
        .replace(/[$`;|&(){}[\]<>!]/g, ''); // Remove shell metacharacters

      // Validate delay
      const delay = typeof input.delay === 'number' && input.delay > 0 ? input.delay : 100;

      const result = await handle.executeCommand(
        `xdotool type --delay ${delay} '${escapedText}'`
      );

      return { success: result.success };
    } catch (error: any) {
      logger.error('Type failed:', error);
      return { success: false };
    }
  }

  /**
   * Press key combination
   */
  async pressKey(sandboxId: string, keys: string[]): Promise<{ success: boolean }> {
    try {
      const provider = await getSandboxProvider('daytona');
      const handle = await provider.getSandbox(sandboxId);

      // SECURITY: Whitelist valid key names to prevent command injection
      const ALLOWED_KEYS = new Set([
        // Modifier keys
        'shift', 'control', 'alt', 'super', 'meta',
        // Function keys
        'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
        // Navigation
        'Up', 'Down', 'Left', 'Right', 'Tab', 'Return', 'Enter', 'Escape', 'BackSpace',
        'Delete', 'Insert', 'Home', 'End', 'Page_Up', 'Page_Down',
        // Special
        'space', 'plus', 'minus', 'underscore', 'equal', 'comma', 'period', 'slash',
        'question', 'exclam', 'at', 'numbersign', 'dollar', 'percent', 'asciicircum',
        'ampersand', 'asterisk', 'parenleft', 'parenright', 'bracketleft',
        'bracketright', 'braceleft', 'braceright', 'colon', 'semicolon', 'quotedbl',
        'apostrophe', 'backslash', 'bar', 'less', 'greater', 'slash',
        // Letters and numbers (will be validated below)
        'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
        'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      ]);

      // Validate all keys
      for (const key of keys) {
        // Allow alphanumeric single characters
        if (/^[a-zA-Z0-9]$/.test(key)) continue;
        // Check against whitelist
        if (!ALLOWED_KEYS.has(key)) {
          logger.warn('Invalid key name rejected', { key });
          return { success: false };
        }
      }

      const keyString = keys.join('+');
      const result = await handle.executeCommand(`xdotool key ${keyString}`);

      return { success: result.success };
    } catch (error: any) {
      logger.error('Key press failed:', error);
      return { success: false };
    }
  }
  
  /**
   * Run computer use workflow
   */
  async runWorkflow(
    sandboxId: string,
    steps: Array<{
      action: 'click' | 'type' | 'screenshot' | 'wait';
      params?: any;
    }>
  ): Promise<{ success: boolean; results: any[] }> {
    const results: any[] = [];
    
    for (const step of steps) {
      try {
        let result: any;
        
        switch (step.action) {
          case 'click':
            result = await this.click(sandboxId, step.params);
            break;
          case 'type':
            result = await this.type(sandboxId, step.params);
            break;
          case 'screenshot':
            result = await this.takeScreenshot(sandboxId);
            break;
          case 'wait':
            await new Promise(r => setTimeout(r, step.params.ms || 1000));
            result = { success: true };
            break;
        }
        
        results.push(result);
        
        if (!result.success && step.action !== 'screenshot') {
          return { success: false, results };
        }
      } catch (error: any) {
        logger.error(`Workflow step failed: ${step.action}`, error);
        return { success: false, results };
      }
    }
    
    return { success: true, results };
  }
}

/**
 * Singleton instance
 */
export const daytonaComputerUse = new DaytonaComputerUseWorkflow();

/**
 * Convenience functions
 */
export const takeScreenshot = (sandboxId: string) =>
  daytonaComputerUse.takeScreenshot(sandboxId);

export const takeRegionScreenshot = (sandboxId: string, region: ScreenRegion) =>
  daytonaComputerUse.takeRegionScreenshot(sandboxId, region);

export const startRecording = (sandboxId: string) =>
  daytonaComputerUse.startRecording(sandboxId);

export const stopRecording = (sandboxId: string, recordingId: string) =>
  daytonaComputerUse.stopRecording(sandboxId, recordingId);

export const click = (sandboxId: string, position: MousePosition) =>
  daytonaComputerUse.click(sandboxId, position);

export const type = (sandboxId: string, input: KeyboardInput) =>
  daytonaComputerUse.type(sandboxId, input);
