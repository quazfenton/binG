/**
 * scheduler/types.ts
 *
 * Type definitions for the scheduler service, including the event-driven
 * triggers added in brainstorm step 7. The pre-existing types
 * (ScheduledTask, ScheduledTaskType, TaskExecutionResult) live inline in
 * `index.ts` for backward compatibility; this file adds the new event-
 * trigger types.
 *
 *  - 'event-handler' is a new ScheduledTaskType — the task body is invoked
 *    when an EventTriggerManager fires (git diff, marker-in-history, etc.).
 *  - EventTriggerConfig is a sub-config attached to such a task, describing
 *    which trigger source feeds into it.
 *  - IdleWindowConfig gates ALL event triggers during quiet hours.
 */

/** Kinds of event sources the EventTriggerManager understands. */
export type TriggerSource = 'new-git-changes' | 'marker-in-history'

/**
 * Configuration for the idle-window rule. When `enabled` is true, event
 * triggers (new-git-changes, marker-in-history) are suppressed during the
 * window between `startTime` and `endTime` in `timezone`. Overnight windows
 * (e.g. 23:00 → 07:00) wrap across midnight and are supported.
 */
export interface IdleWindowConfig {
  enabled: boolean
  /** "HH:MM" 24-hour local time, e.g. "23:00" */
  startTime: string
  /** "HH:MM" 24-hour local time, e.g. "07:00" */
  endTime: string
  /** IANA timezone, e.g. "America/Los_Angeles". Defaults to "UTC". */
  timezone: string
}

/**
 * Per-task event-trigger configuration. Attached to ScheduledTask.payload
 * (or ScheduledTask.eventTrigger) when the task type is 'event-handler'.
 */
export interface EventTriggerConfig {
  /** Which source fires this handler. */
  source: TriggerSource
  /**
   * What the source watches:
   *   - 'new-git-changes': the path to a git working tree (or a file inside it)
   *   - 'marker-in-history': the path to a log file to tail
   * For 'marker-in-history' multiple sources can be attached by creating
   * one 'event-handler' task per log file.
   */
  target: string
  /** Debounce in ms (default 2000). For 'new-git-changes' only. */
  debounceMs?: number
  /** Poll interval in ms (default 5000). For 'marker-in-history' only. */
  pollIntervalMs?: number
}

/**
 * Payload enqueued by the EventTriggerManager when a trigger fires. Lands on
 * the worker's job data alongside the existing `taskId`. The worker passes
 * it through to `executeTask` so the handler can read what triggered it.
 */
export interface TriggerEvent {
  source: TriggerSource
  taskId: string
  /** Source-specific data (git diff stat, marker content, etc.) */
  payload: Record<string, any>
  timestamp: number
  /** True if this event was suppressed by the idle-window rule at some point. */
  wasIdleGated?: boolean
}

/** Live status of the EventTriggerManager, surfaced via /triggers/status. */
export interface TriggerStatus {
  idleConfig: IdleWindowConfig
  isCurrentlyIdle: boolean
  /** Per-taskId watcher stats. */
  triggers: Array<{
    taskId: string
    source: TriggerSource
    target: string
    enabled: boolean
    lastFiredAt?: number
    fireCount: number
    /** Last error message, if any. */
    lastError?: string
  }>
}
