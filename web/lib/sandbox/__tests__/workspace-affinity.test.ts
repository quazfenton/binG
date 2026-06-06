/**
 * Phase 6: Workspace Affinity Tests
 *
 * Tests the workspace-to-provider binding lifecycle:
 * - Affinity creation (setAffinity)
 * - Affinity lookup (getAffinity)
 * - Affinity TTL expiry
 * - Affinity touch (TTL extension)
 * - Affinity eviction
 * - Affinity stats (getAffinityStats)
 * - Affinity config (getAffinityConfig)
 * - Multiple workspace bindings
 * - Provider distribution in stats
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SandboxOrchestrator } from '../sandbox-orchestrator';

describe('Workspace Affinity — Binding Lifecycle', () => {
  let orchestrator: SandboxOrchestrator;

  beforeEach(() => {
    // Create a fresh orchestrator for each test
    orchestrator = new SandboxOrchestrator();
  });

  it('getAffinity returns null for unknown workspace', () => {
    const result = orchestrator.getAffinity('unknown-workspace');
    expect(result).toBeNull();
  });

  it('setAffinity creates a new binding', () => {
    const workspaceId = 'user1:conv1';
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace/users/user1');

    const binding = orchestrator.getAffinity(workspaceId);
    expect(binding).not.toBeNull();
    expect(binding!.provider).toBe('daytona');
    expect(binding!.sandboxId).toBe('sandbox-123');
    expect(binding!.workspaceDir).toBe('/workspace/users/user1');
    expect(binding!.commandCount).toBe(1);
    expect(binding!.boundAt).toBeLessThanOrEqual(Date.now());
    expect(binding!.lastUsedAt).toBeLessThanOrEqual(Date.now());
  });

  it('setAffinity increments commandCount on subsequent calls', () => {
    const workspaceId = 'user1:conv1';
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace');
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace');
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace');

    const binding = orchestrator.getAffinity(workspaceId);
    expect(binding!.commandCount).toBe(3);
  });

  it('setAffinity preserves original boundAt on update', () => {
    const workspaceId = 'user1:conv1';
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace');
    const firstBinding = orchestrator.getAffinity(workspaceId)!;

    // Wait a bit then update
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-456', '/workspace');
    const secondBinding = orchestrator.getAffinity(workspaceId)!;

    expect(secondBinding.boundAt).toBe(firstBinding.boundAt);
    expect(secondBinding.sandboxId).toBe('sandbox-456');
  });

  it('touchAffinity extends lastUsedAt', () => {
    const workspaceId = 'user1:conv1';
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace');
    const before = orchestrator.getAffinity(workspaceId)!.lastUsedAt;

    orchestrator.touchAffinity(workspaceId);
    const after = orchestrator.getAffinity(workspaceId)!.lastUsedAt;

    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('touchAffinity increments commandCount', () => {
    const workspaceId = 'user1:conv1';
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace');

    orchestrator.touchAffinity(workspaceId);
    orchestrator.touchAffinity(workspaceId);

    const binding = orchestrator.getAffinity(workspaceId);
    expect(binding!.commandCount).toBe(3); // 1 from set + 2 from touch
  });

  it('touchAffinity is a no-op for unknown workspace', () => {
    expect(() => orchestrator.touchAffinity('unknown')).not.toThrow();
  });

  it('evictAffinity removes the binding', () => {
    const workspaceId = 'user1:conv1';
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace');

    orchestrator.evictAffinity(workspaceId);

    expect(orchestrator.getAffinity(workspaceId)).toBeNull();
  });

  it('evictAffinity is a no-op for unknown workspace', () => {
    expect(() => orchestrator.evictAffinity('unknown')).not.toThrow();
  });
});

describe('Workspace Affinity — TTL Expiry', () => {
  let orchestrator: SandboxOrchestrator;

  beforeEach(() => {
    orchestrator = new SandboxOrchestrator();
  });

  it('getAffinity returns null for expired binding', () => {
    const workspaceId = 'user1:conv1';
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace');

    // Manually expire the binding by setting lastUsedAt far in the past
    const binding = orchestrator.getAffinity(workspaceId);
    expect(binding).not.toBeNull();

    // Use Reflect to set lastUsedAt (since it's readonly)
    const bindingsMap = (orchestrator as any).affinityBindings;
    const stored = bindingsMap.get(workspaceId);
    stored.lastUsedAt = Date.now() - 3600000; // 1 hour ago (TTL is 10 min)
    stored.ttl = 100; // 100ms TTL for fast expiry test
    bindingsMap.set(workspaceId, stored);

    const expired = orchestrator.getAffinity(workspaceId);
    expect(expired).toBeNull();
  });

  it('binding just before TTL expiry is still valid', () => {
    const workspaceId = 'user1:conv1';
    orchestrator.setAffinity(workspaceId, 'daytona', 'sandbox-123', '/workspace');

    // Set huge TTL so it doesn't expire
    const bindingsMap = (orchestrator as any).affinityBindings;
    const stored = bindingsMap.get(workspaceId);
    stored.ttl = 3600000; // 1 hour
    bindingsMap.set(workspaceId, stored);

    const binding = orchestrator.getAffinity(workspaceId);
    expect(binding).not.toBeNull();
  });
});

describe('Workspace Affinity — Stats and Config', () => {
  let orchestrator: SandboxOrchestrator;

  beforeEach(() => {
    orchestrator = new SandboxOrchestrator();
  });

  it('getAffinityStats returns empty state when no bindings', () => {
    const stats = orchestrator.getAffinityStats();
    expect(stats.activeBindings).toBe(0);
    expect(stats.totalCommands).toBe(0);
    expect(Object.keys(stats.providers).length).toBe(0);
  });

  it('getAffinityStats counts active bindings', () => {
    orchestrator.setAffinity('ws-1', 'daytona', 's-1', '/ws/1');
    orchestrator.setAffinity('ws-2', 'e2b', 's-2', '/ws/2');
    orchestrator.setAffinity('ws-3', 'daytona', 's-3', '/ws/3');

    const stats = orchestrator.getAffinityStats();
    expect(stats.activeBindings).toBe(3);
    expect(stats.totalCommands).toBe(3);
    expect(stats.providers['daytona']).toBe(2);
    expect(stats.providers['e2b']).toBe(1);
  });

  it('getAffinityStats excludes expired bindings', () => {
    orchestrator.setAffinity('ws-1', 'daytona', 's-1', '/ws/1');
    orchestrator.setAffinity('ws-2', 'e2b', 's-2', '/ws/2');

    // Expire ws-2
    const bindingsMap = (orchestrator as any).affinityBindings;
    const stored = bindingsMap.get('ws-2');
    stored.lastUsedAt = Date.now() - 3600000;
    stored.ttl = 100;
    bindingsMap.set('ws-2', stored);

    const stats = orchestrator.getAffinityStats();
    expect(stats.activeBindings).toBe(1);
    expect(stats.providers['daytona']).toBe(1);
    expect(stats.providers['e2b']).toBeUndefined();
  });

  it('getAffinityStats returns per-provider counts correctly', () => {
    orchestrator.setAffinity('ws-1', 'daytona', 's-1', '/ws/1');
    orchestrator.setAffinity('ws-2', 'daytona', 's-2', '/ws/2');
    orchestrator.setAffinity('ws-3', 'daytona', 's-3', '/ws/3');
    orchestrator.setAffinity('ws-4', 'e2b', 's-4', '/ws/4');
    orchestrator.setAffinity('ws-5', 'sprites', 's-5', '/ws/5');

    const stats = orchestrator.getAffinityStats();
    expect(stats.activeBindings).toBe(5);
    expect(stats.providers['daytona']).toBe(3);
    expect(stats.providers['e2b']).toBe(1);
    expect(stats.providers['sprites']).toBe(1);
    expect(stats.totalCommands).toBe(5);
  });

  it('getAffinityConfig returns configuration', () => {
    const config = orchestrator.getAffinityConfig();
    expect(config).toHaveProperty('enabled');
    expect(config).toHaveProperty('ttlMs');
    expect(typeof config.enabled).toBe('boolean');
    expect(typeof config.ttlMs).toBe('number');
    expect(config.ttlMs).toBeGreaterThan(0);
  });
});

describe('Workspace Affinity — Multiple Workspaces', () => {
  let orchestrator: SandboxOrchestrator;

  beforeEach(() => {
    orchestrator = new SandboxOrchestrator();
  });

  it('different workspaces have independent bindings', () => {
    orchestrator.setAffinity('user-a:conv-1', 'daytona', 's-a1', '/ws/a1');
    orchestrator.setAffinity('user-b:conv-1', 'e2b', 's-b1', '/ws/b1');

    const bindingA = orchestrator.getAffinity('user-a:conv-1');
    const bindingB = orchestrator.getAffinity('user-b:conv-1');

    expect(bindingA!.provider).toBe('daytona');
    expect(bindingB!.provider).toBe('e2b');
    expect(bindingA!.sandboxId).not.toBe(bindingB!.sandboxId);
  });

  it('evicting one workspace does not affect others', () => {
    orchestrator.setAffinity('ws-1', 'daytona', 's-1', '/ws/1');
    orchestrator.setAffinity('ws-2', 'e2b', 's-2', '/ws/2');
    orchestrator.setAffinity('ws-3', 'sprites', 's-3', '/ws/3');

    orchestrator.evictAffinity('ws-2');

    expect(orchestrator.getAffinity('ws-1')).not.toBeNull();
    expect(orchestrator.getAffinity('ws-2')).toBeNull();
    expect(orchestrator.getAffinity('ws-3')).not.toBeNull();
  });

  it('commandCount is per-binding, not global', () => {
    orchestrator.setAffinity('ws-1', 'daytona', 's-1', '/ws/1');
    orchestrator.setAffinity('ws-2', 'e2b', 's-2', '/ws/2');

    orchestrator.touchAffinity('ws-1');
    orchestrator.touchAffinity('ws-1');

    expect(orchestrator.getAffinity('ws-1')!.commandCount).toBe(3);
    expect(orchestrator.getAffinity('ws-2')!.commandCount).toBe(1);
  });
});

describe('Workspace Affinity — Edge Cases', () => {
  let orchestrator: SandboxOrchestrator;

  beforeEach(() => {
    orchestrator = new SandboxOrchestrator();
  });

  it('setAffinity with empty workspaceId works', () => {
    orchestrator.setAffinity('', 'daytona', 's-1', '/ws');
    const binding = orchestrator.getAffinity('');
    expect(binding).not.toBeNull();
  });

  it('setAffinity with very long workspaceId', () => {
    const longId = 'user-' + 'a'.repeat(500) + ':conv-' + 'b'.repeat(500);
    orchestrator.setAffinity(longId, 'daytona', 's-1', '/ws');
    const binding = orchestrator.getAffinity(longId);
    expect(binding).not.toBeNull();
    expect(binding!.workspaceId).toBe(longId);
  });

  it('multiple setAffinity calls with different providers updates provider', () => {
    const workspaceId = 'switching-ws';
    orchestrator.setAffinity(workspaceId, 'daytona', 's-1', '/ws');
    expect(orchestrator.getAffinity(workspaceId)!.provider).toBe('daytona');

    orchestrator.setAffinity(workspaceId, 'e2b', 's-2', '/ws');
    expect(orchestrator.getAffinity(workspaceId)!.provider).toBe('e2b');
    expect(orchestrator.getAffinity(workspaceId)!.commandCount).toBe(2);
  });

  it('getAffinityStats handles zero bindings gracefully', () => {
    const stats = orchestrator.getAffinityStats();
    expect(stats).toEqual({
      activeBindings: 0,
      providers: {},
      totalCommands: 0,
    });
  });
});
