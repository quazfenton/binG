/**
 * Register Sandbox Tools
 *
 * Auto-registers sandbox execution tools from configured providers:
 * - E2B
 * - Daytona
 * - CodeSandbox
 * - Sprites
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';

const logger = createLogger('Tools:Sandbox-Bootstrap');

/**
 * Register sandbox tools from configured providers
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerSandboxTools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  let count = 0;

  // Register E2B tools
  if (process.env.E2B_API_KEY) {
    try {
      const e2bCount = await registerE2BTools(registry);
      count += e2bCount;
      logger.info(`Registered ${e2bCount} E2B tools`);
    } catch (error: any) {
      logger.warn('Failed to register E2B tools', error.message);
    }
  }

  // Register Daytona tools
  if (process.env.DAYTONA_API_KEY) {
    try {
      const daytonaCount = await registerDaytonaTools(registry);
      count += daytonaCount;
      logger.info(`Registered ${daytonaCount} Daytona tools`);
    } catch (error: any) {
      logger.warn('Failed to register Daytona tools', error.message);
    }
  }

  // Register CodeSandbox tools
  if (process.env.CODESANDBOX_API_KEY) {
    try {
      const csbCount = await registerCodeSandboxTools(registry);
      count += csbCount;
      logger.info(`Registered ${csbCount} CodeSandbox tools`);
    } catch (error: any) {
      logger.warn('Failed to register CodeSandbox tools', error.message);
    }
  }

  return count;
}

/**
 * Register E2B tools
 */
async function registerE2BTools(registry: ToolRegistry): Promise<number> {
  let count = 0;

  // Register E2B AMP agent
  await registry.registerTool({
    name: 'e2b:runAmpAgent',
    capability: 'sandbox.execute',
    provider: 'e2b',
    handler: async (args: any, context: any) => {
      const { E2BIntegration } = await import('../../sandbox/phase2-integration');
      return await E2BIntegration.runAmpAgent(args);
    },
    metadata: {
      latency: 'high',
      cost: 'high',
      reliability: 0.90,
      tags: ['e2b', 'amp', 'agent'],
    },
    permissions: ['sandbox:execute'],
  });
  count++;

  // Register E2B Codex agent
  await registry.registerTool({
    name: 'e2b:runCodexAgent',
    capability: 'sandbox.execute',
    provider: 'e2b',
    handler: async (args: any, context: any) => {
      const { E2BIntegration } = await import('../../sandbox/phase2-integration');
      return await E2BIntegration.runCodexAgent(args);
    },
    metadata: {
      latency: 'high',
      cost: 'high',
      reliability: 0.90,
      tags: ['e2b', 'codex', 'agent'],
    },
    permissions: ['sandbox:execute'],
  });
  count++;

  return count;
}

/**
 * Register Daytona tools
 */
async function registerDaytonaTools(registry: ToolRegistry): Promise<number> {
  let count = 0;

  // Register Daytona computer use
  await registry.registerTool({
    name: 'daytona:computerUse',
    capability: 'sandbox.execute',
    provider: 'daytona',
    handler: async (args: any, context: any) => {
      const { DaytonaComputerUseWorkflow } = await import('../../sandbox/phase2-integration');
      return await DaytonaComputerUseWorkflow.execute(args);
    },
    metadata: {
      latency: 'medium',
      cost: 'medium',
      reliability: 0.92,
      tags: ['daytona', 'computer-use', 'gui'],
    },
    permissions: ['sandbox:execute', 'sandbox:browser'],
  });
  count++;

  // Register Daytona screenshot
  await registry.registerTool({
    name: 'daytona:screenshot',
    capability: 'sandbox.execute',
    provider: 'daytona',
    handler: async (args: any, context: any) => {
      const { daytonaComputerUse } = await import('../../sandbox/phase2-integration');
      return await daytonaComputerUse.takeScreenshot(args);
    },
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.95,
      tags: ['daytona', 'screenshot'],
    },
    permissions: ['sandbox:execute'],
  });
  count++;

  return count;
}

/**
 * Register CodeSandbox tools
 */
async function registerCodeSandboxTools(registry: ToolRegistry): Promise<number> {
  let count = 0;

  // Register CodeSandbox batch CI
  await registry.registerTool({
    name: 'codesandbox:batchCI',
    capability: 'sandbox.execute',
    provider: 'codesandbox',
    handler: async (args: any, context: any) => {
      const { CodeSandboxBatchCI } = await import('../../sandbox/phase2-integration');
      return await CodeSandboxBatchCI.runBatchJob(args);
    },
    metadata: {
      latency: 'high',
      cost: 'medium',
      reliability: 0.88,
      tags: ['codesandbox', 'ci', 'batch'],
    },
    permissions: ['sandbox:execute'],
  });
  count++;

  return count;
}

/**
 * Unregister all sandbox tools
 */
export async function unregisterSandboxTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools();
  const sandboxTools = tools.filter(t =>
    t.provider === 'e2b' || t.provider === 'daytona' || t.provider === 'codesandbox'
  );

  for (const tool of sandboxTools) {
    await registry.unregisterTool(tool.name);
  }

  logger.info(`Unregistered ${sandboxTools.length} sandbox tools`);
}
