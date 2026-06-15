/**
 * Register Arcade Tools
 *
 * Auto-discovers and registers tools from Arcade when API key is configured.
 *
 * Features:
 * - Auto-discovery from Arcade API when ARCADE_API_KEY is set
 * - Dynamic tool registration
 * - Capability mapping
 */

import type { ToolRegistry } from '../registry';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';
import { logToolCount } from '../bootstrap-health';

const logger = createLogger('Tools:Arcade-Bootstrap');

// Bug #19: surface optional-infra degradation to the user. Emit a
// structured warn + populate a cached capability list so the LLM can
// see the degradation in its system prompt (not just run.log) and the
// bootstrap layer can short-circuit Arcade lookups for the TTL window.
// The cache is best-effort: if Arcade recovers on the next call, the
// next refresh will repopulate the list. `declare global` MUST be at
// module scope (TS1234 forbids it inside a function body).
declare global {
  // eslint-disable-next-line no-var
  var __arcadeDegradedCache__:
    | { degraded: boolean; reason: string; expiresAt: number; inFlight: boolean }
    | undefined;
}

// Track if already initialized
let arcadeInitialized = false;

/**
 * Register Arcade tools when API key is configured
 *
 * @param registry - Tool registry instance
 * @param config - Bootstrap configuration
 * @returns Number of tools registered
 */
export async function registerArcadeTools(registry: ToolRegistry, config: BootstrapConfig): Promise<number> {
  // Prevent duplicate initialization
  if (arcadeInitialized) {
    return 0;
  }

  // Check if explicitly disabled or no API key
  if (config.enableArcade === false) {
    logger.debug('Arcade explicitly disabled');
    return 0;
  }

  // Check if Arcade API key is configured
  const arcadeApiKey = process.env.ARCADE_API_KEY;
  if (!arcadeApiKey) {
    logger.debug('Arcade not configured (no ARCADE_API_KEY)');
    return 0;
  }

  let count = 0;

  // Bug #19: surface optional-infra degradation to the user. Short-circuit
  // bootstrap when the cache is hot (degraded) or in-flight (another caller
  // is already checking). The in-flight marker closes the race where
  // concurrent bootstrap calls all see `degradedCache === undefined` and
  // all hit the network.
  const ARCADE_DEGRADED_CACHE_TTL_MS = parseInt(
    process.env.ARCADE_DEGRADED_CACHE_TTL_MS || '60000',
    10
  );
  const degradedCache = globalThis.__arcadeDegradedCache__;
  if (degradedCache && degradedCache.expiresAt > Date.now()) {
    if (degradedCache.inFlight) {
      logger.debug('[Bug #19] Arcade bootstrap already in-flight, returning 0');
      return 0;
    }
    if (degradedCache.degraded) {
      logger.warn(
        `[Bug #19] Arcade capability list cached as degraded (TTL remaining ${Math.round((degradedCache.expiresAt - Date.now()) / 1000)}s): ${degradedCache.reason}`
      );
      return 0;
    }
  }
  // Mark in-flight so concurrent callers short-circuit.
  globalThis.__arcadeDegradedCache__ = {
    degraded: false,
    reason: '',
    expiresAt: Date.now() + ARCADE_DEGRADED_CACHE_TTL_MS,
    inFlight: true,
  };

  try {
    // Import Arcade service
    const { getArcadeService, isArcadeServiceDisabled } = await import('../../integrations/arcade-service');
    const arcadeService = getArcadeService();

    if (!arcadeService) {
      if (isArcadeServiceDisabled()) {
        logger.warn(
          'Arcade service disabled due to 401 (invalid API key). ' +
          'Fix ARCADE_API_KEY and call reenableArcadeService() to retry, or restart the server.'
        );
        // Bug #19: cache the 401-degraded state so subsequent bootstrap
        // calls short-circuit and don't re-emit the warning on every call.
        // isArcadeServiceDisabled() returns true WITHOUT throwing, so the
        // catch block below never fires for this case — we have to set
        // the cache here.
        try {
          globalThis.__arcadeDegradedCache__ = {
            degraded: true,
            reason: 'Arcade service disabled (401 invalid API key)',
            expiresAt: Date.now() + ARCADE_DEGRADED_CACHE_TTL_MS,
            inFlight: false,
          };
        } catch { /* best-effort */ }
      } else {
        logger.debug('Arcade service not available (not yet initialized or no key)');
        // No key configured is NOT a degradation — it's the expected
        // state. Clear any in-flight marker so the next call can re-evaluate.
        try {
          const cur = globalThis.__arcadeDegradedCache__;
          if (cur && cur.inFlight) {
            globalThis.__arcadeDegradedCache__ = {
              degraded: false,
              reason: '',
              expiresAt: Date.now() + ARCADE_DEGRADED_CACHE_TTL_MS,
              inFlight: false,
            };
          }
        } catch { /* best-effort */ }
      }
      return 0;
    }

    // Get available tools from Arcade
    const tools = await arcadeService.getTools({ limit: 200 });

    if (!tools || tools.length === 0) {
      // Detailed warning is now emitted inside arcadeService.getTools()
      return 0;
    }

    // Register each Arcade tool
    for (const tool of tools) {
      try {
        // Map Arcade tool to capability
        const capability = mapArcadeToolToCapability(tool.name, tool.toolkit);

        await registry.registerTool({
          name: `arcade:${tool.name}`,
          capability: capability,
          provider: 'arcade',
          handler: async (args: any, context: any) => {
            const userId = context?.userId || config.userId;
            const result = await arcadeService.executeTool(tool.name, args, userId);
            
            if (result.success) {
              return { success: true, output: result.output };
            } else {
              return { 
                success: false, 
                error: result.error,
                requiresAuth: result.requiresAuth,
                authUrl: result.authUrl,
              };
            }
          },
          metadata: {
            latency: 'medium',
            cost: 'medium',
            reliability: 0.92,
            tags: ['arcade', tool.toolkit, tool.name],
          },
          permissions: [`arcade:${tool.toolkit}`],
        });

        count++;
      } catch (error: any) {
        logger.warn(`Failed to register Arcade tool: ${tool.name}`, error.message);
      }
    }

    arcadeInitialized = true;
    // Bug #12/#13/#24/#34: emit [WARN] when Arcade returned 0 tools
    logToolCount(logger, { registry: 'Arcade', count });
  } catch (error: any) {
    logger.error('Failed to register Arcade tools', error);
    // Bug #19: cache the degradation for the TTL window so subsequent
    // bootstrap calls short-circuit and the LLM sees a consistent
    // 'degraded' signal in its system prompt.
    try {
      globalThis.__arcadeDegradedCache__ = {
        degraded: true,
        reason: error instanceof Error ? error.message : String(error),
        expiresAt: Date.now() + ARCADE_DEGRADED_CACHE_TTL_MS,
        inFlight: false,
      };
    } catch { /* best-effort */ }
  }

  // Bug #19: only cache as degraded if the underlying call signalled
  // a real degradation (isArcadeServiceDisabled() === true from a 401).
  // A legitimate empty result (no API key configured, or zero tools
  // available) is NOT a degradation — it's the expected state. Clearing
  // the cache on success allows a previously-degraded Arcade to be
  // retried on the next bootstrap.
  if (count > 0) {
    try {
      globalThis.__arcadeDegradedCache__ = undefined;
    } catch { /* best-effort */ }
  } else {
    // Clear the in-flight marker so the next call can re-evaluate.
    try {
      const cur = globalThis.__arcadeDegradedCache__;
      if (cur && cur.inFlight) {
        globalThis.__arcadeDegradedCache__ = {
          degraded: false,
          reason: '',
          expiresAt: Date.now() + ARCADE_DEGRADED_CACHE_TTL_MS,
          inFlight: false,
        };
      }
    } catch { /* best-effort */ }
  }

  return count;
}

/**
 * Map Arcade tool name to capability
 */
function mapArcadeToolToCapability(toolName: string, toolkit: string): string {
  const lowercaseName = toolName.toLowerCase();
  const lowercaseToolkit = (toolkit || '').toLowerCase();

  // GitHub toolkit
  if (lowercaseToolkit.includes('github')) {
    if (lowercaseName.includes('issue')) return 'repo.git';
    if (lowercaseName.includes('pr') || lowercaseName.includes('pull')) return 'repo.git';
    if (lowercaseName.includes('commit')) return 'repo.git';
    if (lowercaseName.includes('file')) return 'file.read';
  }

  // Gmail toolkit
  if (lowercaseToolkit.includes('gmail') || lowercaseToolkit.includes('google')) {
    if (lowercaseName.includes('send') || lowercaseName.includes('create')) return 'automation.workflow';
    if (lowercaseName.includes('read') || lowercaseName.includes('list')) return 'automation.workflow';
  }

  // Slack toolkit
  if (lowercaseToolkit.includes('slack')) {
    if (lowercaseName.includes('send') || lowercaseName.includes('post')) return 'automation.workflow';
    if (lowercaseName.includes('read')) return 'automation.workflow';
  }

  // File operations
  if (lowercaseName.includes('read') && lowercaseName.includes('file')) {
    return 'file.read';
  }
  if (lowercaseName.includes('write') && lowercaseName.includes('file')) {
    return 'file.write';
  }

  // Default: generic workflow
  return 'automation.workflow';
}

/**
 * Unregister all Arcade tools
 */
export async function unregisterArcadeTools(registry: ToolRegistry): Promise<void> {
  const tools = registry.getAllTools();
  const arcadeTools = tools.filter(t => t.provider === 'arcade');

  for (const tool of arcadeTools) {
    await registry.unregisterTool(tool.name);
  }

  arcadeInitialized = false;
  logger.info(`Unregistered ${arcadeTools.length} Arcade tools`);
}