/**
 * Unit tests for WorkspacePreviewRegistry — EventEmitter events
 *
 * Verifies that the registry emits correct events at each lifecycle point:
 *   - 'preview:registered' on new registration
 *   - 'preview:updated' on status change
 *   - 'preview:removed' on removal
 *   - 'workspace:cleared' on clearWorkspace
 *   - No event on no-op dedup
 *   - markStale emits 'preview:updated' with status='stale'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the previewRouter to avoid side effects during tests
vi.mock('@/lib/previews/preview-router', () => ({
  previewRouter: {
    registerPreview: vi.fn().mockResolvedValue(undefined),
    unregisterPreview: vi.fn().mockResolvedValue(undefined),
  },
}));

import { WorkspacePreviewRegistry } from '@/lib/terminal/workspace-preview-registry';
import type { PortDetectionResult } from '@/lib/previews/enhanced-port-detector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePort(overrides: Partial<PortDetectionResult> = {}): PortDetectionResult {
  return {
    port: 3000,
    protocol: 'http',
    confidence: 'high',
    url: 'http://localhost:3000',
    ...overrides,
  };
}

function makeRegisterParams(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'ws-1',
    serviceId: 'svc-1',
    serviceName: 'nextjs',
    port: makePort(),
    provider: 'e2b' as const,
    sandboxId: 'sandbox-123',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspacePreviewRegistry — EventEmitter events', () => {
  let registry: WorkspacePreviewRegistry;

  beforeEach(() => {
    // Fresh registry per test
    registry = new WorkspacePreviewRegistry();
    vi.clearAllMocks();
  });

  // ====================================================================
  // 'preview:registered'
  // ====================================================================

  it("should emit 'preview:registered' when a new preview is registered", () => {
    const handler = vi.fn();
    registry.on('preview:registered', handler);

    registry.registerPreview(makeRegisterParams());

    expect(handler).toHaveBeenCalledTimes(1);
    const emitted = handler.mock.calls[0][0];
    expect(emitted.id).toMatch(/^preview-/);
    expect(emitted.workspaceId).toBe('ws-1');
    expect(emitted.serviceId).toBe('svc-1');
    expect(emitted.serviceName).toBe('nextjs');
    expect(emitted.port).toBe(3000);
    expect(emitted.status).toBe('active'); // high confidence → starts active
    expect(emitted.url).toBe('https://3000-sandbox-123.e2b.dev/');
    expect(emitted.provider).toBe('e2b');
    expect(emitted.sandboxId).toBe('sandbox-123');
  });

  it("should NOT emit 'preview:registered' when the same preview is re-registered (dedup)", () => {
    const handler = vi.fn();
    registry.on('preview:registered', handler);

    const params = makeRegisterParams();
    registry.registerPreview(params);
    expect(handler).toHaveBeenCalledTimes(1); // first call

    // Re-register with identical params
    registry.registerPreview(params);
    expect(handler).toHaveBeenCalledTimes(1); // still 1 — no new event
  });

  it("should NOT emit 'preview:updated' on no-op dedup when nothing changes", () => {
    const updatedHandler = vi.fn();
    registry.on('preview:updated', updatedHandler);

    const params = makeRegisterParams();
    registry.registerPreview(params);
    expect(updatedHandler).toHaveBeenCalledTimes(0); // first registration emits 'registered', not 'updated'

    // Re-register with same high confidence → nothing changes
    registry.registerPreview(params);
    expect(updatedHandler).toHaveBeenCalledTimes(0); // no change, no event
  });

  it("should emit 'preview:updated' on dedup when confidence is bumped from low to high", () => {
    const updatedHandler = vi.fn();
    registry.on('preview:updated', updatedHandler);

    // Register with low confidence first
    registry.registerPreview(makeRegisterParams({
      port: makePort({ confidence: 'low' }),
    }));

    // Re-register with high confidence → should emit 'preview:updated'
    registry.registerPreview(makeRegisterParams());

    expect(updatedHandler).toHaveBeenCalledTimes(1);
    const emitted = updatedHandler.mock.calls[0][0];
    expect(emitted.confidence).toBe('high');
  });

  it("should emit 'preview:updated' on dedup when status transitions from starting → active", () => {
    const updatedHandler = vi.fn();
    registry.on('preview:updated', updatedHandler);

    // Register with medium confidence → status = 'starting'
    registry.registerPreview(makeRegisterParams({
      port: makePort({ confidence: 'medium' }),
    }));

    // Re-register with same medium confidence → status should remain 'starting', no change
    // (since we only transition starting→active when confidence is bumped, but
    //  the implementation checks `existing.status === 'starting'` regardless)
    // Actually the implementation transitions if existing.status === 'starting', even
    // if confidence stays the same. But since we re-register with medium again,
    // no confidence bump happens. However, the status transition check is separate.
    // Let me check... the code does:
    //   if (existing.status === 'starting') { existing.status = 'active'; changed = true; }
    // So any re-detection when status is 'starting' will transition to 'active'.

    registry.registerPreview(makeRegisterParams({
      port: makePort({ confidence: 'medium' }),
    }));

    expect(updatedHandler).toHaveBeenCalledTimes(1);
    const emitted = updatedHandler.mock.calls[0][0];
    expect(emitted.status).toBe('active');
  });

  // ====================================================================
  // 'preview:updated'
  // ====================================================================

  it("should emit 'preview:updated' when updateStatus is called", () => {
    const updatedHandler = vi.fn();
    registry.on('preview:updated', updatedHandler);

    const preview = registry.registerPreview(makeRegisterParams());
    // Clear the registered handler state (we only care about updated)
    updatedHandler.mockClear();

    registry.updateStatus(preview.id, 'ws-1', 'unreachable');
    expect(updatedHandler).toHaveBeenCalledTimes(1);
    expect(updatedHandler.mock.calls[0][0].status).toBe('unreachable');
  });

  it("should emit 'preview:updated' for each status transition", () => {
    const updatedHandler = vi.fn();
    registry.on('preview:updated', updatedHandler);

    const preview = registry.registerPreview(makeRegisterParams());
    updatedHandler.mockClear();

    registry.updateStatus(preview.id, 'ws-1', 'stopped');
    expect(updatedHandler).toHaveBeenCalledTimes(1);
    expect(updatedHandler.mock.calls[0][0].status).toBe('stopped');

    updatedHandler.mockClear();
    registry.updateStatus(preview.id, 'ws-1', 'active');
    expect(updatedHandler).toHaveBeenCalledTimes(1);
    expect(updatedHandler.mock.calls[0][0].status).toBe('active');
    expect(updatedHandler.mock.calls[0][0].lastReachableAt).toBeGreaterThan(0);
  });

  // ====================================================================
  // markStale → 'preview:updated'
  // ====================================================================

  it("should emit 'preview:updated' with status='stale' when markStale is called", () => {
    const updatedHandler = vi.fn();
    registry.on('preview:updated', updatedHandler);

    const preview = registry.registerPreview(makeRegisterParams());
    updatedHandler.mockClear();

    registry.markStale(preview.id, 'ws-1');

    expect(updatedHandler).toHaveBeenCalledTimes(1);
    const emitted = updatedHandler.mock.calls[0][0];
    expect(emitted.id).toBe(preview.id);
    expect(emitted.status).toBe('stale');
  });

  it('markStale should be a no-op for non-existent previews', () => {
    const updatedHandler = vi.fn();
    registry.on('preview:updated', updatedHandler);

    registry.markStale('nonexistent', 'ws-1');

    expect(updatedHandler).toHaveBeenCalledTimes(0);
  });

  // ====================================================================
  // 'preview:removed'
  // ====================================================================

  it("should emit 'preview:removed' when a preview is removed", () => {
    const removedHandler = vi.fn();
    registry.on('preview:removed', removedHandler);

    const preview = registry.registerPreview(makeRegisterParams());
    registry.removePreview(preview.id, 'ws-1');

    expect(removedHandler).toHaveBeenCalledTimes(1);
    const payload = removedHandler.mock.calls[0][0];
    expect(payload.preview.id).toBe(preview.id);
    expect(payload.workspaceId).toBe('ws-1');
  });

  it("should NOT emit 'preview:removed' when removing a non-existent preview", () => {
    const removedHandler = vi.fn();
    registry.on('preview:removed', removedHandler);

    const result = registry.removePreview('nonexistent', 'ws-1');
    expect(result).toBe(false);
    expect(removedHandler).toHaveBeenCalledTimes(0);
  });

  // ====================================================================
  // 'workspace:cleared'
  // ====================================================================

  it("should emit 'workspace:cleared' when a workspace is cleared", () => {
    const clearedHandler = vi.fn();
    registry.on('workspace:cleared', clearedHandler);

    // Register two previews in the same workspace
    registry.registerPreview(makeRegisterParams({ serviceId: 'svc-1' }));
    registry.registerPreview(makeRegisterParams({ serviceId: 'svc-2' }));

    registry.clearWorkspace('ws-1');

    expect(clearedHandler).toHaveBeenCalledTimes(1);
    expect(clearedHandler.mock.calls[0][0].workspaceId).toBe('ws-1');

    // After clearing, workspace should have no previews
    expect(registry.getWorkspacePreviews('ws-1')).toHaveLength(0);
  });

  it("should emit 'workspace:cleared' even for an empty workspace", () => {
    const clearedHandler = vi.fn();
    registry.on('workspace:cleared', clearedHandler);

    registry.clearWorkspace('ws-1');

    expect(clearedHandler).toHaveBeenCalledTimes(1);
    expect(clearedHandler.mock.calls[0][0].workspaceId).toBe('ws-1');
  });

  // ====================================================================
  // Event independence — listeners only receive what they subscribe to
  // ====================================================================

  it('different event types are independent', () => {
    const registeredHandler = vi.fn();
    const updatedHandler = vi.fn();
    const removedHandler = vi.fn();

    registry.on('preview:registered', registeredHandler);
    registry.on('preview:updated', updatedHandler);
    registry.on('preview:removed', removedHandler);

    const preview = registry.registerPreview(makeRegisterParams());

    // Only 'registered' should fire on new registration
    expect(registeredHandler).toHaveBeenCalledTimes(1);
    expect(updatedHandler).toHaveBeenCalledTimes(0);
    expect(removedHandler).toHaveBeenCalledTimes(0);

    // reset for next action
    registeredHandler.mockClear();

    registry.updateStatus(preview.id, 'ws-1', 'stopped');

    // Only 'updated' should fire on status change
    expect(registeredHandler).toHaveBeenCalledTimes(0);
    expect(updatedHandler).toHaveBeenCalledTimes(1);
    expect(removedHandler).toHaveBeenCalledTimes(0);

    updatedHandler.mockClear();

    registry.removePreview(preview.id, 'ws-1');

    // Only 'removed' should fire on removal
    expect(registeredHandler).toHaveBeenCalledTimes(0);
    expect(updatedHandler).toHaveBeenCalledTimes(0);
    expect(removedHandler).toHaveBeenCalledTimes(1);
  });

  // ====================================================================
  // Multiple listeners
  // ====================================================================

  it('should notify all listeners of the same event type', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();

    registry.on('preview:registered', handler1);
    registry.on('preview:registered', handler2);
    registry.on('preview:registered', handler3);

    registry.registerPreview(makeRegisterParams());

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler3).toHaveBeenCalledTimes(1);
  });

  // ====================================================================
  // off() correctly removes listeners
  // ====================================================================

  it('off() should correctly remove a listener', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    registry.on('preview:registered', handler1);
    registry.on('preview:registered', handler2);

    // Remove handler1
    registry.off('preview:registered', handler1);

    registry.registerPreview(makeRegisterParams());

    expect(handler1).toHaveBeenCalledTimes(0);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  // ====================================================================
  // Workspace isolation
  // ====================================================================

  it('clearWorkspace should not affect other workspaces', () => {
    registry.registerPreview(makeRegisterParams({ workspaceId: 'ws-1', serviceId: 'svc-a' }));
    registry.registerPreview(makeRegisterParams({ workspaceId: 'ws-2', serviceId: 'svc-b' }));

    registry.clearWorkspace('ws-1');

    // ws-1 is empty
    expect(registry.getWorkspacePreviews('ws-1')).toHaveLength(0);
    // ws-2 is untouched
    expect(registry.getWorkspacePreviews('ws-2')).toHaveLength(1);
    expect(registry.getWorkspacePreviews('ws-2')[0].serviceId).toBe('svc-b');
  });

  // ====================================================================
  // getStats
  // ====================================================================

  it('getStats should reflect current registry state', () => {
    const preview1 = registry.registerPreview(makeRegisterParams({ serviceId: 'svc-1' }));
    const preview2 = registry.registerPreview(makeRegisterParams({
      serviceId: 'svc-2',
      port: makePort({ port: 4000 }),
    }));

    let stats = registry.getStats();
    expect(stats.totalPreviews).toBe(2);
    expect(stats.activePreviews).toBe(2);

    registry.updateStatus(preview1.id, 'ws-1', 'unreachable');
    stats = registry.getStats();
    expect(stats.activePreviews).toBe(1);
    expect(stats.unreachablePreviews).toBe(1);

    registry.removePreview(preview2.id, 'ws-1');
    stats = registry.getStats();
    expect(stats.totalPreviews).toBe(1);
  });
});
