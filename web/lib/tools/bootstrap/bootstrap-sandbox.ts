/**
 * Register Sandbox Tools
 *
 * Auto-registers sandbox execution tools from configured providers:
 * - E2B
 * - Daytona
 * - CodeSandbox
 * - Sprites
 *
 * Bug #12, #13, #24, #34 — per-sandbox-provider per-attempt success/fail
 * log via `providerAttemptLogger`, plus a single consolidated
 * `logToolCount` for the registered count. The previous version logged
 * both "attempt 1 success" AND "Registered N E2B tools" for the same
 * event, which duplicated noise at boot. Now `providerAttemptLogger`
 * includes the count when known, and we skip the separate
 * logToolCount call when the count was already reported via the
 * attempt-success log.
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';
import { providerAttemptLogger } from '../../sandbox/provider-attempt-log';

const logger = createLogger('Tools:Sandbox-Bootstrap');

/**
 * Register sandbox tools from configured providers
 */
export async function registerSandboxTools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  let count = 0;

  // Each provider gets the same treatment: start → run → log success/fail.
  // On success the attempt-logger emits a single [INFO] line that includes
  // both the attempt number and the registered tool count, replacing the
  // previous double-log (attempt-success + logToolCount).
  if (process.env.E2B_API_KEY) {
    count += await runProviderRegistration('e2b', 'registerSandboxTools', () => registerE2BTools(registry));
  }

  if (process.env.DAYTONA_API_KEY) {
    count += await runProviderRegistration('daytona', 'registerSandboxTools', () => registerDaytonaTools(registry));
  }

  if (process.env.CODESANDBOX_API_KEY) {
    count += await runProviderRegistration('codesandbox', 'registerSandboxTools', () => registerCodeSandboxTools(registry));
  }

  return count;
}

/**
 * Single-shot wrapper that:
 *   1. Starts a per-attempt log line
 *   2. Runs the registration function
 *   3. Emits a single consolidated [INFO] (success) or [WARN] (fail) line
 *      that includes BOTH the attempt number AND the tool count.
 *
 * This replaces the old double-log ("attempt 1 success (Nms)" + "Registered
 * N E2B tools") with one line, while still satisfying the "per-sandbox-
 * provider per-attempt success/fail log" requirement.
 *
 * @param provider   Sandbox provider name (e.g. "e2b", "daytona").
 * @param op         Operation name (e.g. "registerSandboxTools").
 * @param registerFn Async function that actually registers the tools.
 * @returns Number of tools registered (0 on failure).
 */
async function runProviderRegistration(
  provider: string,
  op: string,
  registerFn: () => Promise<number>,
): Promise<number> {
  const attemptLog = providerAttemptLogger(logger, { provider, op, attempt: 1 });
  const t0 = Date.now();
  attemptLog.start();
  try {
    const providerCount = await registerFn();
    // Consolidated success log: [INFO] `[<provider>] <op> attempt 1 success
    // (Nms, M tools)` — replaces the old attempt-success + logToolCount pair.
    logger.info(
      `[${provider}] ${op} attempt 1 success (${Date.now() - t0}ms, ${providerCount} tools)`,
      { providerCount, elapsedMs: Date.now() - t0 },
    );
    return providerCount;
  } catch (error: any) {
    attemptLog.fail(error, t0);
    logger.warn(`Failed to register ${provider} tools`, error.message);
    return 0;
  }
}

/**
 * Register E2B tools
 */
async function registerE2BTools(registry: ToolRegistry): Promise<number> {
  let count = 0;

  await registry.registerTool({
    name: 'e2b:runAmpAgent',
    capability: 'sandbox.execute',
    provider: 'e2b',
    handler: async (args: any, context: any) => {
      const { E2BIntegration } = await import('../../sandbox/phase2-integration');
      return await (E2BIntegration as any).runAmpAgent(args);
    },
    metadata: { latency: 'high', cost: 'high', reliability: 0.90, tags: ['e2b', 'amp', 'agent'] },
    permissions: ['sandbox:execute'],
  });
  count++;

  await registry.registerTool({
    name: 'e2b:runCodexAgent',
    capability: 'sandbox.execute',
    provider: 'e2b',
    handler: async (args: any, context: any) => {
      const { E2BIntegration } = await import('../../sandbox/phase2-integration');
      return await (E2BIntegration as any).runCodexAgent(args);
    },
    metadata: { latency: 'high', cost: 'high', reliability: 0.90, tags: ['e2b', 'codex', 'agent'] },
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

  await registry.registerTool({
    name: 'daytona:computerUse',
    capability: 'sandbox.execute',
    provider: 'daytona',
    handler: async (args: any, context: any) => {
      const { DaytonaComputerUseWorkflow } = await import('../../sandbox/phase2-integration');
      return await (DaytonaComputerUseWorkflow as any).execute(args);
    },
    metadata: { latency: 'medium', cost: 'medium', reliability: 0.92, tags: ['daytona', 'computer-use', 'gui'] },
    permissions: ['sandbox:execute', 'sandbox:browser'],
  });
  count++;

  await registry.registerTool({
    name: 'daytona:screenshot',
    capability: 'sandbox.execute',
    provider: 'daytona',
    handler: async (args: any, context: any) => {
      const { daytonaComputerUse } = await import('../../sandbox/phase2-integration');
      return await (daytonaComputerUse as any).takeScreenshot(args);
    },
    metadata: { latency: 'low', cost: 'low', reliability: 0.95, tags: ['daytona', 'screenshot'] },
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

  await registry.registerTool({
    name: 'codesandbox:batchCI',
    capability: 'sandbox.execute',
    provider: 'codesandbox',
    handler: async (args: any, context: any) => {
      const { CodeSandboxBatchCI } = await import('../../sandbox/phase2-integration');
      return await (CodeSandboxBatchCI as any).runBatchJob(args) as any;
    },
    metadata: { latency: 'high', cost: 'medium', reliability: 0.88, tags: ['codesandbox', 'ci', 'batch'] },
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
