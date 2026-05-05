import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

import { z } from 'zod';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { verifyAuth } from '@/lib/auth/jwt';
import { checkUserRateLimit } from '@/lib/middleware/rate-limiter';
import { sandboxIdSchema, commandSchema } from '@/lib/validation/schemas';

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const DEBUG = process.env.DEBUG_SANDBOX === 'true' || process.env.NODE_ENV === 'development';
const log = (...args: any[]) => DEBUG && console.log(`${COLORS.bright}${COLORS.green}[SANDBOX EXECUTE]${COLORS.reset}`, ...args);
const logWarn = (...args: any[]) => console.warn(`${COLORS.bright}${COLORS.yellow}[SANDBOX EXECUTE WARN]${COLORS.reset}`, ...args);
const logError = (...args: any[]) => console.error(`${COLORS.bright}${COLORS.red}[SANDBOX EXECUTE ERROR]${COLORS.reset}`, ...args);
const logCommand = (...args: any[]) => DEBUG && console.log(`${COLORS.bright}${COLORS.magenta}[SANDBOX COMMAND]${COLORS.reset}`, ...args);

const sandboxExecuteRequestSchema = z.object({
  sandboxId: sandboxIdSchema,
  command: commandSchema,
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);

  try {
    log(`${COLORS.dim}[${requestId}]${COLORS.reset} POST ${COLORS.green}/api/sandbox/execute${COLORS.reset}`);

    // CRITICAL: Authenticate user from JWT token - do NOT trust userId from request body
    const authResult = await verifyAuth(req);
    if (!authResult.success || !authResult.userId) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Unauthorized:${COLORS.reset} No valid authentication token`);
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token required' },
        { status: 401 }
      );
    }

    // Use authenticated userId from token, ignore body userId
    const authenticatedUserId = authResult.userId;
    log(`${COLORS.dim}[${requestId}]${COLORS.reset} Authenticated user: ${COLORS.magenta}${authenticatedUserId}${COLORS.reset}`);

    // Rate limiting: 30 executions per minute per user
    const rateLimitResult = checkUserRateLimit(authenticatedUserId, 'generic');
    if (!rateLimitResult.allowed) {
      logWarn(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.yellow}Rate limit exceeded${COLORS.reset}`);
      return NextResponse.json(
        { error: 'Rate limit exceeded. Too many command executions.', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: rateLimitResult.headers }
      );
    }

    const body = await req.json();
    
    // Validate request body with Zod
    const parseResult = sandboxExecuteRequestSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Validation failed:${COLORS.reset} ${firstError.message}`);
      return NextResponse.json(
        { 
          error: firstError.message,
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }
    
    const { command, sandboxId, cwd, env } = parseResult.data;

    logCommand(`${COLORS.dim}[${requestId}]${COLORS.reset} Command: ${COLORS.blue}"${command}"${COLORS.reset} | Sandbox: ${COLORS.cyan}${sandboxId}${COLORS.reset}`);

    // Verify sandbox ownership — check that the authenticated user has an active session with this sandboxId
    const userSession = sandboxBridge.getSessionByUserId(authenticatedUserId);
    if (!userSession || userSession.sandboxId !== sandboxId) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Unauthorized sandbox access:${COLORS.reset} user=${COLORS.magenta}${authenticatedUserId}${COLORS.reset}, requested=${COLORS.cyan}${sandboxId}${COLORS.reset}, actual=${COLORS.cyan}${userSession?.sandboxId || 'none'}${COLORS.reset}`);
      return NextResponse.json(
        { error: 'Unauthorized: sandbox does not belong to this user' },
        { status: 403 }
      );
    }

    log(`${COLORS.dim}[${requestId}]${COLORS.reset} Sandbox ownership verified: ${COLORS.cyan}${sandboxId}${COLORS.reset}`);

    // Validate and sanitize command before execution
    const { SandboxSecurityManager } = await import('@/lib/sandbox/security-manager');
    let safeCommand: string;
    try {
      safeCommand = SandboxSecurityManager.sanitizeCommand(command);
      if (safeCommand !== command) {
        logWarn(`${COLORS.dim}[${requestId}]${COLORS.reset} Command sanitized: ${COLORS.blue}"${command}"${COLORS.reset} → ${COLORS.blue}"${safeCommand}"${COLORS.reset}`);
      }
    } catch (validationError: any) {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Command rejected:${COLORS.reset} ${validationError.message}`);
      return NextResponse.json(
        { error: `Command rejected: ${validationError.message}` },
        { status: 400 }
      );
    }

    // Execute the validated command in the sandbox
    log(`${COLORS.dim}[${requestId}]${COLORS.reset} Executing command in sandbox...`);
    const result = await sandboxBridge.executeCommand(sandboxId, safeCommand);
    const duration = Date.now() - startTime;

    if (result.success) {
      log(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.green}Success${COLORS.reset}: Exit code ${COLORS.magenta}${result.exitCode ?? 0}${COLORS.reset} in ${COLORS.cyan}${duration}ms${COLORS.reset}`);
    } else {
      logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}Command failed${COLORS.reset}: Exit code ${COLORS.magenta}${result.exitCode ?? 1}${COLORS.reset}, error: ${result.output}`);
    }

    if (duration > 5000) {
      logWarn(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.yellow}SLOW COMMAND:${COLORS.reset} took ${COLORS.cyan}${duration}ms${COLORS.reset}`);
    }

    return NextResponse.json({
      stdout: result.success ? result.output : '',
      stderr: result.success ? '' : result.output,
      exitCode: result.exitCode ?? 0,
    });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logError(`${COLORS.dim}[${requestId}]${COLORS.reset} ${COLORS.red}ERROR${COLORS.reset} after ${COLORS.cyan}${duration}ms${COLORS.reset}:`, error.message);
    return NextResponse.json(
      { error: error.message || 'Failed to execute command' },
      { status: 500 }
    );
  }
}
