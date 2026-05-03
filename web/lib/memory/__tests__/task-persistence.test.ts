/**
 * Unit tests for TaskStore and task persistence system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the logger
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock spec-parser to avoid import issues
vi.mock('@/lib/chat/spec-parser', () => ({
  RefinementChunk: {},
}));

describe('TaskStore', () => {
  let TaskStore: any;
  let getTaskStore: any;
  let resetTaskStore: any;
  let RetentionLevel: any;

  beforeEach(async () => {
    vi.resetModules();
    
     const module = await import('../task-persistence');
     TaskStore = module.TaskStore;
     getTaskStore = module.getTaskStore;
     resetTaskStore = module.resetTaskStore;
     
     // Reset the singleton
     resetTaskStore();
  });

  describe('create()', () => {
    it('should create a task with required fields', async () => {
      const store = getTaskStore();
      const task = await store.create({
        title: 'Test task',
      });

      expect(task.id).toBeDefined();
      expect(task.id).toMatch(/^task_/);
      expect(task.title).toBe('Test task');
      expect(task.retention).toBe('queued'); // default
      expect(task.status).toBe('pending'); // default
      expect(task.priority).toBe(50); // default
      expect(task.childIds).toEqual([]);
      expect(task.experienceLinks).toEqual([]);
      expect(task.metadata).toEqual({});
    });

    it('should create a task with all options', async () => {
      const store = getTaskStore();
      const task = await store.create({
        title: 'Full task',
        description: 'Task description',
        steps: [
          { id: 'step1', description: 'Step 1', status: 'pending', order: 0 },
          { id: 'step2', description: 'Step 2', status: 'pending', order: 1 },
        ],
        retention: 'active',
        status: 'in_progress',
        tags: ['test', 'important'],
        priority: 80,
        dueDate: Date.now() + 86400000,
        contextHint: 'Related to auth',
        metadata: { customField: 'value' },
      });

      expect(task.title).toBe('Full task');
      expect(task.description).toBe('Task description');
      expect(task.steps).toHaveLength(2);
      expect(task.retention).toBe('active');
      expect(task.status).toBe('in_progress');
      expect(task.tags).toEqual(['test', 'important']);
      expect(task.priority).toBe(80);
      expect(task.dueDate).toBeDefined();
      expect(task.contextHint).toBe('Related to auth');
      expect(task.metadata.customField).toBe('value');
    });

    it('should create hierarchical tasks with parentId', async () => {
      const store = getTaskStore();
      const parent = await store.create({ title: 'Parent task' });
      const child = await store.create({
        title: 'Child task',
        parentId: parent.id,
      });

      expect(parent.childIds).toContain(child.id);
      expect(child.parentId).toBe(parent.id);
    });
  });

  describe('get() and getAll()', () => {
    it('should retrieve a task by ID', async () => {
      const store = getTaskStore();
      const created = await store.create({ title: 'Retrieve me' });
      
      const retrieved = store.get(created.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined for non-existent task', () => {
      const store = getTaskStore();
      const retrieved = store.get('non-existent-id');
      expect(retrieved).toBeUndefined();
    });

    it('should get all tasks', async () => {
      const store = getTaskStore();
      await store.create({ title: 'Task 1' });
      await store.create({ title: 'Task 2' });
      
      const all = store.getAll();
      
      expect(all).toHaveLength(2);
    });

    it('should filter by retention level', async () => {
      const store = getTaskStore();
      await store.create({ title: 'Active task', retention: 'active' });
      await store.create({ title: 'Queued task', retention: 'queued' });
      await store.create({ title: 'Archived task', retention: 'archived' });
      
      const active = store.getAll({ retention: ['active'] });
      
      expect(active).toHaveLength(1);
      expect(active[0].title).toBe('Active task');
    });

    it('should filter by status', async () => {
      const store = getTaskStore();
      await store.create({ title: 'Pending', status: 'pending' });
      await store.create({ title: 'In Progress', status: 'in_progress' });
      
      const inProgress = store.getAll({ status: ['in_progress'] });
      
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].title).toBe('In Progress');
    });

    it('should filter by tags', async () => {
      const store = getTaskStore();
      await store.create({ title: 'With tag', tags: ['important', 'urgent'] });
      await store.create({ title: 'Without tag', tags: ['other'] });
      
      const withTag = store.getAll({ tags: ['important'] });
      
      expect(withTag).toHaveLength(1);
      expect(withTag[0].title).toBe('With tag');
    });

    it('should sort by priority and lastAccessedAt', async () => {
      const store = getTaskStore();
      await store.create({ title: 'Low priority', priority: 20 });
      await store.create({ title: 'High priority', priority: 90 });
      
      const all = store.getAll();
      
      expect(all[0].title).toBe('High priority');
    });
  });

  describe('update()', () => {
    it('should update task fields', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'Original title' });
      
      const updated = await store.update(task.id, { title: 'New title', priority: 75 });
      
      expect(updated?.title).toBe('New title');
      expect(updated?.priority).toBe(75);
      expect(updated?.id).toBe(task.id); // ID preserved
      expect(updated?.createdAt).toBe(task.createdAt); // createdAt preserved
    });

    it('should return null for non-existent task', async () => {
      const store = getTaskStore();
      const result = await store.update('non-existent', { title: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('setRetention()', () => {
    it('should change retention level', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'Test', retention: 'queued' });
      
      const updated = await store.setRetention(task.id, 'suspended');
      
      expect(updated?.retention).toBe('suspended');
    });
  });

  describe('setStatus()', () => {
    it('should change status', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'Test', status: 'pending' });
      
      const updated = await store.setStatus(task.id, 'in_progress');
      
      expect(updated?.status).toBe('in_progress');
    });

    it('should auto-complete when all steps done', async () => {
      const store = getTaskStore();
      const task = await store.create({
        title: 'Test',
        steps: [
          { id: 'step1', description: 'Step 1', status: 'completed', order: 0 },
          { id: 'step2', description: 'Step 2', status: 'completed', order: 1 },
        ],
      });
      
      const updated = await store.setStatus(task.id, 'completed');
      
      expect(updated?.status).toBe('completed');
      expect(updated?.progress).toBe(100);
    });
  });

  describe('completeStep()', () => {
    it('should mark a step as completed', async () => {
      const store = getTaskStore();
      const task = await store.create({
        title: 'Test',
        steps: [
          { id: 'step1', description: 'Step 1', status: 'pending', order: 0 },
          { id: 'step2', description: 'Step 2', status: 'pending', order: 1 },
        ],
      });
      
      const updated = await store.completeStep(task.id, 'step1', 'Done!');
      
      expect(updated?.steps?.[0].status).toBe('completed');
      expect(updated?.steps?.[0].completedAt).toBeDefined();
      expect(updated?.steps?.[0].notes).toBe('Done!');
      expect(updated?.progress).toBe(50); // 1 of 2 completed
    });
  });

  describe('delete()', () => {
    it('should delete a task', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'To delete' });
      
      const result = await store.delete(task.id);
      
      expect(result).toBe(true);
      expect(store.get(task.id)).toBeUndefined();
    });

    it('should recursively delete children', async () => {
      const store = getTaskStore();
      const parent = await store.create({ title: 'Parent' });
      const child = await store.create({ title: 'Child', parentId: parent.id });
      
      await store.delete(parent.id);
      
      expect(store.get(parent.id)).toBeUndefined();
      expect(store.get(child.id)).toBeUndefined();
    });

    it('should update parent childIds when child is deleted', async () => {
      const store = getTaskStore();
      const parent = await store.create({ title: 'Parent' });
      const child = await store.create({ title: 'Child', parentId: parent.id });
      
      await store.delete(child.id);
      
      const updatedParent = store.get(parent.id);
      expect(updatedParent?.childIds).not.toContain(child.id);
    });
  });

  describe('archive(), suspend(), resume()', () => {
    it('should archive a task', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'Test', retention: 'active' });
      
      const archived = await store.archive(task.id);
      
      expect(archived?.retention).toBe('archived');
    });

    it('should suspend a task', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'Test', retention: 'active' });
      
      const suspended = await store.suspend(task.id);
      
      expect(suspended?.retention).toBe('suspended');
    });

    it('should resume a suspended task', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'Test', retention: 'suspended' });
      
      const resumed = await store.resume(task.id);
      
      expect(resumed?.retention).toBe('active');
      expect(resumed?.status).toBe('in_progress');
    });
  });

  describe('linkExperience()', () => {
    it('should link an experience to a task', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'Test' });
      
      const linked = await store.linkExperience(task.id, 'exp_123');
      
      expect(linked?.experienceLinks).toContain('exp_123');
    });

    it('should not duplicate experience links', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'Test' });
      await store.linkExperience(task.id, 'exp_123');
      
      const linked = await store.linkExperience(task.id, 'exp_123');
      
      expect(linked?.experienceLinks.filter(id => id === 'exp_123')).toHaveLength(1);
    });
  });

  describe('search()', () => {
    it('should find tasks by title', async () => {
      const store = getTaskStore();
      await store.create({ title: 'SQL injection fix', tags: ['security'] });
      await store.create({ title: 'UI update', tags: ['design'] });
      
      const results = store.search('SQL');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('SQL');
    });

    it('should find tasks by tags', async () => {
      const store = getTaskStore();
      await store.create({ title: 'Security task', tags: ['security', 'urgent'] });
      
      const results = store.search('security');
      
      expect(results.length).toBeGreaterThan(0);
    });

    it('should boost active tasks in results', async () => {
      const store = getTaskStore();
      await store.create({ title: 'Queued auth task', tags: ['auth'], retention: 'queued' });
      await store.create({ title: 'Active auth task', tags: ['auth'], retention: 'active', status: 'in_progress' });
      
      const results = store.search('auth');
      
      expect(results[0].title).toBe('Active auth task');
    });
  });

  describe('export() and import()', () => {
    it('should export all tasks', async () => {
      const store = getTaskStore();
      await store.create({ title: 'Task 1' });
      await store.create({ title: 'Task 2' });
      
      const exported = store.export();
      
      expect(exported).toHaveLength(2);
    });

    it('should import tasks without duplicates', async () => {
      const store = getTaskStore();
      const task = await store.create({ title: 'Original' });
      
      const exported = store.export();
      await store.create({ title: 'New task' }); // Add another
      
      const imported = await store.import(exported);
      
      expect(imported).toBe(0); // No new imports (already exists)
      expect(store.getAll()).toHaveLength(2);
    });
  });

  describe('getStats()', () => {
    it('should return correct statistics', async () => {
      const store = getTaskStore();
      await store.create({ title: 'Active task', retention: 'active', status: 'in_progress' });
      await store.create({ title: 'Queued task', retention: 'queued', status: 'pending' });
      await store.create({ title: 'Completed', retention: 'archived', status: 'completed' });
      
      const stats = store.getStats();
      
      expect(stats.totalTasks).toBe(3);
      expect(stats.byRetention.active).toBe(1);
      expect(stats.byRetention.queued).toBe(1);
      expect(stats.byRetention.archived).toBe(1);
      expect(stats.byStatus.in_progress).toBe(1);
      expect(stats.byStatus.completed).toBe(1);
    });
  });
});

describe('Spec-parser Integration', () => {
  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../task-persistence');
    module.resetTaskStore();
  });

  it('should create tasks from spec chunks', async () => {
    const { createTasksFromSpecChunks } = await import('../task-persistence');
    
    const chunks = [
      { title: 'Section 1', tasks: ['Task 1', 'Task 2'], priority: 80 },
      { title: 'Section 2', tasks: ['Task 3'], priority: 60 },
    ];
    
    const tasks = await createTasksFromSpecChunks(chunks);
    
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe('Section 1');
    expect(tasks[0].steps).toHaveLength(2);
    expect(tasks[0].tags).toContain('spec-parser');
    expect(tasks[0].tags).toContain('dag');
  });

  it('should create a plan task with step hierarchy', async () => {
    const { createPlanTask } = await import('../task-persistence');
    
    const result = await createPlanTask(
      'Build feature',
      'Build a new feature with multiple steps',
      ['Step 1', 'Step 2', 'Step 3'],
      { priority: 75 }
    );
    
    expect(result.rootTask.title).toBe('Build feature');
    expect(result.rootTask.tags).toContain('plan');
    expect(result.stepTasks).toHaveLength(3);
    expect(result.stepTasks[0].parentId).toBe(result.rootTask.id);
    expect(result.stepTasks[0].tags).toContain('plan-step');
  });
});

describe('Convenience Functions', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('should get relevant tasks for context', async () => {
    // Note: Don't call resetTaskStore() here - vi.resetModules() already gives us fresh state
    // And we need the tasks we just created in the same test context
    const { getTaskStore, getRelevantTasks } = await import('../task-persistence');
    
    const store = getTaskStore();
    // Create with 'active' retention to ensure it's included in results
    await store.create({ 
      title: 'Auth implementation', 
      tags: ['auth', 'security'],
      retention: 'active',
      status: 'in_progress',
    });
    await store.create({ title: 'UI cleanup', tags: ['design'] });
    
    const relevant = getRelevantTasks('authentication', { limit: 5 });
    
    expect(relevant.length).toBeGreaterThan(0);
    expect(relevant[0].title.toLowerCase()).toContain('auth');
  });

  it('should format tasks for prompt', async () => {
    const { getTaskStore, formatTasksForPrompt } = await import('../task-persistence');
    
    const store = getTaskStore();
    await store.create({ 
      title: 'Important task', 
      status: 'in_progress',
      steps: [
        { id: 's1', description: 'Step 1', status: 'completed', order: 0 },
        { id: 's2', description: 'Step 2', status: 'pending', order: 1 },
      ],
    });
    
    const formatted = formatTasksForPrompt(store.getAll());
    
    expect(formatted).toContain('## Active Tasks');
    expect(formatted).toContain('Important task');
    expect(formatted).toContain('🔄'); // in_progress emoji
    expect(formatted).toContain('[1/2]'); // progress
  });

  it('should build task prompt supplement', async () => {
    const { getTaskStore, buildTaskPromptSupplement } = await import('../task-persistence');
    
    const store = getTaskStore();
    await store.create({ title: 'Security fix', tags: ['security'] });
    
    const supplement = buildTaskPromptSupplement('security');
    
    expect(supplement).toContain('Security fix');
  });
});

describe('Storage Path Utilities', () => {
  it('should return storage path', async () => {
    const { getTaskStoragePath, isTaskStorageAvailable } = await import('../task-persistence');
    
    const path = getTaskStoragePath();
    expect(path).toBeDefined();
    expect(typeof path).toBe('string');
    
    const available = isTaskStorageAvailable();
    expect(typeof available).toBe('boolean');
  });
});