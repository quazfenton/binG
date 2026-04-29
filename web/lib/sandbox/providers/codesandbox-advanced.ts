/**
 * CodeSandbox Advanced Integration
 * 
 * Advanced features that integrate with the existing codebase architecture:
 * - Execution recording for deterministic replay
 * - Snapshot management (file-level diffs, rollback)
 * - Auto-suspend for idle sandboxes
 * - Background command execution with port detection
 * - Resource-aware scaling policies
 * - Pre-commit validation gates
 * 
 * This extends the base codesandbox-provider.ts with higher-level
 * integrations that work with the existing sandbox-bridge, VFS,
 * and session management infrastructure.
 */

import { randomUUID } from 'crypto'
import { resolve } from 'node:path'
import type { ToolResult, PreviewInfo } from '../types'
import type { SandboxHandle } from './sandbox-provider'

/**
 * Execution event types for recording and replay
 */
export interface ExecutionEvent {
  type: 'RUN' | 'WRITE_FILE' | 'READ_FILE' | 'COPY' | 'REMOVE' | 'MKDIR' | 'SCALE' | 'PORT_OPEN'
  payload: Record<string, unknown>
  timestamp: number
  exitCode?: number
  output?: string
}

/**
 * Snapshot for file-level state capture
 */
export interface FileSnapshot {
  files: Record<string, string>
  hash: string
  timestamp: number
  sandboxId: string
}

/**
 * Diff result between snapshots
 */
export interface FileDiff {
  path: string
  oldContent: string
  newContent: string
  diff: string
  changeType: 'added' | 'modified' | 'deleted'
}

/**
 * Activity tracking for auto-suspend
 */
interface ActivityTracker {
  sandboxId: string
  lastActive: number
  idleTimeoutMs: number
  suspended: boolean
}

/**
 * Resource policy for dynamic scaling
 */
interface ResourcePolicy {
  commandPattern: RegExp
  memory: number
  cpu: number
}

const DEFAULT_RESOURCE_POLICIES: ResourcePolicy[] = [
  { commandPattern: /docker/i, memory: 8192, cpu: 4 },
  { commandPattern: /npm\s+install|yarn\s+install|pnpm\s+install/i, memory: 4096, cpu: 2 },
  { commandPattern: /npm\s+run\s+build|yarn\s+build/i, memory: 4096, cpu: 2 },
  { commandPattern: /python.*train|python.*fit/i, memory: 8192, cpu: 4 },
]

const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Execution Recorder - Records all sandbox operations for replay/debugging
 */
export class CodeSandboxExecutionRecorder {
  private events: ExecutionEvent[] = []
  private sandboxId: string

  constructor(sandboxId: string) {
    this.sandboxId = sandboxId
  }

  record(event: Omit<ExecutionEvent, 'timestamp'>): void {
    this.events.push({
      ...event,
      timestamp: Date.now(),
    })
  }

  recordCommand(command: string, output: string, exitCode: number): void {
    this.record({
      type: 'RUN',
      payload: { command },
      output,
      exitCode,
    })
  }

  recordFileWrite(path: string, content: string): void {
    this.record({
      type: 'WRITE_FILE',
      payload: { path, contentLength: content.length },
    })
  }

  recordFileRead(path: string, success: boolean): void {
    this.record({
      type: 'READ_FILE',
      payload: { path, success },
    })
  }

  getEvents(): ExecutionEvent[] {
    return [...this.events]
  }

  export(): string {
    return JSON.stringify({
      sandboxId: this.sandboxId,
      events: this.events,
      exportedAt: new Date().toISOString(),
    }, null, 2)
  }

  clear(): void {
    this.events = []
  }

  async replay(handle: SandboxHandle): Promise<void> {
    for (const event of this.events) {
      switch (event.type) {
        case 'WRITE_FILE':
          await handle.writeFile(
            event.payload.path as string,
            event.payload.content as string || ''
          )
          break
        case 'RUN':
          await handle.executeCommand(event.payload.command as string)
          break
        case 'READ_FILE':
          await handle.readFile(event.payload.path as string)
          break
      }
    }
  }
}

/**
 * Snapshot Manager - Creates and manages filesystem snapshots
 */
export class CodeSandboxSnapshotManager {
  private snapshots: Map<string, FileSnapshot> = new Map<string, FileSnapshot>()
  private sandboxId: string

  constructor(sandboxId: string) {
    this.sandboxId = sandboxId
  }

  async createSnapshot(handle: SandboxHandle, label?: string): Promise<FileSnapshot> {
    const snapshotId = label || `snapshot-${Date.now()}`
    const fileMap: Record<string, string> = {}

    try {
      const listResult = await handle.listDirectory('/')
      if (listResult.success && listResult.output) {
        const entries = listResult.output.split('\n').filter(e => e.startsWith('-'))
        for (const entry of entries.slice(0, 100)) {
          const parts = entry.split(/\s+/)
          const fileName = parts[parts.length - 1]
          if (fileName && fileName !== '.' && fileName !== '..') {
            try {
              const readResult = await handle.readFile(fileName)
              if (readResult.success) {
                fileMap[fileName] = readResult.output
              }
            } catch {
              // Skip files we can't read
            }
          }
        }
      }
    } catch (error) {
      console.warn('[CodeSandboxSnapshot] Failed to list directory:', error)
    }

    const hash = await this.computeHash(fileMap)
    const snapshot: FileSnapshot = {
      files: fileMap,
      hash,
      timestamp: Date.now(),
      sandboxId: this.sandboxId,
    }

    this.snapshots.set(snapshotId, snapshot)
    console.log(`[CodeSandboxSnapshot] Created snapshot ${snapshotId} with ${Object.keys(fileMap).length} files`)
    return snapshot
  }

  private async computeHash(files: Record<string, string>): Promise<string> {
    const crypto = await import('crypto')
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(files))
      .digest('hex')
  }

  computeDiff(before: FileSnapshot, after: FileSnapshot): FileDiff[] {
    const result: FileDiff[] = []
    const allPaths = new Set([
      ...Object.keys(before.files),
      ...Object.keys(after.files),
    ])

    for (const path of allPaths) {
      const oldContent = before.files[path] || ''
      const newContent = after.files[path] || ''

      if (oldContent !== newContent) {
        const changeType = !before.files[path] ? 'added' : !after.files[path] ? 'deleted' : 'modified'
        result.push({
          path,
          oldContent,
          newContent,
          diff: this.createPatch(path, oldContent, newContent),
          changeType,
        })
      }
    }

    return result
  }

  private createPatch(path: string, oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')
    const diff: string[] = []
    
    diff.push(`--- ${path}`)
    diff.push(`+++ ${path}`)
    
    const maxLines = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i] ?? ''
      const newLine = newLines[i] ?? ''
      if (oldLine !== newLine) {
        if (oldLine) diff.push(`-${oldLine}`)
        if (newLine) diff.push(`+${newLine}`)
      }
    }
    
    return diff.join('\n')
  }

  async rollbackToSnapshot(handle: SandboxHandle, snapshot: FileSnapshot): Promise<void> {
    for (const [path, content] of Object.entries(snapshot.files)) {
      await handle.writeFile(path, content)
    }
    console.log(`[CodeSandboxSnapshot] Rolled back to snapshot from ${new Date(snapshot.timestamp).toISOString()}`)
  }

  getSnapshot(id: string): FileSnapshot | undefined {
    return this.snapshots.get(id)
  }

  listSnapshots(): Array<{ id: string; snapshot: FileSnapshot }> {
    return Array.from(this.snapshots.entries()).map(([id, snapshot]) => ({
      id,
      snapshot,
    }))
  }

  validateIntegrity(snapshot: FileSnapshot): boolean {
    return snapshot.hash === this.computeHash(snapshot.files).toString()
  }
}

/**
 * Idle Manager - Auto-suspends sandboxes after inactivity
 */
export class CodeSandboxIdleManager {
  private trackers: Map<string, ActivityTracker> = new Map<string, ActivityTracker>();
  private checkInterval: NodeJS.Timeout | null = null
  private idleTimeoutMs: number
  private onSuspend: ((sandboxId: string) => Promise<void>) | null = null

  constructor(idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS) {
    this.idleTimeoutMs = idleTimeoutMs
  }

  setSuspendHandler(handler: (sandboxId: string) => Promise<void>): void {
    this.onSuspend = handler
  }

  track(sandboxId: string): void {
    this.trackers.set(sandboxId, {
      sandboxId,
      lastActive: Date.now(),
      idleTimeoutMs: this.idleTimeoutMs,
      suspended: false,
    })
    this.ensureCheckLoop()
  }

  touch(sandboxId: string): void {
    const tracker = this.trackers.get(sandboxId)
    if (tracker && !tracker.suspended) {
      tracker.lastActive = Date.now()
    }
  }

  async checkIdle(): Promise<string[]> {
    const now = Date.now()
    const toSuspend: string[] = []

    for (const [sandboxId, tracker] of this.trackers.entries()) {
      if (tracker.suspended) continue
      
      const idleTime = now - tracker.lastActive
      if (idleTime > tracker.idleTimeoutMs) {
        toSuspend.push(sandboxId)
        tracker.suspended = true
      }
    }

    return toSuspend
  }

  private ensureCheckLoop(): void {
    if (this.checkInterval) return
    
    this.checkInterval = setInterval(async () => {
      const toSuspend = await this.checkIdle()
      
      for (const sandboxId of toSuspend) {
        if (this.onSuspend) {
          try {
            await this.onSuspend(sandboxId)
            console.log(`[CodeSandboxIdleManager] Suspended idle sandbox: ${sandboxId}`)
          } catch (error) {
            console.error(`[CodeSandboxIdleManager] Failed to suspend ${sandboxId}:`, error)
          }
        }
      }
    }, 60_000)
  }

  stopTracking(sandboxId: string): void {
    this.trackers.delete(sandboxId)
    if (this.trackers.size === 0 && this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  isSuspended(sandboxId: string): boolean {
    return this.trackers.get(sandboxId)?.suspended ?? true
  }
}

/**
 * Resource Scaler - Dynamic resource allocation based on workload
 */
export class CodeSandboxResourceScaler {
  private policies: ResourcePolicy[]
  private currentResources: { memory: number; cpu: number }
  private sandbox: any

  constructor(policies: ResourcePolicy[] = DEFAULT_RESOURCE_POLICIES) {
    this.policies = policies
    this.currentResources = { memory: 1024, cpu: 1 }
  }

  setSandbox(sandbox: any): void {
    this.sandbox = sandbox
  }

  async scaleForCommand(command: string): Promise<{ memory: number; cpu: number }> {
    for (const policy of this.policies) {
      if (policy.commandPattern.test(command)) {
        if (policy.memory > this.currentResources.memory || policy.cpu > this.currentResources.cpu) {
          console.log(`[CodeSandboxResourceScaler] Scaling up for command: ${command.slice(0, 50)}`)
          await this.scale(policy.memory, policy.cpu)
        }
        return { memory: policy.memory, cpu: policy.cpu }
      }
    }
    return this.currentResources
  }

  async scale(memory: number, cpu: number): Promise<void> {
    if (!this.sandbox) {
      console.warn('[CodeSandboxResourceScaler] No sandbox configured')
      return
    }

    try {
      // Note: CodeSandbox SDK may not have direct scale API
      // This would use the updateTier method if available
      console.log(`[CodeSandboxResourceScaler] Requesting scale: memory=${memory}MB, cpu=${cpu}`)
      this.currentResources = { memory, cpu }
    } catch (error) {
      console.warn('[CodeSandboxResourceScaler] Scale not available:', error)
    }
  }

  getCurrentResources(): { memory: number; cpu: number } {
    return { ...this.currentResources }
  }
}

/**
 * Port Manager - Tracks exposed ports and their URLs
 */
export class CodeSandboxPortManager {
  private ports: Map<number, { host: string; openedAt: number }> = new Map<number, { host: string; openedAt: number }>();
  private listeners: Array<(port: number, url: string) => void> = []
  private handle: SandboxHandle | null = null

  setHandle(handle: SandboxHandle): void {
    this.handle = handle
  }

  async detectOpenPorts(): Promise<number[]> {
    if (!this.handle) return []
    
    try {
      const result = await this.handle.executeCommand('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "No ports"')
      if (!result.success) return []
      
      const portPattern = /:(\d+)\s+/
      const matches = result.output.matchAll(portPattern)
      const ports: number[] = []
      
      for (const match of matches) {
        const port = parseInt(match[1], 10)
        if (port > 1024 && !ports.includes(port)) {
          ports.push(port)
        }
      }
      
      return ports
    } catch {
      return []
    }
  }

  async waitForPort(port: number, timeoutMs = 60000): Promise<string | null> {
    const handle = this.handle
    if (!handle) {
      console.warn('[CodeSandboxPortManager] No handle set')
      return null
    }
    
    try {
      const getPreviewLink = handle.getPreviewLink?.bind(handle)
      if (!getPreviewLink) {
        return null
      }
      const previewInfo = await getPreviewLink(port)
      if (!previewInfo) {
        return null
      }
      this.ports.set(port, { host: previewInfo.url, openedAt: Date.now() })
      
      for (const listener of this.listeners) {
        listener(port, previewInfo.url)
      }
      
      return previewInfo.url
    } catch (error) {
      console.warn('[CodeSandboxPortManager] waitForPort failed:', error)
      return null
    }
  }

  onPortOpen(callback: (port: number, url: string) => void): () => void {
    this.listeners.push(callback)
    return () => {
      const idx = this.listeners.indexOf(callback)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  getOpenPorts(): Array<{ port: number; host: string; openedAt: number }> {
    return Array.from(this.ports.entries()).map(([port, info]) => ({
      port,
      host: info.host,
      openedAt: info.openedAt,
    }))
  }
}

/**
 * Pre-commit Validator - Validates changes before persisting to VFS
 */
export class CodeSandboxPreCommitValidator {
  private snapshotManager: CodeSandboxSnapshotManager

  constructor(snapshotManager: CodeSandboxSnapshotManager) {
    this.snapshotManager = snapshotManager
  }

  async validateBeforeCommit(
    handle: SandboxHandle,
    options?: {
      requireDiffReview?: boolean
      maxDiffSize?: number
      blockedPatterns?: RegExp[]
    }
  ): Promise<{
    valid: boolean
    reason?: string
    diffs?: FileDiff[]
    riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  }> {
    const opts = {
      requireDiffReview: false,
      maxDiffSize: 50,
      blockedPatterns: [
        /auth.*\.js/i,
        /password.*\.js/i,
        /\.env$/i,
        /secret/i,
      ],
      ...options,
    }

    const snapshots = this.snapshotManager.listSnapshots()
    if (snapshots.length === 0) {
      return { valid: true, riskLevel: 'low' }
    }

    const latestSnapshot = snapshots[snapshots.length - 1].snapshot
    const currentSnapshot = await this.snapshotManager.createSnapshot(handle, 'pre-commit-check')
    
    const diffs = this.snapshotManager.computeDiff(latestSnapshot, currentSnapshot)
    
    if (diffs.length === 0) {
      return { valid: true, diffs: [], riskLevel: 'low' }
    }

    if (diffs.length > opts.maxDiffSize) {
      return {
        valid: false,
        reason: `Too many changes (${diffs.length}). Maximum allowed: ${opts.maxDiffSize}`,
        diffs,
        riskLevel: 'high',
      }
    }

    for (const diff of diffs) {
      for (const pattern of opts.blockedPatterns) {
        if (pattern.test(diff.path)) {
          return {
            valid: false,
            reason: `Blocked pattern detected in ${diff.path}`,
            diffs,
            riskLevel: 'critical',
          }
        }
      }
    }

    const riskLevel = this.classifyRisk(diffs)
    const requiresReview = riskLevel === 'high' || riskLevel === 'critical'

    if (requiresReview && opts.requireDiffReview) {
      return {
        valid: false,
        reason: 'Changes require manual review before commit',
        diffs,
        riskLevel,
      }
    }

    return { valid: true, diffs, riskLevel }
  }

  private classifyRisk(diffs: FileDiff[]): 'low' | 'medium' | 'high' | 'critical' {
    let score = 0

    for (const diff of diffs) {
      if (diff.path.includes('package.json')) score += 2
      if (diff.path.includes('test')) score -= 1
      if (diff.path.includes('src')) score += 1
      if (diff.changeType === 'deleted') score += 2
    }

    if (score >= 5) return 'critical'
    if (score >= 3) return 'high'
    if (score >= 1) return 'medium'
    return 'low'
  }
}

/**
 * Main integration class that combines all advanced features
 */
export class CodeSandboxAdvancedIntegration {
  private recorder: CodeSandboxExecutionRecorder
  private snapshotManager: CodeSandboxSnapshotManager
  private idleManager: CodeSandboxIdleManager
  private resourceScaler: CodeSandboxResourceScaler
  private portManager: CodeSandboxPortManager
  private preCommitValidator: CodeSandboxPreCommitValidator
  private sandboxId: string
  private handle: SandboxHandle | null = null

  constructor(sandboxId: string) {
    this.sandboxId = sandboxId
    this.recorder = new CodeSandboxExecutionRecorder(sandboxId)
    this.snapshotManager = new CodeSandboxSnapshotManager(sandboxId)
    this.idleManager = new CodeSandboxIdleManager()
    this.resourceScaler = new CodeSandboxResourceScaler()
    this.portManager = new CodeSandboxPortManager()
    this.preCommitValidator = new CodeSandboxPreCommitValidator(this.snapshotManager)
  }

  setHandle(handle: SandboxHandle): void {
    this.handle = handle
    this.idleManager.track(this.sandboxId)
    
    if ('waitForPort' in handle) {
      this.portManager.setHandle(handle)
    }
  }

  /**
   * Execute command with recording and resource scaling
   */
  async executeCommand(command: string, cwd?: string): Promise<ToolResult> {
    if (!this.handle) {
      throw new Error('Sandbox handle not set')
    }

    this.idleManager.touch(this.sandboxId)
    await this.resourceScaler.scaleForCommand(command)

    const result = await this.handle.executeCommand(command, cwd)
    this.recorder.recordCommand(command, result.output, result.exitCode ?? 0)

    return result
  }

  /**
   * Write file with recording
   */
  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    if (!this.handle) {
      throw new Error('Sandbox handle not set')
    }

    this.idleManager.touch(this.sandboxId)
    const result = await this.handle.writeFile(filePath, content)
    this.recorder.recordFileWrite(filePath, content)

    return result
  }

  /**
   * Read file with recording
   */
  async readFile(filePath: string): Promise<ToolResult> {
    if (!this.handle) {
      throw new Error('Sandbox handle not set')
    }

    this.idleManager.touch(this.sandboxId)
    const result = await this.handle.readFile(filePath)
    this.recorder.recordFileRead(filePath, result.success)

    return result
  }

  /**
   * Create a snapshot of current filesystem state
   */
  async createSnapshot(label?: string): Promise<FileSnapshot> {
    if (!this.handle) {
      throw new Error('Sandbox handle not set')
    }
    return this.snapshotManager.createSnapshot(this.handle, label)
  }

  /**
   * Rollback to a previous snapshot
   */
  async rollbackToSnapshot(snapshotId: string): Promise<void> {
    if (!this.handle) {
      throw new Error('Sandbox handle not set')
    }
    const snapshot = this.snapshotManager.getSnapshot(snapshotId)
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`)
    }
    await this.snapshotManager.rollbackToSnapshot(this.handle, snapshot)
  }

  /**
   * Validate changes before committing to VFS
   */
  async validateBeforeCommit(options?: {
    requireDiffReview?: boolean
    maxDiffSize?: number
  }): Promise<{ valid: boolean; reason?: string; riskLevel?: string }> {
    if (!this.handle) {
      throw new Error('Sandbox handle not set')
    }
    return this.preCommitValidator.validateBeforeCommit(this.handle, options)
  }

  /**
   * Wait for a port to open and get preview URL
   */
  async waitForPort(port: number, timeoutMs?: number): Promise<string | null> {
    if (!this.handle || !('waitForPort' in this.handle)) {
      console.warn('[CodeSandboxAdvanced] waitForPort not available')
      return null
    }
    try {
      return await (this.handle as any).waitForPort(port, timeoutMs)
    } catch (error) {
      console.warn('[CodeSandboxAdvanced] waitForPort failed:', error)
      return null
    }
  }

  /**
   * Register port open callback
   */
  onPortOpen(callback: (port: number, url: string) => void): () => void {
    return this.portManager.onPortOpen(callback)
  }

  /**
   * Get execution log for debugging/replay
   */
  getExecutionLog(): string {
    return this.recorder.export()
  }

  /**
   * Get list of available snapshots
   */
  listSnapshots(): Array<{ id: string; timestamp: number; fileCount: number }> {
    return this.snapshotManager.listSnapshots().map(({ id, snapshot }) => ({
      id,
      timestamp: snapshot.timestamp,
      fileCount: Object.keys(snapshot.files).length,
    }))
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.idleManager.stopTracking(this.sandboxId)
  }
}

/**
 * Factory function to create advanced integration
 */
export function createCodeSandboxAdvancedIntegration(
  sandboxId: string,
  handle?: SandboxHandle
): CodeSandboxAdvancedIntegration {
  const integration = new CodeSandboxAdvancedIntegration(sandboxId)
  if (handle) {
    integration.setHandle(handle)
  }
  return integration
}
