import net from 'node:net'
import { spawn } from 'node:child_process'

const DEFAULT_SERVER_URL = process.env.MSB_SERVER_URL || 'http://127.0.0.1:5555'
const DEFAULT_START_COMMAND = process.env.MICROSANDBOX_START_COMMAND || 'msb server start --dev'
const DEFAULT_START_TIMEOUT_MS = parseInt(process.env.MICROSANDBOX_START_TIMEOUT_MS || '20000', 10)

let startPromise: Promise<void> | null = null

function parseHostPort(serverUrl: string): { host: string; port: number } {
  try {
    const url = new URL(serverUrl)
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
    return {
      host: url.hostname || '127.0.0.1',
      port: Number.isFinite(port) && port > 0 ? port : 5555,
    }
  } catch {
    return { host: '127.0.0.1', port: 5555 }
  }
}

function waitForPort(host: string, port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port })
      let settled = false

      const cleanup = () => {
        socket.removeAllListeners()
        socket.destroy()
      }

      socket.once('connect', () => {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      })

      socket.once('error', () => {
        if (settled) return
        settled = true
        cleanup()
        if (Date.now() >= deadline) {
          reject(new Error(`Microsandbox daemon not reachable at ${host}:${port}`))
          return
        }
        setTimeout(tryConnect, 400)
      })
    }

    tryConnect()
  })
}

async function isDaemonReachable(serverUrl: string): Promise<boolean> {
  const { host, port } = parseHostPort(serverUrl)
  try {
    await waitForPort(host, port, 700)
    return true
  } catch {
    return false
  }
}

function spawnDaemon(command: string): void {
  const isWindows = process.platform === 'win32'
  if (isWindows) {
    const child = spawn('cmd.exe', ['/c', command], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    return
  }

  const child = spawn('sh', ['-lc', command], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

export async function ensureMicrosandboxDaemonRunning(): Promise<void> {
  const autoStartEnabled = process.env.MICROSANDBOX_AUTO_START !== 'false'
  const serverUrl = DEFAULT_SERVER_URL

  if (await isDaemonReachable(serverUrl)) {
    return
  }

  if (!autoStartEnabled) {
    throw new Error(
      `Microsandbox daemon is not reachable at ${serverUrl}. Start it with: ${DEFAULT_START_COMMAND}`,
    )
  }

  if (!startPromise) {
    startPromise = (async () => {
      console.warn(`[Microsandbox] Daemon not reachable at ${serverUrl}. Starting with: ${DEFAULT_START_COMMAND}`)
      spawnDaemon(DEFAULT_START_COMMAND)
      const { host, port } = parseHostPort(serverUrl)
      await waitForPort(host, port, DEFAULT_START_TIMEOUT_MS)
      console.log(`[Microsandbox] Daemon reachable at ${host}:${port}`)
    })().finally(() => {
      startPromise = null
    })
  }

  await startPromise
}
