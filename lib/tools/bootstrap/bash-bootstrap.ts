/**
 * Bootstrap Bash Tool Registration
 * 
 * Registers bash.execute capability with tool system
 * Integrates with existing bootstrap infrastructure
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';
import { bashToolExecutor } from '../tool-integration/bash-tool';
import { z } from 'zod';

const logger = createLogger('Tools:Bootstrap:Bash');

/**
 * Register bash tool with registry
 * 
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerBashTool(
  registry: ToolRegistry,
  config: BootstrapConfig
): Promise<number> {
  try {
    logger.info('Registering bash tool...');

    // Register bash.execute capability
    await registry.registerCapability({
      id: 'bash.execute',
      name: 'Bash Command Execution',
      description: 'Execute bash commands in sandboxed environment with automatic error recovery (self-healing)',
      inputSchema: z.object({
        command: z.string().describe('Bash command to execute (e.g., "cat file.txt | grep pattern")'),
        cwd: z.string().optional().describe('Working directory (relative to workspace root)'),
        timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
        enableHealing: z.boolean().optional().default(true).describe('Enable automatic error recovery'),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        stdout: z.string(),
        stderr: z.string(),
        exitCode: z.number(),
        duration: z.number(),
        attempts: z.number().optional(),
        fixesApplied: z.array(z.object({
          attempt: z.number(),
          original: z.string(),
          fixed: z.string(),
        })).optional(),
      }),
      handler: async (args: any, context: any) => {
        return bashToolExecutor.execute({
          userId: config.userId,
          params: {
            command: args.command,
            cwd: args.cwd,
            timeout: args.timeout,
            enableHealing: args.enableHealing,
          },
          sandboxId: context.sandboxId,
          sandboxProvider: context.sandboxProvider,
        });
      },
      metadata: {
        latency: 'medium',
        cost: 'low',
        reliability: 0.95,
        tags: ['bash', 'shell', 'execution', 'self-healing'],
      },
      permissions: ['sandbox:execute', 'file:read', 'file:write'],
    });

    logger.info('Bash tool registered successfully');
    return 1;
  } catch (error: any) {
    logger.error('Failed to register bash tool', error);
    return 0;
  }
}

/**
 * Register bash DAG compiler (optional advanced feature)
 * 
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerBashDAGCompiler(
  registry: ToolRegistry,
  config: BootstrapConfig
): Promise<number> {
  try {
    // This would be implemented in Phase 2
    logger.debug('Bash DAG compiler registration skipped (Phase 2 feature)');
    return 0;
  } catch (error: any) {
    logger.error('Failed to register bash DAG compiler', error);
    return 0;
  }
}
