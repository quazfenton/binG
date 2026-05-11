/**
 * Workforce State — Lifecycle Integration Tests
 *
 * Exercises the full workforce lifecycle end-to-end:
 * - loadState (ENOENT → initializes DEFAULT_STATE, persists it)
 * - addTask (reads existing, adds task, persists)
 * - updateTask (reads existing, updates task, persists)
 * - saveState (serializes to YAML, writes to VFS)
 *
 * Uses a real in-memory VFS mock that tracks written content so we can
 * verify that STATE.yaml is persisted correctly with valid YAML.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import yaml from 'js-yaml';

/**
 * In-memory VFS mock that tracks write calls and content.
 * Simulates real file I/O so we can verify persistence.
 */
class LifecycleVFSMock {
  private files = new Map<string, { content: string }>();

  readFile = vi.fn(async (ownerId: string, filePath: string) => {
    const key = `${ownerId}:${filePath}`;
    const file = this.files.get(key);
    if (!file) {
      const err = new Error(`File not found: ${filePath}`) as any;
      err.code = 'ENOENT';
      throw err;
    }
    return file;
  });

  writeFile = vi.fn(async (ownerId: string, filePath: string, content: string) => {
    const key = `${ownerId}:${filePath}`;
    this.files.set(key, { content });
    this.writtenContent = content; // track last written for verification
    this.writeCallCount++;
  });

  // Verification helpers
  writtenContent: string | null = null;
  writeCallCount = 0;

  getFile(ownerId: string, filePath: string) {
    return this.files.get(`${ownerId}:${filePath}`);
  }

  reset() {
    this.files.clear();
    this.writtenContent = null;
    this.writeCallCount = 0;
    this.readFile.mockClear();
    this.writeFile.mockClear();
  }
}

describe('WorkforceState — Full Lifecycle Integration', () => {
  let vfsMock: LifecycleVFSMock;
  let loadState: typeof import('../workforce-state').loadState;
  let saveState: typeof import('../workforce-state').saveState;
  let addTask: typeof import('../workforce-state').addTask;
  let updateTask: typeof import('../workforce-state').updateTask;

  beforeEach(async () => {
    vi.resetModules();

    vfsMock = new LifecycleVFSMock();

    vi.doMock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
      virtualFilesystem: {
        readFile: vfsMock.readFile,
        writeFile: vfsMock.writeFile,
      },
    }));
    vi.doMock('@/lib/virtual-filesystem/scope-utils', () => ({
      normalizeSessionId: vi.fn().mockReturnValue('001'),
    }));
    vi.doMock('@/lib/utils/logger', () => ({
      createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    }));

    const mod = await import('../workforce-state');
    loadState = mod.loadState;
    saveState = mod.saveState;
    addTask = mod.addTask;
    updateTask = mod.updateTask;
  });

  afterEach(() => {
    vfsMock.reset();
  });

  // -------------------------------------------------------------------------
  // Step 1 — ENOENT: loadState initializes DEFAULT_STATE and persists it
  // -------------------------------------------------------------------------
  it('loadState (ENOENT) creates and persists DEFAULT_STATE', async () => {
    const userId = 'user-lifecycle';
    const conversationId = 'conv-lifecycle-001';

    // First load — file doesn't exist → should initialize
    const state = await loadState(userId, conversationId);

    expect(state.version).toBe(1);
    expect(state.tasks).toEqual([]);
    expect(vfsMock.writeCallCount).toBe(1);

    // Verify the persisted YAML is valid and parseable
    const written = vfsMock.writtenContent;
    expect(written).not.toBeNull();
    const parsed = yaml.load(written!) as any;
    expect(parsed.version).toBe(1);
    expect(parsed.tasks).toEqual([]);
    expect(parsed.updatedAt).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Step 2 — addTask: reads existing state, adds task, persists updated state
  // -------------------------------------------------------------------------
  it('addTask reads existing state, adds a task, and persists with correct YAML', async () => {
    const userId = 'user-lifecycle';
    const conversationId = 'conv-lifecycle-002';

    // Pre-populate: simulate existing STATE.yaml from a prior session
    const existingYaml = yaml.dump({
      version: 1,
      updatedAt: '2025-01-01T00:00:00.000Z',
      tasks: [],
    });
    vfsMock.files.set(`${userId}:workspace/sessions/001/STATE.yaml`, { content: existingYaml });

    const newTask = {
      id: 'task-new-001',
      title: 'Deploy to staging',
      description: 'Deploy the latest build to staging environment',
      agent: 'opencode' as const,
      status: 'pending' as const,
    };

    const state = await addTask(userId, conversationId, newTask);

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe('task-new-001');
    expect(state.tasks[0].title).toBe('Deploy to staging');
    expect(state.tasks[0].agent).toBe('opencode');
    expect(state.tasks[0].status).toBe('pending');
    expect(vfsMock.writeCallCount).toBe(1);

    // Verify persisted YAML
    const written = vfsMock.writtenContent!;
    const parsed = yaml.load(written) as any;
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].id).toBe('task-new-001');
    expect(parsed.tasks[0].agent).toBe('opencode');
  });

  // -------------------------------------------------------------------------
  // Step 3 — updateTask: reads existing state, updates specific task, persists
  // -------------------------------------------------------------------------
  it('updateTask reads existing state, updates the task, and persists correct YAML', async () => {
    const userId = 'user-lifecycle';
    const conversationId = 'conv-lifecycle-003';

    // Pre-populate with one existing task
    const existingTask = {
      id: 'task-update-001',
      title: 'Run tests',
      description: 'Execute full test suite',
      agent: 'cli' as const,
      status: 'pending' as const,
      assignedAt: '2025-01-01T00:00:00.000Z',
    };
    const existingYaml = yaml.dump({
      version: 1,
      updatedAt: '2025-01-01T00:00:00.000Z',
      tasks: [existingTask],
    });
    vfsMock.files.set(`${userId}:workspace/sessions/001/STATE.yaml`, { content: existingYaml });

    const state = await updateTask(userId, conversationId, 'task-update-001', {
      status: 'running',
      startedAt: '2025-02-01T10:00:00.000Z',
    });

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].status).toBe('running');
    expect(state.tasks[0].startedAt).toBe('2025-02-01T10:00:00.000Z');
    expect(state.tasks[0].title).toBe('Run tests'); // unchanged
    expect(vfsMock.writeCallCount).toBe(1);

    // Verify persisted YAML — tasks array unchanged count, but fields updated
    const written = vfsMock.writtenContent!;
    const parsed = yaml.load(written) as any;
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].status).toBe('running');
    expect(parsed.tasks[0].startedAt).toBe('2025-02-01T10:00:00.000Z');
  });

  // -------------------------------------------------------------------------
  // Step 4 — Complete lifecycle: ENOENT → addTask → updateTask → re-load
  // -------------------------------------------------------------------------
  it('full lifecycle: ENOENT → addTask → updateTask → re-load preserves all data', async () => {
    const userId = 'user-lifecycle-full';
    const conversationId = 'conv-lifecycle-full';

    // Step A: loadState ENOENT — initializes and persists DEFAULT_STATE
    const stateA = await loadState(userId, conversationId);
    expect(stateA.tasks).toHaveLength(0);
    const firstWriteCount = vfsMock.writeCallCount;

    // Step B: addTask — adds task-1
    const task1 = {
      id: 'task-1',
      title: 'Initialize workspace',
      description: 'Set up the workspace structure',
      agent: 'nullclaw' as const,
      status: 'pending' as const,
    };
    const stateB = await addTask(userId, conversationId, task1);
    expect(stateB.tasks).toHaveLength(1);
    expect(stateB.tasks[0].id).toBe('task-1');
    const secondWriteCount = vfsMock.writeCallCount;
    expect(secondWriteCount).toBe(firstWriteCount + 1);

    // Step C: updateTask — marks task-1 as completed with result
    const stateC = await updateTask(userId, conversationId, 'task-1', {
      status: 'completed',
      completedAt: '2025-03-01T15:30:00.000Z',
      result: 'Workspace initialized successfully with 12 files',
    });
    expect(stateC.tasks[0].status).toBe('completed');
    expect(stateC.tasks[0].result).toBe('Workspace initialized successfully with 12 files');
    expect(vfsMock.writeCallCount).toBe(secondWriteCount + 1);

    // Step D: re-load — simulates a new call (e.g. agent restart) reading persisted state
    vfsMock.readFile.mockClear();
    const stateD = await loadState(userId, conversationId);

    // Verify a real re-read occurred (not just returned from in-memory state)
    expect(vfsMock.readFile).toHaveBeenCalledTimes(1);

    expect(stateD.tasks).toHaveLength(1);
    expect(stateD.tasks[0].id).toBe('task-1');
    expect(stateD.tasks[0].title).toBe('Initialize workspace');
    expect(stateD.tasks[0].agent).toBe('nullclaw');
    expect(stateD.tasks[0].status).toBe('completed');
    expect(stateD.tasks[0].result).toBe('Workspace initialized successfully with 12 files');
    expect(stateD.tasks[0].completedAt).toBe('2025-03-01T15:30:00.000Z');

    // Verify the final written YAML is valid and round-trippable
    const finalWritten = vfsMock.writtenContent!;
    const parsedFinal = yaml.load(finalWritten) as any;
    expect(parsedFinal.tasks).toHaveLength(1);
    expect(parsedFinal.tasks[0].id).toBe('task-1');
    expect(parsedFinal.tasks[0].status).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // Edge case: addTask to malformed persisted state → falls back to default
  // -------------------------------------------------------------------------
  it('addTask falls back to DEFAULT_STATE when persisted file is malformed', async () => {
    const userId = 'user-lifecycle';
    const conversationId = 'conv-malformed';

    // Pre-populate with invalid YAML content (missing tasks array)
    vfsMock.files.set(`${userId}:workspace/sessions/001/STATE.yaml`, {
      content: 'version: 99\nupdatedAt: never\ntasks: null',
    });

    const newTask = { id: 't1', title: 'Test', description: 'desc', agent: 'cli' as const, status: 'pending' as const };
    const state = await addTask(userId, conversationId, newTask);

    // Falls back to DEFAULT_STATE (empty tasks), then adds our task
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe('t1');
    expect(state.version).toBe(1); // DEFAULT_STATE version
  });

  // -------------------------------------------------------------------------
  // Edge case: updateTask on non-existent taskId → returns state unchanged
  // -------------------------------------------------------------------------
  it('updateTask returns state unchanged when taskId does not exist', async () => {
    const userId = 'user-lifecycle';
    const conversationId = 'conv-missing-task';

    const existingTask = { id: 'existing-1', title: 'Existing', description: 'desc', agent: 'opencode' as const, status: 'pending' as const };
    const existingYaml = yaml.dump({ version: 1, updatedAt: '', tasks: [existingTask] });
    vfsMock.files.set(`${userId}:workspace/sessions/001/STATE.yaml`, { content: existingYaml });

    const state = await updateTask(userId, conversationId, 'non-existent-id', { status: 'running' });

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe('existing-1');
    expect(state.tasks[0].status).toBe('pending'); // unchanged
    // No write because nothing changed
    expect(vfsMock.writeCallCount).toBe(0);
  });
});