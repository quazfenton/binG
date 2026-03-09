/**
 * Unified Execution Recorder
 *
 * Provides deterministic replay of sandbox operations across all providers.
 * Records all operations (commands, file writes, reads) with timestamps and results.
 *
 * Features:
 * - Operation recording with full context
 * - Export/import for replay
 * - Deterministic replay mode
 * - Configurable max events
 * - Auto-cleanup on session end
 *
 * @example
 * ```typescript
 * import { createExecutionRecorder } from './unified-execution-recorder'
 *
 * const recorder = createExecutionRecorder({ maxEvents: 10000 })
 * const recordedHandle = recorder.wrap(sandboxHandle)
 *
 * // Use recordedHandle normally - all operations are recorded
 * await recordedHandle.executeCommand('npm install')
 * await recordedHandle.writeFile('src/index.ts', '...')
 *
 * // Export recording
 * const exportData = recorder.export()
 *
 * // Replay on another sandbox
 * await recorder.replay(exportData, targetSandboxHandle)
 * ```
 */

import type { SandboxHandle } from './sandbox-provider'
import type { ToolResult } from '../types'

export enum ExecutionEventType {
  COMMAND = 'command',
  WRITE_FILE = 'write_file',
  READ_FILE = 'read_file',
  LIST_DIR = 'list_dir',
  CREATE_FILE = 'create_file',
  APPLY_DIFF = 'apply_diff',
  CUSTOM = 'custom',
}

export interface ExecutionEvent {
  id: string
  type: ExecutionEventType
  timestamp: number
  duration: number
  success: boolean
  error?: string
  
  // Command-specific
  command?: string
  cwd?: string
  
  // File-specific
  path?: string
  content?: string
  search?: string
  replace?: string
  
  // Result
  output?: string
  exitCode?: number
  
  // Metadata
  metadata?: Record<string, any>
}

export interface ExecutionRecorderConfig {
  maxEvents?: number
  enabled?: boolean
  recordReads?: boolean  // Record read operations (may contain sensitive data)
  recordOutput?: boolean // Record command outputs
  autoPrune?: boolean    // Auto-remove oldest events when max reached
}

export interface ExecutionRecorder {
  /**
   * Record an execution event
   */
  record(event: Omit<ExecutionEvent, 'id' | 'timestamp' | 'duration'>): ExecutionEvent
  
  /**
   * Get all recorded events
   */
  getEvents(): ExecutionEvent[]
  
  /**
   * Get event count
   */
  getCount(): number
  
  /**
   * Export recording for storage or replay
   */
  export(): ExecutionRecordingExport
  
  /**
   * Import recording from export
   */
  import(exportData: ExecutionRecordingExport): void
  
  /**
   * Clear all recorded events
   */
  clear(): void
  
  /**
   * Replay recorded operations on a sandbox handle
   */
  replay(exportData: ExecutionRecordingExport, handle: SandboxHandle): Promise<ReplayResult>
  
  /**
   * Wrap a sandbox handle to automatically record all operations
   */
  wrap(handle: SandboxHandle): SandboxHandle
  
  /**
   * Enable/disable recording
   */
  setEnabled(enabled: boolean): void
  
  /**
   * Check if recorder is enabled
   */
  isEnabled(): boolean
}

export interface ExecutionRecordingExport {
  version: string
  createdAt: number
  sandboxId?: string
  provider?: string
  events: ExecutionEvent[]
  metadata?: Record<string, any>
}

export interface ReplayResult {
  success: boolean
  totalEvents: number
  successfulEvents: number
  failedEvents: number
  duration: number
  errors?: Array<{ eventIndex: number; error: string }>
}

class UnifiedExecutionRecorder implements ExecutionRecorder {
  private events: ExecutionEvent[] = []
  private config: Required<ExecutionRecorderConfig>
  private enabled: boolean
  private eventIdCounter = 0

  constructor(config: ExecutionRecorderConfig = {}) {
    this.config = {
      maxEvents: config.maxEvents || 10000,
      enabled: config.enabled ?? true,
      recordReads: config.recordReads ?? false,
      recordOutput: config.recordOutput ?? true,
      autoPrune: config.autoPrune ?? true,
    }
    this.enabled = this.config.enabled
  }

  record(event: Omit<ExecutionEvent, 'id' | 'timestamp' | 'duration'>): ExecutionEvent {
    if (!this.enabled) {
      return {
        ...event,
        id: '',
        timestamp: 0,
        duration: 0,
      } as ExecutionEvent
    }

    const startTime = Date.now()
    this.eventIdCounter++
    
    const recordedEvent: ExecutionEvent = {
      ...event,
      id: `evt-${this.eventIdCounter}-${Date.now()}`,
      timestamp: startTime,
      duration: 0, // Will be updated when event completes
    }

    // Don't record read operations if disabled
    if (event.type === ExecutionEventType.READ_FILE && !this.config.recordReads) {
      return recordedEvent
    }

    this.events.push(recordedEvent)

    // Auto-prune if max events reached
    if (this.config.autoPrune && this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(-this.config.maxEvents)
    }

    return recordedEvent
  }

  completeEvent(eventId: string, result: ToolResult, startTime: number): void {
    const event = this.events.find(e => e.id === eventId)
    if (event) {
      event.duration = Date.now() - startTime
      event.success = result.success
      // ToolResult doesn't have error property, use output for error messages
      event.error = result.success ? undefined : result.output
      event.output = this.config.recordOutput ? result.output : undefined
      event.exitCode = result.exitCode
    }
  }

  getEvents(): ExecutionEvent[] {
    return [...this.events]
  }

  getCount(): number {
    return this.events.length
  }

  export(): ExecutionRecordingExport {
    return {
      version: '1.0',
      createdAt: Date.now(),
      events: [...this.events],
      metadata: {
        totalEvents: this.events.length,
        successfulEvents: this.events.filter(e => e.success).length,
        failedEvents: this.events.filter(e => !e.success).length,
      },
    }
  }

  import(exportData: ExecutionRecordingExport): void {
    if (exportData.version !== '1.0') {
      throw new Error(`Unsupported export version: ${exportData.version}`)
    }
    this.events = [...exportData.events]
    this.eventIdCounter = exportData.events.length
  }

  clear(): void {
    this.events = []
    this.eventIdCounter = 0
  }

  async replay(
    exportData: ExecutionRecordingExport,
    handle: SandboxHandle
  ): Promise<ReplayResult> {
    const errors: Array<{ eventIndex: number; error: string }> = []
    let successfulEvents = 0

    const startTime = Date.now()

    for (let i = 0; i < exportData.events.length; i++) {
      const event = exportData.events[i]

      try {
        let result: ToolResult

        switch (event.type) {
          case ExecutionEventType.COMMAND:
            if (event.command) {
              result = await handle.executeCommand(event.command, event.cwd)
            } else {
              continue
            }
            break

          case ExecutionEventType.WRITE_FILE:
          case ExecutionEventType.CREATE_FILE:
            if (event.path && event.content !== undefined) {
              result = await handle.writeFile(event.path, event.content)
            } else {
              continue
            }
            break

          case ExecutionEventType.READ_FILE:
            if (event.path) {
              result = await handle.readFile(event.path)
            } else {
              continue
            }
            break

          case ExecutionEventType.LIST_DIR:
            if (event.path) {
              result = await handle.listDirectory(event.path)
            } else {
              continue
            }
            break

          default:
            continue
        }

        if (result.success) {
          successfulEvents++
        } else {
          // ToolResult doesn't have error property, use output
          errors.push({ eventIndex: i, error: result.output || 'Unknown error' })
        }
      } catch (error: any) {
        errors.push({
          eventIndex: i,
          error: error.message || 'Replay failed',
        })
      }
    }

    return {
      success: errors.length === 0,
      totalEvents: exportData.events.length,
      successfulEvents,
      failedEvents: errors.length,
      duration: Date.now() - startTime,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  wrap(handle: SandboxHandle): SandboxHandle {
    const recorder = this
    const originalExecuteCommand = handle.executeCommand.bind(handle)
    const originalWriteFile = handle.writeFile.bind(handle)
    const originalReadFile = handle.readFile.bind(handle)
    const originalListDirectory = handle.listDirectory.bind(handle)

    return {
      ...handle,
      
      async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
        const startTime = Date.now()
        const event = recorder.record({
          type: ExecutionEventType.COMMAND,
          command,
          cwd,
          metadata: { timeout },
        } as any)

        const result = await originalExecuteCommand(command, cwd, timeout)
        recorder.completeEvent(event.id, result, startTime)
        
        return result
      },

      async writeFile(filePath: string, content: string): Promise<ToolResult> {
        const startTime = Date.now()
        const event = recorder.record({
          type: ExecutionEventType.WRITE_FILE,
          path: filePath,
          content,
        } as any)

        const result = await originalWriteFile(filePath, content)
        recorder.completeEvent(event.id, result, startTime)
        
        return result
      },

      async readFile(filePath: string): Promise<ToolResult> {
        const startTime = Date.now()
        const event = recorder.record({
          type: ExecutionEventType.READ_FILE,
          path: filePath,
        } as any)

        const result = await originalReadFile(filePath)
        recorder.completeEvent(event.id, result, startTime)
        
        return result
      },

      async listDirectory(dirPath: string): Promise<ToolResult> {
        const startTime = Date.now()
        const event = recorder.record({
          type: ExecutionEventType.LIST_DIR,
          path: dirPath,
        } as any)

        const result = await originalListDirectory(dirPath)
        recorder.completeEvent(event.id, result, startTime)
        
        return result
      },
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }
}

/**
 * Create a new execution recorder instance
 */
export function createExecutionRecorder(
  config: ExecutionRecorderConfig = {}
): ExecutionRecorder {
  return new UnifiedExecutionRecorder(config)
}

/**
 * Create execution recorder with environment-based configuration
 */
export function createRecorderFromEnv(): ExecutionRecorder {
  const enabled = process.env.EXECUTION_RECORDING_ENABLED === 'true'
  const maxEvents = parseInt(process.env.EXECUTION_RECORDING_MAX_EVENTS || '10000', 10)

  return createExecutionRecorder({
    enabled,
    maxEvents,
    recordReads: process.env.EXECUTION_RECORDING_INCLUDE_READS === 'true',
    recordOutput: process.env.EXECUTION_RECORDING_INCLUDE_OUTPUT !== 'false',
  })
}

/**
 * Get summary statistics for a recording export
 */
export function getRecordingStats(exportData: ExecutionRecordingExport): {
  totalEvents: number
  commandEvents: number
  fileWriteEvents: number
  fileReadEvents: number
  successRate: number
  averageDuration: number
  totalDuration: number
} {
  const events = exportData.events
  
  return {
    totalEvents: events.length,
    commandEvents: events.filter(e => e.type === ExecutionEventType.COMMAND).length,
    fileWriteEvents: events.filter(e => 
      e.type === ExecutionEventType.WRITE_FILE || e.type === ExecutionEventType.CREATE_FILE
    ).length,
    fileReadEvents: events.filter(e => e.type === ExecutionEventType.READ_FILE).length,
    successRate: events.length > 0 
      ? (events.filter(e => e.success).length / events.length) * 100 
      : 0,
    averageDuration: events.length > 0
      ? events.reduce((sum, e) => sum + e.duration, 0) / events.length
      : 0,
    totalDuration: events.reduce((sum, e) => sum + e.duration, 0),
  }
}

/**
 * Filter recording export by event type
 */
export function filterRecordingByType(
  exportData: ExecutionRecordingExport,
  type: ExecutionEventType
): ExecutionRecordingExport {
  return {
    ...exportData,
    events: exportData.events.filter(e => e.type === type),
  }
}

/**
 * Filter recording export by time range
 */
export function filterRecordingByTimeRange(
  exportData: ExecutionRecordingExport,
  startTime: number,
  endTime: number
): ExecutionRecordingExport {
  return {
    ...exportData,
    events: exportData.events.filter(
      e => e.timestamp >= startTime && e.timestamp <= endTime
    ),
  }
}

/**
 * Merge multiple recording exports
 */
export function mergeRecordings(
  ...recordings: ExecutionRecordingExport[]
): ExecutionRecordingExport {
  const allEvents = recordings.flatMap(r => r.events)
  
  // Sort by timestamp
  allEvents.sort((a, b) => a.timestamp - b.timestamp)

  return {
    version: '1.0',
    createdAt: Date.now(),
    events: allEvents,
    metadata: {
      mergedFrom: recordings.length,
      totalEvents: allEvents.length,
    },
  }
}
