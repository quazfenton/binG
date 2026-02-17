import type { SandboxHandle } from './providers/sandbox-provider'

interface DaemonProcess {
  id: string
  sessionId: string
  command: string
  startedAt: number
  port?: number
  status: 'running' | 'stopped' | 'crashed'
  pid?: number
}

const activeDaemons = new Map<string, DaemonProcess[]>()

export class DaemonManager {
  /**
   * Sanitize command to prevent shell injection attacks
   */
  private sanitizeCommand(command: string): string {
    // Reject commands with shell metacharacters that could enable injection
    const dangerousChars = /[;&|`$(){}[\]<>!#~\\]/;
    if (dangerousChars.test(command)) {
      throw new Error('Command contains disallowed characters for security');
    }
    // Reject commands with newlines or null bytes
    if (/[\n\r\0]/.test(command)) {
      throw new Error('Command contains invalid control characters');
    }
    return command;
  }

  async startDaemon(
    sandbox: SandboxHandle,
    sessionId: string,
    command: string,
    options?: { port?: number },
  ): Promise<DaemonProcess> {
    const daemonId = `daemon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Sanitize command to prevent injection
    const safeCommand = this.sanitizeCommand(command);

    // Run command in background via nohup, redirect output to log file
    // Capture PID for later cleanup
    const bgCommand = `nohup ${safeCommand} > /tmp/${daemonId}.log 2>&1 & echo $!`
    const result = await sandbox.executeCommand(bgCommand)

    if (!result.success) {
      throw new Error(`Failed to start daemon: ${result.output}`);
    }

    // Parse the PID from the output
    const pid = parseInt(result.output.trim(), 10);

    const daemon: DaemonProcess = {
      id: daemonId,
      sessionId,
      command: safeCommand,
      startedAt: Date.now(),
      port: options?.port,
      status: 'running',
      pid: isNaN(pid) ? undefined : pid,
    }

    const sessionDaemons = activeDaemons.get(sessionId) ?? []
    sessionDaemons.push(daemon)
    activeDaemons.set(sessionId, sessionDaemons)

    return daemon
  }

  async stopDaemon(
    sandbox: SandboxHandle,
    sessionId: string,
    daemonId: string,
  ): Promise<void> {
    const daemons = activeDaemons.get(sessionId)
    if (!daemons) return

    const daemon = daemons.find((d) => d.id === daemonId)
    if (!daemon) return

    // Prefer killing by PID if available (more reliable than pkill -f)
    if (daemon.pid) {
      await sandbox.executeCommand(`kill ${daemon.pid} 2>/dev/null || true`)
      // Also try SIGKILL if SIGTERM doesn't work
      await sandbox.executeCommand(`kill -9 ${daemon.pid} 2>/dev/null || true`)
    } else {
      // Fallback to pkill if PID not available - escape all shell metacharacters
      const escapedCommand = daemon.command
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/;/g, '\\;')
        .replace(/&/g, '\\&')
        .replace(/\|/g, '\\|')
      await sandbox.executeCommand(`pkill -f "${escapedCommand}" || true`)
    }

    daemon.status = 'stopped'
  }

  async stopAllDaemons(
    sandbox: SandboxHandle,
    sessionId: string,
  ): Promise<void> {
    const daemons = activeDaemons.get(sessionId)
    if (!daemons) return

    for (const daemon of daemons) {
      if (daemon.status === 'running') {
        await this.stopDaemon(sandbox, sessionId, daemon.id)
      }
    }

    activeDaemons.delete(sessionId)
  }

  async getDaemonLogs(
    sandbox: SandboxHandle,
    daemonId: string,
    tailLines?: number,
  ): Promise<string> {
    const lines = tailLines ?? 50
    const result = await sandbox.executeCommand(
      `tail -n ${lines} /tmp/${daemonId}.log 2>/dev/null || echo "(no logs)"`,
    )
    return result.output
  }

  async listDaemons(
    sandbox: SandboxHandle,
    sessionId: string,
  ): Promise<DaemonProcess[]> {
    const daemons = activeDaemons.get(sessionId) ?? []

    // Check which ones are still running
    const psResult = await sandbox.executeCommand('ps aux')
    for (const daemon of daemons) {
      if (daemon.status === 'running') {
        const isRunning = psResult.output.includes(daemon.command.split(' ')[0])
        if (!isRunning) {
          daemon.status = 'crashed'
        }
      }
    }

    return daemons
  }

  getSessionDaemons(sessionId: string): DaemonProcess[] {
    return activeDaemons.get(sessionId) ?? []
  }
}
