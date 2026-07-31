import { describe, it, expect } from 'vitest';
import { acquireOrchSlot, releaseOrchSlot } from '@/lib/orchestra/unified-agent-service';

describe('Orchestrator concurrency limiter', () => {
  it('queues when concurrency exceeded and releases correctly', async () => {
    // This test assumes default ORCH_MAX_CONCURRENCY >= 3 (module default = 3).
    const initial = [acquireOrchSlot(), acquireOrchSlot(), acquireOrchSlot()];
    await Promise.all(initial);

    let resolved = false;
    const fourth = acquireOrchSlot().then(() => { resolved = true; });

    // Release one slot after a short delay so the queued waiter can proceed
    await new Promise<void>((res) => setTimeout(() => { releaseOrchSlot(); res(); }, 60));

    await fourth;
    expect(resolved).toBe(true);

    // Cleanup: release remaining slots we acquired earlier
    releaseOrchSlot();
    releaseOrchSlot();
    releaseOrchSlot();
  });
});
