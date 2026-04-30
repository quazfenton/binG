/**
 * task-persistence.ts — Semi-Persistent Task/Plan Management
 * 
 * Provides persistent to-do lists, task plans, and step tracking for agents.
 * Enables continuation of tasks across sessions, days, and chats.
 * 
 * Features:
 * - 5 retention levels: scratch, active, queued, suspended, archived
 * - Optional hierarchical nesting (parent/child relationships)
 * - Integration with spec-parser for auto-creating tasks from DAG chunks
 * - Local storage for desktop/CLI (similar to experience storage)
 * - Mem0 integration for semantic search of task context
 * - Dynamic retention based on task state and age
 * - Squash/summarize history of completed tasks
 * - Skill/powers cache linking for agent remembrance
 * 
 * This enables agents to:
 * - Remember incomplete tasks between sessions
 * - Continue interrupted work on different days
 * - Track multi-step plans across chat boundaries
 * - Squash/summarize history for mid-range memory storage
 */

import { createLogger } from '@/lib/utils/logger';
import type { RefinementChunk } from '@/lib/chat/spec-parser';

const log = createLogger('Task:Persistence');

// ============================================================================
// Retention Levels & Types
// ============================================================================

/**
 * 5-level retention system for task lifecycle management.
 * 
 * - scratch: Very short-lived, cleared on refresh/reset (ephemeral work)
 * - active: Current session focus, persisted but prioritized
 * - queued: Waiting to be started, medium persistence
 * - suspended: Paused/held, long persistence, resumable
 * - archived: Completed or abandoned, kept for reference but low priority
 */
export type RetentionLevel = 'scratch' | 'active' | 'queued' | 'suspended' | 'archived';

/**
 * Task status within the retention system.
 */
export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'cancelled';

/**
 * A persistent task that can be resumed across sessions.
 */
export interface Task {
  /** Unique identifier */
  id: string;
  
  /** Task title/summary */
  title: string;
  
  /** Detailed description or instructions */
  description?: string;
  
  /** Steps or sub-tasks as JSON (for complex multi-step tasks) */
  steps?: TaskStep[];
  
  /** Current retention level */
  retention: RetentionLevel;
  
  /** Task status */
  status: TaskStatus;
  
  /** Optional parent task ID for hierarchical organization */
  parentId?: string;
  
  /** Child task IDs (populated automatically) */
  childIds: string[];
  
  /** Tags for categorization and semantic search */
  tags: string[];
  
  /** Priority (higher = more important, 0-100) */
  priority: number;
  
  /** When the task was created */
  createdAt: number;
  
  /** When the task was last updated */
  updatedAt: number;
  
  /** When the task was last accessed/resumed */
  lastAccessedAt?: number;
  
  /** When the task is expected to be completed (optional) */
  dueDate?: number;
  
  /** Current progress (0-100) */
  progress: number;
  
  /** Context/hints for when this task is relevant */
  contextHint?: string;
  
  /** Metadata for spec-parser integration */
  specContext?: {
    /** Source spec/plan ID */
    sourcePlanId?: string;
    /** Related refinement chunk */
    refinementChunk?: string;
    /** DAG task ID if from DAG execution */
    dagTaskId?: string;
  };
  
  /** Links to related agent experiences */
  experienceLinks: string[];
  
  /** Links to skill/powers cache snapshots for agent remembrance */
  skillSnapshotIds: string[];
  
  /** IDs of tasks that were squashed/summarized into this task */
  sourceTaskIds?: string[];
  
  /** Summary text for squashed tasks */
  summaryText?: string;
  
  /** Metadata for flexibility */
  metadata: Record<string, unknown>;
}

/**
 * A single step within a task.
 */
export interface TaskStep {
  /** Step identifier */
  id: string;
  
  /** Step description */
  description: string;
  
  /** Step status */
  status: 'pending' | 'completed' | 'skipped' | 'failed';
  
  /** When completed */
  completedAt?: number;
  
  /** Notes or result from the step */
  notes?: string;
  
  /** Order index */
  order: number;
}

// ============================================================================
// Configuration
// ============================================================================

const MAX_TASKS = 500;                    // Maximum tasks to store
const SCRATCH_TTL_MS = 30 * 60 * 1000;   // 30 minutes for scratch tasks
const ACTIVE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day for active tasks
const QUEUED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for queued
const SUSPENDED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days for suspended
const ARCHIVED_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days for archived

const DEFAULT_RETENTION: RetentionLevel = 'queued';
const DEFAULT_PRIORITY = 50;

// ============================================================================
// Storage Backend
// ============================================================================

interface TaskStorageBackend {
  save(tasks: Task[]): Promise<void>;
  load(): Promise<Task[]>;
  clear(): Promise<void>;
}

/**
 * LocalStorage backend for browser environment
 */
class TaskLocalStorageBackend implements TaskStorageBackend {
  private key: string;
  
  constructor() {
    this.key = 'agent_tasks';
  }
  
  isAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    try {
      localStorage.setItem('_test', 'test');
      localStorage.removeItem('_test');
      return true;
    } catch {
      return false;
    }
  }
  
  async save(tasks: Task[]): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      localStorage.setItem(this.key, JSON.stringify(tasks));
      log.debug('[TaskStorage] Saved', { count: tasks.length });
    } catch (err) {
      log.error('[TaskStorage] Save failed:', err);
    }
  }
  
  async load(): Promise<Task[]> {
    if (!this.isAvailable()) return [];
    try {
      const data = localStorage.getItem(this.key);
      if (!data) return [];
      return JSON.parse(data) as Task[];
    } catch (err) {
      log.error('[TaskStorage] Load failed:', err);
      return [];
    }
  }
  
  async clear(): Promise<void> {
    if (this.isAvailable()) {
      localStorage.removeItem(this.key);
    }
  }
}

/**
 * FileSystem backend for Node.js/CLI environment
 */
class TaskFileSystemBackend implements TaskStorageBackend {
  private filePath: string;
  
  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    const configDir = process.env.QUAZ_CONFIG_DIR || `${homeDir}/.quaz`;
    this.filePath = `${configDir}/tasks.json`;
  }
  
  isAvailable(): boolean {
    return typeof window === 'undefined' && typeof process !== 'undefined';
  }
  
  private async ensureDirectory(): Promise<void> {
    if (!this.isAvailable()) return;
    const fs = await import('fs/promises');
    const path = await import('path');
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }
  
  async save(tasks: Task[]): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await this.ensureDirectory();
      const fs = await import('fs/promises');
      await fs.writeFile(this.filePath, JSON.stringify(tasks, null, 2), 'utf-8');
      log.debug('[TaskStorage] Saved', { count: tasks.length, path: this.filePath });
    } catch (err) {
      log.error('[TaskStorage] Save failed:', err);
    }
  }
  
  async load(): Promise<Task[]> {
    if (!this.isAvailable()) return [];
    try {
      const fs = await import('fs/promises');
      const data = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(data) as Task[];
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      log.error('[TaskStorage] Load failed:', err);
      return [];
    }
  }
  
  async clear(): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      const fs = await import('fs/promises');
      await fs.unlink(this.filePath);
    } catch {
      // File may not exist
    }
  }
}

// ============================================================================
// Task Store
// ============================================================================

/**
 * Main store for task persistence with CRUD operations.
 */
export class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private backend: TaskStorageBackend;
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private saveDebounceMs = 2000; // 2 second debounce
  private isDirty = false;
  
  constructor() {
    this.backend = typeof window !== 'undefined'
      ? new TaskLocalStorageBackend()
      : new TaskFileSystemBackend();
    log.info('[TaskStore] Initialized', { backend: this.backend.constructor.name });
  }
  
  /**
   * Check if storage is available
   */
  isAvailable(): boolean {
    return this.backend.isAvailable();
  }
  
  /**
   * Load tasks from storage (call during initialization)
   */
  async load(): Promise<number> {
    const loaded = await this.backend.load();
    for (const task of loaded) {
      this.tasks.set(task.id, task);
    }
    
    // Clean expired tasks
    this.cleanExpiredTasks();
    
    log.info('[TaskStore] Loaded tasks', { count: loaded.length });
    return loaded.length;
  }
  
  /**
   * Create a new task
   */
  async create(task: Partial<Task> & { title: string }): Promise<Task> {
    // Enforce MAX_TASKS limit - archive oldest completed tasks if needed
    if (this.tasks.size >= MAX_TASKS) {
      log.warn('[TaskStore] Task limit reached, archiving oldest completed tasks');
      const completed = Array.from(this.tasks.values())
        .filter(t => t.status === 'completed')
        .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
      
      // Archive oldest completed tasks to make room (only if we have completed tasks)
      if (completed.length > 0) {
        const toArchive = Math.min(10, this.tasks.size - MAX_TASKS + 1);
        for (let i = 0; i < toArchive && i < completed.length; i++) {
          await this.archive(completed[i].id);
        }
      }
    }
    
    const now = Date.now();
    const fullTask: Task = {
      id: `task_${now}_${Math.random().toString(36).slice(2, 8)}`,
      title: task.title,
      description: task.description,
      steps: task.steps?.map((s, i) => ({
        ...s,
        id: s.id || `step_${i}`,
        order: s.order ?? i,
      })),
      retention: task.retention ?? DEFAULT_RETENTION,
      status: task.status ?? 'pending',
      parentId: task.parentId,
      childIds: [],
      tags: task.tags ?? [],
      priority: task.priority ?? DEFAULT_PRIORITY,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      dueDate: task.dueDate,
      progress: task.progress ?? 0,
      contextHint: task.contextHint,
      specContext: task.specContext,
      experienceLinks: task.experienceLinks ?? [],
      skillSnapshotIds: task.skillSnapshotIds ?? [],
      sourceTaskIds: task.sourceTaskIds,
      summaryText: task.summaryText,
      metadata: task.metadata ?? {},
    };
    
    this.tasks.set(fullTask.id, fullTask);
    
    // Update parent's childIds
    if (fullTask.parentId) {
      const parent = this.tasks.get(fullTask.parentId);
      if (parent && !parent.childIds.includes(fullTask.id)) {
        parent.childIds.push(fullTask.id);
      }
    }
    
    this.markDirty();
    log.info('[TaskStore] Created task', { id: fullTask.id, title: fullTask.title });
    
    return fullTask;
  }
  
  /**
   * Get a task by ID
   */
  get(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (task) {
      task.lastAccessedAt = Date.now();
    }
    return task;
  }
  
  /**
   * Get all tasks (optionally filtered by retention level)
   */
  getAll(filter?: { retention?: RetentionLevel[]; status?: TaskStatus[]; tags?: string[] }): Task[] {
    let tasks = Array.from(this.tasks.values());
    
    if (filter?.retention) {
      tasks = tasks.filter(t => filter.retention!.includes(t.retention));
    }
    
    if (filter?.status) {
      tasks = tasks.filter(t => filter.status!.includes(t.status));
    }
    
    if (filter?.tags) {
      tasks = tasks.filter(t =>
        filter.tags!.some(tag => t.tags.includes(tag))
      );
    }
    
    // Sort by priority, then by lastAccessedAt
    return tasks.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return (b.lastAccessedAt ?? 0) - (a.lastAccessedAt ?? 0);
    });
  }
  
  /**
   * Get active tasks (non-archived, non-scratch)
   */
  getActiveTasks(): Task[] {
    return this.getAll({
      retention: ['active', 'queued', 'suspended'],
      status: ['pending', 'in_progress', 'blocked'],
    });
  }
  
  /**
   * Update a task
   */
  async update(id: string, updates: Partial<Task>): Promise<Task | null> {
    const task = this.tasks.get(id);
    if (!task) {
      log.warn('[TaskStore] Task not found for update', { id });
      return null;
    }
    
    // Handle parentId change
    if (updates.parentId !== undefined && updates.parentId !== task.parentId) {
      // Remove from old parent
      if (task.parentId) {
        const oldParent = this.tasks.get(task.parentId);
        if (oldParent) {
          oldParent.childIds = oldParent.childIds.filter(cid => cid !== id);
        }
      }
      // Add to new parent
      if (updates.parentId) {
        const newParent = this.tasks.get(updates.parentId);
        if (newParent && !newParent.childIds.includes(id)) {
          newParent.childIds.push(id);
        }
      }
    }
    
    // Update task
    const updated: Task = {
      ...task,
      ...updates,
      id: task.id, // Preserve original ID
      createdAt: task.createdAt, // Preserve creation time
      updatedAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    
    this.tasks.set(id, updated);
    this.markDirty();
    
    log.debug('[TaskStore] Updated task', { id });
    return updated;
  }
  
  /**
   * Update task retention level
   */
  async setRetention(id: string, retention: RetentionLevel): Promise<Task | null> {
    return this.update(id, { retention });
  }
  
  /**
   * Update task status
   */
  async setStatus(id: string, status: TaskStatus): Promise<Task | null> {
    const task = this.tasks.get(id);
    if (!task) return null;
    
    // Auto-complete when all steps are done
    if (status === 'completed' || task.steps?.every(s => s.status === 'completed')) {
      return this.update(id, { status: 'completed', progress: 100 });
    }
    
    return this.update(id, { status });
  }
  
  /**
   * Complete a step within a task
   */
  async completeStep(taskId: string, stepId: string, notes?: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || !task.steps) return null;
    
    const stepIndex = task.steps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) return null;
    
    const updatedSteps = [...task.steps];
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      status: 'completed',
      completedAt: Date.now(),
      notes: notes ?? updatedSteps[stepIndex].notes,
    };
    
    // Calculate progress
    const completedSteps = updatedSteps.filter(s => s.status === 'completed').length;
    const progress = Math.round((completedSteps / updatedSteps.length) * 100);
    
    return this.update(taskId, {
      steps: updatedSteps,
      progress,
      status: progress === 100 ? 'completed' : 'in_progress',
    });
  }
  
  /**
   * Delete a task (and its children recursively)
   */
  async delete(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;
    
    // Recursively delete children
    for (const childId of task.childIds) {
      await this.delete(childId);
    }
    
    // Remove from parent's childIds
    if (task.parentId) {
      const parent = this.tasks.get(task.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter(cid => cid !== id);
      }
    }
    
    this.tasks.delete(id);
    this.markDirty();
    
    log.info('[TaskStore] Deleted task', { id });
    return true;
  }
  
  /**
   * Archive a task (move to archived retention)
   */
  async archive(id: string): Promise<Task | null> {
    return this.setRetention(id, 'archived');
  }
  
  /**
   * Suspend a task (move to suspended retention)
   */
  async suspend(id: string): Promise<Task | null> {
    return this.setRetention(id, 'suspended');
  }
  
  /**
   * Resume a suspended task
   */
  async resume(id: string): Promise<Task | null> {
    return this.update(id, { retention: 'active', status: 'in_progress' });
  }
  
  /**
   * Link an agent experience to a task
   */
  async linkExperience(taskId: string, experienceId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    if (!task.experienceLinks.includes(experienceId)) {
      return this.update(taskId, {
        experienceLinks: [...task.experienceLinks, experienceId],
      });
    }
    
    return task;
  }
  
  /**
   * Link a skill/powers cache snapshot to a task
   */
  async linkSkillSnapshot(taskId: string, snapshotId: string): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    if (!task.skillSnapshotIds.includes(snapshotId)) {
      return this.update(taskId, {
        skillSnapshotIds: [...task.skillSnapshotIds, snapshotId],
      });
    }
    
    return task;
  }
  
  /**
   * Squash multiple tasks into a single summarized task.
   * Archives the source tasks and creates a summary task.
   */
  async squashTasks(taskIds: string[], options?: {
    title?: string;
    summaryPrefix?: string;
  }): Promise<Task | null> {
    const sourceTasks = taskIds
      .map(id => this.tasks.get(id))
      .filter((t): t is Task => t !== undefined);
    
    if (sourceTasks.length === 0) return null;
    
    // Generate summary text
    const summaryParts = sourceTasks.map(t => {
      const status = t.status === 'completed' ? '✓' : t.status === 'failed' ? '✗' : '○';
      return `${status} ${t.title}${t.progress > 0 ? ` [${t.progress}%]` : ''}`;
    });
    
    const summaryText = options?.summaryPrefix 
      ? `${options.summaryPrefix}\n${summaryParts.join('\n')}`
      : summaryParts.join('\n');
    
    // Create summarized task
    const summaryTask = await this.create({
      title: options?.title ?? `Summary: ${sourceTasks.length} tasks`,
      description: `Squashed from ${sourceTasks.length} tasks`,
      retention: 'archived',
      status: 'completed',
      progress: 100,
      tags: ['summary', 'squashed'],
      summaryText,
      sourceTaskIds: taskIds,
      metadata: {
        originalTaskCount: sourceTasks.length,
        squashedAt: Date.now(),
      },
    });
    
    // Archive source tasks
    for (const task of sourceTasks) {
      await this.archive(task.id);
    }
    
    log.info('[TaskStore] Squashed tasks', { count: taskIds.length, summaryId: summaryTask.id });
    return summaryTask;
  }
  
  /**
   * Create a summary task from a set of completed tasks (for history consolidation)
   */
  async summarizeTaskHistory(
    context: string,
    options?: {
      retention?: RetentionLevel;
      title?: string;
    }
  ): Promise<Task | null> {
    // Find completed tasks matching the context
    const completed = Array.from(this.tasks.values())
      .filter(t => 
        t.status === 'completed' && 
        (t.retention === 'active' || t.retention === 'queued')
      );
    
    if (completed.length === 0) return null;
    
    // Score and select most relevant
    const scored = completed.map(t => ({
      task: t,
      score: this.scoreTask(t, context.toLowerCase().split(/\b/).filter(w => w.length > 2)),
    })).sort((a, b) => b.score - a.score);
    
    const toSummarize = scored.slice(0, 10).map(s => s.task);
    
    // Create summary
    const summaryText = toSummarize.map(t => {
      const date = new Date(t.updatedAt).toLocaleDateString();
      return `[${date}] ${t.title}`;
    }).join('\n');
    
    const summaryTask = await this.create({
      title: options?.title ?? `History summary: ${context}`,
      description: `Summary of ${toSummarize.length} completed tasks for context: ${context}`,
      retention: options?.retention ?? 'archived',
      status: 'completed',
      progress: 100,
      tags: ['history-summary', context.toLowerCase().replace(/\s+/g, '-')],
      summaryText,
      sourceTaskIds: toSummarize.map(t => t.id),
    });
    
    // Archive source tasks
    for (const task of toSummarize) {
      await this.archive(task.id);
    }
    
    log.info('[TaskStore] Summarized task history', { 
      context, 
      taskCount: toSummarize.length, 
      summaryId: summaryTask.id 
    });
    return summaryTask;
  }
  
  /**
   * Search tasks by query (uses title, description, tags)
   */
  search(query: string): Task[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\b/).filter(w => w.length > 2);
    
    return Array.from(this.tasks.values())
      .map(task => ({
        task,
        score: this.scoreTask(task, queryWords),
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.task);
  }
  
  private scoreTask(task: Task, queryWords: string[]): number {
    let score = 0;
    
    for (const word of queryWords) {
      // Check for exact or partial matches (e.g., 'auth' matches 'authentication')
      const titleLower = task.title.toLowerCase();
      if (titleLower.includes(word)) {
        score += 5;
      } else {
        // Bidirectional prefix matching: 'auth' matches 'authentication'
        const titleWords = titleLower.split(/[\s_-]+/);
        if (titleWords.some(part => 
          part.startsWith(word) || word.startsWith(part) || // prefix match
          part.includes(word) || word.includes(part)        // substring match
        )) {
          score += 4;
        }
      }
      
      if (task.description?.toLowerCase().includes(word)) score += 3;
      if (task.tags.some(t => t.toLowerCase().includes(word))) score += 2;
      if (task.contextHint?.toLowerCase().includes(word)) score += 1;
      if (task.specContext?.refinementChunk?.toLowerCase().includes(word)) score += 1;
    }
    
    // Boost active tasks
    if (task.retention === 'active' && task.status === 'in_progress') {
      score *= 1.5;
    }
    
    return score;
  }
  
  /**
   * Export all tasks as JSON
   */
  export(): Task[] {
    return Array.from(this.tasks.values());
  }
  
  /**
   * Import tasks from JSON
   */
  async import(tasks: Task[]): Promise<number> {
    let imported = 0;
    for (const task of tasks) {
      if (!this.tasks.has(task.id)) {
        this.tasks.set(task.id, task);
        imported++;
      }
    }
    
    if (imported > 0) {
      this.markDirty();
    }
    
    log.info('[TaskStore] Imported tasks', { count: imported });
    return imported;
  }
  
  /**
   * Restore a task with original ID (for cache restoration from export)
   * Unlike create(), this preserves the original task ID
   */
  async restoreTask(task: Task): Promise<Task> {
    const now = Date.now();
    
    // If task already exists, update it instead
    if (this.tasks.has(task.id)) {
      const existing = this.tasks.get(task.id)!;
      // Only update if the restored version is newer
      if (task.updatedAt > existing.updatedAt) {
        return this.update(task.id, task) as Promise<Task>;
      }
      return existing;
    }
    
    // Create with original ID preserved
    const restored: Task = {
      ...task,
      updatedAt: now,
      lastAccessedAt: now,
    };
    
    this.tasks.set(restored.id, restored);
    
    // Update parent's childIds if needed
    if (restored.parentId) {
      const parent = this.tasks.get(restored.parentId);
      if (parent && !parent.childIds.includes(restored.id)) {
        parent.childIds.push(restored.id);
      }
    }
    
    this.markDirty();
    log.info('[TaskStore] Restored task', { id: restored.id, title: restored.title });
    
    return restored;
  }
  
  /**
   * Batch restore tasks (for cache restoration)
   */
  async restoreTasks(tasks: Task[]): Promise<number> {
    let restored = 0;
    for (const task of tasks) {
      try {
        await this.restoreTask(task);
        restored++;
      } catch (err) {
        log.warn('[TaskStore] Failed to restore task', { id: task.id, error: err });
      }
    }
    return restored;
  }
  
  // ─── LLM-Accessible Task Manipulation ──────────────────────────────────────
  
  /**
   * Add a step to an existing task (LLM can call this)
   */
  async addStep(
    taskId: string,
    step: { description: string; id?: string; order?: number }
  ): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.warn('[TaskStore] Task not found for addStep', { taskId });
      return null;
    }
    
    const steps = [...(task.steps ?? [])];
    const newStep = {
      id: step.id ?? `step_${Date.now()}`,
      description: step.description,
      status: 'pending' as const,
      order: step.order ?? steps.length,
    };
    steps.push(newStep);
    
    return this.update(taskId, { steps });
  }
  
  /**
   * Append steps to an existing task (LLM can call this for multi-step additions)
   */
  async appendSteps(
    taskId: string,
    steps: Array<{ description: string; afterStepId?: string }>
  ): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.warn('[TaskStore] Task not found for appendSteps', { taskId });
      return null;
    }
    
    const currentSteps = [...(task.steps ?? [])];
    let insertIndex = currentSteps.length;
    
    for (const step of steps) {
      // Find insertion point if afterStepId specified
      if (step.afterStepId) {
        const idx = currentSteps.findIndex(s => s.id === step.afterStepId);
        if (idx !== -1) {
          insertIndex = idx + 1;
        }
      }
      
      const newStep = {
        id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        description: step.description,
        status: 'pending' as const,
        order: insertIndex++,
      };
      
      currentSteps.splice(insertIndex - 1, 0, newStep);
      insertIndex++;
    }
    
    // Re-order all steps
    const reorderedSteps = currentSteps.map((s, i) => ({ ...s, order: i }));
    
    return this.update(taskId, { steps: reorderedSteps });
  }
  
  /**
   * Edit a step within a task (LLM can call this)
   */
  async editStep(
    taskId: string,
    stepId: string,
    updates: { description?: string; status?: 'pending' | 'completed' | 'skipped' | 'failed'; notes?: string }
  ): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || !task.steps) return null;
    
    const stepIndex = task.steps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) return null;
    
    const updatedSteps = [...task.steps];
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      ...updates,
      completedAt: updates.status === 'completed' ? Date.now() : updatedSteps[stepIndex].completedAt,
    };
    
    // Recalculate progress
    const completedSteps = updatedSteps.filter(s => s.status === 'completed').length;
    const progress = updatedSteps.length > 0 
      ? Math.round((completedSteps / updatedSteps.length) * 100) 
      : task.progress;
    
    return this.update(taskId, {
      steps: updatedSteps,
      progress,
      status: progress === 100 ? 'completed' : task.status === 'completed' ? 'in_progress' : task.status,
    });
  }
  
  /**
   * Reorder steps within a task (LLM can call this)
   */
  async reorderSteps(
    taskId: string,
    stepIds: string[]
  ): Promise<Task | null> {
    const task = this.tasks.get(taskId);
    if (!task || !task.steps) return null;
    
    // Build step map
    const stepMap = new Map(task.steps.map(s => [s.id, s]));
    
    // Reorder according to stepIds
    const reorderedSteps: typeof task.steps = [];
    for (let i = 0; i < stepIds.length; i++) {
      const step = stepMap.get(stepIds[i]);
      if (step) {
        reorderedSteps.push({ ...step, order: i });
        stepMap.delete(stepIds[i]);
      }
    }
    
    // Add any steps not in stepIds at the end
    for (const step of stepMap.values()) {
      reorderedSteps.push({ ...step, order: reorderedSteps.length });
    }
    
    return this.update(taskId, { steps: reorderedSteps });
  }
  
  /**
   * Edit task title or description (LLM can call this)
   */
  async editTask(
    taskId: string,
    updates: { title?: string; description?: string; priority?: number; tags?: string[] }
  ): Promise<Task | null> {
    return this.update(taskId, updates);
  }
  
  /**
   * Get unfinished pending tasks for intermittent re-context
   * Returns tasks that are in progress, pending, or blocked but not completed
   */
  getUnfinishedTasks(options?: {
    limit?: number;
    minAge?: number; // minimum age in ms (tasks older than this)
  }): Task[] {
    const now = Date.now();
    const minAge = options?.minAge ?? 0;
    
    return Array.from(this.tasks.values())
      .filter(task => 
        task.status !== 'completed' && 
        task.status !== 'failed' && 
        task.status !== 'cancelled' &&
        task.retention !== 'archived' &&
        task.retention !== 'scratch' &&
        (now - task.updatedAt) >= minAge
      )
      .sort((a, b) => {
        // Sort by: in_progress first, then by priority, then by age
        if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
        if (b.status === 'in_progress' && a.status !== 'in_progress') return 1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      })
      .slice(0, options?.limit ?? 20);
  }
  
  /**
   * Mark a task for intermittent re-context (updates lastAccessedAt)
   */
  markForRecontext(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.lastAccessedAt = Date.now();
      this.markDirty();
    }
  }
  
  /**
   * Clear all tasks
   */
  async clear(): Promise<void> {
    this.tasks.clear();
    await this.backend.clear();
    log.info('[TaskStore] Cleared all tasks');
  }
  
  /**
   * Get store statistics
   */
  getStats(): {
    totalTasks: number;
    byRetention: Record<RetentionLevel, number>;
    byStatus: Record<TaskStatus, number>;
    completedToday: number;
    overdueTasks: number;
  } {
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    
    const byRetention: Record<RetentionLevel, number> = {
      scratch: 0,
      active: 0,
      queued: 0,
      suspended: 0,
      archived: 0,
    };
    
    const byStatus: Record<TaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      blocked: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    
    let completedToday = 0;
    let overdueTasks = 0;
    
    for (const task of this.tasks.values()) {
      byRetention[task.retention]++;
      byStatus[task.status]++;
      
      if (task.status === 'completed' && task.updatedAt >= todayStart) {
        completedToday++;
      }
      
      if (task.dueDate && task.dueDate < now && task.status !== 'completed') {
        overdueTasks++;
      }
    }
    
    return {
      totalTasks: this.tasks.size,
      byRetention,
      byStatus,
      completedToday,
      overdueTasks,
    };
  }
  
  // ─── Private helpers ───────────────────────────────────────────────────────
  
  private markDirty(): void {
    this.isDirty = true;
    
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    this.saveDebounceTimer = setTimeout(() => {
      this.persist();
    }, this.saveDebounceMs);
  }
  
  private async persist(): Promise<void> {
    if (!this.isDirty) return;
    
    try {
      await this.backend.save(Array.from(this.tasks.values()));
      this.isDirty = false;
      log.debug('[TaskStore] Persisted to storage');
    } catch (err) {
      log.error('[TaskStore] Persist failed:', err);
    }
  }
  
  private cleanExpiredTasks(): void {
    const now = Date.now();
    const ttlMap: Record<RetentionLevel, number> = {
      scratch: SCRATCH_TTL_MS,
      active: ACTIVE_TTL_MS,
      queued: QUEUED_TTL_MS,
      suspended: SUSPENDED_TTL_MS,
      archived: ARCHIVED_TTL_MS,
    };
    
    let cleaned = 0;
    
    for (const [id, task] of this.tasks) {
      const ttl = ttlMap[task.retention];
      if (ttl && now - (task.lastAccessedAt ?? task.updatedAt) > ttl) {
        // Only auto-delete scratch and completed archived tasks
        if (task.retention === 'scratch' || 
            (task.retention === 'archived' && task.status === 'completed')) {
          this.tasks.delete(id);
          cleaned++;
        }
      }
    }
    
    if (cleaned > 0) {
      log.info('[TaskStore] Cleaned expired tasks', { count: cleaned });
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let taskStoreInstance: TaskStore | null = null;

export function getTaskStore(): TaskStore {
  if (!taskStoreInstance) {
    taskStoreInstance = new TaskStore();
  }
  return taskStoreInstance;
}

export function resetTaskStore(): void {
  taskStoreInstance = null;
}

// ============================================================================
// Spec-Parser Integration
// ============================================================================

/**
 * Create tasks from spec-parser refinement chunks (DAG tasks).
 * Uses parallel creation for better performance.
 */
export async function createTasksFromSpecChunks(
  chunks: RefinementChunk[],
  options?: {
    retention?: RetentionLevel;
    parentId?: string;
    tags?: string[];
    specContext?: {
      sourcePlanId?: string;
      dagTaskId?: string;
    };
  }
): Promise<Task[]> {
  const store = getTaskStore();
  
  // Use Promise.all for parallel creation
  const taskCreations = chunks.map(async (chunk) => {
    return store.create({
      title: chunk.title,
      description: `Tasks: ${chunk.tasks.join(', ')}`,
      steps: chunk.tasks.map((t, i) => ({
        id: `step_${i}`,
        description: t,
        status: 'pending' as const,
        order: i,
      })),
      retention: options?.retention ?? 'queued',
      parentId: options?.parentId,
      tags: options?.tags ?? ['spec-parser', 'dag'],
      priority: chunk.priority ?? 50,
      specContext: {
        sourcePlanId: options?.specContext?.sourcePlanId,
        dagTaskId: options?.specContext?.dagTaskId,
        refinementChunk: chunk.title,
      },
    });
  });
  
  const tasks = await Promise.all(taskCreations);
  
  log.info('[TaskStore] Created tasks from spec chunks', { count: tasks.length });
  return tasks;
}

/**
 * Create a task hierarchy from a plan
 */
export async function createPlanTask(
  planTitle: string,
  planDescription: string,
  steps: string[],
  options?: {
    retention?: RetentionLevel;
    tags?: string[];
    priority?: number;
  }
): Promise<{ rootTask: Task; stepTasks: Task[] }> {
  const store = getTaskStore();
  
  // Create root task
  const rootTask = await store.create({
    title: planTitle,
    description: planDescription,
    retention: options?.retention ?? 'active',
    tags: options?.tags ?? ['plan'],
    priority: options?.priority ?? 70,
    steps: [],
  });
  
  // Create step tasks as children
  const stepTasks: Task[] = [];
  for (let i = 0; i < steps.length; i++) {
    const stepTask = await store.create({
      title: `Step ${i + 1}: ${steps[i]}`,
      description: steps[i],
      retention: options?.retention ?? 'active',
      parentId: rootTask.id,
      tags: ['plan-step', ...(options?.tags ?? [])],
      priority: 60,
      steps: [{
        id: 'main',
        description: steps[i],
        status: 'pending',
        order: 0,
      }],
    });
    stepTasks.push(stepTask);
  }
  
  // Update root task with step references
  await store.update(rootTask.id, {
    steps: stepTasks.map((t, i) => ({
      id: t.id,
      description: steps[i],
      status: t.status,
      order: i,
    })),
  });
  
  return { rootTask, stepTasks };
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Initialize task store (load from storage)
 */
export async function initializeTaskStore(): Promise<number> {
  const store = getTaskStore();
  return store.load();
}

/**
 * Get tasks for a specific context (for prompt injection)
 */
export function getRelevantTasks(
  context: string,
  options?: {
    retention?: RetentionLevel[];
    limit?: number;
  }
): Task[] {
  const store = getTaskStore();
  
  // Search by context
  const searched = store.search(context);
  
  // Filter by retention if specified
  let filtered = options?.retention
    ? searched.filter(t => options.retention!.includes(t.retention))
    : searched;
  
  // Exclude completed/archived by default
  filtered = filtered.filter(t =>
    t.retention !== 'archived' &&
    (t.retention !== 'scratch' || t.status === 'in_progress')
  );
  
  // Limit results
  return filtered.slice(0, options?.limit ?? 10);
}

/**
 * Format tasks for agent prompt injection
 */
export function formatTasksForPrompt(tasks: Task[]): string {
  if (tasks.length === 0) return '';
  
  const sections = tasks.map((task, idx) => {
    const status = task.status === 'in_progress' ? '🔄' :
                   task.status === 'blocked' ? '⛔' :
                   task.status === 'pending' ? '📋' : '✅';
    
    const progress = task.steps?.length
      ? `[${task.steps.filter(s => s.status === 'completed').length}/${task.steps.length}]`
      : `[${task.progress}%]`;
    
    return `${status} [Task ${idx + 1}] ${task.title} ${progress}\n   ${task.description || ''}`;
  });
  
  return `\n## Active Tasks\n${sections.join('\n')}\n`;
}

/**
 * Build a task prompt supplement for agent context
 */
export function buildTaskPromptSupplement(
  context: string,
  options?: {
    retention?: RetentionLevel[];
    limit?: number;
  }
): string {
  const tasks = getRelevantTasks(context, options);
  return formatTasksForPrompt(tasks);
}

// ============================================================================
// Storage Path Utility
// ============================================================================

export function getTaskStoragePath(): string {
  if (typeof window !== 'undefined') {
    return 'localStorage[\"agent_tasks\"]';
  }
  
  const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
  const configDir = process.env.QUAZ_CONFIG_DIR || `${homeDir}/.quaz`;
  return `${configDir}/tasks.json`;
}

export function isTaskStorageAvailable(): boolean {
  return typeof window !== 'undefined' || typeof process !== 'undefined';
}