import type { SandboxHandle } from './providers/sandbox-provider'

interface DaemonProcess {
  id: string
  sessionId: string
  command: string
  startedAt: number
  port?: number
  status: 'running' | 'stopped' | 'crashed'
}

const activeDaemons = new Map<string, DaemonProcess[]>()

export class DaemonManager {
  async startDaemon(
    sandbox: SandboxHandle,
    sessionId: string,
    command: string,
    options?: { port?: number },
  ): Promise<DaemonProcess> {
    const daemonId = `daemon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Run command in background via nohup, redirect output to log file
    const bgCommand = `nohup ${command} > /tmp/${daemonId}.log 2>&1 & echo $!`
    const result = await sandbox.executeCommand(bgCommand)

    const daemon: DaemonProcess = {
      id: daemonId,
      sessionId,
      command,
      startedAt: Date.now(),
      port: options?.port,
      status: 'running',
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

    // Find and kill the process by looking for its command
    await sandbox.executeCommand(
      `pkill -f "${daemon.command.replace(/"/g, '\\"')}" || true`,
    )

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
