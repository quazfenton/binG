/**
 * Phase 8: Runtime Broker — Bootstrap Registration
 *
 * Registers runtime broker capabilities for AI agent use:
 * - runtime.select_provider: Select optimal provider for execution
 * - runtime.cost_estimate: Estimate cost for running a workload
 * - runtime.provider_stats: Get provider statistics for observability
 *
 * The Runtime Broker replaces static execution policies with dynamic,
 * cost/latency/capacity/affinity-aware scheduling.
 */

import type { ToolRegistry } from '../registry';
import type { CapabilityRouter } from '../router';
import type { BootstrapConfig } from '../bootstrap';
import { createLogger } from '../../utils/logger';
import { getRuntimeBroker, type RuntimeBroker } from '../../sandbox/runtime-broker';
import type { SandboxProviderType } from '../../sandbox/providers';
import {
  RUNTIME_SELECT_PROVIDER_CAPABILITY,
  RUNTIME_COST_ESTIMATE_CAPABILITY,
  RUNTIME_PROVIDER_STATS_CAPABILITY,
} from '../capabilities';

const logger = createLogger('Bootstrap:RuntimeBroker');

/** Provider name for the runtime broker tool group */
const RUNTIME_BROKER_PROVIDER = 'runtime-broker';

// ==========================================================================
// Shared Handler Functions
// ==========================================================================
// These are used by BOTH the CapabilityRouter execute switch and the
// ToolRegistry tool handlers to avoid logic duplication.

async function handleSelectProvider(
  broker: RuntimeBroker,
  input: any,
  context: any,
) {
  const decision = await broker.selectProvider({
    interactive: input.interactive ?? true,
    cpu: input.cpu ?? 1,
    memory: input.memory ?? 0.5,
    gpu: input.gpu ?? false,
    expectedDuration: input.expectedDuration ?? 30,
    commandCategory: input.commandCategory,
    workspaceId: input.workspaceId || context?.workspaceId,
    costSensitivity: input.costSensitivity,
    performancePriority: input.performancePriority,
  });
  return { success: true, decision };
}

function handleCostEstimate(
  broker: RuntimeBroker,
  input: any,
) {
  const estimate = broker.getCostEstimate(
    {
      interactive: false,
      cpu: input.cpu ?? 1,
      memory: input.memory ?? 0.5,
      gpu: input.gpu ?? false,
      expectedDuration: input.expectedDuration ?? 60,
    },
    (input.provider as SandboxProviderType) || 'daytona',
  );
  return { success: true, estimate };
}

async function handleProviderStats(broker: RuntimeBroker) {
  const stats = await broker.getAllProviderStats();
  return {
    success: true,
    stats,
    summary: {
      totalProviders: stats.length,
      healthyProviders: stats.filter(s => !s.health.shouldDeprioritize).length,
      cheapestProvider: stats.sort((a, b) =>
        a.costModel.cpuCostPerMinute - b.costModel.cpuCostPerMinute
      )[0]?.provider || 'unknown',
      fastestProvider: stats
        .filter(s => s.latency.avgMs > 0)
        .sort((a, b) => a.latency.avgMs - b.latency.avgMs)[0]?.provider || 'unknown',
    },
  };
}

/**
 * Register runtime broker tools with the ToolRegistry and CapabilityRouter.
 * These tools are available for AI agents to query and schedule execution.
 */
export async function registerRuntimeBrokerTools(
  registry: ToolRegistry,
  config?: BootstrapConfig,
): Promise<number> {
  let count = 0;

  const broker = getRuntimeBroker();
  await broker.initialize();

  // ── CapabilityRouter provider registration ────────────────────────────
  // Required so that capabilities with providerPriority: ['runtime-broker']
  // can be resolved by the CapabilityRouter.
  try {
    const { getCapabilityRouter } = await import('../router');
    const router: CapabilityRouter = getCapabilityRouter();
    await router.registerCustomProvider({
      id: RUNTIME_BROKER_PROVIDER,
      name: 'Runtime Broker',
      capabilities: [
        RUNTIME_SELECT_PROVIDER_CAPABILITY.id,
        RUNTIME_COST_ESTIMATE_CAPABILITY.id,
        RUNTIME_PROVIDER_STATS_CAPABILITY.id,
      ],
      isAvailable: () => true,
      priority: 1,
      execute: async (capabilityId: string, input: any, context: any) => {
        switch (capabilityId) {
          case RUNTIME_SELECT_PROVIDER_CAPABILITY.id:
            return handleSelectProvider(broker, input, context);

          case RUNTIME_COST_ESTIMATE_CAPABILITY.id:
            return handleCostEstimate(broker, input);

          case RUNTIME_PROVIDER_STATS_CAPABILITY.id:
            return handleProviderStats(broker);

          default:
            throw new Error(`Unknown runtime broker capability: ${capabilityId}`);
        }
      },
    });
    logger.info('Runtime Broker provider registered with CapabilityRouter');
  } catch (err: any) {
    logger.warn('Runtime Broker CapabilityRouter registration skipped', err.message);
  }

  // ── runtime.select_provider (ToolRegistry) ─────────────────────────────
  await registry.registerTool({
    name: 'runtime.select_provider',
    capability: RUNTIME_SELECT_PROVIDER_CAPABILITY.id,
    provider: RUNTIME_BROKER_PROVIDER,
    handler: async (args: {
      interactive?: boolean;
      cpu?: number;
      memory?: number;
      gpu?: boolean;
      expectedDuration?: number;
      commandCategory?: string;
      workspaceId?: string;
      costSensitivity?: 'low' | 'medium' | 'high';
      performancePriority?: 'latency' | 'throughput' | 'balanced';
    }, context: any) => handleSelectProvider(broker, args, context),
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['runtime', 'broker', 'scheduling', 'phase8'],
    },
    permissions: ['runtime:select'],
  });
  count++;

  // ── runtime.cost_estimate (ToolRegistry) ───────────────────────────────
  await registry.registerTool({
    name: 'runtime.cost_estimate',
    capability: RUNTIME_COST_ESTIMATE_CAPABILITY.id,
    provider: RUNTIME_BROKER_PROVIDER,
    handler: async (args: {
      cpu?: number;
      memory?: number;
      gpu?: boolean;
      expectedDuration?: number;
      provider?: string;
    }, _context: any) => handleCostEstimate(broker, args),
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['runtime', 'cost', 'estimate', 'phase8'],
    },
    permissions: ['runtime:estimate'],
  });
  count++;

  // ── runtime.provider_stats (ToolRegistry) ──────────────────────────────
  await registry.registerTool({
    name: 'runtime.provider_stats',
    capability: RUNTIME_PROVIDER_STATS_CAPABILITY.id,
    provider: RUNTIME_BROKER_PROVIDER,
    handler: async (_args: any, _context: any) => handleProviderStats(broker),
    metadata: {
      latency: 'low',
      cost: 'low',
      reliability: 0.99,
      tags: ['runtime', 'stats', 'observability', 'phase8'],
    },
    permissions: ['runtime:stats'],
  });
  count++;

  logger.info(`Registered ${count} runtime broker tools`);
  return count;
}
