import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/terminal/terminal-manager';
import { checkCommandSecurity } from '@/lib/terminal/security/terminal-security';
import { terminalCommandRateLimiter } from '@/lib/utils/rate-limiter';
import { TERMINAL_LIMITS } from '@/lib/terminal/terminal-constants';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('TerminalInputAPI');

export const runtime = 'nodejs';

/**
 * Command buffer for assembling multi-chunk commands
 * SECURITY: Buffer input per session to validate complete commands before execution
 * This prevents bypassing security checks by splitting dangerous commands across requests
 *
 * Sessions are added to this buffer when they first send a command without an existing PTY connection.
 * Once a complete command is validated, the data is forwarded and the buffer is cleared.
 */
const commandBuffers = new Map<string, { buffer: string; lastActivity: number }>();

// Cleanup old entries every minute to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  // Cleanup stale command buffers (older than 5 minutes)
  for (const [sessionId, entry] of commandBuffers.entries()) {
    if (now > entry.lastActivity + 300000) {
      commandBuffers.delete(sessionId);
    }
  }
}, TERMINAL_LIMITS.CLEANUP_INTERVAL_MS);

export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
      logger.warn('Terminal input auth failed', { source: authResult.source });
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { sessionId, data } = body;

    if (!sessionId || typeof data !== 'string') {
      return NextResponse.json(
        { error: 'sessionId and data are required' },
        { status: 400 }
      );
    }

    // ✅ INPUT SIZE LIMIT (max 10KB per input)
    if (data.length > TERMINAL_LIMITS.MAX_INPUT_SIZE) {
      logger.warn('Input too large', {
        size: data.length,
        limit: TERMINAL_LIMITS.MAX_INPUT_SIZE,
        userId: authResult.userId,
        sessionId,
      });
      return NextResponse.json(
        { error: `Input too large (max ${TERMINAL_LIMITS.MAX_INPUT_SIZE / 1024}KB)` },
        { status: 400 }
      );
    }

    // ✅ VALIDATE SESSION BEFORE BUFFERING (prevents probing attacks)
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sessionId !== sessionId) {
      logger.warn('Unauthorized terminal input attempt', {
        userId: authResult.userId,
        requestedSessionId: sessionId,
        ownedSessionId: userSession?.sessionId,
      });
      return NextResponse.json(
        { error: 'Unauthorized: session does not belong to this user' },
        { status: 403 }
      );
    }

    // ✅ CHECK RATE LIMIT (after auth and session validation)
    const rateLimitResult = terminalCommandRateLimiter.check(authResult.userId);
    if (!rateLimitResult.allowed) {
      logger.debug('Terminal command rate limit exceeded', {
        userId: authResult.userId,
        retryAfter: rateLimitResult.retryAfter,
      });
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Too many terminal commands.',
          retryAfter: rateLimitResult.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.retryAfter || 1),
            'X-RateLimit-Limit': String(rateLimitResult.limit),
            'X-RateLimit-Remaining': String(rateLimitResult.remaining || 0),
          },
        }
      );
    }

    // Interactive PTY sessions must receive raw bytes immediately.
    // Only command-mode input is buffered for newline-based security validation.
    if (terminalManager.hasPtyConnection(sessionId)) {
      commandBuffers.delete(sessionId);
      await terminalManager.sendInput(sessionId, data);

      logger.debug('PTY terminal input sent immediately', {
        sessionId,
        userId: authResult.userId,
        inputLength: data.length,
      });

      return NextResponse.json({ success: true, mode: 'pty' });
    }

    // Check if the terminal manager has ANY connection for this session
    // (command-mode or WebSocket). If not, the PTY failed to start and
    // the session is in a zombie state — tell the client gracefully.
    if (!terminalManager.hasActiveSession(sessionId)) {
      // Don't log as warn — this is expected when the client sends input
      // before the sandbox PTY has finished initializing.
      logger.debug('No active terminal session for input (client sent too early)', { sessionId });
      return NextResponse.json(
        {
          error: 'Terminal session is not active. The sandbox PTY may have failed to start.',
          hint: 'Close and reopen the terminal to retry.',
        },
        { status: 503 }
      );
    }

    // ✅ BUFFER command-mode input for security validation
    const bufferEntry = commandBuffers.get(sessionId) || { buffer: '', lastActivity: Date.now() };
    bufferEntry.buffer += data;
    bufferEntry.lastActivity = Date.now();
    
    // ✅ BUFFER SIZE LIMIT
    if (bufferEntry.buffer.length > TERMINAL_LIMITS.MAX_BUFFER_SIZE) {
      logger.warn('Command buffer overflow', {
        size: bufferEntry.buffer.length,
        limit: TERMINAL_LIMITS.MAX_BUFFER_SIZE,
        userId: authResult.userId,
        sessionId,
      });
      commandBuffers.delete(sessionId);
      return NextResponse.json(
        { error: `Command buffer overflow (max ${TERMINAL_LIMITS.MAX_BUFFER_SIZE / 1024}KB)` },
        { status: 400 }
      );
    }
    
    commandBuffers.set(sessionId, bufferEntry);

    // Check if we have a complete command (contains newline or carriage return)
    // Must match terminal-manager.ts which triggers on both \r and \n
    if (bufferEntry.buffer.includes('\n') || bufferEntry.buffer.includes('\r')) {
      const fullCommand = bufferEntry.buffer.trim();
      const securityResult = checkCommandSecurity(fullCommand);

      if (!securityResult.allowed) {
        // ✅ TRUNCATE LOGGED COMMANDS (prevent secret exposure)
        const truncatedCommand = fullCommand.length > 100
          ? fullCommand.substring(0, 100) + '...'
          : fullCommand;
        
        logger.warn('Blocked dangerous command', {
          command: truncatedCommand,
          reason: securityResult.reason,
          severity: securityResult.severity,
          userId: authResult.userId,
          sessionId,
          wasObfuscated: securityResult.wasObfuscated,
        });

        // Clear the buffer to prevent partial execution
        commandBuffers.delete(sessionId);

        return NextResponse.json(
          {
            error: 'Command blocked for security reasons',
            reason: securityResult.reason,
            severity: securityResult.severity,
          },
          { status: 403 }
        );
      }

      // ✅ SECURITY CHECK PASSES - NOW FORWARD TO TERMINAL
      // Send the FULL buffered command, not just the last chunk
      await terminalManager.sendInput(sessionId, bufferEntry.buffer);

      // Clear buffer after successful validation and forwarding
      commandBuffers.delete(sessionId);

      logger.debug('Terminal input sent successfully', {
        sessionId,
        userId: authResult.userId,
        commandLength: data.length,
      });

      return NextResponse.json({ success: true });
    }

    // Partial command (buffered, waiting for newline) - don't forward yet
    // This prevents partial command execution before security validation
    return NextResponse.json({ success: true, buffered: true });
  } catch (error) {
    const err = error as Error;

    // Graceful handling when PTY failed to start (sandbox in zombie state)
    if (err.message?.includes('No active terminal session')) {
      logger.warn('Terminal input rejected — no active session', { sessionId });
      return NextResponse.json(
        {
          error: 'Terminal session is not active. The sandbox PTY may have failed to start.',
          hint: 'Close and reopen the terminal to retry.',
        },
        { status: 503 }
      );
    }

    logger.error('Terminal input error', {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });
    return NextResponse.json({ error: 'Failed to send input', details: err.message }, { status: 500 });
  }
}
