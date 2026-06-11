/**
 * Integration test for createBashTool + shouldPersistBashOutput (Bug #28).
 *
 * Verifies the actual tool execute path consults shouldPersistBashOutput
 * and emits a [WARN] when persistence is refused (daemon or duration cap).
 * This is the integration-coverage gap flagged by the prior review — the
 * unit tests for shouldPersistBashOutput prove the helper, this proves the
 * wiring into the live tool flow.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the virtual filesystem so we don't hit real I/O.
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockListDirectory = vi.fn().mockResolvedValue({ nodes: [] });

vi.mock('@/lib/virtual-filesystem/index.server', () => ({
  virtualFilesystem: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    listDirectory: (...args: unknown[]) => mockListDirectory(...args),
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock the command router to fall through to normal execution path.
vi.mock('@/lib/terminal/commands/llm-bash-router', () => ({
  routeLLMCommand: () => ({ mode: 'sandbox' }),
  executeRoutedCommand: vi.fn(),
}));

vi.mock('child_process', () => {
  const EventEmitter = require('events');
  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter();
      (proc as any).stdout = new EventEmitter();
      (proc as any).stderr = new EventEmitter();
      (proc as any).stdin = { write: vi.fn(), end: vi.fn() };
      // Emit output then close
      setTimeout(() => {
        (proc as any).stdout.emit('data', Buffer.from('hello world\n'));
        (proc as any).emit('close', 0);
      }, 5);
      return proc;
    }),
  };
});

import { createBashTool } from '../bash-tool';
import { isCommandSafe } from '../bash-tool';

describe('createBashTool + shouldPersistBashOutput integration (Bug #28)', () => {
  let warnSpy: ReturnType<typeof vi.fn>;
  let tool: ReturnType<typeof createBashTool>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockClear();
    tool = createBashTool({ persistToVFS: true, maxPersistMs: 30000 });
    // Spy on the logger
    warnSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists output to VFS for short, non-daemon commands', async () => {
    const bash = tool.bash_execute;
    const result: any = await (bash as any).execute(
      { command: 'ls -la', persist: true },
      { threadId: 'test-thread' } as any
    );

    expect(result.success).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    // Output should be persisted at the VFS path
    const writeArgs = mockWriteFile.mock.calls[0];
    expect(writeArgs[1]).toMatch(/^\/workspace\/bash-outputs\//);
  });

  it('does NOT persist for daemon commands and logs a [WARN]', async () => {
    const bash = tool.bash_execute;
    const result: any = await (bash as any).execute(
      { command: 'nohup npm run dev', persist: true },
      { threadId: 'test-thread' } as any
    );

    expect(result.success).toBe(true);
    // VFS write should NOT have been called
    expect(mockWriteFile).not.toHaveBeenCalled();
    // Result should not have an outputPath (because we refused to persist)
    expect(result.outputPath).toBeUndefined();
  });

  it('does NOT persist for tail -f (foreground daemon)', async () => {
    const bash = tool.bash_execute;
    const result: any = await (bash as any).execute(
      { command: 'tail -f /var/log/syslog', persist: true },
      { threadId: 'test-thread' } as any
    );

    expect(result.success).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('does NOT persist for short ping without -c', async () => {
    const bash = tool.bash_execute;
    const result: any = await (bash as any).execute(
      { command: 'ping google.com', persist: true },
      { threadId: 'test-thread' } as any
    );

    expect(result.success).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('still persists when persist:false is passed (caller opted out)', async () => {
    const bash = tool.bash_execute;
    await (bash as any).execute(
      { command: 'ls -la', persist: false },
      { threadId: 'test-thread' } as any
    );

    // With persist=false the daemon/duration check is skipped entirely.
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('result omits outputPath when persistence is refused', async () => {
    const bash = tool.bash_execute;
    const result: any = await (bash as any).execute(
      { command: 'npm run dev &', persist: true },
      { threadId: 'test-thread' } as any
    );

    expect(result.outputPath).toBeUndefined();
  });
});
