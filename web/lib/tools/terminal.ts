/**
 * Terminal / PTY Tools
 *
 * Provides interactive terminal session management as structured tools
 * that the LLM can call — instead of one-shot exec_shell.
 *
 * Tools:
 * - terminal.create_session  — Create a new PTY or command-mode terminal session
 * - terminal.send_input      — Send keystrokes/input to an active terminal session
 * - terminal.get_output      — Read recent output from a terminal session
 * - terminal.resize          — Resize terminal dimensions
 * - terminal.close           — Close/terminate a terminal session
 * - terminal.list_sessions   — List all active terminal sessions
 * - terminal.start_process   — Start a background process (non-interactive)
 * - terminal.stop_process    — Stop a running process by PID
 * - terminal.list_processes  — List running processes
 * - terminal.get_port_status — Check listening ports and owning processes
 *
 * These enable interactive agentic use: start a dev server, check if it's
 * running, navigate a TUI, monitor build output, etc.
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Tools:Terminal');

// ============================================================================
// Output Buffers (module-level — survives across function calls)
// ============================================================================
// TerminalManager delivers output via onData callbacks but does NOT store it.
// We maintain per-session output buffers here so getTerminalOutput can read them.

interface SessionOutputBuffer {
  lines: string[];
  rawChunks: string[];
  maxLines: number;
  maxRawBytes: number;
  createdAt: number;
  lastAccessed: number;
}

const outputBuffers = new Map<string, SessionOutputBuffer>();
const DEFAULT_MAX_LINES = 5000;
const DEFAULT_MAX_RAW_BYTES = 2 * 1024 * 1024; // 2 MB
const BUFFER_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

/**
 * Get or create an output buffer for a session.
 */
function getOrCreateOutputBuffer(sessionId: string): SessionOutputBuffer {
  let buf = outputBuffers.get(sessionId);
  if (!buf) {
    buf = {
      lines: [],
      rawChunks: [],
      maxLines: DEFAULT_MAX_LINES,
      maxRawBytes: DEFAULT_MAX_RAW_BYTES,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
    };
    outputBuffers.set(sessionId, buf);
  }
  buf.lastAccessed = Date.now();
  return buf;
}

/**
 * Append output data to a session's buffer.
 * Called by the onData callback from terminalManager.createTerminalSession().
 */
export function appendTerminalOutput(sessionId: string, data: string): void {
  const buf = getOrCreateOutputBuffer(sessionId);
  buf.rawChunks.push(data);

  // Trim raw chunks if buffer exceeds max size
  let totalSize = 0;
  for (let i = buf.rawChunks.length - 1; i >= 0; i--) {
    totalSize += buf.rawChunks[i].length;
    if (totalSize > buf.maxRawBytes) {
      buf.rawChunks = buf.rawChunks.slice(i + 1);
      break;
    }
  }

  // Also maintain line-based view
  const newLines = data.split('\n');
  buf.lines.push(...newLines);

  // Trim lines if exceeds max
  if (buf.lines.length > buf.maxLines) {
    buf.lines = buf.lines.slice(buf.lines.length - buf.maxLines);
  }
}

/**
 * Remove an output buffer (called when session is closed).
 */
export function removeOutputBuffer(sessionId: string): void {
  outputBuffers.delete(sessionId);
}

/**
 * Clean up idle output buffers.
 */
function cleanupIdleBuffers(): void {
  const now = Date.now();
  for (const [sessionId, buf] of outputBuffers) {
    if (now - buf.lastAccessed > BUFFER_IDLE_TIMEOUT_MS) {
      outputBuffers.delete(sessionId);
    }
  }
}

// Run cleanup every 5 minutes
const cleanupInterval = setInterval(cleanupIdleBuffers, 5 * 60 * 1000);
cleanupInterval.unref(); // Don't prevent process exit

// ============================================================================
// Session Management
// ============================================================================

export interface TerminalSessionInfo {
  sessionId: string;
  sandboxId: string;
  mode: 'pty' | 'command-mode';
  cols: number;
  rows: number;
  cwd: string;
  status: 'active' | 'idle' | 'creating';
  detectedPorts: number[];
}

/**
 * Create a new terminal session (PTY if available, command-mode fallback).
 */
export async function createTerminalSession(
  userId: string,
  options?: {
    sandboxId?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
  },
): Promise<{
  sessionId: string;
  mode: 'pty' | 'command-mode';
  cols: number;
  rows: number;
  message: string;
}> {
  const { terminalManager } = await import('@/lib/terminal/terminal-manager');
  const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');

  // Resolve sandbox ID
  let sandboxId = options?.sandboxId;
  if (!sandboxId) {
    // Try to find an active sandbox for this user
    try {
      const { terminalSessionManager } = await import('@/lib/terminal/session/terminal-session-manager');
      const existingSessions = terminalSessionManager.getSessionsByUserId(userId);
      if (existingSessions.length > 0) {
        sandboxId = existingSessions[0].sandboxId;
        logger.debug('Reusing existing sandbox for user', { userId, sandboxId });
      }
    } catch (error: any) {
      logger.warn('Failed to find existing sandbox sessions', error.message);
    }
  }

  if (!sandboxId) {
    try {
      // Create a new sandbox session
      const session = await sandboxBridge.getOrCreateSession(userId);
      sandboxId = session.sandboxId;
      logger.debug('Created new sandbox session', { userId, sandboxId });
    } catch (error: any) {
      logger.error('Failed to create sandbox session', error.message);
      return {
        sessionId: '',
        mode: 'command-mode',
        cols: options?.cols || 120,
        rows: options?.rows || 30,
        message: `Failed to create sandbox: ${error.message}`,
      };
    }
  }

  const sessionId = `term-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cols = options?.cols || 120;
  const rows = options?.rows || 30;

  // Set up output buffer for this session
  getOrCreateOutputBuffer(sessionId);

  // Determine if this provider supports PTY
  let isPty = false;

  try {
    const mode = await terminalManager.createTerminalSession(
      sessionId,
      sandboxId,
      (data: string) => {
        // Accumulate output in module-level buffer
        appendTerminalOutput(sessionId, data);
      },
      (previewInfo) => {
        logger.debug('Port detected on terminal session', { sessionId, port: previewInfo });
      },
      { cols, rows },
      userId,
    );

    // terminalManager.createTerminalSession returns the ptyHandle ID string,
    // or 'command-mode' if PTY is not available
    isPty = !!mode && mode !== 'command-mode';

    logger.info('Terminal session created', {
      sessionId,
      sandboxId,
      mode: isPty ? 'pty' : 'command-mode',
    });

    return {
      sessionId,
      mode: isPty ? 'pty' : 'command-mode',
      cols,
      rows,
      message: isPty
        ? 'PTY terminal session created'
        : 'Terminal session created (command-mode — PTY not available on this provider)',
    };
  } catch (error: any) {
    // Clean up the buffer on failure
    removeOutputBuffer(sessionId);
    logger.error('Failed to create terminal session', error.message);
    return {
      sessionId: '',
      mode: 'command-mode',
      cols,
      rows,
      message: `Failed to create terminal session: ${error.message}`,
    };
  }
}

/**
 * Send input to an active terminal session.
 */
export async function sendTerminalInput(
  sessionId: string,
  input: string,
): Promise<{ success: boolean; message: string }> {
  const { terminalManager } = await import('@/lib/terminal/terminal-manager');

  if (!terminalManager.hasActiveSession(sessionId)) {
    return {
      success: false,
      message: `Terminal session '${sessionId}' not found or not active`,
    };
  }

  try {
    await terminalManager.sendInput(sessionId, input);
    logger.debug('Sent input to terminal', { sessionId, inputLength: input.length });
    return { success: true, message: `Sent ${input.length} character(s) to terminal` };
  } catch (error: any) {
    logger.error('Failed to send terminal input', { sessionId, error: error.message });
    return {
      success: false,
      message: `Failed to send input: ${error.message}`,
    };
  }
}

/**
 * Get recent output from a terminal session.
 * Reads from the module-level output buffer (maintained by appendTerminalOutput).
 */
export async function getTerminalOutput(
  sessionId: string,
  options?: {
    lines?: number;
    waitForPattern?: string;
    timeoutMs?: number;
  },
): Promise<{
  success: boolean;
  output: string;
  lineCount: number;
  message: string;
}> {
  const { terminalManager } = await import('@/lib/terminal/terminal-manager');

  if (!terminalManager.hasActiveSession(sessionId)) {
    return {
      success: false,
      output: '',
      lineCount: 0,
      message: `Terminal session '${sessionId}' not found or not active`,
    };
  }

  const buf = outputBuffers.get(sessionId);
  if (!buf) {
    return {
      success: false,
      output: '',
      lineCount: 0,
      message: `No output buffer for session '${sessionId}' — output was not captured`,
    };
  }

  // If waitForPattern specified, wait for it to appear in output
  if (options?.waitForPattern) {
    const timeout = options.timeoutMs || 30000;
    const startTime = Date.now();
    let lastJoinedOutput = buf.rawChunks.join('');

    if (lastJoinedOutput.includes(options.waitForPattern)) {
      return {
        success: true,
        output: getTailLines(lastJoinedOutput, options.lines || 100),
        lineCount: lastJoinedOutput.split('\n').length,
        message: `Pattern "${options.waitForPattern}" found in output`,
      };
    }

    // Poll for the pattern — only join new chunks each iteration
    const pollInterval = 500;
    let lastChunkCount = buf.rawChunks.length;
    while (Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      if (buf.rawChunks.length > lastChunkCount) {
        // Only re-join if new chunks arrived
        lastJoinedOutput = buf.rawChunks.join('');
        lastChunkCount = buf.rawChunks.length;
        if (lastJoinedOutput.includes(options.waitForPattern)) {
          return {
            success: true,
            output: getTailLines(lastJoinedOutput, options.lines || 100),
            lineCount: lastJoinedOutput.split('\n').length,
            message: `Pattern "${options.waitForPattern}" detected after ${Date.now() - startTime}ms`,
          };
        }
      }
    }

    return {
      success: false,
      output: getTailLines(lastJoinedOutput, options.lines || 100),
      lineCount: lastJoinedOutput.split('\n').length,
      message: `Timeout (${timeout}ms) waiting for pattern "${options.waitForPattern}"`,
    };
  }

  // Return recent output from buffer
  const lineCount = options?.lines || 100;
  const recentLines = buf.lines.slice(-lineCount);

  return {
    success: true,
    output: recentLines.join('\n'),
    lineCount: recentLines.length,
    message: `Retrieved ${recentLines.length} lines from terminal output`,
  };
}

/**
 * Resize a terminal session.
 */
export async function resizeTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<{ success: boolean; message: string }> {
  const { terminalManager } = await import('@/lib/terminal/terminal-manager');

  if (!terminalManager.hasActiveSession(sessionId)) {
    return {
      success: false,
      message: `Terminal session '${sessionId}' not found or not active`,
    };
  }

  try {
    await terminalManager.resizeTerminal(sessionId, cols, rows);
    return { success: true, message: `Resized terminal to ${cols}x${rows}` };
  } catch (error: any) {
    logger.error('Failed to resize terminal', { sessionId, error: error.message });
    return {
      success: false,
      message: `Failed to resize terminal: ${error.message}`,
    };
  }
}

/**
 * Close a terminal session.
 */
export async function closeTerminalSession(
  sessionId: string,
): Promise<{ success: boolean; message: string }> {
  const { terminalManager } = await import('@/lib/terminal/terminal-manager');

  if (!terminalManager.hasActiveSession(sessionId)) {
    return {
      success: false,
      message: `Terminal session '${sessionId}' not found or not active`,
    };
  }

  try {
    await terminalManager.disconnectTerminal(sessionId);
    removeOutputBuffer(sessionId);
    logger.info('Terminal session closed', { sessionId });
    return { success: true, message: `Terminal session '${sessionId}' closed` };
  } catch (error: any) {
    logger.error('Failed to close terminal session', { sessionId, error: error.message });
    // Still clean up the buffer even if disconnect fails
    removeOutputBuffer(sessionId);
    return {
      success: false,
      message: `Failed to close terminal: ${error.message}`,
    };
  }
}

/**
 * List all active terminal sessions.
 */
export async function listTerminalSessions(
  userId?: string,
): Promise<{
  sessions: TerminalSessionInfo[];
  count: number;
}> {
  const { terminalSessionManager } = await import('@/lib/terminal/session/terminal-session-manager');
  const { terminalManager } = await import('@/lib/terminal/terminal-manager');

  let sessions = terminalSessionManager.getAllSessions();

  if (userId) {
    sessions = sessions.filter(s => s.userId === userId);
  }

  const activeSessions: TerminalSessionInfo[] = [];

  for (const s of sessions) {
    if (!terminalManager.hasActiveSession(s.sessionId)) continue;

    // Get detected ports from active connection (PTY or command-mode)
    let detectedPorts: number[] = [];
    const ptyConn = terminalManager.getConnection(s.sessionId);
    if (ptyConn) {
      detectedPorts = Array.from((ptyConn as any).detectedPorts || []);
    } else if (s.mode === 'command-mode') {
      // Command-mode sessions store detected ports in the session state
      detectedPorts = (s as any).detectedPorts || [];
    }

    activeSessions.push({
      sessionId: s.sessionId,
      sandboxId: s.sandboxId,
      mode: (s.mode as 'pty' | 'command-mode') || 'command-mode',
      cols: s.cols || 120,
      rows: s.rows || 30,
      cwd: s.cwd || '/',
      status: (s.status === 'suspended' || s.status === 'deleted' ? 'idle' : s.status) || 'active',
      detectedPorts,
    });
  }

  return {
    sessions: activeSessions,
    count: activeSessions.length,
  };
}

// ============================================================================
// Process Management
// ============================================================================

export interface ProcessInfo {
  pid: number;
  user?: string;
  cpu?: string;
  memory?: string;
  command: string;
  startTime?: string;
}

/**
 * Start a background process in the sandbox.
 */
export async function startProcess(
  command: string,
  options?: {
    sandboxId?: string;
    userId?: string;
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  },
): Promise<{
  success: boolean;
  output: string;
  exitCode: number | null;
  message: string;
}> {
  const handle = await resolveSandboxHandle(options?.sandboxId, options?.userId);
  if (!handle) {
    return {
      success: false,
      output: '',
      exitCode: 1,
      message: 'No sandbox available — cannot start process',
    };
  }

  try {
    const timeout = options?.timeout || 60000;
    const result = await handle.executeCommand(command, options?.cwd, timeout);

    return {
      success: result.success,
      output: result.output || '',
      exitCode: result.exitCode ?? (result.success ? 0 : 1),
      message: result.success ? 'Process completed' : `Process failed with exit code ${result.exitCode}`,
    };
  } catch (error: any) {
    logger.error('Failed to start process', { command, error: error.message });
    return {
      success: false,
      output: '',
      exitCode: 1,
      message: `Failed to start process: ${error.message}`,
    };
  }
}

/**
 * Stop a running process by PID.
 */
export async function stopProcess(
  pid: number,
  options?: {
    sandboxId?: string;
    userId?: string;
    signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT';
  },
): Promise<{ success: boolean; message: string }> {
  const handle = await resolveSandboxHandle(options?.sandboxId, options?.userId);
  if (!handle) {
    return {
      success: false,
      message: 'No sandbox available',
    };
  }

  const signal = options?.signal || 'SIGTERM';
  const command = `kill -${signal} ${pid}`;

  try {
    const result = await handle.executeCommand(command);
    if (result.success || result.exitCode === 0) {
      return { success: true, message: `Sent ${signal} to process ${pid}` };
    }
    return {
      success: false,
      message: `Failed to stop process ${pid}: ${result.output || 'unknown error'}`,
    };
  } catch (error: any) {
    logger.error('Failed to stop process', { pid, error: error.message });
    return {
      success: false,
      message: `Failed to stop process ${pid}: ${error.message}`,
    };
  }
}

/**
 * List running processes.
 */
export async function listProcesses(
  options?: {
    sandboxId?: string;
    userId?: string;
    filter?: string;
  },
): Promise<{
  success: boolean;
  processes: ProcessInfo[];
  message: string;
}> {
  const handle = await resolveSandboxHandle(options?.sandboxId, options?.userId);
  if (!handle) {
    return {
      success: false,
      processes: [],
      message: 'No sandbox available',
    };
  }

  try {
    // Escape filter string to prevent command injection
    const safeFilter = options?.filter
      ? options.filter.replace(/[^a-zA-Z0-9_./-]/g, '')
      : undefined;

    const psCommand = safeFilter
      ? `ps aux | grep "${safeFilter}" | grep -v grep`
      : 'ps aux';

    const result = await handle.executeCommand(psCommand);

    if (!result.success || !result.output) {
      return {
        success: false,
        processes: [],
        message: `Failed to list processes: ${result.output || 'no output'}`,
      };
    }

    const processes = parsePsOutput(result.output);
    return {
      success: true,
      processes,
      message: `Found ${processes.length} process(es)`,
    };
  } catch (error: any) {
    logger.error('Failed to list processes', error.message);
    return {
      success: false,
      processes: [],
      message: `Failed to list processes: ${error.message}`,
    };
  }
}

// ============================================================================
// Port Status
// ============================================================================

export interface PortInfo {
  port: number;
  protocol: 'tcp' | 'udp';
  state: 'LISTEN' | 'ESTABLISHED' | 'TIME_WAIT' | 'CLOSE_WAIT';
  pid?: number;
  command?: string;
}

/**
 * Check listening ports and owning processes.
 */
export async function getPortStatus(
  options?: {
    sandboxId?: string;
    userId?: string;
    port?: number;
  },
): Promise<{
  success: boolean;
  ports: PortInfo[];
  message: string;
}> {
  const handle = await resolveSandboxHandle(options?.sandboxId, options?.userId);
  if (!handle) {
    return {
      success: false,
      ports: [],
      message: 'No sandbox available',
    };
  }

  try {
    const cmd = options?.port
      ? `ss -tlnp 2>/dev/null | grep ":${options.port}" || netstat -tlnp 2>/dev/null | grep ":${options.port}"`
      : 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null';

    const result = await handle.executeCommand(cmd);

    if (!result.output) {
      // Empty output is valid — no ports listening
      return {
        success: true,
        ports: [],
        message: options?.port
          ? `Port ${options.port} is not listening`
          : 'No listening ports detected',
      };
    }

    const ports = parseSsOutput(result.output);
    return {
      success: true,
      ports,
      message: `Found ${ports.length} listening port(s)`,
    };
  } catch (error: any) {
    logger.error('Failed to get port status', error.message);
    return {
      success: false,
      ports: [],
      message: `Failed to get port status: ${error.message}`,
    };
  }
}

// ============================================================================
// Parser Utilities
// ============================================================================

/**
 * Parse `ps aux` output into structured process info.
 */
function parsePsOutput(output: string): ProcessInfo[] {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return [];

  const processes: ProcessInfo[] = [];
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/);
    if (parts.length >= 11) {
      const pid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue; // Skip malformed lines

      processes.push({
        pid,
        user: parts[0],
        cpu: parts[2],
        memory: parts[3],
        command: parts.slice(10).join(' '),
        startTime: parts[8],
      });
    }
  }
  return processes;
}

/**
 * Parse `ss -tlnp` or `netstat -tlnp` output.
 */
function parseSsOutput(output: string): PortInfo[] {
  const lines = output.trim().split('\n');
  const ports: PortInfo[] = [];

  for (const line of lines) {
    // Skip header line
    if (line.startsWith('State') || line.startsWith('Netid')) continue;

    // ss format: LISTEN 0 128 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=1234,fd=22))
    // Also handles: [::]:3000, *:3000, 127.0.0.1:3000
    const ssMatch = line.match(/(\w+)\s+\S+\s+\S+\s+\S+:(\d+)\s+\S+\s+(.*)/);
    if (ssMatch) {
      const state = ssMatch[1];
      const port = parseInt(ssMatch[2], 10);
      if (isNaN(port)) continue;

      const details = ssMatch[3];
      const pidMatch = details.match(/pid=(\d+)/);
      const cmdMatch = details.match(/\("([^"]+)"/);

      // Include all connection states that indicate port activity
      const validStates = new Set(['LISTEN', 'ESTABLISHED', 'TIME_WAIT', 'CLOSE_WAIT', 'SYN_SENT', 'SYN_RECV']);
      if (!validStates.has(state)) continue;

      ports.push({
        port,
        protocol: 'tcp',
        state: state as PortInfo['state'],
        pid: pidMatch ? parseInt(pidMatch[1], 10) : undefined,
        command: cmdMatch ? cmdMatch[1] : undefined,
      });
    }
  }

  return ports;
}

/**
 * Get the last N lines of a string.
 */
function getTailLines(text: string, n: number): string {
  const lines = text.split('\n');
  return lines.slice(-n).join('\n');
}

/**
 * Resolve a sandbox handle from sandbox ID or user ID.
 */
async function resolveSandboxHandle(sandboxId?: string, userId?: string) {
  const { SandboxService } = await import('@/lib/sandbox/core-sandbox-service');
  const { sandboxBridge } = await import('@/lib/sandbox/sandbox-service-bridge');

  if (sandboxId) {
    try {
      const service = new SandboxService();
      const handle = await service.getSandbox(sandboxId);
      if (handle) return handle;
    } catch (error: any) {
      logger.warn('Failed to get sandbox by ID', { sandboxId, error: error.message });
    }
  }

  if (userId) {
    try {
      const session = await sandboxBridge.getOrCreateSession(userId);
      if (session?.sandboxId) {
        const service = new SandboxService();
        const handle = await service.getSandbox(session.sandboxId);
        return handle;
      }
    } catch (error: any) {
      logger.warn('Failed to get/create sandbox session for user', { userId, error: error.message });
    }
  }

  return null;
}
