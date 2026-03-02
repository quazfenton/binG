import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/sandbox/terminal-manager';
import { checkCommandSecurity } from '@/lib/terminal/terminal-security';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('TerminalInputAPI');

export const runtime = 'nodejs';

/**
 * Rate limiter for terminal commands
 * Prevents DoS attacks via rapid command execution
 * Max 10 commands per second per user
 */
const commandRateLimiter = new Map<string, { count: number; resetAt: number }>();

/**
 * Command buffer for assembling multi-chunk commands
 * SECURITY: Buffer input per session to validate complete commands before execution
 * This prevents bypassing security checks by splitting dangerous commands across requests
 * 
 * Sessions are added to this buffer when they first send a command without an existing PTY connection.
 * Once a complete command is validated, the data is forwarded and the buffer is cleared.
 */
const commandBuffers = new Map<string, { buffer: string; lastActivity: number }>();

function checkRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const userLimit = commandRateLimiter.get(userId) || { count: 0, resetAt: now + 1000 };

  if (now > userLimit.resetAt) {
    userLimit.count = 0;
    userLimit.resetAt = now + 1000;
  }

  if (userLimit.count >= 10) { // Max 10 commands/second
    const retryAfter = Math.ceil((userLimit.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  userLimit.count++;
  commandRateLimiter.set(userId, userLimit);
  return { allowed: true };
}

// Cleanup old entries every minute to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  // Cleanup rate limiter entries
  for (const [userId, limit] of commandRateLimiter.entries()) {
    if (now > limit.resetAt + 60000) {
      commandRateLimiter.delete(userId);
    }
  }
  // Cleanup stale command buffers (older than 5 minutes)
  for (const [sessionId, entry] of commandBuffers.entries()) {
    if (now > entry.lastActivity + 300000) {
      commandBuffers.delete(sessionId);
    }
  }
}, 60000);

export async function POST(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token, session, or anonymous session required' },
        { status: 401 }
      );
    }

    // Check rate limit
    const rateLimitResult = checkRateLimit(authResult.userId);
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: 'Rate limit exceeded. Too many terminal commands.',
          retryAfter: rateLimitResult.retryAfter,
        },
        { 
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.retryAfter || 1),
            'X-RateLimit-Limit': '10',
            'X-RateLimit-Remaining': '0',
          },
        }
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

    // SECURITY: Buffer ALL input for security validation
    // We cannot distinguish between "PTY interactive" and "line-based" input reliably
    // Attackers could bypass security by sending dangerous commands without newlines
    const bufferEntry = commandBuffers.get(sessionId) || { buffer: '', lastActivity: Date.now() };
    bufferEntry.buffer += data;
    bufferEntry.lastActivity = Date.now();
    commandBuffers.set(sessionId, bufferEntry);

    // Check if we have a complete command (contains newline or carriage return)
    // Must match terminal-manager.ts which triggers on both \r and \n
    if (bufferEntry.buffer.includes('\n') || bufferEntry.buffer.includes('\r')) {
      const fullCommand = bufferEntry.buffer.trim();
      const securityResult = checkCommandSecurity(fullCommand);

      if (!securityResult.allowed) {
        logger.warn('Blocked dangerous command', {
          command: fullCommand.substring(0, 100), // Truncate for logging
          reason: securityResult.reason,
          severity: securityResult.severity,
          userId: authResult.userId,
          sessionId,
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

      // SECURITY: Only forward data to terminal AFTER validation passes
      // This ensures no partial command data reaches the terminal before security check
      const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
      if (!userSession || userSession.sessionId !== sessionId) {
        return NextResponse.json(
          { error: 'Unauthorized: session does not belong to this user' },
          { status: 403 }
        );
      }

      await terminalManager.sendInput(sessionId, fullCommand);

      // Clear buffer after successful validation and forwarding
      commandBuffers.delete(sessionId);
      return NextResponse.json({ success: true });
    }

    // Partial command (buffered, waiting for newline) - don't forward yet
    // This prevents partial command execution before security validation
    return NextResponse.json({ success: true, buffered: true });
  } catch (error) {
    logger.error('Terminal input error', error as Error);
    return NextResponse.json({ error: 'Failed to send input' }, { status: 500 });
  }
}
