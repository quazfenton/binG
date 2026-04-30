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

/**
 * Multi-perspective analysis viewpoints for step enrichment
 */
export enum StepPerspective {
  /** Technical implementation perspective */
  TECHNICAL = 'technical',
  /** Quality assurance perspective */
  QA = 'qa',
  /** User experience perspective */
  UX = 'ux',
  /** Security and compliance perspective */
  SECURITY = 'security',
}

/**
 * Enrichment quality metrics
 */
export interface EnrichmentMetrics {
  /** Clarity score (0-100) */
  clarity: number;
  /** Completeness score (0-100) */
  completeness: number;
  /** Actionability score (0-100) */
  actionability: number;
  /** Risk assessment score (0-100) */
  riskAssessment: number;
  /** Overall quality score (0-100) */
  overall: number;
}

/**
 * Micro-step for hierarchical segmentation
 */
export interface MicroStep {
  /** Step description */
  description: string;
  /** Order index */
  order: number;
  /** Perspective that generated this step */
  perspective?: StepPerspective;
  /** Dependencies on other micro-steps */
  dependencies?: string[];
  /** Risk level (low/medium/high) */
  riskLevel?: 'low' | 'medium' | 'high';
  /** Time estimate in minutes (optional) */
  estimatedMinutes?: number;
}

/**
 * Multi-perspective enriched step result
 */
export interface MultiPerspectiveEnrichment {
  /** Original step description */
  original: string;
  /** Enriched step description */
  enriched: string;
  /** Detailed breakdown by perspective */
  perspectives: {
    technical: string;
    qa: string;
    ux: string;
    security: string;
  };
  /** Micro-steps from hierarchical segmentation */
  microSteps: MicroStep[];
  /** Quality metrics */
  metrics: EnrichmentMetrics;
  /** Risk flags */
  risks: string[];
  /** Recommendations */
  recommendations: string[];
}

/**
 * Technical perspective analysis
 */
function analyzeFromTechnicalPerspective(step: string, context?: string): string {
  const analysis: string[] = [];
  
  // Architecture considerations
  if (/implement|create|add/i.test(step)) {
    analysis.push('• Consider modularity and separation of concerns');
    analysis.push('• Evaluate integration points with existing systems');
    analysis.push('• Assess performance implications and scalability');
  }
  
  // Error handling
  if (/fix|update|refactor/i.test(step)) {
    analysis.push('• Identify potential side effects and dependencies');
    analysis.push('• Plan for backward compatibility if applicable');
    analysis.push('• Document API contracts and interfaces');
  }
  
  // Code quality
  analysis.push('• Follow existing coding standards and patterns');
  analysis.push('• Include error handling and edge case coverage');
  analysis.push('• Consider logging and observability requirements');
  
  return analysis.join('\n');
}

/**
 * QA perspective analysis
 */
function analyzeFromQAPerspective(step: string, context?: string): string {
  const analysis: string[] = [];
  
  // Testability
  analysis.push('• Define clear success criteria and acceptance tests');
  analysis.push('• Identify edge cases and boundary conditions');
  
  // Verification
  if (/test|verify|check/i.test(step)) {
    analysis.push('• Specify test data requirements and fixtures');
    analysis.push('• Plan for automated regression testing');
  } else {
    analysis.push('• Plan manual and automated verification steps');
  }
  
  // Quality gates
  if (/implement|create|add/i.test(step)) {
    analysis.push('• Consider integration testing with dependent components');
    analysis.push('• Define performance benchmarks if applicable');
  }
  
  // Documentation
  analysis.push('• Ensure test coverage meets quality thresholds');
  analysis.push('• Document expected behavior and edge cases');
  
  return analysis.join('\n');
}

/**
 * UX perspective analysis
 */
function analyzeFromUXPerspective(step: string, context?: string): string {
  const analysis: string[] = [];
  
  // User impact
  if (/implement|create|add/i.test(step)) {
    analysis.push('• Evaluate impact on user workflows and experience');
    analysis.push('• Consider accessibility requirements (WCAG compliance)');
    analysis.push('• Plan for user onboarding if behavior changes');
  }
  
  // Feedback
  if (/fix|update/i.test(step)) {
    analysis.push('• Consider how changes affect existing user expectations');
    analysis.push('• Plan communication strategy for behavior changes');
  }
  
  // Usability
  analysis.push('• Ensure UI/UX consistency with existing patterns');
  analysis.push('• Consider error messages and user guidance');
  analysis.push('• Plan for gradual rollout if significant change');
  
  return analysis.join('\n');
}

/**
 * Security perspective analysis
 */
function analyzeFromSecurityPerspective(step: string, context?: string): string {
  const analysis: string[] = [];
  
  // Input validation
  if (/implement|create|add|fix/i.test(step)) {
    analysis.push('• Validate all input data and sanitize user content');
    analysis.push('• Apply principle of least privilege');
    analysis.push('• Consider authentication and authorization requirements');
  }
  
  // Data handling
  if (/test|verify|check/i.test(step)) {
    analysis.push('• Review data exposure and privacy implications');
  } else {
    analysis.push('• Ensure sensitive data is handled securely');
    analysis.push('• Consider encryption requirements for data at rest/transit');
  }
  
  // Compliance
  analysis.push('• Audit trail and logging for sensitive operations');
  analysis.push('• Consider regulatory compliance (GDPR, SOC2, etc.)');
  analysis.push('• Plan security review if handling PII or financial data');
  
  return analysis.join('\n');
}

/**
 * Segment step into hierarchical micro-steps
 */
function segmentIntoMicroSteps(step: string, context?: string): MicroStep[] {
  const microSteps: MicroStep[] = [];
  let order = 0;
  
  // Helper to add dependency safely (only if there are previous steps)
  const addDependency = (): string[] => {
    if (microSteps.length > 0) {
      return [microSteps[microSteps.length - 1].description];
    }
    return [];
  };
  
  // Phase 1: Discovery/Planning
  const hasImplementation = /implement|create|add/i.test(step);
  const hasFix = /fix|update|refactor/i.test(step);
  const hasTesting = /test|verify|check/i.test(step);
  
  if (hasImplementation || hasFix) {
    // Add planning micro-steps
    microSteps.push({
      description: 'Research and gather requirements for: ' + step,
      order: order++,
      perspective: StepPerspective.TECHNICAL,
      riskLevel: 'low',
      estimatedMinutes: 15,
    });
    
    microSteps.push({
      description: 'Design solution architecture',
      order: order++,
      perspective: StepPerspective.TECHNICAL,
      dependencies: [microSteps[0].description],
      riskLevel: 'medium',
      estimatedMinutes: 20,
    });
  }
  
  // Phase 2: Implementation
  if (hasImplementation) {
    microSteps.push({
      description: 'Implement core functionality for: ' + step,
      order: order++,
      perspective: StepPerspective.TECHNICAL,
      riskLevel: 'medium',
      estimatedMinutes: 60,
    });
    
    microSteps.push({
      description: 'Add error handling and edge cases',
      order: order++,
      perspective: StepPerspective.TECHNICAL,
      dependencies: addDependency(),
      riskLevel: 'medium',
      estimatedMinutes: 20,
    });
  }
  
  if (hasFix) {
    microSteps.push({
      description: 'Identify root cause of: ' + step,
      order: order++,
      perspective: StepPerspective.QA,
      riskLevel: 'high',
      estimatedMinutes: 30,
    });
    
    microSteps.push({
      description: 'Implement fix with regression prevention',
      order: order++,
      perspective: StepPerspective.TECHNICAL,
      dependencies: addDependency(),
      riskLevel: 'high',
      estimatedMinutes: 45,
    });
  }
  
  // Phase 3: Quality Assurance
  if (hasImplementation || hasFix) {
    microSteps.push({
      description: 'Write/update unit tests',
      order: order++,
      perspective: StepPerspective.QA,
      dependencies: addDependency(),
      riskLevel: 'low',
      estimatedMinutes: 30,
    });
    
    microSteps.push({
      description: 'Run integration tests and verify functionality',
      order: order++,
      perspective: StepPerspective.QA,
      dependencies: addDependency(),
      riskLevel: 'medium',
      estimatedMinutes: 20,
    });
  }
  
  if (hasTesting) {
    microSteps.push({
      description: 'Define test criteria for: ' + step,
      order: order++,
      perspective: StepPerspective.QA,
      riskLevel: 'low',
      estimatedMinutes: 15,
    });
    
    microSteps.push({
      description: 'Execute tests and document results',
      order: order++,
      perspective: StepPerspective.QA,
      dependencies: addDependency(),
      riskLevel: 'low',
      estimatedMinutes: 30,
    });
  }
  
  // Phase 4: Validation & Documentation
  // Calculate second-to-last dependency if exists
  const secondLastDep = microSteps.length >= 2 
    ? [microSteps[microSteps.length - 2].description] 
    : [];
  
  microSteps.push({
    description: 'Validate against original requirements',
    order: order++,
    perspective: StepPerspective.QA,
    dependencies: secondLastDep,
    riskLevel: 'low',
    estimatedMinutes: 10,
  });
  
  microSteps.push({
    description: 'Update documentation and mark complete',
    order: order++,
    perspective: StepPerspective.TECHNICAL,
    dependencies: addDependency(),
    riskLevel: 'low',
    estimatedMinutes: 10,
  });
  
  return microSteps;
}

/**
 * Calculate enrichment quality metrics
 */
function calculateEnrichmentMetrics(
  step: string,
  enriched: string,
  microSteps: MicroStep[]
): EnrichmentMetrics {
  // Clarity: based on sentence completeness and specificity
  const hasVerb = /^(implement|create|add|fix|update|test|verify|check|review|document)/i.test(step);
  const hasObject = step.split(' ').length > 2;
  const clarity = (hasVerb ? 30 : 0) + (hasObject ? 30 : 0) + (enriched.length > step.length ? 20 : 0) + Math.min(20, microSteps.length * 5);
  
  // Completeness: based on micro-steps and context coverage
  const completeness = Math.min(100, 30 + microSteps.length * 15 + (enriched.includes('\n') ? 20 : 0));
  
  // Actionability: based on ordered steps with estimates
  const hasEstimates = microSteps.filter(m => m.estimatedMinutes).length > 0;
  const hasOrder = microSteps.every(m => m.order !== undefined);
  const actionability = (hasEstimates ? 40 : 0) + (hasOrder ? 30 : 0) + Math.min(30, microSteps.length * 10);
  
  // Risk assessment: based on risk flags and high-risk steps
  const highRiskSteps = microSteps.filter(m => m.riskLevel === 'high').length;
  const riskAssessment = Math.max(0, 100 - highRiskSteps * 25 - (step.includes('fix') ? 15 : 0));
  
  // Overall: weighted average
  const overall = Math.round((clarity * 0.3 + completeness * 0.3 + actionability * 0.25 + riskAssessment * 0.15));
  
  return {
    clarity: Math.min(100, clarity),
    completeness: Math.min(100, completeness),
    actionability: Math.min(100, actionability),
    riskAssessment: Math.min(100, riskAssessment),
    overall: Math.min(100, overall),
  };
}

/**
 * Identify risks in step
 */
function identifyRisks(step: string, microSteps: MicroStep[]): string[] {
  const risks: string[] = [];
  
  // Technical risks
  if (/fix|update|refactor/i.test(step)) {
    risks.push('⚠️ Risk: Changes may introduce regressions in dependent components');
  }
  
  if (/create|add/i.test(step)) {
    risks.push('⚠️ Risk: New functionality may conflict with existing architecture');
  }
  
  // Security risks
  if (/implement|create|add/i.test(step)) {
    if (/user|auth|login|password|credential/i.test(step)) {
      risks.push('🔒 Security: Authentication/authorization validation required');
    }
    if (/input|form|upload|file/i.test(step)) {
      risks.push('🔒 Security: Input validation and sanitization required');
    }
  }
  
  // High-risk micro-steps
  const highRiskCount = microSteps.filter(m => m.riskLevel === 'high').length;
  if (highRiskCount > 0) {
    risks.push(`⚠️ Risk: ${highRiskCount} high-risk micro-step(s) identified`);
  }
  
  // Complexity risk
  if (microSteps.length > 6) {
    risks.push('⚠️ Complexity: Consider breaking into smaller sub-tasks');
  }
  
  return risks;
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations(
  step: string,
  metrics: EnrichmentMetrics,
  risks: string[]
): string[] {
  const recommendations: string[] = [];
  
  // Quality-based recommendations
  if (metrics.clarity < 70) {
    recommendations.push('💡 Consider adding more specific action words (implement, configure, deploy)');
  }
  
  if (metrics.completeness < 70) {
    recommendations.push('💡 Break down into smaller, more specific steps for better tracking');
  }
  
  if (metrics.actionability < 70) {
    recommendations.push('💡 Add time estimates and dependencies to improve planning');
  }
  
  // Risk-based recommendations
  if (risks.some(r => r.includes('Security'))) {
    recommendations.push('💡 Schedule security review before deployment');
  }
  
  if (risks.some(r => r.includes('regression'))) {
    recommendations.push('💡 Plan regression testing in staging environment');
  }
  
  // General recommendations
  if (metrics.overall >= 80) {
    recommendations.push('✅ Step is well-defined with good actionability');
  }
  
  return recommendations;
}

/**
 * Enrich a step description using LLM-like expansion
 * Takes a brief step description and returns a more detailed version
 * with qualifications, scope, and enriched context
 */
export async function enrichStep(
  step: string,
  context?: string
): Promise<{ enriched: string; breakdown?: string[] }> {
  // Pattern-based enrichment for common step types
  const enriched = step.trim();
  
  // Detection patterns for expansion
  const patterns = [
    // Implementation steps
    { pattern: /^implement/i, prefix: 'Implement the following: ', enrich: (s: string) => s },
    { pattern: /^add/i, prefix: 'Add the following feature/component: ', enrich: (s: string) => s },
    { pattern: /^create/i, prefix: 'Create a new instance of: ', enrich: (s: string) => s },
    { pattern: /^fix/i, prefix: 'Fix the following issue: ', enrich: (s: string) => s },
    { pattern: /^update/i, prefix: 'Update/upgrade: ', enrich: (s: string) => s },
    { pattern: /^refactor/i, prefix: 'Refactor/improve: ', enrich: (s: string) => s },
    // Testing steps
    { pattern: /^test/i, prefix: 'Test the following scenario: ', enrich: (s: string) => s },
    { pattern: /^verify/i, prefix: 'Verify that: ', enrich: (s: string) => s },
    { pattern: /^check/i, prefix: 'Check for: ', enrich: (s: string) => s },
    // Documentation steps
    { pattern: /^document/i, prefix: 'Document the following: ', enrich: (s: string) => s },
    { pattern: /^write/i, prefix: 'Write documentation for: ', enrich: (s: string) => s },
    { pattern: /^review/i, prefix: 'Review the following: ', enrich: (s: string) => s },
  ];
  
  // Apply pattern-based enrichment
  for (const { pattern, prefix, enrich } of patterns) {
    if (pattern.test(enriched)) {
      const detailed = enrich(enriched);
      // Add scope qualifiers based on context
      const withContext = context 
        ? `${detailed} (Context: ${context})` 
        : detailed;
      
      return {
        enriched: withContext,
        breakdown: [
          `• ${prefix}${enriched}`,
          '• Sub-tasks: Identify dependencies',
          '• Verification: Test completion criteria',
        ],
      };
    }
  }
  
  // Default enrichment for unrecognized patterns
  return {
    enriched: context 
      ? `${enriched} (Context: ${context})` 
      : enriched,
    breakdown: [
      `• ${enriched}`,
      '• Break down into smaller steps if needed',
      '• Add completion criteria',
    ],
  };
}

/**
 * Multi-perspective step enrichment - state-of-the-art analysis
 * Analyzes step from 4 perspectives: Technical, QA, UX, Security
 */
export async function enrichStepMultiPerspective(
  step: string,
  context?: string,
  options?: {
    includeMicroSteps?: boolean;
    targetMetrics?: Partial<EnrichmentMetrics>;
  }
): Promise<MultiPerspectiveEnrichment> {
  // Analyze from each perspective
  const perspectives = {
    technical: analyzeFromTechnicalPerspective(step, context),
    qa: analyzeFromQAPerspective(step, context),
    ux: analyzeFromUXPerspective(step, context),
    security: analyzeFromSecurityPerspective(step, context),
  };
  
  // Segment into micro-steps if requested
  const microSteps = options?.includeMicroSteps !== false 
    ? segmentIntoMicroSteps(step, context) 
    : [];
  
  // Calculate quality metrics
  const metrics = calculateEnrichmentMetrics(step, step, microSteps);
  
  // Identify risks
  const risks = identifyRisks(step, microSteps);
  
  // Generate recommendations
  const recommendations = generateRecommendations(step, metrics, risks);
  
  // Build enriched description
  const enriched = context 
    ? `${step.trim()} (Context: ${context})` 
    : step.trim();
  
  return {
    original: step,
    enriched,
    perspectives,
    microSteps,
    metrics,
    risks,
    recommendations,
  };
}

/**
 * Batch multi-perspective enrichment for multiple steps
 * 
 * @param steps - Array of step descriptions to enrich
 * @param context - Optional context for enrichment
 * @param options - Configuration options
 * @param options.parallel - Whether to process in parallel (default: true)
 * @param options.includeMicroSteps - Whether to include micro-step segmentation (default: true)
 * @returns Array of MultiPerspectiveEnrichment results (with error property on failure)
 * 
 * @example
 * ```typescript
 * const results = await enrichStepsMultiPerspective([
 *   'Implement user authentication',
 *   'Add error handling'
 * ], 'building a web app');
 * 
 * // Handle results (some may have 'error' property)
 * results.forEach((r, i) => {
 *   if ('error' in r) {
 *     console.log(`Step ${i} failed:`, r.error);
 *   } else {
 *     console.log(`Step ${i} enriched:`, r.enriched);
 *   }
 * });
 * ```
 */
export async function enrichStepsMultiPerspective(
  steps: string[],
  context?: string,
  options?: {
    includeMicroSteps?: boolean;
    parallel?: boolean;
  }
): Promise<Array<MultiPerspectiveEnrichment & { error?: string }>> {
  if (options?.parallel !== false) {
    // Parallel processing with error isolation - each step is wrapped in try/catch
    return Promise.all(
      steps.map(async (step, index) => {
        try {
          return await enrichStepMultiPerspective(step, context, options);
        } catch (error) {
          // Return error result for this step, but don't reject the entire batch
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            original: step,
            enriched: step, // Fallback to original
            perspectives: {
              technical: '⚠️ Error during analysis',
              qa: '⚠️ Error during analysis',
              ux: '⚠️ Error during analysis',
              security: '⚠️ Error during analysis',
            },
            microSteps: [],
            metrics: {
              clarity: 0,
              completeness: 0,
              actionability: 0,
              riskAssessment: 0,
              overall: 0,
            },
            risks: [`Error at step ${index + 1}: ${errorMessage}`],
            recommendations: ['Review step definition and try again'],
            error: errorMessage,
          };
        }
      })
    );
  }
  
  // Sequential processing with error isolation
  const results: Array<MultiPerspectiveEnrichment & { error?: string }> = [];
  for (let i = 0; i < steps.length; i++) {
    try {
      const result = await enrichStepMultiPerspective(steps[i], context, options);
      results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      results.push({
        original: steps[i],
        enriched: steps[i],
        perspectives: {
          technical: '⚠️ Error during analysis',
          qa: '⚠️ Error during analysis',
          ux: '⚠️ Error during analysis',
          security: '⚠️ Error during analysis',
        },
        microSteps: [],
        metrics: {
          clarity: 0,
          completeness: 0,
          actionability: 0,
          riskAssessment: 0,
          overall: 0,
        },
        risks: [`Error at step ${i + 1}: ${errorMessage}`],
        recommendations: ['Review step definition and try again'],
        error: errorMessage,
      });
    }
  }
  return results;
}

/**
 * Hierarchical step segmentation - break complex steps into ordered micro-steps
 * 
 * @param step - The step description to segment
 * @param options - Optional configuration (maxDepth, includeDependencies - currently unused for synchronous version)
 * @returns Array of MicroStep objects with ordered breakdown
 * 
 * @example
 * ```typescript
 * const steps = segmentStepHierarchically('Implement user authentication');
 * // Returns: [ MicroStep { description, order, perspective, ... }, ... ]
 * ```
 */
export function segmentStepHierarchically(
  step: string,
  options?: {
    maxDepth?: number;
    includeDependencies?: boolean;
  }
): MicroStep[] {
  // This is a synchronous wrapper - the actual logic is in segmentIntoMicroSteps
  // Future: could support async with LLM-based segmentation for more complex steps
  return segmentIntoMicroSteps(step, options?.includeDependencies);
}

/**
 * Generate step recommendations based on task context
 */
export function generateStepRecommendations(
  task: Task,
  currentStepIndex?: number
): string[] {
  const recommendations: string[] = [];
  
  // Task-level recommendations
  if (task.progress < 30) {
    recommendations.push('💡 Consider adding more granular initial steps');
  }
  
  if (task.progress > 70 && task.progress < 100) {
    recommendations.push('💡 nearing completion - ensure testing and documentation');
  }
  
  // Step-level recommendations
  if (currentStepIndex !== undefined && task.steps) {
    const currentStep = task.steps[currentStepIndex];
    if (currentStep) {
      if (currentStep.status === 'in_progress') {
        recommendations.push(`💡 Currently working on: ${currentStep.description}`);
      }
      
      // Check for unstarted steps after current
      const upcomingSteps = task.steps.slice(currentStepIndex + 1);
      const pendingCount = upcomingSteps.filter(s => s.status === 'pending').length;
      if (pendingCount > 3) {
        recommendations.push(`💡 ${pendingCount} upcoming steps - consider adding milestones`);
      }
    }
  }
  
  // Priority-based recommendations
  if (task.priority >= 80) {
    recommendations.push('🔥 High priority task - consider allocating focused time');
  }
  
  // Time-based recommendations
  if (task.dueDate) {
    const daysUntilDue = Math.ceil((task.dueDate - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilDue <= 2 && task.status !== 'completed') {
      recommendations.push(`⚠️ Due in ${daysUntilDue} day(s) - prioritize remaining steps`);
    }
  }
  
  return recommendations;
}

/**
 * Expand a step into detailed sub-steps with scope enrichment
 * Provides microscopic detailing of step qualifications and enriched scope
 */
export function expandStepIntoDetail(
  step: string,
  context?: string
): {
  original: string;
  expanded: string[];
  scope: {
    inclusions: string[];
    exclusions: string[];
    qualifications: string[];
  };
  complexity: 'simple' | 'moderate' | 'complex';
} {
  const trimmedStep = step.trim();
  const expanded: string[] = [];
  const scope = {
    inclusions: [] as string[],
    exclusions: [] as string[],
    qualifications: [] as string[],
  };
  
  // Detect step type for targeted expansion
  const isImplement = /^implement/i.test(trimmedStep);
  const isCreate = /^create/i.test(trimmedStep);
  const isFix = /^fix/i.test(trimmedStep);
  const isTest = /^test/i.test(trimmedStep);
  const isDocument = /^(?:document|write|review)/i.test(trimmedStep);
  
  // Scope analysis
  if (isImplement || isCreate) {
    scope.inclusions.push('Core functionality implementation');
    scope.inclusions.push('Error handling');
    scope.inclusions.push('Input validation');
    scope.exclusions.push('Major architectural refactoring');
    scope.exclusions.push('UI changes unless specified');
    scope.qualifications.push('Must integrate with existing code patterns');
    scope.qualifications.push('Follow established coding standards');
  }
  
  if (isFix) {
    scope.inclusions.push('Root cause identification');
    scope.inclusions.push('Fix implementation');
    scope.inclusions.push('Regression prevention');
    scope.exclusions.push('Feature additions');
    scope.qualifications.push('Must not break existing functionality');
    scope.qualifications.push('Consider backward compatibility');
  }
  
  if (isTest) {
    scope.inclusions.push('Test case definition');
    scope.inclusions.push('Test data preparation');
    scope.inclusions.push('Execution and documentation');
    scope.exclusions.push('Code changes unless fixing test');
    scope.qualifications.push('Define clear pass/fail criteria');
  }
  
  if (isDocument) {
    scope.inclusions.push('Content creation');
    scope.inclusions.push('Review and revision');
    scope.inclusions.push('Final approval');
    scope.exclusions.push('Code implementation');
    scope.qualifications.push('Must be clear and actionable');
    scope.qualifications.push('Include examples where helpful');
  }
  
  // Generate expanded sub-steps based on complexity
  const wordCount = trimmedStep.split(/\s+/).length;
  const hasComplexTerms = /framework|system|module|service|api|database/i.test(trimmedStep);
  const complexity: 'simple' | 'moderate' | 'complex' = 
    wordCount > 10 || hasComplexTerms ? 'complex' :
    wordCount > 5 ? 'moderate' : 'simple';
  
  // Basic expansion for all
  expanded.push(`1. Analyze requirements for: ${trimmedStep}`);
  
  if (isImplement || isCreate) {
    expanded.push('2. Design implementation approach');
    expanded.push('3. Implement core functionality');
    expanded.push('4. Add error handling and edge cases');
    if (complexity === 'complex') {
      expanded.push('5. Add integration with dependent components');
      expanded.push('6. Perform security review');
    }
    expanded.push(complexity === 'complex' ? '7. Test and verify' : '5. Test and verify');
    expanded.push(complexity === 'complex' ? '8. Update documentation' : '6. Update documentation');
  } else if (isFix) {
    expanded.push('2. Identify root cause');
    expanded.push('3. Implement fix');
    expanded.push('4. Add regression tests');
    expanded.push('5. Verify fix and test edge cases');
  } else if (isTest) {
    expanded.push('2. Define test criteria');
    expanded.push('3. Prepare test data');
    expanded.push('4. Execute tests');
    expanded.push('5. Document results');
  } else if (isDocument) {
    expanded.push('2. Research and gather information');
    expanded.push('3. Create draft content');
    expanded.push('4. Review and revise');
    expanded.push('5. Finalize and publish');
  } else {
    expanded.push('2. Execute the step');
    expanded.push('3. Verify completion');
    expanded.push('4. Document results');
  }
  
  return {
    original: trimmedStep,
    expanded,
    scope,
    complexity,
  };
}

/**
 * Interactive step completion marking
 * Marks steps as LLM-suggested or user-verified with quality feedback
 * 
 * This enables tracking of step completion quality over time, allowing:
 * - LLM to self-assess work quality
 * - User to verify/override LLM assessments
 * - Historical quality tracking for agent improvement
 */
export interface StepCompletionMark {
  stepId: string;
  stepDescription: string;
  markedBy: 'llm' | 'user';
  timestamp: number;
  quality?: 'excellent' | 'good' | 'needs_work';
  feedback?: string;
}

/**
 * Mark a step completion with quality feedback
 * 
 * @param stepDescription - Description of the completed step
 * @param markedBy - Who marked the completion ('llm' for agent, 'user' for human)
 * @param options - Optional quality rating and feedback
 * @returns StepCompletionMark with unique ID and timestamp
 * 
 * @example
 * ```typescript
 * // LLM self-assessment after completing a task
 * const mark = markStepCompletion(
 *   'Implemented user authentication with JWT',
 *   'llm',
 *   { quality: 'good', feedback: 'Completed but could improve test coverage' }
 * );
 * 
 * // User verification after reviewing LLM work
 * const userMark = markStepCompletion(
 *   'Added error handling to API endpoints',
 *   'user',
 *   { quality: 'excellent', feedback: 'Thorough implementation' }
 * );
 * 
 * // Use with TaskStore to track completion
 * await store.completeStep(taskId, stepId, mark.feedback);
 * ```
 * 
 * @see TaskStore.completeStep
 * @see TaskStore.completeStepWithMark
 */
export function markStepCompletion(
  stepDescription: string,
  markedBy: 'llm' | 'user',
  options?: {
    quality?: 'excellent' | 'good' | 'needs_work';
    feedback?: string;
  }
): StepCompletionMark {
  return {
    stepId: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    stepDescription,
    markedBy,
    timestamp: Date.now(),
    quality: options?.quality,
    feedback: options?.feedback,
  };
}

/**
 * Extended TaskStore method for completing steps with quality marks
 * 
 * @param taskId - Task ID
 * @param stepId - Step ID to complete
 * @param mark - Completion mark from markStepCompletion()
 * @returns Updated task or null
 * 
 * @example
 * ```typescript
 * const mark = markStepCompletion(
 *   'Implement feature X',
 *   'llm',
 *   { quality: 'good' }
 * );
 * await store.completeStepWithMark(taskId, stepId, mark);
 * ```
 */
export async function completeStepWithMark(
  taskId: string,
  stepId: string,
  mark: StepCompletionMark
): Promise<Task | null> {
  const store = getTaskStore();
  return store.completeStep(taskId, stepId, mark.feedback);
}

/**
 * Validate step quality and return improvement suggestions
 */
export function validateStepQuality(
  step: string
): { valid: boolean; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  // Check for action verb at START of string (after trimming)
  const trimmedStep = step.trim();
  const actionVerbs = ['implement', 'create', 'add', 'fix', 'update', 'refactor', 'test', 'verify', 'check', 'review', 'document', 'configure', 'deploy', 'debug', 'write', 'build', 'setup', 'install', 'run', 'execute', 'analyze', 'design', 'plan', 'research'];
  const firstWord = trimmedStep.split(/\s+/)[0]?.toLowerCase() || '';
  const hasActionVerb = actionVerbs.some(verb => firstWord === verb || firstWord.startsWith(verb + ' '));
  
  if (!hasActionVerb) {
    issues.push('Missing action verb at start of step');
    suggestions.push('Start with: ' + actionVerbs.slice(0, 8).join(', ') + ', etc.');
  }
  
  // Check for specificity
  const words = trimmedStep.split(/\s+/);
  if (words.length < 3) {
    issues.push('Step is too vague');
    suggestions.push('Add more context about what exactly needs to be done');
  }
  
  // Check for vague terms (word boundary matching to avoid partial matches)
  const vagueTerms = ['stuff', 'things', 'it', 'this', 'that', 'etc', 'something'];
  const wordPattern = new RegExp('\\b(' + vagueTerms.join('|') + ')\\b', 'i');
  const hasVague = wordPattern.test(trimmedStep);
  if (hasVague) {
    issues.push('Contains vague terminology');
    suggestions.push('Replace vague terms with specific descriptions');
  }
  
  // Check for ambiguity
  if (/and then|after that|some point|then also/i.test(trimmedStep)) {
    issues.push('Step may contain multiple actions');
    suggestions.push('Consider breaking into separate steps for better tracking');
  }
  
  return {
    valid: issues.length === 0,
    issues,
    suggestions,
  };
}

/**
 * Enrich multiple steps at once (batch operation)
 */
export async function enrichSteps(
  steps: string[],
  context?: string
): Promise<Array<{ original: string; enriched: string; breakdown?: string[] }>> {
  return Promise.all(
    steps.map(step => enrichStep(step, context))
      .map((p, i) => p.then(result => ({
        original: steps[i],
        enriched: result.enriched,
        breakdown: result.breakdown,
      })))
  );
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