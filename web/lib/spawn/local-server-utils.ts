/**
 * Local Server Utilities
 *
 * Shared helpers for spawning local agent binaries as subprocesses
 * and waiting for them to become ready via health-check polling.
 *
 * Used by amp-agent.ts and claude-code-agent.ts.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createLogger } from '../utils/logger';

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

  // Drain stdout to prevent buffer-full hangs
  proc.stdout?.on('data', (chunk: Buffer) => {
    logger.debug(`[${options.label} stdout]`, { output: chunk.toString().trim() });
  });

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
