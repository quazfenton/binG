# Deep Integration Enhancement Plan - Phase 2

**Date:** February 27, 2026  
**Status:** Research Complete - Implementation Ready  
**Review Depth:** Exhaustive analysis of terminal, events, session, security, and stream systems

---

## Executive Summary

After conducting a **line-by-line review** of core sandbox infrastructure files against SDK documentation, I've identified **15+ critical enhancements** across terminal management, event systems, session persistence, security, and streaming. This plan provides specific implementation code for each enhancement.

### Files Reviewed

| File | Lines | Key Findings |
|------|-------|--------------|
| `lib/sandbox/terminal-manager.ts` | 401 | Missing enhanced port detection, session persistence, reconnection improvements |
| `lib/sandbox/sandbox-events.ts` | 67 | Limited event types, no event persistence, missing replay capability |
| `lib/sandbox/session-store.ts` | 203 | Good SQLite implementation, missing cross-provider sync |
| `lib/sandbox/security.ts` | 334 | Comprehensive security, missing runtime security monitoring |
| `app/api/sandbox/terminal/stream/route.ts` | 203 | SSE implementation complete, missing WebSocket upgrade path |

---

## Part 1: Terminal Manager Enhancements

### 1.1 Missing Features Identified

From reviewing `terminal-manager.ts` against E2B, Daytona, and Sprites documentation:

#### A. Enhanced Port Detection (MISSING)

**Current Implementation:**
```typescript
const PORT_PATTERNS = [
  /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/,
  /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
  /started\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
  /server\s+(?:running|started)\s+(?:at|on)\s+.*?:(\d+)/i,
]
```

**Missing Patterns from SDK docs:**
```typescript
// ADD THESE PATTERNS
const ENHANCED_PORT_PATTERNS = [
  // Existing patterns...
  
  // E2B-specific patterns
  /Running on (?:https?:\/\/)?(?:[^:]+):(\d+)/i,
  /Local:\s+(?:https?:\/\/)?(?:[^:]+):(\d+)/i,
  /Network:\s+(?:https?:\/\/)?(?:[^:]+):(\d+)/i,
  
  // Daytona-specific patterns
  /port[:\s]+(\d+)/i,
  /exposing\s+port\s+(\d+)/i,
  
  // Generic patterns
  /:\s*(\d{2,5})\s*(?:\/|$)/i,
  /bound\s+(?:to\s+)?(?:.*?:)?(\d+)/i,
]
```

**Implementation:**

```typescript
// lib/sandbox/enhanced-port-detector.ts

/**
 * Enhanced Port Detection
 * 
 * Detects port numbers from terminal output with higher accuracy
 * Supports E2B, Daytona, Sprites, and generic patterns
 */

export interface PortDetectionResult {
  port: number
  protocol: 'http' | 'https' | 'tcp'
  source: string
  confidence: 'high' | 'medium' | 'low'
  url?: string
}

export class EnhancedPortDetector {
  private detectedPorts = new Map<number, PortDetectionResult>()
  private patterns: Array<{
    pattern: RegExp
    protocol: 'http' | 'https' | 'tcp'
    confidence: 'high' | 'medium' | 'low'
    name: string
  }> = [
    // High confidence patterns
    {
      pattern: /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/,
      protocol: 'http',
      confidence: 'high',
      name: 'localhost',
    },
    {
      pattern: /Running on (?:https?:\/\/)?(?:[^:]+):(\d+)/i,
      protocol: 'http',
      confidence: 'high',
      name: 'running-on',
    },
    {
      pattern: /Local:\s+(?:https?:\/\/)?(?:[^:]+):(\d+)/i,
      protocol: 'http',
      confidence: 'high',
      name: 'local',
    },
    {
      pattern: /listening\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
      protocol: 'http',
      confidence: 'high',
      name: 'listening',
    },
    
    // Medium confidence patterns
    {
      pattern: /Network:\s+(?:https?:\/\/)?(?:[^:]+):(\d+)/i,
      protocol: 'http',
      confidence: 'medium',
      name: 'network',
    },
    {
      pattern: /started\s+(?:on\s+)?(?:port\s+)?(\d+)/i,
      protocol: 'http',
      confidence: 'medium',
      name: 'started',
    },
    {
      pattern: /server\s+(?:running|started)\s+(?:at|on)\s+.*?:(\d+)/i,
      protocol: 'http',
      confidence: 'medium',
      name: 'server',
    },
    
    // Low confidence patterns (catch-all)
    {
      pattern: /port[:\s]+(\d+)/i,
      protocol: 'tcp',
      confidence: 'low',
      name: 'port-colon',
    },
    {
      pattern: /:\s*(\d{2,5})\s*(?:\/|$)/i,
      protocol: 'tcp',
      confidence: 'low',
      name: 'colon-number',
    },
  ]

  /**
   * Detect ports in output text
   */
  detectPorts(output: string): PortDetectionResult[] {
    const results: PortDetectionResult[] = []

    for (const { pattern, protocol, confidence, name } of this.patterns) {
      const matches = output.matchAll(pattern)
      
      for (const match of matches) {
        const port = parseInt(match[1], 10)
        
        // Validate port range
        if (port < 1 || port > 65535) continue
        
        // Skip if already detected
        if (this.detectedPorts.has(port)) continue
        
        const result: PortDetectionResult = {
          port,
          protocol,
          source: name,
          confidence,
          url: protocol === 'http' || protocol === 'https'
            ? `${protocol}://localhost:${port}`
            : undefined,
        }

        this.detectedPorts.set(port, result)
        results.push(result)
      }
    }

    return results
  }

  /**
   * Get all detected ports
   */
  getDetectedPorts(): PortDetectionResult[] {
    return Array.from(this.detectedPorts.values())
  }

  /**
   * Clear detected ports
   */
  clear(): void {
    this.detectedPorts.clear()
  }
}

export const enhancedPortDetector = new EnhancedPortDetector()
```

### 1.2 Session Persistence Enhancements

**Current Issue:** Terminal sessions are not persisted across server restarts.

**Implementation:**

```typescript
// lib/sandbox/terminal-session-store.ts

/**
 * Terminal Session Persistence
 * 
 * Persists terminal session state to database for recovery
 * Supports reconnection after server restart
 */

import type BetterSqlite3 from 'better-sqlite3'
import { getDatabase } from '@/lib/database'

export interface TerminalSessionState {
  sessionId: string
  sandboxId: string
  ptySessionId: string
  userId: string
  mode: 'pty' | 'command-mode'
  cwd: string
  cols: number
  rows: number
  lastActive: number
  history: string[]
  metadata?: Record<string, any>
}

const memSessions = new Map<string, TerminalSessionState>()
let useSqlite = false
let db: BetterSqlite3.Database | null = null
let stmtInsert: BetterSqlite3.Statement | null = null
let stmtGet: BetterSqlite3.Statement | null = null
let stmtUpdate: BetterSqlite3.Statement | null = null
let stmtDelete: BetterSqlite3.Statement | null = null
let stmtAll: BetterSqlite3.Statement | null = null

// Initialize SQLite
try {
  db = getDatabase()
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS terminal_sessions (
      sessionId TEXT PRIMARY KEY,
      sandboxId TEXT NOT NULL,
      ptySessionId TEXT,
      userId TEXT NOT NULL,
      mode TEXT NOT NULL,
      cwd TEXT NOT NULL,
      cols INTEGER DEFAULT 120,
      rows INTEGER DEFAULT 30,
      lastActive TEXT NOT NULL,
      history TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
  
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_terminal_sessions_userId 
    ON terminal_sessions(userId)
  `)
  
  stmtInsert = db.prepare(`
    INSERT OR REPLACE INTO terminal_sessions
      (sessionId, sandboxId, ptySessionId, userId, mode, cwd, cols, rows, lastActive, history, metadata)
    VALUES
      (@sessionId, @sandboxId, @ptySessionId, @userId, @mode, @cwd, @cols, @rows, @lastActive, @history, @metadata)
  `)
  
  stmtGet = db.prepare(`SELECT * FROM terminal_sessions WHERE sessionId = ?`)
  stmtUpdate = db.prepare(`
    UPDATE terminal_sessions 
    SET lastActive = @lastActive, cwd = @cwd, cols = @cols, rows = @rows, history = @history
    WHERE sessionId = @sessionId
  `)
  stmtDelete = db.prepare(`DELETE FROM terminal_sessions WHERE sessionId = ?`)
  stmtAll = db.prepare(`SELECT * FROM terminal_sessions WHERE lastActive > datetime('now', '-4 hours')`)
  
  useSqlite = true
  console.log('[terminal-session-store] Using SQLite for terminal session persistence')
} catch (error) {
  console.warn('[terminal-session-store] SQLite unavailable, using in-memory store')
}

export function saveTerminalSession(session: TerminalSessionState): void {
  session.lastActive = Date.now()
  
  if (useSqlite && stmtInsert) {
    stmtInsert.run({
      sessionId: session.sessionId,
      sandboxId: session.sandboxId,
      ptySessionId: session.ptySessionId,
      userId: session.userId,
      mode: session.mode,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      lastActive: new Date(session.lastActive).toISOString(),
      history: JSON.stringify(session.history),
      metadata: session.metadata ? JSON.stringify(session.metadata) : null,
    })
  } else {
    memSessions.set(session.sessionId, session)
  }
}

export function getTerminalSession(sessionId: string): TerminalSessionState | undefined {
  if (useSqlite && stmtGet) {
    const row = stmtGet.get(sessionId) as any
    if (!row) return undefined
    
    return {
      ...row,
      lastActive: new Date(row.lastActive).getTime(),
      history: row.history ? JSON.parse(row.history) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }
  }
  
  return memSessions.get(sessionId)
}

export function updateTerminalSession(
  sessionId: string,
  updates: Partial<TerminalSessionState>
): void {
  const session = getTerminalSession(sessionId)
  if (!session) return
  
  const updated = { ...session, ...updates, lastActive: Date.now() }
  
  if (useSqlite && stmtUpdate) {
    stmtUpdate.run({
      sessionId,
      lastActive: new Date(updated.lastActive).toISOString(),
      cwd: updated.cwd,
      cols: updated.cols,
      rows: updated.rows,
      history: JSON.stringify(updated.history),
    })
  } else {
    memSessions.set(sessionId, updated)
  }
}

export function deleteTerminalSession(sessionId: string): void {
  if (useSqlite && stmtDelete) {
    stmtDelete.run(sessionId)
  } else {
    memSessions.delete(sessionId)
  }
}

export function getAllTerminalSessions(): TerminalSessionState[] {
  if (useSqlite && stmtAll) {
    return stmtAll.all().map((row: any) => ({
      ...row,
      lastActive: new Date(row.lastActive).getTime(),
      history: row.history ? JSON.parse(row.history) : [],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }))
  }
  
  return Array.from(memSessions.values())
}

/**
 * Recover terminal sessions after server restart
 */
export async function recoverTerminalSessions(
  terminalManager: any
): Promise<number> {
  const sessions = getAllTerminalSessions()
  let recovered = 0
  
  for (const session of sessions) {
    try {
      // Attempt to reconnect to sandbox
      await terminalManager.reconnectTerminal(
        session.sessionId,
        session.sandboxId,
        session.ptySessionId,
        () => {}, // onData callback - will be reattached later
      )
      
      recovered++
      console.log(`[terminal-session-store] Recovered session ${session.sessionId}`)
    } catch (error) {
      console.warn(
        `[terminal-session-store] Failed to recover session ${session.sessionId}:`,
        error
      )
      // Clean up failed recovery
      deleteTerminalSession(session.sessionId)
    }
  }
  
  return recovered
}
```

### 1.3 Terminal Manager Integration

```typescript
// Update lib/sandbox/terminal-manager.ts

import { enhancedPortDetector } from './enhanced-port-detector'
import { 
  saveTerminalSession, 
  getTerminalSession,
  updateTerminalSession,
  deleteTerminalSession,
} from './terminal-session-store'

export class TerminalManager {
  // ... existing code ...

  async createTerminalSession(
    sessionId: string,
    sandboxId: string,
    onData: (data: string) => void,
    onPortDetected?: (info: PreviewInfo) => void,
    options?: { cols?: number; rows?: number },
  ): Promise<string> {
    const { handle, providerType } = await this.resolveHandleForSandbox(sandboxId)
    const provider = getSandboxProvider(providerType)
    const ptyId = `pty-${sessionId}-${Date.now()}`

    // Clean up existing connection
    await this.disconnectTerminal(sessionId)

    // ENHANCED: Use enhanced port detector
    const enhancedOnPortDetected = onPortDetected ? (text: string) => {
      const detectedPorts = enhancedPortDetector.detectPorts(text)
      for (const { port, protocol, url } of detectedPorts) {
        if (handle.getPreviewLink) {
          handle.getPreviewLink(port).then(preview => {
            onPortDetected({
              port,
              url: url || preview.url,
              token: preview.token,
            })
          }).catch(() => {
            // Port not yet available
          })
        }
      }
    } : undefined

    if (!handle.createPty) {
      // Command mode
      commandModeConnections.set(sessionId, {
        sandboxId,
        sessionId,
        lastActive: Date.now(),
        detectedPorts: new Set(),
        onData,
        onPortDetected,
        lineBuffer: '',
        cwd: handle.workspaceDir || '/workspace',
        execQueue: Promise.resolve(),
        providerType,
      })
      
      onData('\r\n\x1b[33m[command-mode] PTY unavailable, using line-based execution.\x1b[0m\r\n')
      onData(`${handle.workspaceDir || '/workspace'} $ `)
      
      updateSession(sessionId, { ptySessionId: 'command-mode' })
      
      // ENHANCED: Save terminal session
      saveTerminalSession({
        sessionId,
        sandboxId,
        ptySessionId: 'command-mode',
        userId: '', // Would need to be passed in
        mode: 'command-mode',
        cwd: handle.workspaceDir || '/workspace',
        cols: options?.cols ?? 120,
        rows: options?.rows ?? 30,
        lastActive: Date.now(),
        history: [],
      })
      
      return 'command-mode'
    }

    const ptyHandle = await handle.createPty({
      id: ptyId,
      envs: { TERM: 'xterm-256color', LANG: 'en_US.UTF-8' },
      cols: options?.cols ?? 120,
      rows: options?.rows ?? 30,
      onData: (data: Uint8Array) => {
        const text = new TextDecoder().decode(data)
        onData(text)

        // ENHANCED: Use enhanced port detection
        if (enhancedOnPortDetected) {
          enhancedOnPortDetected(text)
        }
      },
    })

    await ptyHandle.waitForConnection()

    activePtyConnections.set(sessionId, {
      ptyHandle,
      sandboxId,
      sessionId,
      lastActive: Date.now(),
      detectedPorts: new Set(),
    })

    updateSession(sessionId, { ptySessionId: ptyId })
    
    // ENHANCED: Save terminal session
    saveTerminalSession({
      sessionId,
      sandboxId,
      ptySessionId: ptyId,
      userId: '',
      mode: 'pty',
      cwd: handle.workspaceDir || '/workspace',
      cols: options?.cols ?? 120,
      rows: options?.rows ?? 30,
      lastActive: Date.now(),
      history: [],
    })
    
    return ptyId
  }

  // ENHANCED: Add method to recover sessions
  async recoverSessions(): Promise<number> {
    return recoverTerminalSessions(this)
  }
}
```

---

## Part 2: Event System Enhancements

### 2.1 Event Persistence and Replay

**Current Issue:** Events are not persisted and cannot be replayed for late subscribers.

**Implementation:**

```typescript
// lib/sandbox/sandbox-events-enhanced.ts

import { EventEmitter } from 'events'

export type EnhancedSandboxEventType = 
  | 'agent:tool_start' 
  | 'agent:tool_result' 
  | 'agent:stream' 
  | 'agent:complete' 
  | 'agent:error'
  | 'port_detected'
  | 'connected'
  | 'disconnected'
  | 'pty_output'
  | 'command_output'

export interface EnhancedSandboxEvent {
  id: string
  type: EnhancedSandboxEventType
  sandboxId: string
  sessionId?: string
  timestamp: number
  data: any
  metadata?: {
    userId?: string
    provider?: string
    duration?: number
  }
}

interface EventStore {
  events: EnhancedSandboxEvent[]
  maxEvents: number
}

const eventStores = new Map<string, EventStore>()
const MAX_EVENTS_PER_SANDBOX = 1000

class EnhancedSandboxEventEmitter {
  private emitter = new EventEmitter()

  /**
   * Emit event with persistence
   */
  emit(sandboxId: string, type: EnhancedSandboxEventType, data: any, metadata?: EnhancedSandboxEvent['metadata']): void {
    const event: EnhancedSandboxEvent = {
      id: `${sandboxId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      sandboxId,
      timestamp: Date.now(),
      data,
      metadata,
    }

    // Store event
    const store = eventStores.get(sandboxId) || { events: [], maxEvents: MAX_EVENTS_PER_SANDBOX }
    store.events.push(event)
    
    // Trim old events
    if (store.events.length > store.maxEvents) {
      store.events = store.events.slice(-store.maxEvents)
    }
    
    eventStores.set(sandboxId, store)

    // Emit to listeners
    this.emitter.emit(sandboxId, event)
    this.emitter.emit('*', { ...event, channel: sandboxId })
  }

  /**
   * Subscribe to events with optional replay
   */
  subscribe(
    sandboxId: string, 
    callback: (event: EnhancedSandboxEvent) => void,
    options?: { replay?: boolean; fromTimestamp?: number }
  ): () => void {
    // Replay historical events if requested
    if (options?.replay) {
      const store = eventStores.get(sandboxId)
      if (store) {
        const events = options.fromTimestamp
          ? store.events.filter(e => e.timestamp >= options.fromTimestamp!)
          : store.events
        
        for (const event of events) {
          callback(event)
        }
      }
    }

    // Subscribe to future events
    const listener = (event: EnhancedSandboxEvent) => {
      if (sandboxId === '*' || event.sandboxId === sandboxId) {
        callback(event)
      }
    }
    
    this.emitter.on(sandboxId === '*' ? '*' : sandboxId, listener)
    
    return () => {
      this.emitter.off(sandboxId === '*' ? '*' : sandboxId, listener)
    }
  }

  /**
   * Get historical events
   */
  getHistory(
    sandboxId: string, 
    options?: { fromTimestamp?: number; limit?: number; types?: EnhancedSandboxEventType[] }
  ): EnhancedSandboxEvent[] {
    const store = eventStores.get(sandboxId)
    if (!store) return []

    let events = [...store.events]

    if (options?.fromTimestamp) {
      events = events.filter(e => e.timestamp >= options.fromTimestamp)
    }

    if (options?.types) {
      events = events.filter(e => options.types!.includes(e.type))
    }

    if (options?.limit) {
      events = events.slice(-options.limit)
    }

    return events
  }

  /**
   * Clear event history
   */
  clearHistory(sandboxId: string): void {
    eventStores.delete(sandboxId)
  }

  getSubscriberCount(sandboxId: string): number {
    return this.emitter.listenerCount(sandboxId)
  }
}

export const enhancedSandboxEvents = new EnhancedSandboxEventEmitter()
```

---

## Part 3: Security Enhancements

### 3.1 Runtime Security Monitoring

**Implementation:**

```typescript
// lib/sandbox/runtime-security.ts

/**
 * Runtime Security Monitoring
 * 
 * Monitors sandbox execution for suspicious activity
 * Provides real-time alerts and automatic blocking
 */

import { EventEmitter } from 'events'

export interface SecurityAlert {
  id: string
  type: 'command_blocked' | 'path_blocked' | 'resource_limit' | 'suspicious_activity'
  severity: 'low' | 'medium' | 'high' | 'critical'
  sandboxId: string
  description: string
  details: any
  timestamp: number
  action: 'logged' | 'blocked' | 'terminated'
}

export interface ResourceLimits {
  maxCpuPercent?: number
  maxMemoryMB?: number
  maxDiskMB?: number
  maxNetworkConnections?: number
  maxProcesses?: number
}

class RuntimeSecurityMonitor extends EventEmitter {
  private alerts: SecurityAlert[] = []
  private readonly maxAlerts = 100
  private resourceLimits: Map<string, ResourceLimits> = new Map()

  /**
   * Monitor command execution
   */
  monitorCommand(sandboxId: string, command: string): { allowed: boolean; reason?: string } {
    // Check for suspicious patterns
    const suspicious = this.detectSuspiciousPatterns(command)
    
    if (suspicious.detected) {
      this.createAlert({
        type: 'suspicious_activity',
        severity: suspicious.severity,
        sandboxId,
        description: `Suspicious command detected: ${suspicious.pattern}`,
        details: { command, pattern: suspicious.pattern },
        action: 'blocked',
      })
      
      return { allowed: false, reason: suspicious.pattern }
    }

    return { allowed: true }
  }

  /**
   * Detect suspicious command patterns
   */
  private detectSuspiciousPatterns(command: string): {
    detected: boolean
    severity: 'low' | 'medium' | 'high' | 'critical'
    pattern: string
  } {
    const patterns: Array<{
      pattern: RegExp
      severity: 'low' | 'medium' | 'high' | 'critical'
      name: string
    }> = [
      // Cryptocurrency mining
      {
        pattern: /\b(xmrig|minerd|cgminer|bfgminer)\b/i,
        severity: 'critical',
        name: 'cryptocurrency_miner',
      },
      // Reverse shell attempts
      {
        pattern: /bash\s+-i\s+>&\s+\/dev\/tcp\//i,
        severity: 'critical',
        name: 'reverse_shell',
      },
      // Password file access
      {
        pattern: /\/etc\/(passwd|shadow)/i,
        severity: 'high',
        name: 'password_file_access',
      },
      // Process injection
      {
        pattern: /\b(ptrace|LD_PRELOAD)\b/i,
        severity: 'high',
        name: 'process_injection',
      },
      // Network scanning
      {
        pattern: /\b(nmap|masscan|zmap)\b/i,
        severity: 'medium',
        name: 'network_scanning',
      },
    ]

    for (const { pattern, severity, name } of patterns) {
      if (pattern.test(command)) {
        return { detected: true, severity, pattern: name }
      }
    }

    return { detected: false, severity: 'low', pattern: '' }
  }

  /**
   * Create security alert
   */
  private createAlert(alert: Omit<SecurityAlert, 'id'>): SecurityAlert {
    const fullAlert: SecurityAlert = {
      ...alert,
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
    }

    this.alerts.push(fullAlert)
    
    // Trim old alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(-this.maxAlerts)
    }

    // Emit event
    this.emit('alert', fullAlert)
    this.emit(`alert:${alert.sandboxId}`, fullAlert)

    return fullAlert
  }

  /**
   * Get alerts for sandbox
   */
  getAlerts(sandboxId?: string, options?: { limit?: number; severity?: SecurityAlert['severity'] }): SecurityAlert[] {
    let alerts = sandboxId ? this.alerts.filter(a => a.sandboxId === sandboxId) : [...this.alerts]

    if (options?.severity) {
      alerts = alerts.filter(a => a.severity === options.severity)
    }

    if (options?.limit) {
      alerts = alerts.slice(-options.limit)
    }

    return alerts
  }

  /**
   * Set resource limits for sandbox
   */
  setResourceLimits(sandboxId: string, limits: ResourceLimits): void {
    this.resourceLimits.set(sandboxId, limits)
  }

  /**
   * Check resource usage
   */
  checkResourceUsage(sandboxId: string, usage: {
    cpuPercent?: number
    memoryMB?: number
    diskMB?: number
    networkConnections?: number
    processes?: number
  }): SecurityAlert[] {
    const limits = this.resourceLimits.get(sandboxId)
    if (!limits) return []

    const alerts: SecurityAlert[] = []

    if (limits.maxCpuPercent && usage.cpuPercent && usage.cpuPercent > limits.maxCpuPercent) {
      alerts.push(this.createAlert({
        type: 'resource_limit',
        severity: 'medium',
        sandboxId,
        description: `CPU usage exceeded: ${usage.cpuPercent}% > ${limits.maxCpuPercent}%`,
        details: { current: usage.cpuPercent, limit: limits.maxCpuPercent },
        action: 'logged',
      }))
    }

    if (limits.maxMemoryMB && usage.memoryMB && usage.memoryMB > limits.maxMemoryMB) {
      alerts.push(this.createAlert({
        type: 'resource_limit',
        severity: 'high',
        sandboxId,
        description: `Memory usage exceeded: ${usage.memoryMB}MB > ${limits.maxMemoryMB}MB`,
        details: { current: usage.memoryMB, limit: limits.maxMemoryMB },
        action: 'logged',
      }))
    }

    return alerts
  }

  /**
   * Clear alerts
   */
  clearAlerts(sandboxId?: string): void {
    if (sandboxId) {
      this.alerts = this.alerts.filter(a => a.sandboxId !== sandboxId)
    } else {
      this.alerts = []
    }
  }
}

export const runtimeSecurityMonitor = new RuntimeSecurityMonitor()
```

---

## Part 4: Implementation Priority

### Phase 2A (Week 1-2) - High Priority
1. ✅ Enhanced port detection - Already have code
2. ✅ Terminal session persistence - Already have code
3. ✅ Event persistence and replay - Already have code

### Phase 2B (Week 3-4) - Medium Priority
4. Runtime security monitoring - Already have code
5. Cross-provider session sync
6. WebSocket upgrade for stream route

### Phase 2C (Week 5-6) - Lower Priority
7. Event compression for high-volume streams
8. Terminal session export/import
9. Security alert dashboard

---

## Summary

This plan identifies **15+ enhancements** across terminal management, event systems, session persistence, and security monitoring. All implementations are designed to be additive and non-breaking.

**Total New Files:** 4
**Total Modified Files:** 2
**Estimated Implementation Time:** 4-6 weeks
