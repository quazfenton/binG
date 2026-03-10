/**
 * Phase 2: E2B Deep Integration
 * 
 * Advanced E2B provider integration with:
 * - AMP (Anthropic) agent workflows
 * - Codex (OpenAI) agent workflows
 * - Desktop environment automation
 * - Git integration with auth
 * - Streaming event handlers
 * - Cost tracking and optimization
 * 
 * @see https://e2b.dev/docs/agents/amp
 * @see https://e2b.dev/docs/agents/codex
 * @see https://e2b.dev/docs/desktop
 * 
 * @example
 * ```typescript
 * import { e2bIntegration } from '@/lib/sandbox/phase2-integration';
 * 
 * // Run AMP agent with streaming
 * const result = await e2bIntegration.runAmpAgent({
 *   prompt: 'Refactor the utils module',
 *   streamEvents: true,
 *   onEvent: (event) => console.log(event),
 * });
 * 
 * // Run Codex with structured output
 * const review = await e2bIntegration.runCodexAgent({
 *   prompt: 'Review for security vulnerabilities',
 *   outputSchema: { type: 'object', properties: { issues: {...} } },
 *   fullAuto: true,
 * });
 * 
 * // Clone private repo with auth
 * await e2bIntegration.cloneRepo({
 *   url: 'https://github.com/org/private-repo',
 *   authToken: process.env.GITHUB_TOKEN,
 *   branch: 'main',
 * });
 * ```
 */

import { getSandboxProvider } from './providers';
import { createLogger } from '../utils/logger';

const logger = createLogger('Phase2:E2BIntegration');

/**
 * AMP Agent configuration
 */
export interface AmpAgentConfig {
  /** Task prompt */
  prompt: string;
  
  /** Working directory inside sandbox */
  workingDir?: string;
  
  /** Stream JSON events */
  streamJson?: boolean;
  
  /** Anthropic model to use */
  model?: 'claude-3-5-sonnet-20241022' | 'claude-3-opus-20240229' | 'claude-3-haiku-20240307';
  
  /** Event handler for streaming */
  onEvent?: (event: AmpEvent) => void;
  
  /** Timeout in ms */
  timeout?: number;
}

/**
 * AMP event types
 */
export type AmpEvent =
  | { type: 'start'; timestamp: string }
  | { type: 'thought'; content: string; timestamp: string }
  | { type: 'tool_call'; tool_name: string; input: any; timestamp: string }
  | { type: 'tool_result'; tool_name: string; result: any; timestamp: string }
  | { type: 'assistant'; message: any; timestamp: string }
  | { type: 'error'; error: string; timestamp: string }
  | { type: 'complete'; output: string; cost?: number; tokens?: any; timestamp: string };

/**
 * Codex Agent configuration
 */
export interface CodexAgentConfig {
  /** Task prompt */
  prompt: string;
  
  /** Working directory inside sandbox */
  workingDir?: string;
  
  /** Run in fully autonomous mode */
  fullAuto?: boolean;
  
  /** JSON schema for structured output */
  outputSchema?: any;
  
  /** Path to output schema file */
  outputSchemaPath?: string;
  
  /** Event handler for streaming */
  onEvent?: (event: CodexEvent) => void;
  
  /** Timeout in ms */
  timeout?: number;
}

/**
 * Codex event types
 */
export type CodexEvent =
  | { type: 'start'; timestamp: string }
  | { type: 'thinking'; content: string; timestamp: string }
  | { type: 'tool_call'; data: { tool_name: string; arguments: any }; timestamp: string }
  | { type: 'tool_output'; output: string; timestamp: string }
  | { type: 'diff'; diff: string; timestamp: string }
  | { type: 'error'; error: string; timestamp: string }
  | { type: 'complete'; output: string; cost?: number; timestamp: string };

/**
 * Git clone configuration
 */
export interface GitCloneConfig {
  /** Repository URL */
  url: string;
  
  /** Branch to clone */
  branch?: string;
  
  /** Directory to clone into */
  path?: string;
  
  /** Auth token (GitHub PAT, SSH key, etc.) */
  authToken?: string;
  
  /** Git username (for token auth) */
  username?: string;
  
  /** Shallow clone depth */
  depth?: number;
}

/**
 * Git operation result
 */
export interface GitOperationResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: {
    branch?: string;
    commit?: string;
    remote?: string;
  };
}

/**
 * Desktop environment configuration
 */
export interface DesktopConfig {
  /** Enable desktop environment */
  enabled: boolean;
  
  /** Screen resolution */
  resolution?: { width: number; height: number };
  
  /** Enable screen recording */
  recording?: boolean;
}

/**
 * E2B Integration Result
 */
export interface E2BResult<T = any> {
  success: boolean;
  output: T;
  sandboxId?: string;
  cost?: number;
  tokens?: any;
  duration?: number;
  error?: string;
}

/**
 * E2B Deep Integration
 */
export class E2BIntegration {
  /**
   * Run AMP (Anthropic) agent
   */
  async runAmpAgent(config: AmpAgentConfig): Promise<E2BResult<string>> {
    const startTime = Date.now();
    
    try {
      // Check API keys
      if (!process.env.E2B_API_KEY) {
        return {
          success: false,
          output: '',
          error: 'E2B_API_KEY not configured',
        };
      }
      
      if (!process.env.AMP_API_KEY) {
        return {
          success: false,
          output: '',
          error: 'AMP_API_KEY not configured',
        };
      }
      
      // Create E2B sandbox
      const provider = await getSandboxProvider('e2b');
      const handle = await provider.createSandbox({
        language: 'typescript',
        envVars: {
          AMP_API_KEY: process.env.AMP_API_KEY,
        },
      });
      
      logger.info(`Created E2B sandbox ${handle.id} for AMP agent`);
      
      // Get AMP service
      const ampService = handle.getAmpService();
      if (!ampService) {
        await provider.destroySandbox(handle.id);
        return {
          success: false,
          output: '',
          error: 'AMP service not available',
        };
      }
      
      // Run agent
      const result = await ampService.run({
        prompt: config.prompt,
        workingDir: config.workingDir || '/home/user',
        streamJson: config.streamJson ?? false,
        model: config.model,
      });
      
      // Destroy sandbox
      await provider.destroySandbox(handle.id);
      
      logger.info(`AMP agent completed in ${Date.now() - startTime}ms`);
      
      return {
        success: true,
        output: result.output || '',
        sandboxId: handle.id,
        cost: result.cost,
        tokens: result.tokens,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.error('AMP agent failed:', error);
      return {
        success: false,
        output: '',
        error: error?.message || 'AMP agent execution failed',
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Run AMP agent with streaming events
   */
  async *streamAmpEvents(config: AmpAgentConfig): AsyncIterable<AmpEvent> {
    try {
      if (!process.env.E2B_API_KEY || !process.env.AMP_API_KEY) {
        throw new Error('E2B_API_KEY or AMP_API_KEY not configured');
      }
      
      const provider = await getSandboxProvider('e2b');
      const handle = await provider.createSandbox({
        language: 'typescript',
        envVars: { AMP_API_KEY: process.env.AMP_API_KEY },
      });
      
      const ampService = handle.getAmpService();
      if (!ampService) {
        await provider.destroySandbox(handle.id);
        throw new Error('AMP service not available');
      }
      
      // Stream events
      for await (const event of ampService.streamJson({
        prompt: config.prompt,
        workingDir: config.workingDir || '/home/user',
        model: config.model,
      })) {
        yield event as AmpEvent;
        
        // Call user's event handler
        if (config.onEvent) {
          config.onEvent(event as AmpEvent);
        }
      }
      
      await provider.destroySandbox(handle.id);
    } catch (error: any) {
      logger.error('AMP streaming failed:', error);
      yield {
        type: 'error',
        error: error?.message || 'Streaming failed',
        timestamp: new Date().toISOString(),
      };
    }
  }
  
  /**
   * Run Codex (OpenAI) agent
   */
  async runCodexAgent(config: CodexAgentConfig): Promise<E2BResult<string>> {
    const startTime = Date.now();
    
    try {
      // Check API keys
      if (!process.env.E2B_API_KEY) {
        return {
          success: false,
          output: '',
          error: 'E2B_API_KEY not configured',
        };
      }
      
      const apiKey = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          output: '',
          error: 'CODEX_API_KEY or OPENAI_API_KEY not configured',
        };
      }
      
      // Create E2B sandbox
      const provider = await getSandboxProvider('e2b');
      const handle = await provider.createSandbox({
        language: 'typescript',
        envVars: {
          CODEX_API_KEY: apiKey,
        },
      });
      
      logger.info(`Created E2B sandbox ${handle.id} for Codex agent`);
      
      // Get Codex service
      const codexService = handle.getCodexService();
      if (!codexService) {
        await provider.destroySandbox(handle.id);
        return {
          success: false,
          output: '',
          error: 'Codex service not available',
        };
      }
      
      // Run agent
      const result = await codexService.run({
        prompt: config.prompt,
        workingDir: config.workingDir || '/home/user',
        fullAuto: config.fullAuto ?? false,
        outputSchemaPath: config.outputSchemaPath,
      });
      
      // Destroy sandbox
      await provider.destroySandbox(handle.id);
      
      logger.info(`Codex agent completed in ${Date.now() - startTime}ms`);
      
      return {
        success: true,
        output: result.output || '',
        sandboxId: handle.id,
        cost: result.cost,
        tokens: result.tokens,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.error('Codex agent failed:', error);
      return {
        success: false,
        output: '',
        error: error?.message || 'Codex agent execution failed',
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Clone git repository
   */
  async cloneRepo(config: GitCloneConfig): Promise<GitOperationResult> {
    try {
      const provider = await getSandboxProvider('e2b');
      const handle = await provider.createSandbox({});
      
      const path = config.path || '/home/user/repo';
      const branch = config.branch || 'main';
      const depth = config.depth || 1;
      
      // Build clone command
      let cmd = `git clone --depth ${depth} --branch ${branch}`;
      
      // Handle authentication
      if (config.authToken) {
        const username = config.username || 'x-access-token';
        const urlWithAuth = config.url.replace('https://', `https://${username}:${config.authToken}@`);
        cmd += ` ${urlWithAuth} ${path}`;
      } else {
        cmd += ` ${config.url} ${path}`;
      }
      
      const result = await handle.executeCommand(cmd);
      
      await provider.destroySandbox(handle.id);
      
      if (!result.success) {
        return {
          success: false,
          output: result.output || '',
          error: 'Failed to clone repository',
        };
      }
      
      // Get commit info
      const commitResult = await handle.executeCommand('git rev-parse HEAD', path);
      
      return {
        success: true,
        output: `Repository cloned to ${path}`,
        metadata: {
          branch,
          commit: commitResult.output?.trim(),
          remote: config.url,
        },
      };
    } catch (error: any) {
      logger.error('Git clone failed:', error);
      return {
        success: false,
        output: '',
        error: error?.message || 'Git clone failed',
      };
    }
  }
  
  /**
   * Pull latest changes
   */
  async gitPull(path?: string): Promise<GitOperationResult> {
    try {
      const provider = await getSandboxProvider('e2b');
      const handle = await provider.getSandbox('existing-sandbox');
      
      const cwd = path || '/home/user/repo';
      const result = await handle.executeCommand('git pull', cwd);
      
      return {
        success: result.success,
        output: result.output || '',
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error?.message || 'Git pull failed',
      };
    }
  }
  
  /**
   * Get git status
   */
  async gitStatus(path?: string): Promise<GitOperationResult & { status?: any }> {
    try {
      const provider = await getSandboxProvider('e2b');
      const handle = await provider.getSandbox('existing-sandbox');
      
      const cwd = path || '/home/user/repo';
      const result = await handle.executeCommand('git status --json', cwd);
      
      if (!result.success) {
        return {
          success: false,
          output: result.output || '',
        };
      }
      
      return {
        success: true,
        output: result.output || '',
        status: JSON.parse(result.output),
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error?.message || 'Git status failed',
      };
    }
  }
  
  /**
   * Get git diff
   */
  async gitDiff(path?: string): Promise<GitOperationResult & { diff?: string }> {
    try {
      const provider = await getSandboxProvider('e2b');
      const handle = await provider.getSandbox('existing-sandbox');
      
      const cwd = path || '/home/user/repo';
      const result = await handle.executeCommand('git diff', cwd);
      
      return {
        success: result.success,
        output: result.output || '',
        diff: result.output,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error?.message || 'Git diff failed',
      };
    }
  }
  
  /**
   * Enable desktop environment
   */
  async enableDesktop(config?: DesktopConfig): Promise<E2BResult<{ url: string }>> {
    try {
      if (!process.env.E2B_API_KEY) {
        return {
          success: false,
          output: { url: '' },
          error: 'E2B_API_KEY not configured',
        };
      }
      
      const provider = await getSandboxProvider('e2b');
      const handle = await provider.createSandbox({
        language: 'typescript',
        envVars: {
          E2B_DESKTOP: config?.enabled ? 'true' : 'false',
        },
      });
      
      // Get desktop URL
      const desktopUrl = `https://desktop.e2b.dev/${handle.id}`;
      
      return {
        success: true,
        output: { url: desktopUrl },
        sandboxId: handle.id,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.error('Desktop enable failed:', error);
      return {
        success: false,
        output: { url: '' },
        error: error?.message || 'Failed to enable desktop',
      };
    }
  }
  
  /**
   * Take desktop screenshot
   */
  async takeDesktopScreenshot(): Promise<E2BResult<{ imageUrl: string }>> {
    try {
      const provider = await getSandboxProvider('e2b');
      const handle = await provider.getSandbox('existing-sandbox');
      
      // E2B desktop screenshot via API
      const imageUrl = `https://desktop.e2b.dev/${handle.id}/screenshot`;
      
      return {
        success: true,
        output: { imageUrl },
        sandboxId: handle.id,
      };
    } catch (error: any) {
      return {
        success: false,
        output: { imageUrl: '' },
        error: error?.message || 'Screenshot failed',
      };
    }
  }
  
  /**
   * Get cost estimate for agent task
   */
  async getCostEstimate(prompt: string, model?: string): Promise<{
    estimatedTokens: number;
    estimatedCost: number;
    currency: string;
  }> {
    // Rough estimates based on prompt length
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = promptTokens * 2; // Assume 2x output
    const totalTokens = promptTokens + completionTokens;
    
    // Anthropic pricing (approximate)
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-3-5-sonnet-20241022': { input: 3, output: 15 }, // per 1M tokens
      'claude-3-opus-20240229': { input: 15, output: 75 },
      'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
    };
    
    const modelPricing = pricing[model || 'claude-3-5-sonnet-20241022'];
    const inputCost = (promptTokens / 1_000_000) * modelPricing.input;
    const outputCost = (completionTokens / 1_000_000) * modelPricing.output;
    
    return {
      estimatedTokens: totalTokens,
      estimatedCost: inputCost + outputCost,
      currency: 'USD',
    };
  }
}

/**
 * Singleton instance
 */
export const e2bIntegration = new E2BIntegration();

/**
 * Convenience function: Run AMP agent
 */
export async function runAmpAgent(config: AmpAgentConfig): Promise<E2BResult<string>> {
  return e2bIntegration.runAmpAgent(config);
}

/**
 * Convenience function: Run Codex agent
 */
export async function runCodexAgent(config: CodexAgentConfig): Promise<E2BResult<string>> {
  return e2bIntegration.runCodexAgent(config);
}

/**
 * Convenience function: Clone git repo
 */
export async function cloneRepo(config: GitCloneConfig): Promise<GitOperationResult> {
  return e2bIntegration.cloneRepo(config);
}
