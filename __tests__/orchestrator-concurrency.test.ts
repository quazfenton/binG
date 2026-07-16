import { describe, it, expect } from 'vitest';
import { acquireOrchSlot, releaseOrchSlot } from '@/lib/orchestra/unified-agent-service';

describe('Orchestrator concurrency limiter (root)', () => {
  it('queues when concurrency exceeded and releases correctly', async () => {
    const initial = [acquireOrchSlot(), acquireOrchSlot(), acquireOrchSlot()];
    await Promise.all(initial);

    let resolved = false;
    const fourth = acquireOrchSlot().then(() => { resolved = true; });

    await new Promise<void>((res) => setTimeout(() => { releaseOrchSlot(); res(); }, 60));

    await fourth;
    expect(resolved).toBe(true);

    releaseOrchSlot();
    releaseOrchSlot();
    releaseOrchSlot();
  });
});
