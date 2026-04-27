/**
 * Local Server Utilities
 *
 * Shared helpers for spawning local agent binaries as subprocesses,
 * waiting for them to become ready via health-check polling, and
 * connecting to remote agent servers.
 *
 * Used by openai-agent-base.ts, claude-code-agent.ts, and opencode-agent.ts.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger } from '../utils/logger';
import type { AgentInstance, AgentType } from './agent-service-manager';

const logger = createLogger('LocalServerUtils');

/**
 * Wait for a local HTTP server to respond to health checks.
 * Polls `http://127.0.0.1:<port>/health` every 1s for up to `timeoutMs`.
 *
 * @throws Error if the server is not ready within the timeout
 */
export async function waitForLocalServer(
  port: number,
  timeoutMs = 30_000,
): Promise<void> {
  const apiUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        logger.info('Local server ready', { port });
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error(`Local server on port ${port} not ready after ${timeoutMs}ms`);
}

/**
 * Spawn a local agent binary as a subprocess with stdio piping.
 * Sets up stderr logging, stdout draining, and exit/error handlers.
 *
 * @returns The spawned ChildProcess
 */
export interface SpawnLocalAgentOptions {
  /** Working directory for the subprocess */
  cwd: string;
  /** Environment variables (merged into process.env) */
  env: Record<string, string | undefined>;
  /** Label used in log messages */
  label: string;
  /** Called when the subprocess exits (for caller to clear its reference) */
  onExit?: (code: number | null) => void;
  /** Called when the subprocess errors (for caller to clear its reference) */
  onError?: (err: Error) => void;
  /**
   * When false, stdout is NOT drained to the logger and remains available
   * for the caller to read via `proc.stdout.on('data', ...)`. This is needed
   * for agents that communicate over stdout (e.g., JSON-RPC protocols like Pi).
   * Default: true (drain stdout to logger to prevent buffer-full hangs).
   */
  drainStdout?: boolean;
}

export function spawnLocalAgent(
  command: string,
  args: string[],
  options: SpawnLocalAgentOptions,
): ChildProcess {
  const proc = spawn(command, args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...options.env },
  });

  // Drain stdout to prevent buffer-full hangs (unless caller needs raw stdout)
  if (options.drainStdout !== false) {
    proc.stdout?.on('data', (chunk: Buffer) => {
      logger.debug(`[${options.label} stdout]`, { output: chunk.toString().trim() });
    });
  }

  // Log stderr for debugging
  proc.stderr?.on('data', (chunk: Buffer) => {
    logger.debug(`[${options.label} stderr]`, { output: chunk.toString().trim() });
  });

  proc.on('exit', (code) => {
    logger.info(`${options.label} process exited`, { exitCode: code });
    options.onExit?.(code);
  });

  proc.on('error', (err) => {
    logger.error(`${options.label} process error`, { error: err.message });
    options.onError?.(err);
  });

  return proc;
}

// ============================================================================
// Remote Agent Connection
// ============================================================================

/**
 * Options for connecting to a remote agent server.
 */
export interface ConnectToRemoteAgentOptions {
  /** Remote URL (e.g. "https://codex.example.com:8080") */
  remoteAddress: string;
  /** Agent type string (for AgentInstance and logs) */
  agentType: AgentType | string;
  /** Agent ID (auto-generated if not provided) */
  agentId?: string;
  /** Workspace directory */
  workspaceDir: string;
  /** Health check endpoint path (default: "/health") */
  healthCheckPath?: string;
  /** Health check timeout in ms (default: 5000) */
  healthCheckTimeoutMs?: number;
}

/**
 * Connect to a remote agent server.
 *
 * When a `remoteAddress` is configured, the agent skips local binary spawn
 * AND containerized fallback, and connects directly to the remote endpoint.
 * This supports web-hosted / cloud deployments where the CLI agent runs on
 * a remote server.
 *
 * Performs an optional health check (5s timeout) — proceeds even if the
 * health check fails, since the remote server may not expose /health.
 *
 * @returns An AgentInstance pointing to the remote server
 */
export async function connectToRemoteAgent(
  options: ConnectToRemoteAgentOptions,
): Promise<AgentInstance> {
  const remoteUrl = options.remoteAddress.replace(/\/+$/, '');
  const healthPath = options.healthCheckPath || '/health';
  const healthTimeout = options.healthCheckTimeoutMs ?? 5000;

  logger.info(`Connecting to remote ${options.agentType} server`, { remoteUrl });

  const agent: AgentInstance = {
    agentId: options.agentId || `${options.agentType}-remote-${Date.now()}`,
    type: options.agentType as AgentType,
    containerId: '',
    port: 0,
    apiUrl: remoteUrl,
    workspaceDir: options.workspaceDir,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    status: 'ready',
    health: 'unknown',
  };

  // Verify the remote server is reachable
  try {
    const healthResp = await fetch(`${remoteUrl}${healthPath}`, {
      method: 'GET',
      signal: AbortSignal.timeout(healthTimeout),
    });
    if (healthResp.ok) {
      agent.health = 'healthy';
    }
  } catch {
    logger.warn(`Remote ${options.agentType} server health check failed — proceeding anyway`, { remoteUrl });
  }

  logger.info(`${options.agentType} agent connected (remote)`, {
    agentId: agent.agentId,
    apiUrl: agent.apiUrl,
  });

  return agent;
}
