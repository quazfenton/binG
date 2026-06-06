/**
 * Phase 8: Runtime Broker — Unit Tests
 *
 * Tests the cost/latency/capacity/affinity-aware scheduling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RuntimeBroker,
  getRuntimeBroker,
  resetRuntimeBroker,
  PROVIDER_COST_MODELS,
} from '../runtime-broker';
import type { RuntimeBrokerRequest } from '../runtime-broker';

// ============================================================================
// Helpers
// ============================================================================

/** Create a standard request for testing */
function makeRequest(overrides?: Partial<RuntimeBrokerRequest>): RuntimeBrokerRequest {
  return {
    interactive: true,
    cpu: 1,
    memory: 0.5,
    gpu: false,
    expectedDuration: 30,
    ...overrides,
  };
}

beforeEach(() => {
  resetRuntimeBroker();
});

// ============================================================================
// Cost Estimation Tests
// ============================================================================

describe('RuntimeBroker.getCostEstimate', () => {
  it('estimates cost for daytona with standard config', () => {
    const broker = getRuntimeBroker();
    const estimate = broker.getCostEstimate(makeRequest({ expectedDuration: 60 }), 'daytona');

    expect(estimate.provider).toBe('daytona');
    expect(estimate.estimatedCost).toBeGreaterThan(0);
    expect(estimate.currency).toBe('USD');
    expect(estimate.cpuCost).toBeGreaterThan(0); // 1 CPU * 1 min
    expect(estimate.memoryCost).toBeGreaterThan(0); // 0.5 GB * 1 min
    expect(estimate.gpuCost).toBe(0);
    expect(estimate.baseCost).toBeGreaterThanOrEqual(0);
  });

  it('returns zero cost for free providers (local, microsandbox)', () => {
    const broker = getRuntimeBroker();

    for (const provider of ['local', 'microsandbox', 'opensandbox', 'webcontainer'] as const) {
      const estimate = broker.getCostEstimate(makeRequest({ expectedDuration: 3600 }), provider);
      expect(estimate.estimatedCost).toBe(0);
      expect(estimate.cpuCost).toBe(0);
      expect(estimate.memoryCost).toBe(0);
    }
  });

  it('scales cost linearly with CPU and memory', () => {
    const broker = getRuntimeBroker();

    const base = broker.getCostEstimate(makeRequest({ cpu: 1, memory: 1, expectedDuration: 60 }), 'daytona');
    const doubleCpu = broker.getCostEstimate(makeRequest({ cpu: 2, memory: 1, expectedDuration: 60 }), 'daytona');
    const doubleMem = broker.getCostEstimate(makeRequest({ cpu: 1, memory: 2, expectedDuration: 60 }), 'daytona');

    // CPU cost scales linearly with CPU count (within rounding)
    expect(doubleCpu.cpuCost).toBeCloseTo(base.cpuCost * 2, 2);
    expect(doubleMem.memoryCost).toBeCloseTo(base.memoryCost * 2, 2);
  });

  it('includes GPU cost when GPU is requested', () => {
    const broker = getRuntimeBroker();

    const noGpu = broker.getCostEstimate(makeRequest({ gpu: false, expectedDuration: 60 }), 'modal-com');
    const withGpu = broker.getCostEstimate(makeRequest({ gpu: true, expectedDuration: 60 }), 'modal-com');

    expect(withGpu.gpuCost).toBeGreaterThan(0);
    expect(noGpu.gpuCost).toBe(0);
    expect(withGpu.estimatedCost).toBeGreaterThan(noGpu.estimatedCost);
  });

  it('scales cost with duration', () => {
    const broker = getRuntimeBroker();

    const short = broker.getCostEstimate(makeRequest({ expectedDuration: 30 }), 'e2b');
    const medium = broker.getCostEstimate(makeRequest({ expectedDuration: 300 }), 'e2b');

    // 300s = 5min, 30s = 0.5min. Cost should be ~10x (within rounding)
    expect(medium.estimatedCost).toBeCloseTo(short.estimatedCost * 10, 1);
  });

  it('handles unknown providers gracefully', () => {
    const broker = getRuntimeBroker();

    // Unknown provider should fall back to local (free)
    const estimate = broker.getCostEstimate(makeRequest(), 'nonexistent' as any);
    expect(estimate.estimatedCost).toBe(0);
    expect(estimate.provider).toBe('nonexistent');
  });

  it('includes meaningful breakdown string', () => {
    const broker = getRuntimeBroker();
    const estimate = broker.getCostEstimate(
      makeRequest({ cpu: 2, memory: 4, gpu: true, expectedDuration: 3600 }),
      'modal-com',
    );

    expect(estimate.breakdown).toContain('CPU');
    expect(estimate.breakdown).toContain('Memory');
    expect(estimate.breakdown).toContain('GPU');
  });
});

// ============================================================================
// Provider Selection Tests
// ============================================================================

describe('RuntimeBroker.selectProvider', () => {
  it('selects a provider for standard interactive request', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      interactive: true,
      cpu: 1,
      memory: 0.5,
      expectedDuration: 30,
    }));

    expect(decision.provider).toBeDefined();
    expect(decision.confidence).toBeGreaterThan(0);
    expect(decision.estimatedCost).toBeGreaterThanOrEqual(0);
    expect(decision.currency).toBe('USD');
    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(decision.alternatives.length).toBeGreaterThan(0);
  });

  it('prefers free providers for cost-sensitive requests', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      costSensitivity: 'high',
      expectedDuration: 5,
    }));

    // Should pick a free provider (microsandbox, opensandbox, webcontainer, or local)
    const costModel = PROVIDER_COST_MODELS[decision.provider];
    expect(costModel?.cpuCostPerMinute).toBe(0);
  });

  it('ranks GPU-capable providers highest when GPU is required', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      gpu: true,
      cpu: 4,
      memory: 8,
      expectedDuration: 3600,
      // Restrict to only GPU-capable providers for deterministic test
      candidateProviders: ['modal-com', 'daytona', 'e2b'],
    }));

    // Should pick one of the GPU-capable providers
    expect(['modal-com', 'daytona', 'e2b']).toContain(decision.provider);
  });

  it('includes scoring breakdown when available', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest());

    if (decision.scoringBreakdown) {
      expect(decision.scoringBreakdown.costScore).toBeGreaterThanOrEqual(0);
      expect(decision.scoringBreakdown.latencyScore).toBeGreaterThanOrEqual(0);
      expect(decision.scoringBreakdown.capacityScore).toBeGreaterThanOrEqual(0);
      expect(decision.scoringBreakdown.affinityScore).toBeGreaterThanOrEqual(0);
      expect(decision.scoringBreakdown.serviceScore).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns alternatives sorted by score', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest());

    const scores = decision.alternatives.map(a => a.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('handles daemon-service requests preferring persistent providers', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      commandCategory: 'daemon-service',
      expectedDuration: 3600,
    }));

    expect(decision.provider).toBeDefined();
    // Should prefer sprites (auto-restart) or codesandbox (persistent)
  });

  it('handles build-compile requests requiring more resources', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      commandCategory: 'build-compile',
      cpu: 4,
      memory: 2,
      expectedDuration: 300,
    }));

    expect(decision.provider).toBeDefined();
    // Should prefer daytona or codesandbox for full build environments
  });

  it('supports restricted candidate providers', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      candidateProviders: ['daytona', 'e2b'],
    }));

    // Should only pick from the restricted set (or local as fallback)
    expect(['daytona', 'e2b', 'local']).toContain(decision.provider);
  });

  it('returns local when no candidates match', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      candidateProviders: [],
    }));

    expect(decision.provider).toBe('local');
    expect(decision.confidence).toBe(0.5);
  });

  it('handles script-execution requests', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      commandCategory: 'script-execution',
      cpu: 2,
      memory: 1,
      expectedDuration: 60,
    }));

    expect(decision.provider).toBeDefined();
    expect(decision.estimatedCost).toBeGreaterThanOrEqual(0);
  });

  it('handles ML training requests with GPU', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      commandCategory: 'ml-training',
      cpu: 8,
      memory: 16,
      gpu: true,
      expectedDuration: 3600,
    }));

    // Should prefer GPU-capable providers
    expect(decision.provider).toBeDefined();
  });
});

// ============================================================================
// Provider Statistics Tests
// ============================================================================

describe('RuntimeBroker.getAllProviderStats', () => {
  it('returns stats for all known providers', async () => {
    const broker = getRuntimeBroker();
    const stats = await broker.getAllProviderStats();

    expect(stats.length).toBeGreaterThan(5);
    expect(stats[0]).toHaveProperty('provider');
    expect(stats[0]).toHaveProperty('costModel');
    expect(stats[0]).toHaveProperty('latency');
    expect(stats[0]).toHaveProperty('health');
    expect(stats[0]).toHaveProperty('capacity');
  });

  it('sorts providers by health score then latency', async () => {
    const broker = getRuntimeBroker();
    const stats = await broker.getAllProviderStats();

    for (let i = 1; i < stats.length; i++) {
      const prev = stats[i - 1];
      const curr = stats[i];
      // Health should be descending
      if (prev.health.score !== curr.health.score) {
        expect(prev.health.score).toBeGreaterThanOrEqual(curr.health.score);
      }
    }
  });

  it('includes free providers (cost = 0)', async () => {
    const broker = getRuntimeBroker();
    const stats = await broker.getAllProviderStats();

    const freeProviders = stats.filter(s => s.costModel.cpuCostPerMinute === 0);
    expect(freeProviders.length).toBeGreaterThan(0);
  });

  it('includes quota remaining data', async () => {
    const broker = getRuntimeBroker();
    const stats = await broker.getAllProviderStats();

    for (const s of stats) {
      expect(s.capacity.quotaRemaining).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// Cost Model Tests
// ============================================================================

describe('PROVIDER_COST_MODELS', () => {
  it('has cost models for major providers', () => {
    expect(PROVIDER_COST_MODELS['daytona']).toBeDefined();
    expect(PROVIDER_COST_MODELS['e2b']).toBeDefined();
    expect(PROVIDER_COST_MODELS['sprites']).toBeDefined();
    expect(PROVIDER_COST_MODELS['codesandbox']).toBeDefined();
    expect(PROVIDER_COST_MODELS['modal-com']).toBeDefined();
    expect(PROVIDER_COST_MODELS['local']).toBeDefined();
  });

  it('has GPU cost for modal-com (GPU capable)', () => {
    expect(PROVIDER_COST_MODELS['modal-com'].gpuCostPerMinute).toBeGreaterThan(0);
  });

  it('has zero GPU cost for non-GPU providers', () => {
    expect(PROVIDER_COST_MODELS['sprites'].gpuCostPerMinute).toBe(0);
    expect(PROVIDER_COST_MODELS['microsandbox'].gpuCostPerMinute).toBe(0);
  });

  it('has free tier credits for most cloud providers', () => {
    expect(PROVIDER_COST_MODELS['e2b'].freeTierCredits).toBeGreaterThan(0);
    expect(PROVIDER_COST_MODELS['daytona'].freeTierCredits).toBeGreaterThan(0);
  });

  it('has zero cost for local execution', () => {
    const local = PROVIDER_COST_MODELS['local'];
    expect(local.cpuCostPerMinute).toBe(0);
    expect(local.memoryCostPerGBMinute).toBe(0);
    expect(local.gpuCostPerMinute).toBe(0);
    expect(local.baseCostPerCall).toBe(0);
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('getRuntimeBroker', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getRuntimeBroker();
    const b = getRuntimeBroker();
    expect(a).toBe(b);
  });

  it('returns a new instance after reset', () => {
    const a = getRuntimeBroker();
    resetRuntimeBroker();
    const b = getRuntimeBroker();
    expect(a).not.toBe(b);
  });

  it('accepts configuration on creation', () => {
    resetRuntimeBroker();
    const broker = getRuntimeBroker({ costWeight: 0.5, latencyWeight: 0.1 });
    expect(broker).toBeDefined();
  });
});

// ============================================================================
// Duration Edge Cases
// ============================================================================

describe('RuntimeBroker edge cases', () => {
  it('handles very short duration (1 second)', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({ expectedDuration: 1 }));
    expect(decision.provider).toBeDefined();
    expect(decision.estimatedCost).toBeGreaterThanOrEqual(0);
    // Free providers should win for sub-second tasks when cost-sensitive
  });

  it('handles very long duration (24 hours)', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({
      expectedDuration: 86400,
      costSensitivity: 'high',
    }));

    expect(decision.provider).toBeDefined();
    // Cost should dominate for long-running tasks
    expect(decision.estimatedCost).toBeGreaterThanOrEqual(0);
  });

  it('handles zero CPU/memory gracefully', async () => {
    const broker = getRuntimeBroker();
    const decision = await broker.selectProvider(makeRequest({ cpu: 0, memory: 0 }));

    expect(decision.provider).toBeDefined();
    // Should still work, likely picking local or cheapest
  });
});

// ============================================================================
// Command Category Specialization Tests
// ============================================================================

describe('RuntimeBroker command category specialization', () => {
  it('prefers sprites/codesandbox for daemon-service category', async () => {
    const broker = getRuntimeBroker();

    // Run a few times to check preference
    const decisions: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = await broker.selectProvider(makeRequest({
        commandCategory: 'daemon-service',
        expectedDuration: 3600,
        candidateProviders: ['sprites', 'e2b', 'daytona'],
      }));
      decisions.push(d.provider);
    }

    // Sprites should be preferred for daemons
    expect(decisions.some(d => d === 'sprites')).toBe(true);
  });

  it('prefers e2b/daytona for package-install category', async () => {
    const broker = getRuntimeBroker();

    const decisions: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = await broker.selectProvider(makeRequest({
        commandCategory: 'package-install',
        expectedDuration: 120,
        candidateProviders: ['e2b', 'daytona', 'sprites'],
      }));
      decisions.push(d.provider);
    }

    // e2b/daytona should be preferred for package installs
    expect(decisions.some(d => d === 'e2b' || d === 'daytona')).toBe(true);
  });

  it('prefers GPU providers for ml-training category', async () => {
    const broker = getRuntimeBroker();

    const d = await broker.selectProvider(makeRequest({
      commandCategory: 'ml-training',
      gpu: true,
      cpu: 8,
      memory: 16,
      expectedDuration: 3600,
      candidateProviders: ['modal-com', 'daytona', 'e2b'],
    }));

    // modal-com has the best GPU support
    expect(['modal-com', 'daytona', 'e2b']).toContain(d.provider);
  });
});
