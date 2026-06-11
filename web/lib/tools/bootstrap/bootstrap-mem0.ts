/**
 * Register Mem0 Persistent Memory Tools
 *
 * Auto-builds and registers the Mem0 power's tool set with the registry.
 * Mem0 is "configured" when `MEM0_API_KEY` is set AND the circuit breaker
 * is not OPEN — `isMem0Configured()` already encapsulates both. When not
 * configured we surface a [WARN] (not a [DEBUG]) so degraded states are
 * visible at boot.
 *
 * Bug #12, #13, #24, #34 — the user explicitly named Mem0 as a registry
 * that should report 0 tools via [WARN] when degraded. This module closes
 * the gap (the prior patch wired Composio, MCP-gateway, Arcade, and OAuth
 * but skipped Mem0).
 *
 * @see bootstrap-health.ts for the shared [INFO]/[WARN] log helper.
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';
import { logToolCount } from '../bootstrap-health';

const logger = createLogger('Tools:Mem0-Bootstrap');

/**
 * Register Mem0 tools when configured.
 *
 * The Mem0 "power" exposes six tools (mem0_add, mem0_search, mem0_get_all,
 * mem0_update, mem0_delete, mem0_delete_all). We register them directly
 * against the `ToolRegistry` (no `ai.tool()` wrapper needed — the registry
 * only cares about the `handler`).
 *
 * @param registry - Tool registry instance
 * @param config   - Bootstrap configuration
 * @returns Number of tools registered (0 when Mem0 is not configured)
 */
export async function registerMem0Tools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  // Mem0 has a separate, user-scoped circuit breaker. isMem0Configured()
  // returns false when:
  //   - MEM0_API_KEY is missing, OR
  //   - the circuit breaker is OPEN (sustained outage).
  // In both cases we want a [WARN] with the explicit "(degraded)" suffix.
  const { isMem0Configured, mem0Add, mem0Search, mem0GetAll, mem0Update, mem0Delete, mem0DeleteAll } =
    await import('../../powers/mem0-power');

  if (!isMem0Configured()) {
    // Don't add to the registry at all — logToolCount handles the
    // [INFO]/[WARN] decision and the "(degraded)" suffix.
    logToolCount(logger, {
      registry: 'Mem0',
      count: 0,
      extra: { reason: !process.env.MEM0_API_KEY ? 'MEM0_API_KEY unset' : 'circuit breaker OPEN' },
    });
    return 0;
  }

  // Wire each Mem0 action into the ToolRegistry under the canonical name.
  // Each registration is wrapped in a per-tool try/catch so one failure
  // (e.g., a name collision with another registry) doesn't zero out the count
  // for the rest of the batch — the local `count` reflects what actually
  // landed in the registry.
  const userId = config.userId;
  let count = 0;
  const toolDefs: Array<{ name: string; capability: string; handler: (args: any) => Promise<any>; tags: string[]; perm: 'read' | 'write' }> = [
    { name: 'mem0:mem0_add',       capability: 'memory.add',       handler: (a) => mem0Add(a, { userId }),            tags: ['mem0', 'memory', 'add'],       perm: 'write' },
    { name: 'mem0:mem0_search',    capability: 'memory.search',    handler: (a) => mem0Search(a, { userId }),         tags: ['mem0', 'memory', 'search'],    perm: 'read' },
    { name: 'mem0:mem0_get_all',   capability: 'memory.list',      handler: (a) => mem0GetAll(a, { userId }),         tags: ['mem0', 'memory', 'list'],      perm: 'read' },
    { name: 'mem0:mem0_update',    capability: 'memory.update',    handler: (a) => mem0Update(a, { userId }),         tags: ['mem0', 'memory', 'update'],    perm: 'write' },
    { name: 'mem0:mem0_delete',    capability: 'memory.delete',    handler: (a) => mem0Delete(a, { userId }),         tags: ['mem0', 'memory', 'delete'],    perm: 'write' },
    { name: 'mem0:mem0_delete_all',capability: 'memory.delete_all',handler: (a) => mem0DeleteAll(a, { userId }),       tags: ['mem0', 'memory', 'delete-all'],perm: 'write' },
  ];

  for (const def of toolDefs) {
    try {
      await registry.registerTool({
        name: def.name,
        capability: def.capability,
        provider: 'mem0',
        handler: def.handler,
        metadata: { latency: 'low', cost: 'low', reliability: 0.95, tags: def.tags },
        permissions: [def.perm === 'read' ? 'memory:read' : 'memory:write'],
      });
      count++;
    } catch (error: any) {
      // One bad registration shouldn't zero out the count for the rest.
      // We log it as a [WARN] and continue so other Mem0 tools can land.
      logger.warn(`Failed to register Mem0 tool: ${def.name}`, error.message);
    }
  }

  // The count we report is the number that ACTUALLY landed in the registry.
  // If 4/6 succeeded (rare — e.g. capability-name collision with another
  // provider) we want operators to see 4, not 0 (swallowed by outer catch)
  // or 6 (a lie). This is the canonical contract for `logToolCount`.
  logToolCount(logger, { registry: 'Mem0', count });
  return count;
}

/**
 * Unregister all Mem0 tools
 */
export async function unregisterMem0Tools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools();
  const mem0Tools = tools.filter(t => t.provider === 'mem0');
  for (const tool of mem0Tools) {
    await registry.unregisterTool(tool.name);
  }
  logger.info(`Unregistered ${mem0Tools.length} Mem0 tools`);
}
