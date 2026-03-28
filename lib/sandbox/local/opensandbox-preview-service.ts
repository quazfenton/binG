/**
 * OpenSandbox Preview Service
 *
 * Provides live preview capability by deploying project files into an
 * OpenSandbox container, installing dependencies, starting a dev server,
 * and returning the preview URL.
 *
 * Flow:
 *  1. Client sends files via POST /api/preview/sandbox
 *  2. This service creates (or reuses) an OpenSandbox container
 *  3. Writes files, installs deps, starts dev server
 *  4. Returns the forwarded port URL for iframe embedding
 *
 * The container image is a lightweight Node/Python dev image with common
 * runtimes pre-installed. Separate from the Nullclaw automation container.
 *
 * @see lib/sandbox/providers/opensandbox-provider.ts
 * @see app/api/preview/sandbox/route.ts
 */

import path from 'path'
import type { ToolResult, PreviewInfo } from '../types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreviewDeployRequest {
  /** Map of file paths to contents */
  files: Record<string, string>
  /** Detected framework (react, vue, vanilla, etc.) */
  framework?: string
  /** Explicit install command override */
  installCommand?: string
  /** Explicit start command override */
  startCommand?: string
  /** Port the dev server listens on (default 3000) */
  port?: number
  /** User / session owner */
  userId?: string
  /** Reuse an existing sandbox by ID */
  sandboxId?: string
}

export interface PreviewDeployResult {
  success: boolean
  /** The URL to embed in an iframe */
  previewUrl?: string
  /** Sandbox ID for subsequent updates */
  sandboxId?: string
  /** Logs from install / start */
  logs?: string[]
  error?: string
  duration?: number
}

export interface PreviewSession {
  sandboxId: string
  serverId: string
  previewUrl: string
  port: number
  framework: string
  createdAt: number
  lastActivity: number
  userId?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPEN_SANDBOX_BASE_URL = (
  process.env.OPEN_SANDBOX_BASE_URL || 'http://localhost:8080/v1'
).replace(/\/$/, '')
const OPEN_SANDBOX_EXECD_URL = (
  process.env.OPEN_SANDBOX_EXECD_BASE_URL || OPEN_SANDBOX_BASE_URL.replace(/\/v1$/, '')
).replace(/\/$/, '')
const OPEN_SANDBOX_API_KEY = process.env.OPEN_SANDBOX_API_KEY || ''
const OPEN_SANDBOX_EXECD_TOKEN = process.env.OPEN_SANDBOX_EXECD_ACCESS_TOKEN || ''
const PREVIEW_IMAGE = process.env.OPEN_SANDBOX_PREVIEW_IMAGE || 'node:20-slim'
const DEFAULT_TIMEOUT = 1800 // 30 minutes
const DEFAULT_PORT = 3000
const HEALTH_POLL_INTERVAL = 300 // ms
const HEALTH_POLL_MAX = 100 // ~30s

/** Framework → default dev commands */
const FRAMEWORK_COMMANDS: Record<string, { install: string; start: string; port: number }> = {
  react:   { install: 'npm install',  start: 'npm run dev -- --host 0.0.0.0', port: 5173 },
  vue:     { install: 'npm install',  start: 'npm run dev -- --host 0.0.0.0', port: 5173 },
  svelte:  { install: 'npm install',  start: 'npm run dev -- --host 0.0.0.0', port: 5173 },
  next:    { install: 'npm install',  start: 'npm run dev',                   port: 3000 },
  nuxt:    { install: 'npm install',  start: 'npm run dev',                   port: 3000 },
  angular: { install: 'npm install',  start: 'npx ng serve --host 0.0.0.0',  port: 4200 },
  astro:   { install: 'npm install',  start: 'npm run dev -- --host 0.0.0.0', port: 4321 },
  vanilla: { install: '',             start: 'npx serve -l 3000 .',           port: 3000 },
  flask:   { install: 'pip install -r requirements.txt', start: 'python app.py', port: 5000 },
  fastapi: { install: 'pip install -r requirements.txt', start: 'uvicorn main:app --host 0.0.0.0 --port 8000', port: 8000 },
  vite:    { install: 'npm install',  start: 'npm run dev -- --host 0.0.0.0', port: 5173 },
}

// ---------------------------------------------------------------------------
// Active sessions cache
// ---------------------------------------------------------------------------

const activeSessions = new Map<string, PreviewSession>()

// ---------------------------------------------------------------------------
// Lifecycle helpers (identical pattern to opensandbox-provider.ts)
// ---------------------------------------------------------------------------

async function lifecycleRequest(pathname: string, init: RequestInit = {}): Promise<any> {
  if (!OPEN_SANDBOX_API_KEY) {
    throw new Error('OPEN_SANDBOX_API_KEY is not configured')
  }
  const response = await fetch(`${OPEN_SANDBOX_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'OPEN-SANDBOX-API-KEY': OPEN_SANDBOX_API_KEY,
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  let payload: any = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  if (!response.ok) {
    throw new Error(typeof payload === 'string' ? payload : payload?.message || `OpenSandbox request failed (${response.status})`)
  }
  return payload
}

async function execdRequest(pathname: string, init: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  }
  if (OPEN_SANDBOX_EXECD_TOKEN) {
    headers['X-EXECD-ACCESS-TOKEN'] = OPEN_SANDBOX_EXECD_TOKEN
  }
  const response = await fetch(`${OPEN_SANDBOX_EXECD_URL}${pathname}`, { ...init, headers })
  const text = await response.text()
  let payload: any = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  if (!response.ok) {
    throw new Error(typeof payload === 'string' ? payload : payload?.message || `Execd request failed (${response.status})`)
  }
  return payload
}

async function execCommand(serverId: string, command: string, cwd = '/workspace'): Promise<{ output: string; exitCode: number }> {
  const payload = await execdRequest('/command', {
    method: 'POST',
    body: JSON.stringify({ command, cwd, sandboxId: serverId, background: false }),
  })
  const output = [payload?.stdout, payload?.stderr].filter(Boolean).join('\n')
  const exitCode = Number(payload?.exitCode ?? payload?.exit_code ?? 0)
  return { output, exitCode }
}

async function writeFileTo(serverId: string, filePath: string, content: string): Promise<void> {
  // SECURITY: Normalize and validate path to prevent traversal attacks
  const normalizedPath = path.posix.normalize(filePath)
  const workspaceRoot = '/workspace'

  // Ensure path stays within workspace
  if (!normalizedPath.startsWith(workspaceRoot + '/') && normalizedPath !== workspaceRoot) {
    throw new Error(`Invalid path: Path traversal detected. Path must be within ${workspaceRoot}`)
  }

  // SECURITY: Validate filename characters to prevent shell injection
  // Block shell metacharacters that could enable command substitution
  const filename = path.posix.basename(normalizedPath)
  const dangerousChars = /[`$\\;"'|&<>(){}!*\[\]?#~]/
  if (dangerousChars.test(filename)) {
    throw new Error(`Invalid filename: contains shell metacharacters. Filename: ${filename}`)
  }

  // Also validate directory components
  const dir = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
  if (dir) {
    // Check each path component for dangerous characters
    const pathComponents = dir.split('/').filter(Boolean)
    for (const component of pathComponents) {
      if (dangerousChars.test(component)) {
        throw new Error(`Invalid path component: contains shell metacharacters. Component: ${component}`)
      }
    }
    await execCommand(serverId, `mkdir -p ${JSON.stringify(dir)}`)
  }
  const encoded = Buffer.from(content, 'utf-8').toString('base64')
  await execCommand(serverId, `printf %s ${JSON.stringify(encoded)} | base64 -d > ${JSON.stringify(normalizedPath)}`)
}

async function getEndpointUrl(serverId: string, port: number): Promise<string> {
  try {
    const payload = await lifecycleRequest(`/sandboxes/${serverId}/endpoints/${port}`)
    return payload?.url || payload?.endpoint || `http://localhost:${port}`
  } catch {
    return `http://localhost:${port}`
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OpenSandboxPreviewService {
  /**
   * Deploy files and start a preview server.
   * Returns a URL suitable for embedding in an iframe.
   */
  async deploy(req: PreviewDeployRequest): Promise<PreviewDeployResult> {
    const start = Date.now()
    const logs: string[] = []
    const framework = req.framework || 'vanilla'
    const fwCmds = FRAMEWORK_COMMANDS[framework] || FRAMEWORK_COMMANDS.vanilla
    const port = req.port || fwCmds.port || DEFAULT_PORT

    try {
      let serverId: string

      // Reuse existing sandbox if provided
      if (req.sandboxId) {
        const existing = activeSessions.get(req.sandboxId)
        if (existing) {
          serverId = existing.serverId
          logs.push(`Reusing sandbox ${req.sandboxId}`)
        } else {
          // Try to get from OpenSandbox
          const sId = req.sandboxId.replace(/^osb-preview-/, '')
          await lifecycleRequest(`/sandboxes/${sId}`, { method: 'GET' })
          serverId = sId
          logs.push(`Reconnected to sandbox ${sId}`)
        }
      } else {
        // Create new sandbox
        const payload = await lifecycleRequest('/sandboxes', {
          method: 'POST',
          body: JSON.stringify({
            image: PREVIEW_IMAGE,
            timeout: DEFAULT_TIMEOUT,
            entrypoint: ['/bin/sh', '-lc', 'sleep infinity'],
            envs: { NODE_ENV: 'development', TERM: 'xterm-256color' },
            metadata: { mode: 'preview', framework, createdBy: 'opensandbox-preview-service' },
          }),
        })

        serverId = payload?.sandboxId || payload?.id || payload?.sandbox?.id
        if (!serverId) throw new Error('OpenSandbox did not return sandbox id')
        logs.push(`Created sandbox ${serverId}`)
      }

      const sandboxId = `osb-preview-${serverId}`

      // Write all project files with path traversal and shell injection protection
      let filesWritten = 0
      for (const [filePath, content] of Object.entries(req.files)) {
        // SECURITY: Sanitize file path to prevent traversal
        const sanitizedPath = filePath.replace(/^\/+/, '') // Remove leading slashes
        const targetPath = path.posix.join('/workspace', sanitizedPath)

        // Double-check the resolved path stays within workspace
        if (!targetPath.startsWith('/workspace/')) {
          logs.push(`Skipped malicious path (traversal): ${filePath}`)
          continue
        }

        // SECURITY: Check for shell metacharacters in entire path (filename AND directory components)
        // This prevents command substitution via paths like "/workspace/$(whoami).txt"
        const dangerousChars = /[`$\\;"'|&<>(){}!*\[\]?#~]/
        
        // Check filename
        const filename = path.posix.basename(targetPath)
        if (dangerousChars.test(filename)) {
          logs.push(`Skipped malicious filename (shell injection): ${filePath}`)
          continue
        }
        
        // Check directory components
        const dir = targetPath.substring('/workspace'.length)
        if (dir && dangerousChars.test(dir)) {
          logs.push(`Skipped malicious path component (shell injection): ${filePath}`)
          continue
        }

        await writeFileTo(serverId, targetPath, content)
        filesWritten++
      }
      logs.push(`Wrote ${filesWritten} files`)

      // Install dependencies
      const installCmd = req.installCommand || fwCmds.install
      if (installCmd) {
        logs.push(`Installing: ${installCmd}`)
        const installResult = await execCommand(serverId, installCmd)
        if (installResult.exitCode !== 0) {
          logs.push(`Install warning (exit ${installResult.exitCode}): ${installResult.output.slice(0, 500)}`)
        } else {
          logs.push('Dependencies installed')
        }
      }

      // Start dev server in background
      const startCmd = req.startCommand || fwCmds.start
      logs.push(`Starting: ${startCmd}`)
      await execdRequest('/command', {
        method: 'POST',
        body: JSON.stringify({
          command: `cd /workspace && ${startCmd}`,
          cwd: '/workspace',
          sandboxId: serverId,
          background: true,
        }),
      })

      // Poll until the dev server is reachable
      const endpointUrl = await getEndpointUrl(serverId, port)
      let previewUrl = endpointUrl

      for (let i = 0; i < HEALTH_POLL_MAX; i++) {
        try {
          const resp = await fetch(previewUrl, { signal: AbortSignal.timeout(1000) })
          if (resp.ok || resp.status < 500) {
            logs.push(`Dev server ready after ${((i + 1) * HEALTH_POLL_INTERVAL / 1000).toFixed(1)}s`)
            break
          }
        } catch { /* not ready */ }
        await new Promise(r => setTimeout(r, HEALTH_POLL_INTERVAL))
      }

      // Cache session
      const session: PreviewSession = {
        sandboxId,
        serverId,
        previewUrl,
        port,
        framework,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        userId: req.userId,
      }
      activeSessions.set(sandboxId, session)

      return {
        success: true,
        previewUrl,
        sandboxId,
        logs,
        duration: Date.now() - start,
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        logs,
        duration: Date.now() - start,
      }
    }
  }

  /**
   * Update files in an existing preview sandbox and hot-reload
   */
  async updateFiles(sandboxId: string, files: Record<string, string>): Promise<PreviewDeployResult> {
    const start = Date.now()
    const session = activeSessions.get(sandboxId)
    if (!session) {
      return { success: false, error: `Session ${sandboxId} not found`, duration: 0 }
    }

    const logs: string[] = []
    try {
      for (const [filePath, content] of Object.entries(files)) {
        // SECURITY: Sanitize file path to prevent traversal
        const sanitizedPath = filePath.replace(/^\/+/, '')
        const targetPath = path.posix.join('/workspace', sanitizedPath)

        if (!targetPath.startsWith('/workspace/')) {
          logs.push(`Skipped malicious path (traversal): ${filePath}`)
          continue
        }

        // SECURITY: Check for shell metacharacters in filename
        const filename = path.posix.basename(targetPath)
        const dangerousChars = /[`$\\;"'|&<>(){}!*\[\]?#~]/
        if (dangerousChars.test(filename)) {
          logs.push(`Skipped malicious filename (shell injection): ${filePath}`)
          continue
        }

        await writeFileTo(session.serverId, targetPath, content)
      }
      logs.push(`Updated ${Object.keys(files).length} files`)

      session.lastActivity = Date.now()

      return {
        success: true,
        previewUrl: session.previewUrl,
        sandboxId,
        logs,
        duration: Date.now() - start,
      }
    } catch (error: any) {
      return { success: false, error: error.message, logs, duration: Date.now() - start }
    }
  }

  /**
   * Destroy a preview sandbox
   */
  async destroy(sandboxId: string): Promise<void> {
    const session = activeSessions.get(sandboxId)
    if (!session) return

    try {
      await lifecycleRequest(`/sandboxes/${session.serverId}`, { method: 'DELETE' })
    } catch (error: any) {
      console.warn(`[OpenSandboxPreview] Failed to destroy ${sandboxId}: ${error.message}`)
    }
    activeSessions.delete(sandboxId)
  }

  /**
   * Get active session info
   */
  getSession(sandboxId: string): PreviewSession | undefined {
    return activeSessions.get(sandboxId)
  }

  /**
   * List all active preview sessions
   */
  listSessions(): PreviewSession[] {
    return Array.from(activeSessions.values())
  }

  /**
   * Cleanup idle sessions older than maxIdleMs
   */
  async cleanupIdle(maxIdleMs = 15 * 60 * 1000): Promise<number> {
    const now = Date.now()
    let cleaned = 0
    for (const [id, session] of activeSessions) {
      if (now - session.lastActivity > maxIdleMs) {
        await this.destroy(id)
        cleaned++
      }
    }
    return cleaned
  }
}

export const openSandboxPreviewService = new OpenSandboxPreviewService()
