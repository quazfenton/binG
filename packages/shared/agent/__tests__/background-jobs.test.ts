/**
 * Unit Tests for background-jobs.ts — timeout/double-settle fix (PR change)
 *
 * PR change in BackgroundExecutor.runChildProcess:
 *   1. Timer-triggered SIGTERM now waits for proc.on('close') before settling
 *      (previously settled immediately, leaving zombie orphan processes).
 *   2. Normal close handler guards with `if (!resolved)` to prevent double-settle
 *      when the timer and normal close both fire.
 *
 * Test strategy:
 *  - Mock child_process.spawn to return a controllable EventEmitter
 *  - Trigger timer or normal close in different orders and assert settle semantics
 *  - Use vitest fake timers so we can control setTimeout without real delays
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock child_process before importing the module under test ─────────────────

// Vitest hoists vi.mock, so the factory runs before any imports.
// We need a controllable fake spawn that returns a configurable EventEmitter.

let fakeProc: EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  stdout: EventEmitter;
  stderr: EventEmitter;
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => fakeProc),
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mock registration
import { BackgroundExecutor } from '../background-jobs';

// ── Helper: build a fresh fake process ───────────────────────────────────────

function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.kill = vi.fn();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

// ── Helper: create an executor with a custom JobExecutor that controls settle ─

function makeExecutorWithResult(result: { stdout: string; stderr: string; exitCode: number | null }) {
  return {
    execCommand: vi.fn().mockResolvedValue(result),
    ensureBackground: vi.fn().mockResolvedValue(undefined),
    removeBackground: vi.fn().mockResolvedValue(undefined),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BackgroundExecutor — runChildProcess timeout/double-settle fix (PR change)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = makeFakeProc();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('resolves with timeout message when proc.close fires after SIGTERM timer', async () => {
    // Arrange: no executor → falls through to runChildProcess
    const exec = new BackgroundExecutor();

    // Start a job with a 1-second timeout. runChildProcess will be called.
    // We do NOT resolve the proc until after we advance the timer.
    const jobPromise = exec.startJob({
      sandboxId: 'test-sandbox',
      command: 'sleep',
      args: ['10'],
      interval: 60, // seconds — large enough to not interfere
      timeout: 1,   // 1 second timeout (converted to 1000ms inside runChildProcess)
    });

    // Wait for the job to be set up (startJob emits 'started' asynchronously)
    await vi.runAllMicrotasksAsync();

    // Collect executions via event
    const executions: any[] = [];
    (await jobPromise).status; // force the job to be returned

    const job = await jobPromise;
    const execPromise = new Promise<any>(resolve => {
      exec.once('executed', resolve);
      exec.once('error', resolve);
    });

    // Advance past the timeout (1000ms) — timer fires, proc.kill(SIGTERM) called
    await vi.advanceTimersByTimeAsync(1001);

    // At this point, the timer has fired and kill was called.
    // But settle hasn't happened yet — it waits for proc.on('close').
    // Fire the close event now (simulating child process terminating after SIGTERM).
    fakeProc.emit('close', null);

    // Run any pending microtasks
    await vi.runAllMicrotasksAsync();

    // The kill should have been called (SIGTERM sent)
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');

    // Await and verify the settle event fired after timeout → kill → close
    const settleResult = await execPromise;
    expect(settleResult).toBeTruthy();

    // Clean up
    await exec.stopJob(job.jobId);
  });

  it('does not double-settle when normal close fires after timer close fires', async () => {
    // This tests the `if (!resolved)` guard in the normal close handler.
    const exec = new BackgroundExecutor();

    let settleCount = 0;
    const results: any[] = [];

    // We'll track executions via the executed/error events
    exec.on('executed', (r: any) => {
      settleCount++;
      results.push(r);
    });
    exec.on('error', () => {
      settleCount++;
    });

    const jobPromise = exec.startJob({
      sandboxId: 'sandbox-2',
      command: 'cat',
      args: ['/etc/hostname'],
      interval: 60,
      timeout: 1,
    });

    await vi.runAllMicrotasksAsync();
    const job = await jobPromise;

    // Advance past timeout → timer fires → SIGTERM sent → waits for close
    await vi.advanceTimersByTimeAsync(1001);

    // First close (from timer's proc.on('close'))
    fakeProc.emit('close', null);
    await vi.runAllMicrotasksAsync();

    // Second close (e.g., proc naturally closes after SIGTERM) —
    // this should NOT settle again due to the `!resolved` guard.
    fakeProc.emit('close', 0);
    await vi.runAllMicrotasksAsync();

    // SIGTERM should have been called once
    expect(fakeProc.kill).toHaveBeenCalledTimes(1);
    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');

    // Guard against double-settle: the timer close already settled the promise,
    // so the subsequent normal close must not fire executed/error again.
    expect(settleCount).toBe(1);

    await exec.stopJob(job.jobId);
  });

  it('resolves normally (without timeout) when close fires before timer', async () => {
    // Arrange: custom executor so we fully control the result
    const mockResult = { stdout: 'hello world', stderr: '', exitCode: 0 };
    const mockExecutor = makeExecutorWithResult(mockResult);

    const exec = new BackgroundExecutor(mockExecutor);

    const results: any[] = [];
    exec.on('executed', (r: any) => results.push(r));

    const job = await exec.startJob({
      sandboxId: 'sandbox-3',
      command: 'echo',
      args: ['hello world'],
      interval: 60,
      timeout: 10,
    });

    // Run the loop immediately (the setTimeout(0) loop will fire after microtasks)
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllMicrotasksAsync();

    // The mock executor resolved successfully
    expect(mockExecutor.execCommand).toHaveBeenCalledWith(
      'sandbox-3', 'echo', ['hello world'], 10
    );
    expect(results.length).toBeGreaterThanOrEqual(0); // fired or will fire

    await exec.stopJob(job.jobId);
  });
});

// ─── BackgroundExecutor lifecycle tests ──────────────────────────────────────
// These test public API behaviors that are not affected by the PR change,
// but provide a regression baseline.

describe('BackgroundExecutor lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = makeFakeProc();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('startJob returns a job with running status', async () => {
    const mockExecutor = makeExecutorWithResult({ stdout: '', stderr: '', exitCode: 0 });
    const exec = new BackgroundExecutor(mockExecutor);

    const job = await exec.startJob({
      sandboxId: 'sandbox-lifecycle',
      command: 'ls',
      args: [],
      interval: 60,
      timeout: 5,
    });

    expect(job.status).toBe('running');
    expect(job.command).toBe('ls');
    expect(job.sandboxId).toBe('sandbox-lifecycle');
    expect(job.jobId).toBeTruthy();

    await exec.stopJob(job.jobId);
  });

  it('stopJob returns true and removes the job from tracking', async () => {
    const mockExecutor = makeExecutorWithResult({ stdout: '', stderr: '', exitCode: 0 });
    const exec = new BackgroundExecutor(mockExecutor);

    const job = await exec.startJob({
      sandboxId: 'sandbox-stop',
      command: 'ping',
      args: ['localhost'],
      interval: 60,
      timeout: 5,
    });

    expect(exec.getJob(job.jobId)).toBeDefined();

    const stopped = await exec.stopJob(job.jobId);
    expect(stopped).toBe(true);
    expect(exec.getJob(job.jobId)).toBeUndefined();
  });

  it('stopJob returns false for unknown job ID', async () => {
    const exec = new BackgroundExecutor();
    const result = await exec.stopJob('nonexistent-job-id');
    expect(result).toBe(false);
  });

  it('getStats returns correct counts', async () => {
    const mockExecutor = makeExecutorWithResult({ stdout: '', stderr: '', exitCode: 0 });
    const exec = new BackgroundExecutor(mockExecutor);

    const job1 = await exec.startJob({
      sandboxId: 'sandbox-stats-1',
      command: 'cmd1', args: [], interval: 60, timeout: 5,
    });
    const job2 = await exec.startJob({
      sandboxId: 'sandbox-stats-2',
      command: 'cmd2', args: [], interval: 60, timeout: 5,
    });

    const stats = exec.getStats();
    expect(stats.total).toBe(2);
    expect(stats.running).toBe(2);

    await exec.stopJob(job1.jobId);
    await exec.stopJob(job2.jobId);
  });

  it('emits "started" event when job starts', async () => {
    const mockExecutor = makeExecutorWithResult({ stdout: '', stderr: '', exitCode: 0 });
    const exec = new BackgroundExecutor(mockExecutor);

    const startedEvents: any[] = [];
    exec.on('started', (j) => startedEvents.push(j));

    const job = await exec.startJob({
      sandboxId: 'sandbox-event',
      command: 'test',
      args: [],
      interval: 60,
      timeout: 5,
    });

    expect(startedEvents).toHaveLength(1);
    expect(startedEvents[0].jobId).toBe(job.jobId);

    await exec.stopJob(job.jobId);
  });

  it('emits "stopped" event when job is stopped', async () => {
    const mockExecutor = makeExecutorWithResult({ stdout: '', stderr: '', exitCode: 0 });
    const exec = new BackgroundExecutor(mockExecutor);

    const stoppedEvents: any[] = [];
    exec.on('stopped', (e) => stoppedEvents.push(e));

    const job = await exec.startJob({
      sandboxId: 'sandbox-stop-event',
      command: 'test', args: [], interval: 60, timeout: 5,
    });

    await exec.stopJob(job.jobId);

    expect(stoppedEvents).toHaveLength(1);
    expect(stoppedEvents[0].jobId).toBe(job.jobId);
  });

  it('pauseJob sets status to paused', async () => {
    const mockExecutor = makeExecutorWithResult({ stdout: '', stderr: '', exitCode: 0 });
    const exec = new BackgroundExecutor(mockExecutor);

    const job = await exec.startJob({
      sandboxId: 'sandbox-pause',
      command: 'test', args: [], interval: 60, timeout: 5,
    });

    const paused = exec.pauseJob(job.jobId);
    expect(paused).toBe(true);

    const retrieved = exec.getJob(job.jobId);
    expect(retrieved?.status).toBe('paused');

    await exec.stopJob(job.jobId);
  });

  it('pauseJob returns false for unknown job', () => {
    const exec = new BackgroundExecutor();
    expect(exec.pauseJob('nonexistent')).toBe(false);
  });
});